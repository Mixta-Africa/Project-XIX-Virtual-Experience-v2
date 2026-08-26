/**
 * Project XIX — Scene (Production Standard v25)
 * Upgrades: 
 * - Fast PBR Water (No texture crash loop)
 * - 3D Spatial Audio (Web Audio API PannerNodes)
 * - LOD instancing, Atmospheric Sky, and guided tour integration
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { GLTFLoader }  from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/DRACOLoader.js";
import { Water } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/objects/Water.js";
// Named exports (clone, etc.), not a single "SkeletonUtils" binding — a
// named-import guess that doesn't match the module's real exports throws a
// hard SyntaxError at link time, before any code runs at all.
import * as SkeletonUtils from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/utils/SkeletonUtils.js";
import {
  PBR, createWaterMat, addGrassField, commitGrass, tickGrass, tickWater,
  buildPalmInstances, tickPalms,
  setPerfModeGraphics, setBloomForTime, setSkyForTime, createAtmosphericSky,
  buildEnvMapFromSky, scheduleEnvMapRefresh, applyPS4Materials,
  loadHDRI, applyHDRITimeModulation,
  MAT_GRASS_FIELD, MAT_GLASS, MAT_GLASS_WARM, MAT_WHITE_TRIM, MAT_GOLD, MAT_DARK_METAL,
} from "./graphics.js";

// ─── PERFORMANCE MODE ─────────────────────────────────────────────────────────
export let PERF_MODE = 'fast';

const PERF_SETTINGS = {
  fast:     { shadowMapSize: 1024, pixelRatio: 1.5, fogDensity: 0.00002, palmTickDiv: 6 },
  balanced: { shadowMapSize: 2048, pixelRatio: 1.75,fogDensity: 0.00002, palmTickDiv: 3 },
  rich:     { shadowMapSize: 4096, pixelRatio: 2.0, fogDensity: 0.00002, palmTickDiv: 1 },
};

export function setPerfMode(mode) {
  if (!PERF_SETTINGS[mode]) return;
  PERF_MODE = mode;
  setPerfModeGraphics(mode);
  if (!renderer) return;
  const s = PERF_SETTINGS[mode];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.pixelRatio));
  if (sunLight) {
    sunLight.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize);
    sunLight.castShadow = (mode !== 'fast');
    if (sunLight.shadow.map) {
      sunLight.shadow.map.dispose();
      sunLight.shadow.map = null;
    }
  }
  
  if (scene && scene.fog) {
    const isClear = (window._currentWeather === 'clear');
    scene.fog.density = isClear ? 0.000008 : s.fogDensity;
  }
}

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let scene, renderer, camera, clock;
let waterMeshes = [], palmBillboards = [];
let _palmTickCount = 0;

let villaGLBScene = null, pendingVillas = [];
const VILLA_SCALE = 12.56;

// ── OUTDOOR LAMP MESHES ────────────────────────────────────────────────────
// Post security lamp: 4 m tall, placed either side of every villa frontage.
// Wall sconce:        0.35 m wide, mounted at 4 m on the field-facing facade.
// Both are instanced — loaded once, cloned per villa position.
let _postLampScene  = null, _sconceScene = null;
const POST_SCALE    = 2.1008;   // raw H=1.904 → 4.00 m world
// Was 0.8728 -> 1.66m tall, which read as a wall panel rather than a
// fixture. A real exterior wall sconce is a small box, roughly 0.30m tall.
const SCONCE_SCALE  = 0.1575;   // raw H=1.904 → 0.30 m world (fixture height)

// Positions are collected here as the villa ring is built, then the GLBs are
// spawned once both assets are ready (avoids a load-order race).
const _postPositions   = [];   // [{x,y,z,ry}]
const _sconcePositions = [];   // [{x,y,z,ry}]

function _spawnLampInstances() {
  if (!_postLampScene || !_sconceScene) return;   // wait until both loaded

  // ── POST LAMPS ────────────────────────────────────────────────────────────
  // One either side of the villa frontage, just proud of the hedge line.
  // lx = ±5.5 m   lz = +5.8 m (field side)   y = 0
  const POSTS_PER_VILLA = 2;
  const postGroup = new THREE.Group(); postGroup.name = 'postLamps';
  _hedgeInstData.forEach(({ x, z, ry }) => {
    const cos = Math.cos(ry), sin = Math.sin(ry);
    [[-5.5, 5.8], [5.5, 5.8]].forEach(([lx, lz]) => {
      const wx = x + lx*cos - lz*sin;
      const wz = z + lx*sin + lz*cos;
      const clone = _postLampScene.clone(true);
      clone.position.set(wx, 0, wz);
      clone.rotation.y = ry;
      clone.scale.setScalar(POST_SCALE);
      _postPositions.push({ x: wx, y: 4.0, z: wz });   // lamp head height
      postGroup.add(clone);
    });
  });
  scene.add(postGroup);

  // ── WALL SCONCES ──────────────────────────────────────────────────────────
  // Two per villa on the field-facing facade, at first-floor slab height (4 m).
  // lx = ±3.0 m   lz = +5.6 m (just proud of facade)   y = 4.0
  const sconceGroup = new THREE.Group(); sconceGroup.name = 'wallSconces';
  _hedgeInstData.forEach(({ x, z, ry }) => {
    const cos = Math.cos(ry), sin = Math.sin(ry);
    // Villa footprint is 11.4 x 9.6m (half-depth 4.8m). 5.6 sat 0.8m PAST
    // the actual front wall — floating in open air, which is exactly what
    // "displaced" describes. 4.7 sits just proud of the real wall surface.
    [[-3.0, 4.7], [3.0, 4.7]].forEach(([lx, lz]) => {
      const wx = x + lx*cos - lz*sin;
      const wz = z + lx*sin + lz*cos;
      const clone = _sconceScene.clone(true);
      clone.position.set(wx, 4.0, wz);
      clone.rotation.y = ry;
      clone.scale.setScalar(SCONCE_SCALE);
      _sconcePositions.push({ x: wx, y: 4.35, z: wz });
      sconceGroup.add(clone);
    });
  });
  scene.add(sconceGroup);

  // ── CLUBHOUSE FORECOURT LAMPS ─────────────────────────────────────────────
  // Clubhouse sits at world (0,0,108), rotation.y=Math.PI (front toward the
  // field, -Z). Six posts along the forecourt plus two flanking the rear
  // corners, all reusing the same post lamp instance already loaded for
  // the villas — this is the "clubhouse lamps not lit" gap: the asset was
  // wired for villas only and never placed here at all.
  const clubGroup = new THREE.Group(); clubGroup.name = 'clubhouseLamps';
  const CLUB_X = 0, CLUB_Z = 108, CLUB_HALF_W = 22, FRONT_OFFSET = 13;
  const clubFrontXs = [-CLUB_HALF_W*0.8, -CLUB_HALF_W*0.45, -CLUB_HALF_W*0.15,
                        CLUB_HALF_W*0.15,  CLUB_HALF_W*0.45,  CLUB_HALF_W*0.8];
  clubFrontXs.forEach(x => {
    const wx = CLUB_X + x, wz = CLUB_Z - FRONT_OFFSET;   // toward the field
    const clone = _postLampScene.clone(true);
    clone.position.set(wx, 0, wz);
    clone.rotation.y = 0;               // faces the same way as the villas' -Z row
    clone.scale.setScalar(POST_SCALE);
    _postPositions.push({ x: wx, y: 4.0, z: wz });
    clubGroup.add(clone);
  });
  [[-CLUB_HALF_W*0.95, 10], [CLUB_HALF_W*0.95, 10]].forEach(([x, z]) => {
    const wx = CLUB_X + x, wz = CLUB_Z + z;
    const clone = _postLampScene.clone(true);
    clone.position.set(wx, 0, wz);
    clone.rotation.y = Math.PI;
    clone.scale.setScalar(POST_SCALE);
    _postPositions.push({ x: wx, y: 4.0, z: wz });
    clubGroup.add(clone);
  });
  scene.add(clubGroup);

  // Add sconce + clubhouse post positions into the lamp pool so everything
  // participates in the pooled point-light system at night.
  _sconcePositions.forEach(n => _lampNodes.push(n));
  _postPositions.forEach(n => _lampNodes.push(n));
  console.log('[XIX] Lamps: ' + _postPositions.length + ' post lamps (incl. clubhouse), ' +
              _sconcePositions.length + ' wall sconces spawned');
}

function loadLampMeshes() {
  const loader = makeDracoLoader();
  loader.load('assets/post-security-lamp-mesh.glb', gltf => {
    _postLampScene = gltf.scene;
    applyPS4Materials(_postLampScene);
    // Lens/globe is now a SEPARATE primitive in the GLB itself (material
    // extras.isLampLens = true), classified once offline by sampling the
    // actual base-colour atlas rather than the flat material tint. Just
    // read the flag the asset already carries.
    _postLampScene.traverse(o => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      // material.name ('post_lens') is a plain glTF property GLTFLoader
      // always copies verbatim — unlike material extras, whose propagation
      // to userData is loader-version dependent and not worth trusting for
      // something this visible.
      if (m && /_lens$/.test(m.name || '')) {
        m.emissiveIntensity = 0;   // driven by updateNightLights
        // FLAG ON THE MESH, not the material — updateNightLights traverses
        // scene objects and reads o.userData, so a flag left only on
        // material.userData was never seen by that check, and the lens
        // never lit at night regardless of anything else being correct.
        o.userData.isLampGlobe = true;
      }
    });
    _spawnLampInstances();
  }, undefined, e => console.warn('[XIX] post-security-lamp-mesh.glb failed:', e));

  loader.load('assets/wall-scone-mesh.glb', gltf => {
    _sconceScene = gltf.scene;
    applyPS4Materials(_sconceScene);
    _sconceScene.traverse(o => {
      if (!o.isMesh) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m && /_lens$/.test(m.name || '')) {
        m.emissiveIntensity = 0;
        o.userData.isLampGlobe = true;   // same fix as the post lamp above
      }
    });
    _spawnLampInstances();
  }, undefined, e => console.warn('[XIX] wall-scone-mesh.glb failed:', e));
}

let aptGLBScene = null, pendingApts = [];
//  ZONES.flats: two 7-storey blocks share 48 x 204 m² = 9,792 m² total, so
//  each block is 4,896 m² across 7 floors -> 699 m² footprint. New mesh
//  W=1.8672 raw at that footprint gives 37.3m wide, matching a real block.
//  31.18 was calibrated for the PREVIOUS mesh's raw dimensions; on this one
//  it would produce a 58x29m block (1,701 m² footprint, 2.4x too large).
const APT_SCALE = 19.99342;

let loftGLBScene = null, pendingLofts = [];
const LOFT_SCALE = 28.5;

export const plotRegistry = new Map();
export let onPlotSelected = null;

let _skyUniforms = null, _skyObj = null, _skySun = null;

// ─── HORSE + RIDER (player) ───────────────────────────────────────────────────
export const RIDER_EYE_HEIGHT = 3.1;
export const FOOT_EYE_HEIGHT  = 1.75;
let horseGroup = null, horseMixer = null;
export let horseViewMode = 'first';

window.addEventListener('keydown', e => {
  if (e.key.toLowerCase() === 'v' && document.getElementById('world-overlay')?.classList.contains('open'))
    horseViewMode = horseViewMode === 'first' ? 'third' : 'first';
});

export function loadHorseGLB() {
  makeDracoLoader().load("./assets/horse.glb", gltf => {
    const model = gltf.scene;
    model.scale.setScalar(0.022);   // horse.glb — millimetre mesh, unchanged
    applyPS4Materials(model);
    const bbox = new THREE.Box3().setFromObject(model);
    if (bbox.min.y < 0) model.position.y = -bbox.min.y;
    horseGroup = new THREE.Group();
    horseGroup.name = 'horseRider';
    horseGroup.add(model);
    scene.add(horseGroup);
    horseMixer = new THREE.AnimationMixer(model);
    const rawClip = gltf.animations.find(a => /trot|walk|run/i.test(a.name)) || gltf.animations[0];
    if (rawClip) {
      const filteredTracks = rawClip.tracks.filter(track => {
        const isRoot = /^(root|_rootjoint|rootnode|hips_01)/i.test(track.name.split('.')[0]);
        return !(isRoot && (track.name.endsWith('.position') || track.name.endsWith('.quaternion')));
      });
      const clip = new THREE.AnimationClip(rawClip.name, rawClip.duration, filteredTracks);
      const action = horseMixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.timeScale = 1.2;
      action.play();
    }
  }, undefined, err => console.error("Horse GLB failed:", err));
}

// ── AMBIENT (NPC) HORSES ─────────────────────────────────────────────────
//  Independent of horseGroup (the rider's mount). Each instance is its own
//  GLTFLoader.load of horse.glb rather than a .clone() of the mount, because
//  the mesh is skinned (has a skeleton + AnimationMixer): cloning an
//  Object3D hierarchy duplicates the bone NODES but the SkinnedMesh's
//  skeleton.bones array keeps pointing at the ORIGINAL bones, so every clone
//  would animate identically to (and fight with) the source instead of
//  moving independently. A second load is slightly heavier on first paint
//  but is correct; the browser's HTTP cache makes repeat fetches cheap.
const _ambientHorses = [];

// One network fetch and one Draco decode, shared by all six ambient horses —
// previously each called makeDracoLoader().load(...) independently, so six
// decorative horses cost as much load time as six separate buildings. The
// clip is a THREE.AnimationClip (immutable track data) and is safe to share
// across every mixer directly; only the SKELETON needs a real, independent
// copy per instance, which is what SkeletonUtils.clone provides — a plain
// Object3D.clone() duplicates the bone NODES but leaves the SkinnedMesh
// pointing at the ORIGINAL skeleton, so a plain clone would animate
// identically to (and visually fight with) the source.
let _horseTemplate = null, _horseClip = null;
const _pendingAmbientBuilds = [];

function _spawnAmbientHorse(bounds, delayMs) {
  const rec = { model: null, mixer: null, pos: new THREE.Vector3(), yaw: 0,
                target: new THREE.Vector3(), pauseT: 0, speed: 1.8 + Math.random()*0.8, bounds };
  const pick = () => new THREE.Vector3(
    bounds.xMin + Math.random()*(bounds.xMax-bounds.xMin), 0,
    bounds.zMin + Math.random()*(bounds.zMax-bounds.zMin));
  rec.pos.copy(pick()); rec.target.copy(pick());
  _ambientHorses.push(rec);

  const build = () => {
    const model = SkeletonUtils.clone(_horseTemplate);
    const group = new THREE.Group();
    group.add(model);
    group.position.copy(rec.pos);
    scene.add(group);
    rec.model = group;
    if (_horseClip) {
      const mixer = new THREE.AnimationMixer(model);
      const action = mixer.clipAction(_horseClip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.timeScale = 1.0;   // natural walk-cycle speed; per-instance
      // variety and the grazing freeze are handled every frame in
      // tickAmbientHorses, not baked in here.
      action.play();
      rec.mixer = mixer;
    }
  };

  setTimeout(() => {
    if (_horseTemplate) { build(); return; }
    if (_pendingAmbientBuilds.length) { _pendingAmbientBuilds.push(build); return; }
    _pendingAmbientBuilds.push(build);   // in case others fire before load resolves
    makeDracoLoader().load('./assets/horse.glb', gltf => {
      const model = gltf.scene;
      model.scale.setScalar(0.022);
      applyPS4Materials(model);
      const bbox = new THREE.Box3().setFromObject(model);
      if (bbox.min.y < 0) model.position.y = -bbox.min.y;
      _horseTemplate = model;

      const rawClip = gltf.animations.find(a => /trot|walk|run/i.test(a.name)) || gltf.animations[0];
      if (rawClip) {
        const filteredTracks = rawClip.tracks.filter(track => {
          const isRoot = /^(root|_rootjoint|rootnode|hips_01)/i.test(track.name.split('.')[0]);
          return !(isRoot && (track.name.endsWith('.position') || track.name.endsWith('.quaternion')));
        });
        _horseClip = new THREE.AnimationClip(rawClip.name, rawClip.duration, filteredTracks);
      }
      _pendingAmbientBuilds.forEach(fn => fn());
      _pendingAmbientBuilds.length = 0;
    }, undefined, err => console.warn('[XIX] ambient horse template load failed:', err));
  }, delayMs);
}

export function spawnAmbientHorses() {
  // All six share one load now — the stagger only spreads the cheap BUILD
  // calls (clone + mixer), not network fetches, which no longer repeat.
  const POLO_N   = { xMin: -60, xMax: 60,  zMin: -88, zMax: -76 };  // north safety zone, clear of the lake
  const POLO_S   = { xMin: -60, xMax: 60,  zMin:  76, zMax:  90 };
  const TRAINING = { xMin: -335, xMax: -185, zMin: -80, zMax: 5 };  // matches the 180x110 turf patch at (-260,-40)
  const PADDOCK  = { xMin: 212, xMax: 268, zMin: -55, zMax: -5 };   // inset from the rail fence at 205-275/-60-0
  [POLO_N, POLO_S, TRAINING, TRAINING, PADDOCK, PADDOCK].forEach((b, i) =>
    _spawnAmbientHorse(b, 2400 + i * 120));
}

// Called every frame from tickScene — NOT from tickHorseAnim, which app.js
// only invokes inside its 'ride'-mode branch. Ambient horses must keep
// wandering and animating in the default 'walk' mode too, so they need a
// tick source that runs unconditionally regardless of the player's move mode.
export function tickAmbientHorses(delta) {
  const REACH = 1.5;
  _ambientHorses.forEach(h => {
    if (h.mixer) h.mixer.update(delta);
    if (!h.model) return;   // still loading
    if (h.pauseT > 0) {
      h.pauseT -= delta;
      if (h.mixer) h.mixer.timeScale = 0;   // FREEZE the pose while stationary —
      return;                               // was 0.55, which kept the legs
    }                                        // slowly cycling under a horse
                                              // that wasn't moving: foot-sliding.

    const dx = h.target.x - h.pos.x, dz = h.target.z - h.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < REACH) {
      h.pauseT = 1.5 + Math.random() * 2.0;   // shorter pause — was 3-8s,
      // which combined with slow movement made the whole system feel stuck
      h.target.set(
        h.bounds.xMin + Math.random() * (h.bounds.xMax - h.bounds.xMin), 0,
        h.bounds.zMin + Math.random() * (h.bounds.zMax - h.bounds.zMin));
      return;   // mixer freeze on pause is handled above, before this check
    }
    const step = Math.min(h.speed * delta, dist);
    h.pos.x += (dx / dist) * step;
    h.pos.z += (dz / dist) * step;
    const targetYaw = Math.atan2(dx, dz);
    let yawDiff = targetYaw - h.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    h.yaw += yawDiff * Math.min(delta * 3, 1);
    h.model.position.set(h.pos.x, 0, h.pos.z);
    h.model.rotation.y = h.yaw;
    if (h.mixer) h.mixer.timeScale = 1.0 + (h.speed - 1.8) * 0.15;   // natural
    // pace, with faster-walking horses given a very slightly faster cycle
    // so leg speed and ground speed stay visually consistent per instance
  });
}

export function tickHorseAnim(delta, isMoving) {
  if (!horseMixer) return;
  horseMixer.timeScale = isMoving ? 1.2 : 0.2;
  horseMixer.update(delta);
}

export function tickHorse(delta) {
  if (horseMixer) horseMixer.update(delta);
}

// ─── TERRAIN HEIGHT FOLLOWING ────────────────────────────────────────────────
const _terrainRaycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0,-1,0), 0, 20);
let _terrainMeshes = []; 

function getGroundY(x, z) {
  if (_terrainMeshes.length === 0) return 0;
  _terrainRaycaster.ray.origin.set(x, 50, z); 
  const hits = _terrainRaycaster.intersectObjects(_terrainMeshes, false);
  return hits.length > 0 ? hits[0].point.y : 0;
}

export function setHorsePosition(x, z, yaw) {
  if (!horseGroup) return;
  const groundY = getGroundY(x, z);
  if (horseViewMode === 'first') {
    horseGroup.position.set(x + Math.sin(yaw) * 0.5, groundY, z + Math.cos(yaw) * 0.5);
  } else {
    horseGroup.position.set(x, groundY, z);
  }
  horseGroup.rotation.y = yaw; 
}

export function getThirdPersonCameraOffset() { return { back: 5.5, up: 2.4 }; }

// ─── NPC HORSES ──────────────────────────────────────────────────────────────
const npcHorses = [];
const NPC_PATHS = [
  [new THREE.Vector3(204,0,-5),new THREE.Vector3(232,0,-5),new THREE.Vector3(232,0,25),new THREE.Vector3(204,0,25)],
  [new THREE.Vector3(-120,0,65),new THREE.Vector3(0,0,60),new THREE.Vector3(120,0,65),new THREE.Vector3(120,0,-65),new THREE.Vector3(0,0,-60),new THREE.Vector3(-120,0,-65)],
  [new THREE.Vector3(-100,0,0),new THREE.Vector3(0,0,55),new THREE.Vector3(100,0,0),new THREE.Vector3(0,0,-55)],
  [new THREE.Vector3(-110,0,40),new THREE.Vector3(0,0,35),new THREE.Vector3(110,0,40),new THREE.Vector3(110,0,-40),new THREE.Vector3(0,0,-35),new THREE.Vector3(-110,0,-40)],
];

function spawnNPCHorse(pathIndex) {
  makeDracoLoader().load("./assets/horse.glb", gltf => {
    const model = gltf.scene;
    model.scale.setScalar(0.020);   // NPC horse.glb — millimetre mesh, unchanged
    applyPS4Materials(model);
    const bbox = new THREE.Box3().setFromObject(model);
    if (bbox.min.y < 0) model.position.y = -bbox.min.y;

    const group = new THREE.Group();
    group.add(model);
    scene.add(group);

    const mixer = new THREE.AnimationMixer(model);
    const clip  = gltf.animations[0];
    if (clip) {
      const filteredTracks = clip.tracks.filter(t => {
        const isRoot = /^(root|_rootjoint|rootnode|hips_01)/i.test(t.name.split('.')[0]);
        return !(isRoot && (t.name.endsWith('.position') || t.name.endsWith('.quaternion')));
      });
      const cleanClip = new THREE.AnimationClip(clip.name, clip.duration, filteredTracks);
      const action = mixer.clipAction(cleanClip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.timeScale = 0.9 + Math.random() * 0.4;
      action.play();
    }

    const path = NPC_PATHS[pathIndex % NPC_PATHS.length];
    group.position.copy(path[0]);
    npcHorses.push({ group, mixer, path, pathIdx: 0, speed: 2.5 + Math.random() * 1.5, progress: 0 });
  }, undefined, err => console.warn("NPC horse failed:", err));
}

function tickNPCHorses(delta) {
  npcHorses.forEach(npc => {
    npc.mixer.update(delta);
    const path = npc.path;
    const from = path[npc.pathIdx];
    const to   = path[(npc.pathIdx + 1) % path.length];
    const segment = new THREE.Vector3().subVectors(to, from);
    const segLen  = segment.length();
    npc.progress += npc.speed * delta;
    if (npc.progress >= segLen) {
      npc.progress -= segLen;
      npc.pathIdx = (npc.pathIdx + 1) % path.length;
    }
    const t = Math.min(npc.progress / segLen, 1);
    npc.group.position.lerpVectors(from, to, t);
    npc.group.position.y = getGroundY(npc.group.position.x, npc.group.position.z);
    const dir = segment.normalize();
    if (dir.lengthSq() > 0) npc.group.rotation.y = Math.atan2(dir.x, dir.z);
  });
}

// ─── GUIDED TOUR ──────────────────────────────────────────────────────────────
export const TOUR_STOPS = [
  { pos:[-20, 3.1, 210], yaw:0,            pitch:-0.08, caption:"Welcome to Project XIX — 18.8 hectares of polo and equestrian living at Lakowe.",        voice:"Welcome to Project Nineteen. 18.8 hectares of polo and equestrian living at Lakowe, Ibeju-Lekki Lagos." },
  { pos:[-20, 3.1,  80], yaw:0,            pitch:-0.04, caption:"The main polo field — 275 metres long. Full FIP international standard.", voice:"Ahead of you, the main polo field. 275 metres long, built to full FIP international standard." },
  { pos:[-20, 3.1, -90], yaw:0,            pitch:-0.06, caption:"The lake — a 200-metre crescent between the polo ring and the villa north row.",                        voice:"The crescent lake. 200 metres of still water." },
  { pos:[-155, 3.1,  0], yaw: Math.PI/2,  pitch:-0.04, caption:"West villa row — 120 premium 3-bedroom villas with direct polo-field view.",                            voice:"The west villa row. 120 premium three-bedroom residences." },
  { pos:[  0, 3.1, 108], yaw: Math.PI,    pitch:-0.08, caption:"The Clubhouse — 3,419 m². 8 VIP skyboxes. Restaurant. Bar. The social heart of XIX.",                    voice:"The Clubhouse. 3,419 square metres. Eight VIP skyboxes, a restaurant, and bar." },
  { pos:[-375, 3.1, 90], yaw: Math.PI/2,  pitch:-0.05, caption:"The Equestrian Quarter — 56-stall stables, veterinary clinic, cobblestone courtyard.",                  voice:"The equestrian quarter. 56 stalls across four stable blocks." },
  { pos:[ 218, 3.1,  0], yaw:-Math.PI/2,  pitch:-0.04, caption:"The paddock — post-and-rail enclosure. Watch horses warm up from your east terrace.",                    voice:"The paddock. Post and rail fencing, used for horse warming." },
];

let _tourActive=false, _tourStop=0, _tourOnGetCam=null, _tourOnSetCam=null;
let _pauseT=0, _flyT=0, _flying=false, _flyFrom=null, _flyTo=null;
const _PAUSE_DUR=6.0, _FLY_DUR=3.5;

function _easeInOut(t) { return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }
function _bezierPoint(p0, p1, p2, t) {
  const mt = 1-t;
  return [mt*mt*p0[0] + 2*mt*t*p1[0] + t*t*p2[0], mt*mt*p0[1] + 2*mt*t*p1[1] + t*t*p2[1], mt*mt*p0[2] + 2*mt*t*p1[2] + t*t*p2[2]];
}

export function startTour(onGetCam, onSetCam) {
  _tourOnGetCam = onGetCam; _tourOnSetCam = onSetCam;
  _tourActive = true; _tourStop = 0; _pauseT = 0; _flying = false;
  _injectTourUI(); _startFly(_tourStop); _speakStop(0);
}

export function stopTour() {
  _tourActive = false; _flying = false;
  window.speechSynthesis && window.speechSynthesis.cancel();
  document.getElementById('tour-ui')?.remove();
}

export function isTourActive() { return _tourActive; }

function _startFly(toIdx) {
  const toStop = TOUR_STOPS[toIdx];
  _flyFrom = _tourOnGetCam ? _tourOnGetCam() : { pos:[0,3.1,200], yaw:0, pitch:0 };
  _flyTo   = { pos: toStop.pos, yaw: toStop.yaw, pitch: toStop.pitch || 0 };
  _flyT    = 0; _flying  = true;
}

function _speakStop(idx) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const stop = TOUR_STOPS[idx];
  const utt  = new SpeechSynthesisUtterance(stop.voice);
  utt.rate = 0.88; utt.pitch = 1.0;
  window.speechSynthesis.speak(utt);
  const capEl = document.getElementById('tour-caption');
  if (capEl) capEl.textContent = stop.caption;
  const cntEl = document.getElementById('tour-counter');
  if (cntEl) cntEl.textContent = `${idx + 1} / ${TOUR_STOPS.length}`;
}

function _injectTourUI() {
  if (document.getElementById('tour-ui')) return;
  const ui = document.createElement('div');
  ui.id = 'tour-ui';
  ui.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:500;background:rgba(6,18,8,0.82);backdrop-filter:blur(10px);border:1px solid rgba(201,168,76,0.4);border-radius:10px;padding:14px 20px;max-width:520px;width:90%;font-family:Inter,sans-serif;pointer-events:all;`;
  ui.innerHTML = `
    <div style="font-size:11px;color:rgba(201,168,76,0.8);margin-bottom:6px;letter-spacing:.08em;" id="tour-counter">1 / ${TOUR_STOPS.length}</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.88);line-height:1.5;" id="tour-caption">${TOUR_STOPS[0].caption}</div>
    <div style="display:flex;gap:10px;margin-top:12px;">
      <button onclick="window.__tourPrev()" style="flex:1;padding:7px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:rgba(255,255,255,0.7);cursor:pointer;font-size:12px;">← Prev</button>
      <button onclick="window.__tourNext()" style="flex:1;padding:7px;background:rgba(201,168,76,0.85);border:none;border-radius:6px;color:#0a1008;font-weight:600;cursor:pointer;font-size:12px;">Next →</button>
      <button onclick="window.__tourStop()" style="padding:7px 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:rgba(255,255,255,0.5);cursor:pointer;font-size:12px;">✕</button>
    </div>`;
  document.getElementById('world-overlay')?.appendChild(ui);
}

window.__tourNext = () => { if(!_tourActive)return; _tourStop=(_tourStop+1)%TOUR_STOPS.length; _pauseT=0; _startFly(_tourStop); _speakStop(_tourStop); };
window.__tourPrev = () => { if(!_tourActive)return; _tourStop=(_tourStop-1+TOUR_STOPS.length)%TOUR_STOPS.length; _pauseT=0; _startFly(_tourStop); _speakStop(_tourStop); };
window.__tourStop = () => stopTour();

// ─── IMPROVEMENT 2: 3D SPATIAL AMBIENT SOUND (PANNER NODES) ───────────────────
let _audioCtx = null;
let _windGain = null, _birdsGain = null;
let _hoovesPanner = null, _lakePanner = null, _clubPanner = null;
let _hoovesGain = null;

// Bridges the names app.js actually imports (initAudio / enableAudio /
// updateSpatialAudio) onto the implementation below, which has been fully
// built and correct since the very first upload but was never reachable —
// app.js has always imported three names this file never exported.
// Master gain every sound routes through. A single mute toggle here covers
// wind/birds/hooves/water/murmur/neigh without touching any of the
// individual _makeX() functions that create them.
let _masterGain = null;
let _muted = false;
export function setAudioMuted(muted) {
  _muted = muted;
  if (_masterGain) _masterGain.gain.value = muted ? 0 : 1;
  try { localStorage.setItem('xix_audio_muted', muted ? '1' : '0'); } catch (e) {}
}
export function isAudioMuted() { return _muted; }

export function initAudio() {
  initAmbientAudio();
  try { _muted = localStorage.getItem('xix_audio_muted') === '1'; } catch (e) {}
  if (_masterGain) _masterGain.gain.value = _muted ? 0 : 1;
}

// AudioContext starts 'suspended' until resumed from within a user gesture
// (browser autoplay policy) — enableAudio() is called from a click handler
// in app.js, which is exactly the right place to both create and resume it.
export function enableAudio() {
  initAmbientAudio();
  if (_audioCtx && _audioCtx.state === 'suspended') _audioCtx.resume();
}

// app.js calls this every frame as updateSpatialAudio(camera.x, camera.z) —
// two arguments, no movement flag. updateAudioForMovement needs isMoving as
// its first argument, so movement is derived here from the position delta
// since the previous call rather than requiring app.js to pass anything new.
let _lastAudioX = null, _lastAudioZ = null;
export function updateSpatialAudio(worldX, worldZ) {
  const isMoving = _lastAudioX !== null &&
    (Math.abs(worldX - _lastAudioX) > 0.01 || Math.abs(worldZ - _lastAudioZ) > 0.01);
  _lastAudioX = worldX; _lastAudioZ = worldZ;
  updateAudioForMovement(isMoving, worldX, worldZ);
  _tickAmbientNeighs(worldX, worldZ);
}

export function initAmbientAudio() {
  if (_audioCtx) return;
  try {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Every sound in this file connects to _audioDest() below instead of
    // _audioCtx.destination directly, all funnelled through this one
    // GainNode — the mute toggle has exactly one thing to touch, and any
    // sound added later picks up mute state for free.
    _masterGain = _audioCtx.createGain();
    _masterGain.gain.value = _muted ? 0 : 1;
    _masterGain.connect(_audioCtx.destination);

    if (_audioCtx.listener.upX) {
      _audioCtx.listener.upX.value = 0;
      _audioCtx.listener.upY.value = 1;
      _audioCtx.listener.upZ.value = 0;
    }

    _windGain  = _makeNoise('wind', 0.012);
    _birdsGain = _makeBirds();
    
    const hoovesSetup = _makeHooves();
    _hoovesPanner = hoovesSetup.panner;
    _hoovesGain = hoovesSetup.gain;

    _lakePanner = _makePositionalNoise('water', 30, -115); 
    _clubPanner = _makePositionalNoise('murmur', 0, 108);  
  } catch(e) { console.warn('[XIX] Audio init failed:', e); }
}

function _createPanner(x, z, refDist = 20, maxDist = 150) {
  if (!_audioCtx) return null;
  const panner = _audioCtx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'exponential';
  panner.refDistance = refDist;
  panner.maxDistance = maxDist;
  panner.rolloffFactor = 1.2;
  panner.positionX.value = x;
  panner.positionY.value = 1.72;
  panner.positionZ.value = z;
  return panner;
}

function _makePositionalNoise(type, x, z) {
  if (!_audioCtx) return null;
  const panner = _createPanner(x, z, 30, 200);
  const bufSize = _audioCtx.sampleRate * 2;
  const buf = _audioCtx.createBuffer(1, bufSize, _audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);

  const source = _audioCtx.createBufferSource();
  source.buffer = buf; 
  source.loop = true;

  const filter = _audioCtx.createBiquadFilter();
  filter.type = type === 'water' ? 'lowpass' : 'bandpass';
  filter.frequency.value = type === 'water' ? 400 : 600;

  const gain = _audioCtx.createGain();
  gain.gain.value = type === 'water' ? 0.015 : 0.005;

  source.connect(filter); 
  filter.connect(gain); 
  gain.connect(panner); 
  panner.connect(_masterGain);
  source.start();
  return panner;
}

function _makeNoise(type, vol) {
  if (!_audioCtx) return null;
  const bufSize = _audioCtx.sampleRate * 2;
  const buf = _audioCtx.createBuffer(1, bufSize, _audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i=0; i<bufSize; i++) data[i] = (Math.random()*2-1);

  const source = _audioCtx.createBufferSource();
  source.buffer = buf; source.loop = true;

  const filter = _audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = type === 'wind' ? 280 : 800;
  filter.Q.value = 0.5;

  const gain = _audioCtx.createGain();
  gain.gain.value = vol;

  source.connect(filter); filter.connect(gain); gain.connect(_masterGain);
  source.start();
  return gain;
}

function _makeBirds() {
  if (!_audioCtx) return null;
  const gain = _audioCtx.createGain();
  gain.gain.value = 0.0;
  gain.connect(_masterGain);
  function chirp() {
    if (!_audioCtx) return;
    const osc = _audioCtx.createOscillator();
    const g   = _audioCtx.createGain();
    osc.type  = 'sine';
    osc.frequency.setValueAtTime(1800 + Math.random()*600, _audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(2400 + Math.random()*400, _audioCtx.currentTime + 0.08);
    g.gain.setValueAtTime(0, _audioCtx.currentTime);
    g.gain.linearRampToValueAtTime(0.02, _audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + 0.12);
    osc.connect(g); g.connect(_masterGain);
    osc.start(); osc.stop(_audioCtx.currentTime + 0.15);
    setTimeout(chirp, 1500 + Math.random() * 3000);
  }
  setTimeout(chirp, 800);
  return gain;
}

// Frequency-swept noise burst approximating a whinny: a fast upward pitch
// sweep (the initial cry) followed by a fluttering amplitude-modulated tail
// (the vocal-fold flutter of a real neigh). No sample library is available,
// so this is synthesis, not playback — it reads as "a horse" at ambient
// volume and distance without pretending to be a studio recording.
function _makeNeighAt(x, z) {
  if (!_audioCtx) return;
  const panner = _createPanner(x, z, 15, 90);
  panner.connect(_masterGain);
  const t0 = _audioCtx.currentTime;

  const osc = _audioCtx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(340, t0);
  osc.frequency.exponentialRampToValueAtTime(620, t0 + 0.12);
  osc.frequency.exponentialRampToValueAtTime(260, t0 + 0.55);

  const flutter = _audioCtx.createOscillator();
  flutter.frequency.value = 24;
  const flutterGain = _audioCtx.createGain();
  flutterGain.gain.value = 60;
  flutter.connect(flutterGain); flutterGain.connect(osc.frequency);

  const filt = _audioCtx.createBiquadFilter();
  filt.type = 'bandpass'; filt.frequency.value = 900; filt.Q.value = 0.8;

  const g = _audioCtx.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.05, t0 + 0.05);
  g.gain.linearRampToValueAtTime(0.035, t0 + 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);

  osc.connect(filt); filt.connect(g); g.connect(panner);
  osc.start(t0); flutter.start(t0);
  osc.stop(t0 + 0.75); flutter.stop(t0 + 0.75);
  setTimeout(() => panner.disconnect(), 900);
}

let _lastNeigh = 0;
function _tickAmbientNeighs(listenerX, listenerZ) {
  if (!_audioCtx) return;
  const now = performance.now();
  if (now - _lastNeigh < 6000) return;   // never more than one every 6s
  // Only from horses within ~90m, and only occasionally (updateSpatialAudio
  // fires roughly every frame, so this gate is what keeps it from becoming a
  // dice roll every 16ms) so it reads as an occasional ambient event.
  if (Math.random() > 0.004) return;
  for (const h of _ambientHorses) {
    if (!h.model) continue;
    const d = Math.hypot(h.pos.x - listenerX, h.pos.z - listenerZ);
    if (d < 90) { _makeNeighAt(h.pos.x, h.pos.z); _lastNeigh = now; break; }
  }
}

function _makeHooves() {
  if (!_audioCtx) return null;
  const gain = _audioCtx.createGain();
  gain.gain.value = 0;
  
  const panner = _createPanner(0, 0, 5, 50);
  gain.connect(panner);
  panner.connect(_masterGain);

  function clop() {
    if (!_audioCtx || gain.gain.value < 0.001) { setTimeout(clop, 400); return; }
    const osc = _audioCtx.createOscillator();
    const g   = _audioCtx.createGain();
    osc.type  = 'triangle';
    osc.frequency.value = 120 + Math.random() * 40;
    g.gain.setValueAtTime(0.08, _audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + 0.15);
    osc.connect(g); g.connect(gain);
    osc.start(); osc.stop(_audioCtx.currentTime + 0.18);
    setTimeout(clop, 280 + Math.random() * 120);
  }
  setTimeout(clop, 1200);
  return { panner, gain };
}

export function updateAudioForMovement(isMoving, worldX, worldZ) {
  if (!_audioCtx) return;

  const listener = _audioCtx.listener;
  if (listener.positionX) {
    listener.positionX.setTargetAtTime(worldX, _audioCtx.currentTime, 0.1);
    listener.positionY.setTargetAtTime(1.72, _audioCtx.currentTime, 0.1);
    listener.positionZ.setTargetAtTime(worldZ, _audioCtx.currentTime, 0.1);
  }

  if (_hoovesPanner) {
    _hoovesPanner.positionX.setTargetAtTime(worldX, _audioCtx.currentTime, 0.1);
    _hoovesPanner.positionZ.setTargetAtTime(worldZ, _audioCtx.currentTime, 0.1);
  }

  if (_windGain) {
    const edge = Math.min(Math.abs(worldZ + 220), Math.abs(worldZ - 215));
    const windVal = 0.008 + (1 - Math.min(edge / 80, 1)) * 0.018;
    _windGain.gain.setTargetAtTime(windVal, _audioCtx.currentTime, 0.4);
  }
  
  if (_hoovesGain) {
    _hoovesGain.gain.setTargetAtTime(isMoving ? 0.6 : 0, _audioCtx.currentTime, 0.3);
  }
  
  if (_birdsGain) {
    _birdsGain.gain.setTargetAtTime(isMoving ? 0 : 0.8, _audioCtx.currentTime, 0.8);
  }
}

// ─── INSTANCED RENDERING ──────────────────────────────────────────────────────
const _dummy = new THREE.Object3D();

function buildInstancedFencePosts(positions) {
  const geo = new THREE.CylinderGeometry(0.1, 0.1, 1.6, 6);
  const mat = new THREE.MeshStandardMaterial({ color:0xfcfaf8, roughness:.5 });
  const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
  mesh.receiveShadow = true;
  positions.forEach(([x,y,z], i) => {
    _dummy.position.set(x, y, z);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

// ══════════════════════════════════════════════════════════════════════════════
//  TREES — real scanned mesh, with the flat back solved
// ══════════════════════════════════════════════════════════════════════════════
//  assets/tree-mesh.glb is a photogrammetry scan: 463,758 verts / 877k tris,
//  bounds 1.64w x 1.58h x 0.89d. The shallow depth is the giveaway — it was
//  captured from one side, so the rear is a flat shell.
//
//  THE FIX — RADIAL SHELLS:
//  Mirroring was the wrong operation. Negating Z creates a plane of exact
//  symmetry through the canopy: the two halves are the same shell facing
//  opposite directions, so they read as two flat cards backed onto each other
//  with a hard seam down the middle, and every tree has an identical front and
//  back silhouette. Per-instance yaw cannot hide that, because the symmetry is
//  in the geometry, not in the placement.
//
//  Instead we place N copies of the scanned shell ROTATED about the trunk axis
//  by the golden angle (137.5deg). Every copy therefore presents a genuinely
//  scanned face outward in a different direction, there is no symmetry plane at
//  any angle, and the golden angle guarantees the copies never line up however
//  many are used. Rotation also preserves winding and handedness, so unlike the
//  mirror there is no need to reverse triangles or negate normals — two sources
//  of error simply disappear. A small per-copy scale and lift keeps the
//  silhouettes from stacking.
//
//  POLY BUDGET:
//  The shipped tree-mesh.glb has been decimated from 877k triangles to 35k
//  (meshoptimizer, 0.002 error tolerance) and its textures reduced to 1024px
//  WebP with Draco geometry compression — 4.67 MB down to 371 KB. After the
//  mirror-merge each tree is ~70k triangles, so the caps are rich 200,
//  balanced 110, fast 40. Cone impostors cover anything beyond the cap.
// ══════════════════════════════════════════════════════════════════════════════

const GOLDEN_ANGLE = Math.PI * (3.0 - Math.sqrt(5.0));   // 137.507...deg

function _radialShellGeometry(srcGeo, copies = 2) {
  const src = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
  const pos = src.attributes.position.array;
  const nrm = src.attributes.normal ? src.attributes.normal.array : null;
  const uv  = src.attributes.uv ? src.attributes.uv.array : null;
  const n   = pos.length / 3;

  // Trunk axis: rotate about the horizontal centroid, not the world origin,
  // or the copies swing out into a ring instead of interleaving.
  let xMin= Infinity,xMax=-Infinity,zMin= Infinity,zMax=-Infinity,yMin=Infinity;
  for (let k = 0; k < n; k++) {
    const x=pos[k*3], y=pos[k*3+1], z=pos[k*3+2];
    if(x<xMin)xMin=x; if(x>xMax)xMax=x;
    if(z<zMin)zMin=z; if(z>zMax)zMax=z; if(y<yMin)yMin=y;
  }
  const cx=(xMin+xMax)*0.5, cz=(zMin+zMax)*0.5;

  const P = new Float32Array(pos.length * copies);
  const N = nrm ? new Float32Array(nrm.length * copies) : null;
  const U = uv  ? new Float32Array(uv.length  * copies) : null;

  for (let c = 0; c < copies; c++) {
    const a  = c * GOLDEN_ANGLE;
    const ca = Math.cos(a), sa = Math.sin(a);
    const sc = c === 0 ? 1.0 : 0.90 + 0.06 * (c % 2);   // break matching silhouettes
    const base = c * n;
    for (let k = 0; k < n; k++) {
      const x = pos[k*3] - cx, y = pos[k*3+1], z = pos[k*3+2] - cz;
      const d = (base + k) * 3;
      P[d  ] = ( x*ca + z*sa) * sc + cx;
      P[d+1] = y * (c === 0 ? 1.0 : 1.04);
      P[d+2] = (-x*sa + z*ca) * sc + cz;
      if (N) {
        const nx=nrm[k*3], ny=nrm[k*3+1], nz=nrm[k*3+2];
        N[d  ] =  nx*ca + nz*sa;      // rotation preserves handedness:
        N[d+1] =  ny;                 // no winding flip, no normal negation
        N[d+2] = -nx*sa + nz*ca;
      }
      if (U) { U[(base+k)*2] = uv[k*2]; U[(base+k)*2+1] = uv[k*2+1]; }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  if (N) g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  if (U) g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  if (!N) g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

let _treePositions = [];
// Withdrawn — the scan read as malformed at every tier and no shell
// arrangement fixed it. Kept rather than deleted so the poly-budget notes
// survive if the asset is ever replaced.
function buildInstancedCypress(positions) {
  return;
  // ══════════════════════════════════════════════════════════════════════
  //  POSITION FORMAT: entries are [x, z] — TWO elements, not three.
  //  Reading p[1] as height and p[2] as Z sent every tree into the sky at an
  //  altitude equal to its own Z coordinate. Normalise to [x, y, z] once here
  //  so nothing downstream can make that mistake again.
  // ══════════════════════════════════════════════════════════════════════
  _treePositions = (positions || []).map(p =>
    p.length >= 3 ? [p[0], p[1], p[2]] : [p[0], 0, p[1]]
  );
  if (!_treePositions.length) return;

  // Caps raised: the optimised tree-mesh.glb is 35k tris (was 877k), so after
  // mirror-merging to ~70k we can afford roughly 25x more instances.
  const CAP = PERF_MODE === 'rich' ? 200 : PERF_MODE === 'balanced' ? 110 : 40;

  // Cone fallback for everything beyond the real-mesh cap (and all of fast mode)
  const coneList = _treePositions.slice(CAP);
  if (coneList.length) {
    const cMat = new THREE.MeshStandardMaterial({ color: 0x2f5a24, roughness: 0.92, metalness: 0 });
    const cGeo = new THREE.ConeGeometry(1.5, 6.5, 7);
    const cones = new THREE.InstancedMesh(cGeo, cMat, coneList.length);
    coneList.forEach((p, i) => {
      _dummy.position.set(p[0], p[1] + 3.2, p[2]);   // cone pivot is centred
      _dummy.rotation.set(0, Math.random() * 6.28, 0);
      _dummy.scale.set(0.8 + Math.random() * 0.6, 0.85 + Math.random() * 0.7, 0.8 + Math.random() * 0.6);
      _dummy.updateMatrix();
      cones.setMatrixAt(i, _dummy.matrix);
    });
    cones.instanceMatrix.needsUpdate = true;
    cones.castShadow = PERF_MODE !== 'fast';
    cones.receiveShadow = true;
    scene.add(cones);
  }

  if (CAP === 0) return;
  const heroList = _treePositions.slice(0, CAP);

  makeDracoLoader().load('assets/tree-mesh.glb', gltf => {
    let srcMesh = null;
    gltf.scene.traverse(o => { if (o.isMesh && !srcMesh) srcMesh = o; });
    if (!srcMesh) { console.warn('[XIX] tree-mesh.glb has no mesh'); return; }

    // Rich can afford a third shell; it closes the canopy almost completely.
    const geo = _radialShellGeometry(srcMesh.geometry, PERF_MODE === 'rich' ? 3 : 2);

    // Recentre on origin, sit base at y=0, normalise to ~9m tall
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    geo.translate(-cx, -bb.min.y, -cz);
    const rawH = bb.max.y - bb.min.y;
    geo.scale(9.0 / rawH, 9.0 / rawH, 9.0 / rawH);
    geo.computeBoundingSphere();

    const mat = srcMesh.material.clone();
    mat.side = THREE.DoubleSide;          // canopy gaps must not show holes
    mat.roughness = 0.88;
    mat.metalness = 0.0;
    mat.envMapIntensity = 0.65;
    if (mat.map) {
      mat.map.colorSpace = THREE.SRGBColorSpace;
      mat.map.anisotropy = PERF_MODE === 'rich' ? 16 : 8;
    }
    if (_envMapRef) mat.envMap = _envMapRef;
    if (mat.sheen !== undefined) { mat.sheen = 0.35; mat.sheenColor = new THREE.Color(0x8fc060); }

    const trees = new THREE.InstancedMesh(geo, mat, heroList.length);
    heroList.forEach((p, i) => {
      _dummy.position.set(p[0], p[1], p[2]);   // geometry base already at y=0
      // Yaw is now purely for placement variety — the geometry itself has no
      // preferred facing left to hide.
      _dummy.rotation.set(
        (Math.random() - 0.5) * 0.06,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.06
      );
      const sc = 0.78 + Math.random() * 0.5;
      _dummy.scale.set(sc, sc * (0.9 + Math.random() * 0.28), sc * (0.94 + Math.random() * 0.14));
      _dummy.updateMatrix();
      trees.setMatrixAt(i, _dummy.matrix);
    });
    trees.instanceMatrix.needsUpdate = true;
    trees.castShadow = true;
    trees.receiveShadow = true;
    trees.frustumCulled = true;
    trees.name = 'heroTrees';
    scene.add(trees);

    const tris = Math.round(geo.attributes.position.count / 3);
    console.log(`[XIX] Trees: ${heroList.length} radial-shell instances, ${tris.toLocaleString()} tris each`);
  }, undefined, () => console.warn('[XIX] tree-mesh.glb not found — cones only'));
}

// ─── INSTANCED VILLA RENDERING WITH LOD ───────────────────────────────────────
// Impostor material: fully transparent — if LOD kicks in at extreme distance, invisible not beige box
// opacity was 0.0 — confirmed never modified anywhere else in this file, so
// this was not a fade transition mid-flight, it was a permanently invisible
// mesh. Any villa past 400m simply vanished rather than degrading to a
// simplified silhouette. Given a real colour and full opacity, it now reads
// as a distant building block, not a hole in the estate.
const _impostorMat   = new THREE.MeshStandardMaterial({ color:0xE8DCC0, roughness:.85, metalness:0 });
const _impostorGeo   = new THREE.BoxGeometry(14, 8, 12);

function placeVillaGLBWithLOD(x, z, ry, plotKey) {
  if (!villaGLBScene) { 
    // Frame 1: Place a lightweight box immediately so the estate looks full
    const dummy = new THREE.Mesh(_impostorGeo, _impostorMat);
    dummy.position.set(x, 4, z);
    dummy.rotation.y = ry;
    scene.add(dummy);
    
    // Save reference so we can delete it when the real GLB arrives
    pendingVillas.push({x, z, ry, plotKey, placeholder: dummy}); 
    if (plotKey) addPlotOverlay(x, z, ry, plotKey, dummy); 
    return; 
  }

  const lod = new THREE.LOD();
  lod.position.set(x, 0, z);
  lod.rotation.y = ry;
  lod.userData.isVillaGLB  = true;
  lod.userData.baseRotY    = ry;
  lod.userData.plotKey     = plotKey;

  const highDetail = villaGLBScene.clone(true);
  highDetail.rotation.y = 0;
  lod.addLevel(highDetail, 0);          
  
  // LOD swap at 400m — well beyond walking range, prevents boxes showing inside estate
  const lowDetail = new THREE.Mesh(_impostorGeo, _impostorMat);
  lowDetail.position.y = 4;
  lod.addLevel(lowDetail, 400); 

  scene.add(lod);
  if (plotKey) addPlotOverlay(x, z, ry, plotKey, lod);
}

// Sun shadow camera is normally a tight ±120m frustum centred on the polo
// field — correct for ground-level walking, where only nearby buildings are
// ever in view, and tight bounds buy real per-texel shadow resolution.
// The ESTATE, per WORLD in data.js, spans roughly x:-400..310, z:-230..245 —
// a 710 x 475m footprint. Stables, the apartment blocks, and the east
// paddock all sit entirely outside a ±120m box, so from an aerial orbit
// showing the whole estate at once, most of it was rendering with zero
// real-time shadowing: flat, shadowless light on everything but the centre.
// That flatness is a large part of what reads as "not realistic" in an
// establishing shot — offline architectural renders never have this problem
// because they don't need a tight frustum for real-time performance.
let _aerialSavedFrustum = null;
let _aerialModeActive = false;   // guards against a quality-tier change mid-orbit
                                  // clobbering the widened frustum below

export function setAerialMode(on) {
  _aerialModeActive = on;
  const sun = getSunLight ? getSunLight() : null;
  if (on) {
    // Force every villa to full detail — the flagship shot should never
    // show a simplified building, and there are far fewer simultaneous
    // draw calls to worry about during a slow orbit than during walking.
    scene.traverse(obj => {
      if (obj.isLOD && obj.userData.isVillaGLB && obj.levels[1]) {
        obj.levels[1].distance = 1e6;
      }
    });
    if (sun && sun.shadow) {
      const cam = sun.shadow.camera;
      _aerialSavedFrustum = { l: cam.left, r: cam.right, t: cam.top, b: cam.bottom, f: cam.far };
      // 380m half-extent covers the full WORLD bounds with margin; shadow
      // texel density drops accordingly, which is the correct trade at
      // orbital viewing distance — coverage matters more than crispness
      // when the whole estate is on screen at once.
      cam.left = -380; cam.right = 380; cam.top = 380; cam.bottom = -380;
      cam.far  = 900;
      cam.updateProjectionMatrix();
    }
  } else {
    scene.traverse(obj => {
      if (obj.isLOD && obj.userData.isVillaGLB && obj.levels[1]) {
        obj.levels[1].distance = 400;
      }
    });
    if (sun && sun.shadow && _aerialSavedFrustum) {
      const cam = sun.shadow.camera, f = _aerialSavedFrustum;
      cam.left = f.l; cam.right = f.r; cam.top = f.t; cam.bottom = f.b; cam.far = f.f;
      cam.updateProjectionMatrix();
      _aerialSavedFrustum = null;
    }
  }
}

// ─── IN-WORLD SIGNAGE ─────────────────────────────────────────────────────────
function addEstateSignage() {
  const pillarMat = new THREE.MeshStandardMaterial({ color:0x2a3820, roughness:.7, metalness:.3 });
  const goldMat   = new THREE.MeshStandardMaterial({ color:0xC9A84C, roughness:.3, metalness:.8 });

  for (const gx of [-12, 12]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6, 1.2), pillarMat);
    pillar.position.set(gx, 3, 218);
    pillar.castShadow = true; scene.add(pillar);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.6), goldMat);
    cap.position.set(gx, 6.25, 218); scene.add(cap);
  }

  const headerBar = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, 0.3), pillarMat);
  headerBar.position.set(0, 6.5, 218); scene.add(headerBar);

  const sigCanvas = document.createElement('canvas'); sigCanvas.width=512; sigCanvas.height=96;
  const sigCtx = sigCanvas.getContext('2d');
  sigCtx.fillStyle = '#061208'; sigCtx.fillRect(0,0,512,96);
  sigCtx.fillStyle = '#C9A84C';
  sigCtx.font = 'bold 64px serif';
  sigCtx.textAlign = 'center'; sigCtx.textBaseline = 'middle';
  sigCtx.fillText('PROJECT XIX', 256, 48);
  const sigTex = new THREE.CanvasTexture(sigCanvas);
  sigTex.colorSpace = THREE.SRGBColorSpace;
  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 1.9),
    new THREE.MeshBasicMaterial({ map: sigTex, side: THREE.DoubleSide })
  );
  signMesh.position.set(0, 5.5, 217.9); scene.add(signMesh);

  const signs = [
    { label:'CLUBHOUSE ▶',  pos:[-20, 0, 190], ry:0 },
    { label:'◀ STABLES',    pos:[ 20, 0, 190], ry:0 },
    { label:'VILLAS ▶',     pos:[ 0, 0, 160],  ry:Math.PI/2 },
    { label:'POLO FIELD ▶', pos:[-150, 0, 0],  ry:Math.PI/2 },
  ];

  signs.forEach(sg => {
    const postM = new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,2.5,6), pillarMat);
    postM.position.set(...sg.pos); postM.position.y = 1.25; scene.add(postM);

    const sc = document.createElement('canvas'); sc.width=256; sc.height=56;
    const sx = sc.getContext('2d');
    sx.fillStyle='rgba(6,18,8,0.92)'; sx.fillRect(0,0,256,56);
    sx.strokeStyle='#C9A84C'; sx.lineWidth=2; sx.strokeRect(2,2,252,52);
    sx.fillStyle='#C9A84C'; sx.font='bold 20px sans-serif';
    sx.textAlign='center'; sx.textBaseline='middle'; sx.fillText(sg.label,128,28);
    const t = new THREE.CanvasTexture(sc); t.colorSpace=THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.8,.4), new THREE.MeshBasicMaterial({map:t,side:THREE.DoubleSide}));
    board.position.set(sg.pos[0], 2.6, sg.pos[2]); board.rotation.y = sg.ry;
    scene.add(board);
  });
}

// ─── 3D FLOATING HOTSPOT LABELS ───────────────────────────────────────────────
const _hotspots = [];  

const HOTSPOT_DEFS = [
  { label:'The Clubhouse',        sublabel:'3,419m²  ·  3 floors  ·  8 skyboxes', pos:[0, 18, 108],    productKey:'clubhouse' },
  { label:'Crescent Lake',        sublabel:'200m  ·  Waterfront plots',            pos:[30, 14, -115],  productKey:null },
  { label:'Horse Stables',        sublabel:'56 stalls  ·  Cobblestone yard',       pos:[-375, 16, 90],  productKey:'stables' },
  { label:'Premium Villas',       sublabel:'330m²  ·  Polo-facing',                pos:[-162, 14, 0],   productKey:'villas' },
  { label:'Training Field',       sublabel:'FIP standard  ·  100×160m',            pos:[-390, 12, -40], productKey:'training' },
  { label:'The Paddock',          sublabel:'Post-and-rail  ·  East precinct',      pos:[218, 12, 0],    productKey:'paddock' },
];

function _makeHotspotCanvas(label, sublabel) {
  const W = 380, H = 80;
  const c = document.createElement('canvas'); c.width=W; c.height=H;
  const ctx = c.getContext('2d');
  ctx.beginPath();
  const r = 14;
  ctx.moveTo(r,0); ctx.lineTo(W-r,0); ctx.quadraticCurveTo(W,0,W,r);
  ctx.lineTo(W,H-r); ctx.quadraticCurveTo(W,H,W-r,H);
  ctx.lineTo(r,H); ctx.quadraticCurveTo(0,H,0,H-r);
  ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0); ctx.closePath();
  ctx.fillStyle = 'rgba(6,18,8,0.88)';
  ctx.fill();
  ctx.strokeStyle = '#C9A84C'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(22, H/2, 5, 0, Math.PI*2);
  ctx.fillStyle = '#C9A84C'; ctx.fill();
  ctx.fillStyle = '#f0ece0';
  ctx.font = 'bold 22px Inter, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 36, H*0.38);
  ctx.fillStyle = 'rgba(201,168,76,0.85)';
  ctx.font = '16px Inter, sans-serif';
  ctx.fillText(sublabel, 36, H*0.72);
  return c;
}

export const HOTSPOT_LAYER = 1;

export function addLandmarkHotspots() {
  HOTSPOT_DEFS.forEach(def => {
    const canvas  = _makeHotspotCanvas(def.label, def.sublabel);
    const tex     = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0.85,
      depthWrite: false, sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(mat);
    const aspect = canvas.width / canvas.height;
    const worldH = 6; 
    sprite.scale.set(worldH * aspect, worldH, 1);
    sprite.position.set(...def.pos);
    sprite.userData.productKey = def.productKey;
    sprite.userData.label      = def.label;
    sprite.userData.isHotspot  = true;
    // Three's Water builds its own virtual camera for the reflection pass and
    // leaves it on the default layer mask, so anything moved off layer 0 never
    // enters the reflection buffer. The label still floats above the villa —
    // the main camera opts back in inside tickScene — it just no longer
    // appears upside down in the water.
    sprite.layers.set(HOTSPOT_LAYER);
    scene.add(sprite);
    _hotspots.push({ sprite, productKey: def.productKey });
  });
}

export function tickHotspots(elapsed) {
  _hotspots.forEach((h, i) => {
    const phase = (elapsed * 0.5 + i * 0.4) % (Math.PI * 2);
    h.sprite.material.opacity = 0.72 + Math.sin(phase) * 0.28;
  });
}

export function getHotspotAtRay(raycaster) {
  const sprites = _hotspots.map(h => h.sprite);
  const hits = raycaster.intersectObjects(sprites, false);
  if (hits.length === 0) return null;
  return hits[0].object.userData.productKey;
}

// ─── VILLA HEDGES ────────────────────────────────────────────────────────────
const _hedgeInstData = []; 

function collectVillaHedge(x, z, ry) {
  _hedgeInstData.push({ x, z, ry });
}

function buildAllVillaHedges() {
  if (_hedgeInstData.length === 0) return;
  const geo = new THREE.BoxGeometry(1, 1.4, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2d5a1e, roughness: 0.95, metalness: 0, envMapIntensity: 0.2,
  });
  const SEGS_PER_VILLA = 6;
  const total = _hedgeInstData.length * SEGS_PER_VILLA;
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  let idx = 0;

  _hedgeInstData.forEach(({ x, z, ry }) => {
    const W = 10.5, D = 8.5, H = 0.7, T = 0.55;
    const segments = [
      { lx: 0,          lz: -(D+T),  sx: W*2, sz: T },
      { lx: -(W*0.5+1), lz:  D+T,   sx: W-2, sz: T },
      { lx:  (W*0.5+1), lz:  D+T,   sx: W-2, sz: T },
      { lx: -(W+T),     lz:  0,      sx: T,   sz: D*2 },
      { lx:  (W+T),     lz: -D*0.3,  sx: T,   sz: D*1.4 },
      { lx:  (W+T),     lz:  D*0.7,  sx: T,   sz: D*0.6 },
    ];
    const cosR = Math.cos(ry), sinR = Math.sin(ry);
    segments.forEach(seg => {
      const wx = x + seg.lx * cosR - seg.lz * sinR;
      const wz = z + seg.lx * sinR + seg.lz * cosR;
      dummy.position.set(wx, H, wz);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(seg.sx, 1, seg.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx++, dummy.matrix);
    });
  });

  mesh.count = idx;
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

// ─── AO CONTACT SHADOWS ───────────────────────────────────────────────────────
function addVillaContactShadow(x, z) {
  const aoMat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.22,
    depthWrite: false, side: THREE.FrontSide,
  });
  const ao = new THREE.Mesh(new THREE.PlaneGeometry(18, 14), aoMat);
  ao.rotation.x = -Math.PI / 2;
  ao.position.set(x, 0.05, z);
  scene.add(ao);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
let sunLight, hemiLight;
let _envMapRef = null;

// ─── MOBILE / GPU TIER AUTO-DETECTION ────────────────────────────────────────
// Call detectMobileTier() immediately after renderer is created in initScene().
// On mobile UA: locks PERF_MODE to 'fast' regardless of user setting.
// On low-end GPU: caps at 'balanced' if max texture size < 4096.
function detectMobileTier() {
  const isMobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
  if (isMobile) {
    PERF_MODE = 'fast';
    if (typeof setPerfModeGraphics === 'function') setPerfModeGraphics('fast');
    console.log('[XIX] Mobile UA detected → PERF_MODE locked to fast');
    return;
  }
  if (renderer) {
    const gl     = renderer.getContext();
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (maxTex < 4096 && PERF_MODE === 'rich') {
      PERF_MODE = 'balanced';
      console.log('[XIX] Low-end GPU (maxTex:', maxTex, ') → PERF_MODE capped to balanced');
    }
  }
}


export function getSunLight() { return sunLight; }

export function initScene(canvas) {
  clock = new THREE.Clock();
  const perfS = PERF_SETTINGS[PERF_MODE];

  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference:"high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, perfS.pixelRatio));
  renderer.shadowMap.enabled   = true;
  renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85; 
  renderer.outputColorSpace    = THREE.SRGBColorSpace;
  detectMobileTier(); // Auto-lock PERF_MODE for mobile/low-end GPU

  scene  = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x8ab8cc, perfS.fogDensity);

  camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1200);

  buildLighting();

  const { skyObj, sun, skyUniforms } = createAtmosphericSky(scene, renderer);
  _skyObj = skyObj; _skySun = sun; _skyUniforms = skyUniforms;
  window._xixSkyObj = skyObj;
  setSkyForTime(_skyUniforms, _skySun, sunLight, 'afternoon');

  // ── HDRI IBL — async, non-blocking ──────────────────────────────────────
  // The HDR file loads in the background. Scene renders immediately.
  // Once baked, HDRI replaces sky-capture IBL on every PBR material.
  // All four time presets are driven by intensity/tint modulation — one file.
  loadHDRI(renderer, scene, (envMap) => {
    scene.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        if (m.isMeshStandardMaterial) { m.envMap = envMap; m.needsUpdate = true; }
      });
    });
    applyHDRITimeModulation(window._currentTimeOfDay || 'afternoon', scene);
    _envMapRef = envMap;
    window._hdriReady = true;
    console.log('[XIX] HDRI IBL active');
  });

  // Sky PMREM fallback — fires only if HDRI hasn't loaded within 4 seconds
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!window._hdriReady) buildEnvMapFromSky(renderer, scene, skyObj);
    // Retry fallback after 4s
    setTimeout(() => { if (!window._hdriReady) buildEnvMapFromSky(renderer, scene, skyObj); }, 4000);
  }));

  // ── Ground + field always first — visible within frame 1 ──
  addGround();
  addPoloField();
  addSafetyZone();

  requestAnimationFrame(() => {
    addGrassRing();
    addYardMarkings();
    addRoads();
    addLake();
    addEastLake();
    addClubhouse();
    addEstateSignage();
    addLandmarkHotspots();

    // Load main asset first, stagger the rest using separate loaders to prevent Web Worker deadlock
    loadVillaGLB();
    addVillaRing();

    setTimeout(() => { loadLoftGLB(); addLoftTerraces(); }, 400);
    setTimeout(() => { loadApartmentGLB(); addWestCompound(); }, 800);
    setTimeout(() => { loadClubhouseGLB(); }, 1200);
    setTimeout(() => { loadStablesGLB(); }, 1600);
    setTimeout(() => { loadHorseGLB(); }, 2000);
    spawnAmbientHorses();   // decorative horses on the polo field, training field, paddock
    
    addPaddock();
    addGamePark();
    addCommercialBlock();
    addServiceCompound();
    addLandscaping();

    // Cap NPC horses at 4 — each is a separate GLB+Draco load; 8 was too expensive
    for (let i = 0; i < 4; i++) {
      setTimeout(() => spawnNPCHorse(i), 3000 + i * 600);
    }
  });

  return { scene, renderer, camera, clock };
}

export function updateSkyForTime(timeName) {
  if (!_skyUniforms) return;
  const exp = setSkyForTime(_skyUniforms, _skySun, sunLight, timeName);
  if (renderer) renderer.toneMappingExposure = exp;
  if (scene && scene.fog) {
    const fogColors = { morning:0x8ab8cc, afternoon:0x8ab8cc, sunset:0xc06040, night:0x020810 };
    scene.fog.color.set(fogColors[timeName] || 0x8ab8cc);
  }
  setBloomForTime(timeName);
  updateNightLights(timeName);
  updateBuildingNightGlow(timeName);

  // HDRI time modulation — adjusts IBL intensity for this time of day (instant, no re-bake)
  window._currentTimeOfDay = timeName;
  applyHDRITimeModulation(timeName, scene);

  // Keep the lake's reflected sun in step with the sky
  if (window._xixLakeWater && sunLight) {
    const wu = window._xixLakeWater.material.uniforms;
    if (wu['sunDirection']) wu['sunDirection'].value.copy(sunLight.position).normalize();
    if (wu['sunColor'])     wu['sunColor'].value.copy(sunLight.color);
  }
  // Sky PMREM re-capture only fires if HDRI hasn't loaded (scheduleEnvMapRefresh is a no-op when HDRI active)
  if (PERF_MODE !== 'fast' && renderer && scene && _skyObj) {
    scheduleEnvMapRefresh(renderer, scene, _skyObj);
  }

  // Update glass panel sun glint intensity based on time of day
  // Afternoon: moderate glint. Sunset: strong warm glint. Night: none.
  const glintMap = { morning: 0.12, afternoon: 0.18, sunset: 0.42, night: 0.0 };
  window._xixSunGlintIntensity = glintMap[timeName] ?? 0.15;
}

export function updateSky(top, hor, gnd) {
  // no-op
}

function buildLighting() {
  const perfS = PERF_SETTINGS[PERF_MODE];

  // Sky dome ambient — blue above, warm laterite bounce below (Lagos ground colour)
  hemiLight = new THREE.HemisphereLight(0x7CB8D4, 0x4a6a30, 0.45);
  scene.add(hemiLight);

  // Ground bounce — warm terracotta fill from Lagos laterite soil
  const groundBounce = new THREE.HemisphereLight(0xFFFFFF, 0xD4803A, 0.25);
  groundBounce.position.set(0, -10, 0);
  scene.add(groundBounce);

  sunLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
  sunLight.position.set(120, 220, 100);

  if (PERF_MODE === 'fast') {
    // ── FAST: shadows OFF entirely — saves 4-8ms/frame on mobile ──────────
    sunLight.castShadow = false;
  } else if (_aerialModeActive) {
    // An aerial-widened frustum is active — setAerialMode() owns left/right/
    // top/bottom/far entirely while this is true. Only mapSize and bias
    // still need to track the quality tier; the frustum bounds themselves
    // must not be touched here or the aerial coverage fix is undone the
    // instant someone changes quality mid-orbit.
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(perfS.shadowMapSize, perfS.shadowMapSize);
    if (PERF_MODE === 'balanced') {
      sunLight.shadow.bias = -0.00012; sunLight.shadow.normalBias = 0.012; sunLight.shadow.radius = 2.0;
    } else {
      sunLight.shadow.bias = -0.00008; sunLight.shadow.normalBias = 0.008; sunLight.shadow.radius = 1.5;
    }
  } else {
    // ── BALANCED / RICH: tight frustum = far better shadow texel density ──
    // ±380m frustum on a 2048 map = 2.7mm/texel (blurry); ±100m = 0.5mm/texel
    // (crisp architectural shadows) — this tight bound is deliberate and
    // correct for ground-level walking, where only nearby buildings are ever
    // in frame. setAerialMode() is the ONLY place that should widen it, and
    // only for as long as the aerial camera is actually active.
    const fHalf = PERF_MODE === 'rich' ? 120 : 100;
    sunLight.castShadow = true;
    sunLight.shadow.camera.left   = -fHalf;
    sunLight.shadow.camera.right  =  fHalf;
    sunLight.shadow.camera.top    =  fHalf;
    sunLight.shadow.camera.bottom = -fHalf;
    sunLight.shadow.camera.near   = 0.5;
    sunLight.shadow.camera.far    = 600;
    sunLight.shadow.mapSize.set(perfS.shadowMapSize, perfS.shadowMapSize);
    if (PERF_MODE === 'balanced') {
      sunLight.shadow.bias       = -0.00012;
      sunLight.shadow.normalBias =  0.012;
      sunLight.shadow.radius     =  2.0;
    } else {
      sunLight.shadow.bias       = -0.00008;
      sunLight.shadow.normalBias =  0.008;
      sunLight.shadow.radius     =  1.5;
    }
  }
  scene.add(sunLight);

  // Warm fill (opposite sun — prevents pure black shadows)
  const fill = new THREE.DirectionalLight(0xd4b890, 0.25);
  fill.position.set(100, 60, -120);
  scene.add(fill);

  // Blue sky fill from north
  const ambient = new THREE.DirectionalLight(0xb8d0ff, 0.15);
  ambient.position.set(-80, 20, 80);
  scene.add(ambient);
}

// ─── NIGHT SECURITY LIGHTS ────────────────────────────────────────────────────
const _nightLights = [];
let   _nightLightsActive = false;

// Point lights are the most expensive thing in a forward renderer — each one
// costs in every lit fragment shader and Three has a hard uniform ceiling
// besides. A lamp beside all 26 villas plus the estate lamps as real lights
// would not compile, let alone run on a phone.
//
// So every position gets a POST and an emissive GLOBE (the globe is what
// actually reads as a lamp at distance, and both are instanced), while the
// real PointLights come from a small pool reassigned each frame to whichever
// lamps are nearest the camera. Light always falls where the viewer is
// standing and the cost is constant however many lamps the estate grows to.
const _lampPool = [];
const _lampNodes = [];
const LAMP_POOL_SIZE = { fast: 4, balanced: 8, rich: 14 };
let _lampTargetIntensity = 0;

function buildNightLights() {
  if (_nightLights.length > 0) return;
  const lampPositions = [
    [-120,0,215],[-60,0,215],[0,0,215],[60,0,215],[120,0,215],
    [-80,0,-105],[-20,0,-105],[40,0,-105],[100,0,-105],
    [-40,0,108],[0,0,108],[40,0,108],
    [-360,0,80],[-375,0,60],[-390,0,40],
  ];

  // One lamp beside every villa, at the front-right of the plot so it stands
  // outside the hedge line rather than in the garden. Positions come from the
  // same villa records the hedges use, so the two cannot drift apart.
  _hedgeInstData.forEach(({ x, z, ry }) => {
    const c = Math.cos(ry), s = Math.sin(ry), lx = 12.4, lz = -10.6;
    lampPositions.push([x + lx*c - lz*s, 0, z + lx*s + lz*c]);
  });

  const postMat = new THREE.MeshStandardMaterial({ color:0x2a3020, roughness:.7 });
  const globeMat = new THREE.MeshStandardMaterial({
    color:0xffcc66, emissive:0xffaa33, emissiveIntensity:2.0,
    roughness:.3, transparent:true, opacity:.9
  });

  const posts  = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08,0.10,5,6), postMat,  lampPositions.length);
  const globes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22,8,6),        globeMat, lampPositions.length);
  posts.frustumCulled = globes.frustumCulled = false;
  const d = new THREE.Object3D();
  lampPositions.forEach(([x, , z], i) => {
    d.position.set(x, 2.5, z);  d.updateMatrix(); posts.setMatrixAt(i, d.matrix);
    d.position.set(x, 5.25, z); d.updateMatrix(); globes.setMatrixAt(i, d.matrix);
    _lampNodes.push({ x, y: 5.0, z });
  });
  posts.instanceMatrix.needsUpdate = globes.instanceMatrix.needsUpdate = true;
  scene.add(posts); scene.add(globes);
  _nightLights.push({ globes });

  const poolSize = LAMP_POOL_SIZE[PERF_MODE] ?? 8;
  for (let i = 0; i < poolSize; i++) {
    const pt = new THREE.PointLight(0xffaa44, 0, 24, 1.8);
    pt.visible = false;
    scene.add(pt); _lampPool.push(pt); _nightLights.push({ pt });
  }
  console.log(`[XIX] Lamps: ${lampPositions.length} posts, ${poolSize} pooled point lights`);
}

// Reassign the pool to the nearest lamps. Driven from tickScene.
const _lampSort = [];
export function tickLampPool(camera) {
  if (!_lampPool.length || !_nightLightsActive || !camera) return;
  _lampSort.length = 0;
  const cx = camera.position.x, cz = camera.position.z;
  for (const n of _lampNodes) {
    const dx = n.x - cx, dz = n.z - cz;
    _lampSort.push({ n, d2: dx*dx + dz*dz });
  }
  _lampSort.sort((a, b) => a.d2 - b.d2);
  const R2 = 90 * 90;
  for (let i = 0; i < _lampPool.length; i++) {
    const s = _lampSort[i], pt = _lampPool[i];
    if (!s || s.d2 > R2) { pt.visible = false; continue; }
    pt.position.set(s.n.x, s.n.y, s.n.z);
    pt.visible = true;
    // Fade the outermost in rather than popping them on.
    const k = 1 - Math.min(1, s.d2 / R2);
    pt.intensity = _lampTargetIntensity * k * k;
  }
}

export function updateNightLights(timeName) {
  const isNight = (timeName === 'night');
  const isSunset = (timeName === 'sunset');

  if (isNight || isSunset) buildNightLights();

  _lampTargetIntensity = isNight ? 3.2 : isSunset ? 1.4 : 0;

  // Drive emissive glow on every lamp globe (post + sconce)
  const globeInt = isNight ? 4.0 : isSunset ? 1.4 : 0.0;   // "very bright at night" — raised from 2.8
  scene.traverse(o => {
    if (o.isMesh && o.userData.isLampGlobe) {
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m) m.emissiveIntensity = globeInt;
    }
  });

  _nightLights.forEach(item => {
    if (item.pt && _lampTargetIntensity === 0) { item.pt.intensity = 0; item.pt.visible = false; }
    if (item.globes) {
      item.globes.material.emissiveIntensity = isNight ? 2.5 : isSunset ? 1.2 : 0;
      item.globes.material.opacity = (isNight || isSunset) ? 0.95 : 0.0;
      item.globes.visible = (isNight || isSunset);
    }
  });
  // Sunset counts as active so the pool tracks before full dark.
  _nightLightsActive = isNight || isSunset;
}

// Glass mesh cache — populated by applyPS4Materials via userData.isGlassPanel flag.
// Avoids scene.traverse() on every time-of-day change (expensive at scale).
const _glassMeshCache = [];
export function registerGlassMesh(mesh) {
  if (!_glassMeshCache.includes(mesh)) _glassMeshCache.push(mesh);
}

export function updateBuildingNightGlow(timeName) {
  if (!scene) return;
  const isNight   = timeName === 'night';
  const isSunset  = timeName === 'sunset';

  // Interior warm glow — the "inhabited" feel at night
  // Night: full warm amber glow from interior lighting (0.65)
  // Sunset: subtle pre-dusk warmth (0.22)
  // Afternoon: tiny hint so glass is never completely cold (0.04)
  const glowInt = isNight ? 0.65 : isSunset ? 0.22 : 0.04;
  const glowCol = isNight
    ? new THREE.Color(0xffe4a0)   // warm incandescent interior
    : new THREE.Color(0xffcc88);  // soft warm pre-sunset

  // Target for the live sun-glint system (handled by tickScene)
  window._xixSunGlintIntensity = isNight ? 0.0 : isSunset ? 0.42 : 0.18;

  // Apply to cached glass meshes first (fast path — from applyPS4Materials)
  _glassMeshCache.forEach(obj => {
    if (!obj.material) return;
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (!mat) return;
    mat.emissive = glowCol;
    mat.emissiveIntensity = glowInt;
  });

  // Fallback: also traverse for any glass that wasn't caught by applyPS4Materials
  // (e.g. geometry built inline with MAT_GLASS). Runs only on time change, not per-frame.
  if (_glassMeshCache.length === 0) {
    scene.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      if (!mat) return;
      const name = (mat.name || obj.name || '').toLowerCase();
      if (name.includes('glass') || name.includes('window') || name.includes('glaz')) {
        mat.emissive = glowCol; mat.emissiveIntensity = glowInt; mat.needsUpdate = true;
      }
    });
  }
}

// ─── GEOMETRY HELPERS ─────────────────────────────────────────────────────────
function box(w,h,d,mat,pos=[0,0,0],ry=0,shadow=true){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  m.position.set(...pos); m.rotation.y=ry; m.castShadow=shadow&&h>.3; m.receiveShadow=true; return m;
}
function plane(w,d,mat,pos=[0,0,0]){
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),mat);
  m.rotation.x=-Math.PI/2; m.position.set(...pos); m.receiveShadow=true; return m;
}
function cyl(rt,rb,h,seg,mat,pos=[0,0,0]){
  const m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg),mat);
  m.position.set(...pos); m.castShadow=m.receiveShadow=true; return m;
}
function s(...o){ o.forEach(x=>x&&scene.add(x)); }

// ─── PBR TEXTURE LOADERS ──────────────────────────────────────────────────────
// ── PROCEDURAL GROUND SYSTEM ─────────────────────────────────────────────────
// Lagos laterite and grass ground — no external texture dependency.
// Zones: laterite perimeter → dry grass transitional → rich green inner estate.
// Procedural so it never tiles, never repeats, and always looks right at any scale.

let _groundMat = null;
function buildGroundMaterial() {
  if (_groundMat) return _groundMat;

  const groundVert = /* glsl */`
    varying vec2 vWorldXZ;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    void main() {
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      vWorldXZ  = vWorldPos.xz;
      vNormal   = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const groundFrag = /* glsl */`
    precision highp float;
    uniform float uTime;
    uniform vec3  uSunDir;
    uniform vec3  uSunColor;

    varying vec2 vWorldXZ;
    varying vec3 vWorldPos;
    varying vec3 vNormal;

    // ── Noise helpers ──────────────────────────────────────────────────────
    float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise2(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f*f*(3.0-2.0*f);
      return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),
                 mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x),f.y);
    }
    float fbm2(vec2 p) {
      float v=0.0, a=0.5;
      for(int i=0;i<4;i++){ v+=a*noise2(p); p*=2.1; a*=0.5; }
      return v;
    }

    void main() {
      vec2 wx = vWorldXZ;

      // ── 1. ZONE MAPPING ────────────────────────────────────────────────
      // Estate occupies roughly ±165m × ±125m at centre.
      // Outside that: Lagos laterite. Inside: graded grass.
      float outerR  = max(abs(wx.x) / 165.0, abs(wx.y) / 125.0); // 0=centre, 1=edge, >1=outside
      float zoneT   = smoothstep(0.85, 1.4, outerR); // 0=inner, 1=outer laterite

      // ── 2. INNER GRASS ZONE ────────────────────────────────────────────
      // Rich green grass — base for the estate interior
      float grassFBM  = fbm2(wx * 0.018);
      float grassVar  = fbm2(wx * 0.055 + 12.3);
      // Two-tone grass for the perimeter lawn (outside polo field, inside estate)
      vec3 grassA = vec3(0.22, 0.44, 0.15);  // rich tropical green
      vec3 grassB = vec3(0.30, 0.52, 0.18);  // lighter sun-hit patch
      vec3 grassCol = mix(grassA, grassB, grassFBM * grassVar);
      // Subtle harmattan dust in dry season: slight ochre tint on the inner grass
      float dustFBM = fbm2(wx * 0.008 + 55.7);
      grassCol = mix(grassCol, vec3(0.38, 0.36, 0.22) * 0.8, dustFBM * 0.18);

      // ── 3. OUTER LATERITE ZONE ─────────────────────────────────────────
      // Lagos red laterite — compacted iron-rich soil, varies from ochre to deep red
      float latFBM  = fbm2(wx * 0.022 + 33.1);
      float latFBM2 = fbm2(wx * 0.065 + 71.4);
      vec3 latA = vec3(0.58, 0.32, 0.16);  // deep laterite red
      vec3 latB = vec3(0.72, 0.45, 0.22);  // ochre-orange patches
      vec3 latC = vec3(0.48, 0.28, 0.12);  // very dark laterite shadow
      vec3 latCol = mix(mix(latA, latB, latFBM), latC, latFBM2 * 0.35);
      // Rock scatter: darker speckles at coarse scale
      float rockN = noise2(wx * 0.25);
      latCol = mix(latCol, vec3(0.30, 0.22, 0.14), step(0.82, rockN) * 0.55);

      // ── 4. TRANSITION BLEND ────────────────────────────────────────────
      // Soft gradient between inner grass and outer laterite
      // Also add a transitional dry-grass band at the boundary
      float transT = smoothstep(0.72, 0.95, outerR);  // dry grass transition
      vec3 dryGrass = vec3(0.52, 0.48, 0.22);         // harmattan-bleached grass
      vec3 innerCol  = mix(grassCol, dryGrass, transT * transT);
      vec3 finalAlbedo = mix(innerCol, latCol, zoneT);

      // ── 5. PBR LIGHTING ────────────────────────────────────────────────
      vec3 N = normalize(vNormal);
      // Fake micro-normal from FBM for surface roughness variation
      float microN = fbm2(wx * 0.4 + uTime * 0.005);
      N = normalize(N + vec3((microN-0.5)*0.06, 0.0, (noise2(wx*0.4+5.1)-0.5)*0.06));

      vec3 L   = normalize(uSunDir);
      float NdL = max(dot(N, L), 0.0);
      // Ground roughness: laterite is very rough (0.96), grass slightly less (0.88)
      float rough = mix(0.88, 0.97, zoneT);
      // Strong ambient — ground receives lots of sky fill in tropics
      vec3 amb = finalAlbedo * vec3(0.30, 0.36, 0.34);
      vec3 color = finalAlbedo * uSunColor * NdL * 0.85 + amb;

      // ── 6. CONTACT DARKENING near building footprints ──────────────────
      // Approximate AO: very subtle darkening near estate centre
      // (proper AO from GTAO handles the rest)
      float centreAO = smoothstep(80.0, 0.0, length(wx)) * 0.08;
      color *= 1.0 - centreAO;

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  _groundMat = new THREE.ShaderMaterial({
    vertexShader: groundVert,
    fragmentShader: groundFrag,
    uniforms: {
      uTime:    { value: 0.0 },
      uSunDir:  { value: new THREE.Vector3(0.48, 0.88, 0.40).normalize() },
      uSunColor:{ value: new THREE.Color(0xfff4e0) },
    },
  });
  window._xixGroundMat = _groundMat;
  return _groundMat;
}

