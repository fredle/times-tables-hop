import { judgeNumbers } from './numbers.js';
import { isReadingMode, items, accepted, vocabulary, matchesSpoken, soundMatches, normalise } from './reading.js';
import { createBridgeGame } from './bridge.js';
import { createBlockGame } from './blockscene.js';
import { hintsFor, spellingHints } from './hints.js';
import { createSpellingPuzzles, tidy } from './spelling.js';
import { COLOURS, makeSequence, nextVocabulary } from './next.js';
import { VoiceInput, NativeVoiceInput, PhonemeVoiceInput, nativeBridge } from './voice.js';

// ---------- constants ----------
// Tall playfield on phones held upright, wide one everywhere else.
const PORTRAIT = window.innerHeight > window.innerWidth * 1.15;
const W = PORTRAIT ? 600 : 800;
const H = PORTRAIT ? 840 : 600;
const LANES = 5;
const ROW_H = H / (LANES + 2);
const FROG_X = W / 2;
const GOAL_ROW = LANES + 1;
const rowY = (r) => H - (r + 0.5) * ROW_H;
const SPEEDS = { relaxed: 1.5, normal: 1, speedy: 0.7 };
const CAR_COLORS = ['#e63946', '#f4a261', '#2a9d8f', '#8338ec', '#ffbe0b', '#3a86ff', '#ff70a6'];

const $ = (id) => document.getElementById(id);
const canvas = $('c');
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d');
const el = {
  score: $('score'), level: $('level'), lives: $('lives'),
  mic: $('mic'), micText: $('micText'), micDot: document.querySelector('#mic .dot'),
  question: $('question'), timerFill: $('timerFill'), heard: $('heard'),
  menu: $('menu'), menuMsg: $('menuMsg'), result: $('result'),
  tables: $('tables'), speeds: $('speeds'), modes: $('modes'), tablesSection: $('tablesSection'), startBtn: $('startBtn'), voiceNote: $('voiceNote'),
  form: $('answerForm'), input: $('answerInput'),
};

// ---------- settings ----------
function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const settings = load('tth.settings', { tables: [2, 5, 10], speed: 'normal' });
if (!Array.isArray(settings.tables) || !settings.tables.length) settings.tables = [2, 5, 10];
if (!SPEEDS[settings.speed]) settings.speed = 'normal';
if (!['tables', 'numbers', 'letters', 'words', 'next', 'spelling', 'record'].includes(settings.mode)) settings.mode = 'tables';
if (settings.mode === 'record' && nativeBridge) settings.mode = 'letters'; // recording needs the web server
const numbersMode = () => settings.mode === 'numbers';
// "Record sounds" plays like the Letters game, but a grown-up marks each
// attempt right or wrong and every clip is saved for training.
const recordMode = () => settings.mode === 'record';
const readingMode = () => isReadingMode(settings.mode) || recordMode();
const itemsMode = () => (recordMode() ? 'letters' : settings.mode);
const tablesMode = () => settings.mode === 'tables';
const nextMode = () => settings.mode === 'next';
// Spelling is typed, not spoken.
const spellingMode = () => settings.mode === 'spelling';
// Every game can be played crossing the road or mending the bridge
// (recording sounds stays on the road, where nothing rushes the child).
const SCENE_MODES = ['numbers', 'letters', 'words', 'next', 'tables', 'spelling'];
if (!['bridge', 'blocks'].includes(settings.scene)) settings.scene = 'road';
const bridgeScene = () => settings.scene === 'bridge' && SCENE_MODES.includes(settings.mode);
// The block puzzle needs short questions that fit on a block.
const BLOCK_MODES = ['numbers', 'letters', 'words', 'tables'];
const blockScene = () => settings.scene === 'blocks' && BLOCK_MODES.includes(settings.mode);
const SWAP_WORDS = ['swap', 'swop', 'new blocks', 'change'];
// What the speech recogniser should expect in the chosen game.
const hints = () => {
  const words = nextMode() ? nextVocabulary() : vocabulary(settings.mode);
  return blockScene() ? [...words, 'swap'] : words;
};
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
let best = load('tth.best', 0);

for (let n = 1; n <= 12; n++) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = n;
  b.dataset.table = n;
  el.tables.appendChild(b);
}
const speakerName = () => $('speakerName').value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
$('speakerName').value = load('tth.speaker', '');
$('speakerName').addEventListener('input', () => renderChips());

function renderChips() {
  el.tables.querySelectorAll('button').forEach((b) => b.classList.toggle('on', settings.tables.includes(+b.dataset.table)));
  el.speeds.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.speed === settings.speed));
  el.modes.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === settings.mode));
  el.tablesSection.hidden = !tablesMode();
  $('sceneSection').hidden = !SCENE_MODES.includes(settings.mode);
  const scene = settings.scene === 'blocks' && !BLOCK_MODES.includes(settings.mode) ? 'road' : settings.scene;
  $('scenes').querySelectorAll('button').forEach((b) => {
    b.classList.toggle('on', b.dataset.scene === scene);
    if (b.dataset.scene === 'blocks') b.hidden = !BLOCK_MODES.includes(settings.mode);
  });
  $('recordSection').hidden = !recordMode();
  $('recordModeBtn').hidden = Boolean(nativeBridge);
  el.startBtn.disabled = (tablesMode() && settings.tables.length === 0) || (recordMode() && !speakerName());
}
el.modes.addEventListener('click', (e) => {
  if (!e.target.dataset.mode) return;
  settings.mode = e.target.dataset.mode;
  renderChips();
  showNote();
  // The phoneme service takes a while to load after the server starts, so
  // look again whenever a game is picked.
  if (!nativeBridge) {
    fetch('/api/status')
      .then((r) => r.json())
      .then((s) => {
        phonemesAvailable = Boolean(s.phonemes) && Boolean(navigator.mediaDevices && window.AudioWorkletNode);
        showNote();
      })
      .catch(() => {});
  }
});
$('scenes').addEventListener('click', (e) => {
  if (!e.target.dataset.scene) return;
  settings.scene = e.target.dataset.scene;
  renderChips();
});
el.tables.addEventListener('click', (e) => {
  const n = +e.target.dataset.table;
  if (!n) return;
  settings.tables = settings.tables.includes(n) ? settings.tables.filter((t) => t !== n) : [...settings.tables, n];
  renderChips();
});
el.speeds.addEventListener('click', (e) => {
  if (!e.target.dataset.speed) return;
  settings.speed = e.target.dataset.speed;
  renderChips();
});
renderChips();

