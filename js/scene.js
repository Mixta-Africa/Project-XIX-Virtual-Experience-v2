/**
 * Project XIX — High-Fidelity Scene (v2)
 * PBR textures, animated water normals, grass cards, ACES tonemapping.
 * Orientation: E-W field, lake N (-Z), clubhouse S (+Z).
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
  scene.fog = new THREE.FogExp2(0x9ac5d4, 0.0018);

  camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1400);

  buildLighting();
  buildSky();
  buildEnvironment();

  return { scene, renderer, camera, clock };
}

/* ── LIGHTING ─────────────────────────────────────────────────── */

function buildLighting() {
  scene.add(new THREE.HemisphereLight(0xd4e8ff, 0x4a6a30, 1.6));

  const sun = new THREE.DirectionalLight(0xffe4a0, 3.8);
  sun.position.set(-180, 200, 120);
  sun.castShadow = true;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -350;
  sun.shadow.camera.right = sun.shadow.camera.top = 350;
  sun.shadow.camera.far  = 800;
  sun.shadow.mapSize.set(8192, 8192);
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3.5;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xb8d0e8, 0.7);
  fill.position.set(120, 80, -100);
  scene.add(fill);

  const bounce = new THREE.DirectionalLight(0x6a9050, 0.25);
  bounce.position.set(0, -1, 0);
  scene.add(bounce);

  [[-40,8,160],[0,8,160],[40,8,160]].forEach(p => {
    const pt = new THREE.PointLight(0xffe0a0, 2.5, 55, 2);
    pt.position.set(...p); scene.add(pt);
  });
  [[-220,3,235],[-200,3,225]].forEach(p => {
    const pt = new THREE.PointLight(0xff8c40, 1.8, 40, 2);
    pt.position.set(...p); scene.add(pt);
  });
}

/* ── SKY ──────────────────────────────────────────────────────── */

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
  sunMesh.position.set(-320, 340, 200);
  scene.add(sunMesh);

  // Clouds
  const cmat = new THREE.MeshBasicMaterial({ color: 0xfdfcfa, transparent: true, opacity: 0.72, side: THREE.DoubleSide });
  [[-180,260,-300],[60,280,-350],[220,250,-280],[-320,240,-180],[140,270,-400]].forEach(([x,y,z]) => {
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(30 + Math.random()*28, 8, 5), cmat);
      m.scale.y = 0.3;
      m.position.set(x+(Math.random()-.5)*80, y+Math.random()*12, z+(Math.random()-.5)*50);
      scene.add(m);
    }
  });
}

/* ── GEOMETRY HELPERS ─────────────────────────────────────────── */

function box(w, h, d, mat, pos=[0,0,0], ry=0, shadow=true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(...pos); m.rotation.y = ry;
  m.castShadow = shadow && h > 0.3; m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, seg, mat, pos=[0,0,0]) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(...pos); m.castShadow = m.receiveShadow = true;
  return m;
}
function add(...objs) { objs.forEach(o => o && scene.add(o)); }

/* ── ENVIRONMENT ─────────────────────────────────────────────── */

function buildEnvironment() {
  addGround(); addPoloField(); addSafetyZone(); addYardMarkings();
  addLake(); addRoads(); addClubhouse(); addVillaRing();
  addLoftApartments(); addBlocksOfFlats(); addNorthLoftRow();
  addTrainingField(); addStables(); addPaddockEast(); addGamePark();
  addCommercialBlock(); addServiceCompound();
  addGrassCards(); addRoyalPalms(); addPerimeterTrees();
}

/* ── GROUND ───────────────────────────────────────────────────── */

function addGround() {
  const dirt = new THREE.Mesh(new THREE.PlaneGeometry(700, 600), MAT_DIRT());
  dirt.rotation.x = -Math.PI / 2; dirt.position.set(0, 0, 30);
  dirt.receiveShadow = true; scene.add(dirt);

  const gOver = new THREE.Mesh(new THREE.PlaneGeometry(500, 400), MAT_GRASS_FIELD());
  gOver.rotation.x = -Math.PI / 2; gOver.position.set(0, 0.01, 0);
  gOver.receiveShadow = true; scene.add(gOver);
}

/* ── POLO FIELD ───────────────────────────────────────────────── */