// Legacy getDirtMaterial: returns the new procedural ground for compatibility
function getDirtMaterial() { return buildGroundMaterial(); }

const MATS = {
  villaRoof:  () => PBR.tileRoof(),
  loftBody:   () => PBR.concrete(),
  loftRoof:   () => PBR.timber(),
  flatGrey:   () => PBR.concrete(),
  stableRoof: () => PBR.timber(),
  roadAsph:   () => PBR.asphalt(),
  safetyBrown:() => getDirtMaterial(), 
  grassGreen: () => PBR.grass(),
  lawnGreen:  () => PBR.grass(),
  hedgeGreen: () => new THREE.MeshStandardMaterial({color:0x2a5a20,roughness:.95}), 
  cobble:     () => PBR.stone(),
  concrete:   () => PBR.concrete(),
  railWhite:  () => new THREE.MeshStandardMaterial({color:0xfcfaf8,roughness:.5}),
  // depthTest:false so the highlight is never hidden by a taller roof above
  // it — this is what made hover invisible from the aerial/top-down camera.
  plotAvail:  () => new THREE.MeshStandardMaterial({color:0x00ff88,transparent:true,opacity:0,depthWrite:false,depthTest:false}),
  plotReserved:()=> new THREE.MeshStandardMaterial({color:0xff4444,transparent:true,opacity:0,depthWrite:false,depthTest:false}),
};

