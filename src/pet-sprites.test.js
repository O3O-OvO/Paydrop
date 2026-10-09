import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { animations, frameAt, FRAME_HEIGHT, FRAME_WIDTH } from './pet-sprites.js';
import { reactionDurations } from './pet-behavior.js';

test('idle holds its open-eyed pose before a brief blink, then loops', () => {
  assert.equal(frameAt(animations.idle, 0), 0);
  assert.equal(frameAt(animations.idle, 1799), 0);
  assert.equal(frameAt(animations.idle, 1800), 1);
  assert.equal(frameAt(animations.idle, 2050), 3);
  assert.equal(frameAt(animations.idle, 2730), 0);
});

test('walk advances each frame and reduced motion freezes an appropriate poster', () => {
  for (let index = 0; index < 6; index++) assert.equal(frameAt(animations.walk, index * 120), index);
  assert.equal(frameAt(animations.walk, 720), 0);
  assert.equal(frameAt(animations.rest, 1000, false), 2);
  assert.equal(frameAt(animations.happy, 300, false), 0);
});

test('short interactions settle after two cycles rather than jumping forever', () => {
  assert.equal(frameAt(animations.happy, 1500), 5);
  assert.equal(frameAt(animations.eat, 3000), 5);
  assert.equal(frameAt(animations.walk, -100), 0);
});

test('new gestures finish their configured loops before their interaction expires', () => {
  for (const name of ['wave', 'stretch', 'dance', 'coin']) {
    const animation = animations[name];
    const duration = animation.durations.reduce((sum, value) => sum + value, 0);
    const finish = duration * animation.loops;
    assert.ok(finish <= reactionDurations[name]);
    assert.equal(frameAt(animation, finish), 5);
    assert.equal(frameAt(animation, 400, false), 0);
  }
});

test('every sprite asset has six frames with a stable canvas and original generation provenance', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/pet-art/v2/manifest.json', import.meta.url)));
  assert.deepEqual(manifest.frameSize, [FRAME_WIDTH, FRAME_HEIGHT]);
  for (const [name, animation] of Object.entries(animations)) {
    const filename = animation.file || `${name}.png`;
    const file = readFileSync(new URL(`../public/pet-art/v2/${filename}`, import.meta.url));
    assert.equal(file.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(file.readUInt32BE(16), FRAME_WIDTH * 6);
    assert.equal(file.readUInt32BE(20), FRAME_HEIGHT);
    assert.equal(file[25], 6, `${name} must preserve RGBA transparency`);
    assert.deepEqual(manifest.animations[name].durations, animation.durations);
    assert.equal(manifest.animations[name].file, filename);
    assert.equal(manifest.animations[name].generation.tool, 'native image_generation');
    assert.ok(manifest.animations[name].generation.generationId);
    for (const bounds of manifest.animations[name].frameBounds) {
      assert.ok(bounds[0] >= 2 && bounds[1] >= 2 && bounds[2] < FRAME_WIDTH - 2 && bounds[3] < FRAME_HEIGHT - 2);
    }
  }
});

test('refined rest keeps its original strip and records the local redraw honestly', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/pet-art/v2/manifest.json', import.meta.url)));
  const rest = manifest.animations.rest;
  assert.equal(rest.refinement.source, 'rest.png');
  assert.match(rest.refinement.method, /not a new AI generation/);
  assert.equal(readFileSync(new URL('../public/pet-art/v2/rest.png', import.meta.url)).readUInt32BE(16), 1536);
  assert.ok(animations.rest.durations.reduce((total, value) => total + value, 0) >= 6000);
  assert.equal(frameAt(animations.rest, 0, false), 2);
});
