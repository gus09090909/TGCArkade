import { CELL_H, CELL_W } from './constants';

export type PlacedBlock = {
  x: number;
  y: number;
  typeId: number;
};

export type ParsedLevel = {
  name: string;
  blocks: PlacedBlock[];
};

/** Same format as original: `LevelName:x,y,typeId;...` */
export function parseLevelString(raw: string): ParsedLevel {
  const colon = raw.indexOf(':');
  const name = colon >= 0 ? raw.slice(0, colon) : 'level';
  const body = colon >= 0 ? raw.slice(colon + 1) : raw;
  const blocks: PlacedBlock[] = [];
  for (const part of body.split(';')) {
    const t = part.trim();
    if (!t) continue;
    const coords = t.split(',');
    if (coords.length < 3) continue;
    const x = parseFloat(coords[0]);
    const y = parseFloat(coords[1]);
    const typeId = parseInt(coords[2], 10);
    if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(typeId)) continue;
    blocks.push({ x, y, typeId });
  }
  return { name, blocks };
}

export function blockWorldRect(b: PlacedBlock) {
  return {
    x: b.x,
    y: b.y,
    w: CELL_W,
    h: CELL_H,
    cx: b.x + CELL_W / 2,
    cy: b.y + CELL_H / 2,
  };
}