function addGround() {
  // Estate floor: procedural laterite/grass zones (GLSL, no tiling artefacts).
  const gp = new THREE.Mesh(new THREE.PlaneGeometry(900, 700, 8, 8), buildGroundMaterial());
  gp.rotation.x = -Math.PI / 2;
  gp.position.set(0, 0, 30);
  gp.receiveShadow = true;
  scene.add(gp); _terrainMeshes.push(gp);

  // ── EVERY GREEN AREA USES THE SAME TURF ────────────────────────────────
  // All of these sample the identical world-space grid, so they tile into one
  // another seamlessly — no seams, no scale jumps between zones.
  // Zones are generous and overlapping on purpose: they share one world-space
  // grid, so overlap is invisible, whereas a gap exposes the bare ground shader
  // (the flat olive areas seen around the lake and villa frontages).
  const greens = [
    // [ width, depth, [x, y, z], options ]
    [ 180, 110, [-260, 0.10, -40], { chevron:true  } ],  // training field
    //  GRASS ENCROACHING THE SETBACK
    //  Two separate faults. First, these planes were sized to overlap the
    //  laterite rather than butt against it: the inner verges were 120 m wide
    //  centred at x = +-100, spanning x = -160..-40, which runs straight over
    //  the west safety strip (x = -148..-137) AND 97 m into the pitch itself.
    //  The north and south patches crossed their strips the same way.
    //  Second, they sat at y = 0.09 against laterite at y = 0.11 — a 2 cm gap.
    //  At 100 m that is below depth-buffer precision, so the two surfaces
    //  stitch into each other and the grass appears to creep over the edge in
    //  a wavy line. Trimmed to the safety edge (x = +-148, z = +-98) with a
    //  4 cm drop, so neither the overlap nor the z-fight can happen.
    [ 142, 360, [-219, 0.07,   0], { chevron:false } ],  // west villa frontage -> stops at x=-148
    [ 142, 360, [ 219, 0.07,   0], { chevron:false } ],  // east villa frontage -> stops at x=+148
    [  46, 360, [-171, 0.07,   0], { chevron:false } ],  // west inner verge, outside the strip
    [  46, 360, [ 171, 0.07,   0], { chevron:false } ],  // east inner verge, outside the strip
    [ 430, 108, [   0, 0.07, -156], { chevron:false } ], // north: lake surround + arc frontage
    [ 430,  56, [   0, 0.07,  130], { chevron:false } ], // south-inner: starts clear of the strip
    [ 430, 110, [   0, 0.07,  186], { chevron:false } ], // south / clubhouse lawn
    [ 240, 120, [   0, 0.09,  235], { chevron:false } ], // south beyond the clubhouse
    [  80,  90, [ 240, 0.09,  -30], { chevron:false } ], // paddock turf
    [  80,  80, [ 240, 0.09,   45], { chevron:false } ], // game park turf
    [ 120, 150, [-330, 0.09,   40], { chevron:false } ], // west compound lawn
  ];
  greens.forEach(([w, dp, pos, o]) => {
    const m = turfPlane(w, dp, pos, Object.assign({ markings:false, wear:false, wind:1.0 }, o));
    scene.add(m); _terrainMeshes.push(m);
  });

  // Hard surfaces
  s(plane(180, 80, MATS.concrete(), [0, .02, 122]));
  s(plane(90,  70, MATS.cobble(),   [-355, .02, 90]));
}

