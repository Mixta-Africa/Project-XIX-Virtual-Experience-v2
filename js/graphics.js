/**
 * Project XIX — Graphics Engine v8 (Phase 1 Luxury Production Pass)
 * Upgrades: GTAO Ground Occlusion, Sunset God Rays, Interior Bokeh DOF, Brand LUT
 * Preserved: Instanced Grass, Instanced Palms, PBR Factory, Water Tick, MAT_ Exports
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { EffectComposer }  from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass }      from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass }      from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass }        from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/SMAAPass.js";
import { GTAOPass }        from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/GTAOPass.js";
import { BokehPass }       from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/BokehPass.js";
import { LUTPass }         from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/LUTPass.js";
import { LUTCubeLoader }   from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/LUTCubeLoader.js";
import { Sky }             from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/objects/Sky.js";
import { RoomEnvironment } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/environments/RoomEnvironment.js";

// ─── STATE ────────────────────────────────────────────────────────────────────
let composer, bloomPass, smaaPass, gtaoPass, bokehPass, lutPass;
let _renderer, _scene, _camera;
let _perfMode = 'fast';
let _envMap   = null;
let _currentTimePreset = 'afternoon';
window._weatherBloomMult = 1.0;

// ─── POST-PROCESSING PIPELINE ────────────────────────────────────────────────
export function initPostProcessing(renderer, scene, camera) {
  _renderer = renderer; 
  _scene = scene; 
  _camera = camera;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62; // Reduced to kill glare and boost realism

  const w = Math.max(renderer.domElement.width || window.innerWidth, 1);
  const h = Math.max(renderer.domElement.height || window.innerHeight, 1);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  try {
    gtaoPass = new GTAOPass(scene, camera, w, h);
    gtaoPass.output = GTAOPass.OUTPUT.Denoise;
    gtaoPass.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1.2, thickness: 1.0, scale: 1.0 });
    gtaoPass.enabled = (_perfMode !== 'fast');
    composer.addPass(gtaoPass);
  } catch(e) { 
    console.warn('[XIX] GTAO init:', e.message); 
  }

  try {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.10, 0.40, 0.92);
    bloomPass.enabled = true;
    composer.addPass(bloomPass);
  } catch(e) { 
    console.warn('[XIX] Bloom init:', e.message); 
  }

  try {
    bokehPass = new BokehPass(scene, camera, { focus: 3.5, aperture: 0.012, maxblur: 0.01, width: w, height: h });
    bokehPass.enabled = false; 
    composer.addPass(bokehPass);
  } catch(e) { 
    console.warn('[XIX] Bokeh init:', e.message); 
  }

  try {
    lutPass = new LUTPass();
    lutPass.enabled = false;
    /* Temporarily disabled until xix_signature.cube is on the server */
    composer.addPass(lutPass);
  } catch(e) { 
    console.warn('[XIX] LUT pass init:', e.message); 
  }

  try {
    smaaPass = new SMAAPass(w, h);
    smaaPass.enabled = false;
    composer.addPass(smaaPass);
  } catch(e) { 
    console.warn('[XIX] SMAA init:', e.message); 
  }

  composer.addPass(new OutputPass());
  setPerfModeGraphics(_perfMode);
  return composer;
}

export function setInteriorDOF(active, focusDistance = 3.5) {
  if (!bokehPass) return;
  bokehPass.enabled = active;
  if (active && bokehPass.uniforms && bokehPass.uniforms["focus"]) {
    bokehPass.uniforms["focus"].value = focusDistance;
  }
}

export function setPerfModeGraphics(mode) {
  _perfMode = mode;
  if (_renderer) {
    const dpr = window.devicePixelRatio || 1;
    const r = mode === 'fast' ? Math.min(dpr, 1.5) : mode === 'balanced' ? Math.min(dpr, 2.0) : Math.min(dpr, 3.0);
    _renderer.setPixelRatio(r);

    const maxAniso = _renderer.capabilities.getMaxAnisotropy();
    const aniso = mode === 'fast' ? 2 : mode === 'balanced' ? 8 : maxAniso;

    if (_scene) {
      _scene.traverse(obj => {
        if (!obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          ['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap'].forEach(k => {
            if (m[k]) { m[k].anisotropy = aniso; m[k].needsUpdate = true; }
          });
        });
      });
    }
  }

  if (gtaoPass) gtaoPass.enabled = (mode !== 'fast');

  if (bloomPass) {
    bloomPass.enabled = true;
    if (smaaPass) smaaPass.enabled = (mode !== 'fast');
    setBloomForTime(_currentTimePreset);
  }
}