// ---------- sound ----------
let audio = null;
function tone(freq, start, dur, type = 'square', vol = 0.06) {
  if (!audio) return;
  const o = audio.createOscillator();
  const gn = audio.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = audio.currentTime + start;
  gn.gain.setValueAtTime(vol, t);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(gn).connect(audio.destination);
  o.start(t);
  o.stop(t + dur);
}
// In the iOS app, page audio would fight the microphone for the audio
// session, so feedback is a haptic tap from native code instead.
const haptic = (kind) => {
  try {
    nativeBridge.postMessage({ cmd: 'haptic', kind });
  } catch {}
};
const sfx = nativeBridge ? {
  hop: () => haptic('hop'),
  splat: () => haptic('splat'),
  win: () => haptic('win'),
  nope: () => haptic('nope'),
} : {
  hop: () => { tone(520, 0, 0.08); tone(780, 0.07, 0.1); },
  splat: () => { tone(160, 0, 0.25, 'sawtooth', 0.09); tone(90, 0.12, 0.3, 'sawtooth', 0.09); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.1, 0.16)),
  nope: () => tone(220, 0, 0.12, 'triangle', 0.08),
};

// ---------- game state ----------
const g = {
  mode: 'menu', // menu | playing | hit | win | over
  score: 0, lives: 3, level: 1, streak: 0, asked: 0,
  frog: { row: 0, y: rowY(0), hop: null, flat: false },
  cars: [], threat: null, particles: [],
  q: null, lastKey: '', retry: [],
  after: null, // { t, fn } delayed step
};
let qid = 0;

function timeLimit() {
  if (spellingMode()) return Math.max(12, 26 - (g.level - 1) * 2) * SPEEDS[settings.speed];
  // Little ones get longer, and it speeds up more gently.
  const base = tablesMode() ? Math.max(3.5, 9 - (g.level - 1) * 0.6) : Math.max(5, 10 - (g.level - 1) * 0.5);
  return base * SPEEDS[settings.speed];
}

// What the question bar shows: unanswered, or with the answer revealed.
function label(q, solved) {
  if (q.accept) return q.text;
  if (q.plain) return solved ? `${q.answer} is ${NUMBER_WORDS[q.answer]}` : q.text;
  return `${q.text} = ${solved ? q.answer : '?'}`;
}

function pickNumber() {
  g.asked++;
  let n;
  const due = g.retry.findIndex((r) => r.due <= g.asked);
  if (due >= 0) n = g.retry.splice(due, 1)[0].a;
  else do n = 1 + Math.floor(Math.random() * 9); while (String(n) === g.lastKey);
  g.lastKey = String(n);
  return { a: n, b: 1, answer: n, text: String(n), plain: true, id: ++qid };
}

// A letter or a three-letter word to read aloud.
function pickReading() {
  g.asked++;
  const all = items(itemsMode());
  let item;
  const due = g.retry.findIndex((r) => r.due <= g.asked);
  if (due >= 0) item = g.retry.splice(due, 1)[0].a;
  else do item = all[Math.floor(Math.random() * all.length)]; while (item === g.lastKey);
  g.lastKey = item;
  return { a: item, b: 1, answer: item, accept: accepted(itemsMode(), item), text: item, plain: true, id: ++qid };
}

// A colour pattern or number sequence to continue.
function pickNext() {
  g.asked++;
  let seq;
  const due = g.retry.findIndex((r) => r.due <= g.asked);
  if (due >= 0) seq = g.retry.splice(due, 1)[0].a;
  else do seq = makeSequence(g.level); while (seq.shown.join() === g.lastKey);
  g.lastKey = seq.shown.join();
  return { a: seq, b: 1, seq, answer: seq.answer, accept: seq.accept, text: `${seq.shown.join(', ')}, ?`, id: ++qid };
}

// Puts the question in the bar above the game: text for most games, a row
// of coloured dots or numbers for "What comes next?".
function showQuestion(q, solved, missed = false) {
  if (q.spell) return q.spell.show(!solved ? 'ask' : missed ? 'revealed' : 'right');
  if (!q.seq) {
    el.question.textContent = label(q, solved);
    return;
  }
  const item = (value, isAnswer) => {
    const span = document.createElement('span');
    if (q.seq.kind === 'colour' && value !== '?') {
      span.className = 'dot';
      span.style.background = COLOURS[value].css;
      span.title = value;
    } else {
      span.className = 'num';
      span.textContent = value;
    }
    if (isAnswer) span.classList.add('answer');
    return span;
  };
  el.question.replaceChildren(...q.seq.shown.map((v) => item(v, false)), item(solved ? q.seq.answer : '?', true));
}

// A sentence with one misspelt word, for the road (the bridge takes the
// puzzle as it is).
function pickSpelling() {
  g.asked++;
  const due = g.retry.findIndex((r) => r.due <= g.asked);
  const puzzle = due >= 0 ? g.retry.splice(due, 1)[0].a : spellingPuzzles.next(g.level);
  const right = puzzle.right.toLowerCase();
  return { a: puzzle, b: 1, spell: puzzle, answer: right, accept: [right], text: puzzle.source, id: ++qid };
}

