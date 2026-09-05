/**
 * Project XIX — Scene (Production Standard v25)
 * Upgrades: 
 * - Fast PBR Water (No texture crash loop)
 * - 3D Spatial Audio (Web Audio API PannerNodes)
 * - LOD instancing, Atmospheric Sky, and guided tour integration
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import {
  initVillaLODBudget, updateVillaLODBudget, setVillaLODBudget, fixVillaMaterials
} from "./villa-lod-budget.js?v=83";
import { GLTFLoader }  from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/meshopt_decoder.module.js";
import { Water } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/objects/Water.js";
// Named exports (clone, etc.), not a single "SkeletonUtils" binding — a
// named-import guess that doesn't match the module's real exports throws a
// hard SyntaxError at link time, before any code runs at all.
import * as SkeletonUtils from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/utils/SkeletonUtils.js";
import { INTERIORS, buildVillaRoomGroup } from "./interior.js?v=83";
import { UNIT_SCHEDULE } from "./data.js?v=83";
import * as BufferGeometryUtils from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/utils/BufferGeometryUtils.js";
import {
  PBR, createWaterMat, addGrassField, commitGrass, tickGrass, tickWater,
  buildPalmInstances, tickPalms, applyFoliageWind,
  setPerfModeGraphics, setBloomForTime, setSkyForTime, createAtmosphericSky,
  buildEnvMapFromSky, scheduleEnvMapRefresh, applyPS4Materials,
  loadHDRI, applyHDRITimeModulation,
  MAT_GRASS_FIELD, MAT_GLASS, MAT_GLASS_WARM, MAT_WHITE_TRIM, MAT_GOLD, MAT_DARK_METAL,
} from "./graphics.js?v=83";

// ─── PERFORMANCE MODE ─────────────────────────────────────────────────────────
export let PERF_MODE = 'fast';

// NORTH GROUP RIGID SHIFT — defined at top of module so every geometry function
// (addGround, addRoads, addLake, addVillaRing) reads the same value with no
// temporal-dead-zone risk. The N/S safety strip was reduced 25m→13m, pulling
// its outer edge from z=-98 to z=-86 (12m). Moving the whole north group
// (villas, arc, corners, lake, banks, hedges, cypress, shadows, north grass,
// crescent road, lake audio, label) inward by this restores the original
// villa-to-strip relationship with no internal proportions changed.
const NORTH_SHIFT = 12;   // metres toward the field (+Z)
if (typeof window !== 'undefined') window._xixNorthShift = NORTH_SHIFT;

const PERF_SETTINGS = {
  // 'balanced' is now the CEILING for integrated-GPU laptops (see detectGPUTier),
  // so it is tuned for that hardware rather than for a mid-range discrete card.
  //
  // fogDensity — ATMOSPHERIC PERSPECTIVE.
  // This was 0.00002, which with FogExp2 gives under 1% haze even 800m away:
  // the atmosphere was effectively switched off. That is the single biggest
  // reason the aerial view read as CG rather than photography — in real aerial
  // imagery, distance desaturates and lightens everything through haze, and
  // here the far corner of the estate had identical contrast to the foreground.
  // 0.0011 gives ~20% haze at 400m and ~60% at 800m — a natural falloff across
  // the 760m estate. Because FogExp2 is distance-SQUARED, close-range
  // walkthrough is barely touched (0.4% at 50m), so this costs nothing at
  // ground level while transforming the wide shot.
  fast:     { shadowMapSize: 1024, pixelRatio: 1.25, fogDensity: 0.00105, palmTickDiv: 6 },
  balanced: { shadowMapSize: 2048, pixelRatio: 1.25, fogDensity: 0.00110, palmTickDiv: 3 },
  rich:     { shadowMapSize: 4096, pixelRatio: 2.0,  fogDensity: 0.00115, palmTickDiv: 1 },
};

export function setPerfMode(mode) {
  if (!PERF_SETTINGS[mode]) return;

  // The GPU tier sets a sensible DEFAULT (see detectGPUTier) but does NOT
  // forbid a higher one. Hard-locking 'Rich' out of the menu removed a choice
  // the user is entitled to make — if they want maximum quality and will accept
  // the framerate, that is their call. The adaptive frame-rate governor still
  // steps the tier down automatically if the machine genuinely cannot sustain
  // it, so the safety net remains without the menu lying about what is possible.
  PERF_MODE = mode;
  setPerfModeGraphics(mode);
  setVillaLODBudget({ kind: 'villa', ...(VILLA_BUDGET_BY_MODE[mode] || VILLA_BUDGET_BY_MODE.balanced) });
  setVillaLODBudget({ kind: 'loft',  ...(LOFT_BUDGET_BY_MODE[mode]  || LOFT_BUDGET_BY_MODE.balanced)  });
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
    // shadowMap.autoUpdate is OFF, so the disposed map above would NEVER be
    // recreated on its own — shadows would silently vanish after any quality
    // switch. Explicitly request a regeneration at the new resolution.
    requestShadowUpdate(2);
  }
  
  if (scene && scene.fog) {
    // Clear weather means LESS haze, not none. The old value (0.000008) removed
    // atmospheric perspective entirely on clear days — but even on a genuinely
    // clear day, 800m of air visibly lightens and desaturates distance. That
    // falloff is what separates a photograph from a render, so clear weather
    // keeps ~70% of the base density rather than switching it off.
    const isClear = (window._currentWeather === 'clear');
    scene.fog.density = isClear ? s.fogDensity * 0.7 : s.fogDensity;
  }
}

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let scene, renderer, camera, clock;
let waterMeshes = [], palmBillboards = [];
let _palmTickCount = 0;

let villaGLBScene = null, pendingVillas = [];
// NOTE: 12.56 is the legacy plot-footprint figure and is NOT the model scalar.
// The model scalar below is what every villa LOD must use — see loadVillaGLB
// and loadVillaLowGLB. They must always match.
const VILLA_SCALE = 12.56;

// ── VILLA SIZING ────────────────────────────────────────────────────────────
// What is LOCKED is the villa's width in METRES, not the multiplier. The old
// constant 5.71853 was correct only for the specific GLB it was measured
// against (raw X 1.99985 units). Swap in a model authored at any other size and
// a fixed multiplier renders it huge or tiny.
//
// fitVillaScalar() measures each GLB's own bounding box and returns whatever
// multiplier lands it on VILLA_TARGET_WIDTH, so every tier — hero, low, and any
// future one — comes out the same size no matter how it was exported. This also
// removes the "any future LOD level MUST apply this same scalar" trap noted in
// loadVillaLowGLB below: they now derive it instead of copying it.
//
// 11.4362 m is the measured width of the shipping villa-mesh.glb and is what
// every ring position, hedge, contact shadow, cypress and plot overlay assumes.
// Do not change it without re-deriving the ring layout in addVillaRing().
const VILLA_TARGET_WIDTH = 11.4362;
const VILLA_MODEL_SCALAR = 5.71853;   // legacy fallback only — see fitVillaScalar()

// Reports exactly what a loaded building GLB carries, so a look regression can
// be attributed instead of guessed at. The three things that have actually
// caused quality drops here:
//
//   1. TANGENT missing. Three.js then derives tangents from screen-space
//      derivatives. On a photogrammetry mesh with an atlas normal map that
//      reads as grain, and applyPS4Materials multiplies it by normalScale 1.15.
//      Blender bakes real per-vertex tangents, which is why the viewport looks
//      right and the app does not.
//
//   2. A missing map. applyPS4Materials only takes its calibrated baked-asset
//      branch when map AND normalMap AND roughnessMap are all present. Lose one
//      and the material falls through to name matching, which cannot classify
//      "pbr_material", and ends on the default — procedural values painted over
//      your bake.
//
//   3. Texture downscaling. 1K across a whole villa is ~44 texels/m: one pixel
//      per 2.3 cm of wall, which is the soft, waxy look up close.
function reportVillaAsset(obj, label) {
  let tris = 0, hasTangent = false, mats = new Set();
  const maps = {};
  obj.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    tris += (g.index ? g.index.count : (g.attributes.position ? g.attributes.position.count : 0)) / 3;
    if (g.attributes.tangent) hasTangent = true;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    list.forEach(m => {
      if (!m) return;
      mats.add(m.name || '(unnamed)');
      ['map','normalMap','roughnessMap','metalnessMap','aoMap'].forEach(k => {
        if (m[k] && m[k].image) maps[k] = `${m[k].image.width}x${m[k].image.height}`;
      });
    });
  });
  const baked = !!(maps.map && maps.normalMap && maps.roughnessMap);
  console.log(
    `[XIX] ${label}: ${Math.round(tris).toLocaleString()} tris | ` +
    `TANGENT ${hasTangent ? 'yes' : 'NO — normals will be derivative-based'} | ` +
    `materials [${[...mats].join(', ')}] | maps ${JSON.stringify(maps)} | ` +
    `applyPS4Materials baked branch: ${baked ? 'YES' : 'NO — falling through to procedural default'}`
  );
  if (!hasTangent) console.warn(`[XIX] ${label}: no tangents. Re-export from Blender with Data > Mesh > Tangents TICKED.`);
  if (!baked)      console.warn(`[XIX] ${label}: incomplete map set — the calibrated material branch will not run.`);
}

function fitVillaScalar(obj) {
  // Measure at scale 1 so the raw authored size is what we read.
  const prev = obj.scale.clone();
  obj.scale.setScalar(1);
  obj.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
  obj.scale.copy(prev);

  if (!(size.x > 1e-6)) {
    console.warn('[XIX] villa GLB has zero width — falling back to', VILLA_MODEL_SCALAR);
    return VILLA_MODEL_SCALAR;
  }
  const scalar = VILLA_TARGET_WIDTH / size.x;
  console.log(
    `[XIX] villa raw ${size.x.toFixed(5)} x ${size.y.toFixed(5)} x ${size.z.toFixed(5)} ` +
    `-> scalar ${scalar.toFixed(5)} -> ${VILLA_TARGET_WIDTH.toFixed(3)} x ` +
    `${(size.y*scalar).toFixed(3)} x ${(size.z*scalar).toFixed(3)} m`
  );
  return scalar;
}
// Distance at which a villa swaps from the full 979K model to the verified
// 97,941-tri low-poly. Villas sit ~28m apart on the ring, so at 90m you'd have
// 6-8 of them at full detail while walking — around 7M triangles on its own.
// 60m keeps 2-3 at full detail, which is what you can actually resolve, and
// puts everything else on the low model.
// Raise it if close-range villas look soft; lower it if walking is still heavy.
const VILLA_LOD_SWAP = 60;

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

// ── LOFT LOD ────────────────────────────────────────────────────────────────
// 28 blocks at 26 m pitch in the south-west precinct. Before this they had no
// LOD at all: every block rendered at full detail at every distance, so at
// 1.9M tris each that was 53.2M triangles permanently resident — 5.5x the
// entire villa ring. Walking the south row put 10 blocks inside 150 m: 19M
// triangles in front of you at once.
//
// Swap is tighter than the villas' 60 m because the blocks are packed in rows
// rather than spread round a 274 m field, and because nobody inspects a loft
// the way a buyer inspects their own villa.
const LOFT_LOD_SWAP = 45;

// A block is FOUR units. The old scalar 4.79208 was derived from one unit's
// 125 m² GFA and applied to a model of the whole block, so the terrace rendered
// at roughly the width of a single apartment — 4.683 m on the current export,
// about the height of a horse, which is exactly how it looked.
//
// The first fix (36 m) was itself wrong: it was back-derived from the unit
// hitboxes' own offsets [-13.5,-4.5,4.5,13.5] (four bays at 9 m centres), and
// those offsets were written while the block was still rendering at 4.68 m —
// a bad number inherited from a bad number.
//
// The authority is GFA, not the hitboxes:
//   4 units x 125 m² = 500 m² / 2 floors = 250 m² footprint per block
// A 4.3 m frontage x 14.6 m deep bay gives 62.8 m² per floor, 125.6 m² over
// two floors — matching the unit brief — and four bays abutted gives a
// 17.2 m wide, 14.6 m deep block (250.4 m² footprint). That is a proper
// terrace typology; 36 m wide was over four times the true footprint.
const LOFT_BLOCK_WIDTH = 17.2;
const LOFT_BLOCK_DEPTH = 14.6;
let loftLowScene = null;

// Derived at runtime, not hard-coded. loft-mesh.glb keeps its legacy 4.79208
// scalar so the estate looks exactly as it does today; loft-low.glb is then
// fitted to whatever world width that produced, so the two tiers cannot
// disagree on size and the block will not visibly grow or shrink at the swap.
// This is the trap that would otherwise bite here: the villa low model was
// 6.04 m tall against a 6.98 m hero.
let LOFT_TARGET_WIDTH = null;

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

// THE PLAYER-MOUNT HORSE — removed graphically per request. In 'ride' mode
// (app.js) this model's XZ position was set to the CAMERA's own XZ every
// single frame, offset only in Y by rider eye height — meaning the camera
// sat essentially inside the horse's own body geometry continuously. That
// is the "ghostly giant horse" seen filling the screen: the camera was that
// close to (or inside) the mesh at all times ride mode was active, and
// switching modes (aerial, the villa interior, toolbar teleports) simply
// changed when that clipping became visually obvious.
// Left as a real no-op rather than deleted outright, so nothing that
// already imports loadHorseGLB/getHorseGroup/setHorsePosition/tickHorseAnim
// throws a missing-export SyntaxError — the exact class of bug already hit
// twice in this project from files drifting out of sync with each other.
export function loadHorseGLB() {
  return;
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
let _horseClipFull = null;
let _horseIdleClip = null;
const _pendingAmbientBuilds = [];

function _spawnAmbientHorse(bounds, delayMs) {
  const rec = { model: null, mixer: null, pos: new THREE.Vector3(), yaw: 0,
                target: new THREE.Vector3(), pauseT: 0,
                // A horse walks at roughly 1.5 m/s and trots near 3.5. The old
                // 1.8-2.6 range read as sluggish across a 700m estate, so this
                // sits at a purposeful walk-to-slow-trot.
                speed: 2.9 + Math.random()*1.0, bounds };
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

      // ─── EXTRACT THE WALK FROM THE COMBINED TIMELINE ──────────────────────
      // horse.glb contains exactly ONE animation, "Take 001", 31.2s long, with
      // every gait baked end to end. The old lookup regex (/trot|walk|run/)
      // therefore never matched and fell through to animations[0] — the WHOLE
      // timeline. That is why the horse galloped, slid, reared and idled in
      // sequence instead of simply walking.
      //
      // Measuring angular velocity per second across the clip shows three
      // distinct phases:
      //     0-3s    ~1.7 rad/s   gallop
      //     3-15s   ~0.6-1.1     WALK
      //     15-31s  ~0.05-0.3    idle / grazing
      // The walk band has a clean stride cycle: low at 3s, peak at 7s, low
      // again at 11s — the same phase, so 3->11s loops without a visible jump.
      // Tunable live via window.setHorseWalkRange(start, end).
      const rawClip = gltf.animations[0];
      if (rawClip) {
        // Strip root motion so the clip animates in place and the code drives
        // position — otherwise the baked translation fights our movement.
        const filteredTracks = rawClip.tracks.filter(track => {
          const isRoot = /^(root|_rootjoint|rootnode|hips_01)/i.test(track.name.split('.')[0]);
          return !(isRoot && (track.name.endsWith('.position') || track.name.endsWith('.quaternion')));
        });
        const inPlace = new THREE.AnimationClip(rawClip.name, rawClip.duration, filteredTracks);
        _horseClipFull = inPlace;
        const FPS = 30;
        _horseClip     = THREE.AnimationUtils.subclip(inPlace, 'walk', 3 * FPS, 11 * FPS, FPS);
        _horseIdleClip = THREE.AnimationUtils.subclip(inPlace, 'idle', 20 * FPS, 30 * FPS, FPS);
        console.log(`[XIX] Horse: extracted walk 3-11s and idle 20-30s from "${rawClip.name}" (${rawClip.duration.toFixed(1)}s combined)`);
      }
      _pendingAmbientBuilds.forEach(fn => fn());
      _pendingAmbientBuilds.length = 0;
    }, undefined, err => console.warn('[XIX] ambient horse template load failed:', err));
  }, delayMs);
}

// Re-cut the walk range at runtime without a rebuild, e.g.
//   window.setHorseWalkRange(3, 11)
// Useful for dialling the loop in against the actual animation.
if (typeof window !== 'undefined') {
  window.setHorseWalkRange = function (startSec, endSec) {
    if (!_horseClipFull) { console.warn('[XIX] horse clip not loaded yet'); return; }
    const FPS = 30;
    _horseClip = THREE.AnimationUtils.subclip(_horseClipFull, 'walk', startSec * FPS, endSec * FPS, FPS);
    let n = 0;
    _ambientHorses.forEach(h => {
      if (!h.mixer || !h.model) return;
      h.mixer.stopAllAction();
      const a = h.mixer.clipAction(_horseClip);
      a.setLoop(THREE.LoopRepeat, Infinity); a.play(); n++;
    });
    console.log(`[XIX] Horse walk range set to ${startSec}-${endSec}s on ${n} horses`);
  };
}

export function spawnAmbientHorses() {
  // All six share one load now — the stagger only spreads the cheap BUILD
  // calls (clone + mixer), not network fetches, which no longer repeat.
  // Roam zones verified against the built geometry. Two were wrong:
  //   POLO_N  zMin -88 reached INTO the lake, which now spans z -87..-116 after
  //           NORTH_SHIFT — horses were walking on water.
  //   TRAINING x -335..-185 contained the apartment block at (-245, -45), so
  //           horses walked through the building.
  // Corrected below, with a margin rather than an exact edge so a horse mid-turn
  // cannot clip the boundary.
  const POLO_N   = { xMin: -60,  xMax: 60,   zMin: -84, zMax: -76 };  // between lake edge (-87) and field
  const POLO_S   = { xMin: -60,  xMax: 60,   zMin:  76, zMax:  85 };  // inside the 13m south strip (73..86)
  const TRAINING = { xMin: -330, xMax: -268, zMin: -85, zMax:  5  };  // WEST of the apartments at x=-245
  const PADDOCK  = { xMin: 212,  xMax: 268,  zMin: -55, zMax: -5 };   // inset from the rail fence
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

    // Hard clamp to the zone. Targets are already drawn from inside it, but a
    // clamp guarantees no horse can ever be seen inside a building or on the
    // lake regardless of rounding or a mid-turn overshoot.
    const bd = h.bounds;
    if (h.pos.x < bd.xMin) h.pos.x = bd.xMin;
    if (h.pos.x > bd.xMax) h.pos.x = bd.xMax;
    if (h.pos.z < bd.zMin) h.pos.z = bd.zMin;
    if (h.pos.z > bd.zMax) h.pos.z = bd.zMax;

    // ── FOOT SLIDING FIX ───────────────────────────────────────────────────
    // Sliding happens when the legs cycle at a rate that does not match how
    // fast the body is actually travelling. The walk subclip is authored for
    // roughly WALK_REF m/s, so scaling the mixer by (actual / reference) keeps
    // the hooves planted at whatever speed this particular horse is moving.
    if (h.mixer) {
      const WALK_REF = 3.0;
      const actual = step / Math.max(delta, 0.0001);
      h.mixer.timeScale = Math.max(0.35, Math.min(1.8, actual / WALK_REF));
    }
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
  return;   // player-mount horse removed graphically; kept as a no-op export
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
  return;   // player-mount horse removed graphically; kept as a no-op export
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
    npcHorses.push({ group, mixer, path, pathIdx: 0, speed: 3.2 + Math.random() * 1.4, progress: 0 });
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
  if (_masterGain && _audioCtx) {
    // MUST cancel scheduled automation first. This used a direct
    // `_masterGain.gain.value = ...` write, but the mixer's master slider uses
    // setTargetAtTime — and once a Web Audio param has scheduled automation,
    // direct .value writes are IGNORED while it runs. setTargetAtTime never
    // formally completes (it approaches its target asymptotically), so after any
    // master slider movement, mute silently stopped working entirely.
    const t = _audioCtx.currentTime;
    _masterGain.gain.cancelScheduledValues(t);
    _masterGain.gain.setValueAtTime(_masterGain.gain.value, t);
    // Unmute restores the mixer's master level, not a hardcoded 1.0, so muting
    // and unmuting no longer discards a level the user set.
    const target = muted ? 0 : (_mixLevels && _mixLevels.master !== undefined ? _mixLevels.master : 1);
    _masterGain.gain.linearRampToValueAtTime(target, t + 0.08);
  } else if (_masterGain) {
    _masterGain.gain.value = muted ? 0 : 1;
  }
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
// worldY matters. The previous signature took only X and Z, so the listener was
// treated as standing on the ground no matter where the camera actually was.
// In AERIAL that is badly wrong: you orbit ~120m up, but panning horizontally
// over the lake registered as standing at the water's edge, so place-anchored
// sounds fired for elements you were nowhere near.
// Using true 3D distance fixes this without special-casing aerial — height is
// simply part of how far away something is. Birds and the time-of-day beds are
// unaffected because they are global by design, which is exactly the intent:
// from the air you hear the landscape, and you only pick up the lake, the
// stables or a passing car once you have descended close enough to them.
export function updateSpatialAudio(worldX, worldZ, worldY = 1.72) {
  const isMoving = _lastAudioX !== null &&
    (Math.abs(worldX - _lastAudioX) > 0.01 || Math.abs(worldZ - _lastAudioZ) > 0.01);
  _lastAudioX = worldX; _lastAudioZ = worldZ;
  _listenerY = worldY;
  updateAudioForMovement(isMoving, worldX, worldZ);
  _tickAmbientNeighs(worldX, worldZ);
}

// Listener height above ground, fed into every proximity calculation below.
let _listenerY = 1.72;

// True 3D distance from the listener to a point on the ground. At walking
// height the vertical term is negligible; from an aerial orbit it dominates,
// which is precisely the behaviour we want.
function _dist3(px, pz) {
  const dy = _listenerY - 1.6;
  return Math.sqrt(
    (_listenerPos.x - px) ** 2 + (_listenerPos.z - pz) ** 2 + dy * dy
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PROXIMITY SOUNDSCAPE — sample-based, spatially curated
// ═══════════════════════════════════════════════════════════════════════════
// Design principle: a sound should only exist where the thing making it exists.
// Water is only audible near the lake. Horses only near the stables and paddock.
// Traffic only along the OUTER perimeter roads, never across the field. Birds
// are the one genuine exception — they belong everywhere in a nature setting,
// but their character changes with the time of day.
//
// Every entry degrades gracefully: if its sample file is absent the entry is
// simply skipped and the existing synthesised layer continues to cover it, so
// dropping files into assets/audio/ upgrades the scene incrementally with no
// code change.
const AUDIO_BASE = 'assets/audio/';
const _sampleBuffers = new Map();   // filename -> decoded AudioBuffer (or null if missing)

// Ambient loops anchored to a place. `radius` is where the sound reaches zero;
// `full` is the distance within which it plays at full level. Between the two
// it ramps smoothly, so walking toward the lake brings the water up naturally
// rather than switching it on.
const AMBIENT_SOURCES = [
  {
    id: 'lake', file: 'water-lapping.mp3',
    // Crescent lake centre, carried with the north group shift
    get x() { return 0; }, get z() { return -113 + NORTH_SHIFT; },
    // The lake centre is ~101m from the middle of the polo pitch, so a 175m
    // radius made water clearly audible while standing on the centre spot —
    // wrong, and it broke the whole premise of place-anchored sound.
    // 30m full / 85m silent keeps it to the lakeside and the north villas only.
    full: 30, radius: 85, gain: 0.85,
  },
  {
    id: 'wind-trees', file: 'wind-trees.mp3',
    // Palm avenue along the west boundary — the densest planting on the estate
    x: -300, z: -20, full: 45, radius: 100, gain: 0.5,
  },
];

// One-shot events, fired by the scheduler at a position rather than globally.
const ONESHOT_POINTS = {
  // Stables compound and paddock — the only places horses actually are
  horses: [
    { x: -355, z: 90 },    // stables yard
    { x: -330, z: 60 },    // stables paddock
    { x: 240,  z: -30 },   // east paddock
    { x: 240,  z: 45 },    // game park paddock
  ],
  // OUTER boundary roads only. Deliberately excludes the internal estate roads
  // that ring the field: traffic noise crossing the polo ground would break the
  // sense of a quiet, low-density estate. These are the perimeter carriageways.
  roads: [
    { x: -300, z: 215 }, { x: 0, z: 215 }, { x: 300, z: 215 },   // south perimeter
    { x: -310, z: 145 },                                          // west perimeter
    { x: 215,  z: 120 },                                          // east perimeter
  ],
};

async function _loadSample(file) {
  if (_sampleBuffers.has(file)) return _sampleBuffers.get(file);
  try {
    const res = await fetch(AUDIO_BASE + file);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const arr = await res.arrayBuffer();
    let buf = await _audioCtx.decodeAudioData(arr);

    // ─── FORCE MONO ────────────────────────────────────────────────────────
    // A PannerNode fed a STEREO buffer does not spatialise correctly: the
    // baked-in stereo image fights the 3D placement, so a horse positioned at
    // the stables still bleeds across both ears regardless of where you stand.
    // Several of the supplied files are stereo, so rather than require them to
    // be re-sourced we downmix here. This also halves the decoded memory —
    // these buffers are 32-bit float PCM, so a long stereo clip is expensive.
    if (buf.numberOfChannels > 1) {
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      const mono = _audioCtx.createBuffer(1, buf.length, buf.sampleRate);
      const out = mono.getChannelData(0);
      for (let i = 0; i < buf.length; i++) out[i] = (L[i] + R[i]) * 0.5;
      const mb = (buf.length * 4 / 1048576).toFixed(1);
      console.log(`[XIX] Audio: ${file} downmixed stereo→mono (saved ~${mb}MB, enables true 3D panning)`);
      buf = mono;
    }

    _sampleBuffers.set(file, buf);
    return buf;
  } catch (e) {
    // Missing or undecodable — record the miss so we don't retry every frame,
    // and let the synthesised fallback keep covering this sound.
    _sampleBuffers.set(file, null);
    console.log(`[XIX] Audio: ${file} unavailable — using synthesised fallback`);
    return null;
  }
}

const _ambientNodes = [];   // { def, gainNode }

// ─── TIME-OF-DAY AMBIENCE BEDS ───────────────────────────────────────────────
// Birds are the one sound that belongs EVERYWHERE, so unlike the lake and the
// palms these are not proximity-gated. Instead the four beds crossfade as the
// day cycle advances: a dense dawn chorus, a sparser midday with insects,
// evening calls, then night crickets and frogs. Only one is audible at a time;
// the others sit at zero gain but keep playing, so a time change crossfades
// rather than restarting mid-phrase.
const TIME_BEDS = {
  morning:   'birds-dawn.mp3',
  afternoon: 'birds-day.mp3',
  sunset:    'birds-evening.mp3',
  night:     'night-ambience.mp3',
};
const _timeBedNodes = new Map();   // timeName -> GainNode
let _activeTimeBed = null;

async function _initTimeBeds() {
  // On iOS the four ambience beds decode to ~20MB of 32-bit float PCM, which is
  // a meaningful share of a tab's memory ceiling. Load only the bed for the
  // CURRENT time of day there; the others load on demand when the time changes.
  // Desktop keeps all four resident so crossfades are instant.
  const iosLite = _isTabletOrIOS();
  const wanted = iosLite ? [window._currentTimeName || 'afternoon'] : Object.keys(TIME_BEDS);
  for (const timeName of wanted) {
    const file = TIME_BEDS[timeName];
    if (!file) continue;
    const buf = await _loadSample(file);
    if (!buf) continue;
    const src = _audioCtx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = _audioCtx.createGain();
    g.gain.value = 0;
    src.connect(g); g.connect(_bus('birds'));
    src.start(Math.random() * 3);   // stagger phase between beds
    _timeBedNodes.set(timeName, g);
  }
  if (_timeBedNodes.size) {
    console.log(`[XIX] Audio: ${_timeBedNodes.size} time-of-day beds loaded`);
    // Silence the synthesised bird generator — the real beds supersede it.
    if (_birdsGain) _birdsGain.gain.value = 0;
    setTimeBed(window._currentTimeName || 'afternoon');
  }
}

// Crossfade to the bed for a given time of day. Called from updateSkyForTime,
// so the soundscape and the lighting change together.
export function setTimeBed(timeName) {
  if (!_audioCtx) return;
  if (_activeTimeBed === timeName) return;
  // iOS lazy path: the bed for this time may not be resident yet.
  if (!_timeBedNodes.has(timeName) && TIME_BEDS[timeName]) {
    _loadSample(TIME_BEDS[timeName]).then(buf => {
      if (!buf || _timeBedNodes.has(timeName)) return;
      const src = _audioCtx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const g = _audioCtx.createGain(); g.gain.value = 0;
      src.connect(g); g.connect(_bus('birds'));
      src.start();
      _timeBedNodes.set(timeName, g);
      _activeTimeBed = null;      // force the crossfade to run now it exists
      setTimeBed(timeName);
    });
    return;
  }
  if (!_timeBedNodes.size) return;
  _activeTimeBed = timeName;
  const t = _audioCtx.currentTime;
  // 4s crossfade — long enough that the transition is felt rather than heard.
  _timeBedNodes.forEach((g, name) => {
    g.gain.setTargetAtTime(name === timeName ? 0.55 : 0, t, 1.4);
  });
}

async function _initAmbientSources() {
  for (const def of AMBIENT_SOURCES) {
    const buf = await _loadSample(def.file);
    if (!buf) continue;
    const src = _audioCtx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = _audioCtx.createGain();
    g.gain.value = 0;                      // silent until the listener approaches
    src.connect(g); g.connect(_bus(def.id === 'lake' ? 'water' : 'wind'));
    src.start(Math.random() * 2);          // stagger so loops don't phase-lock
    _ambientNodes.push({ def, gainNode: g });
    console.log(`[XIX] Audio: ${def.id} → ${def.file}`);
    // A real sample supersedes the synthesised stand-in for the same thing.
    if (def.id === 'lake' && window._lakeGain) window._lakeGain.gain.value = 0;
    if (def.id === 'wind-trees' && _windGain) _windGain.gain.value = 0;
  }
}

// Called from updateAudioForMovement. THROTTLED to ~12Hz and change-gated:
// the previous version ran at frame rate and called setTargetAtTime on every
// source every frame, which schedules a fresh automation event on the
// AudioParam timeline 60x/second per source. Those events accumulate and cost
// real work in the audio thread, for zero benefit — setTargetAtTime already
// ramps smoothly between calls, and hearing cannot resolve gain changes faster
// than a few times a second anyway.
let _proxLastRun = 0;
function _updateAmbientProximity(lx, lz) {
  if (!_ambientNodes.length) return;
  const now = performance.now();
  if (now - _proxLastRun < 84) return;   // ~12Hz
  _proxLastRun = now;

  for (const node of _ambientNodes) {
    const def = node.def;
    // 3D: includes camera height, so an aerial pass overhead stays silent.
    const dy = _listenerY - 1.6;
    const d = Math.sqrt((lx - def.x) ** 2 + (lz - def.z) ** 2 + dy * dy);
    let k;
    if (d <= def.full) k = 1;
    else if (d >= def.radius) k = 0;
    else {
      // Smoothstep between full and radius — a linear ramp reads as a fade,
      // a smoothstep reads as walking into earshot of something.
      const t = 1 - (d - def.full) / (def.radius - def.full);
      k = t * t * (3 - 2 * t);
    }
    const target = k * def.gain;
    // Only touch the AudioParam when the value has actually moved enough to
    // be audible. Standing still schedules nothing at all.
    if (node._last === undefined || Math.abs(target - node._last) > 0.004) {
      node._last = target;
      node.gainNode.gain.setTargetAtTime(target, _audioCtx.currentTime, 0.35);
    }
  }
}

// ─── ONE-SHOT PLAYBACK AT A WORLD POSITION ───────────────────────────────────
// Uses a real HRTF panner so the sound arrives from the correct direction and
// attenuates naturally. Distance-culled before it is even created: an event
// beyond `audible` is skipped rather than played silently.
function _playSampleAt(file, x, z, { volume = 1, audible = 260, rate = 1, offset = 0, duration = 0 } = {}) {
  const buf = _sampleBuffers.get(file);
  if (!buf || !_audioCtx || _muted) return false;
  if (_dist3(x, z) > audible) return false;

  const src = _audioCtx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;

  const panner = _audioCtx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'exponential';
  panner.refDistance = 20;
  panner.maxDistance = audible;
  panner.rolloffFactor = 1.6;
  if (panner.positionX) {
    panner.positionX.value = x; panner.positionY.value = 1.6; panner.positionZ.value = z;
  } else { panner.setPosition(x, 1.6, z); }

  const g = _audioCtx.createGain();
  g.gain.value = volume;

  // Route to the bus that matches the sound so the mixer can balance it.
  const busName = /car/i.test(file) ? 'traffic' : /horse|hoof|hooves|whinny|snort/i.test(file) ? 'horses' : 'birds';
  src.connect(g); g.connect(panner); panner.connect(_bus(busName));
  if (duration > 0) src.start(0, offset, duration); else src.start(0, offset);
  src.onended = () => { try { src.disconnect(); g.disconnect(); panner.disconnect(); } catch (e) {} };
  return true;
}

let _listenerPos = { x: 0, z: 0 };

// ─── EVENT SCHEDULERS ────────────────────────────────────────────────────────
// Horses: whinny/snort only from the stables and paddocks, and only when the
// listener is close enough for it to make sense.
let _nextHorseAt = 0;
function _tickHorseEvents(now) {
  if (now < _nextHorseAt) return;
  if ((window._currentTimeName || 'afternoon') === 'night') return;   // quiet at night
  _nextHorseAt = now + 12000 + Math.random() * 22000;   // every 12-34s

  // Nearest horse within earshot. LIVE model positions first — the ambient
  // horses wander, so the fixed stable/paddock points alone meant a snort could
  // never come from the animal standing right beside you. Fixed points remain
  // as a fallback for the stables themselves and for mobile, where ambient
  // horses are not spawned.
  let best = null, bestD = 105;   // local event — aerial height (118m) excludes it
  for (const h of _ambientHorses) {
    if (!h.model) continue;
    const d = _dist3(h.pos.x, h.pos.z);
    if (d < bestD) { bestD = d; best = { x: h.pos.x, z: h.pos.z }; }
  }
  for (const p of ONESHOT_POINTS.horses) {
    const d = _dist3(p.x, p.z);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best) return;

  // horse-whinny-123.mp3 holds several takes; playing from a random offset
  // gives variety from a single file instead of an obvious repeat.
  const useSnort = Math.random() < 0.4;
  if (useSnort) {
    _playSampleAt('horse-snort.mp3', best.x, best.z, { volume: 0.55, audible: 110 });
  } else {
    const wb = _sampleBuffers.get('horse-whinny-123.mp3');
    const dur = wb ? wb.duration : 0;
    const slot = dur > 3 ? Math.floor(Math.random() * 3) * (dur / 3) : 0;
    _playSampleAt('horse-whinny-123.mp3', best.x, best.z, {
      volume: 0.7, audible: 130,
      offset: slot, duration: dur > 3 ? dur / 3 : 0,
      rate: 0.95 + Math.random() * 0.1,      // slight pitch variation per call
    });
  }
}

// Vehicles: at most ~5 across a full simulated day, always on the OUTER
// perimeter roads. Deliberately sparse — this is a low-density estate and
// frequent traffic would undercut that.
let _nextCarAt = 0;
let _carsToday = 0;
let _carDayStamp = -1;
function _tickCarEvents(now, dayIndex) {
  if (dayIndex !== _carDayStamp) { _carDayStamp = dayIndex; _carsToday = 0; }
  if (_carsToday >= 5) return;
  if (now < _nextCarAt) return;
  _nextCarAt = now + 45000 + Math.random() * 90000;   // 45-135s between attempts

  // Only the perimeter road nearest the listener, and only if they are close
  // enough to plausibly hear a car on it.
  let best = null, bestD = 105;   // local event — aerial height (118m) excludes it
  for (const p of ONESHOT_POINTS.roads) {
    const d = _dist3(p.x, p.z);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best) return;

  if (_playSampleAt('car-pass.mp3', best.x, best.z, { volume: 0.45, audible: 120 })) {
    _carsToday++;
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// SOUND MIXER  —  per-element buses
// ═══════════════════════════════════════════════════════════════════════════
// Every sound routes through a named bus so each element can be balanced
// independently. Mute alone was too blunt: a viewing might want the birds up
// and the traffic gone, or the water prominent while standing at the lake.
// Buses sit between each source and _masterGain, so proximity and time-of-day
// logic keep working untouched — the bus is a multiplier on top of them.
const MIX_DEFAULTS = {
  master:  1.00,
  birds:   1.00,   // time-of-day ambience beds (global)
  water:   1.00,   // crescent lake
  wind:    1.00,   // palm avenue
  horses:  1.00,   // whinny, snort, hooves
  traffic: 1.00,   // perimeter road vehicles
};
const _mixBuses = {};        // name -> GainNode
const _mixLevels = { ...MIX_DEFAULTS };

function _buildMixBuses() {
  if (!_audioCtx || !_masterGain) return;
  Object.keys(MIX_DEFAULTS).forEach(name => {
    if (name === 'master' || _mixBuses[name]) return;
    const g = _audioCtx.createGain();
    g.gain.value = _mixLevels[name];
    g.connect(_masterGain);
    _mixBuses[name] = g;
  });
}

// Destination for a source. Falls back to _masterGain if the bus is missing so
// a sound is never silently lost.
function _bus(name) {
  return _mixBuses[name] || _masterGain;
}

export function setMixLevel(name, value) {
  const v = Math.max(0, Math.min(1.5, Number(value) || 0));
  _mixLevels[name] = v;
  if (!_audioCtx) return;
  if (name === 'master') {
    // Respect mute: never unmute by moving the master slider.
    if (_masterGain && !_muted) {
      const t = _audioCtx.currentTime;
      _masterGain.gain.cancelScheduledValues(t);
      _masterGain.gain.setValueAtTime(_masterGain.gain.value, t);
      _masterGain.gain.linearRampToValueAtTime(v, t + 0.06);
    }
  } else if (_mixBuses[name]) {
    _mixBuses[name].gain.setTargetAtTime(v, _audioCtx.currentTime, 0.05);
  }
  try { localStorage.setItem('xix_mix', JSON.stringify(_mixLevels)); } catch (e) {}
}

export function getMixLevels() { return { ..._mixLevels }; }

// Audio status for the D panel. The symptom "synthesised birds at night, no
// water, no cars" means the SAMPLES never loaded and every source fell back to
// its oscillator/noise stand-in — almost always because assets/audio/ is not
// deployed. This makes that visible instead of guesswork.
export function getAudioStatus() {
  const want = ['birds-dawn.mp3','birds-day.mp3','birds-evening.mp3','night-ambience.mp3',
                'water-lapping.mp3','wind-trees.mp3','car-pass.mp3','hooves-dirt.mp3',
                'horse-snort.mp3','horse-whinny-123.mp3'];
  let ok = 0, missing = [];
  want.forEach(f => {
    const b = _sampleBuffers.get(f);
    if (b) ok++; else if (_sampleBuffers.has(f)) missing.push(f.replace('.mp3',''));
  });
  return {
    ctx: !!_audioCtx,
    muted: _muted,
    samplesLoaded: ok,
    samplesExpected: want.length,
    missing,
    timeBeds: _timeBedNodes.size,
    activeBed: _activeTimeBed || '(none)',
  };
}
export function getMixDefaults() { return { ...MIX_DEFAULTS }; }

// Restore every element to its load-time value in one action.
export function resetMixLevels() {
  Object.keys(MIX_DEFAULTS).forEach(k => setMixLevel(k, MIX_DEFAULTS[k]));
  try { localStorage.removeItem('xix_mix'); } catch (e) {}
  console.log('[XIX] Mixer reset to defaults');
}

function _restoreMixLevels() {
  // Deliberately NOT restored from storage on load — the brief is that the
  // experience always opens at its designed default balance. Saved levels are
  // kept only so a slider survives an in-session re-render.
  Object.assign(_mixLevels, MIX_DEFAULTS);
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

    // Lake water: NOT routed through an HRTF panner. The panner's exponential
    // distance rolloff stacked with the proximity gain node, double-attenuating
    // to near-silence. Instead a plain looping noise source → gain → master,
    // with the gain driven entirely by JS distance in updateAudioForMovement.
    // This guarantees the water is clearly audible on the north shore.
    {
      const bufSize = _audioCtx.sampleRate * 2;
      const buf = _audioCtx.createBuffer(1, bufSize, _audioCtx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
      const src = _audioCtx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const filt = _audioCtx.createBiquadFilter();
      filt.type = 'lowpass'; filt.frequency.value = 320; filt.Q.value = 0.7;
      const lakeGain = _audioCtx.createGain();
      lakeGain.gain.value = 0;
      src.connect(filt); filt.connect(lakeGain); lakeGain.connect(_bus('water'));
      src.start();
      window._lakeGain = lakeGain;
    }
    _clubPanner = _makePositionalNoise('murmur', 0, 108);

    // Load the real samples in the background. Each one that arrives replaces
    // its synthesised stand-in; each one that is missing leaves the fallback in
    // place. Nothing blocks on this, so audio starts immediately either way.
    _restoreMixLevels();
    _buildMixBuses();
    _initAmbientSources();
    _initTimeBeds();
    ['horse-whinny-123.mp3','horse-snort.mp3','car-pass.mp3','hooves-dirt.mp3']
      .forEach(f => _loadSample(f));
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
  // Water: refDist 15 (audible up close), maxDist 280 (fades at distance)
  // Murmur: refDist 20, maxDist 180
  const refD  = type === 'water' ? 15  : 20;
  const maxD  = type === 'water' ? 280 : 180;
  const panner = _createPanner(x, z, refD, maxD);
  const bufSize = _audioCtx.sampleRate * 2;
  const buf = _audioCtx.createBuffer(1, bufSize, _audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);

  const source = _audioCtx.createBufferSource();
  source.buffer = buf; 
  source.loop = true;

  const filter = _audioCtx.createBiquadFilter();
  filter.type = type === 'water' ? 'lowpass' : 'bandpass';
  // Water: lower cutoff for a deeper ripple sound rather than white hiss
  filter.frequency.value = type === 'water' ? 280 : 600;
  if (type === 'water') filter.Q.value = 0.6;

  const gain = _audioCtx.createGain();
  // Water gain raised from 0.015 to 0.04 — previously nearly inaudible at any distance
  gain.gain.value = type === 'water' ? 0.04 : 0.005;

  source.connect(filter); 
  filter.connect(gain); 
  gain.connect(panner); 
  panner.connect(_bus(type === 'water' ? 'water' : 'birds'));
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

  source.connect(filter); filter.connect(gain); gain.connect(_bus('wind'));
  source.start();
  return gain;
}

function _makeBirds() {
  if (!_audioCtx) return null;
  const gain = _audioCtx.createGain();
  gain.gain.value = 0.0;
  gain.connect(_bus('birds'));
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
    osc.connect(g); g.connect(_bus('birds'));
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
  panner.connect(_bus('horses'));
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

// Fixed positions on the polo field and training field where neighs can originate.
// Used when no ambient horse model is within range (mobile: horses suppressed).
const _NEIGH_POSITIONS = [
  { x: -30, z: -60 }, { x: 25, z: 40 }, { x: -50, z: 20 },  // polo field N
  { x: 40,  z: -30 }, { x: 0,  z: 60 }, { x: -20, z: -20 }, // polo field S
  { x: -280, z: 0 },  { x: -260, z: -40 },                   // training field
];

let _lastNeigh = 0;
function _tickAmbientNeighs(listenerX, listenerZ) {
  if (!_audioCtx) return;
  // Horses are stabled and quiet at night. A whinny across a dark estate reads
  // as wrong, and it was undercutting the calm of the night scene.
  if ((window._currentTimeName || 'afternoon') === 'night') return;
  const now = performance.now();
  if (now - _lastNeigh < 4500) return;
  if (Math.random() > 0.010) return;   // was 0.006 — too rare to ever catch

  // ── NEIGH FROM THE HORSE YOU ARE ACTUALLY NEXT TO ────────────────────────
  // This used a static list of fixed positions, but the ambient horses WANDER.
  // Standing beside a horse produced nothing, because the nearest hardcoded
  // point could be a hundred metres away. Live model positions come first now,
  // and only fall back to fixed points when no model is in range (mobile,
  // where ambient horses are not spawned at all).
  let best = null, bestD = 95;
  for (const h of _ambientHorses) {
    if (!h.model) continue;
    const d = _dist3(h.pos.x, h.pos.z);
    if (d < bestD) { bestD = d; best = { x: h.pos.x, z: h.pos.z }; }
  }
  if (!best) {
    for (const p of _NEIGH_POSITIONS) {
      const d = _dist3(p.x, p.z);
      if (d < bestD) { bestD = d; best = p; }
    }
  }
  if (!best) return;

  _lastNeigh = now;
  // Prefer the recorded whinny; fall back to the synthesised one if absent.
  if (_sampleBuffers.get('horse-whinny-123.mp3')) {
    _playSampleAt('horse-whinny-123.mp3', best.x, best.z, {
      volume: 0.8, audible: 130, rate: 0.95 + Math.random() * 0.1,
    });
  } else {
    _makeNeighAt(best.x, best.z);
  }
}


function _makeHooves() {
  if (!_audioCtx) return null;
  const gain = _audioCtx.createGain();
  gain.gain.value = 0;
  
  const panner = _createPanner(0, 0, 5, 50);
  gain.connect(panner);
  panner.connect(_bus('horses'));

  // A single triangle-wave oscillator at 120-160 Hz sounds exactly like a
  // hollow wooden block being struck — a marimba, not a hoofbeat. Real hoof
  // impacts are broadband transients: short noise bursts shaped by a fast
  // exponential decay, not a pitched tone. Replace the oscillator with a
  // filtered noise burst. Gate threshold raised from 0.001 to 0.35 so the
  // clops only fire when the player is clearly moving at sustained speed.
  function clop() {
    // Tight gate: only play when clearly moving (gain well above threshold).
    // The old 0.001 threshold let clops leak at partial volume during the
    // setTargetAtTime ramp-down, which is what read as "hollow percussion".
    if (!_audioCtx || gain.gain.value < 0.35) { setTimeout(clop, 350 + Math.random() * 150); return; }

    // Broadband noise burst — sounds like a hoof on compacted laterite
    const bufSize = Math.floor(_audioCtx.sampleRate * 0.12);
    const buf = _audioCtx.createBuffer(1, bufSize, _audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);

    const src = _audioCtx.createBufferSource();
    src.buffer = buf;

    // Band-pass shaped to the low-mid thud of a hoof on dirt (300-900 Hz)
    const filt = _audioCtx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 380 + Math.random() * 200;
    filt.Q.value = 1.4;

    // Sharp transient decay — 60ms to silence
    const g = _audioCtx.createGain();
    g.gain.setValueAtTime(0.12, _audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + 0.06);

    src.connect(filt); filt.connect(g); g.connect(gain);
    src.start(); src.stop(_audioCtx.currentTime + 0.07);

    setTimeout(clop, 260 + Math.random() * 140);
  }
  setTimeout(clop, 1400);
  return { panner, gain };
}

// Cached last-written values so we only touch an AudioParam when its target has
// actually changed. The previous version issued NINE setTargetAtTime calls every
// frame — 540 automation events per second — even when standing perfectly still
// with nothing changing. Each one schedules work on the audio thread.
const _audioLast = { lx: NaN, lz: NaN, wind: NaN, hooves: NaN, birds: NaN, lake: NaN };

export function updateAudioForMovement(isMoving, worldX, worldZ) {
  if (!_audioCtx) return;
  const t = _audioCtx.currentTime;

  // Listener + hooves panner: only reposition when the camera has genuinely
  // moved. Sub-10cm jitter is inaudible and not worth an automation event.
  const movedEnough = !(Math.abs(worldX - _audioLast.lx) < 0.1 && Math.abs(worldZ - _audioLast.lz) < 0.1);
  if (movedEnough) {
    _audioLast.lx = worldX; _audioLast.lz = worldZ;
    const listener = _audioCtx.listener;
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(worldX, t, 0.1);
      listener.positionY.setTargetAtTime(1.72, t, 0.1);
      listener.positionZ.setTargetAtTime(worldZ, t, 0.1);
    }
    if (_hoovesPanner && _hoovesPanner.positionX) {
      _hoovesPanner.positionX.setTargetAtTime(worldX, t, 0.1);
      _hoovesPanner.positionZ.setTargetAtTime(worldZ, t, 0.1);
    }
  }

  if (_windGain) {
    const edge = Math.min(Math.abs(worldZ + 220), Math.abs(worldZ - 215));
    const windVal = 0.008 + (1 - Math.min(edge / 80, 1)) * 0.018;
    if (Math.abs(windVal - _audioLast.wind) > 0.0004) {
      _audioLast.wind = windVal;
      _windGain.gain.setTargetAtTime(windVal, t, 0.4);
    }
  }

  // These two are binary on/off — they change only when you start or stop
  // moving, so writing them every frame was pure waste.
  if (_hoovesGain) {
    const hv = isMoving ? 0.6 : 0;
    if (hv !== _audioLast.hooves) { _audioLast.hooves = hv; _hoovesGain.gain.setTargetAtTime(hv, t, 0.3); }
  }
  if (_birdsGain) {
    const bv = isMoving ? 0 : 0.8;
    if (bv !== _audioLast.birds) { _audioLast.birds = bv; _birdsGain.gain.setTargetAtTime(bv, t, 0.8); }
  }

  // Track the listener for the proximity system and the event schedulers.
  _listenerPos.x = worldX; _listenerPos.z = worldZ;
  _updateAmbientProximity(worldX, worldZ);   // internally throttled to ~12Hz

  // Event schedulers: both early-return on a timestamp compare, so running them
  // per frame costs two integer comparisons.
  const _now = performance.now();
  _tickHorseEvents(_now);
  // Day index drives the "at most 5 cars per day" budget. The day cycle is
  // ~8 minutes of real time, so this rolls the allowance over naturally.
  _tickCarEvents(_now, Math.floor(_now / (8 * 60 * 1000)));

  // Lake water: synthesised fallback. Silenced automatically once the real
  // water-lapping.mp3 sample loads (see _initAmbientSources).
  if (window._lakeGain) {
    const lakeCz = -113 + (window._xixNorthShift || 0);
    const _dy = _listenerY - 1.6;
    const lakeDist = Math.sqrt(worldX ** 2 + (worldZ - lakeCz) ** 2 + _dy * _dy);
    // Was (dist-30)/130 → still 0.41 gain at the centre spot 101m away.
    // Now silent by 85m, matching the sampled source above.
    const lakeVol = Math.max(0, 1 - Math.max(0, lakeDist - 30) / 55) * 0.9;
    if (Math.abs(lakeVol - _audioLast.lake) > 0.004) {
      _audioLast.lake = lakeVol;
      window._lakeGain.gain.setTargetAtTime(lakeVol, t, 0.25);
    }
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

  // ── CONE FALLBACK: OFF ────────────────────────────────────────────────────
  // Everything past CAP used to be drawn as a flat-shaded 7-sided green cone.
  // That was tolerable as a background filler BEHIND real instanced trees. It
  // stopped being tolerable once assets/tree-mesh.glb was removed, because the
  // GLB load then fails and EVERY tree in the estate falls through to a cone —
  // a sales tool full of green traffic cones.
  //
  // No trees reads better than obviously fake trees. Palms are a separate
  // system (the GPU wind shader) and are unaffected, so the estate keeps its
  // signature planting either way.
  //
  // Flip this back to true the moment a real assets/tree-mesh.glb exists: with
  // hero instances in front of them, cones do their original job of massing out
  // the far canopy at almost no cost.
  const TREE_CONE_FALLBACK = true;   // re-enabled: assets/tree-mesh.glb is back at 9.5k tris

  const coneList = TREE_CONE_FALLBACK ? _treePositions.slice(CAP) : [];
  if (!TREE_CONE_FALLBACK && _treePositions.length > CAP) {
    console.log(`[XIX] Trees: cone fallback disabled — ${_treePositions.length - CAP} distant positions left empty`);
  }
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
    requestShadowUpdate(2);   // new geometry → refresh static shadow map
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

    // Same wind treatment as the palms, but anchored by HEIGHT rather than uv.y
    // — this is real geometry, so the trunk must stay planted while the canopy
    // moves. Geometry is normalised to 9 m above, hence height: 9.
    const treeDepth = applyFoliageWind(mat, { mode: 'height', height: 9.0, amp: 0.55 });

    const trees = new THREE.InstancedMesh(geo, mat, heroList.length);
    trees.customDepthMaterial = treeDepth;
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
    requestShadowUpdate(2);   // new geometry → refresh static shadow map

    const tris = Math.round(geo.attributes.position.count / 3);
    console.log(`[XIX] Trees: ${heroList.length} radial-shell instances, ${tris.toLocaleString()} tris each`);
  }, undefined, () => console.warn(
    '[XIX] assets/tree-mesh.glb not found — NO trees will render. ' +
    'The cone fallback is disabled (see TREE_CONE_FALLBACK). Palms are unaffected.'));
}

// ─── INSTANCED VILLA RENDERING WITH LOD ───────────────────────────────────────
// Impostor: fully invisible during load AND at LOD distance.
// The previous version gave it a beige colour "so distant villas read as blocks"
// but at orbital distance the box shape reads as wrong architecture and kills
// realism. Invisible is correct — a missing villa at distance is less jarring
// than a white cube. depthWrite:false prevents it from occluding anything behind it.
const _impostorMat = new THREE.MeshBasicMaterial({
  transparent: true, opacity: 0, depthWrite: false, visible: false,
});
const _impostorGeo = new THREE.BoxGeometry(14, 8, 12);

// ─── MERGE A LOADED GLB BY MATERIAL (Option D) ───────────────────────────────
// Collapses a model's many small meshes into one mesh per material. Draw calls
// are per-mesh-per-material, so a villa of 30 meshes sharing 8 materials drops
// from 30 submissions to 8 — and that saving multiplies across all 43 clones.
//
// Deliberately conservative. Anything that cannot be safely merged is left as
// its own mesh and simply re-parented:
//   • skinned or morph-target meshes (merging would destroy the rig)
//   • glass panels (the night-glow system drives these individually)
//   • anything whose geometry lacks the attributes of its group
// Returns null on failure so the caller falls back to the unmerged scene.
function _mergeSceneByMaterial(root) {
  try {
    root.updateMatrixWorld(true);
    const groups = new Map();     // material -> [geometry(baked)]
    const keepAsIs = [];
    let meshCount = 0, matSet = new Set();

    root.traverse(o => {
      if (!o.isMesh) return;
      meshCount++;
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      if (mat) matSet.add(mat.uuid);

      // Never merge these — keep them intact and re-parent them later.
      if (o.isSkinnedMesh || o.morphTargetInfluences?.length ||
          o.userData.isGlassPanel || Array.isArray(o.material)) {
        keepAsIs.push(o);
        return;
      }
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
      g.applyMatrix4(o.matrixWorld);
      // Strip attributes that aren't shared across the group, or the merge fails
      for (const name of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      }
      if (!g.attributes.uv) {
        // Merge requires a consistent attribute set — synthesise a flat UV
        const n = g.attributes.position.count;
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
      }
      if (!groups.has(mat)) groups.set(mat, []);
      groups.get(mat).push(g);
    });

    if (meshCount === 0) return null;

    const out = new THREE.Group();
    let mergedMeshes = 0;
    groups.forEach((geos, mat) => {
      if (geos.length === 1) {
        const m = new THREE.Mesh(geos[0], mat);
        m.castShadow = false; m.receiveShadow = true;
        out.add(m); mergedMeshes++;
        return;
      }
      const merged = BufferGeometryUtils.mergeGeometries(geos, false);
      geos.forEach(g => g.dispose());
      if (!merged) return;
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = false; m.receiveShadow = true;
      out.add(m); mergedMeshes++;
    });

    // Re-parent the un-mergeable meshes with their world transform preserved
    keepAsIs.forEach(o => {
      const c = o.clone();
      c.matrix.copy(o.matrixWorld);
      c.matrix.decompose(c.position, c.quaternion, c.scale);
      out.add(c);
    });

    const after = mergedMeshes + keepAsIs.length;
    console.log(
      `[XIX] Villa GLB merged: ${meshCount} meshes / ${matSet.size} materials → ` +
      `${after} draw calls each (x43 villas = ${meshCount * 43} → ${after * 43})`
    );
    return out;
  } catch (e) {
    console.warn('[XIX] Villa merge failed, using unmerged model:', e.message);
    return null;
  }
}

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

  // Real low-poly level at VILLA_LOD_SWAP (see loadVillaLowGLB). Until it loads, fall back
  // to the invisible impostor at 400m so nothing pops in as a box.
  if (villaLowScene) {
    const low = villaLowScene.clone(true);
    low.rotation.y = 0;
    lod.addLevel(low, VILLA_LOD_SWAP);
  } else {
    const lowDetail = new THREE.Mesh(_impostorGeo, _impostorMat);
    lowDetail.position.y = 4;
    // Marked so villa-lod-budget.js never picks it as a real tier. Without this,
    // a hero budget of 0 (fast mode) plus a missing low tier left every villa
    // showing an invisible placeholder — the estate rendered empty.
    lowDetail.userData.isLODPlaceholder = true;
    lod.addLevel(lowDetail, 400);
  }

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
let _aerialModeActive = false;
// Quality tier saved before aerial entry so it can be restored on exit.
// Aerial is the flagship shot — it should always render at the highest
// quality the device's GPU can sustain, regardless of walking-mode tier.
let _aerialSavedPerfMode = null;

export function setAerialMode(on) {
  _aerialModeActive = on;
  // Mirror onto window. app.js reads window._aerialModeActive to exempt aerial
  // from the hover-distance gate and the double-click gate. It was never being
  // set, so every one of those checks silently evaluated undefined -> false and
  // aerial hover stayed dead. Any new aerial-dependent logic must read this.
  if (typeof window !== 'undefined') window._aerialModeActive = on;
  const sun = getSunLight ? getSunLight() : null;
  if (on) {
    // Aerial no longer forces 'rich'. The user chose to prioritise smoothness,
    // and the adaptive governor owns the quality tier — forcing rich here would
    // fight it and reintroduce the lag. We keep whatever tier is active and only
    // make the two cheap improvements that help the wide shot without cost:
    // full villa LOD (no simplified buildings in the hero view) and a widened
    // shadow frustum to cover the whole estate. Pixel ratio is left as the
    // current tier set it — no 2.5× override.
    _aerialSavedPerfMode = null;  // nothing to restore; we don't change the tier

    // Force every villa to full detail (geometry swap only — negligible cost at
    // orbital distance since there's no character movement competing for the GPU)
    // Aerial keeps normal LOD now. The old override forced every villa to full
    // detail (levels[1].distance = 1e6) purely because the fallback level was
    // invisible — with a real low-poly level there is nothing to hide, and this
    // is what was rendering 33M triangles from the air.
    if (sun && sun.shadow) {
      const cam = sun.shadow.camera;
      _aerialSavedFrustum = { l: cam.left, r: cam.right, t: cam.top, b: cam.bottom, f: cam.far };
      // 380m half-extent covers the full WORLD bounds with margin
      cam.left = -380; cam.right = 380; cam.top = 380; cam.bottom = -380;
      cam.far  = 900;
      cam.updateProjectionMatrix();
      requestShadowUpdate(2);   // frustum changed → regenerate once
    }
  } else {
    // Restore LOD distances
    // Nothing to restore — aerial no longer overrides LOD distances.
    // Restore shadow frustum
    if (sun && sun.shadow && _aerialSavedFrustum) {
      const cam = sun.shadow.camera, f = _aerialSavedFrustum;
      cam.left = f.l; cam.right = f.r; cam.top = f.t; cam.bottom = f.b; cam.far = f.f;
      cam.updateProjectionMatrix();
      _aerialSavedFrustum = null;
      requestShadowUpdate(2);   // frustum restored → regenerate once
    }
    // Restore PERF_MODE to what it was before aerial entry.
    // Walking mode uses whatever tier was set (fast on mobile, etc.);
    // rich was only appropriate for the slow orbital shot.
    if (_aerialSavedPerfMode && _aerialSavedPerfMode !== PERF_MODE) {
      setPerfMode(_aerialSavedPerfMode);
      if (typeof setPerfModeGraphics === 'function') setPerfModeGraphics(_aerialSavedPerfMode);
      // Restore pixel ratio for the saved tier
      if (renderer) {
        const savedS = PERF_SETTINGS[_aerialSavedPerfMode];
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, savedS ? savedS.pixelRatio : 1.5));
      }
    }
    _aerialSavedPerfMode = null;
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
  { label:'Crescent Lake',        sublabel:'200m  ·  Waterfront plots',            pos:[30, 14, -115 + 12],  productKey:null }, // +12 = north group shift
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
  // IDEMPOTENT: remove and dispose any existing hotspot sprites first.
  // The duplicate "crossed box" behind each label was caused by this running
  // more than once (a quality/graphics-pipeline rebuild re-adding labels without
  // clearing the old ones). Whatever calls it, we now guarantee exactly one
  // sprite per landmark by tearing down the previous set here.
  if (_hotspots.length) {
    _hotspots.forEach(h => {
      if (h.sprite) {
        scene.remove(h.sprite);
        if (h.sprite.material) {
          if (h.sprite.material.map) h.sprite.material.map.dispose();
          h.sprite.material.dispose();
        }
      }
    });
    _hotspots.length = 0;
  }

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

  // ─── PLOT-AWARE HEDGE SIZING ───────────────────────────────────────────────
  // The old hedge was a fixed 22.1m x 18.1m box around EVERY villa
  // (W=10.5, D=8.5, T=0.55, extending to ±(W+T)). That is wider than the gap
  // between villas on the curved north arc, where 11 villas span 126m — about
  // 12.6m apart. Each hedge therefore overlapped its neighbours by ~9.5m per
  // side, which is why the bend read as one continuous green mass instead of
  // individual plots.
  // Each villa's hedge is now sized to its OWN nearest-neighbour distance, so
  // the tight arc gets narrow, well-separated hedges while the generously
  // spaced straight rows keep full-width ones. Nothing is hand-tuned per villa.
  const GAP = 2.2;          // clear space left between adjacent plot boundaries
  const W_MAX = 9.0;        // widest half-width (straight rows)
  const W_CLEAR = 6.2;      // minimum half-width that still clears the villa
                            // footprint (11.4m wide = 5.7m half-width) plus margin

  // For each villa: the widest hedge that fits without touching its neighbour.
  // Where even W_CLEAR won't fit — the tight north arc, where villas sit 12.6m
  // apart but are themselves 11.4m wide — we do NOT shrink the hedge into the
  // building or overlap the neighbour. We omit the side boundaries entirely for
  // that plot (see sideOK below) and let the gap between buildings and the
  // cypress trees provide the separation instead. An honest empty boundary
  // reads far cleaner than two hedges ploughing through each other.
  const fitted = _hedgeInstData.map((v, i) => {
    let nearest = Infinity;
    for (let j = 0; j < _hedgeInstData.length; j++) {
      if (i === j) continue;
      const o = _hedgeInstData[j];
      const d = Math.hypot(o.x - v.x, o.z - v.z);
      if (d < nearest) nearest = d;
    }
    if (!isFinite(nearest)) return { W: W_MAX, sideOK: true };
    const avail = nearest / 2 - GAP / 2;
    if (avail < W_CLEAR) return { W: W_CLEAR, sideOK: false };  // too tight — rear only
    return { W: Math.min(W_MAX, avail), sideOK: true };
  });

  // Thinner and slightly lower than before: T 0.55 -> 0.32 and height
  // 1.4 -> 1.05. A trimmed 1m boundary hedge reads as a crisp plot line;
  // the old chunky 1.4m block visually fused neighbouring plots together.
  const T = 0.32;
  const HEDGE_H = 1.05;

  const geo = new THREE.BoxGeometry(1, HEDGE_H, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2d5a1e, roughness: 0.95, metalness: 0, envMapIntensity: 0.2,
  });

  const total = _hedgeInstData.length * 5;   // upper bound; mesh.count trimmed below
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  let idx = 0;
  let tightCount = 0;

  _hedgeInstData.forEach(({ x, z, ry }, i) => {
    const { W, sideOK } = fitted[i];
    const D = Math.min(8.0, W * 0.85);   // depth follows width so plots stay proportional
    if (!sideOK) tightCount++;

    // NO FRONT (field-facing) HEDGE.
    // The old front segment sat at lz = -(D+T), 21m wide, pointing at the field.
    // On the north arc that direction is the crescent lake, so those hedges ran
    // straight into the water — the untidy lines cutting through the lake and
    // the setback. Removing it also matches how these plots would really be
    // landscaped: a polo-facing villa keeps an open frontage onto the field
    // rather than screening its own view with a hedge.
    const segments = [
      // Rear boundary, split either side of the driveway entrance. Always built.
      { lx: -(W * 0.5 + 0.8), lz:  D + T,      sx: W - 1.6,  sz: T },
      { lx:  (W * 0.5 + 0.8), lz:  D + T,      sx: W - 1.6,  sz: T },
    ];

    if (sideOK) {
      // Left side boundary (full depth)
      segments.push({ lx: -(W + T), lz: 0,         sx: T, sz: D * 2 });
      // Right side boundary, broken into two runs with a service gap
      segments.push({ lx:  (W + T), lz: -D * 0.30, sx: T, sz: D * 1.25 });
      segments.push({ lx:  (W + T), lz:  D * 0.68, sx: T, sz: D * 0.58 });
    }

    const cosR = Math.cos(ry), sinR = Math.sin(ry);
    segments.forEach(seg => {
      if (seg.sx <= 0 || seg.sz <= 0) return;
      const wx = x + seg.lx * cosR - seg.lz * sinR;
      const wz = z + seg.lx * sinR + seg.lz * cosR;
      dummy.position.set(wx, HEDGE_H / 2, wz);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(seg.sx, 1, seg.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx++, dummy.matrix);
    });
  });

  mesh.count = idx;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.name = 'villaHedges';
  scene.add(mesh);

  const ws = fitted.map(f => f.W);
  console.log(`[XIX] Hedges: ${idx} segments, half-widths ${Math.min(...ws).toFixed(1)}–${Math.max(...ws).toFixed(1)}m; ${tightCount} tight plots use rear boundary only`);
}

// ─── AO CONTACT SHADOWS ───────────────────────────────────────────────────────
// ─── STATIC GEOMETRY MERGING (Tier 4) ────────────────────────────────────────
// Integrated GPUs are disproportionately hurt by draw-call count: each one is a
// CPU-side state change and a driver submission, and shared-memory graphics have
// far less headroom for that than a discrete card. These helpers collapse large
// numbers of identical or same-material static meshes into single submissions.
//
// mergeStaticMeshes(): bakes each mesh's transform into its geometry and merges
// them into one BufferGeometry. Safe here because every source mesh is static
// and shares one material, and because merging preserves each source geometry's
// own UVs — so tiled textures look exactly as they did before.
function mergeStaticMeshes(meshes, material, name) {
  if (!meshes.length) return null;
  const geos = [];
  for (const m of meshes) {
    m.updateMatrix();
    // toNonIndexed() normalises indexed vs non-indexed sources, which
    // mergeGeometries requires to be consistent across the whole set.
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone());
    g.applyMatrix4(m.matrix);
    geos.push(g);
  }
  let merged = null;
  try {
    merged = BufferGeometryUtils.mergeGeometries(geos, false);
  } catch (e) {
    console.warn('[XIX] merge failed for', name, e.message);
  }
  geos.forEach(g => g.dispose());
  if (!merged) return null;
  const mesh = new THREE.Mesh(merged, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = name;
  return mesh;
}

// Contact shadows: previously ONE Mesh AND ONE MeshBasicMaterial per villa
// (43 of each). Identical geometry, identical material, differing only in
// position — the textbook case for instancing. Now 1 draw call, 1 material.
const _contactShadowData = [];
function addVillaContactShadow(x, z) {
  _contactShadowData.push({ x, z });
}

function commitVillaContactShadows() {
  if (!_contactShadowData.length) return;
  const aoMat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.22,
    depthWrite: false, side: THREE.FrontSide,
  });
  const geo = new THREE.PlaneGeometry(18, 14);
  geo.rotateX(-Math.PI / 2);   // bake the ground orientation into the geometry
  const inst = new THREE.InstancedMesh(geo, aoMat, _contactShadowData.length);
  const d = new THREE.Object3D();
  _contactShadowData.forEach((p, i) => {
    d.position.set(p.x, 0.05, p.z);
    d.updateMatrix();
    inst.setMatrixAt(i, d.matrix);
  });
  inst.instanceMatrix.needsUpdate = true;
  inst.frustumCulled = false;   // spread across the whole estate
  inst.name = 'villaContactShadows';
  scene.add(inst);
  console.log(`[XIX] Contact shadows: ${_contactShadowData.length} meshes → 1 instanced draw call`);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
let sunLight, hemiLight;
let _envMapRef = null;

// ─── MOBILE / GPU TIER AUTO-DETECTION ────────────────────────────────────────
// Call detectMobileTier() immediately after renderer is created in initScene().
// On mobile UA: locks PERF_MODE to 'fast' regardless of user setting.
// On low-end GPU: caps at 'balanced' if max texture size < 4096.
// ─── GPU CAPABILITY DETECTION ────────────────────────────────────────────────
// Returns 'weak' | 'integrated' | 'discrete'.
//
// The previous heuristic (MAX_TEXTURE_SIZE < 4096) was effectively dead code:
// Intel UHD and Iris Xe both report 16384, so every integrated laptop GPU sailed
// past it and was treated as a high-end desktop card. That is why an HP EliteBook
// ended up running the full Rich pipeline (GTAO + 4096 shadows + planar water)
// that it has no chance of sustaining. We now read the actual renderer string.
function detectGPUTier() {
  if (!renderer) return 'integrated';           // assume modest until proven otherwise
  let name = '';
  try {
    const gl  = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    if (!name) name = String(gl.getParameter(gl.RENDERER) || '');
  } catch (e) { /* blocked by privacy settings — fall through */ }

  window._xixGPUName = name;

  // Software / fallback renderers — barely render at all
  if (/SwiftShader|llvmpipe|Software|Microsoft Basic|ANGLE \(Microsoft\)/i.test(name)) return 'weak';

  // Discrete cards that can genuinely sustain the full pipeline.
  // Apple Silicon is technically integrated but performs like a discrete GPU.
  if (/NVIDIA|GeForce|RTX|GTX|Quadro|Radeon RX|Radeon Pro|Arc A\d|Apple M\d/i.test(name)) return 'discrete';

  // Intel integrated (UHD, Iris, Iris Xe, HD Graphics) and AMD Vega/Radeon
  // integrated graphics — the EliteBook case.
  if (/Intel|UHD|Iris|HD Graphics|Vega \d|Radeon\(TM\) Graphics|Mesa/i.test(name)) return 'integrated';

  return 'integrated';   // unknown → assume integrated; safer to under-promise
}

