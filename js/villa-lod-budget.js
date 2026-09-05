/**
 * Project XIX — Building LOD Budget  v2
 *
 * (Filename kept as villa-lod-budget.js from v1 so the deployed import path
 *  does not change. It now covers lofts as well — see KINDS below.)
 *
 * PROBLEM THIS SOLVES
 * -------------------
 * THREE.LOD picks a level from distance alone. The villa ring has two very
 * different spacings — 28 m on the west/east columns, 12.88 m on the north arc
 * — so no single swap distance works for both. At VILLA_LOD_SWAP = 60 the
 * columns correctly show 0-4 villas at full detail, but standing on the arc
 * puts NINE in front of you at once. At 979K tris that is 8.8M triangles; at
 * 1.9M it is 17.1M.
 *
 * This module caps the COUNT instead. Every villa is sorted by distance and
 * only the nearest N get level 0, wherever you stand. Triangle load becomes a
 * number you choose rather than a consequence of where the camera happens to
 * be, which also frees you to raise VILLA_LOD_SWAP so the columns stay sharp.
 *
 * It also runs a shadow budget: villas past SHADOW_CUTOFF stop casting. Shadow
 * casting re-renders geometry into the depth map every frame, so a distant
 * villa pays close to full price for a shadow nobody can resolve.
 *
 * INTEGRATION (three lines in scene.js)
 * -------------------------------------
 *   import { initVillaLODBudget, updateVillaLODBudget, setVillaLODBudget }
 *     from './villa-lod-budget.js?v=76';
 *
 *   // after the villa ring is built, and again after loadVillaGLB /
 *   // loadVillaLowGLB resolve (villas are placed asynchronously):
 *   initVillaLODBudget(scene);
 *
 *   // in the render loop, before renderer.render():
 *   updateVillaLODBudget(camera);
 *
 * Nothing else in scene.js changes. placeVillaGLBWithLOD keeps building
 * THREE.LOD objects exactly as it does now — this just takes over which level
 * is visible.
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";

// ── TUNING ───────────────────────────────────────────────────────────────────

// How many villas may show level 0 (the full-detail GLB) at once.
// 3 x 979K  =  2.9M tris.   3 x 1.9M  =  5.7M tris.
// 2 x 1.9M  =  3.8M tris — use 2 if you move to the 1.9M mesh on desktop.
// Mobile should run 0 or 1; see setVillaLODBudget() below.
let HERO_BUDGET = 3;

// Hard distance limit. A villa further than this never gets level 0 even if it
// is among the nearest N — stops the whole budget being spent across the field
// when you are standing in open ground with nothing nearby.
let HERO_MAX_DIST = 90;

// Past this, castShadow is turned off. The sun shadow camera is a tight +/-120m
// frustum, so without this roughly 25 villas render into the depth map.
let SHADOW_CUTOFF = 80;

// Re-sorting 43 villas every frame is cheap but pointless — the ordering only
// changes when you move. Recompute when the camera has travelled this far, or
// when MAX_SKIP frames have passed (catches teleports and slow drift).
const MOVE_EPS = 2.0;
const MAX_SKIP = 30;

// ── STATE ────────────────────────────────────────────────────────────────────

// One independent registry + budget per building kind. A kind is claimed by a
// userData flag set where its LOD is built:
//     isVillaGLB  -> villas, 43 of them, ringing the polo field
//     isLoftGLB   -> lofts,  28 blocks at 26 m pitch in the south-west precinct
//
// They need separate budgets because they are different products. A buyer walks
// up to their own villa and inspects it, so villas earn 2-3 hero slots. Lofts
// are a 96-unit yield product seen from the road and cluster far more tightly
// (26 m pitch vs the villa ring's 28 m columns / 12.88 m arc, but 28 blocks in
// two rows rather than spread around a 274 m field) — so 1 hero slot is plenty
// and 10 blocks land within 150 m of you on the south row.
const KINDS = {
  villa: { flag: 'isVillaGLB', hero: 3, maxDist: 90, shadowCutoff: 80, list: [] },
  loft:  { flag: 'isLoftGLB',  hero: 1, maxDist: 60, shadowCutoff: 0,  list: [] },
};

let _scene = null;
let _lastCam = new THREE.Vector3(Infinity, Infinity, Infinity);
let _skipped = 0;
let _stats = { hero: 0, mid: 0, far: 0, shadowCasters: 0, lastSortMs: 0 };

// ── SETUP ────────────────────────────────────────────────────────────────────

/**
 * Scan the scene for villa LODs and take ownership of their level selection.
 * Safe to call repeatedly — villas are placed asynchronously as the GLBs
 * resolve, so call it again after each load completes.
 */
