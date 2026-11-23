// The bridge scene: a rope bridge over a river, one item per plank, read from
// top to bottom. One plank is broken. A right answer mends it and the frog
// crosses; a wrong answer sends the frog onto the broken plank and into the
// water. Used by Spelling Bridge and by the bridge versions of Numbers,
// What comes next? and Times tables.
//
// A puzzle is a plain object:
//   items        what each plank shows: { text } or { colour: cssColour }
//   brokenIndex  which plank is broken
//   broken       what the broken plank shows, e.g. { text: 'libary' } or { text: '?' }
//   mended       what it shows once mended: { text } or { colour }
//   prompt       line shown under the question when the puzzle appears
//   show(state)  put the question in the bar: 'ask' | 'right' | 'revealed'
//   hint(tries)  extra help after a wrong answer (or '')
//   reveal       line shown when the answer is given away

const TRIES = 3; // wrong answers before the answer is shown and a life is lost
const BONUS_SECONDS = 30; // quicker answers score more; running out costs nothing
const WOOD = '#c08a4f';
const WOOD_EDGE = '#8a5a2b';
const WATER = '#2b7fc4';
const FONT = '"Playpen Sans", "Trebuchet MS", "Segoe UI", sans-serif';

export function createBridgeGame({ W, H, ctx, g, el, drawFrogAt, updateHud, gameOver, sfx, onReveal, onResume }) {
  const BANK = Math.round(H * 0.15);
  const CX = W / 2;
  const PLANK_W = Math.min(380, W - 150);
  const HOME_X = CX - PLANK_W / 2 + 36; // where the frog stands, clear of the words

  const b = {
    phase: 'idle', // walk | wait | hopOn | fall | fix | cross | done | idle
    puzzle: null,
    provider: null,
    planks: [], // { y, h, item, broken }
    at: -1, // plank the frog is on: -1 = top bank, planks.length = bottom bank
    frogX: HOME_X,
    frogY: BANK / 2,
    hop: null, // { fromX, fromY, toX, toY, t, index }
    tries: 0,
    fix: 0, // 0 = broken, 1 = mended
    revealed: false,
    fall: 0, // seconds since the frog hit the water
    bonus: 0,
    pause: 0,
    solved: 0,
    particles: [],
    ripples: [],
    time: 0,
  };

  const plankY = (i) => (i < 0 ? BANK / 2 : i >= b.planks.length ? H - BANK / 2 : b.planks[i].y + b.planks[i].h / 2);
  const brokenPlank = () => b.planks[b.puzzle.brokenIndex];

  function nextPuzzle() {
    b.puzzle = b.provider();
    const n = b.puzzle.items.length;
    const gap = 7;
    const span = H - 2 * BANK - 24;
    const h = Math.min(60, (span - (n - 1) * gap) / n);
    const top = BANK + 12 + (span - (n * h + (n - 1) * gap)) / 2;
    b.planks = b.puzzle.items.map((item, i) => {
      const broken = i === b.puzzle.brokenIndex;
      return { y: top + i * (h + gap), h, item: broken ? b.puzzle.broken : item, broken };
    });
    Object.assign(b, { phase: 'walk', at: -1, frogX: HOME_X, frogY: plankY(-1), hop: null, tries: 0, fix: 0, revealed: false, fall: 0, bonus: BONUS_SECONDS, pause: 0 });
    b.puzzle.show('ask');
    el.heard.textContent = b.puzzle.prompt;
  }

  /** Starts a game; `provider()` returns the next puzzle each time one is needed. */
  function start(provider) {
    b.provider = provider;
    b.solved = 0;
    b.particles = [];
    b.ripples = [];
    nextPuzzle();
  }

  /** Can an answer be given right now? (Not while the frog is hopping across or swimming.) */
  const ready = () => b.phase === 'walk' || b.phase === 'wait';

  function mend(revealed) {
    b.revealed = revealed;
    b.phase = 'fix';
    b.hop = null;
    b.frogX = HOME_X;
    b.frogY = plankY(b.at);
    brokenPlank().item = b.puzzle.mended;
    b.puzzle.show(revealed ? 'revealed' : 'right');
    if (!revealed) sparkle(CX, brokenPlank().y + brokenPlank().h / 2, 26, ['#fff', '#ffe066', '#7cf29c']);
  }

  /** The answer given was right: mend the plank and cross. */
  function right() {
    if (!ready()) return;
    g.streak++;
    g.score += 20 + Math.round((b.bonus / BONUS_SECONDS) * 20) - b.tries * 5 - Math.min(10, (g.hints || 0) * 5) + Math.min(g.streak - 1, 5) * 2;
    el.heard.textContent = b.tries ? 'Got it!' : 'Spot on!';
    sfx.hop();
    updateHud();
    mend(false);
  }

  /** The answer given was wrong: the frog tries the broken plank and falls in. */
  function wrong(message = 'Not quite.') {
    if (!ready()) return;
    b.tries++;
    g.streak = 0;
    sfx.nope();
    el.question.classList.remove('shake');
    void el.question.offsetWidth;
    el.question.classList.add('shake');
    const last = b.tries >= TRIES;
    el.heard.textContent = last ? b.puzzle.reveal : [message, b.puzzle.hint(b.tries), b.tries === TRIES - 1 ? 'One more try.' : 'Try again!'].filter(Boolean).join(' ');
    // Step out onto the middle of the broken plank...
    b.phase = 'hopOn';
    b.frogY = plankY(b.at);
    b.hop = { fromX: b.frogX, fromY: b.frogY, toX: CX, toY: plankY(b.puzzle.brokenIndex), t: 0, index: b.at };
  }

  function sparkle(x, y, n, colors, speed = 200) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 60 + Math.random() * speed;
      b.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.5 + Math.random() * 0.6, color: colors[i % colors.length] });
    }
  }

  function hopTo(index) {
    b.hop = { fromX: b.frogX, fromY: b.frogY, toX: HOME_X, toY: plankY(index), t: 0, index };
  }

  function update(dt) {
    b.time += dt;
    for (const p of b.particles) {
      p.life -= dt;
      p.vy += 480 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    b.particles = b.particles.filter((p) => p.life > 0);
    for (const r of b.ripples) r.t += dt;
    b.ripples = b.ripples.filter((r) => r.t < 1);
    if (b.phase === 'idle') return;

    if (b.hop) {
      b.hop.t += dt / 0.24;
      const t = Math.min(1, b.hop.t);
      b.frogX = b.hop.fromX + (b.hop.toX - b.hop.fromX) * t;
      b.frogY = b.hop.fromY + (b.hop.toY - b.hop.fromY) * t;
      if (b.hop.t >= 1) {
        b.at = b.hop.index;
        b.hop = null;
      }
    }

    if (ready()) {
      b.bonus = Math.max(0, b.bonus - dt);
      el.timerFill.style.width = `${(b.bonus / BONUS_SECONDS) * 100}%`;
      el.timerFill.classList.toggle('low', b.bonus < BONUS_SECONDS * 0.25);
    }

    if (b.phase === 'walk' && !b.hop) {
      // Hop along the good planks and stop just before the broken one.
      if (b.at < b.puzzle.brokenIndex - 1) hopTo(b.at + 1);
      else b.phase = 'wait';
    } else if (b.phase === 'hopOn' && !b.hop) {
      // ...which gives way.
      b.phase = 'fall';
      b.fall = 0;
      b.ripples.push({ x: b.frogX, y: b.frogY + 6, t: 0 });
      sparkle(b.frogX, b.frogY, 22, ['#fff', '#bfe6ff', '#8fc7f0'], 160);
      sfx.splat();
    } else if (b.phase === 'fall') {
      b.fall += dt;
      if (b.fall >= 1.1) {
        // Climb out where it started.
        b.frogX = HOME_X;
        b.frogY = plankY(b.at);
        if (b.tries >= TRIES) {
          g.lives--;
          updateHud();
          onReveal(b.puzzle);
          mend(true);
        } else {
          b.phase = 'wait';
          onResume();
        }
      }
    } else if (b.phase === 'fix') {
      b.fix = Math.min(1, b.fix + dt / 0.7);
      if (b.fix >= 1) b.phase = 'cross';
    } else if (b.phase === 'cross' && !b.hop) {
      if (b.at < b.planks.length) {
        hopTo(b.at + 1);
      } else {
        b.phase = 'done';
        b.pause = b.revealed ? 1.6 : 1.1;
        if (!b.revealed) {
          sparkle(b.frogX, b.frogY, 40, ['#fff', '#ffe066', '#7cf29c']);
          sfx.win();
        }
      }
    } else if (b.phase === 'done') {
      b.pause -= dt;
      if (b.pause <= 0) {
        if (g.lives <= 0) {
          b.phase = 'idle';
          gameOver();
          return;
        }
        if (!b.revealed) {
          b.solved++;
          if (b.solved % 4 === 0) g.level++;
          updateHud();
        }
        nextPuzzle();
      }
    }
  }

  // ---------- drawing ----------
  function drawScene() {
    ctx.fillStyle = WATER;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      const x = ((i * 137 + b.time * 14) % (W + 60)) - 30;
      const y = BANK + 30 + ((i * 71) % (H - 2 * BANK - 60));
      ctx.beginPath();
      ctx.arc(x, y, 13, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    }
    ctx.fillStyle = '#3f9b4f';
    ctx.fillRect(0, 0, W, BANK);
    ctx.fillRect(0, H - BANK, W, BANK);
    ctx.fillStyle = '#d9d2c0';
    ctx.fillRect(0, BANK - 5, W, 8);
    ctx.fillRect(0, H - BANK - 3, W, 8);
    ctx.strokeStyle = '#2f7d3d';
    for (let i = 0; i < 16; i++) {
      const x = 22 + i * (W / 16);
      for (const y of [BANK - 24 - ((i * 29) % 30), H - 18 - ((i * 37) % 34)]) {
        ctx.beginPath();
        ctx.moveTo(x - 5, y);
        ctx.lineTo(x, y - 9);
        ctx.lineTo(x + 5, y);
        ctx.stroke();
      }
    }
    // ropes and posts
    for (const sx of [-1, 1]) {
      const x = CX + sx * (PLANK_W / 2 + 9);
      ctx.strokeStyle = '#6b4a2a';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x, BANK - 16);
      ctx.lineTo(x, H - BANK + 16);
      ctx.stroke();
      ctx.fillStyle = '#5a3d22';
      for (const y of [BANK - 24, H - BANK + 8]) ctx.fillRect(x - 7, y, 14, 18);
    }
  }

  function board(x, y, w, h, color) {
    ctx.fillStyle = WOOD_EDGE;
    ctx.beginPath();
    ctx.roundRect(x, y + 3, w, h, 7);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h - 2, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90, 55, 20, .28)';
    ctx.lineWidth = 1.5;
    for (const f of [0.32, 0.68]) {
      ctx.beginPath();
      ctx.moveTo(x + 10, y + h * f);
      ctx.lineTo(x + w - 10, y + h * f);
      ctx.stroke();
    }
  }

  // What is written or painted on a plank: a word, a number or a coloured dot.
  function drawItem(item, x, y, h, color, outlined) {
    if (item.colour) {
      const r = Math.min(20, h * 0.36);
      ctx.fillStyle = item.colour;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255, 253, 244, .9)';
      ctx.stroke();
      return;
    }
    const maxText = PLANK_W - 96;
    let size = Math.min(34, h * 0.62);
    ctx.font = `700 ${size}px ${FONT}`;
    const width = ctx.measureText(item.text).width;
    if (width > maxText) {
      size *= maxText / width;
      ctx.font = `700 ${size}px ${FONT}`;
    }
    if (outlined) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(4, size * 0.22);
      ctx.strokeStyle = 'rgba(255, 253, 244, .92)';
      ctx.strokeText(item.text, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(item.text, x, y);
  }

  function drawPlank(p) {
    const left = CX - PLANK_W / 2;
    const textX = CX + 22;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const breakage = p.broken ? 1 - b.fix : 0;
    if (breakage > 0) {
      // Two halves hinged at the ropes, sagging towards the water.
      const half = PLANK_W / 2 - 5 * breakage;
      for (const sx of [-1, 1]) {
        ctx.save();
        ctx.translate(CX + sx * (PLANK_W / 2), p.y + p.h / 2);
        ctx.rotate(sx * -0.2 * breakage);
        board(sx > 0 ? -half : 0, -p.h / 2, half, p.h, '#9b6b3c');
        ctx.restore();
      }
      ctx.fillStyle = WATER;
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) ctx.lineTo(CX + (k % 2 ? 6 : -6) * breakage, p.y - 6 + (k * (p.h + 22)) / 6);
      ctx.lineTo(CX, p.y + p.h + 16);
      ctx.closePath();
      ctx.fill();
      drawItem(p.item, textX, p.y + p.h / 2 + 8 * breakage, p.h, '#c1121f', true);
    } else {
      board(left, p.y, PLANK_W, p.h, WOOD);
      drawItem(p.item, textX, p.y + p.h / 2 + 1, p.h, p.broken ? (b.revealed ? '#8a1c1c' : '#17683a') : '#2b1a0a', false);
    }
  }

  function draw() {
    drawScene();
    b.planks.forEach(drawPlank);
    for (const r of b.ripples) {
      ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - r.t)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, 14 + r.t * 46, 6 + r.t * 18, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (b.phase === 'fall') {
      // Sinks out of sight in the first third of a second.
      const sink = Math.min(1, b.fall / 0.35);
      if (sink < 1) drawFrogAt(b.frogX, b.frogY + sink * 14, -3 * sink, false);
    } else {
      const lift = b.hop ? Math.sin(Math.PI * Math.min(1, b.hop.t)) : 0;
      drawFrogAt(b.frogX, b.frogY, lift, false);
    }
    for (const p of b.particles) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  return { start, right, wrong, ready, update, draw, state: b };
}
