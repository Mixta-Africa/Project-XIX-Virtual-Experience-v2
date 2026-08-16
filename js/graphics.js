/**
 * Project XIX -- Graphics Engine v1
 * PS3-level realism via Three.js post-processing + PBR surfaces.
 *
 * Pipeline:
 *   Renderer -> EffectComposer -> RenderPass -> UnrealBloomPass -> OutputPass
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
import { SMAAPass }        from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/SMAAPass.js";

let composer, bloomPass;

//        INIT POST-PROCESSING PIPELINE                                                                                                                                     
export function initPostProcessing(renderer, scene, camera) {
  const w = renderer.domElement.clientWidth  || window.innerWidth;
  const h = renderer.domElement.clientHeight || window.innerHeight;

  composer = new EffectComposer(renderer);

  // 1. Base render
  composer.addPass(new RenderPass(scene, camera));

  // SSAO removed for performance - too expensive for 9M vertex scene
  // 3. Bloom
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    0.18,   // strength (reduced for perf)  (was 1.5 which causes washed-out glow -- PS3 uses subtle bloom)
    0.5,    // radius
    0.88    // threshold (only very bright surfaces bloom -- sky, glass, water specular)
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

const instancedGrassSystems = [];

export function addGrassField(centerX, centerZ, radiusX, radiusZ, density = 400) {
  // Base geometry for a single card, origin at bottom center
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.translate(0, 0.5, 0); 
  
  // Create ONE InstancedMesh instead of hundreds of individual meshes
  const instancedMesh = new THREE.InstancedMesh(geometry, grassCardMat, density);
  instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  instancedMesh.receiveShadow = true;
  instancedMesh.castShadow = false;

  const dummy = new THREE.Object3D();
  const positions = [];

  for (let i = 0; i < density; i++) {
    const angle  = Math.random() * Math.PI * 2;
    const rx     = (Math.random() * 0.5 + 0.5) * radiusX;
    const rz     = (Math.random() * 0.5 + 0.5) * radiusZ;
    const x      = centerX + Math.cos(angle) * rx;
    const z      = centerZ + Math.sin(angle) * rz;
    const h      = 0.35 + Math.random() * 0.45;
    const w      = 0.18 + Math.random() * 0.18;

    dummy.position.set(x, 0, z);
    dummy.scale.set(w, h, 1);
    dummy.rotation.y = Math.random() * Math.PI;
    dummy.updateMatrix();
    instancedMesh.setMatrixAt(i, dummy.matrix);
    
    // Store original coordinates so we can billboard them later
    positions.push({ x, z, scaleX: w, scaleY: h });
  }

  instancedMesh.instanceMatrix.needsUpdate = true;
  instancedGrassSystems.push({ mesh: instancedMesh, positions });
  
  return [instancedMesh]; // Return array to match scene.js expectations
}

// Dummy object to calculate math without creating memory garbage
const dummyGrass = new THREE.Object3D();

export function tickGrass(camera) {
  const cx = camera.position.x, cz = camera.position.z;
  
  instancedGrassSystems.forEach(system => {
    const { mesh, positions } = system;
    
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      dummyGrass.position.set(pos.x, 0, pos.z);
      dummyGrass.scale.set(pos.scaleX, pos.scaleY, 1);
      // Billboard to face camera
      dummyGrass.rotation.y = Math.atan2(cx - pos.x, cz - pos.z);
      dummyGrass.updateMatrix();
      mesh.setMatrixAt(i, dummyGrass.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
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
