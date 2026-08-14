/**
 * Project XIX -- Scene v9 (Pixel-perfect layout)
 *
 * SINGLE SOURCE OF TRUTH (derived from pixel measurements of Screenshot_2026-08-07_154711.png):
 *   Coordinate system: X = East(+)/West(-), Z = South(+)/North(-)
 *   Field centre = origin. Field = 274m E-W x 146m N-S.
 *
 *   Key measured positions (all in metres):
 *   Safety zone: N cap z=-73 to -98, S cap z=+73 to +98, W strip x=-137 to -148, E strip x=+137 to +148
 *   Lake: centre x=-10, z=-78. Spans x=-262 to +243, z=-103 to -53
 *   Ring road W: x=-230. Ring road E: x=+157
 *   Villa inner columns: W x=-162, E x=+162 (just outside safety zone)
 *   Villa outer columns: W x=-185, E x=+185
 *   North villas (Tier1): z=-97 (between safety zone and lake setback)
 *   North villa setback gap: z=-98 to -112 (grass/landscaping, then lake at -112)
 *   Clubhouse: x=0 (centred on field axis), z=+152 (south of safety zone)
 *   Block of flats: x=-310, N block z=-29, S block z=+29. HORIZONTAL (80m E-W x 28m N-S)
 *   Loft terraces west: x=-285, z=-38 and z=+29. HORIZONTAL rows (E-W)
 *   Training field: x=-390, z=0. 100m E-W x 160m N-S (N-S oriented)
 *   Stables: x=-380, z=+95 approx
 *   Services: x=-280, z=+95 approx
 *   Paddock: x=+220, z=0
 *   Game park: x=+220, z=+52
 *   Commercial: x=+270, z=+65
 *   Lagos Road: z=+180 (south boundary)
 *   Crescent Road: z=-155 (north, outside loft rows)
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { RGBELoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/RGBELoader.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import {
  MAT_GRASS_FIELD, MAT_DIRT, MAT_ASPHALT,
  MAT_BRICK, MAT_CONCRETE, MAT_TIMBER, MAT_STONE, MAT_TILE_ROOF,
  MAT_GLASS, MAT_GLASS_WARM, MAT_WHITE_TRIM, MAT_GOLD, MAT_DARK_METAL, MAT_WATER,
} from "./materials.js";

let scene, renderer, camera, clock;
let waterMeshes = [], palmSprites = [];
let villaGLBLoaded = false;
let villaGLBScene = null;
let pendingVillaPositions = []; // queued while GLB loads
let skyMesh;

export function initScene(canvas) {
  clock = new THREE.Clock();
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8ab8cc);
  scene.fog = new THREE.FogExp2(0x8ab8cc, 0.0012);

  camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1400);

  loadHDRI();
  buildLighting();
  buildSky();
  loadVillaGLB();     // async load - places villas when ready
  buildEnvironment();
  return { scene, renderer, camera, clock };
}

//        HDRI                                                                                                                                                                                                             
function loadHDRI() {
  new RGBELoader().load("assets/shanghai_bund_4k.hdr", (hdr) => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
  });
}

//        LIGHTING                                                                                                                                                                                                 
let sunLight;
export function getSunLight() { return sunLight; }

function buildLighting() {
  scene.add(new THREE.HemisphereLight(0xd4e8ff, 0x4a6a30, 1.4));
  sunLight = new THREE.DirectionalLight(0xffe8b0, 2.8);
  sunLight.position.set(-160, 180, 100);
  sunLight.castShadow = true;
  sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -380;
  sunLight.shadow.camera.right = sunLight.shadow.camera.top = 380;
  sunLight.shadow.camera.far = 900;
  sunLight.shadow.mapSize.set(4096, 4096);
  sunLight.shadow.bias = -0.0002;
  sunLight.shadow.normalBias = 0.02;
  sunLight.shadow.radius = 3;
  scene.add(sunLight);
  const fill = new THREE.DirectionalLight(0xb8d0e8, 0.55);
  fill.position.set(120, 80, -100); scene.add(fill);
  // Clubhouse interior warmth
  [[-40,8,160],[0,8,160],[40,8,160]].forEach(p => {
    const pt = new THREE.PointLight(0xffe0a0, 2.2, 50, 2);
    pt.position.set(...p); scene.add(pt);
  });
  // Stables
  [[-380,3,90],[-355,3,90]].forEach(p => {
    const pt = new THREE.PointLight(0xff8c40, 1.5, 38, 2);
    pt.position.set(...p); scene.add(pt);
  });
}

//        SKY                                                                                                                                                                                                                
function buildSky() {
  const skyC = document.createElement("canvas"); skyC.width = 4; skyC.height = 256;
  const sc = skyC.getContext("2d");
  const g = sc.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "#1a3a6a"); g.addColorStop(.4, "#5a9acc");
  g.addColorStop(.75, "#8ab8d4"); g.addColorStop(1, "#c8d8e0");
  sc.fillStyle = g; sc.fillRect(0, 0, 4, 256);
  const st = new THREE.CanvasTexture(skyC); st.colorSpace = THREE.SRGBColorSpace;
  skyMesh = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16),
    new THREE.MeshBasicMaterial({ map: st, side: THREE.BackSide }));
  scene.add(skyMesh);
  // Sun
  const sunM = new THREE.Mesh(new THREE.SphereGeometry(16, 16, 8),
    new THREE.MeshBasicMaterial({ color: 0xffe8b0 }));
  sunM.position.set(-300, 320, 180); scene.add(sunM);
  // Clouds
  const cm = new THREE.MeshBasicMaterial({ color: 0xfdfcfa, transparent: true, opacity: .68, side: THREE.DoubleSide });
  [[-180,260,-300],[80,270,-350],[220,250,-280],[-320,240,-180],[140,265,-400]].forEach(([x,y,z]) => {
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(28+Math.random()*26, 8, 5), cm);
      m.scale.y = .28; m.position.set(x+(Math.random()-.5)*70, y+Math.random()*10, z+(Math.random()-.5)*45);
      scene.add(m);
    }
  });
}

export function updateSky(topCol, horCol, gndCol) {
  if (!skyMesh) return;
  const sc = document.createElement("canvas"); sc.width = 4; sc.height = 256;
  const sx = sc.getContext("2d");
  const g = sx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, topCol); g.addColorStop(.5, horCol); g.addColorStop(1, gndCol);
  sx.fillStyle = g; sx.fillRect(0, 0, 4, 256);
  skyMesh.material.map = new THREE.CanvasTexture(sc);
  skyMesh.material.needsUpdate = true;
}

//        GEOMETRY HELPERS                                                                                                                                                                         
function box(w, h, d, mat, pos=[0,0,0], ry=0, shadow=true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
  m.position.set(...pos); m.rotation.y = ry;
  m.castShadow = shadow && h>.3; m.receiveShadow = true; return m;
}
function plane(w, d, mat, pos=[0,0,0]) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w,d), mat);
  m.rotation.x = -Math.PI/2; m.position.set(...pos); m.receiveShadow = true; return m;
}
function cyl(rt, rb, h, seg, mat, pos=[0,0,0]) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg), mat);
  m.position.set(...pos); m.castShadow = m.receiveShadow = true; return m;
}
function s(...o) { o.forEach(x => x && scene.add(x)); }

//        ENVIRONMENT                                                                                                                                                                                        
//        VILLA GLB LOADER                                                                                                                                                                            
// Scale: 12.558x to reach real-world 16.5m width
// Y offset: +4.94 to sit on ground (mesh min-y = -0.393 * scale)
// Two embedded PBR textures: diffuse + metallic-roughness
const VILLA_SCALE = 12.558;
const VILLA_Y     = 4.94;  // Y offset so mesh base sits at y=0

function loadVillaGLB() {
  const loader = new GLTFLoader();
  loader.load(
    "assets/villa-mesh.glb",
    (gltf) => {
      villaGLBScene = gltf.scene;
      villaGLBLoaded = true;

      // Apply scale and ground offset to the loaded scene
      villaGLBScene.scale.setScalar(VILLA_SCALE);
      villaGLBScene.position.y = VILLA_Y;

      // Enable shadows on all meshes
      villaGLBScene.traverse(child => {
        if (child.isMesh) {
          child.castShadow    = true;
          child.receiveShadow = true;
          // Boost PBR quality
          if (child.material) {
            child.material.envMapIntensity = 1.2;
            if (child.material.roughness !== undefined)
              child.material.roughness = Math.max(child.material.roughness, 0.3);
          }
        }
      });

      // Flush any positions that were queued before the GLB finished loading
      pendingVillaPositions.forEach(({ x, z, ry }) => {
        placeVillaGLB(x, z, ry);
      });
      pendingVillaPositions = [];
      console.log("Villa GLB loaded and placed:", villaGLBScene.children.length, "objects");
    },
    (xhr) => {
      if (xhr.total) {
        console.log("Villa GLB: " + Math.round(xhr.loaded / xhr.total * 100) + "%");
      }
    },
    (err) => {
      console.error("Villa GLB load error:", err);
      // Fallback: use procedural villas for all queued positions
      pendingVillaPositions.forEach(({ x, z, ry }) => {
        const v = createVillaFallback();
        v.position.set(x, 0, z);
        v.rotation.y = ry;
        scene.add(v);
      });
      pendingVillaPositions = [];
    }
  );
}

function placeVillaGLB(x, z, ry) {
  if (!villaGLBLoaded || !villaGLBScene) {
    // Queue for when GLB finishes loading
    pendingVillaPositions.push({ x, z, ry });
    return;
  }
  // Clone the loaded scene (shares geometry + materials for memory efficiency)
  const clone = villaGLBScene.clone(true);
  clone.position.set(x, 0, z);
  clone.rotation.y = ry;
  // Tag for orientation calibration tool
  clone.userData.isVillaGLB = true;
  clone.userData.baseRotY   = ry;
  scene.add(clone);
}

function buildEnvironment() {
  addGround();
  addPoloField();
  addSafetyZone();
  addYardMarkings();
  addRoads();          // roads BEFORE buildings so they appear under
  addLake();           // main crescent lake (north)
  addEastLake();       // second water body (east boundary)
  addClubhouse();
  addVillaRing();
  addLoftTerraces();   // north crescent rows + west compound
  addWestCompound();   // training field + flats
  addStables();
  addPaddockEast();
  addGamePark();
  addCommercialBlock();
  addServiceCompound();
  addPalmSprites();
  addPerimeterTrees();
}

//        GROUND (base dirt plane, roads and grass overlaid on top)                                                 
function addGround() {
  s(plane(900, 700, MAT_DIRT(), [0, 0, 30]));
}

//        POLO FIELD                                                                                                                                                                                           
function addPoloField() {
  // Mowed stripe canvas
  const sc2 = document.createElement("canvas"); sc2.width = 512; sc2.height = 256;
  const ctx = sc2.getContext("2d");
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = i%2===0 ? "#5a9448" : "#4a8038";
    ctx.fillRect(0, i*(256/14), 512, 256/14+1);
  }
  const st = new THREE.CanvasTexture(sc2);
  st.colorSpace = THREE.SRGBColorSpace; st.wrapS = st.wrapT = THREE.RepeatWrapping; st.repeat.set(1,1);
  const fm = MAT_GRASS_FIELD(); fm.map = st;
  s(plane(274, 146, fm, [0, 0.12, 0]));
  const lm = new THREE.MeshStandardMaterial({color:0xf8f5e0,roughness:.4});
  s(box(0.5,.05,146,lm,[0,.14,0],0,false));
  s(box(274,.05,0.5,lm,[0,.14,0],0,false));
  const pm = new THREE.MeshStandardMaterial({color:0xffffff,roughness:.4,metalness:.2});
  for (const sx2 of [-1,1]) for (const pz of [0,-14,14]) s(cyl(.12,.12,5,8,pm,[sx2*137,2.5,pz]));
}

function addSafetyZone() {
  // Safety zone: flat dirt bands around the field perimeter
  // N cap: z = -73 to -98 (25m wide)
  // S cap: z = +73 to +98 (25m wide)
  // W strip: x = -137 to -148 (11m wide)
  // E strip: x = +137 to +148 (11m wide)
  const dm = MAT_DIRT();
  s(plane(298, 25, dm, [0, .11, -85.5]));
  s(plane(298, 25, dm, [0, .11,  85.5]));
  s(plane(11, 146, dm, [-142.5, .11, 0]));
  s(plane(11, 146, dm, [142.5, .11, 0]));
  // Oval cap corners
  for (const [cx, cz] of [[-132,-80],[132,-80],[-132,80],[132,80]])
    s(plane(20, 20, dm, [cx, .11, cz]));
}

function addYardMarkings() {
  const lm = new THREE.MeshStandardMaterial({color:0xf5f0d5,roughness:.4});
  for (const side of [-1,1]) for (const d of [24.5,36.5,55])
    s(box(.4,.05,146,lm,[side*(137-d),.15,0],0,false));
}

//        ROADS (from pixel measurements)                                                                                                                            
function addRoads() {
  const am = MAT_ASPHALT();
  const lm = new THREE.MeshStandardMaterial({color:0xf0ecd0,roughness:.5});
  const Y = 0.12;

  // LAGOS ROAD (south boundary, z=+180)
  s(plane(700, 18, am, [0, Y, 180]));
  for (let x = -300; x <= 300; x += 18) s(box(8,.04,.35,lm,[x,Y+.03,180],0,false));

  // CRESCENT ROAD (north, z=-155, outside loft rows)
  s(plane(560, 12, am, [0, Y, -155]));
  // North link road to golf estate
  s(plane(10, 55, am, [0, Y, -178]));

  // RING ROAD around the polo oval
  // These run between the safety zone edge and the inner villa columns
  // West ring road: between x=-148 (safety zone) and x=-162 (inner villa col)
  // From measurements: ring road W at x=-230 seems too far - use x=-152
  s(plane(10, 200, am, [-152, Y, 0]));   // W ring (N-S run beside W safety zone)
  s(plane(10, 200, am, [152, Y, 0]));    // E ring (N-S run beside E safety zone)
  s(plane(310, 10, am, [0, Y, -95]));    // N ring (E-W run north of field)
  s(plane(310, 10, am, [0, Y, 95]));     // S ring (E-W run south of field)
  // Corner sweeps
  for (const [cx,cz] of [[-145,-90],[145,-90],[-145,90],[145,90]])
    s(plane(18,18,am,[cx,Y,cz]));

  // INTERNAL VILLA ACCESS ROAD (between inner and outer villa columns)
  s(plane(8, 220, am, [-174, Y, -5]));   // between W inner (x=-162) and outer (x=-185)
  s(plane(8, 220, am, [174, Y, -5]));    // between E inner (x=+162) and outer (x=+185)

  // NORTH ARC ACCESS ROADS (between north tier villas and lake)
  // Between N Tier1 (z=-97) and lake south edge (z=-112)
  s(plane(320, 8, am, [0, Y, -105]));    // setback road between Tier1 villas and lake
  // Between Tier2 and Tier3 north villas
  s(plane(300, 8, am, [0, Y, -130]));

  // SOUTH INTERNAL ROAD (behind south villas, north of Lagos Road)
  s(plane(420, 10, am, [0, Y, 130]));
  // Clubhouse forecourt / approach
  s(plane(130, 35, am, [0, Y, 148]));

  // WEST COMPOUND ROADS
  s(plane(10, 280, am, [-270, Y, 20]));  // main N-S road through west compound
  s(plane(10, 200, am, [-230, Y, 10]));  // secondary N-S between lofts and flats
  s(plane(160, 10, am, [-300, Y, 130])); // E-W access to stables/services

  // EAST COMPOUND ROAD
  s(plane(10, 240, am, [200, Y, 10]));   // E boundary road
  s(plane(55, 10, am, [215, Y, 120]));   // access to commercial block

  // GREEN LANDSCAPE STRIPS between ring road and villa columns
  const gm = MAT_GRASS_FIELD();
  // North green setback (between N ring road and Tier1 villas)
  s(plane(320, 8, am, [0, .11, -100]));  // road
  // West landscaping between ring road and inner villa column
  s(plane(8, 200, new THREE.MeshStandardMaterial({color:0x3a7a28,roughness:.9}), [-157, .11, 0]));
  s(plane(8, 200, new THREE.MeshStandardMaterial({color:0x3a7a28,roughness:.9}), [157, .11, 0]));
}

//        MAIN LAKE (north, between safety zone and Tier1 villas)                                                       
// Centre: x=-10, z=-78. Spans x=-262 to +243, z=-103 to -53
function addLake() {
  const wm = MAT_WATER();
  // Main body
  const lb = new THREE.Mesh(new THREE.BoxGeometry(200, .3, 28), wm);
  lb.position.set(-10, .15, -78); lb.receiveShadow = true; scene.add(lb); waterMeshes.push(lb);
  // West cap
  const lw = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 4), wm);
  lw.position.set(-110, .05, -78); lw.scale.set(1, .2, 1); scene.add(lw); waterMeshes.push(lw);
  // East cap
  const le = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 4), wm);
  le.position.set(90, .05, -78); le.scale.set(1, .2, 1); scene.add(le); waterMeshes.push(le);
  // Shore grass on both sides
  const sm2 = new THREE.MeshStandardMaterial({color:0x3a7a28,roughness:.9});
  s(plane(230, 6, sm2, [-10, .11, -68]));   // south shore (field side)
  s(plane(230, 6, sm2, [-10, .11, -90]));   // north shore (villa side)
  // Ripples
  const rm = new THREE.MeshStandardMaterial({color:0x8ed4e8,roughness:.1,transparent:true,opacity:.2});
  for (let i=0;i<4;i++) s(box(170-i*12,.04,.35,rm,[-10,.32+i*.02,-76+i*1.5],0,false));
}

//        EAST WATER BODY (small lake, east boundary)                                                                                           
function addEastLake() {
  const wm = MAT_WATER();
  const el = new THREE.Mesh(new THREE.BoxGeometry(10, .25, 40), wm);
  el.position.set(218, .12, -50); el.receiveShadow = true; scene.add(el); waterMeshes.push(el);
}

//        CLUBHOUSE (centred on field axis x=0, south of field at z=+152)                               
function addClubhouse() {
  const g = new THREE.Group(); g.position.set(0, 0, 152);
  const cm=MAT_CONCRETE(), gm=MAT_GLASS(.48), gw=MAT_GLASS_WARM(.55);
  const tm=MAT_TIMBER(), wm=MAT_WHITE_TRIM(), dm=MAT_DARK_METAL(), gld=MAT_GOLD();

  g.add(box(115,4.8,24,cm,[0,2.4,0]));
  // Bleachers face north (toward field, in -Z direction from clubhouse position)
  for (let i=0;i<8;i++)
    g.add(box(92,.45,2.2,new THREE.MeshStandardMaterial({color:0xd0c8b8,roughness:.7}),
      [0,.55+i*.52,-11.5+i*1.55],0,false));
  for (let x=-48;x<=48;x+=12) g.add(box(1.1,5.2,1.1,cm,[x,2.7,-12.2]));
  g.add(box(122,4.6,25,cm,[0,7.3,.5]));
  g.add(box(110,3.4,.45,gw,[0,7.3,-12.4]));
  g.add(box(110,.95,.3,gld,[0,5.3,-12.5],0,false));
  for (const ux of [-35,0,35]) addUmbrella(g,[ux,5.9,-9]);
  g.add(box(130,4.4,26,cm,[0,12.1,1.0]));
  g.add(box(118,3.4,.45,gm,[0,12.1,-12.6]));
  // Slab overhangs
  g.add(box(134,.65,28,wm,[0,4.85,1.0],0,false));
  g.add(box(136,.65,29,wm,[0,9.65,1.0],0,false));
  g.add(box(138,.65,29,wm,[0,14.55,1.0],0,false));
  for (let x=-54;x<=54;x+=12) {
    g.add(box(.7,4.5,.7,wm,[x,7.3,-12.4]));
    g.add(box(.7,4.3,.7,wm,[x,12.1,-12.5]));
  }
  for (const side of [-46,46]) {
    g.add(box(16,6.5,16,cm,[side,18.0,.5]));
    g.add(box(17.5,.7,17.5,wm,[side,21.5,.5],0,false));
  }
  g.add(box(14,5.2,1.0,tm,[0,2.6,-12.8]));
  // Parking both sides
  s(plane(55,28,MAT_ASPHALT(),[-65,.12,175]));
  s(plane(55,28,MAT_ASPHALT(),[65,.12,175]));
  scene.add(g);
}
function addUmbrella(parent,pos) {
  const g=new THREE.Group(); g.position.set(...pos);
  g.add(cyl(.08,.08,3.0,6,MAT_GOLD(),[0,1.5,0]));
  g.add(cyl(3.2,3.6,.45,16,new THREE.MeshStandardMaterial({color:0xf0e8d8,roughness:.7}),[0,3.2,0]));
  parent.add(g);
}

//        VILLA RING                                                                                                                                                                                              
// All positions from pixel measurements. SINGLE villa per plot position.
// Inner columns: W x=-162, E x=+162 (just outside safety zone at x=+-148)
// Outer columns: W x=-185, E x=+185
// Spacing: 18m between villas (one villa per plot, no doubling)

function addVillaRing() {
  //        WEST INNER COLUMN: x=-162, z=-81 to +81 (9 villas, 18m spacing)       
  for (let i=0;i<9;i++) placeVilla(-162, -72+i*18, Math.PI/2);

  //        WEST OUTER COLUMN: x=-185, z=-72 to +72 (staggered +9m, 8 villas)       
  for (let i=0;i<8;i++) placeVilla(-185, -63+i*18, Math.PI/2);

  //        EAST INNER COLUMN: x=+162, 9 villas       
  for (let i=0;i<9;i++) placeVilla(162, -72+i*18, -Math.PI/2);

  //        EAST OUTER COLUMN: x=+185, 8 villas (staggered)       
  for (let i=0;i<8;i++) placeVilla(185, -63+i*18, -Math.PI/2);

  //        NORTH TIER 1: directly on safety zone north edge (z=-97)       
  // Split around lake: W group x=-140 to -20, E group x=+50 to +170
  // Lake spans roughly x=-110 to +90 at z=-78, so gap at x=-16 to +50
  [-140,-116,-92,-68,-44,-20].forEach(x => placeVilla(x, -97, 0));
  [52,76,100,124,148,172].forEach(x => placeVilla(x, -97, 0));

  //        NORTH TIER 2 (lakefront): z=-120, flanking lake (no villas over lake)       
  // Lake W extent ~ x=-110, E extent ~ x=+90
  [-140,-116,-92].forEach(x => placeVilla(x, -122, 0));
  [100,124,148].forEach(x => placeVilla(x, -122, 0));

  //        SOUTH ARC: 5 SW + 5 SE, face north (ry=0), gap at centre for clubhouse       
  // Start at x=+-20 (close to axis), step out 22m
  for (const side of [-1,1]) {
    [20,42,64,86,108].forEach((xabs,i) => {
      const x = side * xabs;
      const z = 97 + Math.abs(x) * 0.04;
      placeVilla(x, z, 0);
    });
  }
}

function placeVilla(x, z, ry) {
  // Use GLB mesh (loads async, queued if not ready)
  placeVillaGLB(x, z, ry);
  // Landscaping is synchronous (hedges, gate posts, driveway)
  addPlotLandscaping(x, z, ry);
}

function addPlotLandscaping(vx, vz, ry) {
  const hm = new THREE.MeshStandardMaterial({color:0x2a5a20,roughness:.95});
  const gm2 = new THREE.MeshStandardMaterial({color:0x8a7050,roughness:.7,metalness:.2});
  const pm = new THREE.MeshStandardMaterial({color:0xd0c8b4,roughness:.8});
  const g = new THREE.Group(); g.position.set(vx,0,vz); g.rotation.y=ry;
  // Side hedges (on ground)
  const hl = new THREE.Mesh(new THREE.BoxGeometry(.4,1.2,16),hm);
  hl.position.set(-9.5,.6,0); hl.receiveShadow=true; hl.castShadow=true; g.add(hl);
  const hr=hl.clone(); hr.position.set(9.5,.6,0); g.add(hr);
  // Front hedge
  const hf = new THREE.Mesh(new THREE.BoxGeometry(18,.7,.4),hm);
  hf.position.set(0,.35,-9.2); hf.receiveShadow=true; g.add(hf);
  // Gate posts
  for (const gx of [-2.5,2.5]) {
    const gp = new THREE.Mesh(new THREE.BoxGeometry(.32,1.5,.32),gm2);
    gp.position.set(gx,.75,-9.5); gp.castShadow=true; g.add(gp);
  }
  // Driveway
  const dp = new THREE.Mesh(new THREE.PlaneGeometry(4.8,4.8),pm);
  dp.rotation.x=-Math.PI/2; dp.position.set(0,.02,-7.5); dp.receiveShadow=true; g.add(dp);
  scene.add(g);
}

function createVillaFallback() {
  const g = new THREE.Group();
  const cm=MAT_CONCRETE(), tm=MAT_TIMBER();
  const gm=MAT_GLASS(.52), gw=MAT_GLASS_WARM(.6);
  const wm=MAT_WHITE_TRIM(), dm=MAT_DARK_METAL();
  const charcoal = new THREE.MeshStandardMaterial({color:0x404040,roughness:.8});
  const led = new THREE.MeshStandardMaterial({color:0xffffff,emissive:new THREE.Color(0xffffff),emissiveIntensity:.8,roughness:.2});

  const addB=(w,h,d,m,p,r=0,sh=true)=>g.add(box(w,h,d,m,p,r,sh));
  const addC=(rt,rb,h,seg,m,p)=>g.add(cyl(rt,rb,h,seg,m,p));

  addB(16.5,3.4,13.5,cm,[0,1.7,0]);
  addB(11.5,3.0,.3,dm,[.5,1.7,-7.1]);
  for (const cx of [-6.5,6.5]) addC(.22,.22,3.4,10,dm,[cx,1.7,-6.5]);
  addB(19,.55,15.5,wm,[0,3.48,0],0,false);
  addB(17.5,3.5,14,cm,[0,5.05,0]);
  addB(5.5,3.3,.5,charcoal,[-5,5.05,-7.3]);
  addB(5.0,3.1,.55,tm,[.5,5.05,-7.4]);
  addB(4.5,3.1,.4,gw,[4.5,5.05,-7.35]);
  addB(15,.85,.3,MAT_GLASS(.38),[0,3.55,-7.25],0,false);
  addB(19.5,.55,15.5,wm,[0,7.15,0],0,false);
  addB(18.5,3.3,14.5,cm,[0,8.7,0]);
  addB(15,3.1,.55,tm,[0,8.7,-7.6]);
  addB(13,2.8,.35,gw,[0,8.7,-7.2]);
  addB(16,.8,.3,MAT_GLASS(.35),[0,7.2,-7.5],0,false);
  addB(20,.65,16,wm,[0,10.85,0],0,false);
  addB(20.4,.18,.2,led,[0,10.96,-8.05],0,false);
  return g;
}

//        LOFT TERRACES (NORTH crescent rows + west compound blocks)                                                 
// North rows: two E-W rows outside the north villa arc, z=-130 and z=-145
// West compound: two short E-W blocks, x=-285, z=-38 and z=+29

function addLoftTerraces() {
  // NORTH CRESCENT ROW 1 (inner, z=-130, gap for lake x=-110 to +90)
  for (let x=-200; x<=200; x+=24) {
    if (x > -115 && x < 95) continue;  // gap over lake width
    s(createLoftBlock(x, -130, Math.PI)); // face south
  }
  // NORTH CRESCENT ROW 2 (outer, z=-148, similar gap)
  for (let x=-210; x<=210; x+=24) {
    if (x > -115 && x < 95) continue;
    s(createLoftBlock(x, -148, Math.PI));
  }
  // WEST COMPOUND upper loft block (x=-285, z=-38)
  s(createLoftBlock(-285, -38, -Math.PI/2));
  // WEST COMPOUND lower loft block (x=-285, z=+29)
  s(createLoftBlock(-285, 29, -Math.PI/2));
}

// Single loft terrace block (4 units, 24m E-W, from architectural drawings)
function createLoftBlock(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x,0,z); g.rotation.y=ry;
  const sm=MAT_STONE(), cm=MAT_CONCRETE(), tm=MAT_TIMBER();
  const gw=MAT_GLASS_WARM(.62), wm=MAT_WHITE_TRIM(), dm=MAT_DARK_METAL();
  const tileM=MAT_TILE_ROOF();
  const UNITS=4, UW=6.0, UD=12.0, GD=5.5;
  const TW=UNITS*UW;
  for (let u=0;u<UNITS;u++) {
    const ux=-TW/2+UW/2+u*UW;
    // Ground floor (gabion stone)
    g.add(box(UW-0.3,3.2,UD,sm,[ux,1.6,0]));
    // Timber slatted garage screen on front face
    for (let sl=0;sl<12;sl++) {
      const sx2=ux-UW/2+.25+sl*((UW-.5)/11);
      g.add(box(.06,2.7,.08,tm,[sx2,1.5,-UD/2-.04]));
    }
    // Ground floor window
    g.add(box(UW*.5,2.1,.06,gw,[ux,1.6,-UD/2-.03]));
    // First floor (concrete render)
    g.add(box(UW-0.3,3.2,UD,cm,[ux,4.9,0]));
    // Upper floor windows
    g.add(box(UW*.55,2.4,.06,gw,[ux,4.9,-UD/2-.03]));
    // Party wall piers (full height)
    if (u<UNITS-1) {
      g.add(box(.3,7,.2,wm,[ux+UW/2,3.5,-UD/2]));
    }
  }
  // Flat roof slab
  g.add(box(TW+.4,.18,UD+.4,wm,[0,6.55,0],0,false));
  // Parapet
  g.add(box(TW+.4,.4,.2,wm,[0,6.8,-UD/2-.1],0,false));
  // Floor slab between levels
  g.add(box(TW,.2,UD,cm,[0,3.28,0],0,false));
  return g;
}

//        WEST COMPOUND                                                                                                                                                                                        
// Training field at x=-390, z=0. Blocks of flats at x=-310, HORIZONTAL (E-W)
function addWestCompound() {
  const gm=MAT_GRASS_FIELD(), dm=MAT_DIRT();
  const lm=new THREE.MeshStandardMaterial({color:0xf0ecd0,roughness:.5});

  // Training field (N-S: 100m E-W x 160m N-S)
  s(plane(120, 185, dm, [-390, .06, 0]));
  s(plane(100, 160, gm, [-390, .10, 0]));
  for (const z2 of [-55,0,55]) s(box(100,.05,.4,lm,[-390,.15,z2],0,false));

  // Blocks of flats: HORIZONTAL (80m E-W x 28m N-S), two blocks side by side N-S
  // x=-310 (pixel-derived), N block z=-29, S block z=+29
  s(createFlatBlock(-310, -29));
  s(createFlatBlock(-310,  29));
}

// APARTMENT BLOCK: 80m E-W x 28m N-S, 5 res floors, wave parapet crown
function createFlatBlock(x, z) {
  const g = new THREE.Group(); g.position.set(x,0,z);
  const BW=80, BD=28, fH=3.4, FLOORS=5, GH=3.4;
  const RY=GH+FLOORS*fH; // =20.4m
  const cm=MAT_CONCRETE(), tm=MAT_TIMBER(), dm=MAT_DARK_METAL();
  const gw=MAT_GLASS_WARM(.5), wm=MAT_WHITE_TRIM();

  // Ground podium (parking)
  g.add(box(BW,GH,BD,cm,[0,GH/2,0]));
  // Garage shutters on south face (4 bays)
  const shutM=new THREE.MeshStandardMaterial({color:0x606060,roughness:.8});
  for (const sx2 of [-27,-9,9,27]) g.add(box(9.5,2.9,.12,shutM,[sx2,1.5,BD/2]));
  // Ground columns
  for (let cx=-36;cx<=36;cx+=3.2) g.add(box(.35,GH,.35,wm,[cx,GH/2,BD/2]));

  // Dark core towers at x=+-20
  const coreM=new THREE.MeshStandardMaterial({color:0x282c2a,roughness:.7,metalness:.1});
  for (const cx of [-20,20]) g.add(box(4.0,RY+.5,BD+.5,coreM,[cx,(RY+.5)/2,0]));

  // Residential floors 1-5
  for (let f=0;f<FLOORS;f++) {
    const fy=GH+f*fH, fm=fy+fH/2;
    // Floor slab
    g.add(box(BW+2.2,.2,BD+2.2,wm,[0,fy,0]));
    // East wing
    g.add(box(35,fH-.2,BD,cm,[-29.5,fm,0]));
    // West wing
    g.add(box(35,fH-.2,BD,cm,[29.5,fm,0]));
    // Centre
    g.add(box(34,fH-.2,BD,cm,[0,fm,0]));
    // South spandrel
    g.add(box(BW,.85,.22,wm,[0,fy+.42,BD/2]));
    // South windows
    for (let bx=-38;bx<=38;bx+=3.2) {
      if (Math.abs(bx-(-20))<3||Math.abs(bx-20)<3) continue;
      g.add(box(2.6,2.4,.08,gw,[bx,fy+fH*.62,BD/2]));
    }
    // Balcony slab (south face, 1.2m projection)
    g.add(box(BW-8,.15,1.2,wm,[0,fy+.14,BD/2+.6]));
    g.add(box(BW-8,.85,.05,MAT_GLASS(.35),[0,fy+.52,BD/2+1.2]));
    g.add(box(BW-8,.06,.06,dm,[0,fy+.96,BD/2+1.2]));
    // Dark fin panels on sides
    const finM=new THREE.MeshStandardMaterial({color:0x252a28,roughness:.6,metalness:.1});
    for (const bx of [-38,-28,28,38]) g.add(box(.14,fH-.3,BD*.3,finM,[bx,fm,BD/2-BD*.15]));
  }
  // Eave
  g.add(box(BW+3,.22,BD+3,wm,[0,RY-.1,0]));
  // WAVE PARAPET SCULPTURE (two wings + recessed centre)
  const pM=new THREE.MeshStandardMaterial({color:0x909090,roughness:.55,metalness:.1});
  const lw=box(9,2.2,6,pM,[-10,RY+1.1,-2]); lw.rotation.z=.08; g.add(lw);
  const rw=box(9,2.2,6,pM,[10,RY+1.1,-2]); rw.rotation.z=-.08; g.add(rw);
  g.add(box(5,1.4,6,pM,[0,RY+.7,-2]));
  g.add(box(25,.4,7,pM,[0,RY+.2,-2]));
  // Parapets
  g.add(box(BW+.4,.75,.28,wm,[0,RY+.37,-BD/2]));
  g.add(box(BW+.4,.75,.28,wm,[0,RY+.37,BD/2]));
  g.add(box(.28,.75,BD,wm,[-BW/2,RY+.37,0]));
  g.add(box(.28,.75,BD,wm,[BW/2,RY+.37,0]));
  // South landscape trees
  const trunkM2=new THREE.MeshStandardMaterial({color:0x5c3c18,roughness:.85});
  const leafM2=new THREE.MeshStandardMaterial({color:0x2a5e18,roughness:.9});
  for (let tx=-36;tx<=36;tx+=6) {
    g.add(cyl(.1,.16,4.2,8,trunkM2,[tx,2.1,BD/2+7]));
    const cr=new THREE.Mesh(new THREE.SphereGeometry(1.6,8,6),leafM2);
    cr.position.set(tx,5.2,BD/2+7); cr.castShadow=true; g.add(cr);
  }
  // External parking
  g.add(plane(BW,.01,MAT_ASPHALT(),[0,.12,BD/2+14]));
  scene.add(g); return g;
}

//        STABLES (SW, x=-380, z=+95)                                                                                                                                        
function addStables() {
  s(plane(60,42,MAT_STONE(),[-360,.07,95]));
  [[-375,85],[-375,100],[-345,85],[-345,100]].forEach(([x,z])=>scene.add(createStableBlock(x,z)));
}
function createStableBlock(x,z) {
  const g=new THREE.Group(); g.position.set(x,0,z);
  const bm=MAT_BRICK(), tm=MAT_TILE_ROOF(), timM=MAT_TIMBER(), dm=MAT_DARK_METAL();
  const xm=new THREE.MeshStandardMaterial({color:0x5c3818,roughness:.8});
  g.add(box(36,4.2,13,bm,[0,2.1,0]));
  const rL=box(38,.45,17,tm,[0,4.7,0]); rL.rotation.z=.17; g.add(rL);
  const rR=box(38,.45,17,tm,[0,4.7,0]); rR.rotation.z=-.17; g.add(rR);
  g.add(box(38,.28,.28,timM,[0,6.1,0]));
  for (let i=0;i<6;i++) {
    const sx2=-12+i*5;
    g.add(box(4.6,3.6,.38,timM,[sx2,2.1,-6.7]));
    g.add(box(3.0,.26,.45,xm,[sx2,1.7,-6.75],.7));
    g.add(box(3.0,.26,.45,xm,[sx2,1.7,-6.75],-.7));
  }
  for (let px=-15;px<=15;px+=6) g.add(cyl(.16,.16,4.5,8,dm,[px,2.25,-7]));
  return g;
}

//        PADDOCK & RECREATION (east)                                                                                                                                           
function addPaddockEast() {
  const gm=MAT_GRASS_FIELD();
  s(plane(40,38,gm,[220,.07,0]));
  const fpm=new THREE.MeshStandardMaterial({color:0x8c7050,roughness:.8});
  const frm=new THREE.MeshStandardMaterial({color:0xfcfaf5,roughness:.65});
  for (let fz=-19;fz<=19;fz+=5) { s(box(.26,1.6,.26,fpm,[200,.85,fz])); s(box(.26,1.6,.26,fpm,[240,.85,fz])); }
  for (let fx=200;fx<=240;fx+=5) { s(box(.26,1.6,.26,fpm,[fx,.85,-19])); s(box(.26,1.6,.26,fpm,[fx,.85,19])); }
  s(box(.08,.08,38,frm,[200,1.5,0],0,false)); s(box(.08,.08,38,frm,[240,1.5,0],0,false));
  s(box(40,.08,.08,frm,[220,1.5,-19],0,false)); s(box(40,.08,.08,frm,[220,1.5,19],0,false));
  // Green area north of paddock
  s(plane(50,48,gm,[220,.07,-50]));
}

function addGamePark() {
  s(plane(54,44,MAT_GRASS_FIELD(),[220,.07,52]));
  const cols=[0xe8602a,0x2a88c8,0xe8c82a,0x4ac84a];
  for (let i=0;i<5;i++) {
    const h=2.6+i*.4;
    s(box(3.2,h,3.2,new THREE.MeshStandardMaterial({color:cols[i%4],roughness:.6}),[205+i*7,h/2,50+(i%2)*8]));
  }
}

function addCommercialBlock() {
  const g=new THREE.Group(); g.position.set(270,0,65);
  const cm=MAT_CONCRETE(), gm=MAT_GLASS(.5), wm=MAT_WHITE_TRIM();
  g.add(box(42,9,26,cm,[0,4.5,0]));
  g.add(box(42,.55,28,wm,[0,9.3,0],0,false));
  g.add(box(.4,8.5,22,gm,[-21.2,4.5,0]));
  for (let cz=-9;cz<=9;cz+=4.5) g.add(box(.6,3.5,.6,cm,[-21,1.75,cz]));
  scene.add(g);
}

function addServiceCompound() {
  const cm=MAT_CONCRETE();
  const svc=new THREE.MeshStandardMaterial({color:0xcc2200,roughness:.7});
  s(box(16,5.0,13,svc,[-270,2.5,95]));
  s(box(17.5,.5,14.5,new THREE.MeshStandardMaterial({color:0xaa1800,roughness:.7}),[-270,5.1,95],0,false));
  s(box(30,6,17,cm,[-240,3,100]));
  s(box(12,4,10,cm,[-220,2,88]));
  s(plane(28,18,MAT_ASPHALT(),[-310,.12,100]));
}

//        PALM SPRITES                                                                                                                                                                                     
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
function addPalmSprite(x,z,scale=1) {
  initPalmMats();
  const mat=palmMats[Math.floor(Math.random()*palmMats.length)];
  const h=(14+Math.random()*6)*scale, w=h*.5;
  for (const ry of [0,Math.PI/2]) {
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);
    m.position.set(x,h/2,z); m.rotation.y=ry; scene.add(m); palmSprites.push(m);
  }
}
function addPalmSprites() {
  // Lake shores
  for (let x=-90;x<=80;x+=16) { addPalmSprite(x,-68,1.1); addPalmSprite(x,-90,1.0); }
  // Clubhouse
  [[-120,148],[120,148],[-75,148],[75,148]].forEach(([x,z])=>addPalmSprite(x,z,1.2));
  // Stables
  [[-360,82],[-390,82],[-365,110]].forEach(([x,z])=>addPalmSprite(x,z,1.0));
}
function addPerimeterTrees() {
  initPalmMats();
  for (let x=-280;x<=280;x+=13) {
    addPalmSprite(x,-165,.85+Math.random()*.3);
    addPalmSprite(x,185,.85+Math.random()*.3);
  }
  for (let z=-160;z<=180;z+=15) {
    addPalmSprite(-295,z,.9+Math.random()*.25);
    addPalmSprite(295,z,.9+Math.random()*.25);
  }
}

//        TICK                                                                                                                                                                                                             
export function tickScene(elapsedTime, camera) {
  waterMeshes.forEach(m=>{
    if (m.material&&m.material.normalMap) {
      m.material.normalMap.offset.x=elapsedTime*.018;
      m.material.normalMap.offset.y=elapsedTime*.012;
    }
  });
  palmSprites.forEach(s=>{
    s.rotation.y=Math.atan2(camera.position.x-s.position.x,camera.position.z-s.position.z);
  });
}

export function getRenderer() { return renderer; }
export function getScene()    { return scene;    }
export function getCamera()   { return camera;   }
export function getClock()    { return clock;    }
