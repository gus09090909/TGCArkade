/**
 * Same web fonts as classic TGC-Arkade (linked in index.html).
 * VT323 for body/UI; Press Start 2P sparingly for short titles (it is wide).
 */
export const FONT_UI = '"VT323", "Courier New", monospace';
export const FONT_TITLE = '"Press Start 2P", monospace';

import type { TextStyle } from 'phaser';

export function uiStyle(style: TextStyle): TextStyle {
  return { ...style, fontFamily: FONT_UI };
}

export function titleStyle(style: TextStyle): TextStyle {
  return { ...style, fontFamily: FONT_TITLE };
}
