import type { Activity } from "@pixel-office/protocol";

/**
 * Little animated icons that float next to an agent's head and show what it's
 * doing right now: a thought cloud filling with dots, a book flipping pages, a
 * terminal printing lines, a globe turning… All drawn in code, 12×12 per frame.
 */

export const FX_SIZE = 12;

type Px = (color: string, x: number, y: number, w?: number, h?: number) => void;
type Painter = (px: Px, frame: number) => void;

const INK = "#1d1f27";
const PAPER = "#fdfbf5";

const think: Painter = (px, f) => {
  // Cloud
  px(PAPER, 2, 1, 9, 6);
  px(PAPER, 1, 2, 11, 4);
  px(INK, 2, 0, 9, 1);
  px(INK, 2, 7, 9, 1);
  px(INK, 0, 2, 1, 4);
  px(INK, 12 - 1, 2, 1, 4);
  px(INK, 1, 1, 1, 1);
  px(INK, 11 - 1, 1, 1, 1);
  px(INK, 1, 6, 1, 1);
  px(INK, 11 - 1, 6, 1, 1);
  // Dots fill in one by one.
  for (let i = 0; i < 3; i++) if (f > i) px(INK, 3 + i * 3, 4, 2, 1);
  // Trailing puffs toward the head.
  px(PAPER, 1, 9, 2, 2);
  px(INK, 1, 11, 2, 1);
  px(PAPER, 0, 11, 1, 1);
};

const edit: Painter = (px, f) => {
  px(INK, 1, 0, 9, 12);
  px(PAPER, 2, 1, 7, 10);
  const lines = [5, 3, 6, 4];
  for (let i = 0; i < 4; i++) {
    const w = i < f ? lines[i]! : i === f ? Math.ceil(lines[i]! / 2) : 0;
    if (w) px(i % 2 ? "#4f81bd" : "#7d8590", 3, 2 + i * 2, w, 1);
  }
  // Pencil
  px("#f2c14e", 9, 4 + (f % 2), 2, 5);
  px("#b5654a", 9, 9 + (f % 2), 2, 1);
  px(INK, 10, 10 + (f % 2), 1, 1);
};

const read: Painter = (px, f) => {
  // Open book
  px(INK, 0, 3, 12, 8);
  px(PAPER, 1, 4, 5, 6);
  px(PAPER, 6, 4, 5, 6);
  px(INK, 6, 3, 0 + 1, 8);
  for (let i = 0; i < 3; i++) {
    px("#9097a6", 2, 5 + i * 2, 3, 1);
    px("#9097a6", 7, 5 + i * 2, 3, 1);
  }
  // Page turning over.
  if (f === 1) {
    px(PAPER, 6, 1, 3, 7);
    px(INK, 9, 1, 1, 7);
  } else if (f === 2) {
    px(PAPER, 3, 1, 3, 7);
    px(INK, 2, 1, 1, 7);
  }
};

const shell: Painter = (px, f) => {
  px("#3b3f4a", 0, 0, 12, 12);
  px("#11131a", 1, 2, 10, 9);
  px("#ff5d5d", 1, 0, 1, 1);
  px("#f0c45a", 3, 0, 1, 1);
  px("#5af07a", 5, 0, 1, 1);
  const rows = Math.min(3, f);
  for (let i = 0; i < rows; i++) px("#5af07a", 2, 3 + i * 2, 3 + ((i * 5 + f) % 5), 1);
  // Prompt + blinking cursor
  px("#5af07a", 2, 9, 1, 1);
  if (f % 2 === 0) px("#e9e4d8", 4, 9, 2, 1);
};

const test: Painter = (px, f) => {
  // A flask bubbling away.
  px(INK, 4, 0, 4, 1);
  px("#e9f6fb", 5, 1, 2, 4);
  px(INK, 4, 1, 1, 4);
  px(INK, 7, 1, 1, 4);
  px(INK, 1, 5, 10, 7);
  px("#e9f6fb", 2, 6, 8, 5);
  px("#5af07a", 2, 8, 8, 3);
  px("#b8f5c8", 3 + (f % 3) * 2, 9 - (f % 2), 1, 1);
  if (f > 0) px("#5af07a", 6, 3 - (f % 2), 1, 1);
  if (f > 1) px("#5af07a", 5, 1 - (f % 2) + 1, 1, 1);
};

const git: Painter = (px, f) => {
  // A branch graph: two commits on a line, one branching off, the newest blinking.
  const line = "#f0c45a";
  px(line, 2, 1, 1, 10);
  px(line, 3, 7, 2, 1);
  px(line, 5, 4, 1, 4);
  px(line, 6, 4, 3, 1);
  px(INK, 1, 1, 3, 3);
  px("#ff9a3c", 2, 2, 1, 1);
  px(INK, 1, 8, 3, 3);
  px("#ff9a3c", 2, 9, 1, 1);
  px(INK, 8, 3, 3, 3);
  px(f % 2 ? "#5af07a" : "#ff9a3c", 9, 4, 1, 1);
};

const web: Painter = (px, f) => {
  px(INK, 2, 0, 8, 12);
  px(INK, 0, 2, 12, 8);
  px("#3f8fd1", 2, 1, 8, 10);
  px("#3f8fd1", 1, 2, 10, 8);
  // Continents slide across as the globe turns.
  const o = f * 3;
  const land = "#58b06a";
  for (const [x, y, w, h] of [
    [1, 3, 3, 2],
    [5, 6, 3, 3],
    [8, 2, 2, 2],
  ] as const) {
    const lx = ((x + o) % 12) + 0;
    if (lx < 11) px(land, Math.max(1, lx), y, Math.min(w, 11 - lx), h);
  }
  px("#d9f2fb", 3, 2, 1, 1);
};