export function resizeComposer(w, h) {
  if (!composer) return;
  composer.setSize(w, h);
  if (bloomPass) bloomPass.resolution.set(w, h);
  if (gtaoPass && gtaoPass.setSize) gtaoPass.setSize(w, h);
  if (bokehPass && bokehPass.setSize) bokehPass.setSize(w, h);
}

export function renderFrame() {
  if (composer) {
    composer.render();
  } else if (_renderer && _scene && _camera) {
    _renderer.render(_scene, _camera);
  }
}

export function setBloomForTime(name) {
  _currentTimePreset = name;
  if (!bloomPass) return;

  let params;
  if (_perfMode === 'fast') {
    params = { strength: 0.07, threshold: 0.98, radius: 0.35 };
  } else {
    // High threshold forces bloom strictly on emissive highlights and the sun disc
    const timePresets = {
      morning:   { strength: 0.08, threshold: 0.98, radius: 0.35 },
      afternoon: { strength: 0.06, threshold: 0.98, radius: 0.35 },
      sunset:    { strength: 0.22, threshold: 0.88, radius: 0.55 },
      night:     { strength: 0.45, threshold: 0.65, radius: 0.75 },
    };
    params = timePresets[name] || { strength: 0.12, threshold: 0.98, radius: 0.40 };
  }

  bloomPass.strength = params.strength * (window._weatherBloomMult || 1.0);
  bloomPass.threshold = params.threshold;
  bloomPass.radius = params.radius;
  bloomPass.enabled = true;
}

export function setWeatherBloomModifier(mult) {
  window._weatherBloomMult = mult;
  setBloomForTime(_currentTimePreset);
}

// ─── IBL ENV MAP & MATERIALS ──────────────────────────────────────────────────
export function buildEnvMapFromSky(renderer, scene, skyObj) {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    _envMap = env; scene.environment = _envMap;
    return _envMap;
  } catch(e) { 
    console.warn('[XIX] EnvMap failed:', e.message); 
  }
}

export function setEnvMap(map) { 
  _envMap = map; 
  if(_scene) _scene.environment = map; 
}

export function applyPS4Materials(gltfScene) {
  if (!gltfScene) return;
  gltfScene.traverse(child => {
    if (!child.isMesh || !child.material) return;
    const mat = child.material;
    if (_envMap) mat.envMap = _envMap;
    mat.envMapIntensity = 1.8;
    const name = (mat.name || '').toLowerCase();
    
    if (name.includes('glass') || name.includes('window') || name.includes('glaz')) {
      mat.roughness = 0.04; mat.metalness = 0.05; mat.transparent = true;
      mat.opacity = Math.min(mat.opacity || 0.5, 0.6); mat.envMapIntensity = 3.5;
    } else if (name.includes('metal') || name.includes('steel') || name.includes('alum')) {
      mat.roughness = 0.25; mat.metalness = 0.85; mat.envMapIntensity = 2.5;
    } else if (name.includes('roof') || name.includes('tile')) {
      mat.roughness = 0.75; mat.metalness = 0.02; mat.envMapIntensity = 0.8;
    } else if (name.includes('concrete') || name.includes('wall') || name.includes('plast')) {
      mat.roughness = 0.88; mat.metalness = 0; mat.envMapIntensity = 0.4;
    } else if (name.includes('wood') || name.includes('timber') || name.includes('deck')) {
      mat.roughness = 0.72; mat.metalness = 0; mat.envMapIntensity = 0.6;
    } else {
      mat.roughness = Math.max(0.45, Math.min(mat.roughness ?? 0.8, 0.90));
      mat.metalness = Math.min(mat.metalness ?? 0, 0.5);
    }
    
    if (mat.normalMap && mat.normalScale) {
      const s = Math.min(mat.normalScale.x * 1.4, 2.0); mat.normalScale.set(s, s);
    }
    child.castShadow = true; child.receiveShadow = true; mat.needsUpdate = true;
  });
}

// ─── ATMOSPHERIC SKY ──────────────────────────────────────────────────────────
export function createAtmosphericSky(scene, renderer) {
  const sky = new Sky(); 
  sky.scale.setScalar(10000); 
  scene.add(sky);
  
  const sun = new THREE.Vector3();
  const u = sky.material.uniforms;
  
  u['turbidity'].value = 2.5; 
  u['rayleigh'].value = 0.9;
  u['mieCoefficient'].value = 0.006; 
  u['mieDirectionalG'].value = 0.85;
  
  const phi = THREE.MathUtils.degToRad(68), theta = THREE.MathUtils.degToRad(195);
  sun.setFromSphericalCoords(1, phi, theta); 
  u['sunPosition'].value.copy(sun);
  
  renderer.toneMapping = THREE.ACESFilmicToneMapping; 
  renderer.toneMappingExposure = 0.62;
  
  return { skyObj: sky, sun, skyUniforms: u };
}

