"""Phoneme recogniser for the Letters game (prototype).

A small local HTTP service around a wav2vec2 model that outputs speech sounds
(IPA phonemes) instead of words. The game sends one short clip of a child
saying a letter sound; this scores how well the clip matches each letter.

  GET  /health    -> {"ready": true}
  POST /phonemes  body: raw 16 kHz mono 16-bit little-endian PCM
               -> {"phonemes": ["s"], "onset": "s",
                   "letters": [{"letter": "s", "score": 0.97}, ...], "ms": 180}

Started by server.js when .venv exists; listens on 127.0.0.1 only.
"""
import json
import os
import sys
import threading
import time
import wave
from urllib.parse import parse_qs, urlparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import torch
from huggingface_hub import hf_hub_download
from transformers import Wav2Vec2ForCTC

MODEL = os.environ.get("PHONEME_MODEL", "facebook/wav2vec2-lv-60-espeak-cv-ft")
PORT = int(os.environ.get("PHONEME_PORT", "5178"))
RATE = 16000

# The sound each letter makes in early phonics, as the model's IPA symbols.
# Several symbols = any of them counts. q and x are two sounds in a row.
LETTER_SOUNDS = {
    "a": ["æ", "a", "ä", "aː"],
    "b": ["b"],
    "c": ["k", "kh", "kʰ"],
    "d": ["d"],
    "e": ["ɛ", "e", "ɛː", "eː", "e̞", "eɪ", "ɛɹ"],
    "f": ["f"],
    "g": ["ɡ"],
    "h": ["h", "ħ", "x"],
    "i": ["ɪ", "i", "ᵻ", "ɨ"],
    "j": ["dʒ", "dZ"],
    "k": ["k", "kh", "kʰ"],
    "l": ["l", "ɫ"],
    "m": ["m"],
    "n": ["n", "n̩"],
    "o": ["ɒ", "ɔ", "ɑ", "ɑː", "ɔː", "o"],
    "p": ["p", "ph", "pʰ"],
    "r": ["ɹ", "r", "ɾ", "ɻ"],
    "s": ["s"],
    "t": ["t", "th", "tʰ"],
    "u": ["ʌ", "ɐ", "ə", "ɜ", "ɜː"],
    "v": ["v", "ʋ"],
    "w": ["w"],
    "y": ["j"],
    "z": ["z"],
}
LETTER_PAIRS = {"q": (["k"], ["w"]), "x": (["k"], ["s"])}
VOWEL_LETTERS = set("aeiou")
# Short vowels sit close together and the model often hears a neighbour
# ("eh" as "a" or "i"). A letter gets part of its neighbours' score, so a
# near miss on a vowel still counts.
VOWEL_NEIGHBOURS = {"e": ["a", "i"], "a": ["e"], "i": ["e"]}
NEIGHBOUR_WEIGHT = 0.7
HERE = os.path.dirname(os.path.abspath(__file__))
# Every sound is kept for diagnostics and tuning (PHONEME_RECORD=off to stop):
# the clip as a WAV in recordings/, and one line about it in recordings/index.tsv.
RECORD = os.environ.get("PHONEME_RECORD", "on") != "off"
RECORD_DIR = os.path.join(HERE, "recordings")
INDEX_FILE = os.path.join(RECORD_DIR, "index.tsv")
# A consonant is usually said with a little vowel after it ("buh"), so the
# letter's own sound has to be found at the start of the clip.
ONSET_FRAMES = 14  # the model makes one frame every 20 ms

