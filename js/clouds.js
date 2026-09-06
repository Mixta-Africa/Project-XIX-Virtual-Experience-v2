/**
 * Project XIX — Cloud Layer  v1
 *
 * WHY THIS EXISTS
 * ---------------
 * The sky is three.js's Sky (Preetham atmospheric scattering). It gives a
 * physically plausible gradient and nothing else — no clouds, ever. A clean
 * gradient is the single strongest tell that a scene is real-time rather than
 * rendered, and Lagos afternoons are not clean gradients: they carry towering
 * cumulus that changes every wide shot in the estate for free.
 *
 * HOW IT WORKS
 * ------------
 * One large horizontal plane at 700 m, shaded with fractal Brownian motion.
 * Not a dome: the camera never rises above ~50 m, and a plane at altitude is
 * never intersected by a horizontal view ray — it approaches asymptotically.
 * So a 14 km plane covers everything from roughly 6 degrees above the horizon
 * upward, which is where cumulus actually sits. The clear band left below that
 * is correct, not a gap.
 *
 * Lighting is cheap and deliberately so. Rather than marching the volume, the
 * density field is sampled a second time offset TOWARD the sun; where that
 * second sample is thinner, light is getting through, so the pixel brightens.
 * That single extra tap buys the silver-lined edges and shadowed undersides
 * that make cumulus read as three-dimensional, at a fraction of the cost.
 *
 * PERFORMANCE
 * -----------
 * Fragment-bound, not vertex-bound — two triangles, but FBM over whatever
 * fraction of the screen the sky occupies. Octave count is the dial:
 * fast 3, balanced 4, rich 5. On an integrated GPU covering half the frame,
 * 3 octaves is roughly 0.4 ms; 5 is closer to 1.2 ms.
 *
 * USAGE
 *   import { createCloudLayer, setCloudsForTime, tickClouds, setCloudQuality }
 *     from './clouds.js?v=87';
 *
 *   _clouds = createCloudLayer(scene);              // after createAtmosphericSky
 *   setCloudsForTime(_clouds, 'afternoon', sunVec); // in updateSkyForTime
 *   tickClouds(_clouds, delta, camera);             // once per frame
 *   setCloudQuality(_clouds, PERF_MODE);            // on perf mode change
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";

const CLOUD_ALTITUDE = 700;
const CLOUD_EXTENT   = 14000;

// Tuned per time of day. `cover` is the density threshold — LOWER means more
// sky covered, because it is subtracted from the noise before clamping.
const CLOUD_PRESETS = {
  morning:   { cover: 0.46, tint: 0xfff0dc, shadow: 0x9a8f86, opacity: 0.85, speed: 0.7 },
  afternoon: { cover: 0.52, tint: 0xffffff, shadow: 0x9fb0be, opacity: 0.90, speed: 1.0 },
  sunset:    { cover: 0.44, tint: 0xffcfa0, shadow: 0x7a5a55, opacity: 0.95, speed: 0.6 },
  night:     { cover: 0.62, tint: 0x2a3550, shadow: 0x121a2a, opacity: 0.70, speed: 0.4 },
};

const OCTAVES_BY_MODE = { fast: 3, balanced: 4, rich: 5 };

const VERT = /* glsl */`
  varying vec2 vWorldXZ;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldXZ = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  varying vec2 vWorldXZ;

  uniform float uTime;
  uniform float uCover;
  uniform float uOpacity;
  uniform vec3  uTint;
  uniform vec3  uShadow;
  uniform vec3  uSunDir;
  uniform vec3  uCamPos;
  uniform float uSpeed;
  uniform vec3  uFogColor;
  uniform float uFogDensity;

  // Value noise. Cheaper than gradient noise and, once four octaves are
  // stacked, indistinguishable for cloud silhouettes.
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);                 // smoothstep
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    // Rotate between octaves so the lattice does not read as a grid.
    mat2 R = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < OCTAVES; i++) {
      v += a * vnoise(p);
      p = R * p * 2.03;
      a *= 0.5;
    }
    return v;
  }

  float density(vec2 p) {
    vec2 drift = vec2(uTime * 0.0055 * uSpeed, uTime * 0.0021 * uSpeed);
    float d = fbm(p * 0.00042 + drift);
    // A second, slower field at a different scale breaks up the repetition
    // that a single fbm always shows across a plane this large.
    d = mix(d, fbm(p * 0.00017 - drift * 0.6), 0.35);
    return clamp((d - uCover) / (1.0 - uCover), 0.0, 1.0);
  }

  void main() {
    float d = density(vWorldXZ);
    if (d <= 0.002) discard;                      // most of the plane is sky

    // Self-shadowing without a raymarch: sample again toward the sun. If the
    // cloud is thinner over there, light reaches this pixel.
    vec2 sunStep = normalize(uSunDir.xz + vec2(0.0001)) * 260.0;
    float toward = density(vWorldXZ + sunStep);
    float lit = clamp(1.0 - (toward - d) * 1.5, 0.0, 1.0);
    lit = mix(0.35, 1.0, lit);
    // Sun height warms and brightens the whole field.
    lit *= mix(0.55, 1.0, clamp(uSunDir.y * 1.6 + 0.25, 0.0, 1.0));

    vec3 col = mix(uShadow, uTint, lit);

    // Thin edges catch light from behind — the silver lining that makes a
    // flat plane read as volume.
    float edge = smoothstep(0.55, 0.02, d);
    col += uTint * edge * 0.28 * clamp(uSunDir.y + 0.35, 0.0, 1.0);

    float alpha = smoothstep(0.0, 0.30, d) * uOpacity;

    // Fade out toward the plane's rim so it never presents a visible edge, and
    // blend into the horizon haze so clouds sit in the same atmosphere as the
    // ground. Without this the cloud layer floats in front of the sky.
    float r = length(vWorldXZ - uCamPos.xz);
    alpha *= 1.0 - smoothstep(${(CLOUD_EXTENT * 0.30).toFixed(1)}, ${(CLOUD_EXTENT * 0.48).toFixed(1)}, r);

    float horizon = 1.0 - exp(-pow(r * uFogDensity * 0.55, 2.0));
    col = mix(col, uFogColor, horizon * 0.85);

    if (alpha < 0.004) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

function buildMaterial(octaves) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: '#define OCTAVES ' + octaves + '\n' + FRAG,
    uniforms: {
      uTime:       { value: 0 },
      uCover:      { value: CLOUD_PRESETS.afternoon.cover },
      uOpacity:    { value: CLOUD_PRESETS.afternoon.opacity },
      uTint:       { value: new THREE.Color(0xffffff) },
      uShadow:     { value: new THREE.Color(0x9fb0be) },
      uSunDir:     { value: new THREE.Vector3(0, 1, 0) },
      uCamPos:     { value: new THREE.Vector3() },
      uSpeed:      { value: 1.0 },
      uFogColor:   { value: new THREE.Color(0xb8ccd6) },
      uFogDensity: { value: 0.0011 },
    },
    transparent: true,
    depthWrite: false,
    // The sky dome is behind everything; clouds must not be occluded by it, and
    // must not occlude geometry either. Sky renders first, clouds after it, the
    // world after both.
    depthTest: false,
    side: THREE.DoubleSide,
    fog: false,
  });
}

export function createCloudLayer(scene, perfMode = 'balanced') {
  const octaves = OCTAVES_BY_MODE[perfMode] || 4;
  const geo = new THREE.PlaneGeometry(CLOUD_EXTENT, CLOUD_EXTENT, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, buildMaterial(octaves));
  mesh.position.y = CLOUD_ALTITUDE;
  mesh.frustumCulled = false;
  mesh.renderOrder = -999;          // after the Sky, before all world geometry
  mesh.name = 'cloudLayer';
  scene.add(mesh);
  console.log(`[XIX] Cloud layer: ${octaves} octaves at ${CLOUD_ALTITUDE} m`);
  return { mesh, octaves, scene };
}

export function setCloudsForTime(clouds, timeName, sunVec, fogColor, fogDensity) {
  if (!clouds) return;
  const p = CLOUD_PRESETS[timeName] || CLOUD_PRESETS.afternoon;
  const u = clouds.mesh.material.uniforms;
  u.uCover.value   = p.cover;
  u.uOpacity.value = p.opacity;
  u.uSpeed.value   = p.speed;
  u.uTint.value.setHex(p.tint);
  u.uShadow.value.setHex(p.shadow);
  if (sunVec)   u.uSunDir.value.copy(sunVec).normalize();
  if (fogColor) u.uFogColor.value.copy(fogColor);
  if (fogDensity) u.uFogDensity.value = fogDensity;
}

export function tickClouds(clouds, delta, camera) {
  if (!clouds) return;
  const u = clouds.mesh.material.uniforms;
  u.uTime.value += (delta || 0.016);
  if (camera) {
    // Follow the camera in XZ so the layer is effectively infinite. Y is fixed,
    // so parallax against the ground still reads correctly as you move.
    clouds.mesh.position.x = camera.position.x;
    clouds.mesh.position.z = camera.position.z;
    u.uCamPos.value.copy(camera.position);
  }
}

export function setCloudQuality(clouds, perfMode) {
  if (!clouds) return;
  const octaves = OCTAVES_BY_MODE[perfMode] || 4;
  if (octaves === clouds.octaves) return;
  const old = clouds.mesh.material;
  const next = buildMaterial(octaves);
  // Carry the current state across so a mode change is not a visible reset.
  for (const k in old.uniforms) {
    if (next.uniforms[k] && old.uniforms[k].value !== undefined) {
      const v = old.uniforms[k].value;
      if (v && v.copy) next.uniforms[k].value.copy(v);
      else next.uniforms[k].value = v;
    }
  }
  clouds.mesh.material = next;
  clouds.octaves = octaves;
  old.dispose();
  console.log(`[XIX] Cloud layer -> ${octaves} octaves (${perfMode})`);
}

export function setCloudsVisible(clouds, on) {
  if (clouds) clouds.mesh.visible = !!on;
}