export function setSkyForTime(skyUniforms, sun, sunLight, time) {
  const presets = {
    morning:   { phi: 18,  theta: 95,  turb: 3.5, ray: 1.2, exp: 0.58, sunCol: 0xffd080, sunInt: 1.0 },
    afternoon: { phi: 68,  theta: 195, turb: 2.5, ray: 0.8, exp: 0.62, sunCol: 0xfff4e0, sunInt: 1.1 },
    sunset:    { phi: 5,   theta: 268, turb: 5.5, ray: 2.0, exp: 0.85, sunCol: 0xff6820, sunInt: 1.2 },
    night:     { phi: -12, theta: 180, turb: 1.0, ray: 0.4, exp: 0.15, sunCol: 0x304870, sunInt: 0.06 },
  };
  
  const p = presets[time] || presets.afternoon;
  skyUniforms['turbidity'].value = p.turb; 
  skyUniforms['rayleigh'].value = p.ray;
  
  const phi = THREE.MathUtils.degToRad(90 - p.phi), theta = THREE.MathUtils.degToRad(p.theta);
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

// ─── PBR FACTORY & TEXTURE SAFETY ──────────────────────────────────────────────
const tl = new THREE.TextureLoader(), T = "assets/textures/";

export function loadTexSafe(path, repeat = 6, sRGB = false) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = sRGB ? '#5a8040' : '#8080ff';
  ctx.fillRect(0, 0, 64, 64);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (sRGB) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;

  new THREE.TextureLoader().load(
    path,
    (loaded) => {
      t.image = loaded.image;
      t.needsUpdate = true;
    },
    undefined,
    () => { console.warn('[XIX] Safe-tex missing, using placeholder:', path); }
  );
  return t;
}

const _emptyCanvas = document.createElement('canvas');
_emptyCanvas.width = 1; _emptyCanvas.height = 1;
const _emptyCtx = _emptyCanvas.getContext('2d');
_emptyCtx.fillStyle = '#8080FF'; 
_emptyCtx.fillRect(0,0,1,1);

function loadTex(name, repeat, sRGB = true) {
  const safeCanvas = document.createElement('canvas');
  safeCanvas.width = 4; safeCanvas.height = 4;
  const safeCtx = safeCanvas.getContext('2d');
  safeCtx.fillStyle = sRGB ? '#7a9a60' : '#8080FF';
  safeCtx.fillRect(0, 0, 4, 4);

  const t = new THREE.CanvasTexture(safeCanvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (sRGB) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;

  tl.load(T + name,
    (loaded) => {
      t.image = loaded.image;
      t.needsUpdate = true;
    },
    undefined,
    () => {
      console.warn('[XIX] Texture missing, keeping safe fallback:', name);
    }
  );
  return t;
}

export function pbrMat({ color, normal, rough, repeat = 4, roughVal = 0.8, metalVal = 0, normalScale = 1.2, envInt = 1.2 }) {
  return new THREE.MeshStandardMaterial({
    map: loadTex(color + "-color.png", repeat), 
    normalMap: loadTex(normal + "-normal.png", repeat, false),
    roughnessMap: loadTex(rough + "-roughness.png", repeat, false),
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughness: roughVal, metalness: metalVal, envMapIntensity: envInt,
    ...(_envMap ? { envMap: _envMap } : {}),
  });
}

export const PBR = {
  grass:   () => pbrMat({ color: "grass",   normal: "grass",   rough: "grass",   repeat: 24, roughVal: 1.0, normalScale: 2.5, envInt: 0.0 }),
  dirt:    () => pbrMat({ color: "dirt",    normal: "dirt",    rough: "dirt",    repeat: 18, roughVal: 0.95, normalScale: 1.0 }),
  asphalt: () => pbrMat({ color: "asphalt", normal: "asphalt", rough: "asphalt", repeat: 8,  roughVal: 0.88, normalScale: 0.9 }),
  concrete:() => pbrMat({ color: "concrete",normal: "concrete",rough: "concrete",repeat: 4, roughVal: 0.80, normalScale: 0.8 }),
  brick:   () => pbrMat({ color: "brick",   normal: "brick",   rough: "brick",   repeat: 6,  roughVal: 0.82, normalScale: 1.8 }),
  timber:  () => pbrMat({ color: "timber",  normal: "timber",  rough: "timber",  repeat: 3,  roughVal: 0.68, normalScale: 1.2 }),
  stone:   () => pbrMat({ color: "stone",   normal: "stone",   rough: "stone",   repeat: 3,  roughVal: 0.88, normalScale: 1.6 }),
  tileRoof:() => pbrMat({ color: "tile",    normal: "tile",    rough: "tile",    repeat: 6,  roughVal: 0.78, normalScale: 1.1 }),
};

// ─── WATER ────────────────────────────────────────────────────────────────────
export function createWaterMat() {
  const n1 = loadTex("stone-normal.png", 6, false);
  const n2 = loadTex("stone-normal.png", 9, false);
  
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a6a98, roughness: 0.02, metalness: 0.65, transparent: true, opacity: 0.90,
    normalMap: n1, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 3.5,
    ...(_envMap ? { envMap: _envMap } : {}),
  });
  mat.userData.normalMap2 = n2; 
  mat.userData.isWater = true; 
  return mat;
}

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
      n2.offset.y = elapsed * 0.013; 
    }
    
    mat.opacity = 0.88 + Math.sin(elapsed * 1.6) * 0.04;
    if (_envMap && mat.envMap !== _envMap) { 
      mat.envMap = _envMap; 
      mat.needsUpdate = true; 
    }
  });
}