function pickQuestion() {
  if (spellingMode()) return pickSpelling();
  if (numbersMode()) return pickNumber();
  if (nextMode()) return pickNext();
  if (readingMode()) return pickReading();
  g.asked++;
  let a, b;
  const due = g.retry.findIndex((r) => r.due <= g.asked);
  if (due >= 0) {
    ({ a, b } = g.retry.splice(due, 1)[0]);
  } else {
    for (let i = 0; i < 12; i++) {
      a = settings.tables[Math.floor(Math.random() * settings.tables.length)];
      b = 1 + Math.floor(Math.random() * 12);
      if (`${Math.min(a, b)}x${Math.max(a, b)}` !== g.lastKey) break;
    }
  }
  g.lastKey = `${Math.min(a, b)}x${Math.max(a, b)}`;
  const flip = Math.random() < 0.5;
  return { a, b, answer: a * b, text: flip ? `${b} × ${a}` : `${a} × ${b}`, id: ++qid };
}

function askQuestion() {
  clearHint();
  g.q = pickQuestion();
  g.q.shownAt = performance.now();
  if (soundVoice) soundVoice.target = g.q.accept ? g.q.text : '';
  markSpeechConsumed();
  el.question.className = '';
  showQuestion(g.q, false);
  el.heard.innerHTML = '&nbsp;';
  // No traffic while recording: the child should not be rushed.
  if (g.frog.row >= 1 && g.frog.row <= LANES && !recordMode()) spawnThreat();
}

function spawnThreat() {
  const row = g.frog.row;
  const dir = row % 2 ? 1 : -1;
  const truck = Math.random() < 0.3;
  const w = truck ? 150 : 104;
  const limit = timeLimit();
  const startFront = dir > 0 ? -10 : W + 10;
  const hitFront = FROG_X - dir * 22;
  const car = {
    row, dir, w, truck,
    x: startFront - (dir * w) / 2,
    speed: Math.abs(hitFront - startFront) / limit,
    color: CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
    hitFront, limit, t: 0,
  };
  g.threat = car;
  g.cars.push(car);
}

function releaseThreat() {
  if (!g.threat) return;
  g.threat.speed = Math.max(g.threat.speed, 460);
  g.threat = null;
}

// The typing box: a fallback in the spoken games, the way to play in Spelling Bridge.
function setUpTyping() {
  const spell = spellingMode();
  el.form.classList.toggle('spelling', spell);
  el.form.querySelector('label').textContent = spell ? 'Correct spelling:' : 'Or type it:';
  el.input.placeholder = spell ? '' : '?';
  // The phone must not fix the spelling for them.
  el.input.spellcheck = false;
  el.input.setAttribute('autocorrect', 'off');
  el.input.setAttribute('autocomplete', 'off');
  el.input.value = '';
}

function startGame() {
  Object.assign(g, { mode: 'playing', score: 0, lives: 3, level: 1, streak: 0, asked: 0, cars: [], threat: null, particles: [], retry: [], after: null, lastKey: '' });
  g.frog = { row: 0, y: rowY(0), hop: null, flat: false };
  el.menu.hidden = true;
  $('backBtn').hidden = false;
  $('hintBtn').hidden = false;
  pendingClip = null;
  savedClips = 0;
  setUpTyping();
  el.form.hidden = recordMode();
  if (recordMode()) save('tth.speaker', speakerName());
  // The typing fallback takes letters in the reading games, digits otherwise.
  const typesWords = readingMode() || nextMode() || spellingMode();
  el.input.inputMode = typesWords ? 'text' : 'numeric';
  el.input.maxLength = spellingMode() ? 20 : nextMode() ? 6 : 3;
  if (typesWords) el.input.removeAttribute('pattern');
  else el.input.setAttribute('pattern', '[0-9]*');
  el.input.autocapitalize = 'off';
  updateHud();
  showJudge(true);
  if (bridgeScene()) {
    g.q = null;
    if (spellingMode()) {
      spellingPuzzles.reset();
      el.input.focus();
    }
    bridge.start(nextBridgePuzzle);
    return;
  }
  if (blockScene()) {
    g.q = null;
    $('hintBtn').hidden = true; // hints are for one question; the tray has three
    el.timerFill.style.width = '0';
    el.heard.innerHTML = '&nbsp;';
    blocks.start();
    updateHud();
    return;
  }
  askQuestion();
  if (spellingMode()) el.input.focus();
}

// ---------- the bridge versions of the games ----------
function nextBridgePuzzle() {
  clearHint();
  if (spellingMode()) return spellingPuzzles.next(g.level);
  g.q = pickQuestion();
  g.q.shownAt = performance.now();
  markSpeechConsumed();
  return questionPuzzle(g.q);
}

// Lays a question out as planks with the answer missing.
function questionPuzzle(q) {
  const text = (t) => ({ text: String(t) });
  let items;
  let brokenIndex;
  let mended;
  let bar = null; // what the question bar shows, when it differs from the road game
  let shown = text('?'); // what the broken plank shows
  let prompt = voice.active ? 'Say what is missing to mend the bridge.' : 'Type what is missing to mend the bridge.';
  if (q.seq) {
    // What comes next?: the pattern, then a gap.
    const item = (v) => (q.seq.kind === 'colour' ? { colour: COLOURS[v].css } : text(v));
    items = [...q.seq.shown.map(item), text('?')];
    brokenIndex = items.length - 1;
    mended = item(q.seq.answer);
  } else if (q.accept) {
    // Letters and words: read what is on the broken plank.
    items = [text(''), text(q.text), text('')];
    brokenIndex = 1;
    mended = text(q.text);
    shown = text(q.text);
    prompt = 'Say what is on the broken plank to mend the bridge.';
  } else if (q.plain) {
    // Numbers: five numbers in a row with one missing.
    const start = Math.min(Math.max(q.answer - 2, 1), 6);
    items = [0, 1, 2, 3, 4].map((k) => text(start + k));
    brokenIndex = q.answer - start;
    mended = text(q.answer);
    bar = (solved) => items.map((it, i) => (i === brokenIndex ? (solved ? q.answer : '?') : it.text)).join(', ');
  } else {
    // Times tables: the sum, one part per plank.
    const [x, , y] = q.text.split(' ');
    items = [text(x), text('×'), text(y), text('='), text('?')];
    brokenIndex = 4;
    mended = text(q.answer);
  }
  return {
    items,
    brokenIndex,
    broken: shown,
    mended,
    prompt,
    reveal: `It was ${q.answer}. That one will come back.`,
    hint: () => '',
    show(state) {
      el.question.className = state === 'right' ? 'good' : state === 'revealed' ? 'bad' : '';
      if (bar) el.question.textContent = bar(state !== 'ask');
      else showQuestion(q, state !== 'ask');
    },
  };
}

