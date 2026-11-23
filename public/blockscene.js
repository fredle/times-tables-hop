// The block puzzle scene. An 8x8 board, and a tray of three blocks, each with
// a question on it. Saying a block's answer places it on the board where it
// fits best; full rows and columns clear. There is no timer: the game ends
// when no block in the tray fits and there are no swaps left. A swap (say
// "swap" or tap the button) deals a new tray.
//
// The game (game.js) owns the questions and the judging of what was said;
// this file owns the board, the tray and the drawing.

import { SIZE, emptyBoard, place, bestPlacement, fitsSomewhere, pickShapes, points } from './blocks.js';

const FONT = '"Playpen Sans", "Trebuchet MS", "Segoe UI", sans-serif';
const TRAY = 3;
const SWAPS = 3;
const FLY = 0.32; // seconds for a block to fly from the tray to the board
const FLASH = 0.4; // seconds a cleared line takes to fade
const PRAISE = ['Nice!', 'Good one!', 'Great!', 'Well done!', 'Yes!'];

export function createBlockGame({ W, H, ctx, g, el, updateHud, gameOver, sfx, makeQuestion, onChange }) {
  const portrait = H > W;
  const cell = Math.floor(Math.min((W - 40) / SIZE, (portrait ? H * 0.66 : H - 40) / SIZE));
  const boardX = portrait ? Math.round((W - cell * SIZE) / 2) : 20;
  const boardY = portrait ? 16 : Math.round((H - cell * SIZE) / 2);
  const boardRight = boardX + cell * SIZE;
  const boardBottom = boardY + cell * SIZE;

  // The tray: three slots under the board on a tall screen, beside it on a wide one.
  const swapBtn = portrait
    ? { x: W / 2 - 70, y: H - 46, w: 140, h: 38 }
    : { x: boardRight + (W - boardRight) / 2 - 70, y: H - 50, w: 140, h: 38 };
  const slots = Array.from({ length: TRAY }, (_, i) => {
    if (portrait) {
      const top = boardBottom + 12;
      const w = W / TRAY;
      return { x: i * w, y: top, w, h: swapBtn.y - top - 8 };
    }
    const left = boardRight + 16;
    const h = (swapBtn.y - 16) / TRAY;
    return { x: left, y: 8 + i * h, w: W - left - 8, h };
  });

  const s = {
    phase: 'idle', // play | busy | idle
    board: emptyBoard(),
    tray: [], // { shape, q, used }
    swaps: SWAPS,
    answered: 0,
    fly: null, // { piece, from:{x,y,size}, to:{row,col}, t, lines }
    flashes: [], // { y, x, colour, t }
    particles: [],
    after: null, // { t, fn }
  };

  function deal() {
    const shapes = pickShapes(s.board, TRAY);
    const answers = [];
    s.tray = shapes.map((shape) => {
      const q = makeQuestion(answers);
      answers.push(q.answer);
      return { shape, q, used: false };
    });
    onChange();
  }

  function start() {
    s.board = emptyBoard();
    s.swaps = SWAPS;
    s.answered = 0;
    s.fly = null;
    s.flashes = [];
    s.particles = [];
    s.after = null;
    s.phase = 'play';
    deal();
    prompt();
  }

  function stop() {
    s.phase = 'idle';
    s.tray = [];
    s.fly = null;
    s.after = null;
  }

  function prompt() {
    el.question.className = '';
    el.question.textContent = 'Pick a block!';
    el.heard.textContent = 'Say the answer on a block to place it.';
  }

  const ready = () => s.phase === 'play';
  /** Blocks still in the tray, with whether each fits on the board. */
  const live = () => s.tray.filter((p) => !p.used).map((p) => ({ ...p, fits: fitsSomewhere(s.board, p.shape), piece: p }));

  // Where a tray block is drawn: its cell size and top-left corner.
  function trayLayout(i) {
    const slot = slots[i];
    const shape = s.tray[i].shape;
    const labelH = 54;
    const size = Math.min(36, (slot.w - 24) / 4, (slot.h - labelH - 16) / 4);
    const x = slot.x + (slot.w - shape.cols * size) / 2;
    const y = slot.y + 6 + (slot.h - labelH - 6 - shape.rows * size) / 2;
    return { x, y, size, labelY: slot.y + slot.h - labelH / 2 - 2 };
  }

  /**
   * The child gave this block's answer. Places it, or says it cannot fit.
   * @returns {'placed'|'nofit'|'busy'}
   */
  function answer(piece) {
    if (!ready()) return 'busy';
    const spot = bestPlacement(s.board, piece.shape);
    if (!spot) {
      el.heard.textContent = 'Right! But that block will not fit. Try another one.';
      sfx.nope();
      return 'nofit';
    }
    const i = s.tray.indexOf(piece);
    const from = trayLayout(i);
    piece.used = true;
    s.phase = 'busy';
    s.fly = { piece, from, to: spot, t: 0 };
    sfx.hop();
    onChange();
    return 'placed';
  }

  function land() {
    const { piece, to } = s.fly;
    s.fly = null;
    const before = s.board.map((row) => row.slice());
    const result = place(s.board, piece.shape, to.row, to.col);
    const lines = result.rows.length + result.cols.length;
    for (const y of result.rows) for (let x = 0; x < SIZE; x++) s.flashes.push({ y, x, colour: before[y][x] || piece.shape.colour, t: 0 });
    for (const x of result.cols) for (let y = 0; y < SIZE; y++) s.flashes.push({ y, x, colour: before[y][x] || piece.shape.colour, t: 0 });
    s.answered++;
    g.streak++;
    g.level = 1 + Math.floor(s.answered / 10);
    g.score += 10 + points(piece.shape.cells.length, lines) + Math.min(g.streak - 1, 5) * 2 - Math.min(8, (g.hints || 0) * 4);
    if (!lines) el.heard.textContent = PRAISE[s.answered % PRAISE.length];
    else {
      sfx.win();
      el.heard.textContent = lines > 1 ? `${lines} lines! Brilliant!` : 'Line cleared!';
      for (const f of s.flashes) burst(boardX + (f.x + 0.5) * cell, boardY + (f.y + 0.5) * cell, 2, [f.colour, '#fff']);
    }
    updateHud();
    if (s.tray.every((p) => p.used)) deal();
    afterMove();
  }

  // Carry on, deal a new tray when nothing fits, or end the game.
  function afterMove() {
    if (live().some((p) => p.fits)) {
      s.phase = 'play';
      onChange();
      return;
    }
    s.phase = 'busy';
    if (s.swaps > 0) {
      el.heard.textContent = 'No room for those! Here are new blocks.';
      s.after = { t: 1.2, fn: () => { s.swaps--; updateHud(); deal(); afterMove(); } };
    } else {
      el.question.className = 'bad';
      el.question.textContent = 'No more room!';
      sfx.splat();
      s.after = { t: 1.6, fn: () => { s.phase = 'idle'; gameOver(); } };
    }
  }

  /** Deals a new tray if a swap is left. */
  function swap() {
    if (!ready()) return false;
    if (s.swaps <= 0) {
      el.heard.textContent = 'No swaps left.';
      sfx.nope();
      return false;
    }
    s.swaps--;
    g.streak = 0;
    el.heard.textContent = 'New blocks!';
    updateHud();
    deal();
    afterMove();
    return true;
  }

  /** What is under a tap on the canvas, in canvas pixels. */
  function hitTest(x, y) {
    const b = swapBtn;
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return 'swap';
    if (slots.some((sl) => x >= sl.x && x <= sl.x + sl.w && y >= sl.y && y <= sl.y + sl.h)) return 'tray';
    return null;
  }

  function burst(x, y, n, colours) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * 200;
      s.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.5 + Math.random() * 0.5, colour: colours[i % colours.length] });
    }
  }

  function update(dt) {
    if (s.fly) {
      s.fly.t += dt;
      if (s.fly.t >= FLY) land();
    }
    for (const f of s.flashes) f.t += dt;
    s.flashes = s.flashes.filter((f) => f.t < FLASH);
    for (const p of s.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 500 * dt;
      p.life -= dt;
    }
    s.particles = s.particles.filter((p) => p.life > 0);
    if (s.after) {
      s.after.t -= dt;
      if (s.after.t <= 0) {
        const fn = s.after.fn;
        s.after = null;
        fn();
      }
    }
  }

  // ---------- drawing ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function block(x, y, size, colour) {
    const pad = Math.max(1, size * 0.06);
    roundRect(x + pad, y + pad, size - 2 * pad, size - 2 * pad, size * 0.18);
    ctx.fillStyle = colour;
    ctx.fill();
    // A lighter top edge so blocks look like blocks.
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    roundRect(x + pad * 2, y + pad * 2, size - 4 * pad, size * 0.22, size * 0.1);
    ctx.fill();
  }

  function drawShape(shape, x, y, size, alpha = 1) {
    ctx.globalAlpha = alpha;
    for (const [r, c] of shape.cells) block(x + c * size, y + r * size, size, shape.colour);
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.fillStyle = '#20263a';
    ctx.fillRect(0, 0, W, H);

    // Board
    roundRect(boardX - 8, boardY - 8, cell * SIZE + 16, cell * SIZE + 16, 14);
    ctx.fillStyle = '#151a2a';
    ctx.fill();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const colour = s.board[y][x];
        if (colour) block(boardX + x * cell, boardY + y * cell, cell, colour);
        else {
          ctx.fillStyle = '#262d44';
          roundRect(boardX + x * cell + 2, boardY + y * cell + 2, cell - 4, cell - 4, 6);
          ctx.fill();
        }
      }
    }
    for (const f of s.flashes) {
      const k = 1 - f.t / FLASH;
      const grow = (1 - k) * cell * 0.3;
      ctx.globalAlpha = k;
      block(boardX + f.x * cell - grow / 2, boardY + f.y * cell - grow / 2, cell + grow, '#fff');
      ctx.globalAlpha = 1;
    }

    // Tray
    s.tray.forEach((p, i) => {
      if (p.used) return;
      const at = trayLayout(i);
      const fits = fitsSomewhere(s.board, p.shape);
      drawShape(p.shape, at.x, at.y, at.size, fits ? 1 : 0.3);
      const slot = slots[i];
      const text = String(p.q.text);
      ctx.font = `bold ${text.length > 5 ? 27 : 33}px ${FONT}`;
      const w = Math.min(slot.w - 8, ctx.measureText(text).width + 28);
      roundRect(slot.x + (slot.w - w) / 2, at.labelY - 23, w, 46, 23);
      ctx.fillStyle = fits ? '#fff' : 'rgba(255,255,255,0.35)';
      ctx.fill();
      ctx.fillStyle = '#20263a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, slot.x + slot.w / 2, at.labelY + 1);
    });

    // The block on its way to the board
    if (s.fly) {
      const { piece, from, to, t } = s.fly;
      const k = Math.min(1, t / FLY);
      const e = k * k * (3 - 2 * k);
      const size = from.size + (cell - from.size) * e;
      const x = from.x + (boardX + to.col * cell - from.x) * e;
      const y = from.y + (boardY + to.row * cell - from.y) * e - Math.sin(e * Math.PI) * 40;
      drawShape(piece.shape, x, y, size);
    }

    // Swap button
    const b = swapBtn;
    roundRect(b.x, b.y, b.w, b.h, b.h / 2);
    ctx.fillStyle = s.swaps > 0 && ready() ? '#ffbe0b' : 'rgba(255,190,11,0.3)';
    ctx.fill();
    ctx.fillStyle = '#20263a';
    ctx.font = `bold 20px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`🔄 Swap (${s.swaps})`, b.x + b.w / 2, b.y + b.h / 2 + 1);

    for (const p of s.particles) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.colour;
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'alphabetic';
  }

  return { state: s, start, stop, ready, live, answer, swap, hitTest, update, draw, prompt };
}