function addPoloField() {
  const sc = document.createElement("canvas");
  sc.width = 1024; sc.height = 512;
  const ctx = sc.getContext("2d");
  for (let i = 0; i < 14; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#5a9448" : "#4a8038";
    ctx.fillRect(0, i * (512/14), 1024, 512/14 + 1);
  }
  const st = new THREE.CanvasTexture(sc);
  st.colorSpace = THREE.SRGBColorSpace;
  st.wrapS = st.wrapT = THREE.RepeatWrapping;

  const fm = MAT_GRASS_FIELD(); fm.map = st; fm.roughness = 0.92;
  const field = new THREE.Mesh(new THREE.BoxGeometry(274, 0.2, 146), fm);
  field.position.set(0, 0.1, 0); field.receiveShadow = true; scene.add(field);

  const lm = new THREE.MeshStandardMaterial({ color: 0xf8f5e0, roughness: 0.4 });
  add(box(0.5,0.22,146, lm,[0,0.21,0],0,false), box(274,0.22,0.5, lm,[0,0.21,0],0,false));
}

function addSafetyZone() {
  const dm = MAT_DIRT();
  add(box(298,0.15,25,dm,[0,0.07,-85.5],0,false), box(298,0.15,25,dm,[0,0.07,85.5],0,false),
      box(22,0.15,146,dm,[-148,0.07,0],0,false), box(22,0.15,146,dm,[148,0.07,0],0,false));
}

function addYardMarkings() {
  const lm = new THREE.MeshStandardMaterial({ color: 0xf5f0d5, roughness: 0.4 });
  for (const side of [-1,1]) for (const d of [24.5,36.5,55])
    add(box(0.45,0.22,146,lm,[side*(137-d),0.21,0],0,false));
}

/* ── LAKE (animated) ─────────────────────────────────────────── */

function addLake() {
  const wm = MAT_WATER();
  const parts = [
    new THREE.Mesh(new THREE.BoxGeometry(200,0.35,28), wm),
    new THREE.Mesh(new THREE.CylinderGeometry(20,20,0.35,24,1,false,0,Math.PI), wm),
    new THREE.Mesh(new THREE.CylinderGeometry(20,20,0.35,24,1,false,0,Math.PI), wm),
  ];
  parts[0].position.set(0,0.17,-115);
  parts[1].position.set(-100,0.17,-115);
  parts[2].position.set(100,0.17,-115);
  parts.forEach(p => { p.receiveShadow=true; scene.add(p); waterMeshes.push(p); });

  const bm = MAT_DIRT();
  add(box(210,0.3,4,bm,[0,0.15,-102],0,false), box(210,0.3,4,bm,[0,0.15,-128],0,false));
}

/* ── ROADS ────────────────────────────────────────────────────── */

function addRoads() {
  const am = MAT_ASPHALT();
  const lm = new THREE.MeshStandardMaterial({ color: 0xf5f0d0, roughness: 0.5 });

  function road(w, d, x, z) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), am);
    m.rotation.x = -Math.PI/2; m.position.set(x,0.13,z);
    m.receiveShadow = true; scene.add(m);
  }

  road(600,18,0,195); road(500,10,0,-158); road(10,60,0,-185);
  road(380,10,0,180); road(10,300,-190,40); road(10,280,200,20);
  road(60,30,0,175);

  for (let x = -270; x <= 270; x += 18)
    add(box(8,0.15,0.38,lm,[x,0.26,195],0,false));
}

/* ── CLUBHOUSE ────────────────────────────────────────────────── */

