import Phaser from 'phaser';
import { SPACE_LEVEL_STRINGS } from '../data/spaceLevels';
import {
  fetchProfile,
  getLocalHighScore,
  getStoredUsername,
  pushProfile,
  sessionEnd,
  setLocalHighScore,
  type Profile,
} from '../api/tgcCloud';
import { BALL_RADIUS, GAME_HEIGHT, GAME_WIDTH, PADDLE_Y } from '../game/constants';
import { syncEvaluatedAchievementsToCloud } from '../game/achievements';
import { uiStyle } from '../game/uiFonts';
import { blockTextureKey, getBlockDef } from '../game/blockRegistry';
import { blockWorldRect, parseLevelString, type PlacedBlock } from '../game/parseLevel';
import { BONUS_TYPES, bonusTextureFolder, type BonusTypeDef } from '../game/bonusesData';
import { syncBgm } from '../game/bgm';
import { getGameOptions } from '../game/gameOptions';
import {
  attachBallTrail,
  refreshBallTrailSize,
  setBallTrailFromBlock,
  setBallTrailSteel,
  updateBallTrail,
} from '../game/fx/ballTrail';
import { HitSparkPool } from '../game/fx/hitSparkPool';
import { closeTgcOverlay, openTgcOverlay, setTgcOverlayContext } from '../ui/tgcOverlay';

type BootData = { level?: number; resetAll?: boolean };

type BlockUserData = {
  placed: PlacedBlock;
  hp: number;
  destroyable: boolean;
  bonusable: boolean;
  primary: boolean;
  score: number;
  typeId: number;
  hitsTaken: number;
  immuneUntil: number;
};

export class MainGame extends Phaser.Scene {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private blockGroup!: Phaser.Physics.Arcade.StaticGroup;
  private ballGroup!: Phaser.Physics.Arcade.Group;
  private bonusGroup!: Phaser.Physics.Arcade.Group;
  private bulletGroup!: Phaser.Physics.Arcade.Group;

  /** Visual only — physics use `paddleHit` (stable Arkanoid-style collisions). */
  private paddleRoot!: Phaser.GameObjects.Container;
  /** Invisible static body; moved horizontally each frame. */
  private paddleHit!: Phaser.GameObjects.Rectangle;
  private paddleCenterMul = 1;
  private paddleGun = false;
  private gunTimer?: Phaser.Time.TimerEvent;
  private glue = false;

  private levelIndex = 0;
  private score = 0;
  private lives = 3;
  private ballSpeed = 380;
  private scoreText!: Phaser.GameObjects.Text;
  private livesText!: Phaser.GameObjects.Text;
  private levelText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private speedDial?: Phaser.GameObjects.Image;
  private sessionStartWall = 0;
  private userPaused = false;
  private pauseLayer?: Phaser.GameObjects.Container;
  private primaryLeft = 0;
  private maxUnlocked = 0;
  private boot: BootData = {};
  private pausedForUi = false;
  private overlayPausedPhysics = false;
  private bonusIncidence: Record<string, number> = {};
  private paddleHalfW = 48;
  private ballBaseRadius = BALL_RADIUS;
  private hitSparks!: HitSparkPool;
  private bgParallaxBack!: Phaser.GameObjects.Image;
  private bgParallaxMid!: Phaser.GameObjects.Image;
  private bgParallaxFront!: Phaser.GameObjects.Image;
  private levelStartMs = 0;
  private scoreAtLevelStart = 0;
  private livesAtLevelStart = 3;
  private sessionPlayMs = 0;

  constructor() {
    super('MainGame');
  }

  init(data: BootData) {
    this.boot = data || {};
  }

  create() {
    if (this.boot.resetAll) {
      this.score = 0;
      this.lives = 3;
      this.levelIndex = 0;
      this.maxUnlocked = 0;
      localStorage.removeItem('tgc_max_level');
    } else if (this.boot.level !== undefined) {
      this.maxUnlocked = Math.min(
        Number(localStorage.getItem('tgc_max_level') || '0') || 0,
        SPACE_LEVEL_STRINGS.length - 1
      );
      this.levelIndex = Phaser.Math.Clamp(this.boot.level, 0, SPACE_LEVEL_STRINGS.length - 1);
    } else {
      this.maxUnlocked = Math.min(
        Number(localStorage.getItem('tgc_max_level') || '0') || 0,
        SPACE_LEVEL_STRINGS.length - 1
      );
      this.levelIndex = Math.min(this.maxUnlocked, SPACE_LEVEL_STRINGS.length - 1);
    }
    this.boot = {};
    this.pausedForUi = false;
    this.sessionPlayMs = 0;
    this.bonusIncidence = {};
    this.glue = false;
    this.paddleGun = false;
    this.paddleCenterMul = 1;

    this.cameras.main.setBackgroundColor(0x0a0e1a);

    this.add.image(0, 0, 'bg-game').setOrigin(0).setDisplaySize(GAME_WIDTH, GAME_HEIGHT).setDepth(-3);
    this.bgParallaxBack = this.add.image(0, 0, 'cv-back').setOrigin(0).setDepth(-2);
    this.bgParallaxMid = this.add.image(0, 0, 'cv-mid').setOrigin(0).setDepth(-1);
    this.bgParallaxFront = this.add.image(0, 0, 'cv-front').setOrigin(0).setDepth(0).setAlpha(0.5);

    if (this.textures.exists('bg-bottom')) {
      const b = this.add.image(0, GAME_HEIGHT, 'bg-bottom').setOrigin(0, 1).setDepth(1);
      const w = Math.max(b.width, 1);
      const h = Math.max(b.height, 1);
      const dw = GAME_WIDTH;
      const dh = Math.min((h / w) * dw, 44);
      b.setDisplaySize(dw, dh);
    }

    syncBgm(this);

    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.input.keyboard.on('keydown-P', (ev: KeyboardEvent) => {
        if (ev.repeat) return;
        this.toggleUserPause();
      });
      this.input.keyboard.on('keydown-M', (ev: KeyboardEvent) => {
        if (ev.repeat) return;
        this.goToMenu();
      });
    }