const mail: Painter = (px, f) => {
  const y = f % 2 ? 1 : 2;
  px(INK, 0, y + 1, 12, 8);
  px(PAPER, 1, y + 2, 10, 6);
  px(INK, 2, y + 3, 1, 1);
  px(INK, 3, y + 4, 2, 1);
  px(INK, 5, y + 5, 2, 1);
  px(INK, 7, y + 4, 2, 1);
  px(INK, 9, y + 3, 1, 1);
  if (f % 2) px("#f0c45a", 10, 0, 2, 2);
};

const compact: Painter = (px, f) => {
  px("#7d8590", 1, 6, 10, 6);
  px("#a9b0ba", 2, 7, 8, 1);
  const h = f % 2 ? 2 : 4;
  px(PAPER, 3, 6 - h, 6, h);
  px(INK, 3, 6 - h, 6, 1);
};

const delegate: Painter = (px, f) => {
  // Two heads, arrow between.
  px("#f6d3b3", 0, 3, 4, 4);
  px("#5a3a22", 0, 2, 4, 1);
  px("#4f81bd", 0, 7, 4, 3);
  px("#f6d3b3", 8, 3, 4, 4);
  px("#2b2118", 8, 2, 4, 1);
  px("#c0504d", 8, 7, 4, 3);
  const ax = 4 + (f % 2);
  px(INK, ax, 5, 3, 1);
  px(INK, ax + 2, 4, 1, 3);
};

const message: Painter = (px, f) => {
  px(INK, 0, 1, 12, 8);
  px(PAPER, 1, 2, 10, 6);
  px(PAPER, 2, 9, 2, 2);
  px(INK, 2, 11, 1, 1);
  for (let i = 0; i < 3; i++) if ((f + i) % 3 !== 0) px(INK, 3 + i * 2, 5, 1, 1);
};

const waiting: Painter = (px, f) => {
  if (f % 2) return;
  px("#ff5d5d", 4, 0, 4, 12);
  px("#fff", 5, 1, 2, 6);
  px("#fff", 5, 9, 2, 2);
};

const other: Painter = (px, f) => {
  const c = "#a9b0ba";
  px(c, 3, 3, 6, 6);
  px(INK, 5, 5, 2, 2);
  const teeth = f % 2 ? [[5, 0], [5, 10], [0, 5], [10, 5]] : [[1, 1], [9, 1], [1, 9], [9, 9]];
  for (const [x, y] of teeth) px(c, x!, y!, 2, 2);
};

const idle: Painter = (px, f) => {
  const z = (x: number, y: number) => {
    px("#9097a6", x, y, 3, 1);
    px("#9097a6", x + 1, y + 1, 1, 1);
    px("#9097a6", x, y + 2, 3, 1);
  };
  z(1, 8 - f);
  if (f > 0) z(5, 5 - f);
  if (f > 1) z(8, 1);
};

const PAINTERS: Partial<Record<Activity, { painter: Painter; frames: number; fps: number }>> = {
  thinking: { painter: think, frames: 4, fps: 2.5 },
  edit: { painter: edit, frames: 4, fps: 3 },
  read: { painter: read, frames: 3, fps: 2.5 },
  shell: { painter: shell, frames: 4, fps: 3 },
  test: { painter: test, frames: 3, fps: 3 },
  git: { painter: git, frames: 2, fps: 2 },
  web: { painter: web, frames: 4, fps: 3 },
  mcp: { painter: mail, frames: 2, fps: 2 },
  compact: { painter: compact, frames: 2, fps: 2 },
  delegate: { painter: delegate, frames: 2, fps: 2 },
  message: { painter: message, frames: 3, fps: 3 },
  waiting: { painter: waiting, frames: 2, fps: 2 },
  other: { painter: other, frames: 2, fps: 3 },
  idle: { painter: idle, frames: 3, fps: 1 },
};

export interface FxStrip {
  /** First frame index of this activity in the sheet. */
  start: number;
  frames: number;
  fps: number;
}

/** One sheet with every activity's frames side by side, plus where each strip starts. */
export function buildFxSheet(): { canvas: HTMLCanvasElement; strips: Partial<Record<Activity, FxStrip>> } {
  const entries = Object.entries(PAINTERS) as [Activity, { painter: Painter; frames: number; fps: number }][];
  const total = entries.reduce((n, [, p]) => n + p.frames, 0);
  const canvas = document.createElement("canvas");
  canvas.width = total * FX_SIZE;
  canvas.height = FX_SIZE;
  const ctx = canvas.getContext("2d")!;
  const strips: Partial<Record<Activity, FxStrip>> = {};
  let i = 0;
  for (const [activity, { painter, frames, fps }] of entries) {
    strips[activity] = { start: i, frames, fps };
    for (let f = 0; f < frames; f++, i++) {
      const ox = i * FX_SIZE;
      painter((color, x, y, w = 1, h = 1) => {
        ctx.fillStyle = color;
        ctx.fillRect(ox + x, y, w, h);
      }, f);
    }
  }
  return { canvas, strips };
}