function correct() {
  if (bridgeScene()) {
    if (!bridge.ready()) return;
    g.q = null;
    clearTimeout(settleTimer);
    bridge.right();
    return;
  }
  const q = g.q;
  g.q = null;
  clearTimeout(settleTimer);
  g.streak++;
  const left = g.threat ? Math.max(0, 1 - g.threat.t / g.threat.limit) : 0.5;
  g.score += 10 + Math.round(left * 10) + Math.min(g.streak - 1, 5) * 2 - Math.min(8, g.hints * 4);
  el.question.className = 'good';
  showQuestion(q, true);
  releaseThreat();
  g.frog.hop = { from: g.frog.y, to: rowY(g.frog.row + 1), t: 0 };
  burst(FROG_X, g.frog.y, 10, ['#fff', '#ffe066']);
  sfx.hop();
  updateHud();
}

function wrong(value) {
  if (bridgeScene()) {
    bridge.wrong(`I heard ${value}.`);
    return;
  }
  el.heard.textContent = spellingMode() ? 'Not quite. Try again!' : `I heard ${value}. Try again!`;
  el.question.classList.remove('shake');
  void el.question.offsetWidth;
  el.question.classList.add('shake');
  sfx.nope();
}

function land() {
  g.frog.row++;
  g.frog.y = rowY(g.frog.row);
  g.frog.hop = null;
  if (g.frog.row === GOAL_ROW) {
    g.mode = 'win';
    g.score += 50;
    el.question.className = 'good';
    el.question.textContent = 'You made it!';
    burst(FROG_X, g.frog.y, 60, CAR_COLORS);
    sfx.win();
    updateHud();
    g.after = {
      t: 1.6,
      fn: () => {
        g.level++;
        g.frog.row = 0;
        g.frog.y = rowY(0);
        g.mode = 'playing';
        updateHud();
        askQuestion();
      },
    };
  } else {
    askQuestion();
  }
}

function runOver() {
  const q = g.q;
  g.q = null;
  clearTimeout(settleTimer);
  g.mode = 'hit';
  g.lives--;
  g.streak = 0;
  g.frog.flat = true;
  g.retry.push({ a: q.a, b: q.b, due: g.asked + 2 });
  el.question.className = 'bad';
  showQuestion(q, true, true);
  el.heard.textContent = 'Splat! Remember that one.';
  releaseThreat();
  sfx.splat();
  updateHud();
  g.after = {
    t: 2.6,
    fn: () => {
      g.frog.flat = false;
      if (g.lives <= 0) return gameOver();
      g.mode = 'playing';
      askQuestion();
    },
  };
}

// ---------- hints ----------
// Each press shows the next hint for the question on screen (the last one
// stays). A hinted answer scores a little less.
function clearHint() {
  g.hints = 0;
  $('hint').hidden = true;
  $('hint').textContent = '';
}

function showHint() {
  if (g.mode !== 'playing') return;
  let hints;
  if (spellingMode() && bridgeScene()) {
    if (!bridge.ready()) return;
    hints = spellingHints(bridge.state.puzzle.right);
  } else if (g.q && g.q.spell) {
    hints = spellingHints(g.q.spell.right);
  } else {
    if (!g.q) return;
    hints = hintsFor(g.q, bridgeScene());
  }
  g.hints = Math.min(hints.length, g.hints + 1);
  $('hint').textContent = `💡 ${hints[g.hints - 1]}`;
  $('hint').hidden = false;
  if (!el.form.hidden && spellingMode()) el.input.focus();
}
$('hintBtn').addEventListener('click', showHint);

// Leaves the game in progress and shows the start screen again.
const MENU_MESSAGE = el.menuMsg.textContent;
function backToMenu() {
  g.mode = 'menu';
  g.q = null;
  g.after = null;
  g.cars = [];
  g.threat = null;
  g.frog = { row: 0, y: rowY(0), hop: null, flat: false };
  clearTimeout(settleTimer);
  pendingClip = null;
  voice.stop();
  bridge.state.phase = 'idle';
  bridge.state.planks = [];
  blocks.stop();
  $('backBtn').hidden = true;
  $('hintBtn').hidden = true;
  clearHint();
  $('judge').hidden = true;
  el.menuMsg.textContent = MENU_MESSAGE;
  el.result.hidden = true;
  el.startBtn.textContent = 'Play';
  el.menu.hidden = false;
  el.question.className = '';
  el.question.textContent = 'Ready?';
  el.heard.innerHTML = '&nbsp;';
  el.timerFill.style.width = '0';
  el.input.blur();
}
$('backBtn').addEventListener('click', backToMenu);

function gameOver() {
  g.mode = 'over';
  $('backBtn').hidden = true;
  $('hintBtn').hidden = true;
  clearHint();
  voice.stop(); // no game, no listening: closes the AssemblyAI session and the mic
  const isBest = g.score > best;
  if (isBest) {
    best = g.score;
    save('tth.best', best);
  }
  el.menuMsg.textContent = blockScene() ? 'No more room. Great building!' : 'Game over. Nice hopping!';
  el.result.hidden = false;
  el.result.textContent = `Score ${g.score}${isBest ? ' (new best!)' : ` · Best ${best}`}`;
  el.startBtn.textContent = 'Play again';
  el.menu.hidden = false;
  el.question.className = '';
  el.question.textContent = recordMode() ? `${savedClips} clips saved` : 'Game over';
  $('judge').hidden = true;
  if (recordMode()) el.menuMsg.textContent = `All done. ${savedClips} clips saved for ${speakerName()}.`;
  el.heard.innerHTML = '&nbsp;';
}

