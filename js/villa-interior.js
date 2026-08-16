/**
 * Project XIX — Villa Interior Scene
 * Builds a navigable interior of the 3-Bedroom Premium Villa
 * from the actual floor plans:
 *   Level 0 (0mm)    — ground / garden
 *   Level 5 (2100mm) — undercroft parking
 *   Level 2 (2850mm) — ground floor living (kitchen 26m², living/dining 42m², study 22m², terrace, ante room)
 *   Level 3 (6150mm) — first floor (master 27m², bath 7m², WIC 5m², bed2 16m², bed3 17m², bath×2 5m², family lounge 23m², terrace)
 *   Level 4 (9450mm) — roof eave
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";

// Scale: 1 unit = 1 metre. All dimensions from plans in metres.
const FLOOR_THICK = 0.22;
const WALL_THICK  = 0.24;
const CEIL_H_UNDER = 2.4;   // undercroft clear height
const CEIL_H_LIVING = 3.3;  // ground + first floor FTF
const GLASS_OPACITY = 0.38;

// Levels (converted from mm)
const L0 = 0;
const L5 = 2.1;    // undercroft floor
const L2 = 2.85;   // ground floor slab (living level)
const L3 = 6.15;   // first floor slab
const L4 = 9.45;   // roof eave

// Material palette — warm interior
function wall(col = 0xf5f2ee)   { return new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, metalness: 0 }); }
function floor(col = 0xe8e0d4)  { return new THREE.MeshStandardMaterial({ color: col, roughness: 0.4,  metalness: 0 }); }
function glass(col = 0x9ecce0, op = GLASS_OPACITY) {
  return new THREE.MeshStandardMaterial({ color: col, roughness: 0.05, metalness: 0.08, transparent: true, opacity: op });
}
function wood(col = 0xc49a40)   { return new THREE.MeshStandardMaterial({ color: col, roughness: 0.65, metalness: 0 }); }
function dark(col = 0x282c2a)   { return new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.3 }); }
function fabric(col = 0xd4c8b0) { return new THREE.MeshStandardMaterial({ color: col, roughness: 0.95, metalness: 0 }); }
function stone(col = 0xc8c0b0)  { return new THREE.MeshStandardMaterial({ color: col, roughness: 0.7,  metalness: 0.05 }); }
function emit(col, int = 0.9) {
  const m = new THREE.MeshStandardMaterial({ color: col, emissive: new THREE.Color(col), emissiveIntensity: int });
  return m;
}

// Geometry helpers
function box(w, h, d, mat, pos = [0,0,0], ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(...pos); m.rotation.y = ry;
  m.castShadow = h > 0.1; m.receiveShadow = true;
  return m;
}
function cyl(r, h, seg, mat, pos = [0,0,0]) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat);
  m.position.set(...pos); m.castShadow = true;
  return m;
}

// ─── VILLA FLOOR PLAN DIMENSIONS (from drawings) ─────────────
// Plot footprint ~17m × 17m (approximate from plan scale)
const VW = 16.5;   // villa width (E-W, field-facing)
const VD = 14.0;   // villa depth (N-S)

// ─── NAMED VIEWPOINTS INSIDE VILLA ───────────────────────────
export const VILLA_VIEWPOINTS = [
  { key: "approach",     label: "Street Approach",    pos: [0,   L5 + 1.65,  12],   yaw: Math.PI,     caption: "Street approach — undercroft entry" },
  { key: "undercroft",   label: "Undercroft",          pos: [0,   L5 + 1.0,   2],    yaw: 0,           caption: "Undercroft parking — 2.4m clear height" },
  { key: "ante_room",    label: "Ante Room",           pos: [3.5, L2 + 1.65,  1.5],  yaw: -Math.PI/6,  caption: "Ante room — formal entry, 12m²" },
  { key: "living",       label: "Living & Dining",     pos: [3.5, L2 + 1.65, -2],    yaw: 0,           caption: "Living/Dining — 42m², polo field view" },
  { key: "terrace_gf",   label: "Front Terrace",       pos: [2,   L2 + 1.65, -7.5],  yaw: 0,           caption: "Ground floor terrace — unobstructed field panorama" },
  { key: "kitchen",      label: "Kitchen",             pos: [-3,  L2 + 1.65, -1],    yaw: Math.PI/4,   caption: "Kitchen — 26m², island unit, secondary terrace" },
  { key: "family_lounge",label: "Family Lounge",       pos: [4.5, L3 + 1.65, -1],    yaw: 0,           caption: "Family lounge — 23m², elevated field view" },
  { key: "master",       label: "Master Bedroom",      pos: [-2,  L3 + 1.65, -2],    yaw: -Math.PI/8,  caption: "Master bedroom — 27m², best view in the estate" },
  { key: "master_bath",  label: "Master Bathroom",     pos: [-2,  L3 + 1.65,  2],    yaw: Math.PI/2,   caption: "Master bath — freestanding bath, sky light" },
  { key: "bedroom2",     label: "Bedroom 2",           pos: [4.5, L3 + 1.65, -3.5],  yaw: Math.PI/2,   caption: "Bedroom 2 — 16m², garden aspect" },
  { key: "bedroom3",     label: "Bedroom 3",           pos: [0,   L3 + 1.65,  3],    yaw: -Math.PI/3,  caption: "Bedroom 3 — 17m², 17m², clubhouse aspect" },
  { key: "terrace_ff",   label: "First Floor Terrace", pos: [2.5, L3 + 1.65, -6.8],  yaw: 0,           caption: "First floor terrace — private, south-facing" },
];

// ─── BUILD THE INTERIOR SCENE ─────────────────────────────────
export function buildVillaInterior(scene) {
  // Lighting and Exterior Context removed. 
  // The villa is now physically integrated into the main world's lighting and environment.
  addUndercroft(scene);
  addGroundFloor(scene);
  addFirstFloor(scene);
  addRoof(scene);
  addFurniture(scene);
}

// ── LIGHTING ─────────────────────────────────────────────────

function addLighting(scene) {
  // Warm interior ambient
  scene.add(new THREE.HemisphereLight(0xffe8d0, 0x3a5030, 0.7));

  // Sun through windows (golden hour)
  const sun = new THREE.DirectionalLight(0xffe4a0, 2.8);
  sun.position.set(-15, 20, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -20;
  sun.shadow.camera.right = sun.shadow.camera.top   =  20;
  sun.shadow.bias = -0.001;
  scene.add(sun);

  // Interior ceiling lights — ground floor
  for (const pos of [[0, L2+3.1, 0], [-3, L2+3.1, -2], [3.5, L2+3.1, -2], [3.5, L2+3.1, 1.5]]) {
    const pt = new THREE.PointLight(0xffe8c0, 1.8, 8, 2);
    pt.position.set(...pos);
    scene.add(pt);
    // Visible ceiling fixture
    const fix = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8),
      emit(0xfff0d0, 1.2));
    fix.position.set(...pos); scene.add(fix);
  }

  // First floor lights
  for (const pos of [[-2, L3+3.1, -2], [4.5, L3+3.1, -1.5], [4.5, L3+3.1, -3.5], [0, L3+3.1, 3]]) {
    const pt = new THREE.PointLight(0xffe8c0, 1.6, 8, 2);
    pt.position.set(...pos);
    scene.add(pt);
    const fix = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), emit(0xfff0d0, 1.0));
    fix.position.set(...pos); scene.add(fix);
  }

  // Undercroft utilitarian light
  const uct = new THREE.PointLight(0xe8f0ff, 1.2, 12, 2);
  uct.position.set(0, L5 + 1.8, 2); scene.add(uct);

  // Kitchen warm accent
  const kpt = new THREE.PointLight(0xffcc80, 1.4, 7, 2);
  kpt.position.set(-3, L2 + 2.5, -1); scene.add(kpt);
}

// ── UNDERCROFT (Level 5 = 2.1m above grade) ──────────────────

function addUndercroft(scene) {
  const floorY  = L5;
  const ceilY   = L2;
  const roomH   = ceilY - floorY; // ~0.75m clear + slab

  // Floor slab
  scene.add(box(VW, FLOOR_THICK, VD*0.65, floor(0xa0989090), [0, floorY - FLOOR_THICK/2, 2]));

  // Ceiling = ground floor slab underside
  scene.add(box(VW, FLOOR_THICK, VD*0.65, wall(0xd8d0c8), [0, ceilY - FLOOR_THICK/2, 2]));

  // Back wall (north)
  scene.add(box(VW, roomH, WALL_THICK, wall(0xc8c0b8), [0, floorY + roomH/2, VD*0.325]));

  // Side walls
  scene.add(box(WALL_THICK, roomH, VD*0.65, wall(0xc8c0b8), [-VW/2, floorY + roomH/2, 2]));
  scene.add(box(WALL_THICK, roomH, VD*0.65, wall(0xc8c0b8), [ VW/2, floorY + roomH/2, 2]));

  // Garage opening (front, south face) — leave open
  // Parking bays markings
  const bayMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  scene.add(box(0.08, 0.02, VD*0.55, bayMat, [0, floorY + 0.01, 2], 0));

  // Ramp going down from street level to undercroft
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(VW*0.55, 0.18, 6), wall(0xb0a898));
  ramp.position.set(0, L0 + 0.9, -7);
  ramp.rotation.x = -Math.atan2(L5 - L0, 6);
  ramp.receiveShadow = true;
  scene.add(ramp);

  // Retaining wall (basketweave masonry, right of ramp) — from elevation
  const bwMat = stone(0xc8b898);
  scene.add(box(0.3, L5 + 1.5, 7, bwMat, [VW/2 + 1, L0 + (L5+1.5)/2, -5]));

  // Staff quarters partition
  scene.add(box(4.5, roomH, WALL_THICK, wall(0xc0b8b0), [VW/2 - 2.25, floorY + roomH/2, -1]));

  // Store door
  scene.add(box(0.9, 2.1, 0.08, dark(), [VW/2 - 0.5, floorY + 1.05, 2]));
}

// ── GROUND FLOOR (Level 2 = 2.85m) ──────────────────────────

function addGroundFloor(scene) {
  const fy = L2;
  const cy = L3;  // ceiling = first floor slab
  const h  = cy - fy;  // 3.3m

  const wm  = wall(0xf5f2ee);
  const fm  = floor(0xe5ddd4); // large-format warm grey tile
  const gm  = glass();
  const dm  = dark();
  const wdm = wood(0xc49a40);
  const wh  = wall(0xfafaf8);  // white trim

  // ── Floor slab ──
  scene.add(box(VW, FLOOR_THICK, VD, fm, [0, fy - FLOOR_THICK/2, 0]));

  // ── Ceiling ──
  scene.add(box(VW, FLOOR_THICK, VD, wall(0xfcfaf8), [0, cy - FLOOR_THICK/2, 0]));

  // ── Perimeter walls ──
  // South (field-facing) — mostly glazed
  scene.add(box((VW - 9)/2, h, WALL_THICK, wm, [-VW/2 + (VW-9)/4, fy + h/2, -VD/2]));
  scene.add(box((VW - 9)/2, h, WALL_THICK, wm, [ VW/2 - (VW-9)/4, fy + h/2, -VD/2]));
  // Full-height glazing (south face living/dining)
  scene.add(box(9, h, 0.08, gm, [0, fy + h/2, -VD/2 + 0.04]));

  // North wall (solid)
  scene.add(box(VW, h, WALL_THICK, wm, [0, fy + h/2, VD/2]));

  // West wall
  scene.add(box(WALL_THICK, h, VD, wm, [-VW/2, fy + h/2, 0]));

  // East wall (solid except study window)
  scene.add(box(WALL_THICK, h - 1.4, WALL_THICK, wm, [VW/2, fy + h/2 + 0.7, 0]));
  scene.add(box(WALL_THICK, 1.4, 2.5, gm, [VW/2, fy + 0.7, 2])); // study window

  // ── Internal walls ──
  // Kitchen / living divider (partial wall, opening to east)
  scene.add(box(6, h, WALL_THICK, wm, [-VW/2 + 3, fy + h/2, 0]));
  // Ante room south wall
  scene.add(box(3.5, h, WALL_THICK, wm, [VW/2 - 1.75, fy + h/2, -VD/2 + 3.5]));
  // Stair lobby west wall
  scene.add(box(WALL_THICK, h, 4, wm, [VW/2 - 3.5, fy + h/2, VD/2 - 3]));

  // ── Terrace (south, field-facing) ──
  // Terrace floor plate
  scene.add(box(9.5, FLOOR_THICK, 3.5, floor(0xddd8d0), [0, fy - FLOOR_THICK/2, -VD/2 - 1.75]));
  // Glass balustrade
  scene.add(box(9.5, 1.05, 0.05, glass(0xb0d8e8, 0.35), [0, fy + 0.525, -VD/2 - 3.4]));
  // Balustrade rail
  scene.add(box(9.6, 0.08, 0.06, dm, [0, fy + 1.08, -VD/2 - 3.4]));

  // ── Kitchen secondary terrace (west side) ──
  scene.add(box(3, FLOOR_THICK, 3, floor(0xddd8d0), [-VW/2 - 1.5, fy - FLOOR_THICK/2, -2]));
  scene.add(box(0.05, 1.0, 3, glass(0xb0d8e8, 0.32), [-VW/2 - 3.05, fy + 0.5, -2]));

  // ── Skirting & door frames ──
  scene.add(box(VW, 0.12, 0.06, wh, [0, fy + 0.06, VD/2 - 0.03], 0));
  scene.add(box(VW, 0.12, 0.06, wh, [0, fy + 0.06, -VD/2 + 0.03], 0));

  // ── Main staircase (east side) ──
  addStaircase(scene, VW/2 - 2.2, fy, L3, -1, 1);
}

// ── FIRST FLOOR (Level 3 = 6.15m) ───────────────────────────

function addFirstFloor(scene) {
  const fy = L3;
  const cy = L4 - 0.5; // ceiling at eave line
  const h  = cy - fy;  // ~2.8m (slightly less under hip roof)

  const wm  = wall(0xf5f2ee);
  const fm  = floor(0xe8e0d8);
  const gm  = glass(0x9ecce0, 0.35);
  const dm  = dark();
  const wh  = wall(0xfafaf8);

  // Floor slab
  scene.add(box(VW, FLOOR_THICK, VD, fm, [0, fy - FLOOR_THICK/2, 0]));
  // Ceiling (pitched — simplified as flat near eave)
  scene.add(box(VW, FLOOR_THICK, VD, wall(0xfdfcfa), [0, cy + 0.05, 0]));

  // ── Perimeter walls ──
  // South (field-facing) — two tall narrow windows (from elevation)
  scene.add(box((VW - 3)/2, h, WALL_THICK, wm, [-VW/2 + (VW-3)/4 - 0.5, fy + h/2, -VD/2]));
  scene.add(box((VW - 3)/2, h, WALL_THICK, wm, [ VW/2 - (VW-3)/4 + 0.5, fy + h/2, -VD/2]));
  // Two tall windows (master bedroom, centred)
  for (const wx of [-1.2, 1.2]) {
    scene.add(box(0.05, h*0.82, 1.5, gm, [wx, fy + h*0.18/2 + h*0.82/2, -VD/2 + 0.04]));
  }

  // North wall
  scene.add(box(VW, h, WALL_THICK, wm, [0, fy + h/2, VD/2]));
  // West wall
  scene.add(box(WALL_THICK, h, VD, wm, [-VW/2, fy + h/2, 0]));
  // East wall — bedroom 2 window
  scene.add(box(WALL_THICK, h, VD*0.4, wm, [VW/2, fy + h/2, -VD*0.3]));
  scene.add(box(WALL_THICK, h, VD*0.4, wm, [VW/2, fy + h/2,  VD*0.3]));
  scene.add(box(WALL_THICK, 1.6, 2.2, gm, [VW/2, fy + 0.8, 0]));

  // ── Internal walls (from first floor plan) ──
  // Master bedroom south + west walls = perimeter
  // Master / bath partition
  scene.add(box(VW*0.45, h, WALL_THICK, wm, [-VW*0.25 + WALL_THICK/2, fy + h/2, 0]));
  // Bath / WIC
  scene.add(box(WALL_THICK, h, 3.8, wm, [-VW*0.1, fy + h/2, 1.9]));
  // Bedroom 3 / bed2 partition
  scene.add(box(5.5, h, WALL_THICK, wm, [-VW*0.1 + 2.75, fy + h/2, 3.2]));
  // Stair lobby east
  scene.add(box(WALL_THICK, h, 5, wm, [VW*0.2, fy + h/2, 0]));
  // Family lounge partition (south of lobby)
  scene.add(box(VW*0.38, h, WALL_THICK, wm, [VW*0.31, fy + h/2, -2.5]));

  // ── First floor terrace (south-west of family lounge) ──
  scene.add(box(5, FLOOR_THICK, 3, floor(0xddd8d0), [0, fy - FLOOR_THICK/2, -VD/2 - 1.5]));
  scene.add(box(5.1, 1.0, 0.05, glass(0xb0d8e8, 0.32), [0, fy + 0.5, -VD/2 - 3.05]));

  // Skirting
  scene.add(box(VW, 0.12, 0.06, wh, [0, fy + 0.06, VD/2 - 0.03], 0));
}

// ── STAIRCASE ─────────────────────────────────────────────────

function addStaircase(scene, x, fromY, toY, z1, z2) {
  const steps  = 14;
  const riser  = (toY - fromY) / steps;
  const tread  = Math.abs(z2 - z1) / steps;
  const stairW = 2.8;
  const treM   = floor(0xddd5c8);
  const riserM = wall(0xfafaf8);
  const railM  = dark();
  const handM  = wood();

  for (let i = 0; i < steps; i++) {
    const sy = fromY + i * riser + riser / 2;
    const sz = z1 + (z2 > z1 ? i : steps - i) * tread;
    // Tread
    scene.add(box(stairW, 0.04, 0.28, treM, [x, sy, sz]));
    // Open-riser (dark gap is intentional — floating stair)
  }

  // Glass balustrade
  scene.add(box(0.05, toY - fromY, stairW, glass(0xb0d8e8, 0.28),
    [x - stairW/2, fromY + (toY-fromY)/2, (z1+z2)/2]));
  // Handrail
  scene.add(box(0.06, 0.06, Math.hypot(toY-fromY, Math.abs(z2-z1)),
    handM, [x - stairW/2, fromY + (toY-fromY)/2, (z1+z2)/2],
    -Math.atan2(toY-fromY, Math.abs(z2-z1))));
}

// ── ROOF ──────────────────────────────────────────────────────

function addRoof(scene) {
  // Hip roof — pitched, metal standing seam cladding (from section/elevation)
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a9090, roughness: 0.6, metalness: 0.35 });

  // Eave perimeter box
  scene.add(box(VW + 1.5, 0.35, VD + 1.5, wall(0xf5f2ee), [0, L4, 0]));

  // Hip slopes — 4 faces
  const pitch = Math.atan2(L4 - L3 + 1.5, VW/2); // ~30°
  const roofH = 3.2; // ridge height above eave

  // Front slope (south, field-facing)
  const rs = box(VW + 2, 0.22, VD*0.8, roofMat, [0, L4 + roofH/2, -1]);
  rs.rotation.x = -pitch * 0.6; scene.add(rs);

  // Back slope (north)
  const rb = box(VW + 2, 0.22, VD*0.8, roofMat, [0, L4 + roofH/2, 1]);
  rb.rotation.x = pitch * 0.6; scene.add(rb);

  // Ridge board
  scene.add(box(VW*0.6, 0.3, 0.25, roofMat, [0, L4 + roofH, 0]));

  // Fascia boards (deep overhang detail)
  scene.add(box(VW + 2.2, 0.25, 0.12, wall(0xfcfaf8), [0, L4 - 0.1, -VD/2 - 1.2]));
  scene.add(box(VW + 2.2, 0.25, 0.12, wall(0xfcfaf8), [0, L4 - 0.1,  VD/2 + 1.2]));
}

// ── FURNITURE & INTERIOR DETAIL ────────────────────────────────

function addFurniture(scene) {
  addLivingDining(scene);
  addKitchen(scene);
  addMasterBedroom(scene);
  addBathroom(scene);
  addBedrooms(scene);
  addFamilyLounge(scene);
}

function addLivingDining(scene) {
  const fy = L2;
  const fm = fabric(0xd4c8a8);  // linen sofa
  const wdm = wood(0xb08840);

  // L-shaped sofa
  scene.add(box(3.2, 0.75, 1.0, fm, [1.5, fy + 0.375, -1.5]));
  scene.add(box(1.0, 0.75, 2.5, fm, [2.6, fy + 0.375, -2.2]));
  // Cushion backs
  scene.add(box(3.2, 0.55, 0.28, fabric(0xc8bcaa), [1.5, fy + 1.0, -2.0]));

  // Coffee table — travertine
  scene.add(box(1.2, 0.42, 0.7, stone(0xd8cfc0), [1.0, fy + 0.21, -1.8]));

  // Dining table — solid oak, 8-seater
  scene.add(box(2.4, 0.78, 1.0, wood(0xb08030), [4.0, fy + 0.39, -1.5]));
  // Dining chairs
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
    const cx = 3.0 + r * 2.2;
    const cz = -2.2 + c * 0.58;
    scene.add(box(0.46, 0.44, 0.46, fabric(0x9a7840), [cx, fy + 0.22, cz]));
    scene.add(box(0.46, 0.55, 0.06, fabric(0x9a7840), [cx, fy + 0.72, cz + (r===0?0.24:-0.24)]));
  }

  // Feature pendant lights over dining
  for (const dl of [-0.4, 0, 0.4]) {
    const pendant = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6),
      emit(0xffe0a0, 0.8));
    pendant.position.set(4.0 + dl * 0.6, fy + 2.5, -1.5);
    scene.add(pendant);
    // Drop cord
    const cord = box(0.02, 0.6, 0.02, dark(), [4.0 + dl * 0.6, fy + 2.85, -1.5]);
    scene.add(cord);
  }

  // Feature wall (textured lime plaster — warm tone)
  scene.add(box(0.06, 2.8, 3.5, wall(0xd4b898), [0.5, fy + 1.4, -2.5]));
}

function addKitchen(scene) {
  const fy = L2;
  const km  = stone(0x1a1a1a);  // dark island — Nero Marquina
  const cab = wall(0xf8f6f4);   // white cabinetry

  // Island unit
  scene.add(box(2.2, 0.92, 1.05, km, [-3.0, fy + 0.46, -1.2]));
  // Bar stool legs
  for (const sz of [-1.8, -1.2, -0.6]) {
    scene.add(cyl(0.04, 0.72, 8, dark(), [-2.1, fy + 0.36, sz]));
    scene.add(box(0.34, 0.08, 0.34, fabric(0xc8a870), [-2.1, fy + 0.72, sz]));
  }

  // Base cabinets (north wall)
  scene.add(box(VW*0.4, 0.9, 0.6, cab, [-VW/2 + VW*0.2, fy + 0.45, VD/2 - 0.3]));
  // Upper cabinets to ceiling
  scene.add(box(VW*0.4, 1.8, 0.38, cab, [-VW/2 + VW*0.2, fy + 2.1, VD/2 - 0.19]));

  // Range hood (polished steel)
  scene.add(box(0.8, 0.5, 0.55,
    new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.15, metalness: 0.8 }),
    [-VW/2 + VW*0.15, fy + 2.2, VD/2 - 0.28]));

  // Hob (6-burner)
  scene.add(box(0.78, 0.04, 0.52, dark(0x111111), [-VW/2 + VW*0.15, fy + 0.92, VD/2 - 0.3]));
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.01, 6, 12),
      dark(0x444444));
    ring.position.set(-VW/2 + 0.24 + r * 0.28, fy + 0.96, VD/2 - 0.18 - c * 0.14);
    ring.rotation.x = Math.PI/2; scene.add(ring);
  }
}

function addMasterBedroom(scene) {
  const fy = L3;
  const bm = fabric(0x4a6458);  // deep velvet headboard
  const wm = wall(0xf5f2ee);

  // Super-king bed (1.8m × 2.0m)
  scene.add(box(2.0, 0.55, 2.2, fabric(0xf0ece4), [-2.0, fy + 0.275, -2.8]));
  // Upholstered headboard
  scene.add(box(2.0, 1.2, 0.16, bm, [-2.0, fy + 1.1, -1.72]));
  // Pillows
  for (const px of [-0.55, 0.55]) {
    scene.add(box(0.68, 0.2, 0.46, wall(0xfafaf8), [-2.0 + px, fy + 0.66, -1.95]));
  }

  // Bedside tables
  for (const bx of [-0.7, 0.7]) {
    scene.add(box(0.55, 0.58, 0.4, dark(0x4a4e4c), [-2.0 + bx * 1.6, fy + 0.29, -2.8]));
    // Reading light
    const rl = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), emit(0xffe0b0, 0.7));
    rl.position.set(-2.0 + bx * 1.6, fy + 0.72, -2.55); scene.add(rl);
  }

  // Low credenza
  scene.add(box(2.4, 0.65, 0.48, wood(0x9a7830), [-2.0, fy + 0.325, -4.5]));

  // Double-height wardrobe (leads to WIC)
  scene.add(box(2.5, 2.8, 0.65, wall(0xf0ece8), [-2.0, fy + 1.4, 0.5]));
  // WIC door
  scene.add(box(0.9, 2.2, 0.06, wood(0xd4b870), [-0.8, fy + 1.1, 0.18]));
}

function addBathroom(scene) {
  const fy = L3;

  // Freestanding oval bath
  const bathOuter = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.44, 0.62, 16),
    stone(0xf5f0ec));
  bathOuter.position.set(-3.8, fy + 0.31, 2.5);
  bathOuter.scale.set(1.6, 1, 1); scene.add(bathOuter);
  // Bath interior (dark water suggest)
  const bathInner = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.38, 0.3, 16),
    glass(0x4a8aaa, 0.45));
  bathInner.position.set(-3.8, fy + 0.5, 2.5);
  bathInner.scale.set(1.55, 1, 1); scene.add(bathInner);

  // Double vanity
  scene.add(box(1.6, 0.88, 0.52, wood(0xb08040), [-3.5, fy + 0.44, 0.5]));
  scene.add(box(1.6, 0.04, 0.52, stone(0xd8d0c8), [-3.5, fy + 0.9, 0.5]));
  // Twin basins
  for (const bx of [-0.42, 0.42]) {
    scene.add(box(0.44, 0.08, 0.34, stone(0xfafaf8), [-3.5 + bx, fy + 0.93, 0.52]));
  }
  // Twin backlit mirrors
  for (const bx of [-0.42, 0.42]) {
    scene.add(box(0.44, 0.75, 0.04, wall(0x9ecce0), [-3.5 + bx, fy + 1.42, 0.25]));
    const ml = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.78),
      emit(0xffe8d8, 0.3));
    ml.position.set(-3.5 + bx, fy + 1.42, 0.23); ml.rotation.y = Math.PI;
    scene.add(ml);
  }

  // Walk-in rain shower (frameless glass)
  scene.add(box(1.1, 2.5, 0.04, glass(0xc0d8e8, 0.28), [-2.0, fy + 1.25, 1.8]));
  scene.add(box(0.04, 2.5, 1.1, glass(0xc0d8e8, 0.28), [-2.55, fy + 1.25, 2.35]));
  // Shower head
  scene.add(box(0.32, 0.06, 0.32, dark(0xb0b8b0), [-2.3, fy + 2.6, 2.35]));

  // High narrow window above bath
  scene.add(box(0.8, 1.4, 0.05, glass(0xd0e8f0, 0.55), [-VW/2 + 0.03, fy + 1.9, 2.5]));

  // Towel rail (brass)
  scene.add(box(0.6, 0.04, 0.04,
    new THREE.MeshStandardMaterial({ color: 0xd4a840, roughness: 0.2, metalness: 0.7 }),
    [-3.8, fy + 1.3, 0.2]));
}

function addBedrooms(scene) {
  const fy = L3;
  const bm = fabric(0xc8b898);

  // Bedroom 2 (16m²) — east side
  scene.add(box(1.4, 0.5, 1.9, bm, [5.5, fy + 0.25, -3.2]));
  scene.add(box(1.4, 0.95, 0.12, fabric(0x8a9a88), [5.5, fy + 0.73, -2.28]));
  scene.add(box(1.0, 2.2, 0.55, wall(0xf0ece8), [6.5, fy + 1.1, -3.5]));

  // Bedroom 3 (17m²) — south east
  scene.add(box(1.6, 0.5, 2.0, fabric(0xd8c8a8), [1.5, fy + 0.25, 3.5]));
  scene.add(box(1.6, 0.9, 0.12, fabric(0x7a6858), [1.5, fy + 0.7, 2.52]));
  scene.add(box(1.2, 2.2, 0.55, wall(0xf0ece8), [2.8, fy + 1.1, 3.5]));
}

function addFamilyLounge(scene) {
  const fy = L3;

  // 3-seater sofa
  scene.add(box(2.4, 0.72, 0.85, fabric(0x4a6870), [5.2, fy + 0.36, -1.5]));
  scene.add(box(2.4, 0.5, 0.22, fabric(0x4a6870), [5.2, fy + 0.97, -1.92]));

  // Armchair
  scene.add(box(0.82, 0.7, 0.82, fabric(0x4a6870), [3.8, fy + 0.35, -0.5]));

  // Media wall (TV + shelving)
  scene.add(box(2.8, 1.8, 0.18, dark(0x202428), [5.5, fy + 1.5, -3.1]));
  // TV (dark screen)
  scene.add(box(1.2, 0.7, 0.05, dark(0x101214), [5.5, fy + 1.6, -3.0]));
}

// ── EXTERIOR CONTEXT (visible through windows) ────────────────

function addExteriorContext(scene) {
  // Ground plane around villa (garden)
  const gm = new THREE.MeshStandardMaterial({ color: 0x4a7a38, roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), gm);
  ground.rotation.x = -Math.PI/2; ground.position.set(0, L0, 0);
  ground.receiveShadow = true; scene.add(ground);

  // Sky (visible through windows)
  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(55, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0x7ab4d4, side: THREE.BackSide })
  );
  scene.add(skyDome);

  // Distant polo field hint (green plane far south)
  const fieldHint = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 60),
    new THREE.MeshStandardMaterial({ color: 0x5a9448, roughness: 0.95 })
  );
  fieldHint.rotation.x = -Math.PI/2;
  fieldHint.position.set(0, L0 - 0.05, -35);
  scene.add(fieldHint);

  // Cypress trees flanking driveway (from elevation)
  for (const [tx, tz] of [[-4, -4], [-6, -6], [8, -5]]) {
    addCypressTree(scene, tx, L0, tz);
  }

  // Retaining wall basketweave (right of ramp) — from elevation
  const bwm = stone(0xc8b898);
  scene.add(box(0.3, 2.5, 8, bwm, [VW/2 + 1.8, L0 + 1.25, -5]));

  // Street (road surface)
  const roadM = new THREE.MeshStandardMaterial({ color: 0x282c2a, roughness: 0.9 });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(30, 8), roadM);
  road.rotation.x = -Math.PI/2; road.position.set(0, L0 - 0.02, -14);
  scene.add(road);
}

function addCypressTree(scene, x, groundY, z) {
  // Slender conical cypress
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3818, roughness: 0.9 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2a5a30, roughness: 0.85 });
  scene.add(cyl(0.1, 4.5, 8, trunkMat, [x, groundY + 2.25, z]));
  // Conical foliage layers
  for (let i = 0; i < 5; i++) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.7 - i * 0.1, 1.1, 8),
      foliageMat
    );
    cone.position.set(x, groundY + 1.8 + i * 0.85, z);
    cone.castShadow = true; scene.add(cone);
  }
}
