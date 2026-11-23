import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSequence, COLOURS } from '../public/next.js';

// A repeatable stand-in for Math.random.
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

test('number sequences continue by a constant step and stay sensible', () => {
  for (let level = 1; level <= 6; level++) {
    const rand = seeded(level * 97);
    for (let i = 0; i < 400; i++) {
      const q = makeSequence(level, rand);
      if (q.kind !== 'number') continue;
      const step = q.shown[1] - q.shown[0];
      q.shown.forEach((v, k) => assert.equal(v, q.shown[0] + k * step));
      assert.equal(q.answer, q.shown.at(-1) + step);
      assert.ok(q.answer >= 0 && q.answer <= 150, `answer ${q.answer} out of range`);
      assert.ok(Math.min(...q.shown) >= 0);
      if (level === 1) assert.equal(step, 1);
    }
  }
});

test('colour patterns repeat a unit and the answer follows it', () => {
  for (let level = 1; level <= 5; level++) {
    const rand = seeded(level * 31 + 7);
    for (let i = 0; i < 400; i++) {
      const q = makeSequence(level, rand);
      if (q.kind !== 'colour') continue;
      const full = [...q.shown, q.answer];
      const unit = [2, 3].find((n) => full.every((c, k) => c === full[k % n]));
      assert.ok(unit, `no repeating unit in ${full.join(' ')}`);
      assert.ok(q.shown.length >= unit * 2, 'shows at least two repeats');
      assert.ok(full.every((c) => c in COLOURS));
      assert.ok(q.accept.includes(q.answer));
      if (level === 1) assert.equal(new Set(full).size, 2);
    }
  }
});

test('both kinds appear at every level', () => {
  for (let level = 1; level <= 4; level++) {
    const rand = seeded(level);
    const kinds = new Set(Array.from({ length: 200 }, () => makeSequence(level, rand).kind));
    assert.deepEqual([...kinds].sort(), ['colour', 'number']);
  }
});
