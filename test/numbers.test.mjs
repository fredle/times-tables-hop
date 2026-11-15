import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNumbers } from '../public/numbers.js';

const values = (t) => extractNumbers(t).map((n) => n.value);

test('digits and words', () => {
  assert.deepEqual(values('56'), [56]);
  assert.deepEqual(values('56.'), [56]);
  assert.deepEqual(values('fifty six'), [56]);
  assert.deepEqual(values('Fifty-six!'), [56]);
  assert.deepEqual(values('um is it twelve'), [12]);
  assert.deepEqual(values('seven'), [7]);
});

test('hundreds', () => {
  assert.deepEqual(values('one hundred and forty four'), [144]);
  assert.deepEqual(values('a hundred and eight'), [108]);
  assert.deepEqual(values('one hundred'), [100]);
  assert.deepEqual(values('one forty four'), [144]);
  assert.deepEqual(values('one hundred twenty'), [120]);
  assert.deepEqual(values('one hundred and ten'), [110]);
});

test('several numbers and corrections', () => {
  assert.deepEqual(values('fifty four no fifty six'), [54, 56]);
  assert.deepEqual(values('six seven'), [6, 7]);
  assert.deepEqual(values('twenty thirty'), [20, 30]);
});

test('homophones', () => {
  assert.deepEqual(values('ate'), [8]);
  assert.deepEqual(values('for'), [4]);
  assert.deepEqual(values('to'), [2]);
});

test('open-ended tails', () => {
  assert.equal(extractNumbers('fifty').at(-1).open, true);
  assert.equal(extractNumbers('fifty six').at(-1).open, false);
  assert.equal(extractNumbers('one hundred').at(-1).open, true);
  assert.equal(extractNumbers('twelve').at(-1).open, false);
  assert.equal(extractNumbers('Um, is it 100?').at(-1).open, true);
  assert.equal(extractNumbers('Um, is it 144?').at(-1).open, false);
  assert.equal(extractNumbers('56.').at(-1).open, false);
});

test('no numbers', () => {
  assert.deepEqual(values('hello there'), []);
  assert.deepEqual(values(''), []);
});
