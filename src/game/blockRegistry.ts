/** Block metadata + sprite folder (underscore names on disk). Mirrors `space/blocks.js`. */
export type BlockDef = {
  fill: number;
  destroyable: boolean;
  hardness: number;
  score: number;
  primary: boolean;
  collidable: boolean;
  /** Subfolder under `blocks/`; null = no sprite sheet (use fill only fallback). */
  folder: string | null;
  /** Progressive crack frames 1..frames (401=3, 402=2, else 1). */
  frames: number;
  /** Black hole decorative variant. */
  bhVariant?: 'spinning' | 'unstable';
  /** Indestructible gray metal loop (spritesheet `101_gray/anim.png`). */
  grayMetalAnim?: boolean;
  /** Floating “+score” pop when block is destroyed (scale-down, original multi-hit blocks). */
  animateScore?: boolean;
};

const c = (hex: string) => parseInt(hex.replace('#', ''), 16);

export const BLOCK_DEFS: BlockDef[] = [
  { fill: c('#1a1a1a'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '100_black', frames: 1 },
  {
    fill: c('#6b6b6b'),
    destroyable: false,
    hardness: 1,
    score: 0,
    primary: false,
    collidable: true,
    folder: '101_gray',
    frames: 1,
    grayMetalAnim: true,
  },
  { fill: c('#c4c4c4'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '103_light_gray', frames: 1 },
  { fill: c('#ffffff'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '104_white', frames: 1 },
  { fill: c('#ffeb3b'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '200_yellow', frames: 1 },
  { fill: c('#c7a500'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '201_dark_yellow', frames: 1 },
  { fill: c('#ff9800'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '202_spring_orange', frames: 1 },
  { fill: c('#ff6f00'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '203_orange', frames: 1 },
  { fill: c('#e53935'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '205_red', frames: 1 },
  { fill: c('#c62828'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '206_carmin', frames: 1 },
  { fill: c('#fff59d'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '300_light_yellow', frames: 1 },
  { fill: c('#76ff03'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '301_crazy_green', frames: 1 },
  { fill: c('#c6ff00'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '302_yellow_mint', frames: 1 },
  { fill: c('#26a69a'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '303_mint', frames: 1 },
  { fill: c('#2e7d32'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '304_green', frames: 1 },
  { fill: c('#1b5e20'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '305_dark_green', frames: 1 },
  { fill: c('#0d3d12'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '306_black_green', frames: 1 },
  { fill: c('#4fc3f7'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '400_light_blue', frames: 1 },
  {
    fill: c('#0288d1'),
    destroyable: true,
    hardness: 3,
    score: 30,
    primary: true,
    collidable: true,
    folder: '401_light_blue',
    frames: 3,
    animateScore: true,
  },
  {
    fill: c('#1565c0'),
    destroyable: true,
    hardness: 2,
    score: 20,
    primary: true,
    collidable: true,
    folder: '402_blue',
    frames: 2,
    animateScore: true,
  },
  { fill: c('#0d47a1'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '403_dos', frames: 1 },
  { fill: c('#051c3d'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '404_dark_dos', frames: 1 },
  { fill: c('#f48fb1'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '500_apink', frames: 1 },
  { fill: c('#f06292'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '501_light_pink', frames: 1 },
  { fill: c('#ec407a'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '502_pink', frames: 1 },
  { fill: c('#ab47bc'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '503_violet', frames: 1 },
  { fill: c('#6a1b9a'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '504_dark_violet', frames: 1 },
  { fill: c('#b71c1c'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '600_red_blood', frames: 1 },
  { fill: c('#d7a574'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '601_light_brown', frames: 1 },
  { fill: c('#8d6e63'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '602_brown', frames: 1 },
  { fill: c('#4e342e'), destroyable: true, hardness: 1, score: 10, primary: true, collidable: true, folder: '603_dark_brown', frames: 1 },
  {
    fill: c('#311b92'),
    destroyable: false,
    hardness: 1,
    score: 0,
    primary: false,
    collidable: false,
    folder: 'black-hole',
    frames: 1,
    bhVariant: 'spinning',
  },
  {
    fill: c('#6200ea'),
    destroyable: false,
    hardness: 1,
    score: 0,
    primary: false,
    collidable: false,
    folder: 'black-hole',
    frames: 1,
    bhVariant: 'unstable',
  },
];

export function getBlockDef(typeId: number): BlockDef {
  return BLOCK_DEFS[typeId] ?? BLOCK_DEFS[0];
}

/** Texture key registered in PreloadScene (`b-*`). */
export function blockTextureKey(typeId: number, hitsTaken: number): string | null {
  const d = getBlockDef(typeId);
  if (!d.folder) return null;
  if (d.bhVariant === 'spinning') return 'b-bh-spin';
  if (d.bhVariant === 'unstable') return 'b-bh-unstable';
  const frame = Math.min(Math.max(1, hitsTaken + 1), d.frames);
  return `b-${d.folder}-${frame}`;
}
