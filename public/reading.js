// Letters and simple three-letter words for the reading games, with the
// things speech-to-text tends to write when a child says them.

// Letter names, their sound-alikes ("see" for c), and rough spellings of the
// phonics sounds ("buh" for b). Entries may be more than one word.
export const LETTERS = {
  a: ['ay', 'eh', 'hey', 'ah'],
  b: ['be', 'bee', 'buh'],
  c: ['see', 'sea', 'cee', 'kuh', 'cuh'],
  d: ['dee', 'de', 'duh'],
  e: ['ee', 'eh'],
  f: ['ef', 'eff', 'fuh', 'ff'],
  g: ['gee', 'jee', 'guh'],
  h: ['aitch', 'haitch', 'age', 'huh'],
  i: ['eye', 'aye', 'ih'],
  j: ['jay', 'juh'],
  k: ['kay', 'cay', 'kuh'],
  l: ['el', 'ell', 'elle', 'luh'],
  m: ['em', 'mm', 'mmm', 'muh'],
  n: ['en', 'nn', 'nuh'],
  o: ['oh', 'owe', 'aw'],
  p: ['pee', 'pea', 'puh'],
  q: ['cue', 'queue', 'kew', 'kyu'],
  r: ['are', 'ar', 'ruh'],
  s: ['es', 'ess', 'ss', 'sss'],
  t: ['tee', 'tea', 'tuh'],
  u: ['you', 'ewe', 'yew', 'uh'],
  v: ['vee', 've', 'vuh'],
  w: ['double u', 'double you', 'doubleu', 'wuh'],
  x: ['ex', 'ecks', 'eks'],
  y: ['why', 'wye', 'yuh'],
  z: ['zed', 'zee', 'zz', 'zzz'],
};

// Word -> other spellings that sound the same.
export const WORDS = {
  cat: ['kat'], dog: [], sun: ['son'], hat: [], pig: [], bed: [], cup: [], red: ['read'],
  bus: [], hen: [], fox: [], map: [], pen: [], pot: [], jam: [], net: [], zip: [],
  web: [], mum: ['mom', 'mam'], dad: [], run: [], sit: [], hop: [], big: [], top: [],
  leg: [], bag: [], van: [], six: ['6'], ten: ['10'], box: [], bug: [], mud: [],
  nut: [], pin: [], pan: [], log: [], jug: [], hug: [], wet: [], yes: [], bat: [],
  rat: [], mat: [], man: [], fan: [], jet: [], pet: [], vet: [], lip: [], hot: [],
  dot: [], cut: [], fun: [], bin: ['been'], tap: [], dig: [], peg: [], cot: ['caught'],
};

export const isReadingMode = (mode) => mode === 'letters' || mode === 'words';

/** Everything on screen in a mode, e.g. ['a', 'b', ...] or ['cat', 'dog', ...]. */
export function items(mode) {
  return Object.keys(mode === 'letters' ? LETTERS : WORDS);
}

/** All the spoken forms that count as reading `item` correctly. */
export function accepted(mode, item) {
  return [item, ...((mode === 'letters' ? LETTERS : WORDS)[item] || [])];
}

/** Hints for the speech recogniser: the whole vocabulary of a mode. */
export function vocabulary(mode) {
  if (mode === 'letters') return [...Object.keys(LETTERS), ...Object.values(LETTERS).flat()];
  if (mode === 'words') return Object.keys(WORDS);
  return [];
}

export function normalise(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** True when the transcript contains one of the accepted forms as whole words. */
export function matchesSpoken(text, accept) {
  const said = ` ${normalise(text)} `;
  return accept.some((form) => said.includes(` ${form} `));
}

/**
 * Did the phoneme recogniser hear this letter's sound? `letters` is its list
 * of {letter, score} for one clip. The letter passes when its sound was clearly
 * present and at most a couple of other sounds scored higher: easily confused
 * sounds (b/d/p, m/n, f/s) get the benefit of the doubt.
 */
export function soundMatches(letters, letter, { minScore = 0.25, maxRank = 3 } = {}) {
  const mine = (letters || []).find((l) => l.letter === letter);
  if (!mine || mine.score < minScore) return false;
  const rank = 1 + letters.filter((l) => l.score > mine.score).length;
  return rank <= maxRank;
}
