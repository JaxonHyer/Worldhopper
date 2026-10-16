/**
 * WebGLRenderer + camera plumbing. Nothing game-specific lives here.
 */

import * as THREE from 'three';
import { FENCE, LENS, RENDER } from '../core/config.js';

export function createView({ canvas, settings, onContextLost }) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, RENDER.maxPixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const camera = new THREE.PerspectiveCamera(settings.fov, 1, FENCE.cameraNearMin, FENCE.cameraFarMax);
  camera.rotation.order = 'YXZ';

  // The Cognitive lens is an orthographic camera *in the same scene*, so both
  // realms stay one set of objects in one set of coordinates (AGENT_PROMPT §4).
  // It is created once and reframed, never rebuilt per frame.
  const lens = new THREE.OrthographicCamera(-1, 1, 1, -1, FENCE.cameraNearMin, FENCE.cameraFarMax);
  lens.rotation.order = 'YXZ';
  /** Which camera the frame loop drives; the lens takes over in the other realm. */
  let active = camera;

  let width = 1;
  let height = 1;
  // Queried once: gl.getParameter walks the driver and must not sit in the loop.
  const context = readContextInfo(renderer);

  if (onContextLost) canvas.addEventListener('webglcontextlost', onContextLost, false);

  return {
    renderer,
    camera,
    get size() {
      return { width, height };
    },
    /** Sizes from the canvas' CSS box; devicePixelRatio handled by three. */
    resize() {
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(rect.width));
      const nextHeight = Math.max(1, Math.round(rect.height));
      if (nextWidth === width && nextHeight === height) return false;
      width = nextWidth;
      height = nextHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // The lens keeps its vertical span and grows sideways: a wider window
      // shows more world, not a squashed one.
      const half = (active === lens ? Math.abs(lens.top) : LENS.defaultSpan / 2) || LENS.defaultSpan / 2;
      lens.left = -half * (width / height);
      lens.right = half * (width / height);
      lens.top = half;
      lens.bottom = -half;
      lens.updateProjectionMatrix();
      return true;
    },
    setFov(fov) {
      if (camera.fov === fov) return;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    },
    /**
     * Pick the projection (and, for the lens, how much world to show) and hand
     * back the camera the frame loop should position. `span` is the visible
     * height in metres; the width follows the canvas aspect, so a phone in
     * portrait sees less world sideways than a desktop — which is the honest
     * thing for an orthographic view.
     */
    setProjection(projection, span) {
      const wantLens = projection === 'orthographic';
      if (wantLens) {
        const half = Math.max(1, (Number.isFinite(span) ? span : LENS.defaultSpan)) / 2;
        const aspect = width / height;
        lens.left = -half * aspect;
        lens.right = half * aspect;
        lens.top = half;
        lens.bottom = -half;
        lens.updateProjectionMatrix();
      }
      active = wantLens ? lens : camera;
      return active;
    },
    /** The camera being used this frame (perspective, or the lens). */
    get activeCamera() {
      return active;
    },
    render(scene) {
      renderer.render(scene, active);
    },
    info() {
      const { calls, triangles } = renderer.info.render;
      return { drawCalls: calls, triangles };
    },
    /** Cached at construction: the debug snapshot reads this every frame. */
    contextInfo() {
      return context;
    },
  };
}

function readContextInfo(renderer) {
  try {
    const gl = renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      version: String(gl.getParameter(gl.VERSION)),
      gpu: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'unavailable',
    };
  } catch {
    return { version: 'unavailable', gpu: 'unavailable' };
  }
}