// iPad reports as Macintosh in modern iPadOS Safari, so UA alone misses it.
// Touch support plus no mouse is the reliable signal.
function _isTabletOrIOS() {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ desktop-mode Safari
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return true;   // Android tablet
  return false;
}

function detectMobileTier() {
  const isMobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent) || _isTabletOrIOS();
  if (isMobile) {
    PERF_MODE = 'fast';
    if (typeof setPerfModeGraphics === 'function') setPerfModeGraphics('fast');
    console.log('[XIX] Mobile UA detected → PERF_MODE locked to fast');
    window._xixGPUTier = 'mobile';
    window._xixMaxTier = 'fast';
    return;
  }

  const tier = detectGPUTier();
  window._xixGPUTier = tier;

  // Cap the tier this machine is ALLOWED to reach. The Quality buttons and the
  // adaptive governor both respect this ceiling, so a machine can never be put
  // into a mode it cannot sustain — by the user, by aerial, or by anything else.
  const TIER_CAP = { weak: 'fast', integrated: 'balanced', discrete: 'rich' };
  const cap = TIER_CAP[tier] || 'balanced';
  window._xixMaxTier = cap;

  const ORDER = ['fast', 'balanced', 'rich'];
  if (ORDER.indexOf(PERF_MODE) > ORDER.indexOf(cap)) {
    PERF_MODE = cap;
    if (typeof setPerfModeGraphics === 'function') setPerfModeGraphics(cap);
  }

  console.log(`[XIX] GPU: "${window._xixGPUName || 'unknown'}" → tier=${tier}, max quality=${cap}, active=${PERF_MODE}`);
}