function addClubhouse() {
  const g = new THREE.Group(); g.position.set(0,0,155);
  const cm  = MAT_CONCRETE();
  const gm  = MAT_GLASS(0.48);
  const gw  = MAT_GLASS_WARM(0.55);
  const tm  = MAT_TIMBER();
  const wm  = MAT_WHITE_TRIM();
  const dm  = MAT_DARK_METAL();
  const gld = MAT_GOLD();

  g.add(box(115,4.8,24,cm,[0,2.4,0]));
  for (let i=0;i<8;i++) g.add(box(92,0.45,2.2,
    new THREE.MeshStandardMaterial({color:0xd0c8b8,roughness:0.7}),
    [0,0.55+i*0.52,-11.5+i*1.55],0,false));
  for (let x=-48;x<=48;x+=12) g.add(box(1.1,5.2,1.1,cm,[x,2.7,-12.2]));

  g.add(box(122,4.6,25,cm,[0,7.3,0.5]));
  g.add(box(110,3.4,0.45,gw,[0,7.3,-12.4]));
  g.add(box(110,0.95,0.3,gld,[0,5.3,-12.5],0,false));
  for (const ux of [-35,0,35]) addUmbrella(g,[ux,5.9,-9]);

  g.add(box(130,4.4,26,cm,[0,12.1,1.0]));
  g.add(box(118,3.4,0.45,gm,[0,12.1,-12.6]));

  // Slab overhangs - key feature
  g.add(box(134,0.65,28,wm,[0,4.85,1.0],0,false));
  g.add(box(136,0.65,29,wm,[0,9.65,1.0],0,false));
  g.add(box(138,0.65,29,wm,[0,14.55,1.0],0,false));

  for (let x=-54;x<=54;x+=12) {
    g.add(box(0.7,4.5,0.7,wm,[x,7.3,-12.4]));
    g.add(box(0.7,4.3,0.7,wm,[x,12.1,-12.5]));
  }
  for (const side of [-46,46]) {
    g.add(box(16,6.5,16,cm,[side,18.0,0.5]));
    g.add(box(17.5,0.7,17.5,wm,[side,21.5,0.5],0,false));
  }
  g.add(box(14,5.2,1.0,tm,[0,2.6,-12.8]));
  g.add(box(2,5.2,0.5,dm,[-6,2.6,-12.9]));
  g.add(box(2,5.2,0.5,dm,[6,2.6,-12.9]));

  scene.add(g);
}

function addUmbrella(parent, pos) {
  const g = new THREE.Group(); g.position.set(...pos);
  g.add(cyl(0.08,0.08,3.0,6,MAT_GOLD(),[0,1.5,0]));
  g.add(cyl(3.2,3.6,0.45,16,new THREE.MeshStandardMaterial({color:0xf0e8d8,roughness:0.7}),[0,3.2,0]));
  parent.add(g);
}

/* ── VILLAS ───────────────────────────────────────────────────── */

function addVillaRing() {
  const s = 18;
  // North arc
  for (let i=0;i<12;i++) { const v=createVilla(); v.position.set(-99+i*s,0,-106); v.rotation.y=Math.PI; scene.add(v); }
  // South
  for (let i=0;i<10;i++) { const v=createVilla(); v.position.set(-81+i*s,0,102); scene.add(v); }
  // West
  for (let i=0;i<10;i++) { const v=createVilla(); v.position.set(-162,0,-81+i*s); v.rotation.y=Math.PI/2; scene.add(v); }
  // East
  for (let i=0;i<11;i++) { const v=createVilla(); v.position.set(162,0,-90+i*s); v.rotation.y=-Math.PI/2; scene.add(v); }
}

function createVilla() {
  const g = new THREE.Group();
  const cm = MAT_CONCRETE(); const tm = MAT_TIMBER();
  const gm = MAT_GLASS(0.52); const gw = MAT_GLASS_WARM(0.6);
  const wm = MAT_WHITE_TRIM(); const dm = MAT_DARK_METAL();
  const charcoal = new THREE.MeshStandardMaterial({color:0x404040,roughness:0.8});
  const ledMat   = new THREE.MeshStandardMaterial({
    color:0xffffff, emissive:new THREE.Color(0xffffff), emissiveIntensity:0.8, roughness:0.2 });

  // Ground/undercroft
  g.add(box(16.5,3.4,13.5,cm,[0,1.7,0]));
  g.add(box(11.5,3.0,0.3,dm,[0.5,1.7,-7.1]));
  for (const cx of [-6.5,6.5]) g.add(cyl(0.22,0.22,3.4,10,dm,[cx,1.7,-6.5]));

  // Slab
  g.add(box(19,0.55,15.5,wm,[0,3.48,0],0,false));

  // Floor 1
  g.add(box(17.5,3.5,14,cm,[0,5.05,0]));
  g.add(box(5.5,3.3,0.5,charcoal,[-5,5.05,-7.3]));
  g.add(box(5.0,3.1,0.55,tm,[0.5,5.05,-7.4]));
  g.add(box(4.5,3.1,0.4,gw,[4.5,5.05,-7.35]));
  g.add(box(15,0.85,0.3,MAT_GLASS(0.38),[0,3.55,-7.25],0,false));

  // Slab 2
  g.add(box(19.5,0.55,15.5,wm,[0,7.15,0],0,false));

  // Floor 2
  g.add(box(18.5,3.3,14.5,cm,[0,8.7,0]));
  g.add(box(15,3.1,0.55,tm,[0,8.7,-7.6]));
  g.add(box(13,2.8,0.35,gw,[0,8.7,-7.2]));
  g.add(box(16,0.8,0.3,MAT_GLASS(0.35),[0,7.2,-7.5],0,false));

  // Flat roof + LED trim
  g.add(box(20,0.65,16,wm,[0,10.85,0],0,false));
  g.add(box(20.4,0.18,0.2,ledMat,[0,10.96,-8.05],0,false));

  return g;
}

