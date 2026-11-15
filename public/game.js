import { extractNumbers } from './numbers.js';
import { isReadingMode, items, accepted, vocabulary, matchesSpoken, normalise } from './reading.js';
import { VoiceInput, NativeVoiceInput, nativeBridge } from './voice.js';

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
if (!['tables', 'numbers', 'letters', 'words'].includes(settings.mode)) settings.mode = 'tables';
const numbersMode = () => settings.mode === 'numbers';
const readingMode = () => isReadingMode(settings.mode);
const tablesMode = () => settings.mode === 'tables';
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
let best = load('tth.best', 0);

for (let n = 1; n <= 12; n++) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = n;
  b.dataset.table = n;
  el.tables.appendChild(b);
}
function renderChips() {
  el.tables.querySelectorAll('button').forEach((b) => b.classList.toggle('on', settings.tables.includes(+b.dataset.table)));
  el.speeds.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.speed === settings.speed));
  el.modes.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === settings.mode));
  el.tablesSection.hidden = !tablesMode();
  el.startBtn.disabled = tablesMode() && settings.tables.length === 0;
}
el.modes.addEventListener('click', (e) => {
  if (!e.target.dataset.mode) return;
  settings.mode = e.target.dataset.mode;
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
  const all = items(settings.mode);
  let item;
  const due = g.retry.findIndex((r) => r.due <= g.asked);
  if (due >= 0) item = g.retry.splice(due, 1)[0].a;
  else do item = all[Math.floor(Math.random() * all.length)]; while (item === g.lastKey);
  g.lastKey = item;
  return { a: item, b: 1, answer: item, accept: accepted(settings.mode, item), text: item, plain: true, id: ++qid };
}

function pickQuestion() {
  if (numbersMode()) return pickNumber();
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
  g.q = pickQuestion();
  markSpeechConsumed();
  el.question.className = '';
  el.question.textContent = label(g.q, false);
  el.heard.innerHTML = '&nbsp;';
  if (g.frog.row >= 1 && g.frog.row <= LANES) spawnThreat();
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

function startGame() {
  Object.assign(g, { mode: 'playing', score: 0, lives: 3, level: 1, streak: 0, asked: 0, cars: [], threat: null, particles: [], retry: [], after: null, lastKey: '' });
  g.frog = { row: 0, y: rowY(0), hop: null, flat: false };
  el.menu.hidden = true;
  // The typing fallback takes letters in the reading games, digits otherwise.
  el.input.inputMode = readingMode() ? 'text' : 'numeric';
  if (readingMode()) el.input.removeAttribute('pattern');
  else el.input.setAttribute('pattern', '[0-9]*');
  el.input.autocapitalize = 'off';
  updateHud();
  askQuestion();
}

function correct() {
  const q = g.q;
  g.q = null;
  clearTimeout(settleTimer);
  g.streak++;
  const left = g.threat ? Math.max(0, 1 - g.threat.t / g.threat.limit) : 0.5;
  g.score += 10 + Math.round(left * 10) + Math.min(g.streak - 1, 5) * 2;
  el.question.className = 'good';
  el.question.textContent = label(q, true);
  releaseThreat();
  g.frog.hop = { from: g.frog.y, to: rowY(g.frog.row + 1), t: 0 };
  burst(FROG_X, g.frog.y, 10, ['#fff', '#ffe066']);
  sfx.hop();
  updateHud();
}

function wrong(value) {
  el.heard.textContent = `I heard ${value}. Try again!`;
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
  el.question.textContent = label(q, true);
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

function gameOver() {
  g.mode = 'over';
  voice.stop(); // no game, no listening: closes the AssemblyAI session and the mic
  const isBest = g.score > best;
  if (isBest) {
    best = g.score;
    save('tth.best', best);
  }
  el.menuMsg.textContent = 'Game over. Nice hopping!';
  el.result.hidden = false;
  el.result.textContent = `Score ${g.score}${isBest ? ' (new best!)' : ` · Best ${best}`}`;
  el.startBtn.textContent = 'Play again';
  el.menu.hidden = false;
  el.question.className = '';
  el.question.textContent = 'Game over';
  el.heard.innerHTML = '&nbsp;';
}

function updateHud() {
  el.score.textContent = g.score;
  el.level.textContent = g.level;
  el.lives.textContent = '❤'.repeat(Math.max(0, g.lives)) || '–';
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
// A spoken turn can still be in progress when the next question appears, so we
// remember how many of its words were already used and only judge the rest.
let lastTurn = -1;
let lastTurnWords = 0;
let staleTurn = -1;
let staleWords = 0;
let latestText = '';
let settleTimer = 0;

function markSpeechConsumed() {
  staleTurn = lastTurn;
  staleWords = lastTurnWords;
  latestText = '';
  if (voice.reset) voice.reset(); // iOS: fresh transcript per question
}

function onTurn(msg) {
  const words = Array.isArray(msg.words) && msg.words.length
    ? msg.words.map((w) => w.text)
    : String(msg.transcript || '').split(/\s+/).filter(Boolean);
  lastTurn = msg.turn_order;
  lastTurnWords = words.length;
  const text = (msg.turn_order === staleTurn ? words.slice(staleWords) : words).join(' ');
  latestText = text;
  if (!text.trim()) return;
  if (g.q) el.heard.textContent = `🎤 “${text}”`;
  judge(text, Boolean(msg.end_of_turn));
}

function judge(text, final, settled = false) {
  if (!g.q || g.mode !== 'playing' || g.frog.hop) return;
  if (g.q.accept) {
    if (matchesSpoken(text, g.q.accept)) correct();
    else if (final) wrong(normalise(text).split(' ').pop());
    return;
  }
  const nums = extractNumbers(text);
  const hit = nums.find((n) => n.value === g.q.answer);
  if (hit) {
    if (hit.open && !final && !settled) {
      // "fifty" might be about to become "fifty six": wait a beat.
      const id = g.q.id;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (g.q && g.q.id === id) judge(latestText, false, true);
      }, 450);
      return;
    }
    correct();
  } else if (final && nums.length) {
    wrong(nums[nums.length - 1].value);
  }
}

const voice = new (nativeBridge ? NativeVoiceInput : VoiceInput)({
  onTurn,
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
});

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = el.input.value.trim();
  el.input.value = '';
  if (!v || !g.q || g.mode !== 'playing' || g.frog.hop) return;
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
  if (voiceAvailable && !voice.active) voice.start(vocabulary(settings.mode));
  else if (!voiceAvailable) el.input.focus();
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
    if (inGame && voiceAvailable) voice.start(vocabulary(settings.mode));
  }
});

(nativeBridge ? Promise.resolve({ voice: true, native: true }) : fetch('/api/status').then((r) => r.json()))
  .then((s) => {
    voiceAvailable = Boolean(s.native) || (Boolean(s.voice) && Boolean(navigator.mediaDevices && window.AudioWorkletNode));
    el.voiceNote.textContent = voiceAvailable
      ? 'Uses your microphone. Say the answer nice and clearly!'
      : s.voice
        ? 'This browser cannot use the microphone here. Type answers instead.'
        : 'Voice is not set up yet (no AssemblyAI key on the server). Type answers for now.';
  })
  .catch(() => {
    el.voiceNote.textContent = 'Cannot reach the server. Type answers for now.';
  });

// ---------- update ----------
function update(dt) {
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
  const lift = f.hop ? Math.sin(Math.PI * Math.min(1, f.hop.t)) : 0;
  ctx.save();
  ctx.translate(FROG_X, f.y);
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
    ctx.fillText('!', FROG_X, f.y - 34);
  }
}

function draw() {
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
window.__hop = { hear: (text) => judge(text, true), step: update, state: g };
