import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SENTENCES } from '../public/spelling-words.js';
import { parseSentence, tidy, bandFor } from '../public/spelling.js';

test('every sentence has exactly one misspelt word that differs from the right one', () => {
  assert.equal(SENTENCES.length, 3);
  const seen = new Set();
  for (const band of SENTENCES) {
    assert.ok(band.length >= 20, 'at least 20 sentences per band');
    for (const text of band) {
      assert.equal((text.match(/\[/g) || []).length, 1, text);
      const s = parseSentence(text);
      assert.ok(s.brokenIndex >= 0, `no marked word in: ${text}`);
      assert.notEqual(s.wrong.toLowerCase(), s.right.toLowerCase(), text);
      assert.match(s.wrong, /^[A-Za-z]+$/, text);
      assert.match(s.right, /^[A-Za-z]+$/, text);
      assert.ok(s.words.length <= 9, `too long for the bridge: ${text}`);
      assert.ok(!seen.has(s.right), `repeated word: ${s.right}`);
      seen.add(s.right);
    }
  }
});

test('parsing keeps punctuation and capital letters with the word', () => {
  const s = parseSentence('[Lightening|Lightning] flashed, then the [x|y].'.replace('[x|y]', 'sky'));
  assert.equal(s.brokenIndex, 0);
  assert.equal(s.right, 'Lightning');
  const end = parseSentence('We went to the [libary|library].');
  assert.deepEqual(end.words.at(-1), { before: '', wrong: 'libary', right: 'library', after: '.' });
  assert.equal(end.words[0].text, 'We');
});

test('typed answers ignore case, spaces and stray punctuation', () => {
  assert.equal(tidy('  Library. '), 'library');
  assert.equal(tidy('LIGHTNING'), 'lightning');
  assert.equal(tidy('libary'), 'libary');
});

test('levels move through the bands and stay on the hardest', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(bandFor), [0, 0, 1, 1, 2, 2, 2]);
});