    this.blockGroup = this.physics.add.staticGroup();
    this.ballGroup = this.physics.add.group({ collideWorldBounds: true });
    this.bonusGroup = this.physics.add.group();
    this.bulletGroup = this.physics.add.group();
    this.hitSparks = new HitSparkPool(this, 17);

    this.buildPaddle(PADDLE_Y);

    const fr = this.textures.getFrame('ball-normal');
    this.ballBaseRadius = Math.min(fr.width, fr.height) / 2;

    this.physics.world.setBounds(0, 0, GAME_WIDTH, GAME_HEIGHT, true, true, true, false);

    this.scoreText = this.add.text(12, 8, '', uiStyle({ fontSize: '20px', color: '#eceff1' })).setDepth(50);
    this.livesText = this.add.text(12, 28, '', uiStyle({ fontSize: '20px', color: '#eceff1' })).setDepth(50);
    this.levelText = this.add
      .text(GAME_WIDTH / 2, 8, '', uiStyle({ fontSize: '18px', color: '#b0bec5' }))
      .setOrigin(0.5, 0)
      .setDepth(50);
    this.timeText = this.add
      .text(GAME_WIDTH - 12, 8, '', uiStyle({ fontSize: '20px', color: '#80deea' }))
      .setOrigin(1, 0)
      .setDepth(50);
    if (this.textures.exists('dashboard-speed')) {
      this.speedDial = this.add
        .image(96, 42, 'dashboard-speed')
        .setDepth(48)
        .setScale(0.85);
    }
    this.sessionStartWall = Date.now();
    this.hintText = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 150, 'Tap / click — launch ball', uiStyle({
        fontSize: '20px',
        color: '#90a4ae',
      }))
      .setOrigin(0.5)
      .setDepth(50);

    setTgcOverlayContext({
      getMaxUnlockedLevel: () => this.maxUnlocked,
      onOpen: () => {
        if (!this.pausedForUi) {
          this.overlayPausedPhysics = true;
          this.physics.pause();
        }
      },
      onClose: () => {
        if (this.overlayPausedPhysics) {
          this.overlayPausedPhysics = false;
          this.physics.resume();
        }
      },
    });
    if (this.textures.exists('btn-user')) {
      this.add
        .image(GAME_WIDTH - 14, GAME_HEIGHT - 14, 'btn-user')
        .setOrigin(1, 1)
        .setScale(0.85)
        .setDepth(55)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => openTgcOverlay());
    }

    this.add
      .text(GAME_WIDTH - 12, GAME_HEIGHT - 12, 'Menu · M', uiStyle({
        fontSize: '18px',
        color: '#78909c',
      }))
      .setOrigin(1, 1)
      .setDepth(55)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.goToMenu());

    this.physics.add.collider(
      this.ballGroup,
      this.paddleHit,
      this.onBallPaddle,
      this.paddleCollideProcess,
      this
    );
    this.physics.add.overlap(this.ballGroup, this.blockGroup, this.onBallBlockOverlap, undefined, this);
    this.physics.add.overlap(this.bonusGroup, this.paddleHit, this.onBonusPaddle, undefined, this);
    this.physics.add.overlap(this.bulletGroup, this.blockGroup, this.onBulletBlock, undefined, this);

    this.input.once('pointerdown', () => this.sound.unlock());
    this.input.on('pointerdown', () => this.releaseGluedBalls());
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.movePaddlePointer(p.worldX));

    this.loadLevel(this.levelIndex);
    this.refreshHud();
  }

  private playSfx(key: string) {
    if (!getGameOptions().sfxOn) return;
    if (this.sound.get(key)) {
      this.sound.play(key, { volume: 0.55 });
    }
  }

  private formatSessionClock(ms: number) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }

  private goToMenu() {
    closeTgcOverlay();
    if (this.userPaused) this.clearUserPause();
    this.scene.start('MenuScene');
  }

  private clearUserPause() {
    this.userPaused = false;
    this.pauseLayer?.destroy(true);
    this.pauseLayer = undefined;
    if (!this.pausedForUi && !this.overlayPausedPhysics) this.physics.resume();
  }

  private toggleUserPause() {
    if (this.pausedForUi || this.overlayPausedPhysics) return;
    this.userPaused = !this.userPaused;
    if (this.userPaused) {
      this.physics.pause();
      const c = this.add.container(0, 0).setDepth(120);
      this.pauseLayer = c;
      const g = this.add.graphics();
      g.fillStyle(0x000011, 0.55);
      g.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      const t = this.add
        .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Paused\n\nP or click to resume', uiStyle({
          fontSize: '28px',
          color: '#eceff1',
          align: 'center',
        }))
        .setOrigin(0.5);
      const hit = this.add
        .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.15)
        .setInteractive();
      hit.once('pointerdown', () => this.toggleUserPause());
      c.add([g, t, hit]);
    } else {
      this.clearUserPause();
    }
  }

  private spawnBonusPickupLabel(x: number, y: number, def: BonusTypeDef) {
    const caption = (() => {
      if (def.name === 'extra-life') return '1 UP';
      if (def.name === 'die') return 'OUCH';
      if (def.score !== 0) return (def.score > 0 ? '+' : '') + String(def.score);
      return def.name.toUpperCase().replace(/-/g, ' ');
    })();
    const t = this.add
      .text(x, y, caption, uiStyle({
        fontSize: '24px',
        color: '#ffd700',
        fontStyle: 'bold',
      }))
      .setOrigin(0.5)
      .setDepth(540);
    this.tweens.add({
      targets: t,
      y: y - 64,
      alpha: 0,
      duration: 880,
      ease: 'Quad.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  private spawnBlockScorePopup(x: number, y: number, points: number) {
    const t = this.add
      .text(x + 3, y + 7, String(points), uiStyle({
        fontSize: '26px',
        color: '#ffd700',
      }))
      .setOrigin(0.5)
      .setDepth(540);
    t.setAlpha(0.85);
    this.tweens.add({
      targets: t,
      scaleX: { from: 1, to: 0 },
      scaleY: { from: 1, to: 0 },
      alpha: { from: 0.85, to: 0 },
      duration: 720,
      ease: 'Cubic.easeIn',
      onComplete: () => t.destroy(),
    });
  }

  private updateParallaxBackgrounds() {
    const px = this.input.activePointer.worldX;
    const w = GAME_WIDTH;
    const shift = (im: Phaser.GameObjects.Image, div: number, halfDiv: number) => {
      const fw = im.width;
      const hw = (fw - w) / 2;
      if (hw <= 0) {
        im.x = 0;
        return;
      }
      const x = (w - px) / div;
      im.x = -(w / halfDiv - x) - hw;
    };
    shift(this.bgParallaxFront, 15, 30);
    shift(this.bgParallaxMid, 50, 100);
    shift(this.bgParallaxBack, 120, 240);
  }

  private playBlockHit(indestructible: boolean) {
    if (indestructible) {
      this.playSfx('s-block-ind');
    } else {
      const n = Phaser.Math.Between(1, 4);
      this.playSfx(`s-block-${n}`);
    }
  }

  private buildPaddle(y: number) {
    const lw = this.textures.getFrame('pad-left').width;
    const ch = this.textures.getFrame('pad-center').height;
    const baseCw = this.textures.getFrame('pad-center').width;
    const rw = this.textures.getFrame('pad-right').width;
    const cw = Math.max(24, baseCw * this.paddleCenterMul);
    const total = lw + cw + rw;

    if (!this.paddleRoot) {
      this.paddleRoot = this.add.container(GAME_WIDTH / 2, y);
      this.paddleRoot.setDepth(25);
    }

    if (!this.paddleHit) {
      this.paddleHit = this.add.rectangle(this.paddleRoot.x, y, total, Math.max(14, ch - 2), 0x000000, 0);
      this.paddleHit.setVisible(false);
      this.physics.add.existing(this.paddleHit, true);
    }

    this.paddleRoot.removeAll(true);
    this.paddleRoot.setY(y);

    const left = this.add.image(0, 0, 'pad-left').setOrigin(0, 0.5);
    const center = this.add.image(lw, 0, 'pad-center').setOrigin(0, 0.5).setDisplaySize(cw, ch);
    const right = this.add.image(lw + cw, 0, 'pad-right').setOrigin(0, 0.5);
    const barrelL = this.add.image(lw * 0.2, -4, 'pad-barrel').setOrigin(0.5, 0.5).setVisible(this.paddleGun);
    const barrelR = this.add
      .image(lw + cw + rw - lw * 0.2, -4, 'pad-barrel')
      .setOrigin(0.5, 0.5)
      .setVisible(this.paddleGun);
    this.paddleRoot.add([left, center, right, barrelL, barrelR]);
    this.paddleRoot.setData('barrelL', barrelL);
    this.paddleRoot.setData('barrelR', barrelR);

    const hitW = total - 4;
    const hitH = Math.max(14, Math.min(ch - 2, 22));
    this.paddleHit.setSize(hitW, hitH);
    this.paddleHit.setPosition(this.paddleRoot.x, y);
    const sb = this.paddleHit.body as Phaser.Physics.Arcade.StaticBody;
    sb.setSize(hitW, hitH);
    sb.updateFromGameObject();

    this.paddleHalfW = total / 2;
  }

  private setPaddleGun(on: boolean) {
    this.paddleGun = on;
    const bl = this.paddleRoot.getData('barrelL') as Phaser.GameObjects.Image;
    const br = this.paddleRoot.getData('barrelR') as Phaser.GameObjects.Image;
    if (bl) bl.setVisible(on);
    if (br) br.setVisible(on);
    this.gunTimer?.remove(false);
    if (on) {
      this.gunTimer = this.time.addEvent({
        delay: 10000,
        callback: () => this.setPaddleGun(false),
      });
    }
  }

  /**
   * Skip Arcade separation when the ball is glued or just launched — avoids the ball
   * tunneling into the paddle AABB and getting stuck.
   */
  private paddleCollideProcess(
    a: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    b: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ): boolean {
    const ball = (a === this.paddleHit ? b : a) as Phaser.Physics.Arcade.Image;
    if (!ball?.active || !ball.body) return false;
    if (ball.getData('onPaddle')) return false;
    const until = ball.getData('paddleCollideOffUntil') as number | undefined;
    if (until !== undefined && this.time.now < until) return false;
    const body = ball.body as Phaser.Physics.Arcade.Body;
    if (body.velocity.y < 12) return false;
    return true;
  }

  /** Top edge of paddle hitbox (world Y). */
  private paddleTopY(): number {
    return this.paddleHit.y - this.paddleHit.height / 2;
  }

  /** Move ball so its bottom sits just above the paddle (no overlap with static AABB). */
  private ejectBallAbovePaddle(ball: Phaser.Physics.Arcade.Image) {
    const body = ball.body as Phaser.Physics.Arcade.Body;
    const r = body.halfWidth;
    const targetY = this.paddleTopY() - r - 4;
    ball.y = Math.min(ball.y, targetY);
    body.updateFromGameObject();
  }

  private ballOverlapsPaddleHit(ball: Phaser.Physics.Arcade.Image): boolean {
    if (ball.getData('onPaddle')) return false;
    const b = ball.body as Phaser.Physics.Arcade.Body;
    const hw = this.paddleHit.width / 2;
    const hh = this.paddleHit.height / 2;
    const dx = Math.abs(ball.x - this.paddleHit.x);
    const dy = Math.abs(ball.y - this.paddleHit.y);
    return dx < hw + b.halfWidth - 1 && dy < hh + b.halfWidth - 1;
  }

  private movePaddlePointer(worldX: number) {
    const x = Phaser.Math.Clamp(worldX, this.paddleHalfW + 2, GAME_WIDTH - this.paddleHalfW - 2);
    this.paddleRoot.setPosition(x, PADDLE_Y);
    this.paddleHit.setPosition(x, PADDLE_Y);
    (this.paddleHit.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
    this.ballGroup.getChildren().forEach((o) => {
      const b = o as Phaser.Physics.Arcade.Image;
      if (b.getData('onPaddle')) {
        const off = b.getData('paddleOff') as number;
        b.x = x + off;
        const halfHit = this.paddleHit.height / 2;
        const r = (b.body as Phaser.Physics.Arcade.Body).halfWidth;
        b.y = PADDLE_Y - halfHit - r - 6;
        (b.body as Phaser.Physics.Arcade.Body).updateFromGameObject();
      }
    });
  }

  private spawnBall(x: number, y: number, onPaddle: boolean, size: 'small' | 'normal' | 'big' = 'normal') {
    const ball = this.physics.add.image(x, y, 'ball-normal') as Phaser.Physics.Arcade.Image;
    ball.setDepth(20);
    this.applyBallSize(ball, size);
    const body = ball.body as Phaser.Physics.Arcade.Body;
    body.setBounce(1, 1);
    body.setMaxVelocity(560, 560);
    body.setCollideWorldBounds(true);
    ball.setData('size', size);
    ball.setData('steel', false);
    ball.setData('onPaddle', onPaddle);
    if (onPaddle) {
      ball.setData('paddleOff', (this.ballGroup.getLength() % 3 - 1) * 14);
      body.setVelocity(0, 0);
    }
    this.ballGroup.add(ball);
    attachBallTrail(this, ball);
    return ball;
  }

  private applyBallSize(ball: Phaser.Physics.Arcade.Image, size: 'small' | 'normal' | 'big') {
    if (ball.getData('steel')) {
      ball.setTexture('ball-steel');
    } else {
      const tex = size === 'small' ? 'ball-small' : size === 'big' ? 'ball-big' : 'ball-normal';
      ball.setTexture(tex);
    }
    const sc = size === 'small' ? 0.78 : size === 'big' ? 1.22 : 1;
    ball.setScale(sc);
    const r = (Math.min(ball.width, ball.height) / 2) * Math.abs(ball.scaleX);
    const body = ball.body as Phaser.Physics.Arcade.Body;
    body.setCircle(r);
    refreshBallTrailSize(ball);
  }

  private setBallSteel(ball: Phaser.Physics.Arcade.Image, on: boolean) {
    ball.setData('steel', on);
    ball.setTexture(on ? 'ball-steel' : 'ball-normal');
    const size = ball.getData('size') as 'small' | 'normal' | 'big';
    setBallTrailSteel(ball, on);
    this.applyBallSize(ball, size);
    ball.removeData('steelTimer');
    if (on) {
      const ev = this.time.delayedCall(10000, () => this.setBallSteel(ball, false));
      ball.setData('steelTimer', ev);
    }
  }

  private onBallPaddle(
    ballObj: Phaser.GameObjects.GameObject,
    _pad: Phaser.GameObjects.GameObject
  ) {
    const ball = ballObj as Phaser.Physics.Arcade.Image;
    if (ball.getData('onPaddle')) return;
    const body = ball.body as Phaser.Physics.Arcade.Body;
    this.ejectBallAbovePaddle(ball);
    const px = this.paddleHit.x;
    const dx = ball.x - px;
    const max = this.paddleHalfW + ball.displayWidth / 2;
    const n = Phaser.Math.Clamp(dx / max, -1, 1);
    const speed = Math.max(this.ballSpeed, Math.hypot(body.velocity.x, body.velocity.y));
    const angle = (n * Math.PI) / 3 - Math.PI / 2;
    body.setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
    if (body.velocity.y >= 0) {
      body.setVelocityY(-Math.max(120, Math.abs(body.velocity.y)));
    }
    this.ensureBallSpeed(body, ball.y);
    this.ejectBallAbovePaddle(ball);
    ball.setData('paddleCollideOffUntil', this.time.now + 180);
    this.playSfx('s-paddle');
    if (!this.glue) {
      this.hitSparks.burst(ball.x, ball.y);
    }

    if (this.glue && !this.pausedForUi) {
      const off = Phaser.Math.Clamp(ball.x - this.paddleHit.x, -this.paddleHalfW + 10, this.paddleHalfW - 10);
      ball.setData('onPaddle', true);
      ball.setData('paddleOff', off);
      ball.removeData('paddleCollideOffUntil');
      body.setVelocity(0, 0);
      ball.x = this.paddleHit.x + off;
      const halfHit = this.paddleHit.height / 2;
      const r = body.halfWidth;
      ball.y = PADDLE_Y - halfHit - r - 6;
      body.updateFromGameObject();
    }

    if (this.paddleGun) {
      const py = this.paddleHit.y - this.paddleHit.height / 2 - 4;
      this.fireBullet(ball.x - 18, py);
      this.fireBullet(ball.x + 18, py);
    }
  }

  private fireBullet(x: number, y: number) {
    const b = this.physics.add.image(x, y, 'pad-bullet') as Phaser.Physics.Arcade.Image;
    b.setDepth(22);
    b.setScale(0.85);
    const body = b.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(0, -520);
    body.setSize(b.displayWidth - 2, b.displayHeight - 2);
    this.bulletGroup.add(b);
    this.playSfx('s-gun');
    this.time.delayedCall(2200, () => {
      if (b.active) b.destroy();
    });
  }

  private onBallBlockOverlap(
    ballObj: Phaser.GameObjects.GameObject,
    blockObj: Phaser.GameObjects.GameObject
  ) {
    const ball = ballObj as Phaser.Physics.Arcade.Image;
    const block = blockObj as Phaser.Physics.Arcade.Image | Phaser.Physics.Arcade.Sprite;
    const now = this.time.now;
    const bd = block.getData('bd') as BlockUserData | undefined;
    if (!bd || bd.immuneUntil > now) return;

    const body = ball.body as Phaser.Physics.Arcade.Body;

    const bx = ball.body.x + body.width / 2;
    const by = ball.body.y + body.height / 2;
    const cx = block.body.x + block.body.width / 2;
    const cy = block.body.y + block.body.height / 2;
    const dx = bx - cx;
    const dy = by - cy;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const pw = body.halfWidth + (block.body as Phaser.Physics.Arcade.StaticBody).halfWidth;
    const ph = body.halfHeight + (block.body as Phaser.Physics.Arcade.StaticBody).halfHeight;

    let nx = 0;
    let ny = 0;
    if (absX * ph < absY * pw) {
      ny = Math.sign(dy) * (ph - absY + 0.5);
      body.velocity.y *= -1;
    } else {
      nx = Math.sign(dx) * (pw - absX + 0.5);
      body.velocity.x *= -1;
    }
    ball.x += nx;
    ball.y += ny;
    body.updateFromGameObject();

    this.hitSparks.burst(ball.x, ball.y);
    setBallTrailFromBlock(ball, bd.typeId);

    bd.immuneUntil = now + 28;

    if (!bd.destroyable) {
      this.playBlockHit(true);
      this.ensureBallSpeed(body, ball.y);
      return;
    }

    bd.hitsTaken++;
    bd.hp--;
    this.playBlockHit(false);
    const bdef = getBlockDef(bd.typeId);
    const key = blockTextureKey(bd.typeId, bd.hitsTaken);
    if (!bdef.grayMetalAnim && key && this.textures.exists(key)) {
      block.setTexture(key);
    }

    this.ensureBallSpeed(body, ball.y);

    if (bd.hp <= 0) {
      if (bd.primary) this.primaryLeft = Math.max(0, this.primaryLeft - 1);
      this.score += bd.score;
      if (bdef.animateScore) {
        this.spawnBlockScorePopup(block.x, block.y, bd.score);
      }
      if (bd.bonusable) {
        this.trySpawnBonus(block.x, block.y);
      }
      this.blockGroup.remove(block, true, true);
      block.destroy();
      this.refreshHud();
      if (this.primaryLeft <= 0) {
        this.roundWon();
      }
    }
  }

  /**
   * Arcade Y+ is down. Keep |v| ≈ ballSpeed and never leave the ball crawling horizontally
   * (old clamp pushed vy positive when vy was ~0, so it never climbed).
   */
  private ensureBallSpeed(body: Phaser.Physics.Arcade.Body, ballY: number) {
    const target = this.ballSpeed;
    const minAbsVy = 115;
    let vx = body.velocity.x;
    let vy = body.velocity.y;
    let sp = Math.hypot(vx, vy);

    if (sp < 70) {
      const a = -Math.PI / 2 + Phaser.Math.FloatBetween(-0.55, 0.55);
      body.setVelocity(Math.cos(a) * target, Math.sin(a) * target);
      return;
    }

    vx = (vx / sp) * target;
    vy = (vy / sp) * target;

    if (Math.abs(vy) < minAbsVy) {
      if (ballY > GAME_HEIGHT * 0.3) {
        vy = -minAbsVy;
      } else {
        vy = (vy >= 0 ? 1 : -1) * minAbsVy;
      }
      sp = Math.hypot(vx, vy);
      vx = (vx / sp) * target;
      vy = (vy / sp) * target;
    }

    body.setVelocity(vx, vy);
  }

  private onBonusPaddle(
    bonusObj: Phaser.GameObjects.GameObject,
    _p: Phaser.GameObjects.GameObject
  ) {
    const bonus = bonusObj as Phaser.Physics.Arcade.Image;
    const typeId = bonus.getData('typeId') as number;
    const def = BONUS_TYPES[typeId];
    if (!def) {
      bonus.destroy();
      return;
    }
    this.spawnBonusPickupLabel(bonus.x, bonus.y, def);
    this.playSfx('s-bonus');
    if (def.score > 0) this.score += def.score;
    else this.score = Math.max(0, this.score + def.score);

    const name = def.name;
    if (name === '3-balls') {
      const ref = this.getPrimaryBall();
      if (ref && !ref.getData('onPaddle')) {
        const body = ref.body as Phaser.Physics.Arcade.Body;
        const ang = Math.atan2(body.velocity.y, body.velocity.x);
        const sp = Math.hypot(body.velocity.x, body.velocity.y) || this.ballSpeed;
        const mk = (da: number) => {
          const b = this.spawnBall(ref.x, ref.y, false, ref.getData('size'));
          const bdy = b.body as Phaser.Physics.Arcade.Body;
          bdy.setVelocity(Math.cos(ang + da) * sp, Math.sin(ang + da) * sp);
        };
        mk(0.55);
        mk(-0.55);
      }
    } else if (name === 'big-ball') {
      this.forEachActiveBall((b) => {
        b.setData('size', 'big');
        this.applyBallSize(b, 'big');
      });
    } else if (name === 'die') {
      this.ballGroup.clear(true, true);
      this.loseLifeOrDie();
    } else if (name === 'extra-life') {
      this.lives++;
    } else if (name === 'glue-paddle') {
      this.glue = true;
      this.time.delayedCall(15000, () => {
        this.glue = false;
      });
    } else if (name === 'grow-paddle') {
      this.paddleCenterMul = Math.min(1.65, this.paddleCenterMul * 1.35);
      this.buildPaddle(PADDLE_Y);
      this.time.delayedCall(15000, () => {
        this.paddleCenterMul = 1;
        this.buildPaddle(PADDLE_Y);
      });
    } else if (name === 'shrink-paddle') {
      this.paddleCenterMul = Math.max(0.55, this.paddleCenterMul * 0.72);
      this.buildPaddle(PADDLE_Y);
      this.time.delayedCall(15000, () => {
        this.paddleCenterMul = 1;
        this.buildPaddle(PADDLE_Y);
      });
    } else if (name === 'score') {
      /* score already applied via def.score */
    } else if (name === 'small-ball') {
      this.forEachActiveBall((b) => {
        b.setData('size', 'small');
        this.applyBallSize(b, 'small');
      });
    } else if (name === 'steel-ball') {
      const b = this.getPrimaryBall();
      if (b) this.setBallSteel(b, true);
    } else if (name === 'laser') {
      this.setPaddleGun(true);
    }

    bonus.destroy();
    this.refreshHud();
  }

  private forEachActiveBall(fn: (b: Phaser.Physics.Arcade.Image) => void) {
    this.ballGroup.getChildren().forEach((o) => {
      const b = o as Phaser.Physics.Arcade.Image;
      if (b.active) fn(b);
    });
  }

  private getPrimaryBall(): Phaser.Physics.Arcade.Image | null {
    const ch = this.ballGroup.getChildren();
    for (let i = 0; i < ch.length; i++) {
      const b = ch[i] as Phaser.Physics.Arcade.Image;
      if (b.active && !b.getData('onPaddle')) return b;
    }
    for (let i = 0; i < ch.length; i++) {
      const b = ch[i] as Phaser.Physics.Arcade.Image;
      if (b.active) return b;
    }
    return null;
  }

  private onBulletBlock(
    bulletObj: Phaser.GameObjects.GameObject,
    blockObj: Phaser.GameObjects.GameObject
  ) {
    const bullet = bulletObj as Phaser.Physics.Arcade.Image;
    const block = blockObj as Phaser.Physics.Arcade.Image | Phaser.Physics.Arcade.Sprite;
    const bd = block.getData('bd') as BlockUserData | undefined;
    if (!bd || !bd.destroyable) {
      bullet.destroy();
      return;
    }
    bd.hitsTaken++;
    bd.hp--;
    this.playBlockHit(false);
    this.hitSparks.burst(bullet.x, bullet.y);
    const bdef = getBlockDef(bd.typeId);
    const key = blockTextureKey(bd.typeId, bd.hitsTaken);
    if (!bdef.grayMetalAnim && key && this.textures.exists(key)) block.setTexture(key);
    bullet.destroy();
    if (bd.hp <= 0) {
      if (bd.primary) this.primaryLeft = Math.max(0, this.primaryLeft - 1);
      this.score += bd.score;
      if (bdef.animateScore) {
        this.spawnBlockScorePopup(block.x, block.y, bd.score);
      }
      if (bd.bonusable) this.trySpawnBonus(block.x, block.y);
      this.blockGroup.remove(block, true, true);
      block.destroy();
      this.refreshHud();
      if (this.primaryLeft <= 0) this.roundWon();
    }
  }

  private trySpawnBonus(x: number, y: number) {
    const typeId = Phaser.Math.Between(0, BONUS_TYPES.length - 1);
    const t = BONUS_TYPES[typeId];
    if (Phaser.Math.Between(0, t.create_rate - 1) !== 0) return;
    if (t.max_incidence !== undefined) {
      const n = this.bonusIncidence[t.name] ?? 0;
      if (n >= t.max_incidence) return;
      this.bonusIncidence[t.name] = n + 1;
    }
    const folder = bonusTextureFolder(t.name);
    const key = `bonus-${folder}`;
    if (!this.textures.exists(key)) return;
    const b = this.physics.add.image(x, y, key) as Phaser.Physics.Arcade.Image;
    b.setDepth(18);
    const body = b.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    b.setData('typeId', typeId);
    body.setVelocity(0, 92);
    this.bonusGroup.add(b);
  }

  private releaseGluedBalls() {
    if (this.pausedForUi) return;
    this.ballGroup.getChildren().forEach((o) => {
      const b = o as Phaser.Physics.Arcade.Image;
      if (!b.getData('onPaddle')) return;
      b.setData('onPaddle', false);
      const body = b.body as Phaser.Physics.Arcade.Body;
      const off = b.getData('paddleOff') as number;
      b.x = this.paddleHit.x + (typeof off === 'number' ? off : 0);
      this.ejectBallAbovePaddle(b);
      body.setVelocity(Phaser.Math.Between(-100, 100), -this.ballSpeed);
      b.setData('paddleCollideOffUntil', this.time.now + 220);
      body.updateFromGameObject();
    });
    this.hintText.setVisible(this.ballGroup.getLength() === 0);
  }

  private loseLifeOrDie() {
    this.cameras.main.shake(200, 0.004);
    this.lives--;
    this.refreshHud();
    if (this.lives <= 0) {
      this.gameOver();
      return;
    }
    this.playSfx('s-lost');
    this.spawnBallAtPaddle();
    this.hintText.setVisible(true);
  }

  private roundWon() {
    if (this.pausedForUi) return;
    this.pausedForUi = true;
    this.physics.pause();
    this.bonusGroup.clear(true, true);
    this.bulletGroup.clear(true, true);
    this.playSfx('s-win');
    this.forEachActiveBall((b) => {
      const body = b.body as Phaser.Physics.Arcade.Body;
      body.setVelocity(0, 0);
    });
    const finished = this.levelIndex >= SPACE_LEVEL_STRINGS.length - 1;
    const next = Math.min(this.levelIndex + 1, SPACE_LEVEL_STRINGS.length - 1);
    if (!finished) {
      this.maxUnlocked = Math.max(this.maxUnlocked, next);
      localStorage.setItem('tgc_max_level', String(this.maxUnlocked));
    }
    const user = getStoredUsername();
    if (user.length >= 2) {
      void fetchProfile(user).then(async (p) => {
        if (p === null || p === false) return;
        const levelScore = Math.max(0, this.score - this.scoreAtLevelStart);
        const timeSec = Math.max(1, Math.floor((Date.now() - this.levelStartMs) / 1000));
        const deltaPlay = Math.floor(this.sessionPlayMs);

        const st = p.stats;
        const roundsWon = (st.roundsWon | 0) + 1;
        const beat = this.levelIndex + 1;
        const maxLevelBeat = Math.max(st.maxLevelBeat | 0, beat);
        const totalScore = (st.totalScore | 0) + levelScore;
        const bestSessionScore = Math.max(st.bestSessionScore | 0, this.score);
        const highScore = Math.max(st.highScore | 0, this.score, bestSessionScore, getLocalHighScore());
        let fastestRoundSec = st.fastestRoundSec | 0;
        if (!fastestRoundSec || timeSec < fastestRoundSec) fastestRoundSec = timeSec;
        let fullLivesWins = st.fullLivesWins | 0;
        if (this.lives >= 3) fullLivesWins++;
        const playTimeMs = (st.playTimeMs | 0) + deltaPlay;

        const cap = Math.max(0, SPACE_LEVEL_STRINGS.length - 1);
        const nextUnlock = Math.min(cap, this.levelIndex + 1);
        const maxUnlockedLevelIndex = Math.max(
          p.maxUnlockedLevelIndex | 0,
          nextUnlock,
          this.maxUnlocked
        );

        const merged: Partial<Profile> = {
          maxUnlockedLevelIndex,
          stats: {
            ...st,
            roundsWon,
            maxLevelBeat,
            totalScore,
            bestSessionScore,
            highScore,
            fastestRoundSec,
            fullLivesWins,
            playTimeMs,
          },
        };

        const put = await pushProfile(user, merged);
        if (put) {
          this.sessionPlayMs = 0;
          void syncEvaluatedAchievementsToCloud(put, { sessionScore: this.score });
        }
      });
    }
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 28, finished ? 'You cleared all stages!' : 'Stage clear!', uiStyle({
        fontSize: finished ? '28px' : '34px',
        color: '#fff59d',
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 48 },
      }))
      .setOrigin(0.5)
      .setDepth(60);
    const btn = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 32, finished ? 'Play again from start' : 'Next level', uiStyle({
        fontSize: '24px',
        color: '#90caf9',
      }))
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setDepth(60);
    btn.on('pointerdown', () => {
      this.scene.restart({ level: finished ? 0 : next });
    });
  }

  private gameOver() {
    if (this.pausedForUi) return;
    this.pausedForUi = true;
    this.physics.pause();
    if (this.score > getLocalHighScore()) setLocalHighScore(this.score);
    const user = getStoredUsername();
    if (user.length >= 2) {
      void sessionEnd(user, this.score).then((res) => {
        if (res?.profile) void syncEvaluatedAchievementsToCloud(res.profile, { sessionScore: this.score });
      });
    }
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30, 'Game over', uiStyle({
        fontSize: '40px',
        color: '#ef9a9a',
      }))
      .setOrigin(0.5)
      .setDepth(60);
    const r = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 + 20, 'Play again', uiStyle({
        fontSize: '24px',
        color: '#90caf9',
      }))
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setDepth(60);
    r.on('pointerdown', () => {
      this.scene.restart({ resetAll: true });
    });
  }

  private loadLevel(index: number) {
    this.blockGroup.clear(true, true);
    this.bonusGroup.clear(true, true);
    this.bulletGroup.clear(true, true);
    this.ballGroup.clear(true, true);

    const raw = SPACE_LEVEL_STRINGS[index];
    const parsed = parseLevelString(raw);
    this.primaryLeft = 0;
    this.bonusIncidence = {};

    for (const placed of parsed.blocks) {
      const def = getBlockDef(placed.typeId);
      const { cx, cy } = blockWorldRect(placed);

      if (!def.collidable) {
        const tk = blockTextureKey(placed.typeId, 0);
        const key = tk && this.textures.exists(tk) ? tk : null;
        const halo = key
          ? this.add.image(cx, cy, key).setDepth(5)
          : this.add.circle(cx, cy, 12, def.fill, 0.4).setDepth(5);
        if (key) {
          halo.setDisplaySize(38, 21);
        }
        this.tweens.add({
          targets: halo,
          alpha: 0.35,
          duration: 700,
          yoyo: true,
          repeat: -1,
        });
        continue;
      }

      let block: Phaser.Physics.Arcade.Image | Phaser.Physics.Arcade.Sprite;
      if (
        def.grayMetalAnim &&
        this.textures.exists('b-101_gray-anim') &&
        this.anims.exists('gray-metal-loop')
      ) {
        const spr = this.physics.add.staticSprite(cx, cy, 'b-101_gray-anim', 0);
        spr.play('gray-metal-loop');
        block = spr;
      } else {
        const tk = blockTextureKey(placed.typeId, 0);
        block =
          tk && this.textures.exists(tk)
            ? this.physics.add.staticImage(cx, cy, tk)
            : this.physics.add.staticImage(cx, cy, 'b-100_black-1');
      }
      block.setDisplaySize(37, 20);
      (block.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
      block.setDepth(10);
      const bd: BlockUserData = {
        placed,
        hp: def.hardness,
        destroyable: def.destroyable,
        bonusable: def.destroyable && def.primary,
        primary: def.primary,
        score: def.score,
        typeId: placed.typeId,
        hitsTaken: 0,
        immuneUntil: 0,
      };
      block.setData('bd', bd);
      if (def.primary && def.destroyable) this.primaryLeft++;
      this.blockGroup.add(block);
    }

    this.levelText.setText(`${index + 1}/${SPACE_LEVEL_STRINGS.length} · ${parsed.name}`);
    this.levelStartMs = Date.now();
    this.scoreAtLevelStart = this.score;
    this.livesAtLevelStart = this.lives;
    this.spawnBallAtPaddle();
    this.hintText.setVisible(true);
  }

  /** Ball resting on paddle (Phaser Y+ = down). */
  private spawnBallAtPaddle() {
    const x = this.paddleHit.x;
    const halfHit = this.paddleHit.height / 2;
    const y0 = PADDLE_Y - halfHit - this.ballBaseRadius - 12;
    const ball = this.spawnBall(x, y0, true, 'normal');
    const off = ball.getData('paddleOff') as number;
    ball.x = x + (typeof off === 'number' ? off : 0);
    const body = ball.body as Phaser.Physics.Arcade.Body;
    const br = body.halfWidth;
    ball.y = PADDLE_Y - halfHit - br - 8;
    body.updateFromGameObject();
  }

  private refreshHud() {
    if (this.score > getLocalHighScore()) setLocalHighScore(this.score);
    this.scoreText.setText(`Score ${this.score}  ·  Best ${getLocalHighScore()}`);
    this.livesText.setText(`Lives ${this.lives}`);
    this.timeText.setText(this.formatSessionClock(Date.now() - this.sessionStartWall));
  }

  update(_t: number, dt: number) {
    if (!this.pausedForUi) {
      this.timeText.setText(this.formatSessionClock(Date.now() - this.sessionStartWall));
    }
    if (this.pausedForUi) return;
    if (this.userPaused) return;

    const d = dt / 1000;

    this.hitSparks.update(d);
    this.updateParallaxBackgrounds();
    this.sessionPlayMs += dt;

    if (this.speedDial) {
      const ball = this.getPrimaryBall();
      let sp = this.ballSpeed;
      if (ball && !ball.getData('onPaddle')) {
        const body = ball.body as Phaser.Physics.Arcade.Body;
        sp = Math.hypot(body.velocity.x, body.velocity.y) || this.ballSpeed;
      }
      this.speedDial.rotation = Phaser.Math.DegToRad(((sp - 120) / 440) * 240 - 120);
    }

    this.ballGroup.getChildren().forEach((o) => {
      const ball = o as Phaser.Physics.Arcade.Image;
      if (!ball.active) return;
      updateBallTrail(ball);
      if (ball.getData('onPaddle')) return;
      const body = ball.body as Phaser.Physics.Arcade.Body;
      const blocked = body.blocked;
      const prevU = !!ball.getData('wallU');
      const prevL = !!ball.getData('wallL');
      const prevR = !!ball.getData('wallR');
      if ((blocked.up && !prevU) || (blocked.left && !prevL) || (blocked.right && !prevR)) {
        this.playSfx('s-wall');
      }
      ball.setData('wallU', blocked.up);
      ball.setData('wallL', blocked.left);
      ball.setData('wallR', blocked.right);

      const until = ball.getData('paddleCollideOffUntil') as number | undefined;
      const immune = until !== undefined && this.time.now < until;
      const sp = Math.hypot(body.velocity.x, body.velocity.y);
      if (!immune && sp < 130 && this.ballOverlapsPaddleHit(ball)) {
        this.ejectBallAbovePaddle(ball);
        body.setVelocity(Phaser.Math.Between(-90, 90), -this.ballSpeed);
        ball.setData('paddleCollideOffUntil', this.time.now + 200);
        body.updateFromGameObject();
      }
    });

    this.bonusGroup.getChildren().forEach((o) => {
      const b = o as Phaser.Physics.Arcade.Image;
      if (!b.active) return;
      const body = b.body as Phaser.Physics.Arcade.Body;
      const vx = Math.sin(this.time.now / 320) * 55;
      body.setVelocity(vx, 88);
      if (b.y > GAME_HEIGHT + 40) b.destroy();
    });

    let anyFallen = false;
    this.ballGroup.getChildren().forEach((o) => {
      const ball = o as Phaser.Physics.Arcade.Image;
      if (!ball.active || ball.getData('onPaddle')) return;
      if (ball.y > GAME_HEIGHT + ball.displayHeight) {
        ball.destroy();
        anyFallen = true;
      }
    });
    if (anyFallen && this.ballGroup.getLength() === 0 && !this.pausedForUi) {
      this.loseLifeOrDie();
    }

    if (this.cursors?.left?.isDown) {
      this.movePaddlePointer(this.paddleRoot.x - 520 * d);
    }
    if (this.cursors?.right?.isDown) {
      this.movePaddlePointer(this.paddleRoot.x + 520 * d);
    }

    const showHint = this.ballGroup.getChildren().some((o) => (o as Phaser.Physics.Arcade.Image).getData('onPaddle'));
    this.hintText.setVisible(showHint && !this.pausedForUi);
  }
}
