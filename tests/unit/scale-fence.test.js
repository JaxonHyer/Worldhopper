/**
 * The scale fence is enforced as a test, not as a note in a document
 * (AGENT_PROMPT.md §5). If any of these fail, the change is out of bounds and
 * has to be re-scoped or explicitly approved by the owner.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { FENCE, RENDER, SIM } from '../../src/core/config.js';
import { MAPS } from '../../src/core/maps/index.js';

test('camera planes stay inside the fence', () => {
  assert.ok(FENCE.cameraNearMin >= 0.3, 'near plane below 0.3 will z-fight with itself');
  assert.ok(FENCE.cameraFarMax <= 5000, 'far plane above 5000 wrecks depth precision');
  assert.ok(FENCE.cameraFarMax / FENCE.cameraNearMin < 20000, 'near/far ratio is in shimmer territory');
});

test('the renderer is actually built with those numbers', async () => {
  const source = await import('node:fs/promises').then((fs) =>
    fs.readFile(new URL('../../src/render/renderer.js', import.meta.url), 'utf8'),
  );
  assert.match(source, /FENCE\.cameraNearMin/, 'PerspectiveCamera near must come from FENCE');
  assert.match(source, /FENCE\.cameraFarMax/, 'PerspectiveCamera far must come from FENCE');
});

test('a whole system fits in pocket scale', () => {
  assert.ok(FENCE.systemSpanMax <= 8000, 'systems must stay under ~8km across');
});

test('every map stays pocket-scale and inside the origin warning radius', () => {
  for (const map of Object.values(MAPS)) {
    const half = map.ground.size / 2;
    assert.ok(map.ground.size <= FENCE.systemSpanMax, `${map.id}: ground plane exceeds the fence`);
    for (const landmark of map.landmarks) {
      const distance = Math.hypot(landmark.position.x, landmark.position.z);
      assert.ok(distance + landmark.baseRadius < FENCE.originWarnDistance, `${landmark.id}: landmark drifts past the canary`);
      assert.ok(distance < half * 0.75, `${landmark.id}: landmark is near the ground edge, not framed by it`);
    }
    const maxPropReach = map.propPolicy.outerRadius;
    assert.ok(maxPropReach < half, `${map.id}: props can spawn past the edge of the ground`);
    assert.ok(map.ground.segments <= RENDER.groundMaxSegments, `${map.id}: ground resolution over budget`);
  }
});

test('nothing places two surfaces coplanar (offset rule)', () => {
  assert.ok(FENCE.minSurfaceOffset >= 0.01, 'decals/ground markings need at least 1cm of offset');
  // Props are sunk into the terrain by a fraction of their own height, never
  // laid flat on it; landmarks sit on their plinth.
  for (const map of Object.values(MAPS)) {
    assert.ok(map.propPolicy.minScale > FENCE.minSurfaceOffset * 10, `${map.id}: smallest prop is inside the offset rule`);
  }
});

test('the fog hides the world before the far plane', () => {
  assert.ok(FENCE.fogHideDistanceMax >= FENCE.cameraFarMax, 'fog must cover at least to the far plane');
  assert.ok(SIM.maxSubsteps >= 1 && SIM.maxSubsteps <= 8, 'spiral-of-death guard must be sane');
  assert.ok(SIM.maxFrameDelta > 0 && SIM.maxFrameDelta <= 1);
});
