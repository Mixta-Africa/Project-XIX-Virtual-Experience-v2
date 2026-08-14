/**
 * Project XIX — Scene v4 (Surgical Layout Correction)
 *
 * CONFIRMED ORIENTATION (from plan-2d.png, North=top):
 *   North = -Z  (lake side, top of image)
 *   South = +Z  (Lagos Road, clubhouse, bottom of image)
 *   East  = +X  (paddock, commercial, right of image)
 *   West  = -X  (training field, stables, left of image)
 *   Origin = centre of polo field turf
 *
 * BUILDING PLACEMENT RULES (from layout correction brief):
 *   Polo ring inner edge:  X = ±75 (safety zone), Z = ±137 (goal ends)
 *   Villas start:          X = ±102 (just outside safety zone)
 *   Lake:                  Z ≈ -170 to -200 (north of ring, behind villa arc)
 *   Clubhouse:             Z ≈ +175, X ≈ 0   (south, centred, clear view axis)
 *   Training field:        X ≈ -200, Z ≈ 0   (west, perpendicular to main field)
 *   Stables:               X ≈ -230, Z ≈ +80 (far southwest)
 *   Blocks of flats:       X ≈ -185, Z ≈ ±50 (west compound, beside training)
 *   Loft terraces:         Z ≈ -225 to -250  (north crescent road)
 *   Paddock:               X ≈ +175, Z ≈ -60  (northeast)
 *   Game park:             X ≈ +175, Z ≈ +60  (east, south of paddock)
 *   Commercial block:      X ≈ +210, Z ≈ +120  (far southeast)
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import {
  MAT_GRASS_FIELD, MAT_DIRT, MAT_ASPHALT,
  MAT_BRICK, MAT_CONCRETE, MAT_TIMBER, MAT_STONE, MAT_TILE_ROOF,
  MAT_GLASS, MAT_GLASS_WARM, MAT_WHITE_TRIM, MAT_GOLD, MAT_DARK_METAL, MAT_WATER,
} from "./materials.js";

let scene, renderer, camera, clock;
let waterMeshes = [];
let grassCards  = [];
let palmSprites = [];

// ─── INIT ──────────────────────────────────────────────────────────────

export function initScene(canvas) {
  clock = new THREE.Clock();
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: true,
    powerPreference: "high-performance",
    logarithmicDepthBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled   = true;
  renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.outputColorSpace    = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ab8cc);
  scene.fog = new THREE.FogExp2(0x9ac5d4, 0.0016);

  camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1400);

  buildLighting();
  buildSky();
  buildEnvironment();

  return { scene, renderer, camera, clock };
}

// ─── LIGHTING ──────────────────────────────────────────────────────────

function buildLighting() {
  scene.add(new THREE.HemisphereLight(0xd4e8ff, 0x4a6a30, 1.6));

  const sun = new THREE.DirectionalLight(0xffe4a0, 3.8);
  sun.position.set(-180, 200, 120);
  sun.castShadow = true;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -380;
  sun.shadow.camera.right = sun.shadow.camera.top   =  380;
  sun.shadow.camera.far   = 900;
  sun.shadow.mapSize.set(8192, 8192);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3.5;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xb8d0e8, 0.7);
  fill.position.set(120, 80, -100);
  scene.add(fill);

  // Clubhouse interior warmth (south)
  for (const p of [[-40,8,175],[0,8,175],[40,8,175]]) {
    const pt = new THREE.PointLight(0xffe0a0, 2.5, 55, 2);
    pt.position.set(...p); scene.add(pt);
  }
  // Stable warm lights (southwest)
  for (const p of [[-230,3,-80],[-255,3,-80]]) {
    const pt = new THREE.PointLight(0xff8c40, 1.8, 40, 2);
    pt.position.set(...p); scene.add(pt);
  }
}

// ─── SKY ────────────────────────────────────────────────────────────────

function buildSky() {
  const skyC = document.createElement("canvas");
  skyC.width = 4; skyC.height = 256;
  const sc = skyC.getContext("2d");
  const g  = sc.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0,    "#1a3a5c");
  g.addColorStop(0.35, "#3a7aaa");
  g.addColorStop(0.65, "#7ab4d4");
  g.addColorStop(0.85, "#c8d8e8");
  g.addColorStop(1,    "#e0ece8");
  sc.fillStyle = g; sc.fillRect(0, 0, 4, 256);
  const st = new THREE.CanvasTexture(skyC);
  st.colorSpace = THREE.SRGBColorSpace;
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.MeshBasicMaterial({ map: st, side: THREE.BackSide })
  ));

  const sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(18, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe8b0 })
  );
  sunMesh.position.set(-320, 340, 200); scene.add(sunMesh);

  const cmat = new THREE.MeshBasicMaterial({ color: 0xfdfcfa, transparent: true, opacity: 0.72, side: THREE.DoubleSide });
  [[-180,260,-300],[60,280,-350],[220,250,-280],[-320,240,-180],[140,270,-400]].forEach(([x,y,z]) => {
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(30+Math.random()*28,8,5), cmat);
      m.scale.y = 0.3;
      m.position.set(x+(Math.random()-.5)*80, y+Math.random()*12, z+(Math.random()-.5)*50);
      scene.add(m);
    }
  });
}

// ─── GEOMETRY HELPERS ──────────────────────────────────────────────────

function box(w, h, d, mat, pos=[0,0,0], ry=0, shadow=true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
  m.position.set(...pos); m.rotation.y = ry;
  m.castShadow = shadow && h > 0.3; m.receiveShadow = true;
  return m;
}
function plane(w, d, mat, pos=[0,0,0]) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w,d), mat);
  m.rotation.x = -Math.PI/2; m.position.set(...pos);
  m.receiveShadow = true; return m;
}
function cyl(rt, rb, h, seg, mat, pos=[0,0,0]) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg), mat);
  m.position.set(...pos); m.castShadow = m.receiveShadow = true;
  return m;
}
function s(...o) { o.forEach(x => x && scene.add(x)); }

// ─── ENVIRONMENT ────────────────────────────────────────────────────────

function buildEnvironment() {
  addGround();
  addPoloField();        // East-West 274m field, centre at origin
  addSafetyZone();       // Brown dirt ring
  addYardMarkings();
  addLake();             // North (-Z), crescent behind villa arc
  addRoads();
  addClubhouse();        // South (+Z), centred, unobstructed
  addVillaRing();        // Wraps field — standalone plots, correct spacing
  addWestCompound();     // Training field + blocks of flats + loft apts
  addNorthCresCentLofts(); // Crescent road loft terraces — NORTH only
  addStables();          // Far southwest
  addPaddockEast();      // Northeast
  addGamePark();         // East, south of paddock
  addCommercialBlock();  // Far southeast
  addServiceCompound();  // Southwest service buildings
  addGrassCards();
  addRoyalPalms();
  addPerimeterTrees();
}

// ─── GROUND ─────────────────────────────────────────────────────────────

function addGround() {
  s(plane(800, 700, MAT_DIRT(), [0, 0, 30]));
  s(plane(500, 400, MAT_GRASS_FIELD(), [0, 0.01, 0]));
}

// ─── POLO FIELD (274m E-W × 146m N-S, centre = origin) ─────────────────

function addPoloField() {
  // Mowed stripe canvas
  const sc2 = document.createElement("canvas");
  sc2.width = 1024; sc2.height = 512;
  const ctx = sc2.getContext("2d");
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = i%2===0 ? "#5a9448" : "#4a8038";
    ctx.fillRect(0, i*(512/14), 1024, 512/14+1);
  }
  const st = new THREE.CanvasTexture(sc2);
  st.colorSpace = THREE.SRGBColorSpace; st.wrapS = st.wrapT = THREE.RepeatWrapping;
  const fm = MAT_GRASS_FIELD(); fm.map = st; fm.roughness = 0.92;
  const field = new THREE.Mesh(new THREE.BoxGeometry(274, 0.2, 146), fm);
  field.position.set(0,0.1,0); field.receiveShadow = true; scene.add(field);

  // Centre lines
  const lm = new THREE.MeshStandardMaterial({color:0xf8f5e0,roughness:0.4});
  s(box(0.5,0.22,146,lm,[0,0.21,0],0,false));
  s(box(274,0.22,0.5,lm,[0,0.21,0],0,false));

  // Goal posts (east and west ends)
  const postMat = new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.4,metalness:0.2});
  for (const side of [-1,1]) {
    for (const pz of [0,-14,14]) {
      s(cyl(0.12,0.12,5,8,postMat,[side*137, 2.5, pz]));
    }
  }
}

function addSafetyZone() {
  const dm = MAT_DIRT();
  // North strip (lake side, -Z)
  s(box(298,0.15,25,dm,[0,0.07,-85.5],0,false));
  // South strip (clubhouse side, +Z)
  s(box(298,0.15,25,dm,[0,0.07,85.5],0,false));
  // West strip (pony line, -X)
  s(box(22,0.15,146,dm,[-148,0.07,0],0,false));
  // East strip (+X)
  s(box(22,0.15,146,dm,[148,0.07,0],0,false));
}

function addYardMarkings() {
  const lm = new THREE.MeshStandardMaterial({color:0xf5f0d5,roughness:0.4});
  for (const side of [-1,1]) {
    for (const d of [24.5,36.5,55]) {
      s(box(0.45,0.22,146,lm,[side*(137-d),0.21,0],0,false));
    }
  }
}

// ─── LAKE (north of villa arc, z≈-185 to -215) ──────────────────────────

function addLake() {
  const wm = MAT_WATER();
  // Crescent: centre body + two curved wings
  const parts = [
    new THREE.Mesh(new THREE.BoxGeometry(190,0.35,30), wm),
    new THREE.Mesh(new THREE.CylinderGeometry(18,18,0.35,24,1,false,0,Math.PI), wm),
    new THREE.Mesh(new THREE.CylinderGeometry(18,18,0.35,24,1,false,0,Math.PI), wm),
  ];
  parts[0].position.set(0,0.17,-198);
  parts[1].position.set(-95,0.17,-198);
  parts[2].position.set(95,0.17,-198);
  parts.forEach(p => { p.receiveShadow=true; scene.add(p); waterMeshes.push(p); });

  // Shore banks
  const bm = MAT_DIRT();
  s(box(210,0.3,4,bm,[0,0.15,-182],0,false));
  s(box(210,0.3,4,bm,[0,0.15,-215],0,false));
}

// ─── ROADS ──────────────────────────────────────────────────────────────

function addRoads() {
  const am = MAT_ASPHALT();
  const lm = new THREE.MeshStandardMaterial({color:0xf5f0d0,roughness:0.5});

  function road(w,d,x,z) {
    const m=plane(w,d,am,[x,0.13,z]); scene.add(m);
  }

  road(600,18,0,210);   // Lagos Road (south boundary, +Z)
  road(500,10,0,-240);  // Crescent road (north, -Z)
  road(10,60,0,-260);   // North link road
  road(380,10,0,190);   // Internal south E-W connector
  road(10,300,-200,0);  // West internal N-S road
  road(10,280,210,0);   // East internal N-S road

  // Lagos Road lane dashes
  for (let x=-270;x<=270;x+=18) s(box(8,0.15,0.38,lm,[x,0.26,210],0,false));

  // Clubhouse access road
  road(20,50,0,172);
}

// ─── CLUBHOUSE (south, centred, z≈+155 to +185, UNOBSTRUCTED) ───────────

function addClubhouse() {
  const g = new THREE.Group(); g.position.set(0,0,170);
  const cm=MAT_CONCRETE(), gm=MAT_GLASS(0.48), gw=MAT_GLASS_WARM(0.55);
  const tm=MAT_TIMBER(), wm=MAT_WHITE_TRIM(), dm=MAT_DARK_METAL(), gld=MAT_GOLD();

  // Ground floor bleachers (face NORTH toward field)
  g.add(box(115,4.8,24,cm,[0,2.4,0]));
  for (let i=0;i<8;i++) g.add(box(92,0.45,2.2,
    new THREE.MeshStandardMaterial({color:0xd0c8b8,roughness:0.7}),
    [0,0.55+i*0.52,-11.5+i*1.55],0,false));
  for (let x=-48;x<=48;x+=12) g.add(box(1.1,5.2,1.1,cm,[x,2.7,-12.2]));

  // Floor 1
  g.add(box(122,4.6,25,cm,[0,7.3,0.5]));
  g.add(box(110,3.4,0.45,gw,[0,7.3,-12.4]));
  g.add(box(110,0.95,0.3,gld,[0,5.3,-12.5],0,false));
  for (const ux of [-35,0,35]) addUmbrella(g,[ux,5.9,-9]);

  // Floor 2
  g.add(box(130,4.4,26,cm,[0,12.1,1.0]));
  g.add(box(118,3.4,0.45,gm,[0,12.1,-12.6]));

  // Slab overhangs
  g.add(box(134,0.65,28,wm,[0,4.85,1.0],0,false));
  g.add(box(136,0.65,29,wm,[0,9.65,1.0],0,false));
  g.add(box(138,0.65,29,wm,[0,14.55,1.0],0,false));

  for (let x=-54;x<=54;x+=12) {
    g.add(box(0.7,4.5,0.7,wm,[x,7.3,-12.4]));
    g.add(box(0.7,4.3,0.7,wm,[x,12.1,-12.5]));
  }

  // Twin pavilion towers
  for (const side of [-46,46]) {
    g.add(box(16,6.5,16,cm,[side,18.0,0.5]));
    g.add(box(17.5,0.7,17.5,wm,[side,21.5,0.5],0,false));
  }
  g.add(box(14,5.2,1.0,tm,[0,2.6,-12.8]));

  // Parking on both sides (south of clubhouse)
  const pm = MAT_ASPHALT();
  s(plane(55,28,pm,[-62,0.13,200]));  // west parking
  s(plane(55,28,pm,[ 62,0.13,200]));  // east parking

  scene.add(g);
}

function addUmbrella(parent,pos) {
  const g=new THREE.Group(); g.position.set(...pos);
  g.add(cyl(0.08,0.08,3.0,6,MAT_GOLD(),[0,1.5,0]));
  g.add(cyl(3.2,3.6,0.45,16,new THREE.MeshStandardMaterial({color:0xf0e8d8,roughness:0.7}),[0,3.2,0]));
  parent.add(g);
}

// ─── VILLA RING (wraps polo field, standalone plots) ────────────────────
//
// Orientation reference:
//   North (−Z) villas face SOUTH = yaw 0
//   South (+Z) villas face NORTH = yaw Math.PI  -- NO: face north = yaw 0 when group.rotation.y=0
//
// createVilla() builds with its FRONT facing −Z (toward origin when at +Z position)
// So:
//   South arc villas: yaw = 0        (front faces -Z, i.e. north toward field) ✓
//   North arc villas: yaw = Math.PI  (front faces +Z, i.e. south toward field) ✓
//   West villas:      yaw = Math.PI/2  (front faces +X, i.e. east toward field) ✓
//   East villas:      yaw = -Math.PI/2 (front faces -X, i.e. west toward field) ✓

function addVillaRing() {
  const PLOT = 26; // centre-to-centre (standalone with generous gaps)
  const EYE  = -12; // front setback offset in villa's local space

  // ── SOUTH ARC (z≈+120–145, facing north yaw=0) ─────────────────────
  // 6 villas: 3 SW, 3 SE. Centre gap kept clear for clubhouse axis (±30m)
  for (let side=-1;side<=1;side+=2) {
    for (let i=0;i<5;i++) {
      const x = side*(30+i*PLOT);
      const z = 125+Math.abs(x)*0.04;
      const v = createVilla();
      v.position.set(x,0,z);
      v.rotation.y = 0; // face north toward field
      scene.add(v);
      addVillaLandscaping(x,z,0);
    }
  }

  // ── NORTH ARC (z≈-130–155, behind lake at -185) ─────────────────────
  // 7 villas: 3-4 each side of centreline. Front-facing south (yaw=Math.PI).
  // Crescent curve: centre villas closest to field, corners curve back.
  const northVillas = [
    [-72,-135], [-48,-142], [-24,-147], [0,-149],
    [24,-147], [48,-142], [72,-135]
  ];
  northVillas.forEach(([x,z]) => {
    const v = createVilla();
    v.position.set(x,0,z);
    v.rotation.y = Math.PI; // face south toward field — ALL FRONT-FACING
    scene.add(v);
    addVillaLandscaping(x,z,Math.PI);
  });

  // ── WEST INNER COLUMN (x≈-105, facing east yaw=Math.PI/2) ─────────
  for (let i=0;i<6;i++) {
    const z = -75+i*PLOT;
    const v = createVilla();
    v.position.set(-110,0,z); v.rotation.y = Math.PI/2;
    scene.add(v); addVillaLandscaping(-110,z,Math.PI/2);
  }

  // ── WEST OUTER COLUMN (x≈-140, staggered PLOT/2) ───────────────────
  for (let i=0;i<5;i++) {
    const z = -75+PLOT/2+i*PLOT;
    const v = createVilla();
    v.position.set(-140,0,z); v.rotation.y = Math.PI/2;
    scene.add(v); addVillaLandscaping(-140,z,Math.PI/2);
  }

  // ── EAST INNER COLUMN (x≈+105, facing west yaw=-Math.PI/2) ────────
  for (let i=0;i<6;i++) {
    const z = -75+i*PLOT;
    const v = createVilla();
    v.position.set(110,0,z); v.rotation.y = -Math.PI/2;
    scene.add(v); addVillaLandscaping(110,z,-Math.PI/2);
  }

  // ── EAST OUTER COLUMN (x≈+140, staggered) ─────────────────────────
  for (let i=0;i<5;i++) {
    const z = -75+PLOT/2+i*PLOT;
    const v = createVilla();
    v.position.set(140,0,z); v.rotation.y = -Math.PI/2;
    scene.add(v); addVillaLandscaping(140,z,-Math.PI/2);
  }
}

// Per-villa landscaping: boundary hedges + gate posts + driveway
function addVillaLandscaping(vx,vz,ry) {
  const hedgeMat = new THREE.MeshStandardMaterial({color:0x2a5a20,roughness:0.95});
  const gateMat  = new THREE.MeshStandardMaterial({color:0x8a7050,roughness:0.7,metalness:0.2});
  const pathMat  = new THREE.MeshStandardMaterial({color:0xd0c8b4,roughness:0.8});

  const g = new THREE.Group(); g.position.set(vx,0,vz); g.rotation.y=ry;
  // Side hedges
  const hl=new THREE.Mesh(new THREE.BoxGeometry(0.5,1.3,20),hedgeMat); hl.position.set(-11,0.65,0); g.add(hl);
  const hr=hl.clone(); hr.position.set(11,0.65,0); g.add(hr);
  // Front hedge strip
  const hf=new THREE.Mesh(new THREE.BoxGeometry(20,0.75,0.5),hedgeMat); hf.position.set(0,0.375,-10.5); g.add(hf);
  // Gate posts
  for (const gx of [-3,3]) {
    const gp=new THREE.Mesh(new THREE.BoxGeometry(0.4,1.7,0.4),gateMat); gp.position.set(gx,0.85,-10.8); g.add(gp);
  }
  // Driveway slab
  const dp=new THREE.Mesh(new THREE.PlaneGeometry(5.5,5),pathMat); dp.rotation.x=-Math.PI/2; dp.position.set(0,0.05,-8); g.add(dp);
  scene.add(g);
}

function createVilla() {
  const g = new THREE.Group();
  const cm=MAT_CONCRETE(), tm=MAT_TIMBER();
  const gm=MAT_GLASS(0.52), gw=MAT_GLASS_WARM(0.6);
  const wm=MAT_WHITE_TRIM(), dm=MAT_DARK_METAL();
  const charcoal=new THREE.MeshStandardMaterial({color:0x404040,roughness:0.8});
  const ledMat=new THREE.MeshStandardMaterial({color:0xffffff,emissive:new THREE.Color(0xffffff),emissiveIntensity:0.8,roughness:0.2});

  // Undercroft
  g.add(box(16.5,3.4,13.5,cm,[0,1.7,0]));
  g.add(box(11.5,3.0,0.3,dm,[0.5,1.7,-7.1]));
  for (const cx of [-6.5,6.5]) g.add(cyl(0.22,0.22,3.4,10,dm,[cx,1.7,-6.5]));
  // Floor 1 slab
  g.add(box(19,0.55,15.5,wm,[0,3.48,0],0,false));
  // Floor 1
  g.add(box(17.5,3.5,14,cm,[0,5.05,0]));
  g.add(box(5.5,3.3,0.5,charcoal,[-5,5.05,-7.3]));
  g.add(box(5.0,3.1,0.55,tm,[0.5,5.05,-7.4]));
  g.add(box(4.5,3.1,0.4,gw,[4.5,5.05,-7.35]));
  g.add(box(15,0.85,0.3,MAT_GLASS(0.38),[0,3.55,-7.25],0,false));
  // Floor 2 slab
  g.add(box(19.5,0.55,15.5,wm,[0,7.15,0],0,false));
  // Floor 2
  g.add(box(18.5,3.3,14.5,cm,[0,8.7,0]));
  g.add(box(15,3.1,0.55,tm,[0,8.7,-7.6]));
  g.add(box(13,2.8,0.35,gw,[0,8.7,-7.2]));
  g.add(box(16,0.8,0.3,MAT_GLASS(0.35),[0,7.2,-7.5],0,false));
  // Roof + LED trim
  g.add(box(20,0.65,16,wm,[0,10.85,0],0,false));
  g.add(box(20.4,0.18,0.2,ledMat,[0,10.96,-8.05],0,false));
  return g;
}

// ─── WEST COMPOUND (training field + flats + loft apts) ────────────────
//
// Training field: x≈-195, z≈0 (north-south orientation, perpendicular to main)
// Blocks of flats: x≈-175, z≈±65 (north and south of training field)
// Loft apartment blocks (west): x≈-155, z≈±35

function addWestCompound() {
  const gm=MAT_GRASS_FIELD(), dm=MAT_DIRT();
  const lm=new THREE.MeshStandardMaterial({color:0xf0ecd0,roughness:0.5});

  // ── Training field (N-S oriented: 100m wide, 160m deep) ────────────
  s(plane(124,188,dm,[-195,0.06,0]));  // safety zone
  s(plane(100,160,gm,[-195,0.1,0]));   // turf
  // Yard markings across the width (E-W lines on N-S field)
  for (const z of [-55,0,55]) s(box(100,0.22,0.5,lm,[-195,0.22,z],0,false));
  // Goal posts
  const pm2=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.4});
  for (const side of [-1,1]) for (const px of [0,-12,12]) s(cyl(0.12,0.12,5,8,pm2,[px-195,2.5,side*80]));

  // ── Blocks of flats A & B (north and south of training field) ──────
  s(createFlatBlock(-175, -70, 50, 18, 4));  // north flat block
  s(createFlatBlock(-175,  70, 50, 18, 4));  // south flat block

  // ── Loft apartment blocks (west, beside flats) ─────────────────────
  s(createLoftBlock(-152, -38, 4));
  s(createLoftBlock(-152,  38, 4));
}

function createFlatBlock(x,z,bw,bd,floors) {
  const BW=bw, BD=bd, fH=3.45;
  const cm=MAT_CONCRETE(), tm=MAT_TIMBER(), dm=MAT_DARK_METAL();
  const gw=MAT_GLASS_WARM(0.52), wm=MAT_WHITE_TRIM();
  const g=new THREE.Group(); g.position.set(x,0,z);

  for (let col=-bw/2+5;col<=bw/2-5;col+=7.5) g.add(box(0.9,3.8,0.9,cm,[col,1.9,0]));
  for (let f=1;f<=floors;f++) {
    const y=3.8+(f-1)*fH+fH/2;
    g.add(box(BW,fH-0.25,BD,cm,[0,y,0]));
    g.add(box(1.6,fH-0.3,BD+2.5,dm,[-BW/2-0.9,y,0]));
    g.add(box(1.6,fH-0.3,BD+2.5,dm,[BW/2+0.9,y,0]));
    g.add(box(7,fH-0.5,0.55,tm,[0,y,-BD/2-0.1]));
    g.add(box(BW-6,0.85,0.4,MAT_GLASS(0.5),[0,y-fH/2+0.4,-BD/2-0.35],0,false));
    g.add(box(BW+2,0.4,BD+2,wm,[0,y-fH/2,0],0,false));
  }
  // Wave roof canopy
  const roofY=3.8+floors*fH+3.2;
  for (const side of [-1,1]) { const wing=box(BW/2+4,0.9,10,wm,[side*(BW/4),roofY,0]); wing.rotation.z=side*0.14; g.add(wing); }
  g.add(box(8,0.7,10,wm,[0,roofY-1.4,0],0,false));
  return g;
}

function createLoftBlock(x,z,units=5) {
  const g=new THREE.Group(); g.position.set(x,0,z);
  const W=units*7.6;
  const sm=MAT_STONE(), cm=MAT_CONCRETE(), tm=MAT_TIMBER();
  const gw=MAT_GLASS_WARM(0.62), wm=MAT_WHITE_TRIM(), dm=MAT_DARK_METAL();

  g.add(box(W,3.4,11.5,sm,[0,1.7,0]));
  for (let i=0;i<units;i++) { const wx=-W/2+3.8+i*7.6; g.add(box(5.6,2.7,0.4,gw,[wx,1.7,-6.0])); }
  for (let i=0;i<=units;i++) {
    const fx=-W/2+i*7.6; g.add(box(0.18,1.9,3.5,tm,[fx,0.95,-8.0]));
    if(i<units) { g.add(box(7.4,0.12,0.12,tm,[fx+3.8,1.6,-8.0],0,false)); g.add(box(7.4,0.12,0.12,tm,[fx+3.8,1.0,-8.0],0,false)); }
  }
  g.add(box(W+2.5,0.6,13,wm,[0,3.38,0],0,false));
  g.add(box(W,3.5,12,cm,[0,5.25,0]));
  for (let i=0;i<units;i++) {
    const wx=-W/2+3.8+i*7.6;
    g.add(box(1.3,3.3,0.6,tm,[wx-2.5,5.25,-6.2]));
    g.add(box(4.8,2.9,0.4,gw,[wx+0.8,5.25,-6.45]));
    g.add(box(0.25,3.0,0.5,dm,[wx+3.2,5.25,-6.3]));
  }
  g.add(box(W+3,0.75,14,wm,[0,7.3,0],0,false));
  return g;
}

// ─── NORTH CRESCENT LOFT TERRACES (z≈-225 to -250) ─────────────────────
// NORTH of the lake, along crescent road.
// Two arms: NW arm and NE arm, south-facing (yaw=Math.PI = face south toward field).

function addNorthCresCentLofts() {
  const cm=MAT_CONCRETE(), tm=MAT_TILE_ROOF();

  // NW arm — 9 units spreading northwest from centre
  const nwArm=[[-35,-226],[-58,-230],[-80,-235],[-102,-238],[-122,-241],[-140,-242],[-157,-241],[-170,-238],[-180,-233]];
  nwArm.forEach(([x,z]) => { scene.add(createCresCentLoft(x,z, Math.PI+0.08)); });

  // NE arm — 9 units mirrored
  const neArm=[[ 35,-226],[ 58,-230],[ 80,-235],[ 102,-238],[ 122,-241],[ 140,-242],[ 157,-241],[ 170,-238],[ 180,-233]];
  neArm.forEach(([x,z]) => { scene.add(createCresCentLoft(x,z, Math.PI-0.08)); });
}

function createCresCentLoft(x,z,ry) {
  const g=new THREE.Group(); g.position.set(x,0,z); g.rotation.y=ry;
  const cm=MAT_CONCRETE();
  const tileMat=MAT_TILE_ROOF();
  g.add(box(22,5.8,10.5,cm,[0,2.9,0]));
  g.add(box(24,0.65,12,tileMat,[0,6.05,0],0,false));
  g.add(box(16,4.0,0.4,MAT_GLASS(0.45),[0,2.9,5.6]));
  return g;
}

// ─── STABLES (far southwest, x≈-225 to -265, z≈+70 to +100) ────────────

function addStables() {
  // Cobblestone courtyard
  s(plane(62,44,MAT_STONE(),[-245,0.08,80]));

  // Four stable blocks
  [[-230,68],[-230,86],[-258,68],[-258,86]].forEach(([x,z]) => scene.add(createStableBlock(x,z)));
}

function createStableBlock(x,z) {
  const g=new THREE.Group(); g.position.set(x,0,z);
  const bm=MAT_BRICK(), tm=MAT_TILE_ROOF(), timMat=MAT_TIMBER(), dm=MAT_DARK_METAL();
  const xMat=new THREE.MeshStandardMaterial({color:0x5c3818,roughness:0.8});

  g.add(box(38,4.4,14,bm,[0,2.2,0]));
  const roofL=box(40,0.5,18,tm,[0,4.85,0]); roofL.rotation.z=0.18; g.add(roofL);
  const roofR=box(40,0.5,18,tm,[0,4.85,0]); roofR.rotation.z=-0.18; g.add(roofR);
  g.add(box(40,0.3,0.3,timMat,[0,6.3,0]));
  for (let tx=-15;tx<=15;tx+=9) {
    g.add(box(0.25,5,0.25,timMat,[tx,4.5,-7]));
    g.add(box(0.25,5,0.25,timMat,[tx,4.5,7]));
    g.add(box(0.2,0.2,14,timMat,[tx,6.0,0]));
  }
  for (let i=0;i<6;i++) {
    const sx=-13+i*5.2;
    g.add(box(4.8,3.8,0.4,timMat,[sx,2.2,-7.2]));
    g.add(box(3.2,0.28,0.5,xMat,[sx,1.8,-7.25],0.72));
    g.add(box(3.2,0.28,0.5,xMat,[sx,1.8,-7.25],-0.72));
    g.add(box(0.2,4.0,0.5,dm,[sx-2.6,2.2,-7.2]));
  }
  for (let px=-18;px<=18;px+=6) g.add(cyl(0.18,0.18,4.8,8,dm,[px,2.4,-7.5]));
  return g;
}

// ─── PADDOCK (northeast, x≈+175, z≈-60) ───────────────────────────────

function addPaddockEast() {
  const gm=MAT_GRASS_FIELD();
  s(plane(42,40,gm,[175,0.07,-60]));

  const fpm=new THREE.MeshStandardMaterial({color:0x8c7050,roughness:0.8});
  const frm=new THREE.MeshStandardMaterial({color:0xfcfaf5,roughness:0.65});
  for (let fz=-80;fz<=-40;fz+=5) { s(box(0.28,1.7,0.28,fpm,[155,0.85,fz])); s(box(0.28,1.7,0.28,fpm,[195,0.85,fz])); }
  for (let fx=155;fx<=195;fx+=5) { s(box(0.28,1.7,0.28,fpm,[fx,0.85,-80])); s(box(0.28,1.7,0.28,fpm,[fx,0.85,-40])); }
  s(box(0.1,0.1,40,frm,[155,1.5,-60],0,false)); s(box(0.1,0.1,40,frm,[195,1.5,-60],0,false));
  s(box(40,0.1,0.1,frm,[175,1.5,-80],0,false)); s(box(40,0.1,0.1,frm,[175,1.5,-40],0,false));

  // Green area north of paddock
  s(plane(52,52,gm,[175,0.07,-130]));
}

// ─── GAME PARK (east, south of paddock, x≈+175, z≈+60) ──────────────

function addGamePark() {
  const gm=MAT_GRASS_FIELD();
  s(plane(56,46,gm,[175,0.07,60]));
  const colors=[0xe8602a,0x2a88c8,0xe8c82a,0x4ac84a];
  for (let i=0;i<5;i++) {
    const h=2.8+i*0.4;
    s(box(3.5,h,3.5,new THREE.MeshStandardMaterial({color:colors[i%4],roughness:0.6}),[158+i*8,h/2,58+(i%2)*9]));
  }
}

// ─── COMMERCIAL BLOCK (far southeast) ──────────────────────────────────

function addCommercialBlock() {
  const g=new THREE.Group(); g.position.set(210,0,140);
  const cm=MAT_CONCRETE(), gm=MAT_GLASS(0.5), wm=MAT_WHITE_TRIM();
  g.add(box(44,9.5,28,cm,[0,4.75,0]));
  g.add(box(44,0.6,30,wm,[0,9.85,0],0,false));
  g.add(box(0.45,9.0,24,gm,[-22.3,4.75,0]));
  for (let cz=-10;cz<=10;cz+=5) g.add(box(0.65,3.8,0.65,cm,[-22.0,1.9,cz]));
  scene.add(g);
}

// ─── SERVICE COMPOUND (southwest) ──────────────────────────────────────

function addServiceCompound() {
  const cm=MAT_CONCRETE();
  const svc=new THREE.MeshStandardMaterial({color:0xcc2200,roughness:0.7});
  // Services hub (red landmark)
  s(box(18,5.2,14,svc,[-175,2.6,120]));
  s(box(20,0.55,16,new THREE.MeshStandardMaterial({color:0xaa1800,roughness:0.7}),[-175,5.4,120],0,false));
  // Mechanical & Electrical
  s(box(33,6.5,19,cm,[-145,3.25,130]));
  // FM building
  s(box(13,4.2,11,cm,[-120,2.1,115]));
  // Trucks park
  s(plane(32,21,MAT_ASPHALT(),[-210,0.14,130]));
  // NW paddocks (mini paddock near crescent)
  s(plane(25,20,MAT_GRASS_FIELD(),[-230,0.07,-155]));
}

// ─── GRASS CARDS ────────────────────────────────────────────────────────

function addGrassCards() {
  const gm=new THREE.MeshStandardMaterial({color:0x5a9448,roughness:0.92,side:THREE.DoubleSide,alphaTest:0.5});
  for (let i=0;i<200;i++) {
    const angle=(i/200)*Math.PI*2;
    const r=160+Math.random()*70;
    const x=Math.cos(angle)*r, z=Math.sin(angle)*(r*0.55);
    const w=1.2+Math.random()*0.8, h=0.6+Math.random()*0.5;
    const card=new THREE.Mesh(new THREE.PlaneGeometry(w,h),gm);
    card.position.set(x,h/2,z); card.rotation.y=Math.random()*Math.PI;
    card.castShadow=false; card.receiveShadow=true;
    scene.add(card); grassCards.push(card);
  }
}

// ─── PALM SPRITES (billboard) ───────────────────────────────────────────

const PALM_SPRITES=["assets/palm-sprite.png","assets/palm-sprite-2.png"];
const palmSpriteMats=[];

function initPalmSprites() {
  const tl=new THREE.TextureLoader();
  PALM_SPRITES.forEach(src => {
    const tex=tl.load(src);
    tex.colorSpace=THREE.SRGBColorSpace;
    palmSpriteMats.push(new THREE.MeshBasicMaterial({
      map:tex, transparent:true, alphaTest:0.1,
      depthWrite:false, side:THREE.DoubleSide,
    }));
  });
}

function addRoyalPalms() {
  if (palmSpriteMats.length===0) initPalmSprites();
  // Clustered near lake shore (north), clubhouse (south), stables (sw)
  [[-100,-190],[100,-190],[-120,165],[120,165],[0,-185],
   [-50,-192],[50,-192],[-230,75],[-205,100],[-180,90],
   [175,-65],[178,55],[195,140],[-80,165],[80,165],
   [-140,150],[140,150],[0,140],[-60,145],[60,145]
  ].forEach(([x,z]) => addPalmSprite(x,z,1.0+Math.random()*0.45));
}

function addPerimeterTrees() {
  if (palmSpriteMats.length===0) initPalmSprites();
  for (let x=-252;x<=252;x+=13) { addPalmSprite(x,-210,0.85+Math.random()*0.3); addPalmSprite(x,215,0.85+Math.random()*0.3); }
  for (let z=-200;z<=210;z+=16) { addPalmSprite(-257,z,0.9+Math.random()*0.28); addPalmSprite(257,z,0.9+Math.random()*0.28); }
}

function addPalmSprite(x,z,scale=1) {
  if (palmSpriteMats.length===0) initPalmSprites();
  const mat=palmSpriteMats[Math.floor(Math.random()*palmSpriteMats.length)];
  const trunkH=(14+Math.random()*6)*scale;
  const spriteH=trunkH*1.35, spriteW=spriteH*0.5;
  const geo=new THREE.PlaneGeometry(spriteW,spriteH);
  for (const ry of [0, Math.PI/2]) {
    const m=new THREE.Mesh(geo,mat);
    m.position.set(x,spriteH/2,z); m.rotation.y=ry;
    scene.add(m); palmSprites.push(m);
  }
}

// ─── TICK (water animation + billboarding) ──────────────────────────────

export function tickScene(elapsedTime, camera) {
  waterMeshes.forEach(m => {
    if (m.material && m.material.normalMap) {
      m.material.normalMap.offset.x=elapsedTime*0.018;
      m.material.normalMap.offset.y=elapsedTime*0.012;
    }
  });
  grassCards.forEach(card => {
    card.rotation.y=Math.atan2(camera.position.x-card.position.x, camera.position.z-card.position.z);
  });
  palmSprites.forEach(sprite => {
    sprite.rotation.y=Math.atan2(camera.position.x-sprite.position.x, camera.position.z-sprite.position.z);
  });
}

export function getRenderer() { return renderer; }
export function getScene()    { return scene;    }
export function getCamera()   { return camera;   }
export function getClock()    { return clock;    }
