/** Mirrors `js/app/episodes/space/bonuses.js` */
export type BonusTypeDef = {
  name: string;
  score: number;
  create_rate: number;
  max_incidence?: number;
};

export const BONUS_TYPES: BonusTypeDef[] = [
  { name: '3-balls', score: 5, create_rate: 3 },
  { name: 'big-ball', score: 5, create_rate: 3 },
  { name: 'die', score: -5, create_rate: 15 },
  { name: 'extra-life', score: 5, create_rate: 12, max_incidence: 1 },
  { name: 'glue-paddle', score: 5, create_rate: 3 },
  { name: 'grow-paddle', score: 5, create_rate: 2 },
  { name: 'shrink-paddle', score: -5, create_rate: 2 },
  { name: 'score', score: 10, create_rate: 2 },
  { name: 'score', score: 50, create_rate: 3 },
  { name: 'score', score: 100, create_rate: 4 },
  { name: 'small-ball', score: -5, create_rate: 2 },
  { name: 'steel-ball', score: 5, create_rate: 8, max_incidence: 2 },
  { name: 'laser', score: 5, create_rate: 6, max_incidence: 2 },
];

/** Asset folder under bonuses/ (underscores) */
export function bonusTextureFolder(name: string): string {
  return name.replace(/-/g, '_');
}
