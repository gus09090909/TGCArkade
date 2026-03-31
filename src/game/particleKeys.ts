import { getBlockDef } from './blockRegistry';

export type TailSize = 'small' | 'normal' | 'big';

/** Texture key loaded in PreloadScene (`pt-*`). */
export function particleTextureKey(size: TailSize, typeId: number, steel: boolean): string {
  if (steel) return 'pt-big-steel';
  const d = getBlockDef(typeId);
  if (!d.folder || d.bhVariant) return `pt-${size}-default`;
  return `pt-${size}-${d.folder}`;
}
