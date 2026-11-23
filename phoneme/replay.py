"""Re-runs every saved clip through the recogniser, for tuning.

    .venv/Scripts/python phoneme/replay.py            # all recordings
    .venv/Scripts/python phoneme/replay.py e          # only clips whose target was "e"

Prints what the model hears now for each clip and how often the target letter
would be accepted, so a change to service.py can be judged against real
recordings instead of by ear.
"""
import os
import sys
import wave

from service import RECORD_DIR, recognise

MIN_SCORE, MAX_RANK = 0.25, 3  # keep in step with soundMatches in public/reading.js


def accepted(letters, target):
    mine = next((l for l in letters if l["letter"] == target), None)
    if not mine or mine["score"] < MIN_SCORE:
        return False
    return 1 + sum(1 for l in letters if l["score"] > mine["score"]) <= MAX_RANK


def main():
    only = sys.argv[1].lower() if len(sys.argv) > 1 else None
    files = sorted(f for f in os.listdir(RECORD_DIR) if f.endswith(".wav")) if os.path.isdir(RECORD_DIR) else []
    totals = {}
    for name in files:
        target = name.rsplit("_", 1)[-1][:-4]
        if target == "_" or (only and target != only):
            continue
        with wave.open(os.path.join(RECORD_DIR, name), "rb") as clip:
            pcm = clip.readframes(clip.getnframes())
        result = recognise(pcm, record=False)
        ok = accepted(result["letters"], target)
        good, count = totals.get(target, (0, 0))
        totals[target] = (good + ok, count + 1)
        top = " ".join(f"{l['letter']}={l['score']:.2f}" for l in result["letters"][:5])
        print(f"{name}  {target}  {'accept' if ok else 'REJECT'}  /{' '.join(result['phonemes'])}/  {top}")
    print()
    for target in sorted(totals):
        good, count = totals[target]
        print(f"{target}: {good}/{count} accepted")
    if not totals:
        print("No recordings with a target letter yet.")


if __name__ == "__main__":
    main()