function updateHud() {
  el.score.textContent = g.score;
  el.level.textContent = g.level;
  const swaps = blockScene() && g.mode !== 'menu';
  el.lives.previousElementSibling.textContent = swaps ? 'Swaps' : 'Lives';
  el.lives.textContent = swaps
    ? '🔄'.repeat(Math.max(0, blocks.state.swaps)) || '–'
    : '❤'.repeat(Math.max(0, g.lives)) || '–';
}

function burst(x, y, n, colors) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = 60 + Math.random() * 220;
    g.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: 0.5 + Math.random() * 0.7, color: colors[i % colors.length] });
  }
}

// ---------- answers: voice + typing ----------
let voiceAvailable = false;
const micOk = () => Boolean(navigator.mediaDevices && window.AudioWorkletNode);
let defaultNote = '';
// The line under the Play button: what to say in the chosen game.
function showNote() {
  el.voiceNote.textContent = recordMode()
    ? 'Your child says each letter sound; you mark it right or not. Every clip is saved.'
    : spellingMode()
      ? 'For Year 4 and up. Find the misspelt word and type it correctly.'
    : useSounds()
    ? 'Say the sound the letter makes, like "sss" or "mmm".'
    : nativeBridge && settings.mode === 'letters'
      ? 'Say the name of the letter. Letter sounds are not recognised in the app yet.'
      : defaultNote;
}
// A spoken turn can still be in progress when the next question appears, so we
// remember how many of its words were already used and only judge the rest.
let lastTurn = -1;
let lastTurnWords = 0;
let staleTurn = -1;
let staleWords = 0;
let latestText = '';
let latestTexts = []; // the transcript, then the recogniser's other readings of it
let settleTimer = 0;

function markSpeechConsumed() {
  staleTurn = lastTurn;
  staleWords = lastTurnWords;
  latestText = '';
  latestTexts = [];
  if (voice.reset) voice.reset(); // iOS: fresh transcript per question
}

function onTurn(msg) {
  const words = Array.isArray(msg.words) && msg.words.length
    ? msg.words.map((w) => w.text)
    : String(msg.transcript || '').split(/\s+/).filter(Boolean);
  lastTurn = msg.turn_order;
  lastTurnWords = words.length;
  const stale = msg.turn_order === staleTurn;
  const text = (stale ? words.slice(staleWords) : words).join(' ');
  latestText = text;
  // Other readings (iOS only) cannot be trimmed word by word, so they are only
  // used for a turn that has not been judged yet.
  const others = !stale && Array.isArray(msg.alternatives) ? msg.alternatives : [];
  latestTexts = [text, ...others.filter((t) => t && t !== text)];
  if (!text.trim()) return;
  if (g.q || (blockScene() && blocks.ready())) el.heard.textContent = `🎤 “${text}”`;
  judge(latestTexts, Boolean(msg.end_of_turn));
}

// Numbers on screen as part of the question, which a child may read out
// before answering ("three times four is twelve").
function questionNumbers(q) {
  return q.plain ? [] : [q.a, q.b].filter((n) => typeof n === 'number');
}

function judge(texts, final, settled = false) {
  if (blockScene()) return judgeBlocks((Array.isArray(texts) ? texts : [texts]).filter(Boolean), final, settled);
  if (!g.q || g.mode !== 'playing' || g.frog.hop || (bridgeScene() && !bridge.ready())) return;
  texts = (Array.isArray(texts) ? texts : [texts]).filter(Boolean);
  if (!texts.length) return;
  if (g.q.accept) {
    if (texts.some((t) => matchesSpoken(t, g.q.accept))) correct();
    else if (final) {
      wrong(normalise(texts[0]).split(' ').pop());
      markSpeechConsumed();
    }
    return;
  }
  const { hit, guess, last } = judgeNumbers(texts, g.q.answer, questionNumbers(g.q));
  if (hit) {
    if (hit.open && !final && !settled) {
      // "fifty" might be about to become "fifty six": wait a beat.
      const id = g.q.id;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (g.q && g.q.id === id) judge(latestTexts, false, true);
      }, 450);
      return;
    }
    correct();
  } else if (final && (guess || last !== null)) {
    if (guess) oneAtATime();
    else wrong(last);
    // The next try starts from a clean transcript, so earlier wrong answers
    // neither count against it nor make it look like a run of guesses.
    markSpeechConsumed();
  }
}

// The block puzzle: the answer can belong to any block in the tray.
function judgeBlocks(texts, final, settled) {
  if (g.mode !== 'playing' || !blocks.ready() || !texts.length) return;
  if (texts.some((t) => matchesSpoken(t, SWAP_WORDS))) {
    blocks.swap();
    markSpeechConsumed();
    return;
  }
  const pieces = blocks.live();
  if (!pieces.length) return;
  let found = null;
  let wait = false;
  let guess = false;
  let last = null;
  if (pieces[0].q.accept) {
    found = pieces.find((p) => texts.some((t) => matchesSpoken(t, p.q.accept)));
    last = normalise(texts[0]).split(' ').pop();
  } else {
    const shown = pieces.flatMap((p) => questionNumbers(p.q));
    for (const p of pieces) {
      const r = judgeNumbers(texts, p.q.answer, shown);
      guess = guess || r.guess;
      last = r.last;
      if (!r.hit) continue;
      // "forty" might be about to become "forty-two", another block's answer.
      if (r.hit.open && !final && !settled) wait = true;
      else {
        found = p;
        break;
      }
    }
  }
  if (found) {
    blocks.answer(found.piece);
    markSpeechConsumed();
    return;
  }
  if (wait) {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (blockScene() && blocks.ready()) judge(latestTexts, false, true);
    }, 450);
    return;
  }
  if (!final || (!guess && (last === null || last === ''))) return;
  g.streak = 0;
  el.heard.textContent = guess ? 'One answer at a time!' : `I heard ${last}. No block has that answer.`;
  sfx.nope();
  markSpeechConsumed();
}