/* ── LOFT APARTMENTS ─────────────────────────────────────────── */

function addLoftApartments() {
  [[-88,208],[-40,213],[-88,228],[-40,233]].forEach(([x,z]) => scene.add(createLoftBlock(x,z,5)));
}

function createLoftBlock(x, z, units=5) {
  const g = new THREE.Group(); g.position.set(x,0,z);
  const W = units*7.6;
  const sm  = MAT_STONE(); const cm = MAT_CONCRETE();
  const tm  = MAT_TIMBER(); const gw = MAT_GLASS_WARM(0.62);
  const wm  = MAT_WHITE_TRIM(); const dm = MAT_DARK_METAL();

  g.add(box(W,3.4,11.5,sm,[0,1.7,0]));
  for (let i=0;i<units;i++) {
    const wx=-W/2+3.8+i*7.6;
    g.add(box(5.6,2.7,0.4,gw,[wx,1.7,-6.0]));
  }
  for (let i=0;i<=units;i++) {
    const fx=-W/2+i*7.6;
    g.add(box(0.18,1.9,3.5,tm,[fx,0.95,-8.0]));
    if (i<units) {
      g.add(box(7.4,0.12,0.12,tm,[fx+3.8,1.6,-8.0],0,false));
      g.add(box(7.4,0.12,0.12,tm,[fx+3.8,1.0,-8.0],0,false));
    }
  }
  g.add(box(W+2.5,0.6,13,wm,[0,3.38,0],0,false));
  g.add(box(W,3.5,12,cm,[0,5.25,0]));
  for (let i=0;i<units;i++) {
    const wx=-W/2+3.8+i*7.6;
    g.add(box(1.3,3.3,0.6,tm,[wx-2.5,5.25,-6.2]));
    g.add(box(4.8,2.9,0.4,gw,[wx+0.8,5.25,-6.45]));
    g.add(box(0.25,3.0,0.5,dm,[wx+3.2,5.25,-6.3]));
    const pt = new THREE.PointLight(0xffa060,1.2,12,2);
    pt.position.set(wx,0.6,-9); g.add(pt);
  }
  g.add(box(W+3,0.75,14,wm,[0,7.3,0],0,false));
  return g;
}

/* ── APARTMENT BLOCKS ─────────────────────────────────────────── */

function addBlocksOfFlats() {
  for (const xPos of [-52,52]) scene.add(createApartmentBlock(xPos,252));
}

