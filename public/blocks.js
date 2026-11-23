// The rules of the block puzzle, kept apart from the drawing so they can be
// tested. The board is a square grid; each block is a small shape of cells.
// A block is placed where it fits; any row or column that is then full is
// cleared.

export const SIZE = 8;

// Each shape is a list of [row, col] cells, with its own colour.
const RAW_SHAPES = [
  { cells: [[0, 0]], colour: '#ffbe0b' },
  { cells: [[0, 0], [0, 1]], colour: '#3a86ff' },
  { cells: [[0, 0], [1, 0]], colour: '#3a86ff' },
  { cells: [[0, 0], [0, 1], [0, 2]], colour: '#2a9d8f' },
  { cells: [[0, 0], [1, 0], [2, 0]], colour: '#2a9d8f' },
  { cells: [[0, 0], [0, 1], [0, 2], [0, 3]], colour: '#e63946' },
  { cells: [[0, 0], [1, 0], [2, 0], [3, 0]], colour: '#e63946' },
  { cells: [[0, 0], [0, 1], [1, 0], [1, 1]], colour: '#ff70a6' },
  { cells: [[0, 0], [1, 0], [1, 1]], colour: '#8338ec' },
  { cells: [[0, 1], [1, 0], [1, 1]], colour: '#8338ec' },
  { cells: [[0, 0], [0, 1], [1, 0]], colour: '#8338ec' },
  { cells: [[0, 0], [0, 1], [1, 1]], colour: '#8338ec' },
  { cells: [[0, 0], [1, 0], [2, 0], [2, 1]], colour: '#f4a261' },
  { cells: [[0, 0], [0, 1], [0, 2], [1, 0]], colour: '#f4a261' },
  { cells: [[0, 0], [0, 1], [0, 2], [1, 1]], colour: '#06d6a0' },
  { cells: [[0, 1], [1, 0], [1, 1], [2, 1]], colour: '#06d6a0' },
  { cells: [[0, 0], [0, 1], [1, 1], [1, 2]], colour: '#ef476f' },
  { cells: [[0, 1], [0, 2], [1, 0], [1, 1]], colour: '#ef476f' },
  { cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]], colour: '#118ab2' },
];

export const SHAPES = RAW_SHAPES.map((s, id) => ({
  id,
  ...s,
  rows: 1 + Math.max(...s.cells.map(([r]) => r)),
  cols: 1 + Math.max(...s.cells.map(([, c]) => c)),
}));

/** An empty board: SIZE rows of SIZE cells, each null or a colour. */
export function emptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

export function fits(board, shape, row, col) {
  return shape.cells.every(([r, c]) => {
    const y = row + r;
    const x = col + c;
    return y >= 0 && y < SIZE && x >= 0 && x < SIZE && board[y][x] === null;
  });
}

/** Rows and columns that would be full with the shape placed at row, col. */
function linesAfter(board, shape, row, col) {
  const taken = (y, x) => board[y][x] !== null || shape.cells.some(([r, c]) => row + r === y && col + c === x);
  const rows = [];
  const cols = [];
  for (let i = 0; i < SIZE; i++) {
    let rowFull = true;
    let colFull = true;
    for (let j = 0; j < SIZE; j++) {
      if (!taken(i, j)) rowFull = false;
      if (!taken(j, i)) colFull = false;
    }
    if (rowFull) rows.push(i);
    if (colFull) cols.push(i);
  }
  return { rows, cols };
}

/**
 * Places the shape and clears full lines, changing the board.
 * @returns {{cells:[number,number][], rows:number[], cols:number[]}} where it
 * went and which lines were cleared.
 */
export function place(board, shape, row, col) {
  if (!fits(board, shape, row, col)) throw new Error('does not fit');
  const cells = shape.cells.map(([r, c]) => [row + r, col + c]);
  const { rows, cols } = linesAfter(board, shape, row, col);
  for (const [y, x] of cells) board[y][x] = shape.colour;
  for (const y of rows) for (let x = 0; x < SIZE; x++) board[y][x] = null;
  for (const x of cols) for (let y = 0; y < SIZE; y++) board[y][x] = null;
  return { cells, rows, cols };
}

/**
 * Where the block goes when a child answers it. Prefers the spot that clears
 * the most lines, then the one that touches the most filled cells and walls
 * (keeping the board tidy so more blocks fit later), then the top left.
 * @returns {{row:number, col:number, lines:number}|null} null if it fits nowhere.
 */
export function bestPlacement(board, shape) {
  let best = null;
  for (let row = 0; row <= SIZE - shape.rows; row++) {
    for (let col = 0; col <= SIZE - shape.cols; col++) {
      if (!fits(board, shape, row, col)) continue;
      const { rows, cols } = linesAfter(board, shape, row, col);
      const lines = rows.length + cols.length;
      let touch = 0;
      for (const [r, c] of shape.cells) {
        for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const y = row + r + dy;
          const x = col + c + dx;
          if (y < 0 || y >= SIZE || x < 0 || x >= SIZE) touch++;
          else if (board[y][x] !== null) touch++;
        }
      }
      const value = lines * 100 + touch;
      if (!best || value > best.value) best = { row, col, lines, value };
    }
  }
  return best && { row: best.row, col: best.col, lines: best.lines };
}

export const fitsSomewhere = (board, shape) => bestPlacement(board, shape) !== null;

/**
 * Picks shapes for a new tray. Big shapes are less likely early on, and at
 * least one of them always fits the board if any shape could.
 */
export function pickShapes(board, n, random = Math.random) {
  const weight = (s) => (s.cells.length >= 9 ? 0.4 : s.cells.length >= 4 ? 0.8 : 1);
  const total = SHAPES.reduce((sum, s) => sum + weight(s), 0);
  const one = () => {
    let r = random() * total;
    for (const s of SHAPES) {
      r -= weight(s);
      if (r <= 0) return s;
    }
    return SHAPES[0];
  };
  const out = Array.from({ length: n }, one);
  if (!out.some((s) => fitsSomewhere(board, s))) {
    const fitting = SHAPES.filter((s) => fitsSomewhere(board, s));
    if (fitting.length) out[0] = fitting[Math.floor(random() * fitting.length)];
  }
  return out;
}

/** Points for placing a block: one per cell, plus a growing bonus per line. */
export function points(cells, lines) {
  return cells + (lines ? 10 * lines * lines : 0);
}