function oneAtATime() {
  if (bridgeScene()) {
    bridge.wrong('One answer at a time.');
    return;
  }
  el.heard.textContent = 'One answer at a time!';
  el.question.classList.remove('shake');
  void el.question.offsetWidth;
  el.question.classList.add('shake');
  sfx.nope();
}

// A letter sound ("sss", "buh") heard by the phoneme recogniser.
function onSound(res) {
  if (!g.q || !g.q.accept || g.mode !== 'playing' || g.frog.hop) return;
  if (res.startedAt < g.q.shownAt) return; // said before this letter appeared
  const heard = (res.phonemes || []).join(' ');
  if (!heard) return;
  el.heard.textContent = `🎤 /${heard}/`;
  if (soundMatches(res.letters, g.q.answer)) correct();
  else wrong(`/${heard}/`);
}

// ---------- recording mode: the grown-up is the judge ----------
let pendingClip = null; // { clips, sound } waiting for a verdict
let savedClips = 0;

function showJudge(waiting) {
  $('judge').hidden = !recordMode() || g.mode === 'menu' || g.mode === 'over';
  $('judge').classList.toggle('waiting', waiting);
  const heard = pendingClip ? pendingClip.clips.length : 0;
  $('judgeText').textContent = waiting ? `Listening… (${savedClips} saved)` : heard > 1 ? `Was that right? (${heard} sounds)` : 'Was that right?';
  for (const id of ['judgeRight', 'judgeWrong', 'judgeIgnore']) $(id).disabled = waiting;
}

// Called with each burst of sound from the microphone. Returns true when the
// clip was taken for recording (so it is not sent to the recogniser).
function onClip(chunks, startedAt) {
  if (!recordMode()) return false;
  if (!g.q || g.mode !== 'playing' || g.frog.hop || startedAt < g.q.shownAt) return true;
  // She may say the sound a few times before it is judged: keep every one,
  // and the verdict applies to them all.
  if (pendingClip && pendingClip.sound === g.q.text) {
    if (pendingClip.clips.length < 8) pendingClip.clips.push(new Blob(chunks));
  } else {
    pendingClip = { clips: [new Blob(chunks)], sound: g.q.text };
  }
  el.heard.textContent = pendingClip.clips.length > 1 ? `🎤 Heard ${pendingClip.clips.length} sounds` : '🎤 Heard a sound';
  showJudge(false);
  return true;
}

async function judgeClip(verdict) {
  if (!pendingClip) return;
  const { clips, sound } = pendingClip;
  pendingClip = null;
  if (verdict !== 'ignore') {
    try {
      const query = `speaker=${encodeURIComponent(speakerName())}&sound=${sound}&label=${verdict}`;
      for (const body of clips) {
        const r = await fetch(`/api/training?${query}`, { method: 'POST', body });
        if (!r.ok) throw new Error((await r.json()).error || r.status);
        savedClips++;
      }
    } catch (err) {
      el.heard.textContent = `Could not save that clip (${err.message}).`;
      showJudge(true);
      return;
    }
  }
  showJudge(true);
  if (verdict === 'right' && g.q && g.q.text === sound && g.mode === 'playing' && !g.frog.hop) {
    correct();
  } else if (verdict === 'wrong') {
    el.heard.textContent = 'Nearly! Try that one again.';
    el.question.classList.remove('shake');
    void el.question.offsetWidth;
    el.question.classList.add('shake');
    sfx.nope();
  } else if (verdict === 'ignore') {
    el.heard.innerHTML = '&nbsp;';
  }
}

$('judgeRight').addEventListener('click', () => judgeClip('right'));
$('judgeWrong').addEventListener('click', () => judgeClip('wrong'));
$('judgeIgnore').addEventListener('click', () => judgeClip('ignore'));
$('judgeFinish').addEventListener('click', () => {
  pendingClip = null;
  gameOver();
});
document.addEventListener('keydown', (e) => {
  if (!recordMode() || !pendingClip || e.target === el.input || e.target === $('speakerName')) return;
  const verdict = { ArrowRight: 'right', Enter: 'right', ArrowLeft: 'wrong', Backspace: 'wrong', ArrowDown: 'ignore', Escape: 'ignore' }[e.key];
  if (!verdict) return;
  e.preventDefault();
  judgeClip(verdict);
});

const voiceHandlers = {
  onTurn,
  onSound,
  onClip,
  onLevel: (level) => {
    el.micDot.style.transform = `scale(${1 + Math.min(1.2, level * 12)})`;
  },
  onState: (state, detail) => {
    el.mic.className = `mic ${state}`;
    const labels = { off: 'Mic off', connecting: 'Connecting…', listening: 'Listening', error: 'Mic problem' };
    el.micText.textContent = labels[state] || state;
    if (state === 'error') {
      el.heard.textContent =
        detail === 'mic_denied'
          ? 'Microphone is blocked. Type your answers instead.'
          : detail === 'no_mic'
            ? 'No microphone found on this computer. Type your answers instead.'
            : 'Voice is not working right now. Type your answers instead.';
      console.warn('voice error:', detail);
    }
  },
};
// Words and numbers go to speech-to-text. On the web, letter sounds go to the
// phoneme recogniser instead, when the server has one running.
const speechVoice = new (nativeBridge ? NativeVoiceInput : VoiceInput)(voiceHandlers);
const soundVoice = nativeBridge ? null : new PhonemeVoiceInput(voiceHandlers);
let voice = speechVoice;
let phonemesAvailable = false;
const useSounds = () => soundVoice !== null && (recordMode() ? micOk() : settings.mode === 'letters' && phonemesAvailable);