function _makeMicroTexture(col1, col2, planeW, planeD) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  const r1 = (col1>>16)&0xff, g1=(col1>>8)&0xff, b1=col1&0xff;
  const r2 = (col2>>16)&0xff, g2=(col2>>8)&0xff, b2=col2&0xff;
  const id = ctx.createImageData(256,256); const d = id.data;
  for(let i=0;i<256*256;i++){
    const t = Math.random(); const idx=i*4;
    d[idx]   = r1+(r2-r1)*t | 0;
    d[idx+1] = g1+(g2-g1)*t | 0;
    d[idx+2] = b1+(b2-b1)*t | 0;
    d[idx+3] = 255;
  }
  ctx.putImageData(id,0,0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(planeW/4, planeD/4);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.0 });
}

function addGrassRing() {
  // ══════════════════════════════════════════════════════════════════════════
  //  PERMANENTLY DISABLED — DO NOT RE-ENABLE
  // ══════════════════════════════════════════════════════════════════════════
  //  addGrassField() creates flat PlaneGeometry billboard cards that only look
  //  like grass when tickGrass() rotates them to face the camera every frame.
  //  tickGrass() is a bare return (bypassed for performance, graphics.js), so the
  //  cards sit at fixed random rotations and render as large flat green
  //  rectangles standing in the scene — visible behind the villas and across
  //  the estate perimeter.
  //
  //  This has now been reintroduced and removed twice. It stays removed.
  //  Ground cover is handled entirely by the GLSL shaders:
  //    • polo field  → addPoloField()        (blade displacement + chevron mow)
  //    • estate floor→ buildGroundMaterial() (laterite / grass / dry transition)
  //
  //  If billboard grass is ever wanted again, tickGrass() must be un-bypassed
  //  AND profiled on mobile FIRST. Do not call addGrassField() before that.
  // ══════════════════════════════════════════════════════════════════════════
  return;
}