function createApartmentBlock(x, z) {
  const g = new THREE.Group(); g.position.set(x,0,z);
  const BW=36, BD=17, floors=7, fH=3.45;
  const cm=MAT_CONCRETE(), tm=MAT_TIMBER();
  const gm=MAT_GLASS(0.5), gw=MAT_GLASS_WARM(0.52);
  const dm=MAT_DARK_METAL(), wm=MAT_WHITE_TRIM();

  for (let col=-15;col<=15;col+=7.5) g.add(box(0.9,3.8,0.9,cm,[col,1.9,0]));

  for (let f=1;f<=floors;f++) {
    const y=3.8+(f-1)*fH+fH/2;
    g.add(box(BW,fH-0.25,BD,cm,[0,y,0]));
    g.add(box(1.6,fH-0.3,BD+2.5,dm,[-BW/2-0.9,y,0]));
    g.add(box(1.6,fH-0.3,BD+2.5,dm,[BW/2+0.9,y,0]));
    g.add(box(7,fH-0.5,0.55,tm,[0,y,-BD/2-0.1]));
    g.add(box(BW-6,0.85,0.4,gm,[0,y-fH/2+0.4,-BD/2-0.35],0,false));
    g.add(box(BW+2,0.4,BD+2,wm,[0,y-fH/2,0],0,false));
    for (let wx=-13;wx<=13;wx+=6.5) {
      if (Math.abs(wx)<3) continue;
      g.add(box(5.0,2.6,0.4,gw,[wx,y,-BD/2-0.05]));
    }
  }

  // Wave roof canopy
  const roofY=3.8+floors*fH+3.2;
  for (const side of [-1,1]) {
    const wing=box(BW/2+4,0.9,10,wm,[side*(BW/4),roofY,0]);
    wing.rotation.z=side*0.14; g.add(wing);
  }
  g.add(box(8,0.7,10,wm,[0,roofY-1.4,0],0,false));
  for (const cx of [-14,0,14])
    g.add(box(0.4,3.5,0.4,wm,[cx,3.8+floors*fH+1.5,0]));

  scene.add(g); return g;
}

/* ── NORTH LOFT ROW ──────────────────────────────────────────── */

function addNorthLoftRow() {
  const cm=MAT_CONCRETE();
  const tm=MAT_TILE_ROOF();
  for (let x=-205;x<=205;x+=30) {
    if (Math.abs(x)<45) continue;
    const g=new THREE.Group(); g.position.set(x,0,-168);
    g.add(box(22,5.8,10.5,cm,[0,2.9,0]));
    g.add(box(24,0.65,12,tm,[0,6.05,0],0,false));
    g.add(box(16,4.0,0.4,MAT_GLASS(0.45),[0,2.9,5.6]));
    scene.add(g);
  }
}

/* ── TRAINING FIELD ──────────────────────────────────────────── */

function addTrainingField() {
  const gm=MAT_GRASS_FIELD(), dm=MAT_DIRT();
  const lm=new THREE.MeshStandardMaterial({color:0xf0ecd0,roughness:0.5});
  const s=new THREE.Mesh(new THREE.PlaneGeometry(124,188),dm);
  s.rotation.x=-Math.PI/2; s.position.set(-185,0.06,195); s.receiveShadow=true; scene.add(s);
  const f=new THREE.Mesh(new THREE.PlaneGeometry(100,160),gm);
  f.rotation.x=-Math.PI/2; f.position.set(-185,0.1,195); f.receiveShadow=true; scene.add(f);
  for (const z of [195-55,195,195+55]) add(box(100,0.22,0.5,lm,[-185,0.22,z],0,false));
}

/* ── STABLES ─────────────────────────────────────────────────── */

function addStables() {
  [[-220,232],[-220,213],[-202,222],[-202,241]].forEach(([x,z]) => scene.add(createStableBlock(x,z)));
  const sf=new THREE.Mesh(new THREE.PlaneGeometry(62,44),MAT_STONE());
  sf.rotation.x=-Math.PI/2; sf.position.set(-212,0.08,228); sf.receiveShadow=true; scene.add(sf);
}

function createStableBlock(x, z) {
  const g=new THREE.Group(); g.position.set(x,0,z);
  const bm=MAT_BRICK(), tm=MAT_TILE_ROOF(), timMat=MAT_TIMBER(), dm=MAT_DARK_METAL();
  const xMat=new THREE.MeshStandardMaterial({color:0x5c3818,roughness:0.8});

  g.add(box(42,4.4,15,bm,[0,2.2,0]));

  // Pitched tiled roof
  const roofL=box(44,0.5,19.5,tm,[0,4.85,0]); roofL.rotation.z=0.18; g.add(roofL);
  const roofR=box(44,0.5,19.5,tm,[0,4.85,0]); roofR.rotation.z=-0.18; g.add(roofR);
  g.add(box(44,0.3,0.3,timMat,[0,6.3,0]));

  // Exposed trusses
  for (let tx=-18;tx<=18;tx+=9) {
    g.add(box(0.25,5,0.25,timMat,[tx,4.5,-9]));
    g.add(box(0.25,5,0.25,timMat,[tx,4.5,9]));
    g.add(box(0.2,0.2,18,timMat,[tx,6.0,0]));
  }

  // Stall bays with X-braces
  for (let i=0;i<7;i++) {
    const sx=-18+i*6;
    g.add(box(5.2,3.8,0.4,timMat,[sx,2.2,-7.7]));
    g.add(box(3.4,0.28,0.5,xMat,[sx,1.8,-7.75],0.72));
    g.add(box(3.4,0.28,0.5,xMat,[sx,1.8,-7.75],-0.72));
    g.add(box(0.2,4.0,0.5,dm,[sx-3.1,2.2,-7.7]));
  }
  for (let px=-21;px<=21;px+=6) g.add(cyl(0.18,0.18,4.8,8,dm,[px,2.4,-8.0]));
  g.add(box(2.2,3.6,0.4,timMat,[22,2.2,-7.7]));

  return g;
}