function chooseVoice() {
  const want = useSounds() ? soundVoice : speechVoice;
  if (want !== voice) {
    voice.stop();
    voice = want;
  }
  return voice === soundVoice || voiceAvailable;
}

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = el.input.value.trim();
  el.input.value = '';
  if (blockScene()) {
    if (!v || g.mode !== 'playing' || !blocks.ready()) return;
    if (/^swap$/i.test(v)) return void blocks.swap();
    const p = blocks.live().find((b) => (b.q.accept ? normalise(v) === b.q.answer : Number(v) === b.q.answer));
    if (p) blocks.answer(p.piece);
    else {
      el.heard.textContent = `No block has ${v}.`;
      sfx.nope();
    }
    return;
  }
  if (spellingMode() && bridgeScene()) {
    const typed = tidy(v);
    if (g.mode !== 'playing' || !bridge.ready() || !typed) return;
    const puzzle = bridge.state.puzzle;
    if (typed === puzzle.right.toLowerCase()) bridge.right();
    else bridge.wrong(typed === puzzle.wrong.toLowerCase() ? 'That is how the broken plank spells it.' : 'Not quite.');
    return;
  }
  if (!v || !g.q || g.mode !== 'playing' || g.frog.hop || (bridgeScene() && !bridge.ready())) return;
  if (g.q.accept ? normalise(v) === g.q.answer : Number(v) === g.q.answer) correct();
  else wrong(v);
});

el.startBtn.addEventListener('click', () => {
  save('tth.settings', settings);
  if (!audio && !nativeBridge) {
    try {
      audio = new (window.AudioContext || window.webkitAudioContext)();
    } catch {}
  }
  if (spellingMode()) voice.stop();
  const canListen = !spellingMode() && chooseVoice();
  if (canListen && !voice.active) voice.start(hints());
  else if (!canListen) el.input.focus();
  startGame();
});

// Also stop listening while the tab is hidden mid-game (the game is frozen
// then anyway) and pick it back up when the player returns.
let pausedByHide = false;
document.addEventListener('visibilitychange', () => {
  const inGame = g.mode === 'playing' || g.mode === 'hit' || g.mode === 'win';
  if (document.hidden) {
    if (voice.active) {
      pausedByHide = true;
      voice.stop();
    }
  } else if (pausedByHide) {
    pausedByHide = false;
    if (inGame && !spellingMode() && chooseVoice()) voice.start(hints());
  }
});

(nativeBridge ? Promise.resolve({ voice: true, native: true }) : fetch('/api/status').then((r) => r.json()))
  .then((s) => {
    const micOk = Boolean(navigator.mediaDevices && window.AudioWorkletNode);
    voiceAvailable = Boolean(s.native) || (Boolean(s.voice) && micOk);
    phonemesAvailable = Boolean(s.phonemes) && micOk;
    defaultNote = voiceAvailable
      ? 'Uses your microphone. Say the answer nice and clearly!'
      : s.voice
        ? 'This browser cannot use the microphone here. Type answers instead.'
        : 'Voice is not set up yet (no AssemblyAI key on the server). Type answers for now.';
    showNote();
  })
  .catch(() => {
    defaultNote = 'Cannot reach the server. Type answers for now.';
    showNote();
  });