export function getSunLight() { return sunLight; }

// ─── STATIC SHADOW MAP CONTROL ───────────────────────────────────────────────
// renderer.shadowMap.autoUpdate is OFF (see initScene). Anything that genuinely
// changes what the shadows should look like must call this. It is cheap: it
// sets a flag, and three.js renders the shadow map on the NEXT frame only.
// Called on: time-of-day change, GLB model arrival, aerial shadow-frustum
// change, and weather changes that alter sun intensity.
export function requestShadowUpdate(frames = 1) {
  if (!renderer || !renderer.shadowMap) return;
  renderer.shadowMap.needsUpdate = true;
  // Some changes (a GLB streaming in over several frames) need a couple of
  // consecutive updates to settle; queue them rather than leaving autoUpdate on.
  if (frames > 1) {
    let n = frames - 1;
    const again = () => {
      if (n-- <= 0 || !renderer) return;
      renderer.shadowMap.needsUpdate = true;
      requestAnimationFrame(again);
    };
    requestAnimationFrame(again);
  }
}

export function initScene(canvas) {
  clock = new THREE.Clock();
  const perfS = PERF_SETTINGS[PERF_MODE];

  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference:"high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, perfS.pixelRatio));
  renderer.shadowMap.enabled   = true;
  renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
  // ─── PERF: STATIC SHADOW MAP ────────────────────────────────────────────
  // The estate is geometrically static and the sun only moves when the time
  // preset changes (4x per day cycle). With autoUpdate left on, three.js
  // re-renders the ENTIRE scene into the shadow depth buffer every frame —
  // at 4096x4096 in Rich that is the single largest cost in the frame, spent
  // reproducing an identical result 60 times a second.
  // Turning autoUpdate off and flagging needsUpdate only when something
  // actually changes is visually IDENTICAL and removes that whole pass.
  // requestShadowUpdate() below is called on: sun/time change, GLB arrival,
  // aerial frustum change, and the first few frames after load.
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;   // render it once now
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85; 
  renderer.outputColorSpace    = THREE.SRGBColorSpace;
  detectMobileTier(); // Auto-lock PERF_MODE for mobile/low-end GPU

  scene  = new THREE.Scene();
  // Initial fog matches the 'afternoon' preset the scene starts in (see
  // updateSkyForTime) so the first frames don't render with a stale colour.
  scene.fog = new THREE.FogExp2(0xb8ccd6, perfS.fogDensity);

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
    // LOAD ORDER — RESTORED TO THE PROVEN SEQUENCE. Do not reorder.
    // The comment above this block is the original author's and it is correct:
    // the main asset loads FIRST and everything else is staggered to avoid a
    // Draco Web Worker collision.
    //
    // I broke this by loading the low model first and moving loadVillaGLB() to
    // a 1200ms timer — which put it on the SAME tick as loadClubhouseGLB().
    // The resulting worker contention made villa-mesh.glb fail, and its error
    // handler falls back to _createVillaFallback() — the big drawn boxes.
    // The load-time gain was not worth breaking the primary asset.
    loadVillaGLB();
    addVillaRing();

    setTimeout(() => { loadLoftGLB(); addLoftTerraces(); }, 400);
    setTimeout(() => { loadApartmentGLB(); addWestCompound(); }, 800);
    setTimeout(() => { loadClubhouseGLB(); }, 1200);
    setTimeout(() => { loadStablesGLB(); }, 1600);
    // Low-poly LOD loads LAST, on its own slot, well clear of everything else.
    // It is an enhancement: if it never arrives the estate still renders
    // correctly using the full model at every distance.
    setTimeout(() => loadVillaLowGLB(), 2600);

    // LOAD-PHASE SHADOW SAFETY NET ─────────────────────────────────────────
    // Models stream in asynchronously over several seconds. Rather than leave
    // shadowMap.autoUpdate on (which costs a full shadow re-render every frame
    // forever), refresh the static shadow map a handful of times across the
    // load window. After that the scene is static and no further updates are
    // needed until the sun moves.
    [600, 1400, 2400, 3600, 5200, 7000, 9000].forEach(t =>
      setTimeout(() => requestShadowUpdate(1), t)
    );
    // loadHorseGLB() no longer called — see the no-op definition above.
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
  // Sun has moved → the shadow map is now stale. This is one of the few
  // moments it genuinely needs regenerating (see initScene autoUpdate note).
  requestShadowUpdate(2);
  if (scene && scene.fog) {
    // Haze colour is scattered horizon light, so it must be noticeably LIGHTER
    // than the sky above and shift with the sun. The old single blue (0x8ab8cc)
    // for both morning and afternoon read as a flat blue wash once the density
    // was raised to a visible level.
    // Morning carries the warm dusty cast typical of the harmattan-influenced
    // Lagos coast; afternoon is a brighter, cooler humid haze; sunset picks up
    // the low warm sun; night is deep blue rather than pure black so distant
    // geometry recedes into atmosphere instead of disappearing.
    const fogColors = {
      morning:   0xc4bda8,   // warm, dusty — low sun through humid air
      afternoon: 0xb8ccd6,   // bright humid haze
      sunset:    0xd08a5a,   // warm scattered low-angle light
      night:     0x0a1420,   // deep blue, not black
    };
    scene.fog.color.set(fogColors[timeName] || 0xb8ccd6);
  }
  // Soundscape follows the light: crossfade to this time's ambience bed.
  window._currentTimeName = timeName;
  setTimeBed(timeName);
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

  // Lighting rig (re)built → static shadow map must be regenerated once.
  requestShadowUpdate(2);
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
// Raised across the board: 8 real lights over a 700m estate left most of it
// unlit at night. Point lights are cheap relative to the visual payoff here,
// and they are pooled to only the nearest lamps so cost stays bounded.
const LAMP_POOL_SIZE = { fast: 8, balanced: 18, rich: 28 };
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
    // Reach raised 24m -> 55m and decay softened 1.8 -> 1.2.
    // At 24m/1.8 each lamp lit barely a few metres of ground, so the estate
    // read as black at night despite 94 posts being present. Warmer colour too
    // (0xffb35c) — sodium/LED estate lighting, not a dim orange point.
    const pt = new THREE.PointLight(0xffb35c, 0, 55, 1.2);
    pt.visible = false;
    scene.add(pt); _lampPool.push(pt); _nightLights.push({ pt });
  }
  console.log(`[XIX] Lamps: ${lampPositions.length} posts, ${poolSize} pooled point lights`);
}

