// Spelling Bridge puzzles: a sentence with one misspelt word. The scene they
// are played on is in bridge.js.

import { SENTENCES } from './spelling-words.js';

/** "We [beleive|believe] it." -> words with the misspelt one marked. */
export function parseSentence(text) {
  const words = text.split(/\s+/).map((token) => {
    const m = token.match(/^([^[\]A-Za-z]*)\[([^|\]]+)\|([^\]]+)\]([^[\]A-Za-z]*)$/);
    return m ? { before: m[1], wrong: m[2], right: m[3], after: m[4] } : { text: token };
  });
  const brokenIndex = words.findIndex((w) => w.wrong);
  return { words, brokenIndex, wrong: words[brokenIndex]?.wrong, right: words[brokenIndex]?.right };
}

/** What the child typed, tidied for comparing: case and stray punctuation don't matter. */
export const tidy = (typed) => String(typed).trim().toLowerCase().replace(/[^a-z'-]/g, '');

/** Band of sentences (0, 1, 2) for a level: two levels on each, then the hardest. */
export const bandFor = (level) => Math.min(SENTENCES.length - 1, Math.floor((level - 1) / 2));

/**
 * Hands out sentences for a game: none repeats until its band is used up, and
 * one that had to be given away comes round again.
 */
export function createSpellingPuzzles(el) {
  const used = new Set();

  function pick(level) {
    const band = SENTENCES[bandFor(level)];
    let unused = band.filter((s) => !used.has(s));
    if (!unused.length) {
      band.forEach((s) => used.delete(s));
      unused = band;
    }
    const text = unused[Math.floor(Math.random() * unused.length)];
    used.add(text);
    return text;
  }

  /** The next puzzle, in the shape bridge.js plays. */
  function next(level) {
    const source = pick(level);
    const s = parseSentence(source);
    const word = s.words[s.brokenIndex];
    return {
      source,
      wrong: s.wrong,
      right: s.right,
      items: s.words.map((w) => ({ text: w.wrong ? w.before + w.wrong + w.after : w.text })),
      brokenIndex: s.brokenIndex,
      broken: { text: word.before + word.wrong + word.after },
      mended: { text: word.before + word.right + word.after },
      prompt: 'Type the broken word with the correct spelling.',
      reveal: `It is spelt “${s.right}”. Look closely, it will come back.`,
      // No help is given automatically: hints only appear when the Hint button is pressed.
      hint: () => '',
      // The whole sentence in the bar above the game, for easy reading.
      show(state) {
        const mended = state !== 'ask';
        el.question.className = `sentence${state === 'right' ? ' good' : state === 'revealed' ? ' bad' : ''}`;
        el.question.replaceChildren(...s.words.flatMap((w, i) => {
          const span = document.createElement('span');
          if (w.wrong) {
            span.className = mended ? 'mended' : 'misspelt';
            span.textContent = w.before + (mended ? w.right : w.wrong) + w.after;
          } else {
            span.textContent = w.text;
          }
          return i ? [' ', span] : [span];
        }));
      },
    };
  }

  return { next, reset: () => used.clear(), forget: (source) => used.delete(source) };
}