export function initVillaLODBudget(scene) {
  _scene = scene;
  for (const k of Object.values(KINDS)) k.list.length = 0;

  scene.traverse((o) => {
    if (!o.isLOD) return;
    const kind = Object.values(KINDS).find((k) => o.userData[k.flag]);
    if (!kind) return;

    // Stop THREE.LOD from choosing a level on its own. Without this it fights
    // us every frame: LOD.update() runs during render and overwrites whatever
    // visibility we set.
    o.autoUpdate = false;

    // Placeholder levels (the invisible impostor scene.js adds before the real
    // low model loads) must never be chosen as a tier — selecting one renders
    // the building invisible. Track which indices are real.
    const levels = o.levels.map((l) => l.object);
    const realIdx = levels
      .map((obj, i) => (obj && obj.userData && obj.userData.isLODPlaceholder ? -1 : i))
      .filter((i) => i >= 0);

    // Cache the meshes whose castShadow flag we toggle, so the per-frame path
    // never has to traverse.
    const shadowMeshes = [];
    o.traverse((c) => { if (c.isMesh) shadowMeshes.push(c); });

    kind.list.push({ lod: o, levels, realIdx, shadowMeshes, d2: 0 });
  });

  _lastCam.set(Infinity, Infinity, Infinity);   // force a recompute next frame
  _skipped = MAX_SKIP;
  return Object.fromEntries(Object.entries(KINDS).map(([n, k]) => [n, k.list.length]));
}

/**
 * Adjust the budget at runtime — wire this to your perf tier.
 *   'rich'   -> { hero: 3 }
 *   'medium' -> { hero: 2, shadowCutoff: 60 }
 *   'fast'   -> { hero: 0, shadowCutoff: 0 }   // mobile: never load level 0
 */
export function setVillaLODBudget({ hero, maxDist, shadowCutoff, kind = 'villa' } = {}) {
  const k = KINDS[kind];
  if (!k) return;
  if (Number.isFinite(hero))         k.hero         = Math.max(0, hero | 0);
  if (Number.isFinite(maxDist))      k.maxDist      = maxDist;
  if (Number.isFinite(shadowCutoff)) k.shadowCutoff = shadowCutoff;
  _skipped = MAX_SKIP;               // apply on the next frame, not the next move
}

export function getVillaLODStats() { return { ..._stats }; }

// ── PER-FRAME ────────────────────────────────────────────────────────────────

const _order = [];

/**
 * Call once per frame, before renderer.render().
 */