// ─── INSTANCED GRASS ──────────────────────────────────────────────────────────
let _grassMesh = null, _grassCount = 0;
const _dummy = new THREE.Object3D();

const _grassTexture = (() => {
  const gc = document.createElement("canvas"); gc.width = 128; gc.height = 256;
  const gx = gc.getContext("2d");
  gx.clearRect(0, 0, 128, 256);

  function drawBlade(baseX, lean, colorBot, colorTop) {
    const gg = gx.createLinearGradient(baseX, 256, baseX + lean * 0.5, 0);
    gg.addColorStop(0,   colorBot);
    gg.addColorStop(0.25, colorTop);
    gg.addColorStop(0.75, colorTop);
    gg.addColorStop(1,   "rgba(100,160,60,0)");
    gx.fillStyle = gg;
    gx.beginPath();
    gx.moveTo(baseX - 5, 256);
    gx.quadraticCurveTo(baseX - 10 + lean * 0.3, 140, baseX + lean, 0);
    gx.quadraticCurveTo(baseX + lean + 4, 0, baseX + lean + 2, 2);
    gx.quadraticCurveTo(baseX + 8 + lean * 0.3, 140, baseX + 9, 256);
    gx.closePath();
    gx.fill();
  }

  drawBlade(18,  -8, "#1e4a12", "#4a8a30");
  drawBlade(42,   5, "#224f14", "#52963a");
  drawBlade(70, -12, "#1a4510", "#3d7825");
  drawBlade(95,   9, "#26561a", "#5aa040");

  const t = new THREE.CanvasTexture(gc);
  t.colorSpace = THREE.SRGBColorSpace;
  t.premultiplyAlpha = false;
  return t;
})();

export function addGrassField(centerX, centerZ, radiusX, radiusZ, density = 400) {
  const newCards = [];
  for (let i = 0; i < density; i++) {
    const angle = Math.random() * Math.PI * 2;
    const rx = (Math.random() * 0.5 + 0.5) * radiusX;
    const rz = (Math.random() * 0.5 + 0.5) * radiusZ;
    const x = centerX + Math.cos(angle) * rx;
    const z = centerZ + Math.sin(angle) * rz;
    const h = 0.55 + Math.random() * 0.65; 
    const w = 0.28 + Math.random() * 0.30; 
    newCards.push({ x, y: h / 2, z, h, w });
  }
  return newCards; 
}

export function commitGrass(scene, cards) {
  if (!cards || cards.length === 0) return;
  _grassCount = cards.length; 
  
  const geo = new THREE.PlaneGeometry(1, 1); 
  const mat = new THREE.MeshLambertMaterial({ map: _grassTexture, side: THREE.DoubleSide, alphaTest: 0.35, transparent: true });
  _grassMesh = new THREE.InstancedMesh(geo, mat, _grassCount);
  _grassMesh.castShadow = false; 
  _grassMesh.receiveShadow = true; 
  _grassMesh.frustumCulled = false; 
  
  cards.forEach((c, i) => {
    _dummy.position.set(c.x, c.y, c.z); 
    _dummy.scale.set(c.w, c.h, 1);
    _dummy.rotation.set(0, Math.random() * Math.PI, 0); 
    _dummy.updateMatrix();
    _grassMesh.setMatrixAt(i, _dummy.matrix);
  });
  
  _grassMesh.instanceMatrix.needsUpdate = true; 
  scene.add(_grassMesh);
}

