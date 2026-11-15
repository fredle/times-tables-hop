// Turns a speech transcript ("um fifty six", "56.", "one hundred and eight")
// into the numbers it contains.

const UNITS = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  // Things speech-to-text commonly hears instead of a lone number.
  won: 1, to: 2, too: 2, for: 4, fore: 4, ate: 8, tree: 3, free: 3, nein: 9,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

/**
 * @returns {{value:number, open:boolean}[]} numbers in spoken order. `open` is
 * true when the number is the last thing said and could still grow
 * ("fifty" -> "fifty six"), so callers can wait a beat before trusting it.
 */
export function extractNumbers(text) {
  const tokens = String(text)
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  const out = [];
  let cur = 0;
  let last = null; // 'unit' | 'teen' | 'tens' | 'hundred' | null
  const flush = () => {
    if (last) out.push({ value: cur, open: false });
    cur = 0;
    last = null;
  };

  tokens.forEach((tok, i) => {
    const isLastToken = i === tokens.length - 1;
    if (/^\d+$/.test(tok)) {
      flush();
      // Live transcripts can show "50" for a moment before it becomes "56".
      const v = parseInt(tok, 10);
      out.push({ value: v, open: isLastToken && v >= 20 && v % 10 === 0 });
    } else if (tok in UNITS) {
      const v = UNITS[tok];
      const kind = v < 10 ? 'unit' : 'teen';
      if (v > 0 && v < 10 && last === 'tens') {
        cur += v;
        last = 'unit-done';
      } else if (v > 0 && last === 'hundred') {
        cur += v;
        last = v < 10 ? 'unit-done' : 'teen';
      } else {
        flush();
        cur = v;
        last = kind;
      }
    } else if (tok in TENS) {
      const v = TENS[tok];
      if (last === 'hundred') {
        cur += v;
      } else if (last === 'unit' && cur >= 1 && cur <= 9) {
        cur = cur * 100 + v; // "one forty four"
      } else {
        flush();
        cur = v;
      }
      last = 'tens';
    } else if (tok === 'hundred') {
      if (last === 'unit' && cur >= 1 && cur <= 9) {
        cur *= 100;
      } else {
        flush();
        cur = 100; // "a hundred"
      }
      last = 'hundred';
    } else if (tok === 'and' && last === 'hundred' && !isLastToken) {
      // "one hundred and eight": keep going
    } else {
      flush();
    }
  });

  const endedOpen = last === 'tens' || last === 'hundred';
  flush();
  if (endedOpen && out.length) out[out.length - 1].open = true;
  return out;
}
