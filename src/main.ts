import Phaser from 'phaser';
import { PreloadScene } from './scenes/PreloadScene';
import { MenuScene } from './scenes/MenuScene';
import { MainGame } from './scenes/MainGame';
import { GAME_HEIGHT, GAME_WIDTH } from './game/constants';
import { initTgcOverlayDom } from './ui/tgcOverlay';

const parent = document.getElementById('game-root');
if (!parent) {
  throw new Error('#game-root missing');
}

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
        fixedStep: false,
      },
    },
    scene: [PreloadScene, MenuScene, MainGame],
  });
}

/** Match classic: wait for VT323 / Press Start 2P before drawing UI text. */
if (document.fonts?.ready) {
  void document.fonts.ready.then(() => {
    createGame();
  });
} else {
  createGame();
}
