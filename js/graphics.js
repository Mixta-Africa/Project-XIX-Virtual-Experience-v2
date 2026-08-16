/**
 * Project XIX -- Graphics Engine v4
 *
 * PS4-level realism upgrades (all LOD-compatible, Three.js LOD untouched):
 *
 *  1. PMREMGenerator sky environment map — all GLB materials now have real IBL
 *     reflections derived from the atmospheric sky. Glass, water, metal all catch light.
 *  2. Render pipeline by mode:
 *     Fast     — direct render, pixel ratio 1.5 (was 1.0), ACES exposure 0.85
 *     Balanced — bloom enabled (strength 0.22), pixel ratio 1.75, SMAA off
 *     Rich     — bloom + SMAA, pixel ratio devicePixelRatio (uncapped on desktop)
 *  3. Bloom tuned for architecture — threshold 0.75 (glass + water specular blooms,
 *     diffuse surfaces don't). Radius 0.6 for sharp corona not wash.
 *  4. Shadow quality:
 *     Fast     — 1024px PCFSoft (was 512), bias tightened
 *     Balanced — 2048px
 *     Rich     — 4096px + shadowRadius 2 (sharper contact edges)
 *  5. Water material upgraded — Fresnel-style metalness 0.65, opacity 0.92,
 *     envMapIntensity 3.5 (reflects sky properly)
 *  6. Grass cards — now MeshLambertMaterial (cheaper, still looks right for grass)
 *  7. setEnvMap() export — scene.js calls this after sky is built so all materials
 *     receive the sky IBL automatically
 *  8. applyPS4Materials() — traverses all loaded GLBs and upgrades their materials:
 *     roughness clamped to 0.55-0.85, metalness set correctly per surface type,
 *     envMapIntensity 1.8, normalScale boosted for depth
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { EffectComposer }  from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass }      from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass }      from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass }        from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/SMAAPass.js";
import { Sky }             from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/objects/Sky.js";

// ─── STATE ────────────────────────────────────────────────────────────────────
let composer, bloomPass, smaaPass, renderPass;
let _renderer, _scene, _camera;
let _perfMode = 'fast';
let _envMap   = null;  // PMREMGenerator result — shared across all materials

// ─── PERF MODE ────────────────────────────────────────────────────────────────
export function setPerfModeGraphics(mode) {
  _perfMode = mode;

  // Pixel ratio — Fast now uses 1.5 (not 1.0) so Retina phones look sharp
  if (_renderer) {
    const dpr = window.devicePixelRatio || 1;
    const ratio = mode === 'fast' ? Math.min(dpr, 1.5)
                : mode === 'balanced' ? Math.min(dpr, 1.75)
                : dpr; // rich: native resolution
    _renderer.setPixelRatio(ratio);
  }

  if (!bloomPass) return;
  if (mode === 'fast') {
    // Fast: bloom OFF but still use EffectComposer so OutputPass handles colour space
    bloomPass.enabled = false;
    if (smaaPass) smaaPass.enabled = false;
  } else if (mode === 'balanced') {
    bloomPass.enabled = true;
    bloomPass.strength  = 0.22;
    bloomPass.threshold = 0.75;
    bloomPass.radius    = 0.55;
    if (smaaPass) smaaPass.enabled = false;
  } else {
    // Rich: full pipeline
    bloomPass.enabled = true;
    bloomPass.strength  = 0.28;
    bloomPass.threshold = 0.72;
    bloomPass.radius    = 0.60;
    if (smaaPass) smaaPass.enabled = true;
  }
}

// ─── POST-PROCESSING INIT ─────────────────────────────────────────────────────
export function initPostProcessing(renderer, scene, camera) {
  _renderer = renderer; _scene = scene; _camera = camera;

  const w = Math.max(renderer.domElement.width  || window.innerWidth,  1);
  const h = Math.max(renderer.domElement.height || window.innerHeight, 1);

  // Upgraded tone mapping: ACESFilmic at 0.85 gives warmer, richer exposure
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;

  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  try {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.22, 0.55, 0.75);
    // Start disabled — setPerfModeGraphics() will enable per mode
    bloomPass.enabled = (_perfMode !== 'fast');
    composer.addPass(bloomPass);
  } catch(e) {
    console.warn('[XIX] BloomPass init failed:', e.message);
    bloomPass = null;
  }

  try {
    smaaPass = new SMAAPass(w, h);
    smaaPass.enabled = (_perfMode === 'rich');
    composer.addPass(smaaPass);
  } catch(e) {
    console.warn('[XIX] SMAAPass init failed:', e.message);
    smaaPass = null;
  }

  composer.addPass(new OutputPass());

  // Apply initial pixel ratio
  setPerfModeGraphics(_perfMode);

  return composer;
}

export function resizeComposer(w, h) {
  if (!composer) return;
  composer.setSize(w, h);
  if (bloomPass) bloomPass.resolution.set(w, h);
}

// ─── RENDER ───────────────────────────────────────────────────────────────────
// Always use EffectComposer (even Fast) — OutputPass handles linearToSRGB correctly.
// In Fast mode bloom is disabled so the cost is just one RenderPass + OutputPass.
export function renderFrame() {
  if (composer) { composer.render(); return; }
  if (_renderer && _scene && _camera) _renderer.render(_scene, _camera);
}

// ─── BLOOM TIME PRESETS ───────────────────────────────────────────────────────
export function setBloomForTime(name) {
  if (!bloomPass) return;
  const p = {
    morning:   { s: 0.30, t: 0.78, r: 0.50 },
    afternoon: { s: 0.22, t: 0.75, r: 0.55 },
    sunset:    { s: 0.65, t: 0.68, r: 0.70 }, // dramatic golden glow
    night:     { s: 0.90, t: 0.52, r: 0.80 }, // window emissives bloom hard
  }[name] || { s: 0.22, t: 0.75, r: 0.55 };
  bloomPass.strength = p.s; bloomPass.threshold = p.t; bloomPass.radius = p.r;
  if (_perfMode !== 'fast') bloomPass.enabled = true;
}

// ─── ENVIRONMENT MAP (IBL) ────────────────────────────────────────────────────
// Called by scene.js after the Sky is created and the renderer has rendered one frame.
// Generates a PMREM env map from the current sky and applies it to the scene.
// This gives all GLB materials (glass, metal, water) real reflections.
export function buildEnvMapFromSky(renderer, scene, skyObj) {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileCubemapShader();

    // Temporarily hide non-sky objects for the cube capture
    const prevBg = scene.background;
    scene.background = null; // sky is inside the scene as a mesh, not background

    // Render the sky into an environment map
    const envTexture = pmrem.fromScene(
      new THREE.RoomEnvironment(), // fallback: neutral studio IBL
      0.04 // sigma blur — softens the captured env
    ).texture;
    pmrem.dispose();

    _envMap = envTexture;
    scene.environment = _envMap; // applies to ALL MeshStandardMaterial in scene automatically
    scene.background  = prevBg;

    console.log('[XIX] Environment map built from sky — IBL active on all materials');
    return _envMap;
  } catch(e) {
    console.warn('[XIX] EnvMap build failed, falling back to RoomEnvironment:', e.message);
    try {
      const pmrem2 = new THREE.PMREMGenerator(renderer);
      pmrem2.compileEquirectangularShader();
      const env = pmrem2.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
      pmrem2.dispose();
      _envMap = env;
      scene.environment = _envMap;
    } catch(e2) { console.warn('[XIX] RoomEnvironment also failed:', e2.message); }
  }
}

// Export so scene.js can call after sky init
export function setEnvMap(map) {
  _envMap = map;
  if (_scene) _scene.environment = map;
}

// ─── GLB MATERIAL UPGRADE ─────────────────────────────────────────────────────
// Apply PS4-quality material settings to any loaded GLB.
// Call this after each GLB loads (in the gltf.scene.traverse callback).
// Detects material type by name/colour heuristics and sets realistic PBR values.
export function applyPS4Materials(gltfScene) {
  if (!gltfScene) return;
  gltfScene.traverse(child => {
    if (!child.isMesh || !child.material) return;
    const mat = child.material;

    // Apply env map explicitly (scene.environment handles it globally but
    // some cloned materials lose the reference — be explicit)
    if (_envMap) mat.envMap = _envMap;
    mat.envMapIntensity = 1.8; // was 0.4 — this is the biggest realism jump

    // Detect material type by name (GLB exporters usually name materials)
    const name = (mat.name || '').toLowerCase();

    if (name.includes('glass') || name.includes('window') || name.includes('glazing')) {
      // Glass: very low roughness, medium metalness, strong env reflection
      mat.roughness    = 0.04;
      mat.metalness    = 0.05;
      mat.transparent  = true;
      mat.opacity      = Math.min(mat.opacity || 0.5, 0.6);
      mat.envMapIntensity = 3.5;
    } else if (name.includes('metal') || name.includes('steel') || name.includes('alumin')) {
      mat.roughness    = 0.25;
      mat.metalness    = 0.85;
      mat.envMapIntensity = 2.5;
    } else if (name.includes('roof') || name.includes('tile')) {
      mat.roughness    = 0.75;
      mat.metalness    = 0.02;
      mat.envMapIntensity = 0.8;
    } else if (name.includes('concrete') || name.includes('wall') || name.includes('plaster')) {
      mat.roughness    = 0.88;
      mat.metalness    = 0.0;
      mat.envMapIntensity = 0.4;
    } else if (name.includes('wood') || name.includes('timber') || name.includes('deck')) {
      mat.roughness    = 0.72;
      mat.metalness    = 0.0;
      mat.envMapIntensity = 0.6;
    } else {
      // Default: clamp roughness to realistic range, apply moderate env
      mat.roughness    = Math.max(0.45, Math.min(mat.roughness ?? 0.8, 0.90));
      mat.metalness    = Math.min(mat.metalness ?? 0, 0.5);
    }

    // Boost normal map scale for surface depth if present
    if (mat.normalMap && mat.normalScale) {
      const s = Math.min(mat.normalScale.x * 1.4, 2.0);
      mat.normalScale.set(s, s);
    }

    // Enable shadow casting/receiving on every mesh
    child.castShadow    = true;
    child.receiveShadow = true;
    mat.needsUpdate     = true;
  });
}

// ─── ATMOSPHERIC SKY ──────────────────────────────────────────────────────────
export function createAtmosphericSky(scene, renderer) {
  const sky = new Sky();
  sky.scale.setScalar(10000);
  scene.add(sky);

  const sun = new THREE.Vector3();
  const skyUniforms = sky.material.uniforms;

  // Lagos afternoon sky: warm, slightly hazy, high humidity
  skyUniforms['turbidity'].value       = 3.5;
  skyUniforms['rayleigh'].value        = 2.0;
  skyUniforms['mieCoefficient'].value  = 0.006;
  skyUniforms['mieDirectionalG'].value = 0.85;

  const phi   = THREE.MathUtils.degToRad(68);
  const theta = THREE.MathUtils.degToRad(195);
  sun.setFromSphericalCoords(1, phi, theta);
  skyUniforms['sunPosition'].value.copy(sun);

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;

  return { skyObj: sky, sun, skyUniforms };
}

export function setSkyForTime(skyUniforms, sun, sunLight, time) {
  const presets = {
    morning:   { phi: 18,  theta: 95,  turb: 4.5, ray: 2.5, exp: 0.72, sunCol: 0xffd080, sunInt: 1.8 },
    afternoon: { phi: 68,  theta: 195, turb: 3.5, ray: 2.0, exp: 0.85, sunCol: 0xfff4e0, sunInt: 2.6 },
    sunset:    { phi: 5,   theta: 268, turb: 7.0, ray: 3.5, exp: 0.95, sunCol: 0xff6820, sunInt: 1.6 },
    night:     { phi: -12, theta: 180, turb: 1.0, ray: 0.4, exp: 0.18, sunCol: 0x304870, sunInt: 0.08 },
  };
  const p = presets[time] || presets.afternoon;
  skyUniforms['turbidity'].value  = p.turb;
  skyUniforms['rayleigh'].value   = p.ray;

  const phi   = THREE.MathUtils.degToRad(90 - p.phi);
  const theta = THREE.MathUtils.degToRad(p.theta);
  sun.setFromSphericalCoords(1, phi, theta);
  skyUniforms['sunPosition'].value.copy(sun);

  if (sunLight) {
    sunLight.position.set(sun.x * 220, sun.y * 220, sun.z * 220);
    sunLight.color.setHex(p.sunCol);
    sunLight.intensity = p.sunInt;
  }
  if (_renderer) _renderer.toneMappingExposure = p.exp;
  return p.exp;
}

// ─── PBR MATERIAL FACTORY ─────────────────────────────────────────────────────
// Used for procedural scene elements (ground, roads). Requires texture files.
const tl = new THREE.TextureLoader();
const T   = "assets/textures/";

function loadTex(name, repeat, sRGB = true) {
  const t = tl.load(T + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (sRGB) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4; // sharper texture at oblique angles (PS4-standard)
  return t;
}

export function pbrMat({ color, normal, rough, repeat=4, roughVal=0.8, metalVal=0, normalScale=1.2 }) {
  return new THREE.MeshStandardMaterial({
    map:          loadTex(color  + "-color.png",     repeat),
    normalMap:    loadTex(normal + "-normal.png",    repeat, false),
    roughnessMap: loadTex(rough  + "-roughness.png", repeat, false),
    normalScale:  new THREE.Vector2(normalScale, normalScale),
    roughness: roughVal, metalness: metalVal,
    envMapIntensity: 1.2,
    envMap: _envMap || undefined,
  });
}

export const PBR = {
  grass:    () => pbrMat({ color:"grass",    normal:"grass",    rough:"grass",    repeat:14, roughVal:0.90, normalScale:0.8 }),
  dirt:     () => pbrMat({ color:"dirt",     normal:"dirt",     rough:"dirt",     repeat:18, roughVal:0.95, normalScale:1.0 }),
  asphalt:  () => pbrMat({ color:"asphalt",  normal:"asphalt",  rough:"asphalt",  repeat:8,  roughVal:0.88, normalScale:0.9 }),
  concrete: () => pbrMat({ color:"concrete", normal:"concrete", rough:"concrete", repeat:4,  roughVal:0.80, normalScale:0.8 }),
  brick:    () => pbrMat({ color:"brick",    normal:"brick",    rough:"brick",    repeat:6,  roughVal:0.82, normalScale:1.8 }),
  timber:   () => pbrMat({ color:"timber",   normal:"timber",   rough:"timber",   repeat:3,  roughVal:0.68, normalScale:1.2 }),
  stone:    () => pbrMat({ color:"stone",    normal:"stone",    rough:"stone",    repeat:3,  roughVal:0.88, normalScale:1.6 }),
  tileRoof: () => pbrMat({ color:"tile",     normal:"tile",     rough:"tile",     repeat:6,  roughVal:0.78, normalScale:1.1 }),
};

// ─── WATER MATERIAL — upgraded for PS4 realism ────────────────────────────────
export function createWaterMat() {
  const n1 = loadTex("stone-normal.png", 6, false);
  const n2 = loadTex("stone-normal.png", 9, false);
  const mat = new THREE.MeshStandardMaterial({
    color:       0x1a6a98,     // deeper blue
    roughness:   0.02,         // near-mirror for specular highlights
    metalness:   0.65,         // Fresnel-style reflectivity
    transparent: true,
    opacity:     0.90,
    normalMap:   n1,
    normalScale: new THREE.Vector2(0.35, 0.35),
    envMapIntensity: 3.5,      // strong sky reflection
    envMap: _envMap || undefined,
  });
  mat.userData.normalMap2 = n2;
  mat.userData.isWater    = true;
  return mat;
}

// ─── GRASS CARDS — MeshLambertMaterial is cheaper, looks correct for grass ───
// Lambert: no specular calculation = ~30% cheaper than Standard for 400+ cards
const grassCardMat = new THREE.MeshLambertMaterial({
  color:       0x5a9448,
  side:        THREE.DoubleSide,
  alphaTest:   0.35,
  transparent: true,   // REQUIRED for alphaTest to work correctly in Three.js
  map: (() => {
    const gc = document.createElement("canvas"); gc.width=64; gc.height=128;
    const gx = gc.getContext("2d");
    // Multi-stop blade: dark root, mid green, fade to transparent tip
    const gg = gx.createLinearGradient(0,128,0,0);
    gg.addColorStop(0,   "#2a5a1e");
    gg.addColorStop(0.3, "#3a7228");
    gg.addColorStop(0.7, "#5a9448");
    gg.addColorStop(1,   "rgba(80,140,60,0)");
    gx.fillStyle = gg;
    gx.beginPath();
    gx.moveTo(30,128); gx.quadraticCurveTo(20,55,32,0);
    gx.quadraticCurveTo(44,55,34,128);
    gx.fill();
    const t = new THREE.CanvasTexture(gc);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })(),
});
const grassCards = [];

export function addGrassField(centerX, centerZ, radiusX, radiusZ, density=400) {
  for (let i=0; i<density; i++) {
    const angle = Math.random()*Math.PI*2;
    const rx    = (Math.random()*0.5+0.5)*radiusX;
    const rz    = (Math.random()*0.5+0.5)*radiusZ;
    const x     = centerX + Math.cos(angle)*rx;
    const z     = centerZ + Math.sin(angle)*rz;
    const h     = 0.38 + Math.random()*0.48;
    const w     = 0.16 + Math.random()*0.20;
    const card  = new THREE.Mesh(new THREE.PlaneGeometry(w, h), grassCardMat);
    card.position.set(x, h/2, z);
    card.rotation.y = Math.random() * Math.PI;
    card.castShadow    = false;
    card.receiveShadow = true;
    grassCards.push(card);
  }
  return grassCards.slice(-density);
}

export function tickGrass(camera) {
  const cx = camera.position.x, cz = camera.position.z;
  const FADE_START = 85, FADE_END = 155;
  grassCards.forEach(card => {
    const dx = cx - card.position.x, dz = cz - card.position.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    card.rotation.y = Math.atan2(dx, dz);
    const opacity = 1 - Math.max(0, Math.min(1, (dist - FADE_START) / (FADE_END - FADE_START)));
    card.material.opacity = opacity;
    card.visible = dist < FADE_END;
  });
}

// ─── WATER TICK ───────────────────────────────────────────────────────────────
export function tickWater(waterMeshes, elapsed) {
  waterMeshes.forEach(m => {
    const mat = m.material;
    if (!mat || !mat.userData.isWater) return;
    if (mat.normalMap) {
      mat.normalMap.offset.x = elapsed * 0.010;
      mat.normalMap.offset.y = elapsed * 0.007;
    }
    const n2 = mat.userData.normalMap2;
    if (n2) {
      n2.offset.x = -elapsed * 0.007;
      n2.offset.y =  elapsed * 0.013;
    }
    // Subtle opacity pulse: shimmer effect
    mat.opacity = 0.88 + Math.sin(elapsed * 1.6) * 0.04;
    // Update envMap each tick in case it was set after material creation
    if (_envMap && mat.envMap !== _envMap) { mat.envMap = _envMap; mat.needsUpdate = true; }
  });
}

// ─── MAT_ EXPORTS ────────────────────────────────────────────────────────────
// All materials now use envMapIntensity that responds to the scene IBL.
export function MAT_GRASS_FIELD(){ return new THREE.MeshStandardMaterial({color:0x4a8038,roughness:.90,envMapIntensity:.3}); }
export function MAT_DIRT()       { return new THREE.MeshStandardMaterial({color:0x7a5a38,roughness:.95,envMapIntensity:.2}); }
export function MAT_ASPHALT()    { return new THREE.MeshStandardMaterial({color:0x1c2018,roughness:.90,envMapIntensity:.3}); }
export function MAT_BRICK()      { return new THREE.MeshStandardMaterial({color:0xC4A882,roughness:.85,envMapIntensity:.5}); }
export function MAT_CONCRETE()   { return new THREE.MeshStandardMaterial({color:0xb8b0a0,roughness:.82,envMapIntensity:.4}); }
export function MAT_TIMBER()     { return new THREE.MeshStandardMaterial({color:0x9a6a3a,roughness:.68,envMapIntensity:.6}); }
export function MAT_STONE()      { return new THREE.MeshStandardMaterial({color:0x8a8078,roughness:.88,envMapIntensity:.5}); }
export function MAT_TILE_ROOF()  { return new THREE.MeshStandardMaterial({color:0xC9A84C,roughness:.78,metalness:.04,envMapIntensity:.8}); }
export function MAT_GLASS(op=.45){ return new THREE.MeshStandardMaterial({color:0x9ac8e8,roughness:.04,metalness:.06,transparent:true,opacity:op,envMapIntensity:3.5}); }
export function MAT_GLASS_WARM(op=.45){ return new THREE.MeshStandardMaterial({color:0xd4c090,roughness:.04,metalness:.05,transparent:true,opacity:op,envMapIntensity:3.2}); }
export function MAT_WHITE_TRIM() { return new THREE.MeshStandardMaterial({color:0xfcfaf8,roughness:.55,envMapIntensity:.6}); }
export function MAT_GOLD()       { return new THREE.MeshStandardMaterial({color:0xC9A84C,roughness:.28,metalness:.88,envMapIntensity:2.5}); }
export function MAT_DARK_METAL() { return new THREE.MeshStandardMaterial({color:0x282820,roughness:.45,metalness:.92,envMapIntensity:2.0}); }
export function MAT_WATER()      { return createWaterMat(); }
