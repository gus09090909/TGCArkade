import Phaser from 'phaser';
import { getLocalHighScore } from '../api/tgcCloud';
import { SPACE_LEVEL_STRINGS } from '../data/spaceLevels';
import { CELL_H, CELL_W, GAME_HEIGHT, GAME_WIDTH } from '../game/constants';
import { syncBgm } from '../game/bgm';
import { getBlockDef } from '../game/blockRegistry';
import { uiStyle } from '../game/uiFonts';
import { parseLevelString } from '../game/parseLevel';

const TW = 112;
const TH = 62;
const COLS = 4;
const ROWS = 3;
const PER_PAGE = COLS * ROWS;
const PAD_X = 8;
const PAD_Y = 6;
const TOP = 50;
const FOOT = 44;

function maxUnlockedIndex(): number {
  return Math.min(
    Math.max(0, Number(localStorage.getItem('tgc_max_level') || '0') || 0),
    SPACE_LEVEL_STRINGS.length - 1
  );
}

function ensureThumbTexture(scene: Phaser.Scene, levelIndex: number): string {
  const key = `lvl-thumb-${levelIndex}`;
  if (scene.textures.exists(key)) return key;
  const g = scene.make.graphics({ x: 0, y: 0, add: false });
  g.fillStyle(0x050810, 1);
  g.fillRect(0, 0, TW, TH);
  const parsed = parseLevelString(SPACE_LEVEL_STRINGS[levelIndex]);
  const sx = TW / GAME_WIDTH;
  const sy = TH / GAME_HEIGHT;
  for (const p of parsed.blocks) {
    const def = getBlockDef(p.typeId);
    if (!def.collidable) continue;
    g.fillStyle(def.fill, 1);
    g.fillRect(
      p.x * sx,
      p.y * sy,
      Math.max(1, CELL_W * sx - 0.25),
      Math.max(1, CELL_H * sy - 0.25)
    );
  }
  g.generateTexture(key, TW, TH);
  g.destroy();
  return key;
}

export class LevelSelectScene extends Phaser.Scene {
  private pageRoot?: Phaser.GameObjects.Container;
  private page = 0;
  private pageLabel?: Phaser.GameObjects.Text;

  constructor() {
    super('LevelSelectScene');
  }

  create() {
    this.cameras.main.setBackgroundColor(0x050810);
    this.add
      .rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0a0e1a, 0.96)
      .setOrigin(0)
      .setDepth(-5);

    syncBgm(this);
    this.input.once('pointerdown', () => this.sound.unlock());

    const maxU = maxUnlockedIndex();
    const hi = getLocalHighScore();

    this.add
      .text(GAME_WIDTH / 2, 14, 'Select stage', uiStyle({ fontSize: '28px', color: '#fff59d' }))
      .setOrigin(0.5, 0)
      .setDepth(10);

    this.add
      .text(
        GAME_WIDTH / 2,
        40,
        `Progress: stages 1–${maxU + 1} open  ·  Best score: ${hi}`,
        uiStyle({ fontSize: '16px', color: '#90a4ae' })
      )
      .setOrigin(0.5, 0)
      .setDepth(10);

    const maxPage = Math.max(0, Math.ceil(SPACE_LEVEL_STRINGS.length / PER_PAGE) - 1);

    this.pageLabel = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - FOOT + 4, '', uiStyle({ fontSize: '18px', color: '#b0bec5' }))
      .setOrigin(0.5, 0)
      .setDepth(25);

    const mkNav = (label: string, x: number, dx: number) =>
      this.add
        .text(x, GAME_HEIGHT - FOOT + 2, label, uiStyle({ fontSize: '20px', color: '#90caf9' }))
        .setOrigin(dx === 0 ? 0.5 : dx < 0 ? 0 : 1, 0)
        .setDepth(25)
        .setInteractive({ useHandCursor: true });

    const prev = mkNav('◀ Prev', 24, -1);
    const next = mkNav('Next ▶', GAME_WIDTH - 24, 1);

    prev.on('pointerdown', () => {
      if (this.page > 0) {
        this.page--;
        this.renderPage(maxU);
      }
    });
    next.on('pointerdown', () => {
      if (this.page < maxPage) {
        this.page++;
        this.renderPage(maxU);
      }
    });

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 10, 'Menu', uiStyle({ fontSize: '20px', color: '#78909c' }))
      .setOrigin(0.5, 1)
      .setDepth(25)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('MenuScene'));

    this.renderPage(maxU);
  }

  private renderPage(maxU: number) {
    this.pageRoot?.destroy(true);
    const c = this.add.container(0, 0).setDepth(15);
    this.pageRoot = c;

    const cellW = TW + PAD_X * 2;
    const cellH = TH + 28;
    const gridW = COLS * cellW;
    const startX = (GAME_WIDTH - gridW) / 2 + PAD_X;
    const startY = TOP;

    const maxPage = Math.max(0, Math.ceil(SPACE_LEVEL_STRINGS.length / PER_PAGE) - 1);
    if (this.pageLabel) {
      this.pageLabel.setText(`Page ${this.page + 1} / ${maxPage + 1}`);
    }

    const from = this.page * PER_PAGE;
    const to = Math.min(from + PER_PAGE, SPACE_LEVEL_STRINGS.length);

    let idx = 0;
    for (let i = from; i < to; i++) {
      const col = idx % COLS;
      const row = Math.floor(idx / COLS);
      idx++;

      const locked = i > maxU;
      const parsed = parseLevelString(SPACE_LEVEL_STRINGS[i]);
      const shortName =
        parsed.name.length > 12 ? parsed.name.slice(0, 10) + '…' : parsed.name;
      const x = startX + col * cellW;
      const y = startY + row * cellH;

      const tex = ensureThumbTexture(this, i);
      const frame = this.add.image(x + TW / 2, y + TH / 2, tex).setDepth(2);
      c.add(frame);

      if (locked) {
        frame.setAlpha(0.32);
        c.add(
          this.add
            .rectangle(x + TW / 2, y + TH / 2, TW + 3, TH + 3, 0x000000, 0.5)
            .setDepth(3)
        );
        c.add(
          this.add
            .text(x + TW / 2, y + TH / 2, 'LOCK', uiStyle({ fontSize: '18px', color: '#607d8b' }))
            .setOrigin(0.5)
            .setDepth(4)
        );
      } else {
        frame.setInteractive({ useHandCursor: true });
        frame.on('pointerdown', () => {
          this.scene.start('MainGame', { level: i });
        });
      }

      c.add(
        this.add
          .text(x + TW / 2, y + TH + 6, `${i + 1}. ${shortName}`, uiStyle({
            fontSize: '14px',
            color: locked ? '#455a64' : '#cfd8dc',
          }))
          .setOrigin(0.5, 0)
          .setDepth(5)
      );
    }
  }
}
