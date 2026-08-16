/**
 * Project XIX -- Graphics Engine v3
 * Fixes: exports setPerfModeGraphics (was missing, caused SyntaxError)
 * New:   procedural sky shader (Preetham atmospheric scattering)
 *        renderFrame() bypasses EffectComposer entirely in Fast mode
 *        bloom + SMAA gated by perf mode
 *        MAT_ convenience exports so materials.js is optional
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { EffectComposer }  from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass }      from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass }      from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass }        from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/SMAAPass.js";
import { Sky }             from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/objects/Sky.js";

let composer, bloomPass, smaaPass;
let _renderer, _scene, _camera;
let _perfMode = 'fast';

// ─── THE MISSING EXPORT that caused the SyntaxError ──────────────────────────
export function setPerfModeGraphics(mode) {
  _perfMode = mode;
  if (!bloomPass) return;
  if (mode === 'fast') {
    bloomPass.enabled = false;
    if (smaaPass) smaaPass.enabled = false;
  } else if (mode === 'balanced') {
    bloomPass.enabled = true;
    bloomPass.strength = 0.15;
    if (smaaPass) smaaPass.enabled = false;
  } else {
    bloomPass.enabled = true;
    bloomPass.strength = 0.18;
    if (smaaPass) smaaPass.enabled = true;
  }
}

export function initPostProcessing(renderer, scene, camera) {
  _renderer = renderer; _scene = scene; _camera = camera;
  const w = renderer.domElement.clientWidth  || window.innerWidth;
  const h = renderer.domElement.clientHeight || window.innerHeight;
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.18, 0.5, 0.88);
  bloomPass.enabled = false;
  composer.addPass(bloomPass);
  smaaPass = new SMAAPass(w, h);
  smaaPass.enabled = false;
  composer.addPass(smaaPass);
  composer.addPass(new OutputPass());
  return composer;
}

export function resizeComposer(w, h) {
  if (!composer) return;
  composer.setSize(w, h);
  if (bloomPass) bloomPass.resolution.set(w, h);
}

export function renderFrame() {
  if (_perfMode === 'fast' && _renderer && _scene && _camera) {
    _renderer.render(_scene, _camera);
    return;
  }
  if (composer) composer.render();
}

export function setBloomForTime(name) {
  if (!bloomPass) return;
  const p = { morning:{s:0.28,t:0.85}, afternoon:{s:0.32,t:0.82}, sunset:{s:0.55,t:0.72}, night:{s:0.80,t:0.55} }[name] || {s:0.32,t:0.82};
  bloomPass.strength = p.s; bloomPass.threshold = p.t;
}

// ─── PROCEDURAL ATMOSPHERIC SKY ───────────────────────────────────────────────
// Preetham/Hosek-Wilkie scattering via Three.js Sky object.
// Returns { skyObj, sun } - add skyObj to scene, update sun position to change time of day.
export function createAtmosphericSky(scene, renderer) {
  const sky = new Sky();
  sky.scale.setScalar(10000);
  scene.add(sky);

  const sun = new THREE.Vector3();
  const skyUniforms = sky.material.uniforms;
  skyUniforms['turbidity'].value    = 3.5;   // haze (Lagos humidity)
  skyUniforms['rayleigh'].value     = 1.8;   // blue sky scattering
  skyUniforms['mieCoefficient'].value    = 0.008;
  skyUniforms['mieDirectionalG'].value   = 0.82;

  // Set initial afternoon sun position
  const phi   = THREE.MathUtils.degToRad(68);  // 68° above horizon = afternoon
  const theta = THREE.MathUtils.degToRad(195); // south-southwest
  sun.setFromSphericalCoords(1, phi, theta);
  skyUniforms['sunPosition'].value.copy(sun);

  // Update renderer tone mapping for sky
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.5;

  return { skyObj: sky, sun, skyUniforms };
}

// Update sky for a named time preset
export function setSkyForTime(skyUniforms, sun, sunLight, time) {
  const presets = {
    morning:   { phi: 20,  theta: 100, turb: 4.0, ray: 2.2, exp: 0.65, sunCol: 0xffd080, sunInt: 1.6 },
    afternoon: { phi: 68,  theta: 195, turb: 3.5, ray: 1.8, exp: 0.50, sunCol: 0xfff4e0, sunInt: 2.2 },
    sunset:    { phi: 6,   theta: 265, turb: 6.0, ray: 3.0, exp: 0.80, sunCol: 0xff7030, sunInt: 1.4 },
    night:     { phi: -10, theta: 180, turb: 1.0, ray: 0.5, exp: 0.12, sunCol: 0x304870, sunInt: 0.1 },
  };
  const p = presets[time] || presets.afternoon;
  skyUniforms['turbidity'].value   = p.turb;
  skyUniforms['rayleigh'].value    = p.ray;
  const phi   = THREE.MathUtils.degToRad(90 - p.phi);
  const theta = THREE.MathUtils.degToRad(p.theta);
  sun.setFromSphericalCoords(1, phi, theta);
  skyUniforms['sunPosition'].value.copy(sun);
  if (sunLight) {
    sunLight.position.set(sun.x * 200, sun.y * 200, sun.z * 200);
    sunLight.color.setHex(p.sunCol);
    sunLight.intensity = p.sunInt;
  }
  return p.exp; // return target exposure for renderer
}

// ─── PBR MATERIAL FACTORY ─────────────────────────────────────────────────────
const tl = new THREE.TextureLoader();
const T   = "assets/textures/";

function loadTex(name, repeat, sRGB = true) {
  const t = tl.load(T + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (sRGB) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function pbrMat({ color, normal, rough, repeat=4, roughVal=0.8, metalVal=0, normalScale=1.2 }) {
  return new THREE.MeshStandardMaterial({
    map:          loadTex(color  + "-color.png",     repeat),
    normalMap:    loadTex(normal + "-normal.png",    repeat, false),
    roughnessMap: loadTex(rough  + "-roughness.png", repeat, false),
    normalScale:  new THREE.Vector2(normalScale, normalScale),
    roughness: roughVal, metalness: metalVal, envMapIntensity: 1.3,
  });
}

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

export function createWaterMat() {
  const n1 = loadTex("stone-normal.png", 6, false);
  const n2 = loadTex("stone-normal.png", 8, false);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a7fa8, roughness: 0.04, metalness: 0.45,
    transparent: true, opacity: 0.88,
    normalMap: n1, normalScale: new THREE.Vector2(0.28, 0.28), envMapIntensity: 2.2,
  });
  mat.userData.normalMap2 = n2; mat.userData.isWater = true;
  return mat;
}

// ─── GRASS CARD SYSTEM ────────────────────────────────────────────────────────
const grassCardMat = new THREE.MeshStandardMaterial({
  color: 0x5a9448, roughness: 0.92, side: THREE.DoubleSide, alphaTest: 0.45,
  map: (() => {
    const gc = document.createElement("canvas"); gc.width=64; gc.height=128;
    const gx = gc.getContext("2d");
    const gg = gx.createLinearGradient(0,128,0,0);
    gg.addColorStop(0,"#3a7228"); gg.addColorStop(0.6,"#5a9448"); gg.addColorStop(1,"rgba(80,140,60,0)");
    gx.fillStyle=gg;
    gx.beginPath(); gx.moveTo(28,128); gx.quadraticCurveTo(24,40,32,0); gx.quadraticCurveTo(40,40,36,128); gx.fill();
    const t = new THREE.CanvasTexture(gc); t.colorSpace = THREE.SRGBColorSpace; return t;
  })(),
});
const grassCards = [];

export function addGrassField(centerX, centerZ, radiusX, radiusZ, density=400) {
  for (let i=0; i<density; i++) {
    const angle = Math.random()*Math.PI*2;
    const rx = (Math.random()*0.5+0.5)*radiusX, rz = (Math.random()*0.5+0.5)*radiusZ;
    const x = centerX+Math.cos(angle)*rx, z = centerZ+Math.sin(angle)*rz;
    const h = 0.35+Math.random()*0.45, w = 0.18+Math.random()*0.18;
    const card = new THREE.Mesh(new THREE.PlaneGeometry(w,h), grassCardMat);
    card.position.set(x, h/2, z); card.rotation.y = Math.random()*Math.PI;
    card.castShadow=false; card.receiveShadow=true; grassCards.push(card);
  }
  return grassCards.slice(-density);
}

export function tickGrass(camera) {
  const cx=camera.position.x, cz=camera.position.z;
  const FADE_START=80, FADE_END=150;
  grassCards.forEach(card=>{
    const dx=cx-card.position.x, dz=cz-card.position.z;
    const dist=Math.sqrt(dx*dx+dz*dz);
    card.rotation.y = Math.atan2(dx,dz);
    const opacity = 1-Math.max(0,Math.min(1,(dist-FADE_START)/(FADE_END-FADE_START)));
    if (card.material.opacity!==opacity){ card.material.transparent=opacity<1; card.material.opacity=opacity; }
    card.visible = dist<FADE_END;
  });
}

export function tickWater(waterMeshes, elapsed) {
  waterMeshes.forEach(m=>{
    const mat=m.material; if(!mat||!mat.userData.isWater) return;
    if(mat.normalMap){ mat.normalMap.offset.x=elapsed*0.012; mat.normalMap.offset.y=elapsed*0.008; }
    const n2=mat.userData.normalMap2;
    if(n2){ n2.offset.x=-elapsed*0.008; n2.offset.y=elapsed*0.014; }
    mat.opacity=0.86+Math.sin(elapsed*1.8)*0.04;
  });
}

// ─── MAT_ EXPORTS (so materials.js is not required) ──────────────────────────
export function MAT_GRASS_FIELD(){ return new THREE.MeshStandardMaterial({color:0x4a8038,roughness:.92}); }
export function MAT_DIRT()       { return new THREE.MeshStandardMaterial({color:0x8B6914,roughness:.95}); }
export function MAT_ASPHALT()    { return new THREE.MeshStandardMaterial({color:0x1a1e1c,roughness:.88}); }
export function MAT_BRICK()      { return new THREE.MeshStandardMaterial({color:0xC4A882,roughness:.88}); }
export function MAT_CONCRETE()   { return new THREE.MeshStandardMaterial({color:0xc8c0b0,roughness:.80}); }
export function MAT_TIMBER()     { return new THREE.MeshStandardMaterial({color:0x9a6a3a,roughness:.65}); }
export function MAT_STONE()      { return new THREE.MeshStandardMaterial({color:0x9a9090,roughness:.90}); }
export function MAT_TILE_ROOF()  { return new THREE.MeshStandardMaterial({color:0xC9A84C,roughness:.82}); }
export function MAT_GLASS(op=.4) { return new THREE.MeshStandardMaterial({color:0xa8c8e8,roughness:.08,metalness:.6,transparent:true,opacity:op}); }
export function MAT_GLASS_WARM(op=.4){ return new THREE.MeshStandardMaterial({color:0xd4c090,roughness:.08,metalness:.5,transparent:true,opacity:op}); }
export function MAT_WHITE_TRIM() { return new THREE.MeshStandardMaterial({color:0xfcfaf8,roughness:.50}); }
export function MAT_GOLD()       { return new THREE.MeshStandardMaterial({color:0xC9A84C,roughness:.35,metalness:.8}); }
export function MAT_DARK_METAL() { return new THREE.MeshStandardMaterial({color:0x2a2a2a,roughness:.60,metalness:.9}); }
export function MAT_WATER()      { return createWaterMat(); }
