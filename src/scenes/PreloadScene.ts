import Phaser from 'phaser';
import { IMG, SND_DUAL } from '../game/assetBase';
import { uiStyle } from '../game/uiFonts';
import { runWelcomeFlow } from '../ui/welcomeGate';
import { BONUS_TYPES, bonusTextureFolder } from '../game/bonusesData';
import { BLOCK_DEFS } from '../game/blockRegistry';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  preload() {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const bar = this.add.rectangle(w / 2, h / 2 + 40, 400, 12, 0x263238);
    const fill = this.add.rectangle(w / 2 - 200, h / 2 + 40, 0, 8, 0x5c6bc0).setOrigin(0, 0.5);
    this.load.on('progress', (p: number) => {
      fill.width = 400 * p;
    });
    this.load.on('loaderror', (file: { key?: string; url?: string }) => {
      console.error('[TGC] Asset load failed:', file?.key, file?.url);
    });

    this.add
      .text(w / 2, h / 2 - 20, 'Loading TGC Arkade...', uiStyle({ fontSize: '24px', color: '#eceff1' }))
      .setOrigin(0.5);

    const bhDone = new Set<string>();
    const blkKeys = new Set<string>();
    for (const d of BLOCK_DEFS) {
      if (!d.folder) continue;
      if (d.bhVariant === 'spinning' && !bhDone.has('spin')) {
        this.load.image('b-bh-spin', IMG('blocks/black-hole/spinning.png'));
        bhDone.add('spin');
        continue;
      }
      if (d.bhVariant === 'unstable' && !bhDone.has('unst')) {
        this.load.image('b-bh-unstable', IMG('blocks/black-hole/unstable.png'));
        bhDone.add('unst');
        continue;
      }
      if (d.bhVariant) continue;
      for (let f = 1; f <= d.frames; f++) {
        const key = `b-${d.folder}-${f}`;
        if (blkKeys.has(key)) continue;
        blkKeys.add(key);
        this.load.image(key, IMG(`blocks/${d.folder}/${f}.png`));
      }
    }

    this.load.image('bg-game', IMG('game-bg.jpg'));
    this.load.image('bg-bottom', IMG('game-bottom-line.png'));
    this.load.image('cv-back', IMG('game-canvas-bg-back.png'));
    this.load.image('cv-mid', IMG('game-canvas-bg-mid.png'));
    this.load.image('cv-front', IMG('game-canvas-bg-front.png'));

    this.load.image('ball-big', IMG('ball-big.png'));
    this.load.image('ball-normal', IMG('ball-normal.png'));
    this.load.image('ball-small', IMG('ball-small.png'));
    this.load.image('ball-steel', IMG('ball-steel.png'));

    this.load.image('pad-left', IMG('paddle-left.png'));
    this.load.image('pad-center', IMG('paddle-center.png'));
    this.load.image('pad-right', IMG('paddle-right.png'));
    this.load.image('pad-barrel', IMG('paddle-barrel.png'));
    this.load.image('pad-bullet', IMG('paddle-bullet.png'));

    this.load.image('btn-help', IMG('btn-help.png'));
    this.load.image('btn-options', IMG('btn-options.png'));
    this.load.image('btn-play', IMG('btn-play.png'));
    this.load.image('btn-user', IMG('btn-user.png'));
    this.load.image('dashboard-bg', IMG('dashboard-bg.png'));
    this.load.image('dashboard-speed', IMG('dashboard-speed.png'));

    const bonusFolders = new Set<string>();
    for (const b of BONUS_TYPES) {
      bonusFolders.add(bonusTextureFolder(b.name));
    }
    for (const folder of bonusFolders) {
      this.load.image(`bonus-${folder}`, IMG(`bonuses/${folder}/1.png`));
    }

    const tailSizes = ['small', 'normal', 'big'] as const;
    for (const sz of tailSizes) {
      this.load.image(`pt-${sz}-default`, IMG(`particles/${sz}/default.png`));
    }
    this.load.image('pt-big-steel', IMG('particles/big/default.png'));
    for (const d of BLOCK_DEFS) {
      if (!d.folder || d.bhVariant) continue;
      for (const sz of tailSizes) {
        this.load.image(`pt-${sz}-${d.folder}`, IMG(`particles/${sz}/${d.folder}.png`));
      }
    }

    const sfx = (key: string, base: string) => this.load.audio(key, SND_DUAL(base));
    sfx('s-block-1', 'block-hit-1');
    sfx('s-block-2', 'block-hit-2');
    sfx('s-block-3', 'block-hit-3');
    sfx('s-block-4', 'block-hit-4');
    sfx('s-block-ind', 'block-indestructible-hit');
    sfx('s-bonus', 'bonus-catch');
    sfx('s-paddle', 'paddle-hit');
    sfx('s-wall', 'wall-hit');
    sfx('s-win', 'win');
    sfx('s-lost', 'lost-ball');
    sfx('s-gun', 'gun');
    sfx('s-music', 'music');

    this.load.spritesheet('b-101_gray-anim', IMG('blocks/101_gray/anim.png'), {
      frameWidth: 38,
      frameHeight: 21,
      endFrame: 20,
    });
  }

  create() {
    this.scale.refresh();
    if (this.textures.exists('b-101_gray-anim') && !this.anims.exists('gray-metal-loop')) {
      this.anims.create({
        key: 'gray-metal-loop',
        frames: this.anims.generateFrameNumbers('b-101_gray-anim', { start: 0, end: 16 }),
        frameRate: 4,
        repeat: -1,
      });
    }
    runWelcomeFlow(this);
  }
}