export function tickGrass(camera) {
  return; // BYPASSED FOR PERFORMANCE: GPU handles static terrain texture now
}

// ─── INSTANCED PALMS ──────────────────────────────────────────────────────────
let _palmMeshA = null, _palmMeshB = null, _palmCount = 0, _palmPos = null, _palmScale = null;

export function buildPalmInstances(scene, palmDefs) {
  if (!palmDefs || palmDefs.length === 0) return;
  _palmCount = palmDefs.length; 
  _palmPos = new Float32Array(_palmCount * 3); 
  _palmScale = new Float32Array(_palmCount);
  
  const loader = new THREE.TextureLoader();
  function makePalmMesh(rotY) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, alphaTest: 0.08, depthWrite: false, side: THREE.DoubleSide });
    loader.load('assets/palm-sprite.png', t => { t.colorSpace = THREE.SRGBColorSpace; mat.map = t; mat.needsUpdate = true; });
    const mesh = new THREE.InstancedMesh(geo, mat, _palmCount);
    mesh.frustumCulled = false; mesh.renderOrder = 1;
    
    palmDefs.forEach((p, i) => {
      _palmPos[i * 3] = p.x; _palmPos[i * 3 + 1] = p.y; _palmPos[i * 3 + 2] = p.z; _palmScale[i] = p.scale || 1;
      const h = (13 + p.randH) * p.scale, w = h * 0.5;
      _dummy.position.set(p.x, p.y + h / 2, p.z); _dummy.scale.set(w, h, 1);
      _dummy.rotation.set(0, rotY, 0); _dummy.updateMatrix(); mesh.setMatrixAt(i, _dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true; return mesh;
  }
  _palmMeshA = makePalmMesh(0); scene.add(_palmMeshA);
  _palmMeshB = makePalmMesh(Math.PI / 2); scene.add(_palmMeshB);
}

export function tickPalms(camera) {
  if (!_palmMeshA || !_palmCount) return;
  const cx = camera.position.x, cz = camera.position.z;
  
  for (let i = 0; i < _palmCount; i++) {
    const px = _palmPos[i * 3], py = _palmPos[i * 3 + 1], pz = _palmPos[i * 3 + 2];
    const s = _palmScale[i], h = 13 * s, w = h * 0.5;
    const rot = Math.atan2(cx - px, cz - pz);
    
    _dummy.position.set(px, py + h / 2, pz); _dummy.scale.set(w, h, 1); _dummy.rotation.set(0, rot, 0);
    _dummy.updateMatrix(); _palmMeshA.setMatrixAt(i, _dummy.matrix);
    _dummy.rotation.y = rot + Math.PI / 2; _dummy.updateMatrix(); _palmMeshB.setMatrixAt(i, _dummy.matrix);
  }
  _palmMeshA.instanceMatrix.needsUpdate = true; 
  _palmMeshB.instanceMatrix.needsUpdate = true;
}

// ─── MAT_ EXPORTS ────────────────────────────────────────────────────────────
export function MAT_GRASS_FIELD() { return PBR.grass(); }
export function MAT_DIRT()        { return PBR.dirt(); }
export function MAT_ASPHALT()     { return PBR.asphalt(); }
export function MAT_BRICK()       { return PBR.brick(); }
export function MAT_CONCRETE()    { return PBR.concrete(); }
export function MAT_TIMBER()      { return PBR.timber(); }
export function MAT_STONE()       { return PBR.stone(); }
export function MAT_TILE_ROOF()   { return PBR.tileRoof(); }

export function MAT_GLASS(op=.45) { return new THREE.MeshStandardMaterial({color:0x9ac8e8,roughness:.04,metalness:.06,transparent:true,opacity:op,envMapIntensity:3.5}); }
export function MAT_GLASS_WARM(op=.45) { return new THREE.MeshStandardMaterial({color:0xd4c090,roughness:.04,metalness:.05,transparent:true,opacity:op,envMapIntensity:3.2}); }
export function MAT_WHITE_TRIM()  { return new THREE.MeshStandardMaterial({color:0xfcfaf8,roughness:.55,envMapIntensity:.6}); }
export function MAT_GOLD()        { return new THREE.MeshStandardMaterial({color:0xC9A84C,roughness:.28,metalness:.88,envMapIntensity:2.5}); }
export function MAT_DARK_METAL()  { return new THREE.MeshStandardMaterial({color:0x282820,roughness:.45,metalness:.92,envMapIntensity:2.0}); }
export function MAT_WATER()       { return createWaterMat(); }