import Phaser from 'phaser';
import { particleTextureKey, type TailSize } from '../particleKeys';

const TRAIL_COUNT = 10;
const ALPHA_STEP = 0.038;
const POS_JITTER = 2;

type TrailData = {
  imgs: Phaser.GameObjects.Image[];
  coords: { x: number; y: number }[];
};

function getTrailData(ball: Phaser.Physics.Arcade.Image): TrailData | null {
  const imgs = ball.getData('trailImgs') as Phaser.GameObjects.Image[] | undefined;
  const coords = ball.getData('trailCoords') as { x: number; y: number }[] | undefined;
  if (!imgs || !coords) return null;
  return { imgs, coords };
}

function applyTextures(ball: Phaser.Physics.Arcade.Image) {
  const td = getTrailData(ball);
  if (!td) return;
  const size = (ball.getData('size') as TailSize) || 'normal';
  const typeId = (ball.getData('trailTypeId') as number) ?? 0;
  const steel = !!(ball.getData('trailSteel') as boolean);
  const scene = ball.scene;
  for (const im of td.imgs) {
    const k = particleTextureKey(size, typeId, steel);
    if (scene.textures.exists(k)) im.setTexture(k);
    else if (scene.textures.exists(`pt-${size}-default`)) im.setTexture(`pt-${size}-default`);
    const base = Math.min(im.width, im.height);
    im.setDisplaySize(base * 0.42, base * 0.42);
    im.setAlpha(im.getData('trailBaseAlpha') as number);
  }
}

export function attachBallTrail(scene: Phaser.Scene, ball: Phaser.Physics.Arcade.Image) {
  if (ball.getData('trailImgs')) return;
  const imgs: Phaser.GameObjects.Image[] = [];
  const coords: { x: number; y: number }[] = [];
  const size = (ball.getData('size') as TailSize) || 'normal';
  for (let i = 0; i < TRAIL_COUNT; i++) {
    const k = particleTextureKey(size, 0, false);
    const key = scene.textures.exists(k) ? k : `pt-${size}-default`;
    const im = scene.add.image(-9999, -9999, scene.textures.exists(key) ? key : 'ball-normal');
    im.setDepth(19);
    const a = i * ALPHA_STEP;
    const capped = Math.min(a, 0.32);
    im.setAlpha(capped);
    im.setData('trailBaseAlpha', capped);
    const base = Math.min(im.width, im.height);
    im.setDisplaySize(base * 0.42, base * 0.42);
    im.setVisible(false);
    imgs.push(im);
  }
  ball.setData('trailImgs', imgs);
  ball.setData('trailCoords', coords);
  ball.setData('trailTypeId', 0);
  ball.setData('trailSteel', false);
  ball.once(Phaser.GameObjects.Events.DESTROY, () => {
    imgs.forEach((im) => im.destroy());
  });
}

export function setBallTrailFromBlock(ball: Phaser.Physics.Arcade.Image, typeId: number) {
  if (ball.getData('trailSteel')) return;
  ball.setData('trailTypeId', typeId);
  applyTextures(ball);
}

export function setBallTrailSteel(ball: Phaser.Physics.Arcade.Image, steel: boolean) {
  ball.setData('trailSteel', steel);
  applyTextures(ball);
}

export function refreshBallTrailSize(ball: Phaser.Physics.Arcade.Image) {
  applyTextures(ball);
}

export function updateBallTrail(ball: Phaser.Physics.Arcade.Image) {
  const td = getTrailData(ball);
  if (!td) return;
  const { imgs, coords } = td;
  coords.push({ x: ball.x, y: ball.y });
  if (coords.length >= imgs.length) {
    const start = coords.length - imgs.length;
    const sliced = coords.slice(start);
    coords.length = 0;
    coords.push(...sliced);
  }
  for (let i = 0; i < imgs.length; i++) {
    const c = coords[i];
    if (c) {
      imgs[i].setPosition(c.x - POS_JITTER, c.y - POS_JITTER);
      imgs[i].setVisible(true);
    } else {
      imgs[i].setVisible(false);
    }
  }
}