// Reassign the pool to the nearest lamps. Driven from tickScene.
const _lampSort = [];
// Preallocated scratch for the lamp pool so it never allocates per frame.
const _lampScratch = [];
let   _lampLastSortX = Infinity, _lampLastSortZ = Infinity;

export function tickLampPool(camera) {
  if (!_lampPool.length || !_nightLightsActive || !camera) return;
  const cx = camera.position.x, cz = camera.position.z;

  // Only re-sort when the camera has actually moved a meaningful distance.
  // Lamp ranking barely changes between adjacent frames, so re-sorting 58
  // entries every frame was pure waste plus GC churn from the old
  // `_lampSort.push({n, d2})` object-per-lamp-per-frame pattern.
  const movedFar = ((cx - _lampLastSortX) ** 2 + (cz - _lampLastSortZ) ** 2) > 4; // >2m
  if (movedFar || _lampScratch.length !== _lampNodes.length) {
    _lampLastSortX = cx; _lampLastSortZ = cz;
    _lampScratch.length = 0;
    for (let i = 0; i < _lampNodes.length; i++) {
      const n = _lampNodes[i];
      const dx = n.x - cx, dz = n.z - cz;
      // Reuse existing entry objects instead of allocating new ones
      _lampScratch.push(n._e || (n._e = { n, d2: 0 }));
      _lampScratch[i].d2 = dx * dx + dz * dz;
    }
    _lampScratch.sort((a, b) => a.d2 - b.d2);
  } else {
    // Camera barely moved: refresh distances on the already-sorted set only
    for (let i = 0; i < _lampScratch.length; i++) {
      const n = _lampScratch[i].n;
      const dx = n.x - cx, dz = n.z - cz;
      _lampScratch[i].d2 = dx * dx + dz * dz;
    }
  }

  const R2 = 150 * 150;   // was 90m — too tight to light a walk down a street
  for (let i = 0; i < _lampPool.length; i++) {
    const s = _lampScratch[i], pt = _lampPool[i];
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

  // Raised from 3.2 — night is the signature look here and it was reading flat.
  _lampTargetIntensity = isNight ? 6.5 : isSunset ? 2.4 : 0;

  // Drive emissive glow on every lamp globe (post + sconce)
  // Every post glows even when no pooled PointLight is assigned to it, so the
  // estate reads as fully lit from the air. Raised 4.0 -> 9.0.
  const globeInt = isNight ? 9.0 : isSunset ? 2.6 : 0.0;   // "very bright at night" — raised from 2.8
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

      // ── 4b. CLUBHOUSE HARDSCAPE OVERRIDE ────────────────────────────────
      // The clubhouse sits at (0, 108) — well inside the grass radius, so the
      // shader rendered grass under and around it (the "green blob"). The car
      // park geometry planes sit on top but can't cover the full irregular
      // shader area at grazing aerial angles. Override the albedo to dark
      // asphalt-grey across the whole clubhouse precinct so no green shows
      // through regardless of camera angle or plane coverage.
      // Ellipse over the clubhouse CAR PARK precinct only: centre (0, 148),
      // half-extents 150m (x) × 48m (z) → covers z 100..196, x ±150. This is
      // the car-park + building footprint. It stops at z≈100, north of which
      // is the field safety zone (z<86) and south villas (z≈88) — those keep
      // their grass. South edge z≈196 reaches the perimeter road.
      float clubDX = wx.x / 150.0;
      float clubDZ = (wx.y - 148.0) / 48.0;
      float clubR  = sqrt(clubDX*clubDX + clubDZ*clubDZ);
      float clubMask = 1.0 - smoothstep(0.82, 1.0, clubR);
      float asphN = fbm2(wx * 0.08 + 91.0);
      vec3 asphaltCol = mix(vec3(0.14,0.14,0.145), vec3(0.19,0.19,0.20), asphN);
      finalAlbedo = mix(finalAlbedo, asphaltCol, clubMask);

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
  // Plot highlights are UI, not scene geometry, so they use MeshBasicMaterial
  // (UNLIT). Previously these were MeshStandardMaterial, which meant the
  // highlight was lit by the sun — it dimmed in shadow and almost disappeared
  // at night, exactly when a highlight most needs to read. Unlit gives the same
  // brightness at any time of day and is cheaper to shade.
  // depthTest:false + renderOrder 999 means it always draws OVER the building,
  // so the highlight is never hidden by the roof at aerial angles.
  plotAvail:  () => new THREE.MeshBasicMaterial({color:0x2bff88,transparent:true,opacity:0,depthWrite:false,depthTest:false,side:THREE.DoubleSide}),
  plotReserved:()=> new THREE.MeshBasicMaterial({color:0xff4444,transparent:true,opacity:0,depthWrite:false,depthTest:false,side:THREE.DoubleSide}),
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
    [ 185, 118, [-260, 0.14, -38], { chevron:true  } ],  // training field — wider/taller, covers laterite gaps at edges
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
    // E/W villa frontage lawns — depth reduced from 360m to 150m so they span
    // only the field-length villa run (z ±75) and do NOT extend past the N/S
    // safety strips. The 360m version created a grass band at the outer edge of
    // the shortened N/S safety zones (the green you flagged). Beyond z=±75 the
    // ground shader handles the surface (grass near centre, laterite outward).
    [ 90, 150, [-200, 0.07,   0], { chevron:false } ],  // west villa frontage (x -155..-245, z ±75)
    [ 90, 150, [ 200, 0.07,   0], { chevron:false } ],  // east villa frontage
    [ 430, 108, [   0, 0.07, -156 + NORTH_SHIFT], { chevron:false } ], // north: lake surround + arc frontage (shifted with north group)
    // Far-south grass planes removed — the clubhouse hardscape shader override
    // and the perimeter road now cover z>100; no flat grass fill needed there.
    [  80,  90, [ 240, 0.09,  -30], { chevron:false } ], // paddock turf
    [  80,  80, [ 240, 0.09,   45], { chevron:false } ], // game park turf
    // West compound: single strip north of the training field. Ground shader
    // handles laterite colouring elsewhere in the compound.
    [  60,  80, [-320, 0.09,  55], { chevron:false } ],  // north of training field
  ];
  greens.forEach(([w, dp, pos, o]) => {
    const m = turfPlane(w, dp, pos, Object.assign({ markings:false, wear:false, wind:1.0 }, o));
    scene.add(m); _terrainMeshes.push(m);
  });

  // Hard surfaces
  // Cobblestone yard at the stables (unchanged)
  // Stables yard cobble. Was MATS.cobble() — a shared PBR.stone() whose UVs run
  // 0..1 across the whole plane, so the texture was stretched across 90 x 70
  // metres and the stones read as huge smeared slabs.
  // Same treatment as the safety zone: clone the material and set the texture
  // repeat from the plane's PHYSICAL size, so one tile covers a fixed number of
  // metres regardless of how large the plane is.
  {
    const COBBLE_TILE_M = 3.2;          // one texture tile per 3.2m of ground
    const cm = MATS.cobble();
    ['map', 'normalMap', 'roughnessMap', 'aoMap'].forEach(slot => {
      const t = cm[slot];
      if (!t) return;
      const t2 = t.clone();
      t2.needsUpdate = true;
      t2.wrapS = t2.wrapT = THREE.RepeatWrapping;
      t2.repeat.set(90 / COBBLE_TILE_M, 70 / COBBLE_TILE_M);
      t2.anisotropy = PERF_MODE === 'rich' ? 16 : 8;
      cm[slot] = t2;
    });
    cm.needsUpdate = true;
    s(plane(90, 70, cm, [-355, .02, 90]));
  }

  // ── CLUBHOUSE CAR PARKS ───────────────────────────────────────────────────
  // The masterplan shows a large asphalt car park behind the clubhouse (south,
  // z > 108) and flanking both sides. The previous concrete plane was 180×80
  // centred at z=122, which only covered the rear face partially and used the
  // wrong material (concrete, not asphalt). Three asphalt planes now match the
  // masterplan: rear centre, left wing, right wing.
  // Clubhouse centre: x=0, z=108, footprint ~48×22m, rotation PI (faces -Z).
  // Rear (south): starts at z=120 (just clear of building rear), extends to ~z=185.
  // Left/right wings: flank the building and the rear approach.
  const asphaltMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a2a, roughness: 0.94, metalness: 0.0, envMapIntensity: 0.08,
  });
  asphaltMat.userData.isRoadSurface = true;
  // TIER 4: the six car-park surfaces all share asphaltMat and never move, so
  // they merge into a single draw call rather than six.
  // ONE clean apron instead of six overlapping rectangles.
  // The clubhouse precinct had six car-park planes at y=0.09 plus four roads at
  // y=0.13 crossing through them — ten surfaces at two heights with mismatched
  // edges, which read as the messy cluster of tarmac around the clubhouse.
  // A single rectangle covering the whole precinct is cleaner, is one draw call
  // instead of six, and removes every seam and z-fight between them.
  // 300 x 86 centred at (0,147) => x -150..150, z 104..190: forecourt, both
  // wings and the rear parking in one surface.
  const _carParkPieces = [
    plane(300, 86, asphaltMat, [0, .09, 147]),
  ];
  const mergedParks = mergeStaticMeshes(_carParkPieces, asphaltMat, 'carParksMerged');
  if (mergedParks) {
    scene.add(mergedParks);
  } else {
    _carParkPieces.forEach(m => scene.add(m));
  }
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

  // Safety zone proportions — revised after visual review:
  // N/S run-off (behind goals): halved from 25m to 13m deep. Centre shifts from
  // ±85.5m to ±79.5m (field half-depth 73m + 6.5m half-strip = 79.5m).
  // E/W side strips: narrowed from 27m to 20m and shifted inward so their
  // outer edge (±157m) clears the villa footprint at ±162m. Inner edge at
  // ±137m matches the field edge exactly.
  s(plane(298, 13, mkMat(298, 13), [0, .11, -79.5]));   // north (behind N goal)
  s(plane(298, 13, mkMat(298, 13), [0, .11,  79.5]));   // south (behind S goal)
  s(plane(20, 146, mkMat(20, 146), [-147, .11, 0]));     // west side strip
  s(plane(20, 146, mkMat(20, 146), [ 147, .11, 0]));     // east side strip
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

  // TIER 4: all asphalt road surfaces are static and share `am`, so they are
  // built into an array and merged into ONE mesh rather than added individually.
  // That takes 15 separate draw calls down to 1. Merging preserves each plane's
  // own 0-1 UVs, so the 120x tiled asphalt texture renders exactly as before.
  const _roadPieces = [
    plane(700, 30, am, [0, Y, 215]),

    plane(8, 220, am, [-155, Y, 0]),
    plane(8, 220, am, [ 155, Y, 0]),
    plane(320, 8, am, [0, Y, 104]),
    plane(240, 8, am, [0, Y, -104]),

    plane(8, 220, am, [-177, Y, -5]),
    plane(8, 220, am, [ 177, Y, -5]),

    plane(8, 280, am, [-270, Y, 20]),
    plane(8, 200, am, [-230, Y, 10]),
    plane(150, 8, am, [-310, Y, 145]),

    plane(8, 250, am, [ 200, Y, 10]),
    plane(55, 8, am, [ 215, Y, 120]),

    // REMOVED: plane(400, 8, [0,Y,128]) and plane(130, 35, [0,Y,148]).
    // Both sat INSIDE the clubhouse apron at a different height (0.13 vs 0.09),
    // so they showed as raised strips cutting across the parking with visible
    // seams. The apron covers this ground; the roads were redundant.
  ];

  // Grass median keeps its own material, so it stays a separate mesh.
  s(plane(700, 4, MATS.grassGreen(), [0, Y + 0.01, 215]));

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
  // Crescent road serves the north villa row — shift it with the north group.
  cMesh.position.set(0, Y, NORTH_SHIFT);
  _roadPieces.push(cMesh);

  const mergedRoads = mergeStaticMeshes(_roadPieces, am, 'roadsMerged');
  if (mergedRoads) {
    scene.add(mergedRoads);
    console.log(`[XIX] Roads: ${_roadPieces.length} meshes → 1 merged draw call`);
  } else {
    // Merge unavailable (CDN blocked / attribute mismatch) — fall back to the
    // original per-mesh behaviour so the roads always render.
    _roadPieces.forEach(m => scene.add(m));
  }
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

  // Reflection resolution. 1024 was overkill: the surface is heavily distorted
  // by the animated normal map, which destroys fine reflection detail anyway —
  // 512 is visually indistinguishable and quarters the reflection fill cost.
  const resPerMode = { fast: 256, balanced: 512, rich: 512 };
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
  // Rigid shift with the north group: +Z moves the lake toward the field by the
  // same amount the north villas moved, so the villa-to-lake gap is unchanged.
  lake.position.set(0, 0.34, NORTH_SHIFT);
  lake.name = 'crescentLake';
  lake.userData.isPlanarWater = true;

  // ─── PERF: THROTTLE + CULL THE PLANAR REFLECTION ─────────────────────────
  // THREE.Water renders the ENTIRE scene a second time, from a mirrored camera,
  // inside its onBeforeRender — every frame the lake is in view.
  // Two gates now guard that:
  //  1. CULL — skip entirely when the camera is far from the lake. At >220m the
  //     water is a thin band near the horizon and the reflection is not legible,
  //     so paying a full extra scene render for it is pure waste. This is what
  //     stops the clubhouse/south-end of the estate paying for water it can
  //     barely see.
  //  2. THROTTLE — when it IS close enough to matter, update every 2nd frame
  //     (Rich) or 3rd (Balanced) and reuse the previous buffer in between. The
  //     surface is animated and distorted, so half-rate is imperceptible.
  {
    const _origOnBeforeRender = lake.onBeforeRender;
    let _reflFrame = 0;
    const _lakeCx = 0, _lakeCz = -113 + NORTH_SHIFT;
    lake.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
      // 1. Distance cull
      const dx = camera.position.x - _lakeCx;
      const dz = camera.position.z - _lakeCz;
      const distSq = dx * dx + dz * dz;
      const CULL = (PERF_MODE === 'rich') ? 260 : 200;
      if (distSq > CULL * CULL) return;      // too far to read — reuse last buffer

      // 2. Half/third-rate update
      const every = (PERF_MODE === 'rich') ? 2 : 3;
      if ((_reflFrame++ % every) !== 0) return;

      _origOnBeforeRender.call(this, renderer, scene, camera, geometry, material, group);
    };
  }

  scene.add(lake);
  waterMeshes.push(lake);
  window._xixLakeWater = lake;

  // addLakeBanks() REMOVED. This produced the crescent-shaped greenery (graded
  // bank rings, reeds, boulders, shrubs). It was originally rendering around the
  // clubhouse because its edge points were authored at positive Z while the
  // water sits at negative Z; moving it to the lake made it correct but still
  // unwanted. Removed outright rather than left disabled — the function body is
  // gone too, so nothing can re-enable it by accident.
  // The lake now reads as a clean water body against the ground shader.
}

