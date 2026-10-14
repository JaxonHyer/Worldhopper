/**
 * WebGLRenderer + camera plumbing. Nothing game-specific lives here.
 */

import * as THREE from 'three';
import { FENCE, RENDER } from '../core/config.js';

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

  let width = 1;
  let height = 1;

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
      return true;
    },
    setFov(fov) {
      if (camera.fov === fov) return;
      camera.fov = fov;
      camera.updateProjectionMatrix();
    },
    render(scene) {
      renderer.render(scene, camera);
    },
    info() {
      const { calls, triangles } = renderer.info.render;
      return { drawCalls: calls, triangles };
    },
    contextInfo() {
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
    },
  };
}