// ---------- update ----------
function update(dt) {
  if (bridgeScene()) return bridge.update(dt);
  if (blockScene()) return blocks.update(dt);
  if (g.after) {
    g.after.t -= dt;
    if (g.after.t <= 0) {
      const fn = g.after.fn;
      g.after = null;
      fn();
    }
  }

  const hop = g.frog.hop;
  if (hop) {
    hop.t += dt / 0.22;
    if (hop.t >= 1) land();
    else g.frog.y = hop.from + (hop.to - hop.from) * hop.t;
  }

  for (const car of g.cars) {
    car.x += car.dir * car.speed * dt;
    if (car === g.threat && g.mode === 'playing' && !g.frog.hop) {
      car.t += dt;
      const front = car.x + (car.dir * car.w) / 2;
      if (car.dir * (front - car.hitFront) >= 0) runOver();
    }
  }
  g.cars = g.cars.filter((c) => c.x > -300 && c.x < W + 300);

  for (const p of g.particles) {
    p.life -= dt;
    p.vy += 500 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  g.particles = g.particles.filter((p) => p.life > 0);

  const left = g.threat ? Math.max(0, 1 - g.threat.t / g.threat.limit) : 0;
  el.timerFill.style.width = `${left * 100}%`;
  el.timerFill.classList.toggle('low', left < 0.35);
}

// ---------- drawing ----------
function drawWorld() {
  // far bank: pond with a lily pad to aim for
  ctx.fillStyle = '#2b7fc4';
  ctx.fillRect(0, 0, W, ROW_H);
  ctx.strokeStyle = 'rgba(255,255,255,.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    const x = 50 + i * 115;
    const y = 22 + ((i * 37) % 40);
    ctx.beginPath();
    ctx.arc(x, y, 14, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }
  ctx.fillStyle = '#58b368';
  ctx.beginPath();
  ctx.moveTo(FROG_X, rowY(GOAL_ROW));
  ctx.arc(FROG_X, rowY(GOAL_ROW), 36, 0.35, Math.PI * 2 - 0.1);
  ctx.closePath();
  ctx.fill();

  // road
  ctx.fillStyle = '#474b55';
  ctx.fillRect(0, ROW_H, W, ROW_H * LANES);
  ctx.strokeStyle = 'rgba(255,255,255,.55)';
  ctx.lineWidth = 3;
  ctx.setLineDash([26, 22]);
  for (let i = 1; i < LANES; i++) {
    ctx.beginPath();
    ctx.moveTo(0, ROW_H * (1 + i));
    ctx.lineTo(W, ROW_H * (1 + i));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = '#d9d2c0';
  ctx.fillRect(0, ROW_H - 4, W, 8);
  ctx.fillRect(0, ROW_H * (LANES + 1) - 4, W, 8);

  // near bank: grass
  ctx.fillStyle = '#3f9b4f';
  ctx.fillRect(0, ROW_H * (LANES + 1) + 4, W, ROW_H);
  ctx.strokeStyle = '#2f7d3d';
  ctx.lineWidth = 2;
  for (let i = 0; i < 16; i++) {
    const x = 20 + i * 51;
    const y = H - 18 - ((i * 29) % 44);
    ctx.beginPath();
    ctx.moveTo(x - 5, y);
    ctx.lineTo(x, y - 9);
    ctx.lineTo(x + 5, y);
    ctx.stroke();
  }
}

function drawCar(car) {
  const y = rowY(car.row);
  const h = ROW_H * 0.56;
  ctx.save();
  ctx.translate(car.x, y);
  ctx.scale(car.dir, 1); // draw facing right, flip for leftward traffic
  ctx.fillStyle = '#1c1c1c';
  for (const wx of [-car.w * 0.3, car.w * 0.3]) {
    ctx.fillRect(wx - 11, -h / 2 - 4, 22, 8);
    ctx.fillRect(wx - 11, h / 2 - 4, 22, 8);
  }
  ctx.fillStyle = car.color;
  ctx.beginPath();
  ctx.roundRect(-car.w / 2, -h / 2, car.w, h, 12);
  ctx.fill();
  if (car.truck) {
    ctx.fillStyle = 'rgba(255,255,255,.28)';
    ctx.fillRect(-car.w / 2 + 8, -h / 2 + 6, car.w * 0.6, h - 12);
  }
  ctx.fillStyle = '#bfe6ff';
  ctx.beginPath();
  ctx.roundRect(car.w / 2 - 38, -h / 2 + 6, 16, h - 12, 4);
  ctx.fill();
  ctx.fillStyle = '#fff6b0';
  ctx.fillRect(car.w / 2 - 5, -h / 2 + 5, 5, 8);
  ctx.fillRect(car.w / 2 - 5, h / 2 - 13, 5, 8);
  ctx.restore();
}

function drawFrog() {
  const f = g.frog;
  drawFrogAt(FROG_X, f.y, f.hop ? Math.sin(Math.PI * Math.min(1, f.hop.t)) : 0, f.flat);
}

function drawFrogAt(x, y, lift, flat) {
  const f = { y, flat };
  ctx.save();
  ctx.translate(x, y);
  if (f.flat) ctx.scale(1.35, 0.45);
  else ctx.scale(1 + lift * 0.3, 1 + lift * 0.3);

  ctx.fillStyle = '#2e8b3d';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(sx * 21, 13, 10, 7, sx * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(sx * 19, -8, 7, 5, -sx * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#4fc15f';
  ctx.beginPath();
  ctx.ellipse(0, 0, 22, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c9f2b0';
  ctx.beginPath();
  ctx.ellipse(0, 6, 13, 10, 0, 0, Math.PI * 2);
  ctx.fill();

  for (const sx of [-1, 1]) {
    ctx.fillStyle = '#4fc15f';
    ctx.beginPath();
    ctx.arc(sx * 11, -16, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(sx * 11, -17, 6, 0, Math.PI * 2);
    ctx.fill();
    if (f.flat) {
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx * 11 - 3, -20);
      ctx.lineTo(sx * 11 + 3, -14);
      ctx.moveTo(sx * 11 + 3, -20);
      ctx.lineTo(sx * 11 - 3, -14);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#222';
      ctx.beginPath();
      ctx.arc(sx * 11, -18, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = '#1f6b2c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (f.flat) ctx.arc(0, 4, 7, Math.PI * 1.15, Math.PI * 1.85);
  else ctx.arc(0, -6, 8, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  ctx.restore();

  // danger warning
  if (g.threat && g.mode === 'playing' && g.threat.t / g.threat.limit > 0.65 && Math.floor(performance.now() / 150) % 2) {
    ctx.fillStyle = '#d7263d';
    ctx.font = 'bold 34px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', x, f.y - 34);
  }
}

function draw() {
  if (bridgeScene()) return bridge.draw();
  if (blockScene() && g.mode !== 'menu') return blocks.draw();
  drawWorld();
  if (g.frog.flat) drawFrog();
  g.cars.forEach(drawCar);
  if (!g.frog.flat) drawFrog();
  for (const p of g.particles) {
    ctx.globalAlpha = Math.min(1, p.life * 2);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
  }
  ctx.globalAlpha = 1;
}

const spellingPuzzles = createSpellingPuzzles(el);
const bridge = createBridgeGame({
  W, H, ctx, g, el, drawFrogAt, updateHud, gameOver, sfx,
  // Three wrong answers: the answer is shown, and the question comes back later.
  onReveal: (puzzle) => {
    if (spellingMode()) {
      spellingPuzzles.forget(puzzle.source);
    } else if (g.q) {
      g.retry.push({ a: g.q.a, b: g.q.b, due: g.asked + 2 });
      g.q = null;
    }
  },
  // The frog has climbed out after a wrong answer: listen afresh.
  onResume: () => {
    if (!g.q) return;
    g.q.shownAt = performance.now();
    markSpeechConsumed();
  },
});

// Block puzzle: a question for a new block, with an answer no other block in
// the tray already has.
function blockQuestion(taken) {
  let q;
  for (let i = 0; i < 25; i++) {
    q = pickQuestion();
    if (!taken.includes(q.answer)) break;
  }
  q.shownAt = performance.now();
  return q;
}
const blocks = createBlockGame({
  W, H, ctx, g, el, updateHud, gameOver, sfx,
  makeQuestion: blockQuestion,
  // The tray changed: listen afresh, so speech meant for an old block does
  // not count for a new one.
  onChange: () => markSpeechConsumed(),
});
canvas.addEventListener('pointerdown', (e) => {
  if (!blockScene() || g.mode !== 'playing') return;
  const r = canvas.getBoundingClientRect();
  const hit = blocks.hitTest(((e.clientX - r.left) * W) / r.width, ((e.clientY - r.top) * H) / r.height);
  if (hit === 'swap') blocks.swap();
  else if (hit === 'tray' && blocks.ready()) el.heard.textContent = 'Say the answer on a block to place it.';
});

let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000);
  prev = now;
  if (g.mode !== 'menu' && g.mode !== 'over') update(dt);
  draw();
  requestAnimationFrame(frame);
}
updateHud();
requestAnimationFrame(frame);

// Handy for testing without a microphone: __hop.hear('fifty six')
window.__hop = { hear: (text) => judge([text], true), step: update, state: g, bridge, blocks };
