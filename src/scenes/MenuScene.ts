import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../game/constants';
import { titleStyle, uiStyle } from '../game/uiFonts';
import { getGameOptions, setGameOptions } from '../game/gameOptions';
import { syncBgm } from '../game/bgm';
import { openTgcOverlay, setTgcOverlayContext } from '../ui/tgcOverlay';
import { SPACE_LEVEL_STRINGS } from '../data/spaceLevels';

const DASH_W = 417;
const DASH_H = 214;

export class MenuScene extends Phaser.Scene {
  private modalLayer?: Phaser.GameObjects.Container;

  constructor() {
    super('MenuScene');
  }

  create() {
    document.body.classList.remove('tgc-playing-game');
    try {
      this.physics.world.resume();
    } catch {
      /* */
    }
    if (this.sys.isPaused()) {
      this.sys.resume();
    }
    this.input.enabled = true;
    this.scale.refresh();
    this.input.once('pointerdown', () => {
      this.sound.unlock();
    });

    setTgcOverlayContext({
      getMaxUnlockedLevel: () =>
        Math.min(
          Number(localStorage.getItem('tgc_max_level') || '0') || 0,
          SPACE_LEVEL_STRINGS.length - 1
        ),
      onOpen: () => {},
      onClose: () => {},
    });

    this.cameras.main.setBackgroundColor(0x0a0e1a);
    this.add.image(0, 0, 'bg-game').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(-2);
    this.add.image(0, 0, 'cv-back').setOrigin(0).setDepth(-1);
    this.add.image(0, 0, 'cv-mid').setOrigin(0).setDepth(0);

    syncBgm(this);

    const ox = (GAME_WIDTH - DASH_W) / 2;
    const oy = 56;
    const dash = this.add.container(ox, oy);

    if (this.textures.exists('dashboard-bg')) {
      dash.add(this.add.image(0, 0, 'dashboard-bg').setOrigin(0).setDepth(1));
    }

    this.add
      .text(GAME_WIDTH / 2, 22, 'TGC Arkade — Space', uiStyle({
        fontSize: '26px',
        color: '#eceff1',
      }))
      .setOrigin(0.5, 0)
      .setDepth(5);

    const mkBtn = (key: string, x: number, y: number, fn: () => void) => {
      if (!this.textures.exists(key)) return;
      const im = this.add
        .image(ox + x, oy + y, key)
        .setOrigin(0, 0)
        .setDepth(10)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', fn);
      return im;
    };

    mkBtn('btn-play', 21, 144, () => {
      this.scene.start('LevelSelectScene');
    });

    mkBtn('btn-options', 45, 169, () => this.showOptionsModal());

    mkBtn('btn-help', 73, 184, () => this.showHelpModal());

    mkBtn('btn-user', 12, 113, () => openTgcOverlay());

    this.add
      .text(GAME_WIDTH / 2, oy + DASH_H + 18, 'New game (reset progress)', uiStyle({
        fontSize: '18px',
        color: '#78909c',
      }))
      .setOrigin(0.5, 0)
      .setDepth(10)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => {
        this.scene.start('MainGame', { resetAll: true });
      });

    this.add
      .text(12, GAME_HEIGHT - 14, 'Space episode · 51 stages', uiStyle({
        fontSize: '16px',
        color: '#546e7a',
      }))
      .setOrigin(0, 1)
      .setDepth(10);
  }

  private clearModal() {
    this.modalLayer?.destroy(true);
    this.modalLayer = undefined;
  }

  private showHelpModal() {
    this.clearModal();
    const c = this.add.container(0, 0).setDepth(200);
    this.modalLayer = c;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.72);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    c.add(g);

    const body =
      'Move the paddle with the mouse, touch, or ← → keys.\n' +
      'Click or tap to launch balls stuck on the paddle.\n' +
      'Destroy all colored blocks to clear the stage.\n' +
      'Gray metal blocks cannot be broken.\n' +
      'Catch bonuses — some help, some hurt.\n' +
      'P pauses · M returns to this menu · Esc closes profile.';

    const txt = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20, 'How to play', titleStyle({
        fontSize: '16px',
        color: '#fff59d',
        align: 'center',
      }))
      .setOrigin(0.5);

    const sub = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 24, body, uiStyle({
        fontSize: '20px',
        color: '#cfd8dc',
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 80 },
      }))
      .setOrigin(0.5, 0);

    const close = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 36, 'Close', uiStyle({
        fontSize: '22px',
        color: '#90caf9',
      }))
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.clearModal());

    c.add([txt, sub, close]);
  }

  private showOptionsModal() {
    this.clearModal();
    const c = this.add.container(0, 0).setDepth(200);
    this.modalLayer = c;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.72);
    g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    c.add(g);

    const title = this.add
      .text(GAME_WIDTH / 2, 110, 'Options', titleStyle({ fontSize: '18px', color: '#fff59d' }))
      .setOrigin(0.5);

    const musicLine = this.add
      .text(GAME_WIDTH / 2, 170, '', uiStyle({ fontSize: '24px', color: '#eceff1' }))
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    const sfxLine = this.add
      .text(GAME_WIDTH / 2, 210, '', uiStyle({ fontSize: '24px', color: '#eceff1' }))
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    const redraw = () => {
      const o = getGameOptions();
      musicLine.setText(`Music: ${o.musicOn ? 'ON' : 'OFF'}`);
      sfxLine.setText(`Sound effects: ${o.sfxOn ? 'ON' : 'OFF'}`);
    };

    musicLine.on('pointerdown', () => {
      setGameOptions({ musicOn: !getGameOptions().musicOn });
      redraw();
      syncBgm(this);
    });
    sfxLine.on('pointerdown', () => {
      setGameOptions({ sfxOn: !getGameOptions().sfxOn });
      redraw();
    });

    redraw();

    const close = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 36, 'Close', uiStyle({
        fontSize: '22px',
        color: '#90caf9',
      }))
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.clearModal());

    c.add([title, musicLine, sfxLine, close]);
  }
}
