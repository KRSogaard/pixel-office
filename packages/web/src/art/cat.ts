/** Byte the cat in pixel art: walk, walk (facing left), sit, sleep, sleep. */

export const CAT_W = 16;
export const CAT_H = 12;
const W = CAT_W;
const H = CAT_H;

export function buildCatSheet(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = W * 5;
  c.height = H;
  const g = c.getContext("2d")!;
  const fur = "#e08a3c";
  const dark = "#b0642a";
  const belly = "#f6d3a8";
  const ink = "#2b2118";
  const px = (f: number, color: string, x: number, y: number, w = 1, h = 1) => {
    g.fillStyle = color;
    g.fillRect(f * W + x, y, w, h);
  };
  // Walking, facing left: 2 frames.
  for (const f of [0, 1]) {
    px(f, fur, 3, 5, 9, 4); // body
    px(f, dark, 5, 5, 1, 4);
    px(f, dark, 8, 5, 1, 4);
    px(f, belly, 4, 8, 7, 1);
    px(f, fur, 0, 2, 5, 4); // head
    px(f, fur, 0, 1, 1, 1); // ears
    px(f, fur, 3, 1, 1, 1);
    px(f, ink, 1, 3, 1, 1); // eye
    px(f, "#ff9fb0", 0, 4, 1, 1); // nose
    px(f, fur, 12, 3 + f, 1, 3); // tail
    px(f, fur, 13, 2 + f, 1, 2);
    const a = f ? 1 : 0;
    px(f, fur, 3 + a, 9, 1, 2); // legs
    px(f, fur, 6 - a, 9, 1, 2);
    px(f, fur, 9 + a, 9, 1, 2);
    px(f, fur, 11 - a, 9, 1, 2);
  }
  // Sitting, facing the viewer.
  px(2, fur, 5, 4, 6, 7);
  px(2, belly, 6, 7, 4, 4);
  px(2, fur, 4, 1, 8, 5);
  px(2, fur, 4, 0, 1, 1);
  px(2, fur, 11, 0, 1, 1);
  px(2, ink, 6, 3, 1, 1);
  px(2, ink, 9, 3, 1, 1);
  px(2, "#ff9fb0", 7, 4, 2, 1);
  px(2, fur, 11, 9, 3, 2);
  // Sleeping curl: 2 breathing frames.
  for (const f of [3, 4]) {
    const b = f === 4 ? 1 : 0;
    px(f, fur, 3, 6 - b, 10, 5 + b);
    px(f, dark, 6, 6 - b, 1, 3);
    px(f, dark, 9, 6 - b, 1, 3);
    px(f, fur, 2, 7, 4, 4);
    px(f, fur, 2, 6, 1, 1);
    px(f, ink, 3, 9, 2, 1); // closed eye
    px(f, fur, 12, 9, 3, 2);
  }
  return c;
}
