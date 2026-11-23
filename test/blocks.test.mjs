import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIZE, SHAPES, emptyBoard, fits, place, bestPlacement, fitsSomewhere, pickShapes, points } from '../public/blocks.js';

const shape = (n) => SHAPES.find((s) => s.cells.length === n && s.rows === 1);
const dot = SHAPES.find((s) => s.cells.length === 1);
const square3 = SHAPES.find((s) => s.cells.length === 9);

test('shapes know their size', () => {
  assert.equal(square3.rows, 3);
  assert.equal(square3.cols, 3);
  assert.equal(shape(4).cols, 4);
});

test('fits stays on the board and off filled cells', () => {
  const b = emptyBoard();
  assert.equal(fits(b, shape(4), 0, SIZE - 4), true);
  assert.equal(fits(b, shape(4), 0, SIZE - 3), false);
  b[0][1] = 'red';
  assert.equal(fits(b, shape(2), 0, 0), false);
  assert.equal(fits(b, shape(2), 1, 0), true);
});

test('a full row clears', () => {
  const b = emptyBoard();
  for (let x = 0; x < SIZE - 1; x++) b[3][x] = 'red';
  b[2][0] = 'blue';
  const r = place(b, dot, 3, SIZE - 1);
  assert.deepEqual(r.rows, [3]);
  assert.deepEqual(r.cols, []);
  assert.ok(b[3].every((c) => c === null));
  assert.equal(b[2][0], 'blue');
});

test('a row and a column clear together', () => {
  const b = emptyBoard();
  for (let i = 0; i < SIZE; i++) {
    if (i !== 5) b[5][i] = 'red';
    if (i !== 5) b[i][5] = 'red';
  }
  const r = place(b, dot, 5, 5);
  assert.deepEqual(r.rows, [5]);
  assert.deepEqual(r.cols, [5]);
  assert.ok(b.every((row) => row.every((c) => c === null)));
});

test('best placement prefers clearing a line', () => {
  const b = emptyBoard();
  for (let x = 0; x < SIZE - 2; x++) b[6][x] = 'red';
  assert.deepEqual(bestPlacement(b, shape(2)), { row: 6, col: SIZE - 2, lines: 1 });
});

test('best placement tucks into a corner on an empty board', () => {
  const p = bestPlacement(emptyBoard(), square3);
  assert.equal(p.lines, 0);
  assert.ok((p.row === 0 || p.row === SIZE - 3) && (p.col === 0 || p.col === SIZE - 3));
});

test('nowhere to go', () => {
  const b = emptyBoard().map((row) => row.map(() => 'red'));
  b[0][0] = null;
  assert.equal(bestPlacement(b, shape(2)), null);
  assert.equal(fitsSomewhere(b, dot), true);
});

test('a new tray always has something that fits when anything can', () => {
  const b = emptyBoard().map((row) => row.map(() => 'red'));
  b[4][4] = null;
  // A random source that would always pick the big square.
  const tray = pickShapes(b, 3, () => 0.999);
  assert.ok(tray.some((s) => fitsSomewhere(b, s)));
});

test('points', () => {
  assert.equal(points(4, 0), 4);
  assert.equal(points(1, 1), 11);
  assert.equal(points(3, 2), 43);
});
