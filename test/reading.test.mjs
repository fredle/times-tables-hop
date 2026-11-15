import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesSpoken, accepted, items, vocabulary } from '../public/reading.js';

test('letters: names, sound-alikes and punctuation', () => {
  assert.ok(matchesSpoken('B.', accepted('letters', 'b')));
  assert.ok(matchesSpoken('Bee', accepted('letters', 'b')));
  assert.ok(matchesSpoken('um, see', accepted('letters', 'c')));
  assert.ok(matchesSpoken('Double U.', accepted('letters', 'w')));
  assert.ok(matchesSpoken('zed', accepted('letters', 'z')));
  assert.ok(!matchesSpoken('bee', accepted('letters', 'd')));
  assert.ok(!matchesSpoken('because', accepted('letters', 'b')));
});

test('words: whole words only, plus sound-alikes', () => {
  assert.ok(matchesSpoken('Cat.', accepted('words', 'cat')));
  assert.ok(matchesSpoken('is it son', accepted('words', 'sun')));
  assert.ok(matchesSpoken('6', accepted('words', 'six')));
  assert.ok(!matchesSpoken('bat', accepted('words', 'cat')));
  assert.ok(!matchesSpoken('catch', accepted('words', 'cat')));
});

test('vocabulary', () => {
  assert.equal(items('letters').length, 26);
  assert.ok(items('words').every((w) => w.length === 3));
  assert.ok(vocabulary('words').includes('dog'));
  assert.deepEqual(vocabulary('tables'), []);
});
