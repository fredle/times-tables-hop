// Hints for every game. Each question has one or two, from a gentle nudge to
// a stronger one; pressing Hint again moves on to the next.

// A word that starts with each letter's sound (x is heard at the end of fox).
const LETTER_WORDS = {
  a: 'apple', b: 'bat', c: 'cat', d: 'dog', e: 'egg', f: 'fish', g: 'goat', h: 'hat', i: 'insect',
  j: 'jam', k: 'kite', l: 'leg', m: 'man', n: 'net', o: 'orange', p: 'pig', q: 'queen', r: 'rat',
  s: 'sun', t: 'tap', u: 'umbrella', v: 'van', w: 'web', x: 'fox', y: 'yes', z: 'zip',
};

const dots = (n) => '●'.repeat(n);

function tablesHints(q) {
  const [x, , y] = q.text.split(' ').map(Number);
  const first = [];
  if (x === 1 || y === 1) first.push('Anything times 1 stays the same.');
  else if (x === 10 || y === 10) first.push(`Times 10: write ${x === 10 ? y : x} with a 0 on the end.`);
  else if (x === 2 || y === 2) first.push(`Times 2 means double. What is double ${x === 2 ? y : x}?`);
  else first.push(`${x} × ${y - 1} = ${x * (y - 1)}. Now add one more ${x}.`);
  const counting = Array.from({ length: y }, (_, i) => (i === y - 1 ? '?' : x * (i + 1)));
  return [...first, `Count in ${x}s, ${y} ${y === 1 ? 'time' : 'times'}: ${counting.join(', ')}`];
}

function numberHints(q, onBridge) {
  const n = q.answer;
  const neighbour = n > 1 ? `It is the number after ${n - 1}.` : 'It is the very first number you count.';
  const count = `Count the dots: ${dots(n)}`;
  return onBridge ? [neighbour, count] : [count, neighbour];
}

function readingHints(q) {
  const item = q.text;
  if (item.length === 1) {
    const word = LETTER_WORDS[item];
    return [item === 'x' ? `It is the sound at the end of “${word}”.` : `It is the sound at the start of “${word}”.`];
  }
  return [`Sound it out: ${item.split('').join(' – ')}`];
}

/** The shortest run that the whole pattern repeats, e.g. [red, blue]. */
export function repeatingUnit(pattern) {
  for (let n = 1; n <= pattern.length; n++) {
    if (pattern.every((v, i) => v === pattern[i % n])) return pattern.slice(0, n);
  }
  return pattern;
}

function nextHints(q) {
  const { kind, shown } = q.seq;
  if (kind === 'colour') {
    const unit = repeatingUnit(shown);
    return ['Find the part that repeats. Say the colours out loud as you go.', `The pattern is ${unit.join(', ')}, over and over.`];
  }
  const step = shown[1] - shown[0];
  const size = Math.abs(step);
  return [
    step > 0 ? 'The numbers get bigger. How much bigger each time?' : 'The numbers get smaller. How much smaller each time?',
    size === 1 ? `It goes ${step > 0 ? 'up' : 'down'} by 1 each time.` : `It goes ${step > 0 ? 'up' : 'down'} in ${size}s.`,
  ];
}

/** Hints for a Spelling Bridge word: first letter and length, then every other letter. */
export function spellingHints(right) {
  const letters = right.toLowerCase().split('');
  return [
    `It starts with “${letters[0]}” and has ${letters.length} letters.`,
    letters.map((c, i) => (i % 2 === 0 ? c : '_')).join(' '),
  ];
}

/**
 * All the hints for a question, gentlest first.
 * `q` is the game's question; `onBridge` says which way Numbers is being played.
 */
export function hintsFor(q, onBridge = false) {
  if (q.seq) return nextHints(q);
  if (q.accept) return readingHints(q);
  if (q.plain) return numberHints(q, onBridge);
  return tablesHints(q);
}
