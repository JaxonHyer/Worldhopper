/**
 * Gradient sky dome + optional sun disc, driven entirely by per-map palette
 * data. Colour maths note: three keeps colours in linear working space, so the
 * shader writes linear and lets <colorspace_fragment> convert on output.
 */

import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uHorizon;
  uniform vec3 uZenith;
  uniform vec3 uHaze;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  uniform float uSunDisc;
  uniform float uSunStrength;
  uniform float uBand;
  varying vec3 vDir;

  // 8-bit gradients band badly on dark skies; a sub-LSB dither hides it.
  float dither(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), uBand));
    col = mix(col, uHaze, clamp(-h * 3.0, 0.0, 1.0));

    float sd = max(dot(dir, normalize(uSunDir)), 0.0);
    // A crisp disc plus a tight halo: a wide soft bloom reads as a lens smudge,
    // not as a light source you can orient by.
    float disc = smoothstep(uSunDisc, uSunDisc + 0.0004, sd);
    float halo = pow(sd, 900.0) * 0.45;
    col += uSunColor * uSunStrength * (disc * 1.6 + halo);

    col += (dither(gl_FragCoord.xy) - 0.5) / 255.0;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export function createSky({ variant }) {
  const geometry = new THREE.SphereGeometry(2000, 32, 16);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uHorizon: { value: new THREE.Color(variant.sky.horizon) },
      uZenith: { value: new THREE.Color(variant.sky.zenith) },
      uHaze: { value: new THREE.Color(variant.sky.haze) },
      uSunColor: { value: new THREE.Color(variant.sun.color) },
      uSunDir: { value: sunDirection(variant) },
      uSunDisc: { value: variant.sun.discSize ?? 0.9994 },
      uSunStrength: { value: 1 },
      uBand: { value: 0.68 },
    },
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.name = 'sky';

  return {
    mesh,
    /** Sky follows the eye; it is a painted backdrop, never geometry (§4). */
    follow(position) {
      mesh.position.set(position.x, position.y, position.z);
    },
    setVariant(next) {
      this.setBackdrop({
        horizon: next.sky.horizon,
        zenith: next.sky.zenith,
        haze: next.sky.haze,
        sunColor: next.sun.color,
        sunDir: next.sun.direction,
        sunDisc: next.sun.discSize ?? 0.9994,
        sunStrength: 1,
      });
    },
    /**
     * Point the sky at a different world entirely.
     *
     * The shader is the same sky in both realms — what changes is what the sky
     * is made of, and that is per-world data (a cognitive skin's `light` block:
     * a black sky with one frail white sun that never moves, on Roshar). This is
     * deliberately dumb: it takes colours and a direction, and knows nothing
     * about realms or worlds. The policy lives in world-view.
     */
    setBackdrop({ horizon, zenith, haze, sunColor, sunDir, sunDisc, sunStrength = 1 }) {
      material.uniforms.uHorizon.value.set(horizon);
      material.uniforms.uZenith.value.set(zenith);
      material.uniforms.uHaze.value.set(haze);
      material.uniforms.uSunColor.value.set(sunColor);
      material.uniforms.uSunDir.value.set(sunDir.x, sunDir.y, sunDir.z).normalize();
      material.uniforms.uSunDisc.value = sunDisc;
      material.uniforms.uSunStrength.value = sunStrength;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

export function sunDirection(variant) {
  const { x, y, z } = variant.sun.direction;
  return new THREE.Vector3(x, y, z).normalize();
}