export function updateVillaLODBudget(camera) {
  const cam = camera.position;
  if (_skipped < MAX_SKIP && cam.distanceToSquared(_lastCam) < MOVE_EPS * MOVE_EPS) {
    _skipped++;
    return;
  }
  const t0 = performance.now();
  _lastCam.copy(cam);
  _skipped = 0;

  let hero = 0, mid = 0, far = 0, casters = 0;

  // Each kind is budgeted independently — a villa in view must never spend a
  // loft's hero slot, or standing between the two precincts would starve one.
  for (const kindDef of Object.values(KINDS)) {
  const items = kindDef.list;
  if (!items.length) continue;

  for (let i = 0; i < items.length; i++) {
    items[i].d2 = items[i].lod.position.distanceToSquared(cam);
  }

  // Partial selection would be faster, but a few dozen elements sort in
  // microseconds and only when you have moved 2 m — not worth optimising.
  _order.length = 0;
  for (let i = 0; i < items.length; i++) _order.push(items[i]);
  _order.sort((a, b) => a.d2 - b.d2);

  const HERO_BUDGET   = kindDef.hero;
  const heroMaxD2     = kindDef.maxDist * kindDef.maxDist;
  const shadowMaxD2   = kindDef.shadowCutoff * kindDef.shadowCutoff;

  for (let i = 0; i < _order.length; i++) {
    const v = _order[i];
    const n = v.levels.length;
    if (!n) continue;

    // Which level this villa should show.
    //   0 = full GLB, granted only to the nearest HERO_BUDGET within range
    //   1 = villa-low, the working tier for everything else
    //   2 = impostor, if a third level exists
    // Only ever choose among REAL levels. If the low tier has not loaded (or
    // failed), realIdx is just [0] and everything correctly stays on the hero
    // rather than dropping to an invisible placeholder.
    const real = v.realIdx && v.realIdx.length ? v.realIdx : [0];
    let want;
    if (i < HERO_BUDGET && v.d2 <= heroMaxD2) { want = real[0]; hero++; }
    else if (real.length > 2 && v.d2 > heroMaxD2 * 4) { want = real[2]; far++; }
    else { want = real[Math.min(1, real.length - 1)]; mid++; }

    for (let j = 0; j < n; j++) {
      const vis = (j === want);
      if (v.levels[j].visible !== vis) v.levels[j].visible = vis;
    }

    // Shadow budget. Distant villas re-render into the depth map for a shadow
    // that lands on a couple of pixels.
    const shouldCast = v.d2 <= shadowMaxD2;
    if (v.lod.userData._casting !== shouldCast) {
      v.lod.userData._casting = shouldCast;
      for (let k = 0; k < v.shadowMeshes.length; k++) {
        v.shadowMeshes[k].castShadow = shouldCast;
      }
    }
    if (shouldCast) casters++;
  }
  }

  _stats = { hero, mid, far, shadowCasters: casters, lastSortMs: performance.now() - t0 };
}

// ── ONE-OFF MATERIAL FIX ─────────────────────────────────────────────────────

/**
 * Call once per loaded villa GLB scene, before it is cloned into the ring.
 *
 * doubleSided on a closed building disables backface culling, so every wall is
 * rasterised twice in the colour pass AND twice in every shadow cascade. For 43
 * villas that is pure waste — you can never see the inside of an exterior shell.
 *
 * Also drops the flatShading flag if the exporter set it, which is a common
 * cause of buildings reading as faceted after decimation.
 */
export function fixVillaMaterials(gltfScene) {
  let fixed = 0, softened = 0;
  gltfScene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];

    // Does this geometry actually carry tangents? Without them Three.js derives
    // them per-fragment from screen-space derivatives, which on a photogrammetry
    // atlas normal map reads as grain rather than relief. applyPS4Materials sets
    // normalScale 1.15 on the assumption of real tangents and multiplies that
    // grain. Rather than force a much larger download, back the scale off when
    // the attribute is absent — most of the perceived noise goes with it.
    const hasTangent = !!(o.geometry && o.geometry.attributes && o.geometry.attributes.tangent);

    for (const m of mats) {
      if (!m) continue;
      if (m.side !== THREE.FrontSide) { m.side = THREE.FrontSide; m.needsUpdate = true; fixed++; }
      if (m.shadowSide !== null) m.shadowSide = null;   // inherit from .side

      if (!hasTangent && m.normalMap && m.normalScale && m.normalScale.x > 0.75) {
        m.normalScale.set(0.65, 0.65);
        m.needsUpdate = true;
        softened++;
      }
    }
  });
  if (softened) {
    console.log(`[XIX] no tangents on ${softened} material(s) — normalScale eased 1.15 -> 0.65 to stop derivative grain`);
  }
  return fixed;
}
