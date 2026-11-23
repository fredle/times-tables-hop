import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNumbers, judgeNumbers } from '../public/numbers.js';

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

test('repeats run together into one string of digits', () => {
  assert.deepEqual(values('66'), [66, 6]);
  assert.deepEqual(values('4242'), [4242, 42]);
  assert.deepEqual(values('777'), [777, 7]);
  assert.deepEqual(values('56'), [56]);
  assert.deepEqual(values('100'), [100]);
  assert.deepEqual(values('1010'), [1010, 10]);
  assert.equal(extractNumbers('66').find((n) => n.value === 6).repeat, true);
});

const hit = (texts, answer, shown) => judgeNumbers(texts, answer, shown).hit?.value ?? null;

test('repeats and self-corrections pass', () => {
  assert.equal(hit(['forty forty two'], 42), 42);
  assert.equal(hit(['forty 42'], 42), 42);
  assert.equal(hit(['twelve no eighteen'], 18), 18);
  assert.equal(hit(['six six'], 6), 6);
  assert.equal(hit(['66'], 6), 6);
  assert.equal(hit(['4242'], 42), 42);
  assert.equal(hit(['66'], 66), 66);
});

test('any reading from the recogniser can hold the answer', () => {
  assert.equal(hit(['forty to', 'forty two'], 42), 42);
  assert.equal(hit(['for tea', 'forty'], 40), 40);
  assert.equal(hit(['for tea', 'thirty'], 40), null);
});

test('a run of numbers is a guess', () => {
  const r = judgeNumbers(['six seven eight nine'], 8);
  assert.equal(r.hit, null);
  assert.equal(r.guess, true);
  // A guess in one reading does not stop a clean reading from counting.
  assert.equal(hit(['six seven eight nine', 'eight'], 8), 8);
  // Two tries in one breath is not a guess.
  assert.equal(hit(['twelve no fourteen'], 14), 14);
});

test('reading the question aloud is not a guess', () => {
  assert.equal(hit(['three times four is twelve'], 12, [3, 4]), 12);
  assert.equal(hit(['three times four is twelve'], 12), null);
});

test('last number heard, for the wrong-answer message', () => {
  assert.equal(judgeNumbers(['forty no forty four'], 42).last, 44);
  assert.equal(judgeNumbers(['66'], 7).last, 66);
  assert.equal(judgeNumbers(['hello'], 7).last, null);
  assert.equal(judgeNumbers([''], 7).last, null);
});