// ══════════════════════════════════════════════════════════════════════════════
//  SHARED TURF SYSTEM
// ══════════════════════════════════════════════════════════════════════════════
//  ONE material factory drives every green surface in the estate: the polo
//  pitch, the training field, villa lawns, the paddock, verges — everything.
//
//  All sampling is done in WORLD METRES (vWorldPos.xz / uTexMeters), never in
//  UV space. Two consequences that matter:
//    1. Tiling is physically correct — one tile = 2m of real ground.
//    2. Every patch is automatically seamless and continuous with every other
//       patch, because they all read from the same world-space grid. Walking
//       from the villa lawn onto the pitch shows no seam and no scale change.
//
//  Per-surface behaviour is switched by uniforms, not by separate shaders:
//    uMarkings  1 = FIP pitch lines painted into the turf
//    uChevron   1 = mown chevron banding
//    uWear      1 = dirt wear at goal mouths
// ══════════════════════════════════════════════════════════════════════════════

const TURF_TEX = { col:null, nrm:null, rgh:null, ao:null, dirtCol:null, dirtNrm:null, dirtRgh:null, ready:0 };
const _turfMaterials = [];

function _loadTurfTextures() {
  if (TURF_TEX._started) return;
  TURF_TEX._started = true;
  const L = new THREE.TextureLoader();
  // Turf is the most grazing-angle surface in the scene; anisotropy is the
  // single cheapest sharpness win available on it.
  const _maxAniso = 16;
  const aniso = PERF_MODE === 'rich' ? _maxAniso : PERF_MODE === 'balanced' ? 12 : 6;
  const setup = (t, srgb) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    // RepeatWrapping is required: the shader feeds UVs far above 1.0.
    // t.repeat is NOT used — Three.js only injects the uv-transform into its
    // built-in materials, never into a raw ShaderMaterial. Tiling is explicit.
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    return t;
  };
  const push = (key, uni, srgb) => (t) => {
    TURF_TEX[key] = setup(t, srgb);
    _turfMaterials.forEach(m => { m.uniforms[uni].value = TURF_TEX[key]; });
    if (key === 'col' || key === 'nrm') {
      if (++TURF_TEX.ready >= 2) _turfMaterials.forEach(m => { m.uniforms.uHasTex.value = 1.0; });
    }
    if (key === 'dirtCol') _turfMaterials.forEach(m => { m.uniforms.uHasDirt.value = 1.0; });
  };
  const quiet = () => {};
  L.load('assets/textures/grass-color.jpg',     push('col','uGrassCol',true),  undefined, quiet);
  L.load('assets/textures/grass-normal.jpg',    push('nrm','uGrassNrm',false), undefined, quiet);
  L.load('assets/textures/grass-roughness.jpg', push('rgh','uGrassRgh',false), undefined, quiet);
  L.load('assets/textures/grass-ao.jpg',        push('ao','uGrassAO',false),   undefined, quiet);
  L.load('assets/textures/dirt-color.png',      push('dirtCol','uDirtCol',true),  undefined, quiet);
  L.load('assets/textures/dirt-normal.png',     push('dirtNrm','uDirtNrm',false), undefined, quiet);
  L.load('assets/textures/dirt-roughness.png',  push('dirtRgh','uDirtRgh',false), undefined, quiet);
}

const TURF_VERT = /* glsl */`
  uniform float uTime;
  uniform float uBladeStr;
  varying vec2  vUv;
  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vBladeTop;

  float hashv(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

  void main(){
    vUv = uv;
    vec3 pos = position;
    vec2 cell  = floor(pos.xy / 1.25);
    float seed = hashv(cell);
    float seed2= hashv(cell + vec2(3.7, 8.1));
    float stripV = fract(pos.y / 1.25 + 0.5);
    vBladeTop = stripV * stripV;

    if(uBladeStr > 0.05){
      // Blade height raised 4-14cm -> 11-38cm. At the old height the wind sway
      // was sub-pixel at any realistic camera distance, so the gust never read.
      float bladeH  = (seed * 0.27 + 0.11) * uBladeStr;
      float leanAng = seed2 * 6.2831;
      float leanAmt = (seed2 * 0.4 + 0.2) * 0.16 * uBladeStr;
      pos.z += bladeH * stripV;
      pos.x += cos(leanAng) * leanAmt * stripV;
      pos.y += sin(leanAng) * leanAmt * stripV;

      // Wind gust travelling across the field, in world space so the wave is
      // continuous across every separate turf mesh in the estate.
      vec2 wp = (modelMatrix * vec4(pos,1.0)).xz;
      float gust = sin(dot(wp, vec2(0.055, 0.031)) - uTime * 1.25) * 0.5 + 0.5;
      gust = pow(gust, 2.0);
      // Sway amplitude scaled with the taller blades — now clearly visible.
      float sway = (sin(uTime * 1.15 + seed * 6.28 + wp.x * 0.25) * 0.085
                  + sin(uTime * 0.72 + seed2 * 3.14) * 0.045) * (0.35 + gust * 1.30);
      pos.x += sway * stripV;
      pos.y += sway * 0.45 * stripV;

      vec3 N = normalize(vec3(-cos(leanAng)*leanAmt*3.0, -sin(leanAng)*leanAmt*3.0, 1.0));
      vNormal = normalize(normalMatrix * N);
    } else {
      vNormal = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
    }

    vWorldPos   = (modelMatrix * vec4(pos, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const TURF_FRAG = /* glsl */`
  precision highp float;

  uniform float uTime;
  uniform vec3  uSunDir;
  uniform vec3  uSunColor;
  uniform float uWetness;
  uniform float uSheen;
  uniform float uTexMeters;
  uniform float uHasTex;
  uniform float uHasDirt;
  uniform float uMarkings;
  uniform float uChevron;
  uniform float uWear;
  uniform float uWindStr;

  uniform sampler2D uGrassCol;
  uniform sampler2D uGrassNrm;
  uniform sampler2D uGrassRgh;
  uniform sampler2D uGrassAO;
  uniform sampler2D uDirtCol;
  uniform sampler2D uDirtNrm;
  uniform sampler2D uDirtRgh;

  varying vec2  vUv;
  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vBladeTop;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
  }
  float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){v+=a*noise(p);p*=2.1;a*=0.5;} return v; }
  float sdLine(float pos, float halfW){ return smoothstep(halfW+0.14, halfW-0.05, abs(pos)); }

  void main(){
    float wx = vWorldPos.x;
    float wz = vWorldPos.z;
    float dist = length(cameraPosition - vWorldPos);

    // ── CHEVRON MOW BANDS ────────────────────────────────────────────────
    float band   = floor(((wx + wz) * 0.7071) / 10.0);
    // Unmown lawns sit at 0.28 rather than 0.5 — informal grass is darker and
    // less uniform than a rolled pitch. At 0.5 they washed out pale and flat.
    float isEven = mix(0.28, mod(band, 2.0), uChevron);

    vec3  albedo    = vec3(0.30, 0.50, 0.22);
    float roughness = 0.94;
    vec3  turfN     = vec3(0.0, 0.0, 1.0);

    if (uHasTex > 0.5) {
      // Physically-scaled sampling: one tile = uTexMeters of real ground.
      vec2 uvA = vWorldPos.xz / uTexMeters;
      vec2 uvB = vWorldPos.xz / (uTexMeters * 7.31) + vec2(0.41, 0.23);
      float lodFade = smoothstep(45.0, 190.0, dist);

      // The anti-tiling blend was averaging in a second sample at 30% even with
      // the camera on the deck. Averaging two samples of the same texture is a
      // blur: it halves the variance of whatever it mixes in, which is exactly
      // the "dull" look. Two changes — the close-range weight drops to 0.10, and
      // the contrast the average destroyed is restored analytically. For a mix
      // of weight k between two uncorrelated samples the standard deviation
      // falls by sqrt(1-2k+2k*k), so dividing the deviation-from-mean by that
      // factor puts the micro-contrast back without touching the mean.
      vec3 cA = texture2D(uGrassCol, uvA).rgb;
      vec3 cB = texture2D(uGrassCol, uvB).rgb;
      float kBlend  = 0.10 + lodFade * 0.55;
      vec3  turfCol = mix(cA, (cA + cB) * 0.5, kBlend);
      float vRestore = inversesqrt(max(1.0 - 2.0*kBlend + 2.0*kBlend*kBlend, 0.25));
      vec3  cMean   = (cA + cB) * 0.5;
      turfCol = clamp(cMean + (turfCol - cMean) * vRestore, 0.0, 1.0);

      // Detail octave. The 1024 tile at uTexMeters gives roughly 7 texels per
      // centimetre, so an individual blade is a few pixels wide and mips to mush
      // within a few metres. A finer sample carrying luminance only adds blade
      // definition close up without introducing a second colour tile, and is
      // faded out well before it could alias.
      float dNear = 1.0 - smoothstep(3.0, 16.0, dist);
      if (dNear > 0.004) {
        vec2  uvD = vWorldPos.xz / (uTexMeters * 0.29) + vec2(0.17, 0.63);
        vec3  cD  = texture2D(uGrassCol, uvD).rgb;
        float lD  = dot(cD, vec3(0.2126, 0.7152, 0.0722));
        float lC  = dot(turfCol, vec3(0.2126, 0.7152, 0.0722));
        turfCol   = clamp(turfCol * (1.0 + (lD - lC) * 0.85 * dNear), 0.0, 1.0);
      }

      albedo = turfCol * mix(0.88, 1.06, isEven);
      // Unmown areas get stronger, coarser colour variation than the pitch
      float health = fbm(vWorldPos.xz * 0.012 + 41.0);
      float rough2 = fbm(vWorldPos.xz * 0.055 + 13.0);
      albedo *= mix(0.94, 1.06, health);
      albedo *= mix(1.0, mix(0.82, 1.12, rough2), 1.0 - uChevron);

      float rTex = texture2D(uGrassRgh, uvA).r;
      roughness  = 0.88 + rTex * 0.11;
      roughness  = mix(roughness, 0.55, uWetness * 0.7);

      vec3 nA = texture2D(uGrassNrm, uvA).rgb * 2.0 - 1.0;
      if (dNear > 0.004) {
        // Matching fine-scale relief, so the blades the detail octave draws are
        // lit as relief rather than painted on.
        vec2 uvDN = vWorldPos.xz / (uTexMeters * 0.29) + vec2(0.17, 0.63);
        vec3 nD   = texture2D(uGrassNrm, uvDN).rgb * 2.0 - 1.0;
        nA.xy    += nD.xy * 0.55 * dNear;
      }
      turfN   = normalize(mix(nA, vec3(0.0,0.0,1.0), lodFade));

      // Was 0.45. The AO map is a full multiply on albedo and grass AO is deep;
      // combined with the blur above it was flattening the tonal range twice.
      albedo *= mix(1.0, texture2D(uGrassAO, uvA).r, 0.32);
    } else {
      float bn = noise(vec2(wx*7.5, wz*7.5));
      float bs = noise(vec2(wx*26.0 + wz*4.0, wz*3.0));
      albedo *= 0.80 + (bn*0.55 + bs*0.45) * 0.40;
      albedo  = mix(albedo * 0.86, albedo * 1.10, isEven);
    }

    // ── WIND GUSTS ACROSS THE SURFACE ────────────────────────────────────
    // Blades bending away from the viewer expose their paler undersides, so a
    // gust reads as a light band travelling over the turf. Two waves at
    // different speeds and angles keep it from looking like a scrolling stripe.
    if (uWindStr > 0.01) {
      float g1 = sin(dot(vWorldPos.xz, vec2(0.055, 0.031)) - uTime * 1.25);
      float g2 = sin(dot(vWorldPos.xz, vec2(-0.026, 0.048)) - uTime * 0.83 + 1.7);
      float turb = fbm(vWorldPos.xz * 0.05 + uTime * 0.06) - 0.5;
      float gust = (g1 * 0.6 + g2 * 0.4 + turb * 0.7) * 0.5 + 0.5;
      gust = smoothstep(0.35, 0.95, gust);
      albedo *= 1.0 + gust * 0.13 * uWindStr;
      albedo  = mix(albedo, albedo * vec3(1.04, 1.06, 0.94), gust * 0.35 * uWindStr);
      roughness += gust * 0.03 * uWindStr;
    }

    // ── GOAL-MOUTH WEAR (dirt showing through worn turf) ─────────────────
    if (uWear > 0.5) {
      // Two ellipses at the goal mouths, plus scuffing along the centre line.
      float g1 = length(vec2((wx + 137.0) / 26.0, wz / 15.0));
      float g2 = length(vec2((wx - 137.0) / 26.0, wz / 15.0));
      float goalWear = max(1.0 - smoothstep(0.35, 1.0, g1), 1.0 - smoothstep(0.35, 1.0, g2));
      float centreWear = (1.0 - smoothstep(0.0, 22.0, abs(wx))) * (1.0 - smoothstep(0.0, 46.0, abs(wz))) * 0.45;
      float patchy = fbm(vWorldPos.xz * 0.09 + 7.3);
      float wear = clamp((max(goalWear, centreWear) * 1.25) * (0.45 + patchy * 0.9), 0.0, 1.0);
      wear = smoothstep(0.18, 0.92, wear);

      vec3  dirtCol = vec3(0.42, 0.26, 0.15);
      float dirtRgh = 0.97;
      if (uHasDirt > 0.5) {
        vec2 duv = vWorldPos.xz / (uTexMeters * 1.5);
        dirtCol = texture2D(uDirtCol, duv).rgb;
        dirtRgh = 0.90 + texture2D(uDirtRgh, duv).r * 0.09;
        vec3 dn = texture2D(uDirtNrm, duv).rgb * 2.0 - 1.0;
        turfN = normalize(mix(turfN, dn, wear));
      }
      // Thinning turf first, then bare earth
      albedo    = mix(albedo, albedo * vec3(0.86, 0.80, 0.62), min(wear * 1.6, 1.0));
      albedo    = mix(albedo, dirtCol, wear * 0.88);
      roughness = mix(roughness, dirtRgh, wear);
    }

    // ── PITCH MARKINGS — PAINTED INTO THE TURF ───────────────────────────
    // Not a white rectangle laid over the grass. Line marking paint coats the
    // blades: it desaturates and lifts them toward white while the underlying
    // blade texture, shadow and clumping all still read through. So we keep the
    // sampled luminance and push chroma out, exactly like a screen/overlay
    // blend rather than a flat fill.
    if (uMarkings > 0.5) {
      float lw = 0.22;
      float centreLine = sdLine(wx, lw);
      float yl1 = sdLine(abs(wx) - (137.0 - 27.4), lw);
      float yl2 = sdLine(abs(wx) - (137.0 - 36.6), lw);
      float yl3 = sdLine(abs(wx) - (137.0 - 54.9), lw);
      float gl  = sdLine(abs(wx) - 137.0, 0.30);
      float sl  = sdLine(abs(wz) - 73.0,  lw);
      float lines = max(max(max(max(centreLine, yl1), max(yl2, yl3)), gl), sl);

      float arc1 = sdLine(length(vec2(wx - 137.0, wz)) - 36.0, lw);
      float arc2 = sdLine(length(vec2(wx + 137.0, wz)) - 36.0, lw);
      float inField = step(abs(wx), 137.0) * step(abs(wz), 73.0);
      lines = max(lines, max(arc1, arc2) * inField);

      // Paint is worn and re-applied — it is never perfectly opaque or straight.
      float paintWear = 0.62 + fbm(vWorldPos.xz * 1.6) * 0.55;
      float paint = clamp(lines * paintWear, 0.0, 1.0);

      if (paint > 0.001) {
        float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
        // Desaturate toward the blade's own luminance, then lift to chalk white.
        vec3 painted = mix(vec3(lum), vec3(0.96, 0.95, 0.91), 0.86);
        // Re-apply the texture's own light/dark variation over the paint so the
        // blade structure stays visible through it.
        painted *= (0.74 + lum * 1.05);
        albedo    = mix(albedo, painted, paint * 0.90);
        roughness = mix(roughness, 0.80, paint * 0.6);
      }
    }

    // ── BLADE TIPS ───────────────────────────────────────────────────────
    albedo *= 1.0 + (vBladeTop * vBladeTop * 0.10) * 0.35;

    vec3 N = vNormal;
    if (uHasTex > 0.5) N = normalize(vNormal + vec3(turfN.x, 0.0, turfN.y) * 0.45);

    // ── LIGHTING: diffuse-dominant, grass is near-matte ──────────────────
    vec3 L = normalize(uSunDir);
    vec3 V = normalize(cameraPosition - vWorldPos);
    vec3 H = normalize(L + V);

    float backLit = max(dot(V, -L), 0.0);
    float sss     = pow(backLit, 3.0) * 0.22;
    vec3  sssCol  = vec3(0.58, 0.88, 0.34);
    float wrapped = max((dot(N, L) + 0.30) / 1.30, 0.0);
    // Roughness sits at 0.88-0.99, so (1.0 - roughness) was scaling this to
    // between 0.001 and 0.017 — effectively no specular at all. Real turf under
    // Lagos sun has a definite sheen off the blade faces. Tightened and lifted,
    // but deliberately kept small: strength 1.9 normals plus roughness 0.5 is
    // what turned this grass into an oil slick once already.
    float spec    = pow(max(dot(H, N), 0.0), 34.0) * (0.09 + (1.0 - roughness) * 0.9) * 0.30;

    float sheen = 0.0;
    if (uSheen > 0.5) {
      vec3 mowDir = normalize(vec3(0.7071, 0.0, 0.7071));
      sheen = pow(max(dot(V, mowDir), 0.0), 14.0) * 0.05;
    }

    vec3 skyAmb = albedo * vec3(0.36, 0.42, 0.39);
    vec3 color  = albedo * uSunColor * wrapped * 1.10
                + sssCol * albedo * sss * uSunColor
                + vec3(spec + sheen) * uSunColor
                + skyAmb;

    float lum2 = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, albedo * 0.42, max(0.0, 0.26 - lum2));

    gl_FragColor = vec4(color, 1.0);
  }