// ══════════════════════════════════════════════════════════════════════════
//  LAKE BANKS
// ══════════════════════════════════════════════════════════════════════════
//  A hard line between turf and water reads as a swimming pool. Real banks
//  have a wet margin, reed beds, boulders and scattered planting. All of it
//  is instanced, so the whole shoreline costs 4 draw calls.
// ══════════════════════════════════════════════════════════════════════════
// addLakeBanks() deleted — see the note in addLake().

function addEastLake(){
  // East lake removed — was positioned in the paddock zone causing visual bleed
  // into villa hedge plots. The crescent lake to the north is the primary water feature.
}

function addClubhouse(){
  // REMOVED: two 55x28 parking slabs at (±65, 128).
  // They used MATS.roadAsph() — a DIFFERENT asphalt material from the apron's —
  // and sat at y=0.13 vs the apron's 0.09, so they read as two pale rectangles
  // floating on top of the darker tarmac. The single apron already covers this
  // ground (x -150..150, z 104..190), so they were redundant as well as wrong.
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

  // ── BOTH CODECS REGISTERED ────────────────────────────────────────────────
  // Draco and meshopt are both lossless at equal quantization — neither looks
  // better than the other. They trade download size against decode cost:
  //
  //   Draco     hero 6.57 MB, but a ~800KB wasm decoder and a slow,
  //             allocation-heavy decode. This is the codec implicated in the
  //             villa-mesh.glb worker-contention failure noted above, and the
  //             kind of allocation the iOS memory guard exists to avoid.
  //   meshopt   hero 10.88 MB, a ~25KB decoder, and roughly 10x faster decode.
  //
  // Registering both means either export format loads, so the choice can be
  // made per asset rather than once for the whole project — and can be A/B
  // tested by swapping a file, with no code change.
  //
  // Current split: the LOW model is small enough that decode time is
  // irrelevant, so Draco's tighter compression wins outright. The HERO model
  // is where decode cost actually bites, so meshopt is the safer default there
  // on anything but a fast desktop.
    loader.setMeshoptDecoder(MeshoptDecoder);

  // product-panel.js builds its own GLTFLoader and was failing with
  // "setMeshoptDecoder must be called before loading compressed files" on any
  // meshopt-compressed product GLB. Expose the decoder so it can register too.
  window.__xixMeshoptDecoder = MeshoptDecoder;

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

// ─── LOW-POLY VILLA (verified) ───────────────────────────────────────────────
// assets/villa-low.glb — 97,941 tris vs 979,415 in the original: a 10x cut with
// the bounding box verified identical (X 0.005%, Z 0.003%, Y 0.134% deviation),
// so the 330 sqm footprint and VILLA_SCALE are unaffected.
// This is used from VILLA_LOD_SWAP metres outward. Inside 90m the full original still renders, so
// nothing you can actually resolve is lost.
let villaLowScene = null;
function loadVillaLowGLB(){
  makeDracoLoader().load("assets/villa-low.glb", gltf => {
    // CRITICAL — must match the high model exactly.
    // loadVillaGLB() applies scale.setScalar(5.71853) (GFA 330m² over 3 floors
    // = 11.4m wide). This loader originally omitted it, so the low LOD rendered
    // at raw GLB size — about 2 units instead of 11.4m. On iPhone, where 'fast'
    // mode and camera height put nearly every villa past the 60m swap, that
    // meant almost the whole estate drew at a fraction of proper size.
    // Derived, not copied — see fitVillaScalar(). Both tiers land on
    // VILLA_TARGET_WIDTH regardless of how each was exported.
    gltf.scene.scale.setScalar(fitVillaScalar(gltf.scene));
    applyPS4Materials(gltf.scene);
    fixVillaMaterials(gltf.scene);   // FrontSide — a closed shell never needs DoubleSide
    gltf.scene.traverse(c => {
      if (c.isMesh) { c.castShadow = false; c.receiveShadow = true; c.frustumCulled = true; }
    });
    // Ground it exactly like the high model so the two levels sit at the same
    // height — any mismatch here shows as a visible pop at the swap distance.
    const bbox = new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y = bbox.min.y < 0 ? -bbox.min.y : 0;
    const w = new THREE.Group(); w.add(gltf.scene);
    villaLowScene = w;

    // DELIBERATELY does NOT stand in for villaGLBScene.
    // An earlier version did, which drained pendingVillas before the full model
    // arrived — so loadVillaGLB() then found an empty queue and never placed a
    // single detailed villa. The low model is strictly a secondary LOD level.

    // Attach to every villa already placed.
    let n = 0;
    scene.traverse(o => {
      if (o.isLOD && o.userData.isVillaGLB) {
        // Drop the old invisible impostor level if present, then add the real one.
        //
        // THREE.LOD defines `levels` with Object.defineProperties({ value: [] }) —
        // no setter. Assigning to it throws "Cannot assign to read only property
        // 'levels'" under ES-module strict mode, which is what silently killed
        // this whole callback: villa-low.glb has never attached in any version.
        // Mutate the existing array in place instead.
        for (let i = o.levels.length - 1; i >= 0; i--) {
          if (o.levels[i].object && o.levels[i].object.material === _impostorMat) {
            o.levels.splice(i, 1);
          }
        }
        const low = villaLowScene.clone(true);
        low.rotation.y = 0;
        o.addLevel(low, VILLA_LOD_SWAP);
        n++;
      }
    });
    console.log(`[XIX] Villa low-LOD ready (97,941 tris) — attached to ${n} villas, swaps at ${VILLA_LOD_SWAP}m`);
    window._xixVillaLowActive = true;
    requestShadowUpdate(2);
  }, undefined, e => console.warn('[XIX] villa-low.glb failed:', e));
}

function loadVillaGLB(){
  // ── iOS / TABLET MEMORY GUARD ────────────────────────────────────────────
  // iOS Safari enforces a hard per-tab memory ceiling and kills the tab when it
  // is exceeded — which is the crash-on-pan being seen on iPad and iPhone.
  // The full villa is 979K triangles and a 10MB GLB; 43 instances of its
  // geometry plus textures is the single largest allocation in the scene.
  // On iOS we skip the high model ENTIRELY and use the verified 98K low model
  // at every distance. Desktop is completely unaffected — this branch never
  // runs there, so no asset is degraded for the laptop build.
  if (_isTabletOrIOS()) {
    console.log('[XIX] iOS/tablet: using low-poly villa at all distances (memory guard)');
    makeDracoLoader().load("assets/villa-low.glb", gltf => {
      gltf.scene.scale.setScalar(fitVillaScalar(gltf.scene));
      applyPS4Materials(gltf.scene);
      fixVillaMaterials(gltf.scene);
      gltf.scene.traverse(c => {
        if (c.isMesh) { c.castShadow = false; c.receiveShadow = true; c.frustumCulled = true; }
      });
      const bb = new THREE.Box3().setFromObject(gltf.scene);
      gltf.scene.position.y = bb.min.y < 0 ? -bb.min.y : 0;
      const w = new THREE.Group(); w.add(gltf.scene);
      villaGLBScene = w;
      villaLowScene = w;              // same model at both levels — no swap cost
      const queue = [...pendingVillas]; pendingVillas = [];
      queue.forEach(d => placeVillaGLBWithLOD(d.x, d.z, d.ry, d.plotKey));
      armVillaLODBudget();
      requestShadowUpdate(2);
    }, undefined, e => console.warn('[XIX] villa-low.glb (iOS path) failed:', e));
    return;
  }

  makeDracoLoader().load("assets/villa-mesh.glb", gltf => {
    reportVillaAsset(gltf.scene, 'villa-mesh.glb');
    // Derived from this GLB's own bbox — a re-exported mesh of any size still
    // lands on VILLA_TARGET_WIDTH. See fitVillaScalar().
    gltf.scene.scale.setScalar(fitVillaScalar(gltf.scene));
    // villa-mesh.glb ships with baked PBR maps (albedo / normal / metal-rough)
    // generated from its own atlas, so applyPS4Materials must NOT overwrite them
    // with procedural substitutes. It only tunes envMap and shadow flags here.
    applyPS4Materials(gltf.scene);
    fixVillaMaterials(gltf.scene);
    gltf.scene.traverse(c => {
      if(c.isMesh){ 
        c.castShadow = false; // Villas: receive only — casting causes shadow acne at scale
        c.receiveShadow = true;
        c.frustumCulled = true;
      }
    });
    const bbox = new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y = bbox.min.y < 0 ? -bbox.min.y : 0;

    // Cache glass meshes BEFORE merging — merging collapses meshes together and
    // would lose the per-mesh isGlassPanel tagging the night-glow system needs.
    gltf.scene.traverse(c => {
      if (c.isMesh && c.userData.isGlassPanel) registerGlassMesh(c);
    });

    // ─── OPTION D: MERGE BY MATERIAL, ONCE ─────────────────────────────────
    // Every villa is a clone of this one source, so merging the SOURCE means
    // the work happens exactly once and all 43 clones inherit the reduced mesh
    // count for free. Merging per-clone would do the same job 43 times.
    // A villa GLB is typically 15-40 separate meshes; at 43 villas that is
    // several hundred to well over a thousand draw calls, all submitted every
    // frame in aerial where nothing is LOD'd out.
    const merged = _mergeSceneByMaterial(gltf.scene);

    const wrapper = new THREE.Group(); 
    wrapper.add(merged || gltf.scene); 
    villaGLBScene = wrapper;

    // Swap placeholders for real houses
    const queue = [...pendingVillas];
    pendingVillas = [];
    queue.forEach((data) => {
      if (data.placeholder) scene.remove(data.placeholder); // Remove the dummy box
      placeVillaGLBWithLOD(data.x, data.z, data.ry, data.plotKey); // Insert real GLB
      requestShadowUpdate(2);  // new geometry → shadow map must be regenerated
    });
    armVillaLODBudget();

  }, null, err => {
    // LOUD failure. Boxes appearing instead of the real villas means THIS ran.
    // It is a hard error, not a cosmetic fallback — the primary asset did not
    // load, and the estate is showing placeholder geometry. Anything that
    // reorders asset loading must be checked against this message.
    console.error(
      '[XIX] ==================================================\n' +
      '[XIX] villa-mesh.glb FAILED TO LOAD — showing box placeholders.\n' +
      '[XIX] Check: is assets/villa-mesh.glb deployed and reachable?\n' +
      '[XIX] Check: Draco worker contention from concurrent GLB loads?\n' +
      '[XIX] =================================================='
    );
    console.warn('[XIX] villa-mesh.glb error detail:', err);
    window._xixVillaFallbackActive = true;
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
    // Derived from LOFT_BLOCK_WIDTH, not hard-coded — the old 4.79208 was a
    // per-unit figure applied to a per-block model.
    {
      reportVillaAsset(gltf.scene, 'loft-mesh.glb');
      const raw = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
      const scalar = raw.x > 1e-6 ? (LOFT_BLOCK_WIDTH / raw.x) : 4.79208;
      gltf.scene.scale.setScalar(scalar);
      console.log(`[XIX] loft raw ${raw.x.toFixed(5)} -> scalar ${scalar.toFixed(5)}`);
    }
    applyPS4Materials(gltf.scene);
    fixVillaMaterials(gltf.scene);   // FrontSide; a closed shell never needs DoubleSide
    gltf.scene.traverse(c=>{ if(c.isMesh){ c.castShadow=false; c.receiveShadow=true; c.frustumCulled=true; } });
    const bbox=new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y=bbox.min.y<0?-bbox.min.y:0;

    // Record the world width the legacy scalar produces, so loft-low can be
    // fitted to match it exactly rather than guessing at a target.
    LOFT_TARGET_WIDTH = bbox.max.x - bbox.min.x;
    console.log(`[XIX] loft hero ${LOFT_TARGET_WIDTH.toFixed(3)} m wide (target ${LOFT_BLOCK_WIDTH})`);

    const wrapper=new THREE.Group(); wrapper.add(gltf.scene); loftGLBScene=wrapper;
    loadLoftLowGLB();
    pendingLofts.forEach(({x,z,ry,plotKey})=>placeLoftGLB(x,z,ry,plotKey)); pendingLofts=[];
    armVillaLODBudget();
  },null,err=>{pendingLofts.forEach(({x,z,ry})=>scene.add(_createLoftBlock(x,z,ry)));pendingLofts=[];});
}

// Loaded after the hero so LOFT_TARGET_WIDTH is known and the low tier can be
// fitted to it. A failure here is non-fatal: placeLoftGLB simply keeps using a
// single-level LOD, which is exactly the old behaviour.
function loadLoftLowGLB(){
  makeDracoLoader().load("assets/loft-low.glb",gltf=>{
    const raw = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
    const scalar = (LOFT_TARGET_WIDTH && raw.x > 1e-6) ? (LOFT_TARGET_WIDTH / raw.x) : 4.79208;
    gltf.scene.scale.setScalar(scalar);
    applyPS4Materials(gltf.scene);
    fixVillaMaterials(gltf.scene);
    gltf.scene.traverse(c=>{ if(c.isMesh){ c.castShadow=false; c.receiveShadow=true; c.frustumCulled=true; } });
    const bbox=new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y=bbox.min.y<0?-bbox.min.y:0;
    const wrapper=new THREE.Group(); wrapper.add(gltf.scene); loftLowScene=wrapper;
    console.log(`[XIX] loft low fitted: scalar ${scalar.toFixed(5)} -> ${(raw.x*scalar).toFixed(3)} m wide`);

    // Retro-fit the low level onto blocks already placed with only a hero level.
    scene.traverse(o=>{
      if(o.isLOD && o.userData.isLoftGLB && o.levels.length===1){
        const low=loftLowScene.clone(true); low.rotation.y=0;
        o.addLevel(low, LOFT_LOD_SWAP);
      }
    });
    armVillaLODBudget();
  },null,()=>{ console.warn('[XIX] loft-low.glb missing — lofts stay single-level'); });
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

  // Same shape as placeVillaGLBWithLOD. isLoftGLB is what villa-lod-budget.js
  // scans for to give lofts their own hero budget, independent of the villas.
  const lod = new THREE.LOD();
  lod.position.set(x,0,z);
  lod.rotation.y = ry;
  lod.userData.isLoftGLB = true;
  lod.userData.baseRotY  = ry;
  lod.userData.plotKey   = plotKey;

  const hero = loftGLBScene.clone(true); hero.rotation.y = 0;
  lod.addLevel(hero, 0);

  if (loftLowScene) {
    const low = loftLowScene.clone(true); low.rotation.y = 0;
    lod.addLevel(low, LOFT_LOD_SWAP);
  }
  // If the low tier has not loaded yet, loadLoftLowGLB() retro-fits it.

  scene.add(lod);
  if (plotKey) addPlotOverlay(x, z, ry, plotKey, lod);
}

// ─── PLOT OVERLAY ─────────────────────────────────────────────────────────────
function addPlotOverlay(x,z,ry,plotKey,villaClone){
  addPlotOverlayCustom(x, z, ry, plotKey, villaClone, 20, 18);
}
// Same registration, sizeable footprint — apartment blocks need a much
// larger hit-plane (37x19m) than a single villa's 20x18m default above.
// The overlay is BOTH the pick target and the visual highlight.
// It used to be a flat PlaneGeometry lying on the ground at y=0.25 — a decal.
// That is why hover felt broken at eye level: aiming at a house sent the ray
// straight OVER the plane and onto the next plot's plane further away, so the
// highlight landed half a plot past where you were pointing, and you had to aim
// at the very base of a building to hit its own plot.
// It is now a BOX enclosing the building volume, which is what the loft units
// already used and why those always felt accurate. Pointing anywhere at a
// house — roof, wall, door — now hits that house.
// It also fixes the aerial case: from above you now see a green volume wrapping
// the building rather than a decal hidden under its roof.
function addPlotOverlayCustom(x,z,ry,plotKey,villaClone,w,d,h){
  const mat=MATS.plotAvail();
  const height = h || 11;                       // typical villa mass
  const overlay=new THREE.Mesh(new THREE.BoxGeometry(w*0.72, height, d*0.72), mat);
  overlay.position.set(x, height/2, z);
  overlay.rotation.y = ry || 0;                 // follow the unit's orientation
  overlay.renderOrder = 999;   // draw after opaque geometry regardless of depth
  overlay.userData.plotKey=plotKey; overlay.userData.isPlotOverlay=true; overlay.userData.villaClone=villaClone;
  scene.add(overlay);

  const existingData = plotRegistry.get(plotKey) || {};
  plotRegistry.set(plotKey, { ...existingData, status: "available", overlay, villaClone, x, z, ry });
  markPickTargetsDirty();
}

// Selection used to slam material.opacity between 0 and 0.35 the instant the
// raycast changed, so the hologram snapped on and off and flickered whenever
// the ray grazed an edge between two plots. Two changes:
//   - the hard write becomes a TARGET that tickPlotHighlights eases toward, so
//     every appearance and disappearance is a short fade rather than a cut
//   - the eased value also drives a slow pulse, so a held selection breathes
//     instead of sitting inert
const _plotFade = new Map();
// ─── SHARED SELECTION RING ───────────────────────────────────────────────────
// A filled rectangle alone reads as a soft patch from aerial distance. A hard
// bright border is what makes a selection look deliberate rather than a stain.
// ONE ring is created and moved to whichever plot is hovered, so this costs a
// single extra draw call in total — not one per plot.
let _selRing = null;
function _ensureSelectionRing() {
  if (_selRing) return _selRing;
  const g = new THREE.RingGeometry(0.5, 0.5, 4);   // replaced below by an edge box
  // Use a thin outlined rectangle built from a plane with only its border drawn.
  // EdgesGeometry on a plane gives a clean 4-line border that scales cleanly.
  const plane = new THREE.PlaneGeometry(1, 1);
  const edges = new THREE.EdgesGeometry(plane);
  const mat = new THREE.LineBasicMaterial({
    color: 0x9dffc4, transparent: true, opacity: 0, depthTest: false, depthWrite: false,
  });
  _selRing = new THREE.LineSegments(edges, mat);
  _selRing.rotation.x = -Math.PI / 2;
  _selRing.renderOrder = 1000;    // above the fill
  _selRing.visible = false;
  _selRing.frustumCulled = false;
  scene.add(_selRing);
  plane.dispose(); g.dispose();
  return _selRing;
}

// Tracks which plot is currently lit so we only touch what changed, instead of
// looping all 223 plots on every hover.
let _litPlotKey = null;

export function highlightPlot(plotKey){
  if (_litPlotKey === plotKey) return;      // nothing changed — do no work at all

  // Un-light the previous plot (it fades out; fade-out is not perceived as lag)
  if (_litPlotKey) {
    const prev = plotRegistry.get(_litPlotKey);
    if (prev && prev.overlay) {
      prev.overlay.userData._fadeTarget = (prev.status === 'reserved') ? 0.45 : 0.0;
    }
  }

  _litPlotKey = plotKey;
  if (!plotKey && _selRing) _selRing.visible = false;

  // Light the new plot INSTANTLY. The fade system eases toward _fadeTarget at
  // ~170ms, which is exactly the delay that made hovering feel unresponsive.
  // For the incoming plot we bypass the ease and snap opacity to full on this
  // very frame — like a Windows icon lighting the instant the cursor touches it.
  if (plotKey) {
    const plot = plotRegistry.get(plotKey);
    if (plot && plot.overlay) {
      // Opacity raised from 0.38 to 0.62. At aerial distance a plot is small on
      // screen, and 0.38 of an unlit green read as a faint wash rather than a
      // selection. 0.62 is unmistakable at a glance while still letting the
      // ground read through, so it looks like a highlight and not a solid slab.
      const target = (plot.status === 'reserved') ? 0.68
                   : (plot.status === 'available') ? 0.62 : 0.0;
      plot.overlay.userData._fadeTarget = target;
      if (target > 0) {
        plot.overlay.visible = true;
        plot.overlay.material.opacity = target;   // SNAP — no ease-in
        _plotFade.set(plotKey, target);           // keep the fader in sync

        // Snap the shared selection ring onto this plot, sized to its overlay.
        const ring = _ensureSelectionRing();
        // Overlay is now a BOX (width x height x depth). The ring is a ground
        // footprint marker, so it uses width/depth and sits just above grade —
        // not at the box centre, which is halfway up the building.
        const gp = plot.overlay.geometry.parameters || { width: 14, depth: 13 };
        ring.scale.set(gp.width || 14, gp.depth || 13, 1);
        ring.position.set(plot.overlay.position.x, 0.28, plot.overlay.position.z);
        // MUST match the overlay, which is axis-aligned (rotation.x only, no
        // Y rotation). Rotating the ring by plot.ry made it sit skewed against
        // the square on the north arc, where ry is an arbitrary atan2 angle —
        // which is exactly the "two squares" artefact. Axis-aligned plots hid
        // the bug because a rectangle rotated 0 or PI looks identical.
        ring.rotation.z = -(plot.ry || 0);   // matches the box, which now rotates too
        ring.material.color.setHex(plot.status === 'reserved' ? 0xffb0b0 : 0x9dffc4);
        ring.material.opacity = 0.95;
        ring.visible = true;
      }
    }
  }
}

// Reserved plots must stay visible even when nothing is hovered. Called once
// after the registry is built and whenever a plot's status changes.
// Reports the exact state of a plot's highlight. Run window._debugPlot('10').
if (typeof window !== 'undefined') {
  window._debugPlot = (key) => {
    const p = plotRegistry.get(String(key));
    if (!p) return 'no such plot';
    const ov = p.overlay;
    return {
      plotKey: String(key), status: p.status,
      litKey: _litPlotKey,
      hasOverlay: !!ov,
      visible: ov && ov.visible,
      opacity: ov && ov.material && ov.material.opacity,
      fadeTarget: ov && ov.userData._fadeTarget,
      depthTest: ov && ov.material && ov.material.depthTest,
      renderOrder: ov && ov.renderOrder,
      y: ov && ov.position.y,
      inPickList: _pickTargets.includes(ov),
    };
  };
}

export function refreshReservedOverlays() {
  plotRegistry.forEach((plot, key) => {
    if (!plot.overlay) return;
    if (plot.status === 'reserved') {
      plot.overlay.userData._fadeTarget = 0.45;   // idle reserved marker
      plot.overlay.visible = true;
    } else if (key !== _litPlotKey) {
      plot.overlay.userData._fadeTarget = 0.0;
    }
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
    // Skip plots that have already settled — the overwhelming majority every
    // frame. Only the one fading in and the one fading out do any work.
    // Without this the loop wrote opacity to all 223 overlay materials, 60x/sec.
    if (cur === target && target === 0) { if (ov.visible) ov.visible = false; return; }
    if (cur === target && target > 0) { ov.material.opacity = target * pulse; return; }
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

// ─── PLOT PICKING (cached) ───────────────────────────────────────────────────
// The previous implementation rebuilt its target array on EVERY call by
// traversing every villa clone, and wrote material.opacity to all 223 overlays
// twice per call (0.01 then back to 0). At hover rates that was the single
// biggest source of interaction lag. Targets are now cached and rebuilt only
// when the registry actually changes.
const _pickTargets = [];
let _pickDirty = true;
export function markPickTargetsDirty() { _pickDirty = true; }

function _rebuildPickTargets() {
  _pickTargets.length = 0;
  plotRegistry.forEach((plot, key) => {
    if (plot.overlay) {
      plot.overlay.userData.plotKey = key;
      _pickTargets.push(plot.overlay);
    }
  });
  _pickDirty = false;
}

// FAST PATH — used by hover. Tests only the flat overlay planes (one quad per
// plot), never the villa geometry. Note: three.js r165 raycasts objects
// regardless of `visible`, so hidden overlays are still pickable and we never
// need to touch material.opacity here.
export function pickPlotFast(raycaster) {
  if (_overlaysSuppressed) return null;   // nothing is pickable inside a unit
  if (_pickDirty) _rebuildPickTargets();
  if (!_pickTargets.length) return null;
  const hits = raycaster.intersectObjects(_pickTargets, false);
  return hits.length ? hits[0].object.userData.plotKey : null;
}

// Click path — same cached overlays. Kept as a separate export so call sites
// don't change; there is no longer any reason for it to be slower than hover.
export function getPlotAtRay(raycaster) {
  return pickPlotFast(raycaster);
}
// ─── VILLA RING ───────────────────────────────────────────────────────────────
const villaFootprints=[];
window._nextUnitId = 1; 
// NORTH_SHIFT is defined at the top of this module (see performance-mode block).

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

// ── VILLA LOD BUDGET ────────────────────────────────────────────────────────
// THREE.LOD chooses a level from distance alone, and the ring has two very
// different spacings: 28 m on the west/east columns, 12.88 m on the north arc.
// VILLA_LOD_SWAP = 60 was tuned against the columns, where it correctly yields
// 0-4 full-detail villas. Nobody checked the arc — standing anywhere along it
// puts NINE villas at level 0, which at 979K tris is 8.8M triangles and at
// 1.9M is 17.1M. That is the walking-near-the-houses stutter.
//
// Capping the COUNT instead of the distance makes the load a fixed number you
// choose, identical everywhere on the ring.
// Asset quality is NOT the same axis as render quality. An earlier version set
// fast:hero=0, which meant an integrated-GPU machine never saw the detailed
// villa even standing beside it — the whole point of shipping a 1.9M model. The
// budget already bounds the cost to a fixed triangle count, so one hero villa
// is affordable anywhere; what fast mode should cut is post-processing, shadow
// resolution and draw distance, not the model you walked up to look at.
const VILLA_BUDGET_BY_MODE = {
  fast:     { hero: 1, maxDist: 45, shadowCutoff: 0  },
  balanced: { hero: 2, maxDist: 70, shadowCutoff: 60 },
  rich:     { hero: 3, maxDist: 90, shadowCutoff: 80 },
};

// Lofts get their own, much tighter budget. They are a 96-unit yield product
// viewed from the road, not something a buyer walks up to and inspects, and 28
// blocks at 26 m pitch cluster far harder than the villa ring. 1 hero slot
// takes the precinct from 53.2M triangles to about 4.5M.
const LOFT_BUDGET_BY_MODE = {
  fast:     { hero: 1, maxDist: 35, shadowCutoff: 0 },
  balanced: { hero: 1, maxDist: 45, shadowCutoff: 0 },
  rich:     { hero: 1, maxDist: 60, shadowCutoff: 0 },
};

function armVillaLODBudget() {
  const counts = initVillaLODBudget(scene);
  const mode = PERF_MODE;
  setVillaLODBudget({ kind: 'villa', ...(VILLA_BUDGET_BY_MODE[mode] || VILLA_BUDGET_BY_MODE.balanced) });
  setVillaLODBudget({ kind: 'loft',  ...(LOFT_BUDGET_BY_MODE[mode]  || LOFT_BUDGET_BY_MODE.balanced)  });
  console.log(`[XIX] LOD budget armed — ${counts.villa} villas, ${counts.loft} lofts (${mode})`);
}

// Called once per frame from app.js, before the render.
export function tickVillaLOD(camera) {
  if (camera) updateVillaLODBudget(camera);
}

function addVillaRing(){
  const PLOT=28;
  const cypressPositions=[];

  // NORTH_SHIFT is module scope (defined above) so addLake/addRoads/addGround
  // read the same value. Hedges, contact shadows and cypress derive from each
  // villa's own (x,z) inside placeV(), so shifting the villa z moves them too.
  
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
  
  // North straight row (negative Z = north edge) — SHIFTED inward by NORTH_SHIFT.
  // (The old comment mislabelled this "South row"; it is the north flank that
  // faces the field across the lake.)
  [-86, -108, -130, -152].forEach(x => { placeV(x, -120 + NORTH_SHIFT, 0); });
  [86, 108, 130, 152].forEach(x => { placeV(x, -120 + NORTH_SHIFT, 0); });

  //  The arc sat 10-20 m outside the line the west and east columns hold, so
  //  it read as a separate row floating above the ring instead of part of it.
  //  Count and x positions are untouched — only the standoff changes, from
  //  -120/-138 to -118/-128, which is the flattest bow the lake still clears
  //  by a villa half-depth.
  for (let i = 0; i < 11; i++) {
    const t = 0.05 + (i / 10) * 0.90;
    const x = -70 + (t * 140);
    const z = (-118 - Math.sin(t * Math.PI) * 10) + NORTH_SHIFT;   // arc shifted with the group
    placeV(x, z, Math.atan2(0 - x, -60 - z));
  }

  [-75, -47, -19].forEach(z => placeV(-162, z, Math.PI / 2));
  [19, 47, 75].forEach(z => placeV(-162, z, Math.PI / 2));
  // SW/SE corner villas — z adjusted to match the new south row at z≈88
  // SW/SE corners: the pure run-midpoint (-146, 84.1) sat 9.3m INSIDE the south
  // safety strip — a 45-degree villa has a 7.42m half-extent, so its centre must
  // clear z=86 by that much, or clear the strip's x half-width of 149.
  // (-157, 91) does the latter: x -149.6..-164.4 is entirely outside the strip,
  // it keeps 16.8m from every neighbour, and sitting near the west column line
  // (x=-162) it holds the wrap rather than bulging out of it.
  placeV(-157.0, 91.0, 3 * Math.PI / 4);   // SW — clears the strip, 16.8m clearance

  [-75, -47, -19].forEach(z => placeV(162, z, -Math.PI / 2));
  [19, 47, 75].forEach(z => placeV(162, z, -Math.PI / 2));
  placeV( 157.0, 91.0, -3 * Math.PI / 4);  // SE — clears the strip, 16.8m clearance

  // South villas: moved inward from z=105 to z=88 now that the N/S safety zone
  // is 13m (inner edge at z=86) rather than 25m. 2m clearance from strip edge.
  // This fills the gap left by the reduced setback and makes the ring more compact.
  for(const side of [-1, 1]) {
    // Tightened from 65/93/121/149. The outermost unit at x=±149 crowded the
    // corner so badly that v=58 had to push the corner 14m OUT of the ring —
    // which broke the wrap the villas are meant to form. Pulling the row in to
    // 58/82/106/130 lets the corner sit exactly ON the run midpoint instead.
    [58, 82, 106, 130].forEach(xa => {
      // base z 88 -> 93. The south safety strip is 13m deep at z=79.5, i.e.
      // z 73..86. At base 88 the innermost unit sat at z=90.3 with a 4.8m
      // half-depth, clipping the strip. 93 clears it with margin.
      placeV(side * xa, 93 + xa * 0.04, Math.PI);
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
  // ── CORNER VILLAS — recomputed for clearance ────────────────────────────
  // These four were overlapping their neighbours, which is the deformed,
  // merged-together look at the safety-zone corners. Measured centre-to-centre
  // distances before the fix:
  //     NW/NE  11.7m  to the west/east column end
  //     SW/SE   8.8m  to the south row end
  // The villa is 11.4m wide x 9.6m deep (14.9m diagonal), so a 45-degree corner
  // unit needs ~16-17m centre-to-centre against an axis-aligned neighbour.
  // Anything less and the meshes physically intersect.
  //
  // Solved by taking the MIDPOINT of the two runs each corner sits between,
  // then pushing outward from the field by the smallest amount that reaches
  // 17m clearance. The north corners needed no push at all — they were simply
  // off-centre. The south pair needed 14m because the south row's outermost
  // villa (x=±149, z≈94) crowds that corner.
  // Rotations are unchanged: each bisects the two runs it joins.
  placeV(-157, -91.5,  Math.PI / 4);     // NW — 17.2m clearance (was 11.7m)
  placeV( 157, -91.5, -Math.PI / 4);     // NE — 17.2m clearance (was 11.7m)

  // The schedule is the source of truth for the count, so it is asserted here
  // rather than left to be discovered in a screenshot.
  const _built = villaFootprints.length;
  if (_built !== 43) console.warn(`[XIX] Villas: ${_built} placed, schedule says 43`);
  else console.log('[XIX] Villas: 43 placed, matches UNIT_SCHEDULE');

  buildInstancedCypress(cypressPositions);
  buildAllVillaHedges();
  commitVillaContactShadows();   // 43 meshes → 1 instanced draw call
  loadLampMeshes();     // needs _hedgeInstData, so runs after hedges
}

// ── LOFT PRECINCT ───────────────────────────────────────────────────────────
// Transcribed from the masterplan: 20 orange rectangles in four runs, of which
// exactly two are the wide loft-apartment buildings.
//
// A "module" is one loft-mesh.glb — 17.2 m, four 4.3 m bays, four units. A
// small rectangle is 1 module; each wide one is 3 abutted modules (51.6 m,
// 12 units). That is the only split that reaches UNIT_SCHEDULE's 96:
//     18 small x 4u  +  2 wide x 12u  =  96
//
// The previous loops placed 28 blocks (112 units) at 26 m pitch, which only
// looked right because the GLB was rendering 4.68 m wide instead of its true
// 17.2 m. An intermediate fix mis-derived 36 m from the unit hitboxes'
// own (equally wrong) offsets before the GFA math below corrected it.
//
// NOTE: the x positions below were placed for the 36 m-wide misreading, at a
// 44 m pitch (36 m block + 8 m gap). At the true 17.2 m width they still fit
// inside WORLD without overlapping, but the rows now read as loosely spaced
// rather than as abutted terraces — the pitch was never revisited against the
// corrected width. Tighten each run's x/z spacing to ~(17.2 + LOFT_BLOCK_GAP)
// if a continuous terrace look matters more than preserving these exact plot
// coordinates.
const LOFT_BLOCK_GAP = 8.0;

// North rows sit above the perimeter road, parallel to the top edge, following
// the same slight curve away from the field the original code used.
const _loftNorthZ = (x) => -162 - Math.abs(x) * 0.05;

const LOFT_RUNS = [
  // 1. North-west row — 5 small then 1 wide, left to right. 32 units.
  { name: 'north-west row', ry: Math.PI, axis: 'x', z: _loftNorthZ, blocks: [
    { x: -377.0, modules: 1 },   // small, 4 units
    { x: -333.0, modules: 1 },   // small, 4 units
    { x: -289.0, modules: 1 },   // small, 4 units
    { x: -245.0, modules: 1 },   // small, 4 units
    { x: -201.0, modules: 1 },   // small, 4 units
    { x: -121.0, modules: 3 },   // wide, 12 units
  ]},

  // LARGE CENTRAL GAP — the lake, the Crescent and the Garden Museum Villas.
  // No lofts here. (An earlier pass proposed filling it; the plan says no.)

  // 2. North-east row — 1 wide then 3 small. 24 units.
  { name: 'north-east row', ry: Math.PI, axis: 'x', z: _loftNorthZ, blocks: [
    { x: 119.0,  modules: 3 },   // wide, 12 units
    { x: 199.0,  modules: 1 },   // small, 4 units
    { x: 243.0,  modules: 1 },   // small, 4 units
    { x: 287.0,  modules: 1 },   // small, 4 units
  ]},

  // 3. West strip — three vertical PAIRS plus a single below them, each block
  //    horizontal despite the strip running north-south. Pair members sit 16 m
  //    apart in z (11 m depth + 5 m); 40 m between pairs for the landscaped
  //    parking compound. 28 units.
  //    x -200 spans -218..-182: clears TRAINING (-330..-268), the apartment
  //    blocks (-254..-236) and the west villa column (-168..-156) by 14 m.
  { name: 'west strip', ry: 0, axis: 'z', x: -200, blocks: [
    { z: 65,     modules: 1 },   // small, 4 units
    { z: 49,     modules: 1 },   // small, 4 units
    { z: 9,      modules: 1 },   // small, 4 units
    { z: -7,     modules: 1 },   // small, 4 units
    { z: -47,    modules: 1 },   // small, 4 units
    { z: -63,    modules: 1 },   // small, 4 units
    { z: -103,   modules: 1 },   // small, 4 units
  ]},

  // 4. East strip — 3 stacked beyond the paddock, inside the perimeter road.
  //    12 units.
  { name: 'east strip', ry: 0, axis: 'z', x: 275, blocks: [
    { z: -50,    modules: 1 },   // small, 4 units
    { z: -66,    modules: 1 },   // small, 4 units
    { z: -106,   modules: 1 },   // small, 4 units
  ]},
];

function addLoftTerraces(){
  let blocks = 0, units = 0;

  for (const runDef of LOFT_RUNS) {
    for (const b of runDef.blocks) {
      const alongX = runDef.axis === 'x';
      const cx = alongX ? b.x : runDef.x;
      const cz = alongX ? runDef.z(b.x) : b.z;
      const span = b.modules * LOFT_BLOCK_WIDTH;

      // A wide block is N modules abutted, so place N GLBs centred on the run.
      for (let m = 0; m < b.modules; m++) {
        const off = (m - (b.modules - 1) / 2) * LOFT_BLOCK_WIDTH;
        const mx = cx + (alongX ? off : 0);
        const mz = cz + (alongX ? 0 : off);
        placeLoftGLB(mx, mz, runDef.ry, null);
      }

      // One sellable unit per 4.3 m bay, laid out along the block's own axis.
      const bays = b.modules * 4;
      const cosR = Math.cos(runDef.ry), sinR = Math.sin(runDef.ry);
      for (let u = 0; u < bays; u++) {
        const off = (u - (bays - 1) / 2) * (LOFT_BLOCK_WIDTH / 4);
        const unitX = cx + off * cosR;
        const unitZ = cz - off * sinR;
        const key = String(window._nextUnitId++);

        // Hitbox footprint now matches the GFA-derived bay: 4.3 m frontage
        // (LOFT_BLOCK_WIDTH / 4) x 14.6 m deep (LOFT_BLOCK_DEPTH). It was
        // hardcoded at 9 x 16 — the same wrong 9 m bay the block width itself
        // was mistakenly back-derived from.
        const hitbox = new THREE.Mesh(
          new THREE.BoxGeometry(LOFT_BLOCK_WIDTH / 4, 10, LOFT_BLOCK_DEPTH),
          new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0, depthWrite: false, depthTest: false })
        );
        hitbox.position.set(unitX, 5, unitZ);
        hitbox.rotation.y = runDef.ry;
        hitbox.renderOrder = 999;
        hitbox.userData = { isPlotOverlay: true, plotKey: key };
        hitbox.visible = false;
        scene.add(hitbox);

        plotRegistry.set(key, { x: unitX, z: unitZ, status: 'available', overlay: hitbox, type: "2 BED LOFT TERRACE", ry: runDef.ry });
        markPickTargetsDirty();
      }
      blocks++; units += bays;
      void span;
    }
  }

  // Guard: the sheet sync reads 223 rows against UNIT_SCHEDULE. Any drift here
  // mints plot keys with no row behind them, which is how the precinct ended up
  // silently showing 112 units against a schedule of 96.
  const expected = (UNIT_SCHEDULE.find(u => /Loft/i.test(u.type)) || {}).units;
  if (expected && units !== expected) {
    console.warn(`[XIX] Lofts: ${blocks} blocks -> ${units} units, but UNIT_SCHEDULE says ${expected}`);
  } else {
    console.log(`[XIX] Lofts: ${blocks} blocks, ${units} units, matches UNIT_SCHEDULE`);
  }
}

function addWestCompound() {
  // West compound ground — split into two planes so neither overlaps the
  // training field turf. Training field occupies roughly x: -170..-350, z: -95..+15.
  // The compound brown only needs to cover the non-field areas:
  //   • North of the field (z > 15): the apartment block forecourt/roads
  //   • The service area south of z=-95 and east of the stables compound
  // A single 120×185 plane centred at (-320, 0) spanned exactly the same z
  // range as the training field at y=0.06, which sat ABOVE the turf at y=0.07
  // — causing the brown to intercept the green field surface from below.
  // Two smaller planes with clear spatial separation fix this.
  
  // North compound strip (between the apartment blocks and the training field's north edge)
  s(plane(120, 80, MATS.safetyBrown(), [-320, .04, 55]));   // z 15..95
  // South compound strip (south of training field, service/road area)
  s(plane(120, 60, MATS.safetyBrown(), [-320, .04, -125])); // z -95..-155

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
  // Matches LOFT_BLOCK_WIDTH/LOFT_BLOCK_DEPTH so a loft-mesh.glb load failure
  // falls back to the same corrected footprint rather than the old 40 x 11 box.
  const TW=LOFT_BLOCK_WIDTH, TD=LOFT_BLOCK_DEPTH;
  // Explicit colours — no texture dependency, no blue fallback
  const stoneBase = new THREE.MeshStandardMaterial({color:0x9a8a78,roughness:.92,metalness:0});
  const renderBody = new THREE.MeshStandardMaterial({color:0xE8E0D0,roughness:.85,metalness:0});
  const timberRoof = new THREE.MeshStandardMaterial({color:0x7a6848,roughness:.70,metalness:0});
  g.add(box(TW,3.2,TD,stoneBase,[0,1.6,0]));
  g.add(box(TW,3.2,TD,renderBody,[0,4.85,0]));
  g.add(box(TW+.4,.4,TD+.4,timberRoof,[0,6.65,0],0,false)); return g;
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
  // NOTE: shadowMap.autoUpdate is OFF (see initScene), so whenever this frustum
  // actually moves we must explicitly request a regeneration — otherwise the
  // shadows would be rendered for the old frustum and drift out of alignment.
  // Because this runs on a 30-frame cadence and only when the frustum has
  // genuinely shifted, shadow renders drop from ~60/sec to ~2/sec while walking
  // and to zero while standing still — identical output, a fraction of the cost.
  if (sunLight && sunLight.castShadow && camera && _tickFrame % 30 === 0) {
    const cam  = sunLight.shadow.camera;
    const px   = camera.position.x;
    const pz   = camera.position.z;
    const half = PERF_MODE === 'rich' ? 120 : 100;
    const L = 0.06; // lerp factor — smooth drift, no snap
    const beforeL = cam.left, beforeB = cam.bottom;
    cam.left   += (px - half - cam.left)   * L;
    cam.right  += (px + half - cam.right)  * L;
    cam.bottom += (pz - half - cam.bottom) * L;
    cam.top    += (pz + half - cam.top)    * L;
    // Only pay for a shadow re-render if the frustum actually shifted enough to
    // matter. When the player is stationary the lerp converges and this stops.
    const drift = Math.abs(cam.left - beforeL) + Math.abs(cam.bottom - beforeB);
    if (drift > 0.05) {
      cam.updateProjectionMatrix();
      requestShadowUpdate(1);
    }
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
export function getHorseGroup() { return null; }   // player-mount horse removed graphically

// ─── PHASE 2: HOVER VISUALS (GREEN HOLOGRAM) ────────────────────────────────
window._xixHoverState = null;

window.setHoveredPlot = function(plotKey) {
  // OPTION A — the highlight is the GREEN GROUND OVERLAY, nothing else.
  //
  // This used to also tint the building itself by cloning each mesh's material
  // and setting an emissive green. That was the direct cause of the pointer
  // becoming unresponsive once the villas loaded: a cloned material is a NEW
  // SHADER PROGRAM, and the GPU must compile it — tens of milliseconds of stall
  // each time. In aerial the camera orbits continuously, so the hovered plot
  // changes constantly and we hit "first hover" on villa after villa in quick
  // succession, producing a burst of compile stalls exactly when the user is
  // trying to move the cursor.
  //
  // It also traversed two full villa GLB hierarchies on every hover change (the
  // one being left and the one being entered) to swap materials mesh by mesh.
  //
  // Dropping it costs nothing that was asked for — the specified behaviour is a
  // green overlay highlight, which highlightPlot() delivers on the same frame
  // with a single opacity write. Hover is now O(1) instead of O(meshes).
  if (window._xixHoverState === plotKey) return;
  window._xixHoverState = plotKey;
  highlightPlot(plotKey);
};

// ─── PHASE 3: PROCEDURAL 3D INTERIOR ENGINE ─────────────────────────────────
window._xixInteriorGroup = null;
window._xixInteriorPlotKey = null;

// ═══════════════════════════════════════════════════════════════════════════
//  VILLA INTERIOR — integrated directly into this scene
//  ───────────────────────────────────────────────────────────────────────
//  The previous "step inside" experience ran an entirely separate, isolated
//  Three.js scene with its own renderer and camera, and showed a hand-painted
//  canvas standing in for the view. There was no way it could ever show the
//  real polo field, lake, or clubhouse — they were never in that scene.
//
//  This version builds the room geometry from buildVillaRoomGroup()
//  (interior.js) as a plain THREE.Group, positions and rotates it at the
//  CLICKED villa's real plotRegistry coordinates (plot.x, plot.z, plot.ry —
//  the exact same transform already applied to that villa's real GLB mesh),
//  and adds it into THIS scene. The villa's own exterior shell is hidden
//  while inside it. Everything visible through the glazing — the field, the
//  lake, the clubhouse, the time of day, the weather — is the same estate,
//  because it is literally the same scene, just viewed from inside a room
//  that now stands at that villa's exact position and facing.
//
//  A room's local "south, facing the field" glazing therefore automatically
//  faces whatever direction that SPECIFIC villa's front actually faces,
//  because the room group inherits the villa's own ry — a west-column villa
//  and a north-arc villa each get the correct view with no per-villa
//  configuration at all.
// ═══════════════════════════════════════════════════════════════════════════
let _villaInterior = null;   // { plotKey, buildingType, x, z, ry, group, hidden, roomKey }

// plot.type strings (as stored in plotRegistry) -> INTERIORS catalogue keys.
const PLOT_TYPE_TO_INTERIOR = {
  '3 BED VILLA': 'villa',
  '2 BED LOFT TERRACE': 'loft',
  '2 Bed Flat Block (24 units)': 'apartment',
};

// THE BLACK SCREEN BUG. The room GROUP is rotated with a native Three.js
// group.rotation.y = ry — the scene graph handles that transform correctly
// on its own. But the CAMERA is not a child of that group; its world
// position has to be computed by hand here, and that hand computation must
// match the EXACT matrix Three.js's rotation.y actually applies:
//     worldX =  lx*cos(ry) + lz*sin(ry)
//     worldZ = -lx*sin(ry) + lz*cos(ry)
// (Matrix4.makeRotationY — verified directly against Three's source, not
// assumed.) The shipped version used (lx*c - lz*s, lx*s + lz*c) instead —
// the OTHER codebase convention, used elsewhere for manually placing
// independent objects like lamps that are never a rotated group's child. It
// is a real, different, self-consistent formula, just the wrong one here.
// For any villa with ry != 0 (every villa except a lucky few near zero
// rotation) this placed the camera somewhere with no relation at all to
// where the actual room geometry had been rotated to — floating in open
// world, looking at nothing, which is exactly a solid-black frame.
function _villaRoomWorldView(room, x, z, ry) {
  const [lx, ly, lz] = room.pos;
  const c = Math.cos(ry), s = Math.sin(ry);
  return {
    pos: [x + lx * c + lz * s, ly, z - lx * s + lz * c],
    yaw: room.yaw + ry,
    pitch: room.pitch || 0,
  };
}

// Overlays are hard-disabled while inside a unit. The overlay is a BOX around
// the building (v=66), so from inside you are standing in a green cube — and an
// invisible box is still raycastable, so hiding alone is not enough. Both the
// visibility and the pick list are suppressed.
let _overlaysSuppressed = false;
export function setPlotOverlaysSuppressed(on) {
  _overlaysSuppressed = on;
  plotRegistry.forEach(p => {
    if (!p.overlay) return;
    if (on) {
      p.overlay.visible = false;
      p.overlay.userData._wasFade = p.overlay.userData._fadeTarget || 0;
      p.overlay.userData._fadeTarget = 0;
      p.overlay.material.opacity = 0;
    } else if (p.status === 'reserved') {
      p.overlay.userData._fadeTarget = 0.45;
      p.overlay.visible = true;
    }
  });
  if (_selRing) _selRing.visible = false;
  _litPlotKey = null;
  markPickTargetsDirty();
}
export function arePlotOverlaysSuppressed() { return _overlaysSuppressed; }

export function enterVillaInterior(plotKey, roomKey) {
  const plot = plotRegistry.get(plotKey);
  if (!plot) return null;
  const buildingType = PLOT_TYPE_TO_INTERIOR[plot.type];
  if (!buildingType || !INTERIORS[buildingType]) return null;

  exitVillaInterior();   // in case one was already open somewhere

  // Hide the real exterior — same three possible homes for the mesh the
  // suppressed version of this code already had to account for (loft units
  // register an invisible raycast hitbox and no villaClone, so all three
  // must be checked or the real block is left standing through the room).
  const hidden = [];
  [plot.villaClone, plot.overlay && plot.overlay.userData.villaClone, plot.lod]
    .forEach(o => { if (o && o.visible) { o.visible = false; hidden.push(o); } });

  const rooms = INTERIORS[buildingType].rooms;
  const room = rooms.find(r => r.key === roomKey) || rooms[0];
  const group = buildVillaRoomGroup(room);
  group.position.set(plot.x, 0, plot.z);
  group.rotation.y = plot.ry;
  scene.add(group);

  _villaInterior = { plotKey, buildingType, x: plot.x, z: plot.z, ry: plot.ry, group, hidden, roomKey: room.key };

  return { room, rooms, buildingType, buildingName: INTERIORS[buildingType].name, view: _villaRoomWorldView(room, plot.x, plot.z, plot.ry) };
}

export function teleportVillaRoom(roomKey) {
  if (!_villaInterior) return null;
  const rooms = INTERIORS[_villaInterior.buildingType].rooms;
  const room = rooms.find(r => r.key === roomKey);
  if (!room) return null;

  scene.remove(_villaInterior.group);
  const group = buildVillaRoomGroup(room);
  group.position.set(_villaInterior.x, 0, _villaInterior.z);
  group.rotation.y = _villaInterior.ry;
  scene.add(group);

  _villaInterior.group = group;
  _villaInterior.roomKey = room.key;

  return { room, rooms, view: _villaRoomWorldView(room, _villaInterior.x, _villaInterior.z, _villaInterior.ry) };
}

export function exitVillaInterior() {
  if (!_villaInterior) return;
  scene.remove(_villaInterior.group);
  _villaInterior.hidden.forEach(o => { o.visible = true; });
  _villaInterior = null;
}
