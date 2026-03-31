import Phaser from 'phaser';
import { PreloadScene } from './scenes/PreloadScene';
import { MenuScene } from './scenes/MenuScene';
import { MainGame } from './scenes/MainGame';
import { LevelSelectScene } from './scenes/LevelSelectScene';
import { GAME_HEIGHT, GAME_WIDTH } from './game/constants';
import { TGC_BGM_REGISTRY_KEY } from './game/bgm';
import { getGameOptions } from './game/gameOptions';
import { initTgcOverlayDom } from './ui/tgcOverlay';
import { applyClassicDomLabels } from './ui/classicDomLabels';
import './classic-ui.css';

const parent = document.getElementById('game-root');
if (!parent) {
  throw new Error('#game-root missing');
}

applyClassicDomLabels();
initTgcOverlayDom();

function createGame() {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0a0e1a',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      expandParent: true,
    },
    /** Default smoothing like classic CreateJS bitmaps — not pixelArt. */
    render: {
      antialias: true,
      powerPreference: 'high-performance',
    },
    audio: {
      disableWebAudio: false,
    },
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { y: 0, x: 0 },
        debug: false,
        fps: 60,
        fixedStep: true,
      },
    },
    scene: [PreloadScene, MenuScene, LevelSelectScene, MainGame],
  });
}

let gameRef: Phaser.Game | null = null;

/** Match classic: wait for VT323 / Press Start 2P before drawing UI text. */
function boot() {
  gameRef = createGame();
  gameRef.sound.pauseOnBlur = false;
  const unlock = () => {
    gameRef?.sound.unlock();
    const g = gameRef;
    if (!g) return;
    const bgm = g.registry.get(TGC_BGM_REGISTRY_KEY) as Phaser.Sound.BaseSound | undefined;
    if (bgm && getGameOptions().musicOn && !bgm.isPlaying) {
      try {
        bgm.play();
      } catch {
        /* */
      }
    }
  };
  document.body.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') unlock();
  });
}

if (document.fonts?.ready) {
  void document.fonts.ready.then(boot);
} else {
  boot();
}
