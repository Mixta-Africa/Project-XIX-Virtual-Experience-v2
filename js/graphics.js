/**
 * Project XIX -- Graphics Engine v1
 * Optimized: Grass cards converted to InstancedMesh (Massive CPU Draw Call reduction)
 */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { EffectComposer }  from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass }      from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass }      from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass }        from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/SMAAPass.js";

let composer, bloomPass;

export function initPostProcessing(renderer, scene, camera) {
  const w = renderer.domElement.clientWidth  || window.innerWidth;
  const h = renderer.domElement.clientHeight || window.innerHeight;

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    0.18, 0.5, 0.88 
  );
  composer.addPass(bloomPass);
  composer.addPass(new SMAAPass(w, h));
  composer.addPass(new OutputPass());

  return composer;
}

export function resizeComposer(w, h) {
  if (!composer) return;
  composer.setSize(w, h);
  if (bloomPass) bloomPass.resolution.set(w, h);
}

export function renderFrame() {
  if (composer) composer.render();
}

export function setBloomForTime(name) {
  if (!bloomPass) return;
  const presets = {
    morning:   { strength: 0.28, threshold: 0.85 },
    afternoon: { strength: 0.32, threshold: 0.82 },
    sunset:    { strength: 0.55, threshold: 0.72 }, 
    night:     { strength: 0.80, threshold: 0.55 }, 
  };
  const p = presets[name] || presets.afternoon;
  bloomPass.strength  = p.strength;
  bloomPass.threshold = p.threshold;
}

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
    color:    0x2a7fa8, roughness: 0.04, metalness: 0.45,
    transparent: true, opacity:  0.88,
    normalMap: n1, normalScale: new THREE.Vector2(0.28, 0.28),
    envMapIntensity: 2.2, 
  });
  mat.userData.normalMap2 = n2;
  mat.userData.isWater    = true;
  return mat;
}

const grassCardMat = new THREE.MeshStandardMaterial({
  color:     0x5a9448, roughness: 0.92,
  side:      THREE.DoubleSide, alphaTest: 0.45,
  map:       (() => {
    const gc = document.createElement("canvas"); gc.width=64; gc.height=128;
    const gx = gc.getContext("2d");
    const gg = gx.createLinearGradient(0,128,0,0);
    gg.addColorStop(0, "#3a7228"); gg.addColorStop(0.6, "#5a9448"); gg.addColorStop(1, "rgba(80,140,60,0)");
    gx.fillStyle = gg;
    gx.beginPath(); gx.moveTo(28,128); gx.quadraticCurveTo(24,40,32,0); gx.quadraticCurveTo(40,40,36,128);
    gx.fill();
    const t = new THREE.CanvasTexture(gc);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })(),
});

// INSTANCED GRASS SYSTEM (Zero Lag)
const instancedGrassSystems = [];
const dummyGrass = new THREE.Object3D();

export function addGrassField(centerX, centerZ, radiusX, radiusZ, density = 400) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.translate(0, 0.5, 0); 
  
  const instancedMesh = new THREE.InstancedMesh(geometry, grassCardMat, density);
  instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  instancedMesh.receiveShadow = true;
  instancedMesh.castShadow = false;

  const positions = [];
  for (let i = 0; i < density; i++) {
    const angle  = Math.random() * Math.PI * 2;
    const rx     = (Math.random() * 0.5 + 0.5) * radiusX;
    const rz     = (Math.random() * 0.5 + 0.5) * radiusZ;
    const x      = centerX + Math.cos(angle) * rx;
    const z      = centerZ + Math.sin(angle) * rz;
    const h      = 0.35 + Math.random() * 0.45;
    const w      = 0.18 + Math.random() * 0.18;

    dummyGrass.position.set(x, 0, z);
    dummyGrass.scale.set(w, h, 1);
    dummyGrass.rotation.y = Math.random() * Math.PI;
    dummyGrass.updateMatrix();
    instancedMesh.setMatrixAt(i, dummyGrass.matrix);
    
    positions.push({ x, z, scaleX: w, scaleY: h });
  }

  instancedMesh.instanceMatrix.needsUpdate = true;
  instancedGrassSystems.push({ mesh: instancedMesh, positions });
  
  return [instancedMesh]; 
}

export function tickGrass(camera) {
  const cx = camera.position.x, cz = camera.position.z;
  instancedGrassSystems.forEach(system => {
    const { mesh, positions } = system;
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      dummyGrass.position.set(pos.x, 0, pos.z);
      dummyGrass.scale.set(pos.scaleX, pos.scaleY, 1);
      dummyGrass.rotation.y = Math.atan2(cx - pos.x, cz - pos.z);
      dummyGrass.updateMatrix();
      mesh.setMatrixAt(i, dummyGrass.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
}

export function tickWater(waterMeshes, elapsed) {
  waterMeshes.forEach(m => {
    const mat = m.material;
    if (!mat || !mat.userData.isWater) return;
    if (mat.normalMap) {
      mat.normalMap.offset.x = elapsed * 0.012;
      mat.normalMap.offset.y = elapsed * 0.008;
    }
    const n2 = mat.userData.normalMap2;
    if (n2) {
      n2.offset.x = -elapsed * 0.008;
      n2.offset.y =  elapsed * 0.014;
    }
    mat.opacity = 0.86 + Math.sin(elapsed * 1.8) * 0.04;
  });
}