/* ── PADDOCK & RECREATION ────────────────────────────────────── */

function addPaddockEast() {
  const gm=MAT_GRASS_FIELD(), dm=MAT_DIRT();
  const fp=new THREE.Mesh(new THREE.PlaneGeometry(42,40),gm);
  fp.rotation.x=-Math.PI/2; fp.position.set(212,0.07,-62); fp.receiveShadow=true; scene.add(fp);

  const fpm=new THREE.MeshStandardMaterial({color:0x8c7050,roughness:0.8});
  const frm=new THREE.MeshStandardMaterial({color:0xfcfaf5,roughness:0.65});
  for (let fz=-82;fz<=-42;fz+=5) {
    add(box(0.28,1.7,0.28,fpm,[192,0.85,fz]), box(0.28,1.7,0.28,fpm,[232,0.85,fz]));
  }
  for (let fx=192;fx<=232;fx+=5) {
    add(box(0.28,1.7,0.28,fpm,[fx,0.85,-82]), box(0.28,1.7,0.28,fpm,[fx,0.85,-42]));
  }
  add(box(0.1,0.1,40,frm,[192,1.5,-62],0,false), box(0.1,0.1,40,frm,[232,1.5,-62],0,false),
      box(40,0.1,0.1,frm,[212,1.5,-82],0,false), box(40,0.1,0.1,frm,[212,1.5,-42],0,false));

  const green=new THREE.Mesh(new THREE.PlaneGeometry(52,52),gm);
  green.rotation.x=-Math.PI/2; green.position.set(212,0.07,-125); green.receiveShadow=true; scene.add(green);
}

function addGamePark() {
  const gm=MAT_GRASS_FIELD();
  const gp=new THREE.Mesh(new THREE.PlaneGeometry(56,46),gm);
  gp.rotation.x=-Math.PI/2; gp.position.set(212,0.07,28); gp.receiveShadow=true; scene.add(gp);
  const colors=[0xe8602a,0x2a88c8,0xe8c82a,0x4ac84a];
  for (let i=0;i<5;i++) {
    const h=2.8+i*0.4;
    add(box(3.5,h,3.5,new THREE.MeshStandardMaterial({color:colors[i%4],roughness:0.6}),
      [196+i*8,h/2,26+(i%2)*9]));
  }
}

/* ── COMMERCIAL ───────────────────────────────────────────────── */

function addCommercialBlock() {
  const g=new THREE.Group(); g.position.set(215,0,142);
  const cm=MAT_CONCRETE(), gm=MAT_GLASS(0.5), wm=MAT_WHITE_TRIM();
  g.add(box(44,9.5,28,cm,[0,4.75,0]));
  g.add(box(44,0.6,30,wm,[0,9.85,0],0,false));
  g.add(box(0.45,9.0,24,gm,[-22.3,4.75,0]));
  for (let cz=-10;cz<=10;cz+=5) g.add(box(0.65,3.8,0.65,cm,[-22.0,1.9,cz]));
  scene.add(g);
}

/* ── SERVICE COMPOUND ────────────────────────────────────────── */

function addServiceCompound() {
  const cm=MAT_CONCRETE();
  const svc=new THREE.MeshStandardMaterial({color:0xcc2200,roughness:0.7});
  add(box(18,5.2,14,svc,[-165,2.6,202]), 
      box(20,0.55,16,new THREE.MeshStandardMaterial({color:0xaa1800,roughness:0.7}),[-165,5.4,202],0,false),
      box(33,6.5,19,cm,[-128,3.25,212]),
      box(13,4.2,11,cm,[-105,2.1,192]));
  const tp=new THREE.Mesh(new THREE.PlaneGeometry(32,21),MAT_ASPHALT());
  tp.rotation.x=-Math.PI/2; tp.position.set(-196,0.14,248); tp.receiveShadow=true; scene.add(tp);
}

