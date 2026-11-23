import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hintsFor, spellingHints, repeatingUnit } from '../public/hints.js';
import { makeSequence } from '../public/next.js';

const tables = (x, y) => ({ a: x, b: y, answer: x * y, text: `${x} × ${y}` });

test('times tables hints never give the answer away', () => {
  for (let x = 1; x <= 12; x++) {
    for (let y = 1; y <= 12; y++) {
      const hints = hintsFor(tables(x, y));
      assert.equal(hints.length, 2);
      // the counting hint ends in "?" where the answer would be
      assert.match(hints[1], /\?$/);
      const counted = hints[1].split(': ')[1].split(', ');
      assert.equal(counted.length, y);
      if (x > 2 && y > 2 && x !== 10 && y !== 10) assert.ok(hints[0].includes(String(x * (y - 1))));
    }
  }
  assert.match(hintsFor(tables(7, 10))[0], /7 with a 0/);
  assert.match(hintsFor(tables(2, 9))[0], /double 9/);
  assert.match(hintsFor(tables(1, 6))[0], /times 1/);
});

test('numbers: dots to count and the number before', () => {
  const q = { answer: 5, text: '5', plain: true };
  assert.deepEqual(hintsFor(q), ['Count the dots: ●●●●●', 'It is the number after 4.']);
  assert.equal(hintsFor(q, true)[0], 'It is the number after 4.');
  assert.match(hintsFor({ answer: 1, text: '1', plain: true })[1], /first number/);
});

test('letters and words', () => {
  assert.deepEqual(hintsFor({ text: 's', accept: ['s'], plain: true }), ['It is the sound at the start of “sun”.']);
  assert.match(hintsFor({ text: 'x', accept: ['x'], plain: true })[0], /end of “fox”/);
  assert.deepEqual(hintsFor({ text: 'cat', accept: ['cat'], plain: true }), ['Sound it out: c – a – t']);
});

test('what comes next: describes the rule without the answer', () => {
  assert.deepEqual(repeatingUnit(['red', 'blue', 'red', 'blue', 'red']), ['red', 'blue']);
  assert.deepEqual(repeatingUnit(['a', 'b', 'b', 'a', 'b', 'b', 'a']), ['a', 'b', 'b']);
  const up = hintsFor({ seq: { kind: 'number', shown: [2, 4, 6], answer: 8 } });
  assert.match(up[0], /bigger/);
  assert.equal(up[1], 'It goes up in 2s.');
  const down = hintsFor({ seq: { kind: 'number', shown: [10, 9, 8], answer: 7 } });
  assert.equal(down[1], 'It goes down by 1 each time.');
  for (let level = 1; level <= 5; level++) {
    for (let i = 0; i < 100; i++) {
      const seq = makeSequence(level);
      const hints = hintsFor({ seq, accept: seq.accept });
      assert.equal(hints.length, 2);
      // The step size is named in the hint, so skip the rare puzzle whose
      // answer happens to be the same number as its step.
      const step = Math.abs(seq.shown[1] - seq.shown[0]);
      if (seq.kind === 'number' && seq.answer !== step) hints.forEach((h) => assert.ok(!new RegExp(`\\b${seq.answer}\\b`).test(h), `${h} gives away ${seq.answer}`));
    }
  }
});

test('spelling: first letter and length, then every other letter', () => {
  assert.deepEqual(spellingHints('library'), ['It starts with “l” and has 7 letters.', 'l _ b _ a _ y']);
  assert.equal(spellingHints('Lightning')[1], 'l _ g _ t _ i _ g');
});