torch.set_num_threads(max(1, min(6, (os.cpu_count() or 4) // 2)))

with open(hf_hub_download(MODEL, "vocab.json"), encoding="utf-8") as f:
    VOCAB = json.load(f)
ID_TO_TOKEN = {i: t for t, i in VOCAB.items()}
BLANK = VOCAB.get("<pad>", 0)
SPECIAL = {t for t in VOCAB if t.startswith("<") or t in ("|", " ")}

model = Wav2Vec2ForCTC.from_pretrained(MODEL)
model.eval()
lock = threading.Lock()


def ids(symbols):
    return [VOCAB[s] for s in symbols if s in VOCAB]


LETTER_IDS = {letter: ids(symbols) for letter, symbols in LETTER_SOUNDS.items()}
PAIR_IDS = {letter: (ids(a), ids(b)) for letter, (a, b) in LETTER_PAIRS.items()}
VOWEL_IDS = {
    i
    for t, i in VOCAB.items()
    if t not in SPECIAL and t[0] in "aeiouæɛɪɒɔɑʌɐəɜʊɚɝøyɨʉɯɤœɶ"
}
for letter, found in LETTER_IDS.items():
    if not found:
        print(f"warning: no model symbol for letter {letter}", file=sys.stderr)


def recognise(pcm: bytes, target: str = "", source: str = "", record: bool = True) -> dict:
    started = time.perf_counter()
    audio = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0
    if audio.size < RATE // 10:
        return {"phonemes": [], "onset": None, "letters": [], "ms": 0}
    audio = (audio - audio.mean()) / np.sqrt(audio.var() + 1e-7)
    with lock, torch.no_grad():
        logits = model(torch.from_numpy(audio).unsqueeze(0)).logits[0]
    probs = torch.softmax(logits, dim=-1).numpy()  # frames x symbols

    # Plain reading of the clip: best symbol per frame, repeats and blanks removed.
    best = probs.argmax(axis=1)
    sequence = []
    previous = BLANK
    for frame, token in enumerate(best):
        if token != previous and token != BLANK and ID_TO_TOKEN[token] not in SPECIAL:
            sequence.append((frame, int(token)))
        previous = token
    phonemes = [ID_TO_TOKEN[t] for _, t in sequence]
    if not sequence:
        if record and RECORD:
            save_recording(pcm, target, source, [], [])
        return {"phonemes": [], "onset": None, "letters": [], "ms": round((time.perf_counter() - started) * 1000)}

    # A vowel said on its own often starts with a little catch in the throat.
    if len(sequence) > 1 and ID_TO_TOKEN[sequence[0][1]] == "ʔ":
        sequence = sequence[1:]
    first_frame, first_token = sequence[0]
    lo = max(0, first_frame - 2)
    onset = probs[lo : first_frame + ONSET_FRAMES]
    starts_with_vowel = first_token in VOWEL_IDS

    def peak(window, symbol_ids):
        return float(window[:, symbol_ids].sum(axis=1).max()) if symbol_ids and len(window) else 0.0

    scores = {}
    for letter, symbol_ids in LETTER_IDS.items():
        score = peak(onset, symbol_ids)
        # "buh" ends in a vowel; that must not count as the child saying "u".
        if letter in VOWEL_LETTERS and not starts_with_vowel:
            score = 0.0
        scores[letter] = score
    own = dict(scores)
    for letter, neighbours in VOWEL_NEIGHBOURS.items():
        scores[letter] = max(own[letter], NEIGHBOUR_WEIGHT * max(own[n] for n in neighbours))
    for letter, (first, second) in PAIR_IDS.items():
        scores[letter] = min(peak(onset, first), peak(probs[lo:], second))

    letters = [{"letter": k, "score": round(v, 3)} for k, v in sorted(scores.items(), key=lambda kv: -kv[1])]
    if record and RECORD:
        save_recording(pcm, target, source, phonemes, letters)
    return {
        "phonemes": phonemes,
        "onset": ID_TO_TOKEN[first_token],
        "letters": letters,
        "ms": round((time.perf_counter() - started) * 1000),
    }


def save_recording(pcm, target, source, phonemes, letters):
    """Keeps the clip and what the model made of it, for tuning later."""
    try:
        os.makedirs(RECORD_DIR, exist_ok=True)
        target = target if len(target) == 1 and target.isalpha() else "_"
        mine = next((l for l in letters if l["letter"] == target), None)
        rank = 1 + sum(1 for l in letters if mine and l["score"] > mine["score"]) if mine else 0
        stamp = time.strftime("%Y%m%d-%H%M%S") + f"-{int(time.time() * 1000) % 1000:03d}"
        name = f"{stamp}_{target}.wav"
        with wave.open(os.path.join(RECORD_DIR, name), "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(RATE)
            out.writeframes(pcm)
        new = not os.path.exists(INDEX_FILE)
        with open(INDEX_FILE, "a", encoding="utf-8") as index:
            if new:
                index.write("file\ttarget\tsource\theard\ttarget_score\ttarget_rank\ttop\n")
            top = " ".join(f"{l['letter']}={l['score']:.2f}" for l in letters[:6])
            score = f"{mine['score']:.2f}" if mine else ""
            index.write(f"{name}\t{target}\t{source}\t/{' '.join(phonemes)}/\t{score}\t{rank or ''}\t{top}\n")
    except OSError as error:
        print("could not save recording:", error, file=sys.stderr)


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, {"ready": True, "model": MODEL})
        else:
            self.reply(404, {"error": "not_found"})

    def do_POST(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        if url.path != "/phonemes":
            return self.reply(404, {"error": "not_found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > RATE * 2 * 10:  # at most 10 seconds
            return self.reply(400, {"error": "bad_length"})
        try:
            target = (query.get("target") or [""])[0].lower()
            source = (query.get("from") or [""])[0][:20]
            self.reply(200, recognise(self.rfile.read(length), target, source))
        except Exception as error:  # keep serving after a bad clip
            print("recognise failed:", error, file=sys.stderr)
            self.reply(500, {"error": "recognise_failed"})

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    recognise(np.zeros(RATE, dtype="<i2").tobytes(), record=False)  # warm up
    print(f"phoneme service ready on 127.0.0.1:{PORT} ({MODEL})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
