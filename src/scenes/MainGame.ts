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
import { pauseBgmDuringGameplay } from '../game/bgm';
import { getGameOptions } from '../game/gameOptions';
import {
  attachBallTrail,
  refreshBallTrailSize,
  setBallTrailFromBlock,
  setBallTrailSteel,
  updateBallTrail,
} from '../game/fx/ballTrail';
import { HitSparkPool } from '../game/fx/hitSparkPool';
import { closeTgcOverlay, setTgcOverlayContext } from '../ui/tgcOverlay';

/** Phaser 3 GameObjects do not implement `removeData`; use the DataManager. */
function eraseGoData(go: Phaser.GameObjects.GameObject, key: string): void {
  const dm = go.data;
  if (dm) dm.remove(key);
}

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
  /** One-shot revert to default width after grow/shrink power-up. */
  private paddleSizeRevertTimer?: Phaser.Time.TimerEvent;
  private lastLaserFireMs = -999999;
  private readonly laserCooldownMs = 180;
  private glue = false;
  private glueExpireTimer?: Phaser.Time.TimerEvent;

  private levelIndex = 0;
  private score = 0;
  private lives = 3;
  /**
   * Speed magnitude (px/s), aligned with original `speedStep * 1.5` feel from
   * https://github.com/gus09090909/TGC-Arkade/blob/master/js/app/entity/ball.js
   */
  private readonly ballSpeedMax = 425;
  private readonly ballSpeedStart = 155;
  private ballSpeedCurrent = 155;
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
  /** Original bonus used ~speedStep 4 with curved path; straight drop was tuned too fast at 152. */
  private readonly bonusFallPxPerSec = 78;
  /** Balls spawned on the paddle — launch does not rely on `getData('onPaddle')` alone. */
  private readonly pendingServeBalls = new Set<Phaser.Physics.Arcade.Image>();
  /** Capture on #game-root so clicks always reach the game (Phaser often requires event.target === canvas). */
  private gameRootPointerDown?: (ev: PointerEvent) => void;

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
    this.pendingServeBalls.clear();
    this.pausedForUi = false;
    this.userPaused = false;
    this.overlayPausedPhysics = false;
    this.pauseLayer?.destroy(true);
    this.pauseLayer = undefined;
    this.sessionPlayMs = 0;
    this.bonusIncidence = {};
    this.glue = false;
    try {
      this.physics.world.resume();
    } catch {
      /* */
    }
    this.input.enabled = true;
    this.glueExpireTimer?.remove(false);
    this.glueExpireTimer = undefined;
    this.gunTimer?.remove(false);
    this.gunTimer = undefined;
    this.paddleSizeRevertTimer?.remove(false);
    this.paddleSizeRevertTimer = undefined;
    this.paddleGun = false;
    this.paddleCenterMul = 1;
    this.lastLaserFireMs = -999999;

    document.body.classList.add('tgc-playing-game');

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      const root = document.getElementById('game-root');
      if (root && this.gameRootPointerDown) {
        root.removeEventListener('pointerdown', this.gameRootPointerDown, { capture: true });
        this.gameRootPointerDown = undefined;
      }
      this.pendingServeBalls.clear();
      document.body.classList.remove('tgc-playing-game');
      this.events.off(Phaser.Scenes.Events.POST_UPDATE, this.applyManualBallWalls, this);
      this.overlayPausedPhysics = false;
      this.glueExpireTimer?.remove(false);
      try {
        this.physics.resume();
      } catch {
        /* */
      }
      closeTgcOverlay();
    });

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

    pauseBgmDuringGameplay(this.game);

    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.input.keyboard.on('keydown-P', (ev: KeyboardEvent) => {
        if (ev.repeat) return;
        this.toggleUserPause();
      });
      const launchKeys = (ev: KeyboardEvent) => {
        if (ev.repeat) return;
        if (this.pausedForUi || this.userPaused || this.overlayPausedPhysics) return;
        if (this.paddleGun) this.tryFireLaser();
        this.releaseGluedBalls();
      };
      this.input.keyboard.on('keydown-SPACE', launchKeys);
      this.input.keyboard.on('keydown-ENTER', launchKeys);
      this.input.keyboard.on('keydown-UP', launchKeys);
    }

    this.blockGroup = this.physics.add.staticGroup();
    this.ballGroup = this.physics.add.group({ collideWorldBounds: false });
    this.bonusGroup = this.physics.add.group();
    this.bulletGroup = this.physics.add.group({
      allowGravity: false,
      dragX: 0,
      dragY: 0,
    });
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
        .image(GAME_WIDTH - 40, GAME_HEIGHT - 58, 'dashboard-speed')
        .setDepth(50)
        .setScale(0.4)
        .setAlpha(0.75);
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

    /** Overlap + manual bounce only — collider + bounce(1) on the ball fought Arcade and felt random. */
    this.physics.add.overlap(
      this.ballGroup,
      this.paddleHit,
      (o1, o2) => {
        const ball = this.ballFromPaddlePair(o1, o2);
        if (ball?.active && ball.body) this.applyClassicPaddleBounce(ball);
      },
      (a, b) => this.paddleBallOverlapProcess(a, b),
      this
    );
    this.physics.add.overlap(this.ballGroup, this.blockGroup, this.onBallBlockOverlap, undefined, this);
    this.physics.add.overlap(this.bonusGroup, this.paddleHit, this.onBonusPaddle, undefined, this);
    this.physics.add.overlap(this.bulletGroup, this.blockGroup, this.onBulletBlock, undefined, this);

    let audioUnlocked = false;
    const pointerWorldX = (p: Phaser.Input.Pointer) => {
      let wx = p.worldX;
      if (!Number.isFinite(wx)) {
        const o = this.cameras.main.getWorldPoint(p.x, p.y);
        wx = o.x;
      }
      return wx;
    };
    const syncPointerToPaddle = (p: Phaser.Input.Pointer) => {
      if (this.pausedForUi || this.userPaused || this.overlayPausedPhysics) return;
      if (this.cursors?.left?.isDown || this.cursors?.right?.isDown) return;
      this.movePaddlePointer(pointerWorldX(p));
    };
    const onPointerLaunch = (p: Phaser.Input.Pointer) => {
      if (!audioUnlocked) {
        this.sound.unlock();
        audioUnlocked = true;
      }
      if (!this.pausedForUi && !this.userPaused && !this.overlayPausedPhysics) {
        this.movePaddlePointer(pointerWorldX(p));
        if (this.paddleGun) this.tryFireLaser();
      }
      this.releaseGluedBalls();
    };
    this.input.on('pointerdown', onPointerLaunch);
    this.gameRootPointerDown = () => {
      if (!this.scene.isActive()) return;
      this.sound.unlock();
      if (this.paddleGun && !this.pausedForUi && !this.userPaused && !this.overlayPausedPhysics) {
        this.tryFireLaser();
      }
      this.releaseGluedBalls();
    };
    document.getElementById('game-root')?.addEventListener('pointerdown', this.gameRootPointerDown, {
      capture: true,
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      syncPointerToPaddle(p);
    });

    this.events.on(Phaser.Scenes.Events.POST_UPDATE, this.applyManualBallWalls, this);

    this.loadLevel(this.levelIndex);
    this.refreshHud();
  }

  private playSfx(key: string) {
    if (!getGameOptions().sfxOn) return;
    if (!this.cache.audio.exists(key)) return;
    this.sound.play(key, { volume: 0.62 });
  }

  private formatSessionClock(ms: number) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }

  /** OS cursor visible again (canvas CSS used cursor:none while playing). */
  private showEndgameCursor() {
    document.body.classList.remove('tgc-playing-game');
  }

  private goToMenu() {
    document.body.classList.remove('tgc-playing-game');
    try {
      document.exitPointerLock();
    } catch {
      /* */
    }

    this.overlayPausedPhysics = false;
    this.pausedForUi = false;
    this.userPaused = false;
    this.pauseLayer?.destroy(true);
    this.pauseLayer = undefined;

    try {
      this.physics.resume();
    } catch {
      /* */
    }
    try {
      this.tweens.killAll();
    } catch {
      /* */
    }
    try {
      this.time.removeAllEvents();
    } catch {
      /* */
    }

    closeTgcOverlay();
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
    const intrinsicCenterW = Math.max(1, this.textures.getFrame('pad-center').width);
    /**
     * Narrow strip art needs a synthetic baseline so grow/shrink is visible.
     * If the PNG center is already full-width, use it as-is — `max(96, intrinsic)` made the paddle huge at mul 1.
     */
    const rawCenter =
      intrinsicCenterW >= 24
        ? intrinsicCenterW
        : Math.min(88, Math.max(44, intrinsicCenterW * 13));
    const centerAtMul1 = Math.max(12, Math.round(rawCenter * 0.5));
    const rw = this.textures.getFrame('pad-right').width;
    const cw = Phaser.Math.Clamp(Math.round(centerAtMul1 * this.paddleCenterMul), 10, 200);
    const total = lw + cw + rw;

    /** After `scene.restart()`, references can point at destroyed objects — must rebuild or overlaps stay broken. */
    if (!this.paddleRoot?.active) {
      this.paddleRoot?.destroy(true);
      this.paddleRoot = this.add.container(GAME_WIDTH / 2, y);
      this.paddleRoot.setDepth(25);
    }

    if (!this.paddleHit?.active) {
      this.paddleHit?.destroy(true);
      this.paddleHit = this.add.rectangle(this.paddleRoot.x, y, total, Math.max(14, ch - 2), 0x000000, 0);
      this.paddleHit.setVisible(false);
      this.physics.add.existing(this.paddleHit, true);
    }

    this.paddleRoot.removeAll(true);
    this.paddleRoot.setY(y);

    const ox = -total / 2;
    const left = this.add.image(ox, 0, 'pad-left').setOrigin(0, 0.5);
    const center = this.add.image(ox + lw, 0, 'pad-center').setOrigin(0, 0.5).setDisplaySize(cw, ch);
    const right = this.add.image(ox + lw + cw, 0, 'pad-right').setOrigin(0, 0.5);
    const barrelL = this.add.image(ox + lw * 0.2, -4, 'pad-barrel').setOrigin(0.5, 0.5).setVisible(this.paddleGun);
    const barrelR = this.add
      .image(ox + lw + cw + rw - lw * 0.2, -4, 'pad-barrel')
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
    this.clampPaddleIntoBounds();
  }

  /** Keep paddle visual within screen (center ± half width). */
  private clampPaddleIntoBounds() {
    if (!this.paddleRoot?.active || !this.paddleHit?.active) return;
    const half = this.paddleHalfW;
    const cx = Phaser.Math.Clamp(this.paddleRoot.x, half, GAME_WIDTH - half);
    if (cx === this.paddleRoot.x) return;
    this.paddleRoot.setX(cx);
    this.paddleHit.setX(cx);
    (this.paddleHit.body as Phaser.Physics.Arcade.StaticBody).updateFromGameObject();
    this.ballGroup.getChildren().forEach((o) => {
      const b = o as Phaser.Physics.Arcade.Image;
      if (!b.getData('onPaddle')) return;
      const off = b.getData('paddleOff') as number;
      b.x = cx + (typeof off === 'number' ? off : 0);
      const halfHit = this.paddleHit.height / 2;
      const r = (b.body as Phaser.Physics.Arcade.Body).halfWidth;
      b.y = PADDLE_Y - halfHit - r - 6;
      (b.body as Phaser.Physics.Arcade.Body).updateFromGameObject();
    });
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
        delay: 6000,
        callback: () => this.setPaddleGun(false),
      });
    }
  }

  private paddleBallOverlapProcess(
    a: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    b: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ): boolean {
    const ball = (a === this.paddleHit ? b : a) as Phaser.Physics.Arcade.Image;
    if (!ball?.active || !ball.body) return false;
    if (ball.getData('onPaddle')) return false;
    const grace = ball.getData('paddleLaunchGrace') as number | undefined;
    if (grace !== undefined && this.time.now < grace) return false;
    const vy = (ball.body as Phaser.Physics.Arcade.Body).velocity.y;
    if (vy < -140) return false;
    const r = (ball.body as Phaser.Physics.Arcade.Body).halfWidth;
    return vy > 8 || ball.y + r > this.paddleTopY() - 2;
  }

  /** Top edge of paddle hitbox (world Y). */
  private paddleTopY(): number {
    return this.paddleHit.y - this.paddleHit.height / 2;
  }

  /**
   * Phaser `overlap(group, paddleHit)` uses collideSpriteVsGroup(paddle, group): callback is always
   * (paddleHit, ballOrBonus) — never assume the ball is the first argument.
   */
  private ballFromPaddlePair(
    obj1: Phaser.GameObjects.GameObject,
    obj2: Phaser.GameObjects.GameObject
  ): Phaser.Physics.Arcade.Image | null {
    if (obj1 === this.paddleHit) return obj2 as Phaser.Physics.Arcade.Image;
    if (obj2 === this.paddleHit) return obj1 as Phaser.Physics.Arcade.Image;
    return null;
  }

  /**
   * Same reflection as original CreateJS ball (`normX` + sin/cos), not a wide radians sweep.
   * @see https://github.com/gus09090909/TGC-Arkade/blob/master/js/app/entity/ball.js
   */
  private applyClassicPaddleBounce(ball: Phaser.Physics.Arcade.Image) {
    const launchGrace = ball.getData('paddleLaunchGrace') as number | undefined;
    if (launchGrace !== undefined && this.time.now < launchGrace) return;

    const last = ball.getData('lastPaddleBounceAt') as number | undefined;
    if (last !== undefined && this.time.now - last < 28) return;
    ball.setData('lastPaddleBounceAt', this.time.now);

    const body = ball.body as Phaser.Physics.Arcade.Body;
    const r = body.halfWidth;
    const padTop = this.paddleTopY();
    ball.y = padTop - r - 6;
    body.updateFromGameObject();

    const paddleLeft = this.paddleHit.x - this.paddleHit.width / 2;
    const w = Math.max(1, this.paddleHit.width);
    const bounceAngle = 1;
    const normX =
      (1 - (2 * (ball.x - paddleLeft)) / w) * bounceAngle;
    const fromAbove = this.paddleTopY() > ball.y;
    const sp = this.ballSpeedCurrent;
    if (fromAbove) {
      const vx = -sp * Math.sin(normX);
      const vy = -sp * Math.cos(normX);
      body.setVelocity(vx, vy);
    } else {
      body.setVelocity(-body.velocity.x, body.velocity.y);
    }

    if (!this.glue) {
      this.bumpBallSpeed(ball.getData('steel') ? 5 : 9);
      this.normalizeBallSpeed(body, true);
    }

    this.playSfx('s-paddle');
    if (!this.glue) {
      this.hitSparks.burst(ball.x, ball.y);
    }

    if (this.glue && !this.pausedForUi) {
      const off = Phaser.Math.Clamp(ball.x - this.paddleHit.x, -this.paddleHalfW + 10, this.paddleHalfW - 10);
      ball.setData('onPaddle', true);
      this.pendingServeBalls.add(ball);
      ball.setData('paddleOff', off);
      eraseGoData(ball, 'paddleLaunchGrace');
      eraseGoData(ball, 'lastPaddleBounceAt');
      body.setVelocity(0, 0);
      ball.x = this.paddleHit.x + off;
      const halfHit = this.paddleHit.height / 2;
      ball.y = PADDLE_Y - halfHit - r - 6;
      body.updateFromGameObject();
    }

  }

  /** Laser fires from the paddle on click / Space (classic behaviour), not only on ball bounce. */
  private tryFireLaser(): boolean {
    if (!this.paddleGun || this.pausedForUi || !this.paddleHit?.active) return false;
    const now = this.time.now;
    if (now - this.lastLaserFireMs < this.laserCooldownMs) return false;
    this.lastLaserFireMs = now;
    const spread = Math.max(14, this.paddleHit.width * 0.22);
    const py = this.paddleTopY() - 4;
    this.fireBullet(this.paddleHit.x - spread, py, false);
    this.fireBullet(this.paddleHit.x + spread, py, true);
    return true;
  }

  private schedulePaddleSizeRevert(delayMs: number) {
    this.paddleSizeRevertTimer?.remove(false);
    this.paddleSizeRevertTimer = this.time.delayedCall(delayMs, () => {
      this.paddleCenterMul = 1;
      this.buildPaddle(PADDLE_Y);
      this.paddleSizeRevertTimer = undefined;
    });
  }

  private movePaddlePointer(worldX: number) {
    if (!this.paddleRoot?.active || !this.paddleHit?.active) return;
    const half = this.paddleHalfW;
    const x = Phaser.Math.Clamp(worldX, half, GAME_WIDTH - half);
    if (!Number.isFinite(x)) return;
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
    body.setBounce(0, 0);
    body.setMaxVelocity(this.ballSpeedMax + 80, this.ballSpeedMax + 80);
    body.setCollideWorldBounds(false);
    ball.setData('size', size);
    ball.setData('steel', false);
    ball.setData('onPaddle', onPaddle);
    if (onPaddle) {
      ball.setData('paddleOff', (this.ballGroup.getLength() % 3 - 1) * 14);
      body.setVelocity(0, 0);
      ball.setData('paddleLaunchGrace', this.time.now + 620);
      this.pendingServeBalls.add(ball);
    }
    this.ballGroup.add(ball);
    attachBallTrail(this, ball);
    ball.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.pendingServeBalls.delete(ball);
      const ev = ball.getData('steelTimer') as Phaser.Time.TimerEvent | undefined;
      ev?.remove(false);
    });
    return ball;
  }

  private applyBallSize(ball: Phaser.Physics.Arcade.Image, size: 'small' | 'normal' | 'big') {
    if (ball.getData('steel')) {
      ball.setTexture('ball-steel');
    } else {
      const tex = size === 'small' ? 'ball-small' : size === 'big' ? 'ball-big' : 'ball-normal';
      ball.setTexture(tex);
    }
    const sc = size === 'small' ? 0.58 : size === 'big' ? 1.36 : 1;
    ball.setScale(sc);
    const r = (Math.min(ball.width, ball.height) / 2) * Math.abs(ball.scaleX);
    const body = ball.body as Phaser.Physics.Arcade.Body;
    body.setCircle(r);
    refreshBallTrailSize(ball);
  }

  private setBallSteel(ball: Phaser.Physics.Arcade.Image, on: boolean) {
    if (!ball.active) return;
    if (on && !this.textures.exists('ball-steel')) return;
    ball.setData('steel', on);
    ball.setTexture(on ? 'ball-steel' : 'ball-normal');
    const size = ball.getData('size') as 'small' | 'normal' | 'big';
    setBallTrailSteel(ball, on);
    this.applyBallSize(ball, size);
    const prev = ball.getData('steelTimer') as Phaser.Time.TimerEvent | undefined;
    prev?.remove(false);
    eraseGoData(ball, 'steelTimer');
    if (on) {
      const ev = this.time.delayedCall(6000, () => {
        if (!ball.active || !ball.body) return;
        this.setBallSteel(ball, false);
      });
      ball.setData('steelTimer', ev);
    }
  }

  private fireBullet(x: number, y: number, playSfx = true) {
    const b = this.physics.add.image(x, y, 'pad-bullet') as Phaser.Physics.Arcade.Image;
    b.setDepth(22);
    b.setScale(0.85);
    this.bulletGroup.add(b);
    const body = b.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setDrag(0, 0);
    body.setVelocity(0, -560);
    body.setSize(Math.max(4, b.displayWidth - 2), Math.max(4, b.displayHeight - 2));
    if (playSfx) this.playSfx('s-gun');
    this.time.delayedCall(2200, () => {
      if (b.active) b.destroy();
    });
  }

  /** Steel may only pierce normal destructible bricks — never gray metal, black holes, or registry-indestructible. */
  private blockAllowsSteelPierce(bd: BlockUserData): boolean {
    if (!bd.destroyable || bd.hp <= 0) return false;
    const def = getBlockDef(bd.typeId);
    if (!def.destroyable || def.grayMetalAnim || def.bhVariant) return false;
    return def.collidable;
  }

  /**
   * Original steel ball: while moving up through destroyable bricks it smashes without bouncing off
   * (see ball.js `steelMode` + block bounce). Descending hits use normal reflection.
   */
  private ballSteelPierceBlockHit(
    ball: Phaser.Physics.Arcade.Image,
    block: Phaser.Physics.Arcade.Image | Phaser.Physics.Arcade.Sprite,
    bd: BlockUserData,
    body: Phaser.Physics.Arcade.Body,
    now: number
  ) {
    const spd = Math.hypot(body.velocity.x, body.velocity.y) || 1;
    ball.x += (body.velocity.x / spd) * 5;
    ball.y += (body.velocity.y / spd) * 5;
    body.updateFromGameObject();

    this.hitSparks.burst(ball.x, ball.y);
    bd.immuneUntil = now + 22;
    this.bumpBallSpeed(5);

    bd.hitsTaken++;
    bd.hp--;
    this.playBlockHit(false);
    const bdef = getBlockDef(bd.typeId);
    const key = blockTextureKey(bd.typeId, bd.hitsTaken);
    if (!bdef.grayMetalAnim && key && this.textures.exists(key)) {
      block.setTexture(key);
    }

    const target = this.ballSpeedCurrent;
    const sp = Math.hypot(body.velocity.x, body.velocity.y) || target;
    if (sp > 1) {
      body.setVelocity((body.velocity.x / sp) * target, (body.velocity.y / sp) * target);
    }

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
    const steel = !!ball.getData('steel');
    if (steel && body.velocity.y < -28 && this.blockAllowsSteelPierce(bd)) {
      this.ballSteelPierceBlockHit(ball, block, bd, body, now);
      return;
    }

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
    const push =
      steel && !bd.destroyable ? 4.5 : steel ? 2.5 : 1;
    ball.x += nx * push;
    ball.y += ny * push;
    body.updateFromGameObject();

    this.hitSparks.burst(ball.x, ball.y);
    if (!steel) {
      setBallTrailFromBlock(ball, bd.typeId);
    }

    bd.immuneUntil = now + (steel ? 42 : 28);
    this.bumpBallSpeed(ball.getData('steel') ? 5 : 7);

    if (!bd.destroyable) {
      this.playBlockHit(true);
      this.normalizeBallSpeed(body, true);
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

    this.normalizeBallSpeed(body, true);

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

  private bumpBallSpeed(delta: number) {
    this.ballSpeedCurrent = Math.min(this.ballSpeedMax, this.ballSpeedCurrent + delta);
  }

  /**
   * Match original: after a hit, |v| tracks `ballSpeedCurrent` while keeping direction.
   * Optional nudge avoids nearly-horizontal crawl after many brick hits.
   */
  private normalizeBallSpeed(body: Phaser.Physics.Arcade.Body, nudgeNearHorizontal: boolean) {
    const target = this.ballSpeedCurrent;
    let vx = body.velocity.x;
    let vy = body.velocity.y;
    let sp = Math.hypot(vx, vy);

    if (sp < 48) {
      const a = -Math.PI / 2 + Phaser.Math.FloatBetween(-0.45, 0.45);
      body.setVelocity(Math.cos(a) * target, Math.sin(a) * target);
      return;
    }

    vx = (vx / sp) * target;
    vy = (vy / sp) * target;

    if (nudgeNearHorizontal) {
      const minAbsVy = target * 0.12;
      if (Math.abs(vy) < minAbsVy) {
        const signY = Math.sign(vy) || Phaser.Math.RND.pick([-1, 1]);
        vy = signY * minAbsVy;
        const vxMag = Math.sqrt(Math.max(0, target * target - vy * vy));
        const signX = Math.sign(vx) || Phaser.Math.RND.pick([-1, 1]);
        vx = signX * vxMag;
      }
    }

    body.setVelocity(vx, vy);
  }

  /** Rescale every ball in flight to `ballSpeedCurrent` (after big/small power-up speed shifts). */
  private normalizeAllFlyingBalls(nudgeNearHorizontal: boolean) {
    this.ballGroup.getChildren().forEach((o) => {
      const b = o as Phaser.Physics.Arcade.Image;
      if (!b.active || b.getData('onPaddle')) return;
      const body = b.body as Phaser.Physics.Arcade.Body;
      if (!body) return;
      this.normalizeBallSpeed(body, nudgeNearHorizontal);
    });
  }

  /** Glue must apply the same frame you catch the capsule (deferred pickup was one frame late). */
  private startGluePowerup() {
    this.glue = true;
    this.glueExpireTimer?.remove(false);
    this.glueExpireTimer = this.time.delayedCall(7500, () => {
      this.glue = false;
      this.glueExpireTimer = undefined;
    });
    this.ballGroup.getChildren().forEach((o) => {
      const b = o as Phaser.Physics.Arcade.Image;
      if (!b.active || !b.getData('onPaddle')) return;
      const bd = b.body as Phaser.Physics.Arcade.Body;
      bd.setVelocity(0, 0);
      bd.updateFromGameObject();
    });
    this.snapFlyingBallsToPaddleIfInReach();
  }

  /** If the ball is already skimming the paddle when glue turns on, stick it (original M behaviour). */
  private snapFlyingBallsToPaddleIfInReach() {
    const px = this.paddleHit.x;
    const halfW = this.paddleHalfW;
    const top = this.paddleTopY();
    const pbot = top + this.paddleHit.height + 6;
    this.ballGroup.getChildren().forEach((o) => {
      const b = o as Phaser.Physics.Arcade.Image;
      if (!b.active || b.getData('onPaddle')) return;
      const snapGrace = b.getData('paddleLaunchGrace') as number | undefined;
      if (snapGrace !== undefined && this.time.now < snapGrace) return;
      const body = b.body as Phaser.Physics.Arcade.Body;
      const r = body.halfWidth;
      if (Math.abs(b.x - px) > halfW + r + 6) return;
      if (b.y - r > pbot || b.y + r < top - 14) return;
      const off = Phaser.Math.Clamp(b.x - px, -halfW + r + 4, halfW - r - 4);
      b.setData('onPaddle', true);
      this.pendingServeBalls.add(b);
      b.setData('paddleOff', off);
      body.setVelocity(0, 0);
      eraseGoData(b, 'paddleLaunchGrace');
      eraseGoData(b, 'lastPaddleBounceAt');
      b.x = px + off;
      const halfHit = this.paddleHit.height / 2;
      b.y = PADDLE_Y - halfHit - r - 6;
      body.updateFromGameObject();
    });
  }

  /**
   * Arcade world bounce + our rescale fought each other. Original game flips components on walls;
   * we do the same here after the physics step (no engine wall collision on the ball).
   */
  private applyManualBallWalls() {
    if (this.pausedForUi || this.userPaused || this.overlayPausedPhysics) return;

    this.ballGroup.getChildren().forEach((o) => {
      const ball = o as Phaser.Physics.Arcade.Image;
      if (!ball.active || ball.getData('onPaddle')) return;
      const body = ball.body as Phaser.Physics.Arcade.Body;
      const r = body.halfWidth;
      const eps = 0.75;

      const touchL = ball.x - r <= eps;
      const touchR = ball.x + r >= GAME_WIDTH - eps;
      const touchT = ball.y - r <= eps;
      const prev = (ball.getData('wallTouch') as { l?: boolean; r?: boolean; t?: boolean }) || {};

      if (touchL) {
        ball.x = r + eps;
        body.velocity.x = Math.abs(body.velocity.x);
      }
      if (touchR) {
        ball.x = GAME_WIDTH - r - eps;
        body.velocity.x = -Math.abs(body.velocity.x);
      }
      if (touchT) {
        ball.y = r + eps;
        let vyOut = Math.abs(body.velocity.y);
        if (ball.getData('steel') && vyOut < this.ballSpeedCurrent * 0.24) {
          vyOut = this.ballSpeedCurrent * 0.24;
        }
        body.velocity.y = vyOut;
      }

      const newEdges =
        (touchL && !prev.l ? 1 : 0) + (touchR && !prev.r ? 1 : 0) + (touchT && !prev.t ? 1 : 0);
      if (newEdges > 0) {
        this.playSfx('s-wall');
        this.bumpBallSpeed(2.4 * Math.min(newEdges, 2));
        this.normalizeBallSpeed(body, false);
      }

      ball.setData('wallTouch', { l: touchL, r: touchR, t: touchT });
      body.updateFromGameObject();
    });
  }

  private onBonusPaddle(obj1: Phaser.GameObjects.GameObject, obj2: Phaser.GameObjects.GameObject) {
    const bonus = this.ballFromPaddlePair(obj1, obj2);
    this.collectBonus(bonus);
  }

  /**
   * Never destroy the bonus or mutate heavy state inside overlap / forEach: that corrupts Arcade's
   * internal lists and can freeze the game. We disable the body immediately, then run effects + destroy
   * on the next tick.
   */
  private collectBonus(bonus: Phaser.Physics.Arcade.Image | null) {
    if (!bonus?.active || !bonus.body) return;
    if (bonus.getData('picked')) return;
    const typeIdRaw = bonus.getData('typeId');
    if (typeof typeIdRaw !== 'number') return;

    const defPre = BONUS_TYPES[typeIdRaw];
    if (!defPre) {
      this.time.delayedCall(0, () => {
        if (bonus.active) bonus.destroy();
      });
      return;
    }

    bonus.setData('picked', true);
    (bonus.body as Phaser.Physics.Arcade.Body).enable = false;
    bonus.setVisible(false);

    if (defPre.name === 'glue-paddle') {
      this.startGluePowerup();
    }

    const typeId = typeIdRaw;
    const lx = bonus.x;
    const ly = bonus.y;

    this.time.delayedCall(0, () => {
      this.applyBonusPickupContent(typeId, lx, ly);
      if (bonus.active) bonus.destroy();
      this.refreshHud();
    });
  }

  private applyBonusPickupContent(typeId: number, labelX: number, labelY: number) {
    const def = BONUS_TYPES[typeId];
    if (!def) return;
    this.spawnBonusPickupLabel(labelX, labelY, def);
    this.playSfx('s-bonus');
    if (def.score > 0) this.score += def.score;
    else if (def.score < 0) this.score = Math.max(0, this.score + def.score);

    const name = def.name;
    if (name === '3-balls') {
      const ref = this.getPrimaryBall();
      if (ref && !ref.getData('onPaddle')) {
        const body = ref.body as Phaser.Physics.Arcade.Body;
        const ang = Math.atan2(body.velocity.y, body.velocity.x);
        const sp = Math.hypot(body.velocity.x, body.velocity.y) || this.ballSpeedCurrent;
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
      this.ballSpeedCurrent = Math.max(this.ballSpeedStart, this.ballSpeedCurrent - 72);
      this.normalizeAllFlyingBalls(true);
    } else if (name === 'die') {
      this.ballSpeedCurrent = this.ballSpeedStart;
      this.ballGroup.clear(true, true);
      this.loseLifeOrDie();
    } else if (name === 'extra-life') {
      this.lives++;
    } else if (name === 'grow-paddle') {
      this.paddleCenterMul = 1.4;
      this.buildPaddle(PADDLE_Y);
      this.schedulePaddleSizeRevert(6000);
    } else if (name === 'shrink-paddle') {
      this.paddleCenterMul = 0.4;
      this.buildPaddle(PADDLE_Y);
      this.schedulePaddleSizeRevert(6000);
    } else if (name === 'score') {
      /* score already applied via def.score */
    } else if (name === 'small-ball') {
      this.forEachActiveBall((b) => {
        b.setData('size', 'small');
        this.applyBallSize(b, 'small');
      });
      this.ballSpeedCurrent = Math.min(this.ballSpeedMax, this.ballSpeedCurrent + 72);
      this.normalizeAllFlyingBalls(true);
    } else if (name === 'steel-ball') {
      this.forEachActiveBall((b) => this.setBallSteel(b, true));
    } else if (name === 'laser' || name === 'gun') {
      this.setPaddleGun(true);
    }
  }

  /** Pickup sweep only after the item has moved into the lower playfield (avoids instant grab at spawn). */
  private sweepBonusPickupVsPaddle() {
    const px = this.paddleHit.x;
    const py = this.paddleHit.y;
    const hw = this.paddleHit.width / 2 + 36;
    const padTop = this.paddleTopY();
    const padBot = py + this.paddleHit.height / 2 + 14;
    const hits: Phaser.Physics.Arcade.Image[] = [];
    this.bonusGroup.getChildren().forEach((o) => {
      const b = o as Phaser.Physics.Arcade.Image;
      if (!b.active || b.getData('picked')) return;
      if (b.y < GAME_HEIGHT * 0.22) return;
      if (Math.abs(b.x - px) > hw) return;
      if (b.y < padTop - 22 || b.y > padBot + 22) return;
      hits.push(b);
    });
    for (const b of hits) {
      this.collectBonus(b);
    }
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
    obj1: Phaser.GameObjects.GameObject,
    obj2: Phaser.GameObjects.GameObject
  ) {
    const a = obj1 as Phaser.Physics.Arcade.Image;
    const b = obj2 as Phaser.Physics.Arcade.Image;
    let bullet: Phaser.Physics.Arcade.Image;
    let block: Phaser.Physics.Arcade.Image | Phaser.Physics.Arcade.Sprite;
    if (this.bulletGroup.contains(a)) {
      bullet = a;
      block = b as Phaser.Physics.Arcade.Image | Phaser.Physics.Arcade.Sprite;
    } else if (this.bulletGroup.contains(b)) {
      bullet = b;
      block = a as Phaser.Physics.Arcade.Image | Phaser.Physics.Arcade.Sprite;
    } else {
      return;
    }
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
    if (Phaser.Math.FloatBetween(0, 1) > 0.38) return;

    let totalW = 0;
    const weights: number[] = [];
    for (let i = 0; i < BONUS_TYPES.length; i++) {
      const t = BONUS_TYPES[i];
      const folder = bonusTextureFolder(t.name);
      if (!this.textures.exists(`bonus-${folder}`)) {
        weights.push(0);
        continue;
      }
      if (t.max_incidence !== undefined) {
        const n = this.bonusIncidence[t.name] ?? 0;
        if (n >= t.max_incidence) {
          weights.push(0);
          continue;
        }
      }
      const w = 1 / Math.max(1, t.create_rate);
      weights.push(w);
      totalW += w;
    }
    if (totalW <= 0) return;

    const pick = Phaser.Math.FloatBetween(0, totalW - 1e-6);
    let acc = 0;
    let typeId = 0;
    for (let i = 0; i < weights.length; i++) {
      acc += weights[i];
      if (pick < acc) {
        typeId = i;
        break;
      }
    }
    const t = BONUS_TYPES[typeId];
    if (t.max_incidence !== undefined) {
      const n = this.bonusIncidence[t.name] ?? 0;
      if (n >= t.max_incidence) return;
      this.bonusIncidence[t.name] = n + 1;
    }
    const folder = bonusTextureFolder(t.name);
    const key = `bonus-${folder}`;
    const b = this.physics.add.image(x, y, key) as Phaser.Physics.Arcade.Image;
    b.setDepth(18);
    const body = b.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false);
    body.setVelocity(0, 0);
    b.setData('typeId', typeId);
    b.setData('bonusKinematic', true);
    this.bonusGroup.add(b);
  }

  /**
   * If `onPaddle` was lost but the ball is still sitting on the paddle row (nearly still), treat as serve.
   * Scene restarts reuse the same Scene instance — stale `userPaused` used to block all launches before.
   */
  private ballIdleOnPaddleRow(ball: Phaser.Physics.Arcade.Image): boolean {
    const body = ball.body as Phaser.Physics.Arcade.Body;
    if (!ball.active || !body?.enable) return false;
    const sp = Math.hypot(body.velocity.x, body.velocity.y);
    if (sp > 40) return false;
    const r = body.halfWidth;
    const targetY = this.paddleTopY() - r - 6;
    const cy = body.center.y;
    const cx = body.center.x;
    if (Math.min(Math.abs(ball.y - targetY), Math.abs(cy - targetY)) > 28) return false;
    const dx = Math.min(Math.abs(ball.x - this.paddleHit.x), Math.abs(cx - this.paddleHit.x));
    if (dx > this.paddleHalfW + r + 20) return false;
    return true;
  }

  private releaseGluedBalls() {
    if (this.pausedForUi || this.userPaused) return;
    if (!this.overlayPausedPhysics && this.physics.world.isPaused) {
      try {
        this.physics.resume();
      } catch {
        /* */
      }
    }
    const sp = Math.max(48, this.ballSpeedCurrent);
    this.ballGroup.getChildren().forEach((o) => {
      const b = o as Phaser.Physics.Arcade.Image;
      if (!b.active || !b.body) return;
      const stuck =
        this.pendingServeBalls.has(b) || !!b.getData('onPaddle') || this.ballIdleOnPaddleRow(b);
      if (!stuck) return;
      this.pendingServeBalls.delete(b);
      b.setData('onPaddle', false);
      eraseGoData(b, 'lastPaddleBounceAt');
      const body = b.body as Phaser.Physics.Arcade.Body;
      let off = b.getData('paddleOff') as number;
      if (typeof off !== 'number') {
        off = Phaser.Math.Clamp(b.x - this.paddleHit.x, -this.paddleHalfW + 10, this.paddleHalfW - 10);
        b.setData('paddleOff', off);
      }
      const r = body.halfWidth;
      b.x = this.paddleHit.x + off;
      b.y = this.paddleTopY() - r - 6;
      const ang = -Math.PI / 2 + Phaser.Math.FloatBetween(-0.38, 0.38);
      body.setVelocity(Math.cos(ang) * sp, Math.sin(ang) * sp);
      b.setData('paddleLaunchGrace', this.time.now + 720);
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
    this.ballSpeedCurrent = this.ballSpeedStart;
    this.spawnBallAtPaddle();
    this.hintText.setVisible(true);
  }

  private roundWon() {
    if (this.pausedForUi) return;
    this.pausedForUi = true;
    this.physics.pause();
    this.showEndgameCursor();
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
    this.showEndgameCursor();
    if (this.score > getLocalHighScore()) setLocalHighScore(this.score);
    const user = getStoredUsername();
    if (user.length >= 2) {
      void sessionEnd(user, this.score).then((res) => {
        if (res?.profile) void syncEvaluatedAchievementsToCloud(res.profile, { sessionScore: this.score });
      });
    }
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 48, 'Game over', uiStyle({
        fontSize: '40px',
        color: '#ef9a9a',
      }))
      .setOrigin(0.5)
      .setDepth(60);
    const btnY = GAME_HEIGHT / 2 + 56;
    const btnW = 320;
    const btnH = 64;
    const dashBtn = this.add
      .rectangle(GAME_WIDTH / 2, btnY, btnW, btnH, 0x1565c0, 1)
      .setStrokeStyle(3, 0x64b5f6)
      .setDepth(60)
      .setInteractive({ useHandCursor: true });
    const dashLabel = this.add
      .text(GAME_WIDTH / 2, btnY, 'Dashboard', uiStyle({
        fontSize: '34px',
        color: '#eceff1',
      }))
      .setOrigin(0.5)
      .setDepth(61);
    const goDash = () => this.goToMenu();
    dashBtn.on('pointerdown', goDash);
    dashLabel.setInteractive({ useHandCursor: true });
    dashLabel.on('pointerdown', goDash);
  }

  private loadLevel(index: number) {
    this.blockGroup.clear(true, true);
    this.bonusGroup.clear(true, true);
    this.bulletGroup.clear(true, true);
    this.pendingServeBalls.clear();
    this.ballGroup.clear(true, true);
    this.ballSpeedCurrent = this.ballSpeedStart;

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
    ball.y = PADDLE_Y - halfHit - br - 6;
    body.updateFromGameObject();
    ball.setData('paddleLaunchGrace', this.time.now + 620);
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

    if (!this.overlayPausedPhysics && !this.cursors?.left?.isDown && !this.cursors?.right?.isDown) {
      const ap = this.input.activePointer;
      let wx = ap.worldX;
      if (!Number.isFinite(wx)) {
        wx = this.cameras.main.getWorldPoint(ap.x, ap.y).x;
      }
      if (Number.isFinite(wx)) this.movePaddlePointer(wx);
    }

    const d = dt / 1000;

    this.hitSparks.update(d);
    this.updateParallaxBackgrounds();
    this.sessionPlayMs += dt;

    if (this.speedDial) {
      const ball = this.getPrimaryBall();
      let sp = this.ballSpeedCurrent;
      if (ball && !ball.getData('onPaddle')) {
        const body = ball.body as Phaser.Physics.Arcade.Body;
        sp = Math.hypot(body.velocity.x, body.velocity.y) || this.ballSpeedCurrent;
      }
      const span = Math.max(40, this.ballSpeedMax - this.ballSpeedStart);
      this.speedDial.rotation = Phaser.Math.DegToRad(
        ((sp - this.ballSpeedStart) / span) * 240 - 120
      );
    }

    this.ballGroup.getChildren().forEach((o) => {
      const ball = o as Phaser.Physics.Arcade.Image;
      if (!ball.active) return;
      updateBallTrail(ball);
    });

    this.bonusGroup.getChildren().forEach((o) => {
      const b = o as Phaser.Physics.Arcade.Image;
      if (!b.active || b.getData('picked')) return;
      if (b.getData('bonusKinematic')) {
        b.y += this.bonusFallPxPerSec * d;
        const bd = b.body as Phaser.Physics.Arcade.Body;
        bd.setVelocity(0, 0);
        bd.updateFromGameObject();
      }
    });
    this.sweepBonusPickupVsPaddle();
    this.bonusGroup.getChildren().forEach((o) => {
      const b = o as Phaser.Physics.Arcade.Image;
      if (!b.active) return;
      if (b.y > GAME_HEIGHT + 48) b.destroy();
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
    if (showHint && !this.pausedForUi) {
      this.hintText.setText(
        this.glue ? 'Click to launch (sticky paddle)' : 'Tap / click — launch ball'
      );
      this.hintText.setVisible(true);
    } else {
      this.hintText.setVisible(false);
    }
  }
}
