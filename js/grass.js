/**
 * Project XIX — Grass  v1
 *
 * WHY THE OLD ONE WAS TURNED OFF
 * ------------------------------
 * addGrassField() in graphics.js builds flat PlaneGeometry cards that only read
 * as grass while tickGrass() rotates every one of them to face the camera each
 * frame. tickGrass() was reduced to a bare return for performance, so the cards
 * stayed frozen at whatever angle they were built at and looked like litter.
 * The whole system was then bypassed at scene.js:3396 and never replaced —
 * which is why the safety zones and verges read as flat colour beside the
 * shaded polo pitch.
 *
 * WHAT THIS DOES INSTEAD
 * ----------------------
 * Crossed quads, not billboards. Two intersecting planes per tuft have volume
 * from every angle, so nothing has to be rotated per frame and the CPU cost is
 * zero once built. This is the same approach the palms use.
 *
 * A FIXED POOL that follows the camera. The estate is 655 x 442 m; carpeting it
 * would be millions of instances. Instead a fixed number of tufts are scattered
 * in a radius around the camera and recycled as you move — walk forward and the
 * tufts behind you are re-scattered in front. Cost is constant no matter how
 * large the estate gets, and grass is only ever visible close up anyway.
 *
 * Placement is masked to the planted zones. Laterite, roads, water and building
 * footprints are excluded, so tufts never sprout through a wall or a road.
 *
 * Wind comes from applyFoliageWind() in graphics.js, shared with the palms and
 * trees, so everything in the estate sways on one clock.
 *
 * USAGE
 *   import { createGrass, tickGrass2, setGrassQuality } from './grass.js?v=89';
 *   _grass = createGrass(scene, PERF_MODE);
 *   tickGrass2(_grass, camera);        // once per frame
 *   setGrassQuality(_grass, mode);     // on perf change
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { applyFoliageWind } from "./graphics.js?v=89";

// Fast gets none. An integrated GPU is already the constrained case, and grass
// is the first thing that should go — it is the least load-bearing detail in a
// sales walkthrough.
const COUNT_BY_MODE  = { fast: 0, balanced: 900, rich: 2200 };
const RADIUS_BY_MODE = { fast: 0, balanced: 42,  rich: 58 };

const TUFT_H = 0.42;          // metres, mown estate lawn rather than meadow
const SCATTER_STEP = 6;       // re-scatter after the camera moves this far

// ── PLANTED ZONES ───────────────────────────────────────────────────────────
// Rectangles in world space that are actually grassed. Everything outside is
// laterite, road, water or building. Kept deliberately coarse — a tuft a metre
// out of place is invisible, a tuft in the middle of a road is not.
const ZONES = [
  { x0: -155, x1:  155, z0:  -91, z1:   91 },   // safety zone around the pitch
  { x0: -330, x1: -268, z0:  -85, z1:    5 },   // training field
  { x0:  170, x1:  219, z0: -116, z1:  -29 },   // paddock
  { x0: -260, x1:  260, z0: -160, z1: -120 },   // northern verge, below the lofts
  { x0: -260, x1:  260, z0:  100, z1:  140 },   // southern verge
];

// Keep-out boxes: the pitch itself has its own shader, and water is water.
const EXCLUDE = [
  { x0: -137, x1: 137, z0: -73,  z1: 73  },     // polo playing surface
  { x0:  -90, x1:  90, z0: -116, z1: -87 },     // lake
];

function inside(x, z, b) { return x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1; }
function plantable(x, z) {
  if (EXCLUDE.some(b => inside(x, z, b))) return false;
  return ZONES.some(b => inside(x, z, b));
}

// ── TEXTURE ─────────────────────────────────────────────────────────────────
// Drawn rather than loaded: one less asset to ship, one less thing to go
// missing, and a tuft of blades is a handful of tapered triangles.
function makeTuftTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 128, 128);
  for (let i = 0; i < 22; i++) {
    const baseX = 20 + Math.random() * 88;
    const h     = 58 + Math.random() * 62;
    const lean  = (Math.random() - 0.5) * 34;
    const w     = 2.4 + Math.random() * 2.6;
    // Darker at the root, brighter at the tip — reads as self-shadowing even
    // before any lighting is applied.
    const grad = g.createLinearGradient(baseX, 128, baseX + lean, 128 - h);
    grad.addColorStop(0,   '#2f4a22');
    grad.addColorStop(0.6, '#4e7a33');
    grad.addColorStop(1,   '#6f9a44');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(baseX - w, 128);
    g.quadraticCurveTo(baseX + lean * 0.4, 128 - h * 0.55, baseX + lean, 128 - h);
    g.quadraticCurveTo(baseX + lean * 0.4 + w, 128 - h * 0.55, baseX + w, 128);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildMesh(count, tex) {
  // Two crossed quads per tuft, merged into one geometry so a tuft is a single
  // instance rather than two.
  const a = new THREE.PlaneGeometry(TUFT_H * 1.5, TUFT_H, 1, 3);
  a.translate(0, TUFT_H / 2, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const pos = new Float32Array(a.attributes.position.count * 2 * 3);
  const uv  = new Float32Array(a.attributes.uv.count * 2 * 2);
  const nor = new Float32Array(a.attributes.normal.count * 2 * 3);
  pos.set(a.attributes.position.array, 0);
  pos.set(b.attributes.position.array, a.attributes.position.array.length);
  uv.set(a.attributes.uv.array, 0);
  uv.set(b.attributes.uv.array, a.attributes.uv.array.length);
  nor.set(a.attributes.normal.array, 0);
  nor.set(b.attributes.normal.array, a.attributes.normal.array.length);
  const idxA = Array.from(a.index.array);
  const off  = a.attributes.position.count;
  const geo  = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('normal',   new THREE.BufferAttribute(nor, 3));
  geo.setIndex(idxA.concat(idxA.map(i => i + off)));
  a.dispose(); b.dispose();

  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    alphaTest: 0.42,          // cutout, so it writes depth and sorts properly
    transparent: false,
    side: THREE.DoubleSide,
    roughness: 0.95,
    metalness: 0.0,
  });
  // amp is low: a lawn ripples, it does not thrash like a palm crown.
  applyFoliageWind(mat, { mode: 'height', height: TUFT_H, amp: 0.22 });

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.frustumCulled = false;   // it follows the camera, so it is always in view
  mesh.castShadow = false;      // 2200 tufts in the shadow map buys nothing
  mesh.receiveShadow = true;
  mesh.name = 'grassField';
  return mesh;
}

const _d = new THREE.Object3D();

function scatter(g, cx, cz) {
  const R = g.radius;
  let placed = 0;
  for (let i = 0; i < g.count; i++) {
    // Square-root radial distribution gives even area density; a plain uniform
    // radius clumps everything at the centre.
    let x = 0, z = 0, ok = false;
    for (let tries = 0; tries < 6 && !ok; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * R;
      x = cx + Math.cos(ang) * rad;
      z = cz + Math.sin(ang) * rad;
      ok = plantable(x, z);
    }
    if (!ok) {
      // Nowhere valid nearby — park it under the ground rather than leave a
      // stale instance visible somewhere it should not be.
      _d.position.set(0, -50, 0);
      _d.scale.setScalar(0.001);
      _d.rotation.set(0, 0, 0);
    } else {
      _d.position.set(x, 0, z);
      _d.rotation.set(0, Math.random() * Math.PI, 0);
      const s = 0.75 + Math.random() * 0.6;
      _d.scale.set(s, s * (0.8 + Math.random() * 0.5), s);
      placed++;
    }
    _d.updateMatrix();
    g.mesh.setMatrixAt(i, _d.matrix);
  }
  g.mesh.instanceMatrix.needsUpdate = true;
  return placed;
}

export function createGrass(scene, perfMode = 'balanced') {
  const count  = COUNT_BY_MODE[perfMode]  ?? 900;
  const radius = RADIUS_BY_MODE[perfMode] ?? 42;
  if (!count) {
    console.log(`[XIX] Grass: disabled (${perfMode})`);
    return { mesh: null, count: 0, radius: 0, tex: null, last: null, scene, mode: perfMode };
  }
  const tex  = makeTuftTexture();
  const mesh = buildMesh(count, tex);
  scene.add(mesh);
  const g = { mesh, count, radius, tex, last: null, scene, mode: perfMode };
  const placed = scatter(g, 0, 0);
  console.log(`[XIX] Grass: ${count} tufts, ${radius} m radius, ${placed} on plantable ground (${perfMode})`);
  return g;
}

export function tickGrass2(g, camera) {
  if (!g || !g.mesh || !camera) return;
  const p = camera.position;
  if (g.last && (p.x - g.last.x) ** 2 + (p.z - g.last.z) ** 2 < SCATTER_STEP * SCATTER_STEP) return;
  scatter(g, p.x, p.z);
  g.last = { x: p.x, z: p.z };
}

export function setGrassQuality(g, perfMode) {
  if (!g || g.mode === perfMode) return g;
  const scene = g.scene;
  if (g.mesh) { scene.remove(g.mesh); g.mesh.geometry.dispose(); g.mesh.material.dispose(); }
  if (g.tex) g.tex.dispose();
  return createGrass(scene, perfMode);
}
