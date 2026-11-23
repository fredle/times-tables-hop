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
 * "66" -> 6, "4242" -> 42, "121212" -> 12: the number a child repeated, when
 * speech-to-text has run the repeats together into one string of digits.
 * Returns null for anything else.
 */
function repeatedPart(digits) {
  for (let len = 1; len <= digits.length / 2; len++) {
    if (digits.length % len) continue;
    const part = digits.slice(0, len);
    if (part[0] !== '0' && part.repeat(digits.length / len) === digits) return parseInt(part, 10);
  }
  return null;
}

/**
 * @returns {{value:number, open:boolean, repeat?:boolean}[]} numbers in spoken
 * order. `open` is true when the number is the last thing said and could
 * still grow ("fifty" -> "fifty six"), so callers can wait a beat before
 * trusting it. An entry with `repeat` is a second reading of the number
 * before it ("66" may be "six, six"), not something else that was said.
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
      const part = repeatedPart(tok);
      if (part !== null) out.push({ value: part, open: false, repeat: true });
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

/**
 * Judges what a child said against a number answer.
 *
 * `texts` is the transcript followed by any other readings the recogniser
 * offered; the answer counts if any of them contains it, so a repeat ("forty,
 * forty-two") or a correction ("twelve, no, eighteen") still passes.
 * Reeling off several numbers in one go ("six, seven, eight, nine") is a
 * guess and does not count. Numbers that are part of the question (`shown`,
 * e.g. the 3 and 4 of "3 × 4") are allowed, so reading the question aloud is
 * not a guess.
 *
 * @returns {{hit: {value:number, open:boolean}|null, guess: boolean, last: number|null}}
 * `last` is the last number heard in the main transcript, for "I heard ...".
 */
export function judgeNumbers(texts, answer, shown = [], maxDifferent = 2) {
  const list = (Array.isArray(texts) ? texts : [texts]).filter((t) => t && String(t).trim());
  let guessed = false;
  let last = null;
  for (let i = 0; i < list.length; i++) {
    const nums = extractNumbers(list[i]);
    const said = nums.filter((n) => !n.repeat && !shown.includes(n.value));
    const different = new Set(said.map((n) => n.value));
    const guess = different.size > maxDifferent;
    if (i === 0) {
      guessed = guess;
      const spoken = nums.filter((n) => !n.repeat);
      if (spoken.length) last = spoken[spoken.length - 1].value;
    }
    if (guess) continue;
    const hit = nums.find((n) => n.value === answer);
    if (hit) return { hit, guess: false, last };
  }
  return { hit: null, guess: guessed, last };
}
