/**
 * Project XIX — 3D Scene Builder
 * Orientation: East–West polo field. North = -Z. South = +Z. East = +X.
 * All measurements in metres. Origin = centre of polo field.
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";

let scene, renderer, camera, clock, sun;

export function initScene(canvas) {
  clock = new THREE.Clock();

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9ac5d5);
  scene.fog = new THREE.FogExp2(0x9ac5d5, 0.0022);

  camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1200);

  buildLighting();
  buildEnvironment();

  return { scene, renderer, camera, clock };
}

function buildLighting() {
  // Lagos golden-hour: low sun from south-west
  const hemi = new THREE.HemisphereLight(0xd4ecff, 0x3d5c2a, 1.4);
  scene.add(hemi);

  sun = new THREE.DirectionalLight(0xffe8b0, 3.2);
  sun.position.set(-120, 160, 100);
  sun.castShadow = true;
  sun.shadow.camera.left   = -320;
  sun.shadow.camera.right  =  320;
  sun.shadow.camera.top    =  220;
  sun.shadow.camera.bottom = -220;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0003;
  scene.add(sun);

  // Fill from opposite side
  const fill = new THREE.DirectionalLight(0xb8d4e8, 0.6);
  fill.position.set(80, 60, -80);
  scene.add(fill);
}

function buildEnvironment() {
  addGround();
  addPoloField();
  addSafetyZone();
  addYardMarkings();
  addLake();
  addCrecentRoad();
  addLagosRoad();
  addInternalRoads();
  addClubhouse();
  addVillaRing();
  addLoftApartments();
  addBlocksOfFlats();
  addNorthLoftRow();
  addTrainingField();
  addStables();
  addPaddockEast();
  addGamePark();
  addCommercialBlock();
  addServiceCompound();
  addTreeRing();
  addRoyalPalms();
}

// ─── MATERIALS ──────────────────────────────────────────────────────────────

function mStd(color, rough = 0.7, metal = 0, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...opts });
}
function mGlass(color = 0x6bbcd6, opacity = 0.45) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.05, metalness: 0.1, transparent: true, opacity });
}

const MAT = {
  grass:      () => mStd(0x4e8f3c, 0.95, 0),
  dirtBrown:  () => mStd(0x8c6640, 0.95, 0),
  sand:       () => mStd(0xd4a96a, 0.9, 0),
  asphalt:    () => mStd(0x1e2422, 0.9, 0.1),
  concrete:   () => mStd(0xb8b0a0, 0.8, 0.05),
  cream:      () => mStd(0xf0e8d8, 0.75, 0.02),
  white:      () => mStd(0xfafaf8, 0.65, 0.05),
  timber:     () => mStd(0xb88c4a, 0.7, 0.02),
  darkTimber: () => mStd(0x5c3d1e, 0.8, 0.02),
  laterite:   () => mStd(0xc84820, 0.85, 0.02),
  terracotta: () => mStd(0xb54f2a, 0.8, 0.0),
  water:      () => mStd(0x3a8fa8, 0.15, 0.4),
  darkGlass:  () => mGlass(0x2a5a6e, 0.55),
  lightGlass: () => mGlass(0x80c4d8, 0.35),
  gold:       () => mStd(0xc9a84c, 0.5, 0.3),
  fieldGreen: () => mStd(0x5a9448, 0.92, 0),
  lineWhite:  () => mStd(0xf8f5e0, 0.6, 0),
  stone:      () => mStd(0x8a7a6a, 0.9, 0.0),
  redBrick:   () => mStd(0xc23618, 0.85, 0),
  roofTile:   () => mStd(0xa04028, 0.8, 0),
};

// ─── GEOMETRY HELPERS ────────────────────────────────────────────────────────

function box(w, h, d, mat, pos = [0, 0, 0], ry = 0, cast = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(...pos);
  m.rotation.y = ry;
  m.castShadow = cast && h > 0.2;
  m.receiveShadow = true;
  return m;
}

function cyl(rt, rb, h, seg, mat, pos = [0, 0, 0]) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(...pos);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function addToScene(...objects) {
  objects.forEach(o => scene.add(o));
}

function group(...children) {
  const g = new THREE.Group();
  children.forEach(c => g.add(c));
  return g;
}

// ─── GROUND & FIELD ──────────────────────────────────────────────────────────

function addGround() {
  // Outer ground plane — green estate lawn
  const g = box(600, 0.2, 520, mStd(0x3a6e2c, 0.98, 0), [0, -0.1, 40], 0, false);
  g.receiveShadow = true;
  scene.add(g);
}

function addPoloField() {
  // Main polo field — East–West, 274m × 146m centred at origin
  const FIELD_W = 274, FIELD_D = 146;

  // Striped mowed grass (canvas texture)
  const stripeCanvas = document.createElement("canvas");
  stripeCanvas.width = 512; stripeCanvas.height = 512;
  const sc = stripeCanvas.getContext("2d");
  for (let i = 0; i < 16; i++) {
    sc.fillStyle = i % 2 === 0 ? "#5a9448" : "#4e8038";
    sc.fillRect(0, i * 32, 512, 32);
  }
  const stripeTexture = new THREE.CanvasTexture(stripeCanvas);
  stripeTexture.wrapS = stripeTexture.wrapT = THREE.RepeatWrapping;
  stripeTexture.repeat.set(14, 7);

  const fieldMat = new THREE.MeshStandardMaterial({ map: stripeTexture, roughness: 0.9 });
  const field = new THREE.Mesh(new THREE.BoxGeometry(FIELD_W, 0.18, FIELD_D), fieldMat);
  field.receiveShadow = true;
  field.position.y = 0.09;
  scene.add(field);

  // Centre line (N–S)
  scene.add(box(0.6, 0.22, FIELD_D, mStd(0xf8f5e0, 0.5), [0, 0.2, 0], 0, false));
  // Half-way marker
  scene.add(box(FIELD_W, 0.22, 0.6, mStd(0xf8f5e0, 0.5), [0, 0.2, 0], 0, false));
}

function addSafetyZone() {
  const sm = mStd(0x9a7040, 0.95, 0);
  // North safety
  scene.add(box(296, 0.15, 24, sm, [0, 0.07, -85], 0, false));
  // South safety
  scene.add(box(296, 0.15, 24, sm, [0, 0.07, 85], 0, false));
  // West safety
  scene.add(box(22, 0.15, 146, sm, [-148, 0.07, 0], 0, false));
  // East safety
  scene.add(box(22, 0.15, 146, sm, [148, 0.07, 0], 0, false));
}

function addYardMarkings() {
  // Mirrored at both east (goal) and west (goal) ends
  const lm = mStd(0xf5f0d5, 0.45, 0);
  const depths = [30, 40, 60]; // yards from goal line (approx 27, 36, 55m)
  const metreConv = [24.5, 36.5, 55];

  for (const side of [-1, 1]) {
    for (const d of metreConv) {
      // Vertical lines across the field width
      scene.add(box(0.5, 0.22, 146, lm, [side * (137 - d), 0.2, 0], 0, false));
    }
  }
  // Goal post guides (simplified)
  for (const side of [-1, 1]) {
    scene.add(box(0.5, 0.22, 0.5, mStd(0xf5f0d5), [side * 137, 0.22, 0], 0, false));
  }
}

// ─── LAKE ────────────────────────────────────────────────────────────────────

function addLake() {
  // Crescent lake along north edge of safety zone (~north of y=-97)
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x2a7fa8, roughness: 0.05, metalness: 0.4,
    transparent: true, opacity: 0.88,
  });

  // Main crescent body — elliptical approximated with scaled cylinder
  const lakeGeo = new THREE.CylinderGeometry(0, 0, 0.3, 4); // placeholder
  // Use boxes to approximate crescent shape
  const lakeParts = [
    box(200, 0.3, 28, waterMat, [0, 0.15, -115]),       // main body
    box(60,  0.3, 14, waterMat, [-100, 0.15, -108]),     // west curve
    box(60,  0.3, 14, waterMat, [100,  0.15, -108]),     // east curve
  ];
  lakeParts.forEach(p => { p.receiveShadow = true; scene.add(p); });

  // Ripple lines
  for (let i = 0; i < 6; i++) {
    const ripple = box(160 - i * 12, 0.04, 0.4,
      new THREE.MeshStandardMaterial({ color: 0x8ed4e8, roughness: 0.1, transparent: true, opacity: 0.3 - i * 0.03 }),
      [0, 0.35 + i * 0.02, -110 + i * 2], 0, false);
    scene.add(ripple);
  }
}

// ─── ROADS ───────────────────────────────────────────────────────────────────

function addLagosRoad() {
  const rm = mStd(0x1a1e1c, 0.88, 0.05);
  // Main road along south boundary
  scene.add(box(600, 0.25, 18, rm, [0, 0.12, 195], 0, false));
  // Lane markings
  for (let x = -260; x <= 260; x += 18) {
    scene.add(box(8, 0.26, 0.4, mStd(0xf8f2d0, 0.5), [x, 0.26, 195], 0, false));
  }
}

function addCrecentRoad() {
  const rm = mStd(0x1a1e1c, 0.88, 0.05);
  // Crescent road along north edge
  scene.add(box(500, 0.25, 10, rm, [0, 0.12, -160], 0, false));
  // North link road
  scene.add(box(10, 0.25, 60, rm, [0, 0.12, -185], 0, false));
}

function addInternalRoads() {
  const rm = mStd(0x222620, 0.9, 0.05);
  // West internal road (between villas and lofts)
  scene.add(box(10, 0.22, 300, rm, [-190, 0.11, 40], 0, false));
  // East internal road
  scene.add(box(10, 0.22, 260, rm, [200, 0.11, 20], 0, false));
  // South east-west connector
  scene.add(box(380, 0.22, 10, rm, [0, 0.11, 180], 0, false));
  // Clubhouse approach
  scene.add(box(60, 0.22, 30, rm, [0, 0.11, 175], 0, false));
  // Parking strips (south of clubhouse)
  scene.add(box(120, 0.22, 28, rm, [-80, 0.11, 180], 0, false));
  scene.add(box(120, 0.22, 28, rm, [80, 0.11, 180], 0, false));
}

// ─── CLUBHOUSE ───────────────────────────────────────────────────────────────

function addClubhouse() {
  const g = new THREE.Group();
  g.position.set(0, 0, 155);

  // Ground floor with deep piloti/shadow
  g.add(box(110, 4.5, 22, mStd(0xf5f0e5, 0.7, 0.02), [0, 2.25, 0]));
  // Bleacher seating steps (facing north toward field)
  for (let i = 0; i < 8; i++) {
    g.add(box(90, 0.4, 2, mStd(0xd8d0c0, 0.75, 0.02), [0, 0.6 + i * 0.5, -12 + i * 1.5], 0, false));
  }
  // Floor 1
  g.add(box(120, 4.5, 24, mStd(0xf8f4ec, 0.65, 0.02), [0, 7.2, 1]));
  // Floor 1 glazing (north-facing, looking at field)
  g.add(box(108, 3.6, 0.5, mStd(0x3a7a94, 0.1, 0.15, { transparent: true, opacity: 0.5 }), [0, 7.2, -12]));
  // Floor 2
  g.add(box(128, 4.2, 25, mStd(0xfaf8f0, 0.6, 0.02), [0, 11.8, 1.5]));
  // Floor 2 glazing
  g.add(box(116, 3.4, 0.5, mStd(0x4a8aaa, 0.08, 0.15, { transparent: true, opacity: 0.48 }), [0, 11.8, -11]));

  // Twin pavilion towers above roofline
  for (const side of [-42, 42]) {
    g.add(box(14, 6, 14, mStd(0xf5f0e5, 0.68, 0.02), [side, 17.5, 1]));
    g.add(box(15, 0.6, 15, mStd(0xfcfaf5, 0.6, 0.03), [side, 21, 1], 0, false));
  }
  // Main flat roof
  g.add(box(132, 0.8, 27, mStd(0xfcfaf5, 0.55, 0.03), [0, 14.6, 1.5], 0, false));

  // Structural columns across facade
  for (let x = -48; x <= 48; x += 12) {
    g.add(box(1, 4.8, 1, mStd(0xe8e0d0, 0.6, 0.05), [x, 2.6, -11.8]));
    g.add(box(1, 4.6, 1, mStd(0xe8e0d0, 0.6, 0.05), [x, 7.4, -11.8]));
  }

  // Terrace balustrades
  g.add(box(108, 0.9, 0.3, mStd(0xc89050, 0.6, 0.1), [0, 5.3, -11.5], 0, false));
  g.add(box(108, 0.9, 0.3, mStd(0xc89050, 0.6, 0.1), [0, 9.8, -11.5], 0, false));

  // 3 parasol umbrellas
  for (const x of [-30, 0, 30]) {
    addUmbrella(g, [x, 5.8, -8]);
  }

  scene.add(g);
}

function addUmbrella(parent, pos) {
  const g = new THREE.Group();
  g.position.set(...pos);
  g.add(cyl(0.1, 0.1, 2.8, 6, mStd(0xc0a060, 0.6), [0, 1.4, 0]));
  g.add(cyl(2.8, 3.2, 0.4, 16, mStd(0xf0e8d8, 0.7), [0, 3.0, 0]));
  parent.add(g);
}

// ─── VILLAS ──────────────────────────────────────────────────────────────────

function addVillaRing() {
  // 43 villas wrapping the polo field:
  // North arc ~12, South strip ~10, West column ~10, East column ~11
  const vPositions = [
    // North arc (z ~ -100 to -130, scattered along x)
    ...makeRow(-96, -105, 12, "X", 0),
    // South strip (z ~ 100, along x)
    ...makeRow(-90, 100, 10, "X", Math.PI),
    // West column (x ~ -165, along z)
    ...makeRow(-165, 0, 10, "Z", Math.PI / 2),
    // East column (x ~ 165, along z)
    ...makeRow(165, 0, 11, "Z", -Math.PI / 2),
  ];

  vPositions.forEach(([x, z, ry]) => {
    const v = createVilla();
    v.position.set(x, 0, z);
    v.rotation.y = ry;
    scene.add(v);
  });
}

function makeRow(startCoord, fixedCoord, count, axis, ry) {
  const spacing = 18;
  const offset = -((count - 1) * spacing) / 2;
  return Array.from({ length: count }, (_, i) => {
    const c = startCoord + offset + i * spacing;
    return axis === "X" ? [c, fixedCoord, ry] : [fixedCoord, c, ry];
  });
}

function createVilla() {
  const g = new THREE.Group();
  const wallMat = mStd(0xf0ece4, 0.72, 0.02);
  const timberMat = mStd(0xc09050, 0.65, 0.02);
  const glassMat = mGlass(0x7ab8c8, 0.5);
  const darkMat = mStd(0x2a2e2c, 0.6, 0.1);

  // Undercroft (ground level)
  g.add(box(16, 3.2, 13, mStd(0xb0a898, 0.8, 0.05), [0, 1.6, 0]));
  // Car park shadow recess
  g.add(box(11, 2.8, 0.4, darkMat, [0, 1.6, -6.7]));

  // Floor 1
  g.add(box(17, 3.4, 13.5, wallMat, [0, 4.9, 0]));
  // Timber louvre panel left
  g.add(box(4.5, 3.2, 0.5, timberMat, [-4.5, 4.9, -7.1]));
  // Glazing right
  g.add(box(9, 3.0, 0.4, glassMat, [2.5, 4.9, -7.3]));
  // Glass balustrade
  g.add(box(14, 0.8, 0.3, mGlass(0xb0d8e0, 0.35), [0, 3.5, -7]));

  // Floor 2
  g.add(box(18, 3.2, 14, wallMat, [0, 8.5, 0]));
  // Full-width timber louvres
  g.add(box(14, 2.8, 0.5, timberMat, [0, 8.5, -7.4]));
  // Upper glazing behind louvres
  g.add(box(12, 2.4, 0.3, glassMat, [0, 8.5, -7.0]));

  // Flat roof with LED-strip edge trim (white glow approximated)
  g.add(box(20, 0.6, 15.5, mStd(0xfafaf8, 0.5, 0.05), [0, 10.6, 0], 0, false));
  // White roof edge trim
  g.add(box(20.4, 0.2, 0.3, mStd(0xffffff, 0.3, 0.2), [0, 10.7, -7.8], 0, false));

  return g;
}

// ─── LOFT APARTMENTS ─────────────────────────────────────────────────────────

function addLoftApartments() {
  // Two rows south-west precinct
  for (const pos of [[-90, 210], [-40, 215], [-90, 232], [-40, 237]]) {
    scene.add(createLoftBlock(pos[0], pos[1], 5));
  }
}

function createLoftBlock(x, z, units = 5) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const blockW = units * 7.5;

  // Ground floor — gabion stone
  const stoneCanvas = document.createElement("canvas");
  stoneCanvas.width = 256; stoneCanvas.height = 128;
  const stx = stoneCanvas.getContext("2d");
  stx.fillStyle = "#8a7a6a";
  stx.fillRect(0, 0, 256, 128);
  // Stone texture lines
  for (let y = 0; y < 128; y += 14) {
    for (let xs = 0; xs < 256; xs += 28) {
      stx.strokeStyle = "#6a5a4a";
      stx.lineWidth = 1.5;
      stx.strokeRect(xs + (y % 28 < 14 ? 0 : 14), y, 28, 14);
    }
  }
  const stoneTex = new THREE.CanvasTexture(stoneCanvas);
  const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.95 });
  g.add(box(blockW, 3.2, 11, stoneMat, [0, 1.6, 0]));

  // Ground floor large windows (amber warm)
  for (let i = 0; i < units; i++) {
    const wx = -blockW / 2 + 3.75 + i * 7.5;
    g.add(box(5.5, 2.6, 0.4, mStd(0xd4900a, 0.3, 0.1, { transparent: true, opacity: 0.6 }), [wx, 1.6, -5.7]));
  }

  // First floor — white render + timber louvres
  g.add(box(blockW, 3.4, 12, mStd(0xf0ece6, 0.7, 0.02), [0, 5.0, 0]));
  for (let i = 0; i < units; i++) {
    const wx = -blockW / 2 + 3.75 + i * 7.5;
    // Timber louvre strip
    g.add(box(1.2, 3.0, 0.5, mStd(0xb88040, 0.65, 0.02), [wx - 2, 5.0, -6.2]));
    // Glazed bay
    g.add(box(4.5, 2.8, 0.4, mGlass(0x90c0d0, 0.4), [wx + 0.8, 5.0, -6.4]));
  }

  // Flat roof with slight overhang
  g.add(box(blockW + 2, 0.7, 13.5, mStd(0xf5f2ec, 0.6, 0.02), [0, 7.05, 0], 0, false));

  // Timber fence between front yards
  for (let i = 0; i <= units; i++) {
    const fx = -blockW / 2 + i * 7.5;
    g.add(box(0.15, 1.8, 3, mStd(0x8c5c28, 0.75, 0.02), [fx, 0.9, -8.5]));
  }

  return g;
}

// ─── BLOCK OF FLATS (7-storey apartment block) ───────────────────────────────

function addBlocksOfFlats() {
  // Two blocks south zone
  for (const xPos of [-50, 50]) {
    scene.add(createApartmentBlock(xPos, 248));
  }
}

function createApartmentBlock(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);

  const BW = 34, BD = 16, floors = 7;
  const floorH = 3.4;
  const wallMat = mStd(0xf5f2ec, 0.65, 0.02);

  // Piloti ground floor
  for (let col = -14; col <= 14; col += 7) {
    g.add(box(0.8, 3.6, 0.8, mStd(0xd0c8b8, 0.75, 0.05), [col, 1.8, 0]));
  }

  // Typical floors
  for (let f = 1; f <= floors; f++) {
    const y = 3.6 + (f - 1) * floorH + floorH / 2;
    g.add(box(BW, floorH - 0.2, BD, wallMat, [0, y, 0]));
    // Dark louvre fins on sides
    g.add(box(1.5, floorH - 0.4, BD + 2, mStd(0x303632, 0.7, 0.05), [-BW / 2 - 0.8, y, 0]));
    g.add(box(1.5, floorH - 0.4, BD + 2, mStd(0x303632, 0.7, 0.05), [BW / 2 + 0.8, y, 0]));
    // Timber slat centre panel
    g.add(box(8, floorH - 0.6, 0.5, mStd(0xb88040, 0.65, 0.02), [0, y, -BD / 2]));
    // Glass balconies
    g.add(box(BW - 4, 0.8, 0.4, mGlass(0x80b8c8, 0.4), [0, y - floorH / 2 + 0.4, -BD / 2 - 0.3]));
  }

  // Signature wave roof canopy
  const roofY = 3.6 + floors * floorH + 2.5;
  // Wing shape — two angled slabs
  for (const side of [-1, 1]) {
    const wingMesh = box(BW / 2 + 2, 0.8, 8, mStd(0xfcfaf6, 0.5, 0.05), [side * (BW / 4), roofY, 0]);
    wingMesh.rotation.z = side * 0.12;
    g.add(wingMesh);
  }

  scene.add(g);
  return g;
}

// ─── NORTH LOFT ROW (along Crescent road) ────────────────────────────────────

function addNorthLoftRow() {
  // Long row of orange-roofed maisonette/loft blocks along north crescent
  for (let x = -200; x <= 200; x += 30) {
    if (Math.abs(x) < 50) continue; // gap for link road
    const g = new THREE.Group();
    g.position.set(x, 0, -168);
    // Simple maisonette block
    g.add(box(22, 5.5, 10, mStd(0xf0e8e0, 0.75, 0.02), [0, 2.75, 0]));
    g.add(box(24, 0.6, 11.5, mStd(0xd4640c, 0.7, 0.02), [0, 5.85, 0], 0, false)); // orange roof
    scene.add(g);
  }
}

// ─── TRAINING FIELD ──────────────────────────────────────────────────────────

function addTrainingField() {
  // North–south orientation, south-west of site
  // Centred ~(-185, 0, 195) in world coords
  const TW = 100, TD = 160; // width (E-W), depth (N-S)

  // Safety zone first
  scene.add(box(TW + 24, 0.15, TD + 28, mStd(0x8c6640, 0.95), [-185, 0.07, 195], 0, false));
  // Field
  scene.add(box(TW, 0.18, TD, mStd(0x5a9448, 0.9), [-185, 0.09, 195]));
  // Yard markings (across width, so perpendicular to the long N-S axis)
  for (const z of [195 - 50, 195, 195 + 50]) {
    scene.add(box(TW, 0.22, 0.5, mStd(0xf5f0d5, 0.45), [-185, 0.22, z], 0, false));
  }
}

// ─── STABLES ─────────────────────────────────────────────────────────────────

function addStables() {
  // 4 stable blocks in south-west equestrian compound
  const positions = [
    [-220, 235], [-220, 215], [-200, 225], [-200, 245],
  ];
  positions.forEach(([x, z]) => scene.add(createStableBlock(x, z)));

  // Cobblestone courtyard
  scene.add(box(60, 0.12, 40, mStd(0x8a7060, 0.95), [-213, 0.06, 228], 0, false));
}

function createStableBlock(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);

  // Laterite brick walls
  g.add(box(40, 4.2, 14, mStd(0xc84820, 0.85, 0.02), [0, 2.1, 0]));

  // Timber roof trusses (corrugated terracotta tile)
  g.add(box(44, 0.5, 18, mStd(0xa03818, 0.8, 0.02), [0, 4.7, 0], 0, false));
  // Ridge
  g.add(box(44, 0.5, 0.8, mStd(0x8a2c10, 0.8), [0, 5.2, 0], 0, false));

  // Open stall bays (14 stalls, timber louvre fronts)
  for (let i = -3; i <= 3; i++) {
    const bx = i * 5.5;
    // Stall division
    g.add(box(0.25, 3.8, 0.5, mStd(0x6a3810, 0.8), [bx - 2.75, 1.9, -7.2]));
    // Timber louvre front
    g.add(box(4.8, 3.4, 0.4, mStd(0x8c5828, 0.75), [bx, 1.9, -7.3]));
    // X-brace
    g.add(box(3.2, 0.3, 0.5, mStd(0x5c3818, 0.8), [bx, 1.5, -7.35], 0.7));
    g.add(box(3.2, 0.3, 0.5, mStd(0x5c3818, 0.8), [bx, 1.5, -7.35], -0.7));
  }

  // Exposed timber posts along open face
  for (let i = -3; i <= 3; i++) {
    g.add(box(0.3, 4.6, 0.3, mStd(0x7c4a20, 0.75), [i * 5.5, 2.3, -7.5]));
  }

  return g;
}

// ─── EAST PADDOCK & RECREATION ───────────────────────────────────────────────

function addPaddockEast() {
  // Main paddock (1,645 sqm ~40m×41m) east side
  scene.add(box(42, 0.15, 40, mStd(0x5a8840, 0.9), [210, 0.07, -60], 0, false));
  // Paddock fence
  for (let z = -80; z <= -40; z += 6) {
    scene.add(box(0.3, 1.6, 0.3, mStd(0x8c7050, 0.8), [190, 0.8, z]));
    scene.add(box(0.3, 1.6, 0.3, mStd(0x8c7050, 0.8), [230, 0.8, z]));
  }
  for (let x = 190; x <= 230; x += 6) {
    scene.add(box(0.3, 1.6, 0.3, mStd(0x8c7050, 0.8), [x, 0.8, -80]));
    scene.add(box(0.3, 1.6, 0.3, mStd(0x8c7050, 0.8), [x, 0.8, -40]));
  }
  // Green area north of paddock
  scene.add(box(50, 0.15, 50, mStd(0x4e8038, 0.9), [210, 0.07, -120], 0, false));
}

function addGamePark() {
  // Game park / play ground — east side
  scene.add(box(55, 0.15, 45, mStd(0x5a9040, 0.88), [210, 0.07, 30], 0, false));
  // Play structures (simplified geometric forms)
  const playColors = [0xe8602a, 0x2a88c8, 0xe8c82a, 0x4ac84a];
  for (let i = 0; i < 5; i++) {
    scene.add(box(4, 3 + i * 0.5, 4, mStd(playColors[i % 4], 0.6, 0.05), [195 + i * 8, 1.5 + i * 0.25, 28 + (i % 2) * 10]));
  }
}

// ─── COMMERCIAL BLOCK ─────────────────────────────────────────────────────────

function addCommercialBlock() {
  const g = new THREE.Group();
  g.position.set(215, 0, 140);

  g.add(box(42, 9, 28, mStd(0xd8d0c2, 0.65, 0.02), [0, 4.5, 0]));
  g.add(box(0.5, 7, 24, mGlass(0x3a6a80, 0.55), [-21.3, 4.5, 0]));
  g.add(box(44, 0.8, 30, mStd(0xf0ece8, 0.55, 0.03), [0, 9.3, 0], 0, false));
  // Ground floor arcade
  for (let z = -10; z <= 10; z += 5) {
    g.add(box(0.6, 3.5, 0.6, mStd(0xc0b8a8, 0.7), [-21, 1.75, z]));
  }

  scene.add(g);
}

// ─── SERVICE COMPOUND ─────────────────────────────────────────────────────────

function addServiceCompound() {
  // South-west corner: Services, Mechanical, FM building
  // Services Hub (red — most visible landmark)
  scene.add(box(18, 5, 14, mStd(0xcc2200, 0.7, 0.05), [-165, 2.5, 200]));
  scene.add(box(20, 0.5, 16, mStd(0xaa1800, 0.7), [-165, 5.3, 200], 0, false));

  // Mechanical & Electrical
  scene.add(box(32, 6, 18, mStd(0x9090a0, 0.8, 0.1), [-128, 3, 210]));

  // FM building
  scene.add(box(12, 4, 10, mStd(0xc0b8a8, 0.75), [-105, 2, 190]));

  // Trucks park (flat grey slab)
  scene.add(box(30, 0.25, 20, mStd(0x404040, 0.9), [-195, 0.12, 245], 0, false));

  // NW paddock/mini-paddock
  scene.add(box(25, 0.15, 20, mStd(0x5a8838, 0.9), [-225, 0.07, -155], 0, false));
}

// ─── TREES ───────────────────────────────────────────────────────────────────

function addTreeRing() {
  // Dense tree line along all four perimeter edges
  for (let x = -250; x <= 250; x += 14) {
    addRoyalPalmAt(x, -195, 0.9 + Math.random() * 0.3);
    addRoyalPalmAt(x, 200, 0.85 + Math.random() * 0.3);
  }
  for (let z = -185; z <= 195; z += 16) {
    addRoyalPalmAt(-252, z, 0.9 + Math.random() * 0.25);
    addRoyalPalmAt(252, z, 0.9 + Math.random() * 0.25);
  }
}

function addRoyalPalms() {
  // Scattered palms around estate — beside lake, clubhouse, stables
  const spots = [
    [-100, -90], [100, -90], [-120, 170], [120, 170],
    [0, -90], [-50, -95], [50, -95],
    [-220, 218], [-195, 255], [-175, 245],
    [210, -80], [215, 45], [200, 135],
  ];
  spots.forEach(([x, z]) => addRoyalPalmAt(x, z, 1.0 + Math.random() * 0.4));
}

function addRoyalPalmAt(x, z, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);

  // Curved trunk (3 stacked cylinders with slight lean)
  const lean = (Math.random() - 0.5) * 0.06;
  for (let i = 0; i < 5; i++) {
    const seg = cyl(0.25 - i * 0.03, 0.3 - i * 0.03, 3.5, 8, mStd(0x7a5c30, 0.85), [lean * i * 4, 1.75 + i * 3.5, 0]);
    seg.rotation.z = lean;
    g.add(seg);
  }

  // Drooping fronds (coconut palm style)
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const frond = box(7, 0.3, 0.8, mStd(0x3a7228, 0.8), [
      Math.cos(angle) * 3.5 + lean * 20,
      18.5,
      Math.sin(angle) * 3.5,
    ]);
    frond.rotation.y = angle;
    frond.rotation.z = 0.45 + Math.random() * 0.1;
    frond.castShadow = false;
    g.add(frond);
  }

  // Optional coconut cluster
  g.add(cyl(0.35, 0.4, 0.7, 8, mStd(0x8c7a30, 0.7), [lean * 20, 17.8, 0]));

  scene.add(g);
}

export function getRenderer() { return renderer; }
export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getClock() { return clock; }
