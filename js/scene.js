/**
 * Project XIX - Scene v5 (Villa Ring + Lake + HDRI corrected)
 *
 * SPATIAL TRUTH (from Villas.txt + plan-2d.png):
 *   Polo field:    274m E-W x 146m N-S, centre = origin
 *   Safety zone:   ~20m N/S band, ~12m E/W band (flat, thin)
 *   Lake:          Between safety zone and Tier-1 villas. z~-105 to -125 (crescent shape)
 *   Villa Tier 1:  Inner arc ON the safety zone edge.  z~-130 (north), +-100-170 (E/W straights)
 *   Villa Tier 2:  Lakefront crescent arc.             z~-155
 *   Villa Tier 3:  Outer crescent behind lake.         z~-175
 *   Loft terraces: OUTSIDE villa ring. North: z~-195 to -220. West: beside flats
 *   Clubhouse:     South, z~+170, clear axis gap at centre
 *   Training:      Southwest, x~-195, z~0 (N-S oriented)
 *   Stables:       Far SW, x~-230, z~+80
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { RGBELoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/RGBELoader.js";
import {
  MAT_GRASS_FIELD, MAT_DIRT, MAT_ASPHALT,
  MAT_BRICK, MAT_CONCRETE, MAT_TIMBER, MAT_STONE, MAT_TILE_ROOF,
  MAT_GLASS, MAT_GLASS_WARM, MAT_WHITE_TRIM, MAT_GOLD, MAT_DARK_METAL, MAT_WATER,
} from "./materials.js";

let scene, renderer, camera, clock;
let waterMeshes = [], palmSprites = [];
export let aerialMode = false;

//           INIT                                                                                                                                                                                           

export function initScene(canvas) {
  clock = new THREE.Clock();
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ab8cc);
  scene.fog = new THREE.FogExp2(0x9ac5d4, 0.0016);

  camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1400);

  loadHDRI();
  buildLighting();
  buildSky();
  buildEnvironment();

  return { scene, renderer, camera, clock };
}

//           HDRI                                                                                                                                                                                           

function loadHDRI() {
  new RGBELoader().load("assets/shanghai_bund_4k.hdr", (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
    // Don't set scene.background - keep our painted sky
    if (MAT_GLASS) scene.traverse(obj => {
      if (obj.isMesh && obj.material && obj.material.envMapIntensity !== undefined)
        obj.material.envMap = hdr;
    });
  });
}

//           LIGHTING                                                                                                                                                                               

let sunLight;
export function getSunLight() { return sunLight; }

function buildLighting() {
  scene.add(new THREE.HemisphereLight(0xd4e8ff, 0x4a6a30, 1.6));

  sunLight = new THREE.DirectionalLight(0xffe4a0, 3.8);
  sunLight.position.set(-180, 200, 120);
  sunLight.castShadow = true;
  sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -380;
  sunLight.shadow.camera.right = sunLight.shadow.camera.top   =  380;
  sunLight.shadow.camera.far   = 900;
  sunLight.shadow.mapSize.set(8192, 8192);
  sunLight.shadow.bias = -0.0002;
  sunLight.shadow.normalBias = 0.02;
  sunLight.shadow.radius = 3.5;
  scene.add(sunLight);

  scene.add(Object.assign(new THREE.DirectionalLight(0xb8d0e8, 0.7), { position: { set(){ return this; } } }));
  const fill = new THREE.DirectionalLight(0xb8d0e8, 0.7);
  fill.position.set(120, 80, -100); scene.add(fill);

  // Clubhouse warmth
  [[-40,8,175],[0,8,175],[40,8,175]].forEach(p => {
    const pt = new THREE.PointLight(0xffe0a0, 2.5, 55, 2);
    pt.position.set(...p); scene.add(pt);
  });
  // Stable warmth
  [[-230,3,80],[-255,3,80]].forEach(p => {
    const pt = new THREE.PointLight(0xff8c40, 1.8, 40, 2);
    pt.position.set(...p); scene.add(pt);
  });
}

//           SKY DOME                                                                                                                                                                               

let skyMesh;
function buildSky() {
  const skyC = document.createElement("canvas"); skyC.width = 4; skyC.height = 256;
  const sc = skyC.getContext("2d");
  const g = sc.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#1a3a5c"); g.addColorStop(.35, "#3a7aaa");
  g.addColorStop(.65, "#7ab4d4"); g.addColorStop(1, "#e0ece8");
  sc.fillStyle = g; sc.fillRect(0, 0, 4, 256);
  const st = new THREE.CanvasTexture(skyC); st.colorSpace = THREE.SRGBColorSpace;
  skyMesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16),
    new THREE.MeshBasicMaterial({ map: st, side: THREE.BackSide }));
  scene.add(skyMesh);

  const sunM = new THREE.Mesh(new THREE.SphereGeometry(18, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe8b0 }));
  sunM.position.set(-320, 340, 200); scene.add(sunM);

  // Clouds
  const cmat = new THREE.MeshBasicMaterial({ color: 0xfdfcfa, transparent: true, opacity: .72, side: THREE.DoubleSide });
  [[-180,260,-300],[60,280,-350],[220,250,-280],[-320,240,-180],[140,270,-400]].forEach(([x,y,z]) => {
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(30 + Math.random()*28, 8, 5), cmat);
      m.scale.y = .3; m.position.set(x+(Math.random()-.5)*80, y+Math.random()*12, z+(Math.random()-.5)*50);
      scene.add(m);
    }
  });
}

export function updateSky(topCol, horCol, gndCol) {
  const sc = document.createElement("canvas"); sc.width = 4; sc.height = 256;
  const sx = sc.getContext("2d");
  const g = sx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, topCol); g.addColorStop(.5, horCol); g.addColorStop(1, gndCol);
  sx.fillStyle = g; sx.fillRect(0, 0, 4, 256);
  skyMesh.material.map = new THREE.CanvasTexture(sc);
  skyMesh.material.needsUpdate = true;
}

//           GEOMETRY HELPERS                                                                                                                                                       

function box(w, h, d, mat, pos=[0,0,0], ry=0, shadow=true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(...pos); m.rotation.y = ry;
  m.castShadow = shadow && h > 0.3; m.receiveShadow = true;
  return m;
}
function plane(w, d, mat, pos=[0,0,0]) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI/2; m.position.set(...pos); m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, seg, mat, pos=[0,0,0]) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(...pos); m.castShadow = m.receiveShadow = true;
  return m;
}
function s(...o) { o.forEach(x => x && scene.add(x)); }

//           ENVIRONMENT                                                                                                                                                                         

function buildEnvironment() {
  addGround();
  addPoloField();
  addSafetyZone();
  addYardMarkings();
  addLake();          // BETWEEN safety zone and Tier-1 villas
  addRoads();
  addClubhouse();
  addVillaRing();     // Full 62-66 unit layout per Villas.txt
  addLoftTerraces();  // North exterior + west clusters
  addWestCompound();  // Training field + flats
  addStables();
  addPaddockEast();
  addGamePark();
  addCommercialBlock();
  addServiceCompound();
  addPalmSprites();
  addPerimeterTrees();
}

//           GROUND                                                                                                                                                                                        
// Using PlaneGeometry (not BoxGeometry) so no Y-axis texture stretch

function addGround() {
  // Outer estate ground - dirt/laterite
  const gp = plane(900, 800, MAT_DIRT(), [0, 0, 30]);
  scene.add(gp);
  // Inner green lawn around field
  const gn = plane(420, 380, MAT_GRASS_FIELD(), [0, 0.01, 0]);
  scene.add(gn);
}

//           POLO FIELD                                                                                                                                                                            

function addPoloField() {
  // Mowed stripe canvas - horizontal stripes (E-W = along X axis)
  const sc = document.createElement("canvas"); sc.width = 512; sc.height = 256;
  const ctx = sc.getContext("2d");
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = i%2===0 ? "#5a9448" : "#4a8038";
    ctx.fillRect(0, i*(256/14), 512, 256/14+1);
  }
  const st = new THREE.CanvasTexture(sc);
  st.colorSpace = THREE.SRGBColorSpace; st.wrapS = st.wrapT = THREE.RepeatWrapping;
  st.repeat.set(1, 1); // exact fit - no repeat, no stretch
  const fm = MAT_GRASS_FIELD(); fm.map = st; fm.roughness = 0.92;

  const field = plane(274, 146, fm, [0, 0.12, 0]);
  scene.add(field);

  // Yard lines
  const lm = new THREE.MeshStandardMaterial({ color: 0xf8f5e0, roughness: 0.4 });
  s(box(0.5, 0.05, 146, lm, [0, 0.14, 0], 0, false));
  s(box(274, 0.05, 0.5, lm, [0, 0.14, 0], 0, false));

  // Goal posts
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.2 });
  for (const side of [-1,1]) for (const pz of [0,-14,14])
    s(cyl(0.12, 0.12, 5, 8, postMat, [side*137, 2.5, pz]));
}

//           SAFETY ZONE                                                                                                                                                                            
// Flat dirt bands, NOT tall boxes. Width matches plan proportions.

function addSafetyZone() {
  const dm = MAT_DIRT();
  // North band (between field and lake): z=-73 to -98 = 25m wide
  s(plane(298, 25, dm, [0, 0.11, -85.5]));
  // South band: z=+73 to +98
  s(plane(298, 25, dm, [0, 0.11, 85.5]));
  // West band: 12m wide
  s(plane(12, 146, dm, [-143, 0.11, 0]));
  // East band: 12m wide
  s(plane(12, 146, dm, [143, 0.11, 0]));
  // Corner arcs (approximated as diagonal planes)
  for (const [sx,sz] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    s(plane(20, 20, dm, [sx*140, 0.11, sz*82]));
  }
}

function addYardMarkings() {
  const lm = new THREE.MeshStandardMaterial({ color: 0xf5f0d5, roughness: 0.4 });
  for (const side of [-1,1]) for (const d of [24.5,36.5,55])
    s(box(0.4, 0.05, 146, lm, [side*(137-d), 0.15, 0], 0, false));
}

//           LAKE                                                                                                                                                                                           
// CORRECT POSITION: between safety zone back edge (z~-98) and Tier-1 villas (z~-130)
// Lake centre ~ z=-112. Width: ~190m (spans width of safety zone)
// Shape: elongated crescent/oval

function addLake() {
  const wm = MAT_WATER();
  // Main oval body
  const lakeGeo = new THREE.CylinderGeometry(0, 0, 0.3, 4); // unused
  const parts = [
    new THREE.Mesh(new THREE.BoxGeometry(180, 0.3, 18), wm),    // central body
    new THREE.Mesh(new THREE.SphereGeometry(12, 16, 4), wm),   // west end cap
    new THREE.Mesh(new THREE.SphereGeometry(12, 16, 4), wm),   // east end cap
  ];
  parts[0].position.set(0, 0.15, -112);
  parts[1].position.set(-90, 0.05, -112); parts[1].scale.set(1, 0.25, 1.1);
  parts[2].position.set( 90, 0.05, -112); parts[2].scale.set(1, 0.25, 1.1);
  parts.forEach(p => { p.receiveShadow = true; scene.add(p); waterMeshes.push(p); });

  // Shore trim (dirt/grass edge on both sides of lake)
  const bm = new THREE.MeshStandardMaterial({ color: 0x4a7a38, roughness: 0.9 }); // green shore
  s(plane(200, 5, bm, [0, 0.12, -100])); // south shore (field side)
  s(plane(200, 5, bm, [0, 0.12, -123])); // north shore (villa side)

  // Water reflection ripple lines
  const ripMat = new THREE.MeshStandardMaterial({ color: 0x8ed4e8, roughness: 0.1, transparent: true, opacity: 0.25 });
  for (let i = 0; i < 5; i++)
    s(box(160-i*14, 0.04, 0.3, ripMat, [0, 0.32+i*.02, -110+i*1.8], 0, false));
}

//           ROADS                                                                                                                                                                                           

function addRoads() {
  const am = MAT_ASPHALT();
  const lm = new THREE.MeshStandardMaterial({ color: 0xf5f0d0, roughness: 0.5 });

  // Lagos Road (south boundary)
  s(plane(600, 18, am, [0, 0.13, 210]));
  for (let x = -270; x <= 270; x += 18) s(box(8, 0.15, 0.38, lm, [x, 0.26, 210], 0, false));

  // Crescent road (north, behind lofts)
  s(plane(500, 10, am, [0, 0.13, -235]));
  s(plane(10, 60, am,  [0, 0.13, -260])); // north link road

  // Internal south connector
  s(plane(380, 10, am, [0, 0.13, 190]));
  // West internal road
  s(plane(10, 320, am, [-200, 0.13, 30]));
  // East internal road
  s(plane(10, 280, am, [210, 0.13, 20]));
  // Clubhouse access
  s(plane(20, 50, am,  [0, 0.13, 172]));
}

//           CLUBHOUSE                                                                                                                                                                               

function addClubhouse() {
  const g = new THREE.Group(); g.position.set(0, 0, 170);
  const cm=MAT_CONCRETE(), gm=MAT_GLASS(.48), gw=MAT_GLASS_WARM(.55);
  const tm=MAT_TIMBER(), wm=MAT_WHITE_TRIM(), dm=MAT_DARK_METAL(), gld=MAT_GOLD();

  // Ground floor
  g.add(box(115, 4.8, 24, cm, [0, 2.4, 0]));
  // Bleachers (face north toward field)
  for (let i = 0; i < 8; i++)
    g.add(box(92, .45, 2.2, new THREE.MeshStandardMaterial({color:0xd0c8b8,roughness:.7}),
      [0, .55+i*.52, -11.5+i*1.55], 0, false));
  for (let x = -48; x <= 48; x += 12) g.add(box(1.1, 5.2, 1.1, cm, [x, 2.7, -12.2]));

  // Floor 1
  g.add(box(122, 4.6, 25, cm, [0, 7.3, .5]));
  g.add(box(110, 3.4, .45, gw, [0, 7.3, -12.4]));
  g.add(box(110, .95, .3, gld, [0, 5.3, -12.5], 0, false));
  for (const ux of [-35,0,35]) addUmbrella(g, [ux, 5.9, -9]);

  // Floor 2
  g.add(box(130, 4.4, 26, cm, [0, 12.1, 1.0]));
  g.add(box(118, 3.4, .45, gm, [0, 12.1, -12.6]));

  // Slab overhangs
  g.add(box(134, .65, 28, wm, [0, 4.85, 1.0], 0, false));
  g.add(box(136, .65, 29, wm, [0, 9.65, 1.0], 0, false));
  g.add(box(138, .65, 29, wm, [0, 14.55, 1.0], 0, false));

  for (let x = -54; x <= 54; x += 12) {
    g.add(box(.7, 4.5, .7, wm, [x, 7.3, -12.4]));
    g.add(box(.7, 4.3, .7, wm, [x, 12.1, -12.5]));
  }
  for (const side of [-46,46]) {
    g.add(box(16, 6.5, 16, cm, [side, 18.0, .5]));
    g.add(box(17.5, .7, 17.5, wm, [side, 21.5, .5], 0, false));
  }
  g.add(box(14, 5.2, 1.0, tm, [0, 2.6, -12.8]));

  // Parking both sides
  s(plane(55, 28, MAT_ASPHALT(), [-62, 0.13, 200]));
  s(plane(55, 28, MAT_ASPHALT(), [ 62, 0.13, 200]));

  scene.add(g);
}

function addUmbrella(parent, pos) {
  const g = new THREE.Group(); g.position.set(...pos);
  g.add(cyl(.08, .08, 3.0, 6, MAT_GOLD(), [0, 1.5, 0]));
  g.add(cyl(3.2, 3.6, .45, 16, new THREE.MeshStandardMaterial({color:0xf0e8d8,roughness:.7}), [0, 3.2, 0]));
  parent.add(g);
}

//           VILLA RING - FULL LAYOUT (62-66 units per Villas.txt)                                           
//
// SPATIAL LAYOUT:
//   Safety zone north back edge: z ~ -98
//   Lake:                        z ~ -102 to -122  (between safety zone and Tier 1)
//   Tier 1 inner arc:            z ~ -130 (north), x ~ +-112 (E/W straights at track edge)
//   Tier 2 lakefront arc:        z ~ -152
//   Tier 3 outer crescent:       z ~ -172
//   W/E straights:               x = +-112 (inner), full length z=-90 to +90
//   South arc:                   z ~ +110-125, gap at centre
//   PLOT spacing:                18m (touching but clear)

function addVillaRing() {
  const P = 18; // plot spacing centre-to-centre

  //        WEST STRAIGHT - 14 villas, x~-112, z=-91 to +91, yaw=+  /2 (face east)       
  for (let i = 0; i < 14; i++) {
    const z = -91 + i * P;
    placeVilla(-112, z, Math.PI/2);
  }

  //        EAST STRAIGHT - 14 villas, x~+112, z=-91 to +91, yaw=-  /2 (face west)       
  for (let i = 0; i < 14; i++) {
    const z = -91 + i * P;
    placeVilla(112, z, -Math.PI/2);
  }

  //        NORTH TIER 1 - inner arc ON safety zone, z~-115 to -130       
  // NW: 5 villas curving from west straight into north cap
  const nwArc1 = [[-100,-115],[-84,-122],[-66,-127],[-46,-130],[-26,-131]];
  nwArc1.forEach(([x,z]) => placeVilla(x, z, arcYaw(x, z)));
  // NE: 5 villas mirrored
  const neArc1 = [[100,-115],[84,-122],[66,-127],[46,-130],[26,-131]];
  neArc1.forEach(([x,z]) => placeVilla(x, z, arcYaw(x, z)));

  //        NORTH TIER 2 - lakefront crescent, z~-148 to -158       
  const nwArc2 = [[-115,-138],[-100,-148],[-82,-154],[-62,-158],[-42,-160]];
  nwArc2.forEach(([x,z]) => placeVilla(x, z, arcYaw(x, z)));
  const neArc2 = [[115,-138],[100,-148],[82,-154],[62,-158],[42,-160]];
  neArc2.forEach(([x,z]) => placeVilla(x, z, arcYaw(x, z)));

  //        NORTH TIER 3 - outer crescent, z~-172 to -180       
  const nwArc3 = [[-80,-168],[-55,-174],[-28,-178]];
  nwArc3.forEach(([x,z]) => placeVilla(x, z, Math.PI));
  const neArc3 = [[80,-168],[55,-174],[28,-178]];
  neArc3.forEach(([x,z]) => placeVilla(x, z, Math.PI));

  //        SOUTH SW ARC - 4 villas continuing from west straight around SW curve       
  const swArc = [[-112,97],[-105,108],[-94,117],[-80,123]];
  swArc.forEach(([x,z]) => placeVilla(x, z, arcYawSouth(x, z)));

  //        SOUTH SE ARC - 4 villas, gap at centre for clubhouse axis       
  const seArc = [[112,97],[105,108],[94,117],[80,123]];
  seArc.forEach(([x,z]) => placeVilla(x, z, arcYawSouth(x, z)));
}

// Yaw calculation for north arc: face toward field centre (origin)
function arcYaw(x, z) {
  return Math.atan2(x, z) + Math.PI; // face origin from north
}
// Yaw for south arc: face north toward field
function arcYawSouth(x, z) {
  return Math.atan2(-x, -z); // face origin from south
}

function placeVilla(x, z, ry) {
  const v = createVilla();
  v.position.set(x, 0, z);
  v.rotation.y = ry;
  scene.add(v);
  addPlotLandscaping(x, z, ry);
}

function addPlotLandscaping(vx, vz, ry) {
  const hedgeMat = new THREE.MeshStandardMaterial({color:0x2a5a20,roughness:0.95});
  const gateMat  = new THREE.MeshStandardMaterial({color:0x8a7050,roughness:0.7,metalness:0.2});
  const pathMat  = new THREE.MeshStandardMaterial({color:0xd0c8b4,roughness:0.8});
  const g = new THREE.Group(); g.position.set(vx, 0, vz); g.rotation.y = ry;
  // Side hedges - receiveShadow, castShadow, on ground (y=0.65)
  const hL = new THREE.Mesh(new THREE.BoxGeometry(.4, 1.3, 16), hedgeMat);
  hL.position.set(-10, .65, 0); hL.castShadow = true; hL.receiveShadow = true; g.add(hL);
  const hR = hL.clone(); hR.position.set(10, .65, 0); g.add(hR);
  const hF = new THREE.Mesh(new THREE.BoxGeometry(18, .75, .4), hedgeMat);
  hF.position.set(0, .375, -9.5); hF.castShadow = true; hF.receiveShadow = true; g.add(hF);
  for (const gx of [-2.8, 2.8]) {
    const gp = new THREE.Mesh(new THREE.BoxGeometry(.35, 1.6, .35), gateMat);
    gp.position.set(gx, .8, -9.8); gp.castShadow = true; g.add(gp);
  }
  // Driveway - PlaneGeometry on ground
  const dp = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), pathMat);
  dp.rotation.x = -Math.PI/2; dp.position.set(0, .02, -7.5); dp.receiveShadow = true; g.add(dp);
  scene.add(g);
}

function createVilla() {
  const g = new THREE.Group();
  const cm=MAT_CONCRETE(), tm=MAT_TIMBER();
  const gm=MAT_GLASS(.52), gw=MAT_GLASS_WARM(.6);
  const wm=MAT_WHITE_TRIM(), dm=MAT_DARK_METAL();
  const charcoal = new THREE.MeshStandardMaterial({color:0x404040,roughness:.8});
  const ledMat   = new THREE.MeshStandardMaterial({
    color:0xffffff,emissive:new THREE.Color(0xffffff),emissiveIntensity:.8,roughness:.2 });

  const addB = (w,h,d,m,p,r=0,sh=true) => g.add(box(w,h,d,m,p,r,sh));
  const addC = (rt,rb,h,seg,m,p) => g.add(cyl(rt,rb,h,seg,m,p));

  addB(16.5, 3.4, 13.5, cm, [0,1.7,0]);
  addB(11.5, 3.0, .3,   dm, [.5,1.7,-7.1]);
  for (const cx of [-6.5,6.5]) addC(.22,.22,3.4,10,dm,[cx,1.7,-6.5]);
  addB(19,   .55, 15.5, wm, [0,3.48,0],0,false);
  addB(17.5, 3.5, 14,   cm, [0,5.05,0]);
  addB(5.5,  3.3, .5,   charcoal, [-5,5.05,-7.3]);
  addB(5.0,  3.1, .55,  tm, [.5,5.05,-7.4]);
  addB(4.5,  3.1, .4,   gw, [4.5,5.05,-7.35]);
  addB(15,   .85, .3,   MAT_GLASS(.38), [0,3.55,-7.25],0,false);
  addB(19.5, .55, 15.5, wm, [0,7.15,0],0,false);
  addB(18.5, 3.3, 14.5, cm, [0,8.7,0]);
  addB(15,   3.1, .55,  tm, [0,8.7,-7.6]);
  addB(13,   2.8, .35,  gw, [0,8.7,-7.2]);
  addB(16,   .8,  .3,   MAT_GLASS(.35), [0,7.2,-7.5],0,false);
  addB(20,   .65, 16,   wm, [0,10.85,0],0,false);
  addB(20.4, .18, .2,   ledMat, [0,10.96,-8.05],0,false);
  return g;
}

//           LOFT TERRACES                                                                                                                                                                   
// North exterior: two rows at z~-195 and z~-215 (behind Tier 3 villas + Crescent road)
// West exterior: two clusters beside flats

function addLoftTerraces() {
  //        NORTH ROW 1 (z~-196, inner) - 10 units spanning full width       
  for (let x = -108; x <= 108; x += 22) {
    if (Math.abs(x) < 15) continue; // gap at link road
    s(createLoftUnit(x, -196, Math.PI)); // face south toward field
  }

  //        NORTH ROW 2 (z~-218, outer, at crescent road) - 12 units       
  for (let x = -121; x <= 121; x += 22) {
    if (Math.abs(x) < 15) continue;
    s(createLoftUnit(x, -218, Math.PI));
  }

  //        WEST UPPER CLUSTER (beside training field, z~-45 to +0)       
  for (let z = -40; z <= -5; z += 22) s(createLoftUnit(-165, z, -Math.PI/2));

  //        WEST LOWER CLUSTER (z~+5 to +45)       
  for (let z = 5; z <= 45; z += 22) s(createLoftUnit(-165, z, -Math.PI/2));

  //        NE EXTERIOR STRIP (x~+165, z~-120 to -80)       
  for (let z = -118; z <= -82; z += 22) s(createLoftUnit(165, z, -Math.PI/2));
}

function createLoftUnit(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry;
  const sm=MAT_STONE(), cm=MAT_CONCRETE(), tm=MAT_TIMBER();
  const gw=MAT_GLASS_WARM(.62), wm=MAT_WHITE_TRIM(), dm=MAT_DARK_METAL();
  const tileM = MAT_TILE_ROOF();

  // Ground floor - gabion stone
  g.add(box(20, 3.4, 10, sm, [0,1.7,0]));
  for (let i = 0; i < 2; i++) {
    const wx = -5 + i*10;
    g.add(box(8.5, 2.7, .4, gw, [wx, 1.7, -5.2]));
  }
  // Upper floor - concrete render + louvres
  g.add(box(20, 3.5, 10.5, cm, [0,5.25,0]));
  for (let i = 0; i < 2; i++) {
    const wx = -5 + i*10;
    g.add(box(1.3, 3.3, .6, tm, [wx-3.5, 5.25, -5.6]));
    g.add(box(7.0, 2.9, .4, gw, [wx+0.5, 5.25, -5.7]));
    g.add(box(.25, 3.0, .5, dm, [wx+4,   5.25, -5.6]));
  }
  // Flat roof - orange-tinted for loft typology
  g.add(box(21.5, .6, 12, tileM, [0,7.28,0], 0, false));
  // Fence posts
  for (const fx of [-10,0,10]) {
    g.add(box(.15, 1.8, 2.5, tm, [fx, .9, -8]));
  }
  return g;
}

//           WEST COMPOUND                                                                                                                                                                   

function addWestCompound() {
  const gm=MAT_GRASS_FIELD(), dm=MAT_DIRT();
  const lm = new THREE.MeshStandardMaterial({color:0xf0ecd0,roughness:.5});

  // Training field (N-S oriented: 100m wide, 160m deep, centre at x=-195, z=0)
  s(plane(124, 188, dm, [-195, .06, 0]));
  s(plane(100, 160, gm, [-195, .10, 0]));
  for (const z of [-55,0,55]) s(box(100, .05, .4, lm, [-195, .15, z], 0, false));

  // Blocks of flats - north and south of training field
  s(createFlatBlock(-172, -68));
  s(createFlatBlock(-172,  68));
}

function createFlatBlock(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const BW=44, BD=16, floors=4, fH=3.45;
  const cm=MAT_CONCRETE(), tm=MAT_TIMBER(), dm=MAT_DARK_METAL();
  const gw=MAT_GLASS_WARM(.52), wm=MAT_WHITE_TRIM();

  for (let col=-BW/2+5; col<=BW/2-5; col+=8) g.add(box(.9,3.8,.9,cm,[col,1.9,0]));
  for (let f=1; f<=floors; f++) {
    const y=3.8+(f-1)*fH+fH/2;
    g.add(box(BW,fH-.25,BD,cm,[0,y,0]));
    g.add(box(1.6,fH-.3,BD+2.5,dm,[-BW/2-.9,y,0]));
    g.add(box(1.6,fH-.3,BD+2.5,dm,[ BW/2+.9,y,0]));
    g.add(box(7,fH-.5,.55,tm,[0,y,-BD/2-.1]));
    g.add(box(BW-6,.85,.4,MAT_GLASS(.5),[0,y-fH/2+.4,-BD/2-.35],0,false));
    g.add(box(BW+2,.4,BD+2,wm,[0,y-fH/2,0],0,false));
  }
  const roofY=3.8+floors*fH+3.2;
  for (const side of [-1,1]) { const w=box(BW/2+4,.9,10,wm,[side*(BW/4),roofY,0]); w.rotation.z=side*.14; g.add(w); }
  g.add(box(8,.7,10,wm,[0,roofY-1.4,0],0,false));
  scene.add(g); return g;
}

//           STABLES                                                                                                                                                                                        

function addStables() {
  s(plane(62, 44, MAT_STONE(), [-245, .08, 80]));
  [[-230,68],[-230,86],[-258,68],[-258,86]].forEach(([x,z]) => scene.add(createStableBlock(x,z)));
}

function createStableBlock(x, z) {
  const g = new THREE.Group(); g.position.set(x,0,z);
  const bm=MAT_BRICK(), tm=MAT_TILE_ROOF(), timMat=MAT_TIMBER(), dm=MAT_DARK_METAL();
  const xMat=new THREE.MeshStandardMaterial({color:0x5c3818,roughness:.8});

  g.add(box(38,4.4,14,bm,[0,2.2,0]));
  const rL=box(40,.5,18,tm,[0,4.85,0]); rL.rotation.z=.18; g.add(rL);
  const rR=box(40,.5,18,tm,[0,4.85,0]); rR.rotation.z=-.18; g.add(rR);
  g.add(box(40,.3,.3,timMat,[0,6.3,0]));
  for (let tx=-15;tx<=15;tx+=9) {
    g.add(box(.25,5,.25,timMat,[tx,4.5,-7]));
    g.add(box(.25,5,.25,timMat,[tx,4.5,7]));
    g.add(box(.2,.2,14,timMat,[tx,6.0,0]));
  }
  for (let i=0;i<6;i++) {
    const sx=-13+i*5.2;
    g.add(box(4.8,3.8,.4,timMat,[sx,2.2,-7.2]));
    g.add(box(3.2,.28,.5,xMat,[sx,1.8,-7.25],.72));
    g.add(box(3.2,.28,.5,xMat,[sx,1.8,-7.25],-.72));
  }
  for (let px=-18;px<=18;px+=6) g.add(cyl(.18,.18,4.8,8,dm,[px,2.4,-7.5]));
  return g;
}

//           PADDOCK & RECREATION                                                                                                                                                 

function addPaddockEast() {
  const gm=MAT_GRASS_FIELD();
  s(plane(42,40,gm,[175,.07,-60]));
  const fpm=new THREE.MeshStandardMaterial({color:0x8c7050,roughness:.8});
  const frm=new THREE.MeshStandardMaterial({color:0xfcfaf5,roughness:.65});
  for (let fz=-80;fz<=-40;fz+=5) {
    s(box(.28,1.7,.28,fpm,[155,.85,fz])); s(box(.28,1.7,.28,fpm,[195,.85,fz]));
  }
  for (let fx=155;fx<=195;fx+=5) {
    s(box(.28,1.7,.28,fpm,[fx,.85,-80])); s(box(.28,1.7,.28,fpm,[fx,.85,-40]));
  }
  s(box(.1,.1,40,frm,[155,1.5,-60],0,false)); s(box(.1,.1,40,frm,[195,1.5,-60],0,false));
  s(box(40,.1,.1,frm,[175,1.5,-80],0,false)); s(box(40,.1,.1,frm,[175,1.5,-40],0,false));
  s(plane(52,52,gm,[175,.07,-130]));
}

function addGamePark() {
  s(plane(56,46,MAT_GRASS_FIELD(),[175,.07,60]));
  const cols=[0xe8602a,0x2a88c8,0xe8c82a,0x4ac84a];
  for (let i=0;i<5;i++) {
    const h=2.8+i*.4;
    s(box(3.5,h,3.5,new THREE.MeshStandardMaterial({color:cols[i%4],roughness:.6}),
      [158+i*8,h/2,58+(i%2)*9]));
  }
}

//           COMMERCIAL & SERVICES                                                                                                                                                 

function addCommercialBlock() {
  const g=new THREE.Group(); g.position.set(210,0,140);
  const cm=MAT_CONCRETE(),gm=MAT_GLASS(.5),wm=MAT_WHITE_TRIM();
  g.add(box(44,9.5,28,cm,[0,4.75,0]));
  g.add(box(44,.6,30,wm,[0,9.85,0],0,false));
  g.add(box(.45,9.0,24,gm,[-22.3,4.75,0]));
  for (let cz=-10;cz<=10;cz+=5) g.add(box(.65,3.8,.65,cm,[-22.0,1.9,cz]));
  scene.add(g);
}

function addServiceCompound() {
  const cm=MAT_CONCRETE();
  const svc=new THREE.MeshStandardMaterial({color:0xcc2200,roughness:.7});
  s(box(18,5.2,14,svc,[-175,2.6,120]));
  s(box(20,.55,16,new THREE.MeshStandardMaterial({color:0xaa1800,roughness:.7}),[-175,5.4,120],0,false));
  s(box(33,6.5,19,cm,[-145,3.25,130]));
  s(box(13,4.2,11,cm,[-120,2.1,115]));
  s(plane(32,21,MAT_ASPHALT(),[-210,.14,130]));
}

//           PALM SPRITES                                                                                                                                                                            

const PALM_SRCS=["assets/palm-sprite.png","assets/palm-sprite-2.png"];
const palmMats=[];

function initPalmMats() {
  if (palmMats.length) return;
  const tl=new THREE.TextureLoader();
  PALM_SRCS.forEach(src=>{
    const t=tl.load(src); t.colorSpace=THREE.SRGBColorSpace;
    palmMats.push(new THREE.MeshBasicMaterial({map:t,transparent:true,alphaTest:.1,depthWrite:false,side:THREE.DoubleSide}));
  });
}

function addPalmSprite(x, z, scale=1) {
  initPalmMats();
  const mat=palmMats[Math.floor(Math.random()*palmMats.length)];
  const h=(14+Math.random()*6)*scale, w=h*.5;
  for (const ry of [0, Math.PI/2]) {
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);
    m.position.set(x,h/2,z); m.rotation.y=ry;
    scene.add(m); palmSprites.push(m);
  }
}

function addPalmSprites() {
  // Near lake shores
  for (let x=-90;x<=90;x+=18) { addPalmSprite(x,-100,1.1); addPalmSprite(x,-124,1.0); }
  // Clubhouse flanks
  [[-120,165],[120,165],[-80,165],[80,165]].forEach(([x,z])=>addPalmSprite(x,z,1.2));
  // Stable area
  [[-225,65],[-255,65],[-240,95]].forEach(([x,z])=>addPalmSprite(x,z,1.0));
  // Paddock
  [[160,-70],[190,-70],[160,45],[190,45]].forEach(([x,z])=>addPalmSprite(x,z,1.1));
}

function addPerimeterTrees() {
  initPalmMats();
  for (let x=-260;x<=260;x+=13) {
    addPalmSprite(x,-220,.85+Math.random()*.3);
    addPalmSprite(x, 215,.85+Math.random()*.3);
  }
  for (let z=-215;z<=215;z+=16) {
    addPalmSprite(-262,z,.9+Math.random()*.25);
    addPalmSprite( 262,z,.9+Math.random()*.25);
  }
}

//           TICK                                                                                                                                                                                                    

export function tickScene(elapsedTime, camera) {
  waterMeshes.forEach(m=>{
    if (m.material && m.material.normalMap) {
      m.material.normalMap.offset.x=elapsedTime*.018;
      m.material.normalMap.offset.y=elapsedTime*.012;
    }
  });
  palmSprites.forEach(s=>{
    s.rotation.y=Math.atan2(camera.position.x-s.position.x, camera.position.z-s.position.z);
  });
}

//           EXPORTS                                                                                                                                                                                           

export function getRenderer() { return renderer; }
export function getScene()    { return scene;    }
export function getCamera()   { return camera;   }
export function getClock()    { return clock;    }

