// "What comes next?": colour patterns (red, blue, red, blue, ?) and number
// sequences (2, 4, 6, ?) that get harder with the level.

export const COLOURS = {
  red: { css: '#e63946', also: ['read'] },
  blue: { css: '#3a86ff', also: ['blew'] },
  green: { css: '#2fb457', also: [] },
  yellow: { css: '#ffd60a', also: ['yello'] },
  orange: { css: '#f77f00', also: [] },
  purple: { css: '#9b5de5', also: [] },
};

const pick = (list, rand) => list[Math.floor(rand() * list.length)];

function colourPattern(level, rand) {
  const names = Object.keys(COLOURS).slice(0, level >= 3 ? 6 : 4);
  const shuffled = names.map((n) => [rand(), n]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const [a, b, c] = shuffled;
  // The repeating unit. Level 1 only alternates two colours.
  const units = level === 1 ? [[a, b]] : [[a, b], [a, b, b], [a, a, b], [a, b, c]];
  const unit = pick(units, rand);
  // Show two full repeats plus a bit, so the answer is not always the first colour.
  const shownCount = unit.length * 2 + Math.floor(rand() * unit.length);
  const shown = Array.from({ length: shownCount }, (_, i) => unit[i % unit.length]);
  const answer = unit[shownCount % unit.length];
  return { kind: 'colour', shown, answer, accept: [answer, ...COLOURS[answer].also] };
}

function numberSequence(level, rand) {
  // [step, lowest start, highest start]; the start is kept on the step's own
  // counting pattern (2, 4, 6... not 3, 5, 7) so it matches skip counting.
  const rules = [[1, 1, 6]];
  if (level >= 2) rules.push([1, 5, 16], [-1, 5, 10]);
  if (level >= 3) rules.push([2, 2, 12], [10, 10, 60]);
  if (level >= 4) rules.push([5, 5, 35], [-2, 10, 20], [-10, 50, 100]);
  const [step, low, high] = pick(rules, rand);
  const size = Math.abs(step);
  const slots = Math.floor((high - low) / size) + 1;
  const start = low + size * Math.floor(rand() * slots);
  const shown = [start, start + step, start + 2 * step];
  if (level >= 2 && rand() < 0.5) shown.push(start + 3 * step);
  return { kind: 'number', shown, answer: shown[shown.length - 1] + step };
}

/** A new puzzle: { kind, shown: [...], answer, accept? }. */
export function makeSequence(level, rand = Math.random) {
  const colourShare = level <= 2 ? 0.5 : 0.3;
  return rand() < colourShare ? colourPattern(level, rand) : numberSequence(level, rand);
}

/** Words the speech recogniser should expect in this game. */
export function nextVocabulary() {
  return [...Object.keys(COLOURS), 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
    'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'zero'];
}