/* ── GRASS CARDS ──────────────────────────────────────────────── */

function addGrassCards() {
  const gm=new THREE.MeshStandardMaterial({
    color:0x5a9448, roughness:0.92, side:THREE.DoubleSide, alphaTest:0.5 });
  for (let i=0;i<180;i++) {
    const angle=(i/180)*Math.PI*2;
    const r=160+Math.random()*60;
    const x=Math.cos(angle)*r, z=Math.sin(angle)*(r*0.55);
    const w=1.2+Math.random()*0.8, h=0.6+Math.random()*0.5;
    const card=new THREE.Mesh(new THREE.PlaneGeometry(w,h), gm);
    card.position.set(x, h/2, z);
    card.rotation.y=Math.random()*Math.PI;
    card.castShadow=false; card.receiveShadow=true;
    scene.add(card); grassCards.push(card);
  }
}

/* ── ROYAL PALMS ──────────────────────────────────────────────── */

function addRoyalPalms() {
  [[-100,-90],[100,-90],[-120,170],[120,170],[0,-90],[-50,-95],[50,-95],
   [-220,218],[-195,255],[-175,245],[210,-80],[215,45],[200,135],
   [-80,170],[80,170],[-140,155],[140,155],[0,145],[-60,148],[60,148]
  ].forEach(([x,z]) => addPalmAt(x,z,1.0+Math.random()*0.45));
}

function addPerimeterTrees() {
  for (let x=-252;x<=252;x+=13) {
    addPalmAt(x,-195,0.85+Math.random()*0.3);
    addPalmAt(x,202,0.85+Math.random()*0.3);
  }
  for (let z=-185;z<=200;z+=15) {
    addPalmAt(-254,z,0.9+Math.random()*0.25);
    addPalmAt(254,z,0.9+Math.random()*0.25);
  }
}

function addPalmAt(x, z, scale=1) {
  const g=new THREE.Group(); g.position.set(x,0,z); g.scale.setScalar(scale);
  const trunkM=new THREE.MeshStandardMaterial({color:0x7a5c30,roughness:0.9});
  const frondM=new THREE.MeshStandardMaterial({color:0x3a7228,roughness:0.85,side:THREE.DoubleSide});
  const lean=(Math.random()-.5)*0.05;
  const trunkH=14+Math.random()*5;

  for (let i=0;i<5;i++) {
    const s=cyl(0.24-i*0.025,0.28-i*0.025,trunkH/5,10,trunkM,
      [lean*i*trunkH/5, trunkH/10+i*trunkH/5, 0]);
    s.rotation.z=lean; g.add(s);
  }
  for (let i=0;i<9;i++) {
    const angle=(i/9)*Math.PI*2;
    const frond=new THREE.Mesh(new THREE.PlaneGeometry(7+Math.random(),0.9),frondM);
    frond.position.set(Math.cos(angle)*3.5+lean*trunkH, trunkH+0.5, Math.sin(angle)*3.5);
    frond.rotation.y=angle; frond.rotation.z=0.48+Math.random()*0.12;
    frond.castShadow=false; g.add(frond);
  }
  g.add(cyl(0.32,0.38,0.65,8,
    new THREE.MeshStandardMaterial({color:0x8c7a30,roughness:0.75}),
    [lean*trunkH, trunkH-0.3, 0]));
  scene.add(g);
}

/* ── FRAME TICK ──────────────────────────────────────────────── */

export function tickScene(elapsedTime, camera) {
  waterMeshes.forEach(m => {
    if (m.material && m.material.normalMap) {
      m.material.normalMap.offset.x = elapsedTime * 0.018;
      m.material.normalMap.offset.y = elapsedTime * 0.012;
    }
  });
  grassCards.forEach(card => {
    card.rotation.y = Math.atan2(
      camera.position.x - card.position.x,
      camera.position.z - card.position.z
    );
  });
}

export function getRenderer() { return renderer; }
export function getScene()    { return scene;    }
export function getCamera()   { return camera;   }
export function getClock()    { return clock;    }
