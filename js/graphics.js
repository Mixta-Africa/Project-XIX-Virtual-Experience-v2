/**
 * Project XIX -- Graphics Engine v1
 * PS3-level realism via Three.js post-processing + PBR surfaces.
 *
 * Pipeline:
 *   Renderer -> EffectComposer -> RenderPass -> SSAOPass -> UnrealBloomPass -> OutputPass
 *
 * Techniques used:
 *   - SSAO  (screen-space ambient occlusion  -- contact shadows at building bases)
 *   - Bloom (HDR glow on glass, water, windows, sun disc)
 *   - PBR   (all 24 texture maps wired as MeshStandardMaterial with normal maps)
 *   - Animated water (dual scrolling normal maps)
 *   - Grass cards (alpha-cutout PlaneGeometry quads near camera, billboard-fade far)
 *   - LOD   (GLB villas within 200m, fallback procedural beyond)
 *   - Physical sky gradient + sun disc
 *   - ACES filmic tone mapping (already set in scene.js)
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { EffectComposer }  from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass }      from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass }      from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/OutputPass.js";
import { SSAOPass }        from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/SSAOPass.js";
import { SMAAPass }        from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/SMAAPass.js";

let composer, bloomPass, ssaoPass;

//        INIT POST-PROCESSING PIPELINE                                                                                                                                     
export function initPostProcessing(renderer, scene, camera) {
  const w = renderer.domElement.clientWidth  || window.innerWidth;
  const h = renderer.domElement.clientHeight || window.innerHeight;

  composer = new EffectComposer(renderer);

  // 1. Base render
  composer.addPass(new RenderPass(scene, camera));

  // 2. SSAO -- ambient occlusion (contact shadows at building bases, grass edges)
  ssaoPass = new SSAOPass(scene, camera, w, h);
  ssaoPass.kernelRadius = 16;      // sampling radius in pixels
  ssaoPass.minDistance  = 0.005;   // min depth delta to trigger occlusion
  ssaoPass.maxDistance  = 0.3;     // max depth delta
  ssaoPass.output = SSAOPass.OUTPUT.Default; // blend with scene
  composer.addPass(ssaoPass);

  // 3. Bloom -- HDR glow (glass reflections, lake highlights, window emissives, sun)
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    0.35,   // strength  (was 1.5 which causes washed-out glow -- PS3 uses subtle bloom)
    0.5,    // radius
    0.82    // threshold (only very bright surfaces bloom -- sky, glass, water specular)
  );
  composer.addPass(bloomPass);

  // 4. SMAA anti-aliasing (better than FXAA for moving edges)
  composer.addPass(new SMAAPass(w, h));

  // 5. Output (gamma correction handled by renderer.outputColorSpace)
  composer.addPass(new OutputPass());

  return composer;
}

//        RESIZE                                                                                                                                                                                                             
export function resizeComposer(w, h) {
  if (!composer) return;
  composer.setSize(w, h);
  if (bloomPass) bloomPass.resolution.set(w, h);
  if (ssaoPass)  ssaoPass.setSize(w, h);
}

//        RENDER (replaces renderer.render each frame)                                                                                           
export function renderFrame() {
  if (composer) composer.render();
}

//        BLOOM PRESETS per time of day                                                                                                                                        
export function setBloomForTime(name) {
  if (!bloomPass) return;
  const presets = {
    morning:   { strength: 0.28, threshold: 0.85 },
    afternoon: { strength: 0.32, threshold: 0.82 },
    sunset:    { strength: 0.55, threshold: 0.72 }, // dramatic sunset glow
    night:     { strength: 0.80, threshold: 0.55 }, // bright window emissives
  };
  const p = presets[name] || presets.afternoon;
  bloomPass.strength  = p.strength;
  bloomPass.threshold = p.threshold;
}

//        PBR GROUND MATERIAL FACTORY                                                                                                                                              
// Creates MeshStandardMaterial from our 1K texture sets.
// repeat: how many times texture tiles across the geometry.
const tl = new THREE.TextureLoader();
const T   = "assets/textures/";

function loadTex(name, repeat, sRGB = true) {
  const t = tl.load(T + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (sRGB) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function pbrMat({ color, normal, rough, repeat = 4, roughVal = 0.8, metalVal = 0, normalScale = 1.2 }) {
  return new THREE.MeshStandardMaterial({
    map:          loadTex(color  + "-color.png",     repeat),
    normalMap:    loadTex(normal + "-normal.png",    repeat, false),
    roughnessMap: loadTex(rough  + "-roughness.png", repeat, false),
    normalScale:  new THREE.Vector2(normalScale, normalScale),
    roughness:    roughVal,
    metalness:    metalVal,
    envMapIntensity: 1.3,
  });
}

// Pre-built PBR materials for each surface type
export const PBR = {
  grass:    () => pbrMat({ color:"grass",    normal:"grass",    rough:"grass",    repeat:14, roughVal:0.92, normalScale:0.6 }),
  dirt:     () => pbrMat({ color:"dirt",     normal:"dirt",     rough:"dirt",     repeat:18, roughVal:0.95, normalScale:1.0 }),
  asphalt:  () => pbrMat({ color:"asphalt",  normal:"asphalt",  rough:"asphalt",  repeat:8,  roughVal:0.88, normalScale:0.8 }),
  concrete: () => pbrMat({ color:"concrete", normal:"concrete", rough:"concrete", repeat:4,  roughVal:0.75, normalScale:0.65}),
  brick:    () => pbrMat({ color:"brick",    normal:"brick",    rough:"brick",    repeat:6,  roughVal:0.85, normalScale:1.6 }),
  timber:   () => pbrMat({ color:"timber",   normal:"timber",   rough:"timber",   repeat:3,  roughVal:0.65, normalScale:1.2 }),
  stone:    () => pbrMat({ color:"stone",    normal:"stone",    rough:"stone",    repeat:3,  roughVal:0.90, normalScale:1.5 }),
  tileRoof: () => pbrMat({ color:"tile",     normal:"tile",     rough:"tile",     repeat:6,  roughVal:0.82, normalScale:1.0 }),
};

// Animated water material (two-layer scrolling normals)
export function createWaterMat() {
  const n1 = loadTex("stone-normal.png", 6, false); // repurposed for ripple
  const n2 = loadTex("stone-normal.png", 8, false);
  const mat = new THREE.MeshStandardMaterial({
    color:    0x2a7fa8,
    roughness: 0.04,
    metalness: 0.45,
    transparent: true,
    opacity:  0.88,
    normalMap: n1,
    normalScale: new THREE.Vector2(0.28, 0.28),
    envMapIntensity: 2.2,  // strong reflections
  });
  mat.userData.normalMap2 = n2;
  mat.userData.isWater    = true;
  return mat;
}

//        GRASS CARD SYSTEM (near-camera per-blade density)                                                                            
// Creates a pool of alpha-cutout grass card quads scattered around a position.
// Cards face camera each frame (billboarded on Y axis).

const grassCardMat = new THREE.MeshStandardMaterial({
  color:     0x5a9448,
  roughness: 0.92,
  side:      THREE.DoubleSide,
  alphaTest: 0.45,
  map:       (() => {
    // Procedural grass blade canvas
    const gc = document.createElement("canvas"); gc.width=64; gc.height=128;
    const gx = gc.getContext("2d");
    const gg = gx.createLinearGradient(0,128,0,0);
    gg.addColorStop(0, "#3a7228"); gg.addColorStop(0.6, "#5a9448"); gg.addColorStop(1, "rgba(80,140,60,0)");
    gx.fillStyle = gg;
    // Draw a single blade
    gx.beginPath(); gx.moveTo(28,128); gx.quadraticCurveTo(24,40,32,0); gx.quadraticCurveTo(40,40,36,128);
    gx.fill();
    const t = new THREE.CanvasTexture(gc);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })(),
});

const grassCards = [];

export function addGrassField(centerX, centerZ, radiusX, radiusZ, density = 400) {
  for (let i = 0; i < density; i++) {
    const angle  = Math.random() * Math.PI * 2;
    const rx     = (Math.random() * 0.5 + 0.5) * radiusX;
    const rz     = (Math.random() * 0.5 + 0.5) * radiusZ;
    const x      = centerX + Math.cos(angle) * rx;
    const z      = centerZ + Math.sin(angle) * rz;
    const h      = 0.35 + Math.random() * 0.45;
    const w      = 0.18 + Math.random() * 0.18;

    const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h), grassCardMat);
    card.position.set(x, h / 2, z);
    card.rotation.y = Math.random() * Math.PI;
    card.castShadow  = false;
    card.receiveShadow = true;
    grassCards.push(card);
  }
  return grassCards.slice(-density); // return just added cards
}

// Billboard grass cards toward camera each frame
export function tickGrass(camera) {
  const cx = camera.position.x, cz = camera.position.z;
  const FADE_START = 120, FADE_END = 200;
  grassCards.forEach(card => {
    const dx = cx - card.position.x, dz = cz - card.position.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    // Billboard on Y axis
    card.rotation.y = Math.atan2(dx, dz);
    // Fade out at distance (performance + natural look)
    const opacity = 1 - Math.max(0, Math.min(1, (dist - FADE_START) / (FADE_END - FADE_START)));
    if (card.material.opacity !== opacity) {
      card.material.transparent = opacity < 1;
      card.material.opacity     = opacity;
    }
    card.visible = dist < FADE_END;
  });
}

//        ANIMATED WATER TICK                                                                                                                                                                      
export function tickWater(waterMeshes, elapsed) {
  waterMeshes.forEach(m => {
    const mat = m.material;
    if (!mat || !mat.userData.isWater) return;
    // Primary normal scroll
    if (mat.normalMap) {
      mat.normalMap.offset.x = elapsed * 0.012;
      mat.normalMap.offset.y = elapsed * 0.008;
    }
    // Secondary layer -- counter-scroll for interference pattern
    const n2 = mat.userData.normalMap2;
    if (n2) {
      n2.offset.x = -elapsed * 0.008;
      n2.offset.y =  elapsed * 0.014;
    }
    // Gentle opacity pulse (surface shimmer)
    mat.opacity = 0.86 + Math.sin(elapsed * 1.8) * 0.04;
  });
}