`;

// Build a turf material. Every instance shares the same world-space grid, so
// separate meshes tile seamlessly into one another with no visible join.
function makeTurfMaterial(opts) {
  opts = opts || {};
  _loadTurfTextures();
  const fast = PERF_MODE === 'fast';
  const mat = new THREE.ShaderMaterial({
    vertexShader: TURF_VERT,
    fragmentShader: TURF_FRAG,
    uniforms: {
      uTime:      { value: 0.0 },
      uSunDir:    { value: new THREE.Vector3(120, 220, 100).normalize() },
      uSunColor:  { value: new THREE.Color(0xfff4e0) },
      uWetness:   { value: 0.0 },
      uSheen:     { value: fast ? 0.0 : 1.0 },
      uBladeStr:  { value: fast ? 0.0 : 1.0 },
      // 2.0m per tile put a blade at ~5 texels. 1.45 raises texel density 38%
      // at no memory cost — the tiling is explicit in the shader, so this is
      // purely how much ground one tile covers.
      uTexMeters: { value: opts.texMeters !== undefined ? opts.texMeters : 1.45 },
      uHasTex:    { value: TURF_TEX.ready >= 2 ? 1.0 : 0.0 },
      uHasDirt:   { value: TURF_TEX.dirtCol ? 1.0 : 0.0 },
      uMarkings:  { value: opts.markings ? 1.0 : 0.0 },
      uChevron:   { value: opts.chevron  ? 1.0 : 0.0 },
      uWear:      { value: opts.wear     ? 1.0 : 0.0 },
      uWindStr:   { value: opts.wind !== undefined ? opts.wind : 1.0 },
      uGrassCol:  { value: TURF_TEX.col }, uGrassNrm: { value: TURF_TEX.nrm },
      uGrassRgh:  { value: TURF_TEX.rgh }, uGrassAO:  { value: TURF_TEX.ao  },
      uDirtCol:   { value: TURF_TEX.dirtCol }, uDirtNrm: { value: TURF_TEX.dirtNrm },
      uDirtRgh:   { value: TURF_TEX.dirtRgh },
    },
  });
  _turfMaterials.push(mat);
  return mat;
}

// Convenience: a turf-covered plane with segment density scaled to its size.
function turfPlane(w, d, pos, opts) {
  // Segment spacing must stay near blade scale or the vertex stage cannot
  // produce per-blade displacement and the surface reads as flat bright green.
  const per = PERF_MODE === 'fast' ? 3.0 : PERF_MODE === 'balanced' ? 1.8 : 1.25;
  const sx = Math.max(8, Math.min(220, Math.round(w / per)));
  const sz = Math.max(8, Math.min(220, Math.round(d / per)));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d, sx, sz), makeTurfMaterial(opts));
  m.rotation.x = -Math.PI / 2;
  m.position.set(pos[0], pos[1], pos[2]);
  m.receiveShadow = true;
  return m;
}

function addPoloField() {
  const segsX = PERF_MODE === 'fast' ? 64  : PERF_MODE === 'balanced' ? 128 : 182;
  const segsZ = PERF_MODE === 'fast' ? 34  : PERF_MODE === 'balanced' ?  68 :  97;
  const mat  = makeTurfMaterial({ markings:true, chevron:true, wear:true, wind:1.0 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(274, 146, segsX, segsZ), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0.12, 0);
  mesh.receiveShadow = true;
  mesh.name = 'poloField';
  scene.add(mesh);
  _terrainMeshes.push(mesh);
  window._xixFieldMat = mat;   // weather + time systems drive this
}

function addSafetyZone() {
  // Compacted laterite run-off around the pitch, using the real dirt PBR set.
  // Tiling uses the SAME physical logic as the turf: one tile = 3m of ground.
  // MeshStandardMaterial does receive Three.js's uv-transform, so .repeat works
  // here — but it must be computed per-plane from that plane's real dimensions,
  // otherwise each strip stretches differently.
  const TILE_M = 3.0;
  const L = new THREE.TextureLoader();
  const base = { col:null, nrm:null, rgh:null };

  const mkMat = (w, d) => {
    const m = new THREE.MeshStandardMaterial({
      color: 0xC4724A, roughness: 0.96, metalness: 0.0, envMapIntensity: 0.05,
    });
    const fit = (t, srgb) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(w / TILE_M, d / TILE_M);   // physical, per-plane
      t.anisotropy = PERF_MODE === 'rich' ? 16 : 8;
      return t;
    };
    L.load('assets/textures/dirt-color.png',
      t => { m.map = fit(t, true); m.color.set(0xffffff); m.needsUpdate = true; },
      undefined, () => {});
    L.load('assets/textures/dirt-normal.png',
      t => { m.normalMap = fit(t, false); m.normalScale = new THREE.Vector2(1.1, 1.1); m.needsUpdate = true; },
      undefined, () => {});
    L.load('assets/textures/dirt-roughness.png',
      t => { m.roughnessMap = fit(t, false); m.needsUpdate = true; },
      undefined, () => {});
    return m;
  };

  s(plane(298, 25, mkMat(298, 25), [0, .11, -85.5]));
  s(plane(298, 25, mkMat(298, 25), [0, .11,  85.5]));
  s(plane(11, 146, mkMat(11, 146), [-142.5, .11, 0]));
  s(plane(11, 146, mkMat(11, 146), [ 142.5, .11, 0]));
}

function addYardMarkings() {
  // Yard lines and goal lines are now rendered inside the polo field fragment shader.
  // Only the physical goal posts remain as geometry (6 posts, 1 instanced draw call).
  const postPositions = [];
  for (const gx of [-137, 137]) {
    for (const pz of [0, -7.3, 7.3]) {
      postPositions.push([gx, 1.5, pz]);
    }
  }
  buildInstancedFencePosts(postPositions);
}

function addRoads() {
  const tl = new THREE.TextureLoader();
  const aCol = tl.load('assets/textures/asphalt-color.png'); aCol.colorSpace = THREE.SRGBColorSpace;
  const aNrm = tl.load('assets/textures/asphalt-normal.png');
  const aRgh = tl.load('assets/textures/asphalt-roughness.png');
  
  [aCol, aNrm, aRgh].forEach(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(120, 120); 
  });

  const am = new THREE.MeshStandardMaterial({
    map: aCol,
    normalMap: aNrm,
    roughnessMap: aRgh,
    roughness: 0.92,      // Dry asphalt: very rough
    metalness: 0.0,
    envMapIntensity: 0.1, // Near-zero dry reflection
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  // Tag for weather system: rain reduces roughness → roads get specular puddle sheen
  am.userData.isRoadSurface = true;
  window._xixRoadMat = am;
  const Y = 0.13;
  
  s(plane(700, 30, am, [0, Y, 215])); 
  s(plane(700, 4, MATS.grassGreen(), [0, Y + 0.01, 215])); 
  
  s(plane(8, 220, am, [-155, Y, 0])); 
  s(plane(8, 220, am, [ 155, Y, 0])); 
  s(plane(320, 8, am, [0, Y, 104]));  
  s(plane(240, 8, am, [0, Y, -104])); 
  
  s(plane(8, 220, am, [-177, Y, -5])); 
  s(plane(8, 220, am, [ 177, Y, -5])); 
  
  s(plane(8, 280, am, [-270, Y, 20])); 
  s(plane(8, 200, am, [-230, Y, 10]));
  s(plane(150, 8, am, [-310, Y, 145]));
  
  s(plane(8, 250, am, [ 200, Y, 10]));
  s(plane(55, 8, am, [ 215, Y, 120]));
  
  s(plane(400, 8, am, [0, Y, 128])); 
  s(plane(130, 35, am, [0, Y, 148]));

  const cShape = new THREE.Shape();
  cShape.moveTo(-160, -104); 
  cShape.lineTo(-120, -104);
  cShape.quadraticCurveTo(0, -155, 120, -104);
  cShape.lineTo(160, -104);
  cShape.lineTo(160, -112);
  cShape.quadraticCurveTo(0, -163, -120, -112);
  cShape.lineTo(-160, -112);
  cShape.lineTo(-160, -104);

  const cGeo = new THREE.ShapeGeometry(cShape, 64);
  const cMesh = new THREE.Mesh(cGeo, am);
  cMesh.rotation.x = -Math.PI / 2; 
  cMesh.position.set(0, Y, 0);
  cMesh.receiveShadow = true;
  scene.add(cMesh);
}

function addLake() {
  // ══════════════════════════════════════════════════════════════════════
  //  CRESCENT LAKE — true planar reflection
  // ══════════════════════════════════════════════════════════════════════
  //  The GLSL version only faked sky colour via a uniform, so it never showed
  //  the actual sky, clouds, villas or palms. Three.js Water renders the scene
  //  into a reflection buffer each frame from the mirrored camera — a real
  //  reflection, correct for whatever the sky and buildings are doing.
  //
  //  The old crash came from feeding it stone-normal.png (wrong frequency, and
  //  a null .image during load). The normal map is now generated procedurally,
  //  so it is valid on frame one and has water-correct wave frequency.
  // ══════════════════════════════════════════════════════════════════════

  //  LAKE — narrowed and pulled toward the field.
  //  The far boundary is a quadratic Bezier, and the y value in the middle
  //  control point is NOT a point on the curve: with 92 / 102 / 135 the water
  //  actually reached z = -118.5, not -135. Rebuilt so the numbers mean what
  //  they look like, and so the villa arc has real room:
  //      near edge  z = -99    (was -92, now clear of the safety strip at -98)
  //      far  edge  z = -117.5 at centre, -109 at x = +-63
  //      half width x = +-70   (was +-80)
  //  That returns roughly 9-10 m of bank between the water and the villa
  //  footprints, where the old geometry left 3.
  const shape = new THREE.Shape();
  shape.moveTo(-65, 99);
  shape.lineTo(65, 99);
  shape.quadraticCurveTo(74, 99, 70, 107);
  shape.quadraticCurveTo(0, 128, -70, 107);
  shape.quadraticCurveTo(-74, 99, -65, 99);
  const waterGeo = new THREE.ShapeGeometry(shape, 80);

  // Procedural water normal map — low-frequency overlapping swells.
  const waterNormals = (() => {
    const S = 512, c = document.createElement('canvas');
    c.width = c.height = S;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S * Math.PI * 2, v = y / S * Math.PI * 2;
        // Sum of sines -> height field, then finite-difference the normal
        const h  = Math.sin(u*3)*0.5 + Math.sin(v*2.3+1.1)*0.4 + Math.sin((u+v)*4.7)*0.22;
        const hx = Math.sin((u+0.02)*3)*0.5 + Math.sin(v*2.3+1.1)*0.4 + Math.sin(((u+0.02)+v)*4.7)*0.22;
        const hy = Math.sin(u*3)*0.5 + Math.sin((v+0.02)*2.3+1.1)*0.4 + Math.sin((u+(v+0.02))*4.7)*0.22;
        const nx = (h - hx) * 6.0, ny = (h - hy) * 6.0, nz = 1.0;
        const len = Math.hypot(nx, ny, nz);
        const o = (y*S + x) * 4;
        img.data[o]   = ((nx/len)*0.5 + 0.5) * 255;
        img.data[o+1] = ((ny/len)*0.5 + 0.5) * 255;
        img.data[o+2] = ((nz/len)*0.5 + 0.5) * 255;
        img.data[o+3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();

  const resPerMode = { fast: 256, balanced: 512, rich: 1024 };
  const res = resPerMode[PERF_MODE] || 512;

  const lake = new Water(waterGeo, {
    textureWidth:  res,
    textureHeight: res,
    waterNormals,
    sunDirection: new THREE.Vector3(120, 220, 100).normalize(),
    sunColor:  0xfff4e0,
    waterColor: 0x184e63,     // Lagos lagoon teal
    distortionScale: 3.4,     // ripple visibility — 1.6 read as stagnant
    fog: scene.fog !== undefined,
    alpha: 0.94,
  });
  lake.rotation.x = -Math.PI / 2;
  lake.position.set(0, 0.34, 0);
  lake.name = 'crescentLake';
  lake.userData.isPlanarWater = true;
  scene.add(lake);
  waterMeshes.push(lake);
  window._xixLakeWater = lake;

  addLakeBanks();
}

// ══════════════════════════════════════════════════════════════════════════
//  LAKE BANKS
// ══════════════════════════════════════════════════════════════════════════
//  A hard line between turf and water reads as a swimming pool. Real banks
//  have a wet margin, reed beds, boulders and scattered planting. All of it
//  is instanced, so the whole shoreline costs 4 draw calls.
// ══════════════════════════════════════════════════════════════════════════
function addLakeBanks() {
  // Sample points along the lake's crescent edge
  const edge = [];
  const N = PERF_MODE === 'fast' ? 40 : PERF_MODE === 'balanced' ? 80 : 130;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // Outer curve: quadratic through (-80,102) -> (0,135) -> (80,102)
    const x = -80 + 160 * t;
    const z = 102 + 33 * Math.sin(Math.PI * t);
    edge.push([x, z]);
  }
  // Straight south shore
  for (let i = 0; i <= Math.floor(N * 0.7); i++) {
    edge.push([-75 + 150 * (i / Math.floor(N * 0.7)), 92]);
  }

  const rnd = (a, b) => a + Math.random() * (b - a);

  // ── 0. GRADED BANK — the ground descends into the water ─────────────────
  // A lake flush with flat ground reads as a puddle painted on a lawn. Three
  // concentric rings step down toward the waterline, each slightly lower and
  // darker, so the eye reads a real excavated basin with a shelving edge.
  const bankSteps = [
    { out: 11.0, y: 0.30, col: 0x5f6b3a, rough: 0.93 },  // dry upper bank
    { out:  6.5, y: 0.22, col: 0x555c33, rough: 0.90 },  // mid slope
    { out:  2.8, y: 0.13, col: 0x494327, rough: 0.72 },  // damp lower bank
  ];
  bankSteps.forEach(step => {
    const mat = new THREE.MeshStandardMaterial({
      color: step.col, roughness: step.rough, metalness: 0.0,
    });
    const geo = new THREE.CircleGeometry(step.out * 0.55, 8);
    const mesh = new THREE.InstancedMesh(geo, mat, edge.length);
    edge.forEach(([x, z], i) => {
      // Push each ring progressively outward from the waterline
      const nx = x * 0.012, nz = (z - 105) * 0.02;
      const len = Math.hypot(nx, nz) || 1;
      _dummy.position.set(
        x + (nx / len) * step.out * 0.42,
        step.y,
        z + (nz / len) * step.out * 0.42
      );
      _dummy.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
      _dummy.scale.setScalar(0.8 + Math.random() * 0.7);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  });

  // ── 1. WET MARGIN — damp, dark soil where water meets land ──────────────
  const marginMat = new THREE.MeshStandardMaterial({
    color: 0x4a4032, roughness: 0.55, metalness: 0.0,
  });
  const marginGeo = new THREE.CircleGeometry(3.4, 7);
  const margin = new THREE.InstancedMesh(marginGeo, marginMat, edge.length);
  edge.forEach(([x, z], i) => {
    _dummy.position.set(x + rnd(-1.2, 1.2), 0.16, z + rnd(-1.2, 1.2));
    _dummy.rotation.set(-Math.PI / 2, 0, rnd(0, Math.PI * 2));
    _dummy.scale.setScalar(rnd(0.7, 1.5));
    _dummy.updateMatrix();
    margin.setMatrixAt(i, _dummy.matrix);
  });
  margin.instanceMatrix.needsUpdate = true;
  margin.receiveShadow = true;
  scene.add(margin);

  // ── 2. REED BEDS — tall marginal planting, the signature of a real bank ──
  const reedMat = new THREE.MeshStandardMaterial({
    color: 0x5d7a34, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide,
  });
  const reedGeo = new THREE.ConeGeometry(0.16, 2.2, 4, 1, true);
  const reedCount = Math.floor(edge.length * (PERF_MODE === 'fast' ? 2 : 5));
  const reeds = new THREE.InstancedMesh(reedGeo, reedMat, reedCount);
  for (let i = 0; i < reedCount; i++) {
    const [ex, ez] = edge[Math.floor(Math.random() * edge.length)];
    const out = rnd(-2.0, 3.2);
    _dummy.position.set(ex + rnd(-2.5, 2.5), rnd(0.8, 1.5), ez + out);
    _dummy.rotation.set(rnd(-0.22, 0.22), rnd(0, Math.PI * 2), rnd(-0.22, 0.22));
    _dummy.scale.set(rnd(0.7, 1.5), rnd(0.7, 1.7), rnd(0.7, 1.5));
    _dummy.updateMatrix();
    reeds.setMatrixAt(i, _dummy.matrix);
  }
  reeds.instanceMatrix.needsUpdate = true;
  reeds.castShadow = PERF_MODE !== 'fast';
  scene.add(reeds);

  // ── 3. BOULDERS — irregular rock revetment holding the bank ─────────────
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x6b6459, roughness: 0.94, metalness: 0.0,
  });
  const rockGeo = new THREE.DodecahedronGeometry(1.0, 0);
  const rockCount = Math.floor(edge.length * 0.42);
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  for (let i = 0; i < rockCount; i++) {
    const [ex, ez] = edge[Math.floor(Math.random() * edge.length)];
    _dummy.position.set(ex + rnd(-3, 3), rnd(0.1, 0.5), ez + rnd(-1.5, 2.6));
    _dummy.rotation.set(rnd(0, 3.14), rnd(0, 6.28), rnd(0, 3.14));
    _dummy.scale.set(rnd(0.4, 1.3), rnd(0.3, 0.8), rnd(0.4, 1.3));
    _dummy.updateMatrix();
    rocks.setMatrixAt(i, _dummy.matrix);
  }
  rocks.instanceMatrix.needsUpdate = true;
  rocks.castShadow = PERF_MODE !== 'fast';
  rocks.receiveShadow = true;
  scene.add(rocks);

  // ── 4. SHRUB CLUMPS — low planting softening the turf-to-water line ─────
  const shrubMat = new THREE.MeshStandardMaterial({
    color: 0x35592a, roughness: 0.93, metalness: 0.0,
  });
  const shrubGeo = new THREE.IcosahedronGeometry(1.0, 0);
  const shrubCount = Math.floor(edge.length * 0.34);
  const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, shrubCount);
  for (let i = 0; i < shrubCount; i++) {
    const [ex, ez] = edge[Math.floor(Math.random() * edge.length)];
    _dummy.position.set(ex + rnd(-5, 5), rnd(0.5, 1.1), ez + rnd(1.5, 6.5));
    _dummy.rotation.set(0, rnd(0, 6.28), 0);
    _dummy.scale.set(rnd(0.9, 2.1), rnd(0.6, 1.3), rnd(0.9, 2.1));
    _dummy.updateMatrix();
    shrubs.setMatrixAt(i, _dummy.matrix);
  }
  shrubs.instanceMatrix.needsUpdate = true;
  shrubs.castShadow = PERF_MODE !== 'fast';
  scene.add(shrubs);
}

function addEastLake(){
  // East lake removed — was positioned in the paddock zone causing visual bleed
  // into villa hedge plots. The crescent lake to the north is the primary water feature.
}

function addClubhouse(){
  s(plane(55,28,MATS.roadAsph(),[-65,.13,128]));
  s(plane(55,28,MATS.roadAsph(),[65,.13,128]));
}

// ─── GLB LOADERS ──────────────────────────────────────────────────────────────

// INDEPENDENT LOADERS FIX: We removed the Singleton _sharedGLTFLoader pattern 
// so every model spawns its own Draco decoding connection. This stops the queue deadlock!
let _sharedGLTFLoader = null;
function makeDracoLoader() {
  // Was `new DRACOLoader()` + `new GLTFLoader()` on every call — one
  // instantiation per asset load, 14+ times across the estate. Each spins
  // up its own WASM decoder and worker pool; reused once here for the
  // lifetime of the page, exactly as the Three.js DRACOLoader docs specify.
  if (_sharedGLTFLoader) return _sharedGLTFLoader;
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/draco/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  _sharedGLTFLoader = loader;
  return loader;
}

function loadOneGLB(path,scale,yOff,onDone,onFail){
  makeDracoLoader().load(path,gltf=>{
    gltf.scene.scale.setScalar(scale);
    applyPS4Materials(gltf.scene);
    gltf.scene.traverse(child=>{ if(child.isMesh) child.frustumCulled=true; });
    const bbox=new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y=yOff+(bbox.min.y<0?-bbox.min.y:0);
    onDone(gltf.scene);
  },undefined,err=>{console.error("GLB failed:",path,err.message||err);if(onFail)onFail();});
}

function loadClubhouseGLB(){
  // Scale derived from GFA: 3,419 m² ÷ 3 floors = 1,140 m² footprint
  // Mesh W=1.9017 raw → 48.8 m world at aspect 2.09:1
  // Old scale 60.975 produced W=116m (6,437 m² footprint — 5.6× too large)
  loadOneGLB("assets/clubhouse-mesh.glb",25.657,0,tmpl=>{
    const g=new THREE.Group(); g.position.set(0,0,108); g.rotation.y=Math.PI;
    g.add(tmpl.clone(true)); scene.add(g);
    const bbox=new THREE.Box3().setFromObject(g); if(bbox.min.y<-0.5) g.position.y-=bbox.min.y;
  });
}

function loadStablesGLB() {
  loadOneGLB("assets/stables-mesh.glb", 18.846, 0, tmpl => {
    const g = new THREE.Group(); 
    g.position.set(-320, 0, 120); 
    g.add(tmpl.clone(true)); 
    scene.add(g);
  });
}

function loadVillaGLB(){
  makeDracoLoader().load("assets/villa-mesh.glb", gltf => {
    // GFA 330m² ÷ 3 floors → 11.4m wide at scale 5.71853
    gltf.scene.scale.setScalar(5.71853);
    // villa-mesh.glb ships with baked PBR maps (albedo / normal / metal-rough)
    // generated from its own atlas, so applyPS4Materials must NOT overwrite them
    // with procedural substitutes. It only tunes envMap and shadow flags here.
    applyPS4Materials(gltf.scene);
    gltf.scene.traverse(c => {
      if(c.isMesh){ 
        c.castShadow = false; // Villas: receive only — casting causes shadow acne at scale
        c.receiveShadow = true;
        c.frustumCulled = true;
      }
    });
    const bbox = new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y = bbox.min.y < 0 ? -bbox.min.y : 0;
    const wrapper = new THREE.Group(); 
    wrapper.add(gltf.scene); 
    villaGLBScene = wrapper;

    // Cache glass meshes for fast night-glow updates
    gltf.scene.traverse(c => {
      if (c.isMesh && c.userData.isGlassPanel) registerGlassMesh(c);
    });

    // Swap placeholders for real houses
    const queue = [...pendingVillas];
    pendingVillas = [];
    queue.forEach((data) => {
      if (data.placeholder) scene.remove(data.placeholder); // Remove the dummy box
      placeVillaGLBWithLOD(data.x, data.z, data.ry, data.plotKey); // Insert real GLB
    });

  }, null, err => {
    console.warn('[XIX] villa-mesh.glb failed, using fallbacks:', err);
    pendingVillas.forEach((data) => {
      if (data.placeholder) scene.remove(data.placeholder); // Clean up dummy
      const v = _createVillaFallback();
      v.position.set(data.x, 0, data.z);
      v.rotation.y = data.ry;
      scene.add(v);
    });
    pendingVillas = [];
  });
}

function loadApartmentGLB(){
  makeDracoLoader().load("assets/apartment-mesh.glb",gltf=>{
    gltf.scene.scale.setScalar(APT_SCALE);
    applyPS4Materials(gltf.scene);
    gltf.scene.traverse(c => { if(c.isMesh) c.frustumCulled = true; });
    const bbox=new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y=bbox.min.y<0?-bbox.min.y:0;
    const wrapper=new THREE.Group(); wrapper.add(gltf.scene); aptGLBScene=wrapper;
    const q=[...pendingApts]; pendingApts=[];
    q.forEach(({x,z,ry,plotKey})=>placeAptGLB(x,z,ry,plotKey));
  },null,err=>{
    console.warn('[XIX] apartment-mesh.glb failed:', err);
    const q=[...pendingApts]; pendingApts=[];
    q.forEach(({x,z})=>scene.add(_createFlatBlock(x,z)));
  });
}

function loadLoftGLB(){
  makeDracoLoader().load("assets/loft-mesh.glb",gltf=>{
    // GFA 125m² ÷ 2 floors → 9.1m wide at scale 4.79208
    gltf.scene.scale.setScalar(4.79208);
    applyPS4Materials(gltf.scene);
    const bbox=new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y=bbox.min.y<0?-bbox.min.y:0;
    const wrapper=new THREE.Group(); wrapper.add(gltf.scene); loftGLBScene=wrapper;
    pendingLofts.forEach(({x,z,ry})=>placeLoftGLB(x,z,ry)); pendingLofts=[];
  },null,err=>{pendingLofts.forEach(({x,z,ry})=>scene.add(_createLoftBlock(x,z,ry)));pendingLofts=[];});
}

function placeAptGLB(x,z,ry=0,plotKey=null){
  if(!aptGLBScene){pendingApts.push({x,z,ry,plotKey});return;}
  const clone=aptGLBScene.clone(true); clone.position.set(x,0,z); clone.rotation.y=ry; scene.add(clone);
  // These two instances previously got no overlay and no plotKey at all —
  // the actual placed buildings were invisible to getPlotAtRay, so hover
  // and click never worked no matter where the crosshair or cursor sat.
  // addPlotOverlay is the same call villas and lofts already use; only the
  // footprint size changes, since a 37x19m block needs a much larger
  // hit-plane than a single villa's 20x18.
  if (plotKey) addPlotOverlayCustom(x, z, ry, plotKey, clone, 40, 22);
}
function placeLoftGLB(x,z,ry,plotKey){
  ry=ry||0; if(!loftGLBScene){pendingLofts.push({x,z,ry,plotKey});return;}
  const clone=loftGLBScene.clone(true); clone.position.set(x,0,z); clone.rotation.y=ry; scene.add(clone);
  if (plotKey) addPlotOverlay(x, z, ry, plotKey, clone); 
}

// ─── PLOT OVERLAY ─────────────────────────────────────────────────────────────
function addPlotOverlay(x,z,ry,plotKey,villaClone){
  addPlotOverlayCustom(x, z, ry, plotKey, villaClone, 20, 18);
}
// Same registration, sizeable footprint — apartment blocks need a much
// larger hit-plane (37x19m) than a single villa's 20x18m default above.
function addPlotOverlayCustom(x,z,ry,plotKey,villaClone,w,d){
  const mat=MATS.plotAvail();
  const overlay=new THREE.Mesh(new THREE.PlaneGeometry(w,d),mat);
  overlay.rotation.x=-Math.PI/2; overlay.position.set(x,.25,z);
  overlay.renderOrder = 999;   // draw after opaque geometry regardless of depth
  overlay.userData.plotKey=plotKey; overlay.userData.isPlotOverlay=true; overlay.userData.villaClone=villaClone;
  scene.add(overlay);

  const existingData = plotRegistry.get(plotKey) || {};
  plotRegistry.set(plotKey, { ...existingData, status: "available", overlay, villaClone, x, z, ry });
}

// Selection used to slam material.opacity between 0 and 0.35 the instant the
// raycast changed, so the hologram snapped on and off and flickered whenever
// the ray grazed an edge between two plots. Two changes:
//   - the hard write becomes a TARGET that tickPlotHighlights eases toward, so
//     every appearance and disappearance is a short fade rather than a cut
//   - the eased value also drives a slow pulse, so a held selection breathes
//     instead of sitting inert
const _plotFade = new Map();
export function highlightPlot(plotKey){
  plotRegistry.forEach((plot,key)=>{
    if(!plot.overlay) return;
    const target = (key===plotKey && plot.status==='available') ? 0.38
                 : (plot.status==='reserved' ? 0.50 : 0.0);
    plot.overlay.userData._fadeTarget = target;
    if (!_plotFade.has(key)) _plotFade.set(key, plot.overlay.material.opacity || 0);
    if (target > 0) plot.overlay.visible = true;
  });
}

export function tickPlotHighlights(delta, elapsed){
  // Framerate-independent easing — a fixed per-frame lerp would fade at
  // different speeds on a 60 Hz phone and a 120 Hz one.
  const k = 1 - Math.exp(-11 * Math.min(delta, 0.05));
  const pulse = 1 + Math.sin(elapsed * 2.1) * 0.10;
  plotRegistry.forEach((plot,key)=>{
    const ov = plot.overlay; if(!ov || !ov.material) return;
    const target = ov.userData._fadeTarget ?? 0;
    let cur = _plotFade.get(key) ?? ov.material.opacity ?? 0;
    cur += (target - cur) * k;
    if (Math.abs(cur - target) < 0.002) cur = target;
    _plotFade.set(key, cur);
    ov.material.opacity = cur * (target > 0 ? pulse : 1);
    // Hidden once fully faded so it stops costing a transparent draw call.
    ov.visible = cur > 0.004;
  });
}

export function reservePlot(plotKey) {
  const plot = plotRegistry.get(plotKey); 
  if (!plot || plot.status === "reserved") return false;
  plot.status = "reserved";
  
  if (plot.villaClone) {
    plot.villaClone.traverse(c => {
      if (c.isMesh) {
        if (!c.userData.origMat) c.userData.origMat = c.material;
        c.material = new THREE.MeshBasicMaterial({
          color: 0xff2222, transparent: true, opacity: 0.5, wireframe: true
        });
      }
    });
  }
  
  if (plot.overlay) {
    plot.overlay.material.color.set(0xff2222);
    plot.overlay.material.opacity = 0;
  }
  
  plotRegistry.set(plotKey, plot); 
  if (typeof window.updatePlotBadge === 'function') window.updatePlotBadge(plotKey, "RESERVED");
  return true;
}

export function unreservePlot(plotKey) {
  const plot = plotRegistry.get(plotKey);
  if (!plot || plot.status !== "reserved") return false;
  plot.status = "available";
  
  if (plot.villaClone) {
    plot.villaClone.traverse(c => {
      if (c.isMesh && c.userData.origMat) {
        c.material = c.userData.origMat;
      }
    });
  }
  
  if (plot.overlay) {
    plot.overlay.material.color.set(0x00ff88);
    plot.overlay.material.opacity = 0;
  }
  
  plotRegistry.set(plotKey, plot);
  if (typeof window.updatePlotBadge === 'function') window.updatePlotBadge(plotKey, "AVAILABLE");
  return true;
}

export function getPlotAtRay(raycaster) {
  const targets = [];
  
  plotRegistry.forEach((plot, key) => {
    if (plot.overlay) {
      plot.overlay.material.opacity = 0.01;
      targets.push(plot.overlay);
    }
    if (plot.villaClone && plot.villaClone.visible) {
      plot.villaClone.traverse(c => {
        if (c.isMesh) {
          c.userData.plotKey = key;
          targets.push(c);
        }
      });
    }
  });
  
  const hits = raycaster.intersectObjects(targets, false);
  
  plotRegistry.forEach(plot => {
    if (plot.overlay && plot.status !== 'reserved') plot.overlay.material.opacity = 0;
  });
  
  if (hits.length > 0) return hits[0].object.userData.plotKey;
  return null;
}
// ─── VILLA RING ───────────────────────────────────────────────────────────────
const villaFootprints=[];
window._nextUnitId = 1; 

const NO_BUILD_ZONES=[[0,128,75,55],[-375,90,55,45],[-248,-25,50,22],[-248,55,50,22],
  [-390,0,65,100],[270,65,28,18],[218,0,28,28],[218,52,30,26],[0,0,140,76],[30,-115,105,18]];

function registerVillaFootprint(x, z, customId, type = "3 BED VILLA") {
  villaFootprints.push({cx:x, cz:z, r:12});
  if (customId) {
    plotRegistry.set(String(customId), { x, z, status: 'available', type: type });
  }
}

function isInNoBuildZone(x,z){
  for(const [cx,cz,hw,hd] of NO_BUILD_ZONES) if(Math.abs(x-cx)<=hw&&Math.abs(z-cz)<=hd) return true;
  for(const {cx,cz,r} of villaFootprints) if((x-cx)*(x-cx)+(z-cz)*(z-cz)<=r*r) return true;
  return false;
}

function addVillaRing(){
  const PLOT=28;
  const cypressPositions=[];
  
  function placeV(x,z,ry){
    const plotKey = String(window._nextUnitId++); 
    registerVillaFootprint(x, z, plotKey, "3 BED VILLA");
    placeVillaGLBWithLOD(x, z, ry, plotKey);
    addVillaContactShadow(x,z); 
    collectVillaHedge(x,z,ry); 
    const fx=Math.sin(ry)*(-9),fz=Math.cos(ry)*(-9),rx=Math.cos(ry)*8,rz=-Math.sin(ry)*8;
    if(!isInNoBuildZone(x+rx+fx,z+rz+fz)) cypressPositions.push([x+rx+fx,z+rz+fz]);
    if(!isInNoBuildZone(x-rx+fx,z-rz+fz)) cypressPositions.push([x-rx+fx,z-rz+fz]);
  }
  
  // South row: west and east sides — straight villas facing north
  [-86, -108, -130, -152].forEach(x => { placeV(x, -120, 0); });
  [86, 108, 130, 152].forEach(x => { placeV(x, -120, 0); });

  //  The arc sat 10-20 m outside the line the west and east columns hold, so
  //  it read as a separate row floating above the ring instead of part of it.
  //  Count and x positions are untouched — only the standoff changes, from
  //  -120/-138 to -118/-128, which is the flattest bow the lake still clears
  //  by a villa half-depth.
  for (let i = 0; i < 11; i++) {
    const t = 0.05 + (i / 10) * 0.90;
    const x = -70 + (t * 140);
    const z = -118 - Math.sin(t * Math.PI) * 10;
    placeV(x, z, Math.atan2(0 - x, -60 - z));
  }

  [-75, -47, -19].forEach(z => placeV(-162, z, Math.PI / 2));
  [19, 47, 75].forEach(z => placeV(-162, z, Math.PI / 2));
  //  SW / SE CORNER OVERLAP (rule 5). These sat 6.0 m from the outermost
  //  south-row villa — a hard clip against a 24 m footprint. The neighbours
  //  they sit between, (-162, 75) and (-149, 111), are only 38.3 m apart, so
  //  24 m to each is impossible; the midpoint is the maximum available and
  //  gives 19.2 m both ways. Anything better needs one of the two runs to
  //  give up a unit, which would break the 43 count.
  placeV(-155.5, 93, 3 * Math.PI / 4);

  [-75, -47, -19].forEach(z => placeV(162, z, -Math.PI / 2));
  [19, 47, 75].forEach(z => placeV(162, z, -Math.PI / 2));
  placeV(155.5, 93, -3 * Math.PI / 4);

  //  ORIENTATION BUG: these villas sit south of the field (z=+105) and used
  //  ry=0, which points the front toward +Z — further south, away from the
  //  field, toward the clubhouse. The mirror-image north row at z=-120 uses
  //  ry=0 correctly because +Z from there points INTO the field. South-side
  //  villas need the opposite heading, ry=Math.PI, so their front (+Z at
  //  ry=0) is rotated 180 degrees to point -Z: north, into the field.
  for(const side of [-1, 1]) {
    [65, 93, 121, 149].forEach(xa => {
      placeV(side * xa, 105 + xa * 0.04, Math.PI);
    });
  }

  // ── THE TWO MISSING CORNERS ──────────────────────────────────────────────
  //  This layout is yours and is otherwise untouched — the ring I derived from
  //  the field geometry dropped it to 30 units and is reverted.
  //
  //  It places 41. UNIT_SCHEDULE in data.js says 43 Premium Villas. The two
  //  that are absent are the north-west and north-east corners: the north
  //  flank run stops at x = +-152, z = -120 and the side columns start at
  //  x = +-162, z = -75, leaving a 46 m hole at each shoulder. The east end
  //  already has its pair at (+-148, 105). Filling both brings the count to
  //  exactly 43 and closes the gap that was reported.
  placeV(-158, -98,  Math.PI / 4);
  placeV( 158, -98, -Math.PI / 4);

  // The schedule is the source of truth for the count, so it is asserted here
  // rather than left to be discovered in a screenshot.
  const _built = villaFootprints.length;
  if (_built !== 43) console.warn(`[XIX] Villas: ${_built} placed, schedule says 43`);
  else console.log('[XIX] Villas: 43 placed, matches UNIT_SCHEDULE');

  buildInstancedCypress(cypressPositions);
  buildAllVillaHedges();
  loadLampMeshes();     // needs _hedgeInstData, so runs after hedges
}

function addLoftTerraces(){
  function placeLoftBlock(x, z, ry) {
    placeLoftGLB(x, z, ry, null); 
    const offsets = [-13.5, -4.5, 4.5, 13.5]; 
    const cosR = Math.cos(ry), sinR = Math.sin(ry);

    offsets.forEach(offsetX => {
      const unitX = x + offsetX * cosR;
      const unitZ = z - offsetX * sinR; 
      const key = String(window._nextUnitId++); 
      
      const hitbox = new THREE.Mesh(
        new THREE.BoxGeometry(9, 10, 16),
        new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0, depthWrite: false, depthTest: false })
      );
      hitbox.position.set(unitX, 5, unitZ); 
      hitbox.rotation.y = ry;
      hitbox.renderOrder = 999;
      hitbox.userData = { isPlotOverlay: true, plotKey: key };
      hitbox.visible = false; // Invisible — only used for raycasting, never rendered
      scene.add(hitbox);
      
      plotRegistry.set(key, { x: unitX, z: unitZ, status: 'available', overlay: hitbox, type: "2 BED LOFT TERRACE", ry: ry });
    });
  }

  for(let x=-310; x<=-110; x+=36){ 
    placeLoftBlock(x, -162-Math.abs(x)*.05, Math.PI); 
  }
  for(let x=95; x<=310; x+=36){ 
    placeLoftBlock(x, -162-Math.abs(x)*.05, Math.PI); 
  }
  
  [-75, -45, -15].forEach(z => { placeLoftBlock(-200, z, 0); });
  [15, 45, 75, 105].forEach(z => { placeLoftBlock(-200, z, 0); });

  //  x=165 collided with the east villa column at (162, -75) — only 3m of
  //  separation against a 12m villa radius, hence "intersecting with the
  //  villas." Realigned to x=275, matching the north row's own last block
  //  (the loop above stops at x=275, since 95+36*5=275 and the next step,
  //  311, exceeds the 310 cap) — this is the exact "last loft terrace on
  //  the north-east corner" the alignment was asked for. z stays entirely
  //  north of the paddock (zMin=-60) and clear of every villa z (-75 is the
  //  nearest, and this range stops at -85), so neither collision can recur.
  [-165, -145, -125, -105, -85].forEach(z => { placeLoftBlock(275, z, 0); });
}

function addWestCompound() {
  s(plane(120, 185, MATS.safetyBrown(), [-320, .06, 0])); 
  // West compound grass — ground shader handles laterite/grass boundary
  
  placeAptGLB(-245, -45, Math.PI / 2, 'APT-BLOCK-1');
  placeAptGLB(-245, 45,  Math.PI / 2, 'APT-BLOCK-2');

  for (let i = 0; i < 24; i++) {
    const key = String(window._nextUnitId++);
    plotRegistry.set(key, { status: 'available', type: '1 BED MAISONETTE', x: -245, z: 0, isApt: true });
  }
  
  for (let i = 0; i < 48; i++) {
    const key = String(window._nextUnitId++);
    plotRegistry.set(key, { status: 'available', type: '2 BED FLAT', x: -245, z: 0, isApt: true });
  }
  // APT-BLOCK-1/2 are populated by addPlotOverlayCustom once placeAptGLB
  // resolves; pre-seed the type here so a hover before the GLB loads still
  // shows sensible text instead of undefined.
  ['APT-BLOCK-1', 'APT-BLOCK-2'].forEach(k => {
    const existing = plotRegistry.get(k) || {};
    plotRegistry.set(k, { ...existing, type: '2 Bed Flat Block (24 units)' });
  });
  
  for (let i = 0; i < 12; i++) {
    const key = String(window._nextUnitId++);
    plotRegistry.set(key, { status: 'available', type: 'STUDIO', x: -245, z: 0, isApt: true });
  }
}

function addPaddock() {
  // Paddock grass — match ground shader inner zone colour
  const postPos = [];
  const xMin = 205, xMax = 275, zMin = -60, zMax = 0;
  for(let fz = zMin; fz <= zMax; fz += 5) { 
    postPos.push([xMin, 0.8, fz]); 
    postPos.push([xMax, 0.8, fz]); 
  }
  for(let fx = xMin; fx <= xMax; fx += 5) { 
    postPos.push([fx, 0.8, zMin]); 
    postPos.push([fx, 0.8, zMax]); 
  }
  buildInstancedFencePosts(postPos); 

  const rm = MATS.railWhite();
  s(box(0.08, 0.1, 60, rm, [xMin, 1.0, -30], 0, false)); 
  s(box(0.08, 0.1, 60, rm, [xMax, 1.0, -30], 0, false)); 
  s(box(70, 0.1, 0.08, rm, [240, 1.0, zMin], 0, false)); 
  s(box(70, 0.1, 0.08, rm, [240, 1.0, zMax], 0, false)); 
}

function addGamePark() {
  // Game park grass — ground shader handles this zone
  const cols = [0xe8602a, 0x2a88c8, 0xe8c82a, 0x4ac84a];
  for(let i = 0; i < 5; i++) {
    const h = 2.6 + i * 0.4;
    const mat = new THREE.MeshStandardMaterial({ color: cols[i % 4], roughness: 0.6 });
    s(box(3.2, h, 3.2, mat, [220 + i * 10, h / 2, 40 + (i % 2 === 0 ? -10 : 10)]));
  }
}

function addCommercialBlock() {
  const g = new THREE.Group(); 
  g.position.set(240, 0, 110);
  g.add(box(42, 9, 26, MATS.flatGrey(), [0, 4.5, 0]));
  g.add(box(0.4, 8.5, 22, MAT_GLASS(0.5), [-21.2, 4.5, 0]));
  scene.add(g);
}

function addServiceCompound(){
  s(box(16,5.0,13,new THREE.MeshStandardMaterial({color:0xcc2200,roughness:.7}),[-270,2.5,95]));
  s(box(30,6,17,MATS.flatGrey(),[-240,3,100]));
}

function addLandscaping(){
  const palmDefs=[];
  function queuePalm(x,y,z,scale=1){
    if(isInNoBuildZone(x,z)) return;
    palmDefs.push({x,y,z,scale,randH:Math.random()*5});
  }
  for(let x=-280;x<=280;x+=28){queuePalm(x,.1,206,1.3);queuePalm(x,.1,224,1.2);}
  for(let z=-95;z<=95;z+=40){queuePalm(-160,.1,z,1.1);queuePalm(160,.1,z,1.1);}
  for(const pz of[95,103,111,119]){queuePalm(-16,.1,pz,1.2);queuePalm(16,.1,pz,1.2);}
  buildPalmInstances(scene, palmDefs);
}

function _createVillaFallback(){
  const g=new THREE.Group();
  g.add(box(16,2.1,13,new THREE.MeshStandardMaterial({color:0xb0a898,roughness:.8}),[0,1.05,0]));
  g.add(box(16,5.8,13,new THREE.MeshStandardMaterial({color:0xF5E6B0,roughness:.75}),[0,5.15,0]));
  const rm2=new THREE.Mesh(new THREE.ConeGeometry(12,3.5,4),MATS.villaRoof());
  rm2.position.set(0,9.85,0); rm2.rotation.y=Math.PI/4; g.add(rm2); return g;
}

function _createLoftBlock(x,z,ry){
  const g=new THREE.Group(); g.position.set(x,0,z); g.rotation.y=ry;
  const TW=40;
  // Explicit colours — no texture dependency, no blue fallback
  const stoneBase = new THREE.MeshStandardMaterial({color:0x9a8a78,roughness:.92,metalness:0});
  const renderBody = new THREE.MeshStandardMaterial({color:0xE8E0D0,roughness:.85,metalness:0});
  const timberRoof = new THREE.MeshStandardMaterial({color:0x7a6848,roughness:.70,metalness:0});
  g.add(box(TW,3.2,11,stoneBase,[0,1.6,0]));
  g.add(box(TW,3.2,11,renderBody,[0,4.85,0]));
  g.add(box(TW+.4,.4,11.4,timberRoof,[0,6.65,0],0,false)); return g;
}

function _createFlatBlock(x,z){
  const g=new THREE.Group(); g.position.set(x,0,z);
  g.add(box(80,20,28,MATS.flatGrey(),[0,10,0])); scene.add(g); return g;
}

// ─── TICK ─────────────────────────────────────────────────────────────────────
let _tickFrame=0;
let _prevElapsed=0;

let _lastTickT = 0;
export function setTargetYaw(yaw) {
  if(typeof window._xixSetTargetYaw==='function')window._xixSetTargetYaw(yaw);
}
export function tickScene(elapsed, camera) {
  _tickFrame++;
  const _dt = Math.min(Math.max(elapsed - _lastTickT, 0), 0.05); _lastTickT = elapsed;

  // Main camera opts in to the hotspot layer; the lake's reflection camera
  // never does. Idempotent, so it is safe to reassert in case a cinematic or
  // aerial transition swapped the camera out.
  if (camera && !camera.layers.isEnabled(HOTSPOT_LAYER)) camera.layers.enable(HOTSPOT_LAYER);
  tickLampPool(camera);
  tickPlotHighlights(_dt, elapsed);
  tickAmbientHorses(_dt);

  // ── a. GLASS SUN GLINT — update emissiveIntensity on glass panels ──────────
  // Every 20 frames — cheap traverse, avoids full scene walk every frame
  if (_tickFrame % 20 === 0 && scene && window._xixSunGlintIntensity !== undefined) {
    const targetGlint = window._xixSunGlintIntensity;
    scene.traverse(obj => {
      if (!obj.isMesh || !obj.userData.isGlassPanel) return;
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      if (mat && mat.emissiveIntensity !== undefined) {
        // Smooth lerp toward target — no harsh snap when time changes
        mat.emissiveIntensity += (targetGlint - mat.emissiveIntensity) * 0.05;
        mat.needsUpdate = false; // emissiveIntensity is a uniform, no rebuild needed
      }
    });
  }

  // ── b. POLO FIELD SHADER UNIFORMS ────────────────────────────────────────
  if (_turfMaterials.length) {
    const fast = PERF_MODE === 'fast';
    for (let i = 0; i < _turfMaterials.length; i++) {
      const u = _turfMaterials[i].uniforms;
      u.uTime.value      = elapsed;
      u.uSheen.value     = fast ? 0.0 : 1.0;
      u.uBladeStr.value  = fast ? 0.0 : 1.0;
      if (sunLight) {
        u.uSunColor.value.copy(sunLight.color);
        u.uSunDir.value.copy(sunLight.position).normalize();
      }
      if (window._xixWetness !== undefined) {
        u.uWetness.value += (window._xixWetness - u.uWetness.value) * 0.04;
      }
      if (window._xixWindStr !== undefined) {
        u.uWindStr.value += (window._xixWindStr - u.uWindStr.value) * 0.03;
      }
    }
  }

  // ── b. CAMERA-FOLLOWING SHADOW FRUSTUM (Balanced/Rich, every 30 frames) ──
  // Keeps shadows sharp around the player instead of across the whole 760m estate.
  // Uses lerp to avoid any visible shadow pop between updates.
  if (sunLight && sunLight.castShadow && camera && _tickFrame % 30 === 0) {
    const cam  = sunLight.shadow.camera;
    const px   = camera.position.x;
    const pz   = camera.position.z;
    const half = PERF_MODE === 'rich' ? 120 : 100;
    const L = 0.06; // lerp factor — smooth drift, no snap
    cam.left   += (px - half - cam.left)   * L;
    cam.right  += (px + half - cam.right)  * L;
    cam.bottom += (pz - half - cam.bottom) * L;
    cam.top    += (pz + half - cam.top)    * L;
    cam.updateProjectionMatrix();
  }

  // ── c. WET ROAD SPECULAR (every 12 frames) ──────────────────────────────
  if (window._xixRoadMat && _tickFrame % 12 === 0 && window._xixWetness !== undefined) {
    const wetness = window._xixWetness ?? 0;
    const rm = window._xixRoadMat;
    // Wet roads: roughness drops from 0.92 (dry) to 0.18 (soaked) — mirror-like puddles
    rm.roughness       = 0.92 - wetness * 0.74;
    rm.metalness       = wetness * 0.12;     // slight metallic sheen when wet
    rm.envMapIntensity = wetness * 1.8;      // strong sky reflection in puddles
    rm.needsUpdate     = false;              // uniforms only, no shader rebuild
  }

  // ── d. GROUND UNIFORMS ───────────────────────────────────────────────────
  if (window._xixGroundMat && _tickFrame % 4 === 0) {
    const gu = window._xixGroundMat.uniforms;
    gu.uTime.value = elapsed;
    if (sunLight) {
      gu.uSunDir.value.copy(sunLight.position).normalize();
      gu.uSunColor.value.copy(sunLight.color);
    }
  }

  // ── d. WATER ─────────────────────────────────────────────────────────────
  // The GLSL lake material was replaced by Three.js Water (true planar
  // reflection), which owns its own uniforms — only 'time' needs advancing.
  // Sun direction is refreshed on time-of-day change rather than per frame.

  // Three.js Water: advance time, and drift the normal map so ripples travel
  // across the surface instead of shimmering in place (which reads as stagnant).
  if (window._xixLakeWater) {
    const wu = window._xixLakeWater.material.uniforms;
    if (wu['time']) wu['time'].value += 1.6 / 60.0;
    const wn = wu['normalSampler'] && wu['normalSampler'].value;
    if (wn && wn.offset) {
      wn.offset.x = (elapsed * 0.014) % 1.0;
      wn.offset.y = (elapsed * 0.0085) % 1.0;
    }
  }
  tickWater(waterMeshes.filter(m => !m.userData.isPlanarWater), elapsed);

  waterMeshes.forEach(m => {
    if (m.userData.isPlanarWater && m.material.uniforms && m.material.uniforms['time']) {
      m.material.uniforms['time'].value += 1.0 / 60.0;
    }
  });

  tickGrass(camera);

  const palmDiv = PERF_SETTINGS[PERF_MODE].palmTickDiv;
  if (_tickFrame % palmDiv === 0) {
    tickPalms(camera);
  }

  tickHotspots(elapsed);

  const _frameDelta = Math.min(elapsed - (_prevElapsed || 0), 0.033);
  _prevElapsed = elapsed;

  tickNPCHorses(_frameDelta);
  if (_tourActive) tickTour(_frameDelta, camera);
}

export function getRenderer()   { return renderer;   }
export function getScene()      { return scene;      }
export function getCamera()     { return camera;     }
export function getClock()      { return clock;      }
export function getHorseGroup() { return horseGroup; }

// ─── PHASE 2: HOVER VISUALS (GREEN HOLOGRAM) ────────────────────────────────
window._xixHoverState = null;

window.setHoveredPlot = function(plotKey) {
  if (window._aerialModeActive || window._xixHoverState === plotKey) return;
  
  if (window._xixHoverState) {
    const old = plotRegistry.get(window._xixHoverState);
    if (old && old.villaClone && old.status !== 'reserved') {
      old.villaClone.traverse(c => {
        if (c.isMesh && c.userData.origMat) {
          c.material = c.userData.origMat; 
          c.userData.origMat = null;
        }
      });
    }
  }
  
  window._xixHoverState = plotKey;
  
  if (window._xixHoverState) {
    const cur = plotRegistry.get(window._xixHoverState);
    if (cur && cur.villaClone && cur.status !== 'reserved') {
      cur.villaClone.traverse(c => {
        if (c.isMesh) {
          if (!c.userData.origMat) c.userData.origMat = c.material;
          c.material = c.userData.origMat.clone();
          c.material.emissive.setHex(0x22cc44);
          c.material.emissiveIntensity = 0.35;
        }
      });
    }
  }
};

// ─── PHASE 3: PROCEDURAL 3D INTERIOR ENGINE ─────────────────────────────────
window._xixInteriorGroup = null;
window._xixInteriorPlotKey = null;

window.triggerInteriorBuild = function(plotKey) {
  console.info('[XIX] triggerInteriorBuild suppressed');
  return;
  const plot = plotRegistry.get(plotKey);
  if (!plot) return;

  if (window._xixInteriorGroup) scene.remove(window._xixInteriorGroup);
  // Loft units register an invisible raycast hitbox and NO villaClone, so this
  // used to leave the real block standing and drop the shell through it.
  window._xixInteriorHidden = [];
  [plot.villaClone, plot.overlay && plot.overlay.userData.villaClone, plot.lod]
    .forEach(o => { if (o && o.visible) { o.visible = false; window._xixInteriorHidden.push(o); } });
  window._xixInteriorPlotKey = plotKey;

  window._xixInteriorGroup = new THREE.Group();
  window._xixInteriorGroup.position.set(plot.x, 0, plot.z);
  window._xixInteriorGroup.rotation.y = plot.ry;

  const floorMat = new THREE.MeshStandardMaterial({ color: 0xeae6dc, roughness: 0.7 }); 
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }); 
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xccddff, transparent: true, opacity: 0.25, roughness: 0.1, metalness: 0.8 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xb58e65, roughness: 0.5 }); 

  //  LEVELS. L1 is the two-car undercroft the villa actually has. The previous
  //  build started at L2 = 2.85 and put NOTHING beneath it, which is exactly
  //  why the walkthrough shell hung in mid-air with a clear gap under it.
  const L1_Y = 0.15; const L2_Y = 2.85; const L3_Y = 6.15; const CEIL_H = 3.3;

  window._xixInteriorGroup.userData.levels = [
    { n:1, y:L1_Y, eye:L1_Y+1.65, label:'Undercroft & Entry' },
    { n:2, y:L2_Y, eye:L2_Y+1.65, label:'Living & Dining'    },
    { n:3, y:L3_Y, eye:L3_Y+1.65, label:'Master Bedroom'     },
  ];

  // ── LEVEL 1 — on the ground ──────────────────────────────────────────────
  const screedMat = new THREE.MeshStandardMaterial({ color: 0x9a958c, roughness: 0.92 });
  window._xixInteriorGroup.add(box(17.5, 0.30, 14.5, screedMat, [0, L1_Y-0.15, 0], 0, false));
  // Piloti carrying the first-floor slab. Without them the eye has nothing to
  // explain how the upper storeys stand up, which is most of why the old build
  // read as a naked shell rather than a house.
  [[-6.6,-4.8],[-6.6,4.8],[6.6,-4.8],[6.6,4.8],[0,-4.8],[0,4.8]].forEach(([cx,cz]) => {
    window._xixInteriorGroup.add(box(0.42, L2_Y-L1_Y, 0.42, wallMat, [cx,(L1_Y+L2_Y)/2,cz]));
  });
  window._xixInteriorGroup.add(box(16, L2_Y-L1_Y, 0.4, wallMat, [0,(L1_Y+L2_Y)/2,-6.3]));
  window._xixInteriorGroup.add(box(0.3, L2_Y-L1_Y, 5.0, wallMat, [4.6,(L1_Y+L2_Y)/2,-3.6]));
  for (let i = 0; i < 4; i++)
    window._xixInteriorGroup.add(box(3.2, 0.18, 0.34, screedMat, [4.0, L1_Y+0.09+i*0.18, 5.4-i*0.34], 0, false));
  const bayMat = new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.95 });
  [-3.4,-0.2].forEach(bx => window._xixInteriorGroup.add(box(0.08,0.02,5.0,bayMat,[bx,L1_Y+0.02,1.2],0,false)));

  // ── LEVEL 2 ──────────────────────────────────────────────────────────────
  window._xixInteriorGroup.add(box(16, 0.2, 13, floorMat, [0, L2_Y, 0], 0, false)); 
  window._xixInteriorGroup.add(box(16, CEIL_H, 0.4, wallMat, [0, L2_Y + (CEIL_H/2), -6.3])); 
  window._xixInteriorGroup.add(box(0.4, CEIL_H, 13, wallMat, [-7.8, L2_Y + (CEIL_H/2), 0])); 
  window._xixInteriorGroup.add(box(0.4, CEIL_H, 13, wallMat, [7.8, L2_Y + (CEIL_H/2), 0]));  
  window._xixInteriorGroup.add(box(6, CEIL_H, 0.3, wallMat, [-3, L2_Y + (CEIL_H/2), -2]));
  window._xixInteriorGroup.add(box(3.5, 0.9, 1.2, new THREE.MeshStandardMaterial({color: 0x222222}), [-4, L2_Y + 0.45, -2])); 
  window._xixInteriorGroup.add(box(15.2, CEIL_H, 0.1, glassMat, [0, L2_Y + (CEIL_H/2), 6.3]));
  window._xixInteriorGroup.add(box(15.2, 1.1, 0.05, glassMat, [0, L2_Y + 0.55, 7.5])); 
  
  const steps = 20; const stepH = (L3_Y - L2_Y) / steps; const stepD = 0.28; 
  for (let i = 0; i < steps; i++) {
    window._xixInteriorGroup.add(box(1.5, stepH, stepD, woodMat, [6, L2_Y + (i * stepH) + (stepH/2), -2 + (i * stepD)], 0, false));
  }

  window._xixInteriorGroup.add(box(12.5, 0.2, 13, floorMat, [-1.75, L3_Y, 0], 0, false)); 
  window._xixInteriorGroup.add(box(3.5, 0.2, 7.4, floorMat, [6.25, L3_Y, 2.8], 0, false)); 
  window._xixInteriorGroup.add(box(16, CEIL_H, 0.4, wallMat, [0, L3_Y + (CEIL_H/2), -6.3])); 
  window._xixInteriorGroup.add(box(0.4, CEIL_H, 13, wallMat, [-7.8, L3_Y + (CEIL_H/2), 0])); 
  window._xixInteriorGroup.add(box(0.4, CEIL_H, 13, wallMat, [7.8, L3_Y + (CEIL_H/2), 0]));  
  window._xixInteriorGroup.add(box(8, CEIL_H, 0.2, wallMat, [-3.8, L3_Y + (CEIL_H/2), 0])); 
  window._xixInteriorGroup.add(box(0.2, CEIL_H, 6.3, wallMat, [0.2, L3_Y + (CEIL_H/2), 3.15])); 
  window._xixInteriorGroup.add(box(2.2, 0.6, 2.4, new THREE.MeshStandardMaterial({color: 0x99aaff}), [-4, L3_Y + 0.3, 2]));
  window._xixInteriorGroup.add(box(15.2, CEIL_H, 0.1, glassMat, [0, L3_Y + (CEIL_H/2), 6.3]));
  window._xixInteriorGroup.add(box(15.2, 1.1, 0.05, glassMat, [0, L3_Y + 0.55, 7.5])); 

  // Roof slab. Without one the top storey is open to the sky and the whole
  // thing reads as a section drawing rather than a building.
  window._xixInteriorGroup.add(box(16.4, 0.24, 13.4, floorMat, [0, L3_Y+CEIL_H, 0], 0, false));

  scene.add(window._xixInteriorGroup);

  const camLocalZ = 2.0;
  window._xixInteriorAnchor = {
    x: plot.x + Math.sin(plot.ry) * camLocalZ,
    z: plot.z + Math.cos(plot.ry) * camLocalZ,
    ry: plot.ry, levels: window._xixInteriorGroup.userData.levels,
  };
  if (typeof window.setMoveMode === 'function') window.setMoveMode('walk');
  window.setInteriorLevel(2);
};

// Single entry point for floor navigation. app.js used to inline the eye
// heights in two click handlers; owning them here means the geometry and the
// camera can only ever be edited together.
window.setInteriorLevel = function(n) {
  const a = window._xixInteriorAnchor; if (!a) return null;
  const lv = a.levels.find(l => l.n === n) || a.levels[1];
  if (typeof setView === 'function') setView([a.x, lv.eye, a.z], a.ry, 0);
  window._xixInteriorLevel = lv.n;
  return lv;
};

window.destroyInteriorBuild = function() {
  if (window._xixInteriorGroup) {
    scene.remove(window._xixInteriorGroup);
    window._xixInteriorGroup = null;
  }
  (window._xixInteriorHidden || []).forEach(o => { o.visible = true; });
  window._xixInteriorHidden = [];
  window._xixInteriorAnchor = null;
  window._xixInteriorPlotKey = null;
};
