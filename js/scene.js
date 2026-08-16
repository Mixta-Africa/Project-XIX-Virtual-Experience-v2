/**
 * Project XIX - Scene v23
 * Changes from v22:
 *  - Performance mode system (Fast/Balanced/Rich) with dynamic shadow map, pixel ratio, fog
 *  - Horse + rider avatar: procedural animated trot cycle, eye-level at 1.83m (6ft man on horse ~2.8m)
 *  - Palm billboard tick rate-limited (every 4th frame in Fast mode)
 *  - Shadow map reduced to 1024 in Fast, 2048 Balanced, 4096 Rich
 *  - Pixel ratio capped at 1.0 Fast, 1.5 Balanced, 2.0 Rich
 *  - instanced grass/tree counts reduced in Fast mode
 *  - Fog density increased slightly to cull distant geometry
 *  - All v22 changes preserved (auto-lift, no-build zones, GLB tree triple-clone, etc.)
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { GLTFLoader }  from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/DRACOLoader.js";
import { PBR, createWaterMat, addGrassField, tickGrass, tickWater } from "./graphics.js";
import {
  MAT_GRASS_FIELD, MAT_DIRT, MAT_ASPHALT,
  MAT_BRICK, MAT_CONCRETE, MAT_TIMBER, MAT_STONE, MAT_TILE_ROOF,
  MAT_GLASS, MAT_GLASS_WARM, MAT_WHITE_TRIM, MAT_GOLD, MAT_DARK_METAL, MAT_WATER,
} from "./materials.js";

// ─── PERFORMANCE MODE ────────────────────────────────────────────────────────
// 'fast' = 70%+ faster: low shadow map, low pixel ratio, skip expensive effects
// 'balanced' = midpoint
// 'rich' = original quality
export let PERF_MODE = 'fast'; // default is always Fast

const PERF_SETTINGS = {
  fast:     { shadowMapSize: 512,  pixelRatio: 1.0, fogDensity: 0.0014, palmTickDiv: 8 },
  balanced: { shadowMapSize: 1024, pixelRatio: 1.5, fogDensity: 0.0011, palmTickDiv: 4 },
  rich:     { shadowMapSize: 2048, pixelRatio: 2.0, fogDensity: 0.0009, palmTickDiv: 1 },
};

export function setPerfMode(mode) {
  if (!PERF_SETTINGS[mode]) return;
  PERF_MODE = mode;
  if (!renderer) return;
  const s = PERF_SETTINGS[mode];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.pixelRatio));
  if (sunLight) {
    sunLight.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize);
    
    // KILL THE LAG: Completely disable shadow casting in Fast mode
    sunLight.castShadow = (mode !== 'fast'); 
    
    sunLight.shadow.map && sunLight.shadow.map.dispose();
    sunLight.shadow.map = null; // force regeneration
  }
  if (scene && scene.fog) scene.fog.density = s.fogDensity;
  console.log('[XIX] Perf mode:', mode);
}

//        MODULE STATE
let scene, renderer, camera, clock, skyMesh;
let waterMeshes = [], palmBillboards = [];
let clubGLBTemplate=null, stablesGLBTemplate=null;
let _palmTickCount = 0;

// Villa GLB
const VILLA_SCALE = 12.56;
const VILLA_Y     = 0;
let villaGLBScene = null;
let pendingVillas  = [];

// Apartment GLB
const APT_SCALE = 31.18;
const APT_Y     = 0;

// Loft Terrace GLB
const LOFT_SCALE = 20.0;
const LOFT_Y     = 0;
let loftGLBScene = null;
let pendingLofts  = [];
let aptGLBScene  = null;
let pendingApts  = [];

// Plot reservation
export const plotRegistry = new Map();
export let onPlotSelected = null;

// ─── HORSE + RIDER AVATAR ────────────────────────────────────────────────────
// Eye level: 6ft man = 1.83m. Mounted on horse adds ~1.4m saddle height → 3.1m
// Camera will be placed at eye = 3.1m above ground when riding.
// The avatar itself is visible in 3rd person (future) or as shadow/sound anchor.
export const RIDER_EYE_HEIGHT = 3.1;   // metres above ground
export const FOOT_EYE_HEIGHT  = 1.75;  // standard walk eye height

let horseGroup = null;
let horseMixer = null;

export function loadHorseGLB() {
  const loader = makeDracoLoader();
  loader.load("assets/horse.glb", gltf => {
    const model = gltf.scene;
    
    // Scale down from original massive size to ~1.8m shoulder height
    model.scale.setScalar(0.022);
    
    model.traverse(c => {
      if (c.isMesh) {
        c.castShadow = true;
        c.receiveShadow = true;
      }
    });
    
    // Auto-lift to ground
    const bbox = new THREE.Box3().setFromObject(model);
    if (bbox.min.y < 0) model.position.y = -bbox.min.y;
    
    horseGroup = new THREE.Group();
    horseGroup.name = 'horseRider';
    horseGroup.add(model);
    scene.add(horseGroup);
    
    // Setup Animation Mixer (Targeting 'Take 001' per Claude's log)
    horseMixer = new THREE.AnimationMixer(model);
    const clip = gltf.animations.find(a => a.name === 'Take 001') || gltf.animations[0];
    if (clip) {
      const action = horseMixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.timeScale = 1.4; // Trot speed
      action.play();
    }
  }, undefined, err => {
    console.error("Failed to load horse.glb:", err);
  });
}

export function tickHorseAnim(delta, isMoving) {
  // Only animate the horse when the player is actively moving
  if (horseMixer && isMoving) {
    horseMixer.update(delta);
  }
}
export let horseViewMode = 'first';

// Listen for the 'V' key to toggle camera views
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'v' && document.getElementById('world-overlay').classList.contains('open')) {
    horseViewMode = horseViewMode === 'first' ? 'third' : 'first';
  }
});

export function setHorsePosition(x, y, z, yaw) {
  if (!horseGroup) return;
  
  let forwardOffset = 0;
  let downOffset = 0;

  if (horseViewMode === 'first') {
    // 1st Person: Horse is right under you, showing the mane
    forwardOffset = 0.8;
    downOffset = -1.8; 
  } else {
    // 3rd Person: Horse is pushed forward so you can see the whole body
    forwardOffset = 4.5;
    downOffset = -2.5; 
  }

  // Calculate the new X/Z position relative to where the camera is looking
  horseGroup.position.set(
    x - Math.sin(yaw) * forwardOffset, 
    y + downOffset, 
    z - Math.cos(yaw) * forwardOffset
  );
  // Keep the horse facing forward
  horseGroup.rotation.y = yaw + Math.PI; 
}

export function getHorseGroup() { return horseGroup; }

//        INIT
export function initScene(canvas) {
  clock = new THREE.Clock();
  const perfS = PERF_SETTINGS[PERF_MODE];

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: PERF_MODE !== 'fast', // skip AA in Fast mode — huge GPU win
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, perfS.pixelRatio));
  renderer.shadowMap.enabled   = true;
  renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  renderer.outputColorSpace    = THREE.SRGBColorSpace;

  scene  = new THREE.Scene();
  scene.background = new THREE.Color(0x8ab8cc);
  scene.fog = new THREE.FogExp2(0x8ab8cc, perfS.fogDensity);

  camera = new THREE.PerspectiveCamera(65, 1, 0.5, 1200); // near=0.5, far=1200 (was 1600 — culls more)
  buildLighting();
  buildSky();
  loadTreeGLB();
  buildEnvironment();
  loadVillaGLB();
  loadApartmentGLB();
  loadLoftGLB();
  loadClubhouseGLB();
  loadStablesGLB();

  // Load the animated horse GLB
  loadHorseGLB();

  return { scene, renderer, camera, clock };
}

//        HDRI
function loadHDRI() {} // disabled

//        LIGHTING
let sunLight, hemiLight;
export function getSunLight() { return sunLight; }
export function getHemiLight() { return hemiLight; }

function buildLighting() {
  const perfS = PERF_SETTINGS[PERF_MODE];
  hemiLight = new THREE.HemisphereLight(0xd4e8ff, 0x4a6a30, 1.2);
  scene.add(hemiLight);

  sunLight = new THREE.DirectionalLight(0xffe8b0, 2.6);
  sunLight.position.set(-180, 160, 100);
  sunLight.castShadow = true;
  sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -420;
  sunLight.shadow.camera.right = sunLight.shadow.camera.top   =  420;
  sunLight.shadow.camera.far   = 900;           // was 1000
  sunLight.shadow.mapSize.set(perfS.shadowMapSize, perfS.shadowMapSize);
  sunLight.shadow.bias        = -0.0002;
  sunLight.shadow.normalBias  =  0.02;
  sunLight.shadow.radius      =  3.5;
  scene.add(sunLight);

  const fill = new THREE.DirectionalLight(0xb8d0e8, 0.45);
  fill.position.set(120, 80, -100); scene.add(fill);

  // Clubhouse interior glow — only in balanced/rich
  if (PERF_MODE !== 'fast') {
    [[-40,8,115],[0,8,115],[40,8,115]].forEach(p => {
      const pt = new THREE.PointLight(0xffe0a0, 2.0, 48, 2);
      pt.position.set(...p); scene.add(pt);
    });
  }
}

//        SKY
function buildSky() {
  const makeGrad = (top,hor,gnd) => {
    const c = document.createElement("canvas"); c.width=4; c.height=256;
    const sx = c.getContext("2d");
    const g  = sx.createLinearGradient(0,0,0,256);
    g.addColorStop(0,top); g.addColorStop(.45,hor); g.addColorStop(1,gnd);
    sx.fillStyle=g; sx.fillRect(0,0,4,256);
    return new THREE.CanvasTexture(c);
  };
  const st = makeGrad("#1a3a6a","#5a9acc","#c8d8e0");
  st.colorSpace = THREE.SRGBColorSpace;
  skyMesh = new THREE.Mesh(new THREE.SphereGeometry(900,16,10), // reduced segments
    new THREE.MeshBasicMaterial({map:st, side:THREE.BackSide}));
  scene.add(skyMesh);

  // Sun disc
  const sunM = new THREE.Mesh(new THREE.SphereGeometry(15,8,6),
    new THREE.MeshBasicMaterial({color:0xffe8b0}));
  sunM.position.set(-300,310,180); scene.add(sunM);

  // Clouds — skip in Fast mode
  if (PERF_MODE !== 'fast') {
    const cm = new THREE.MeshBasicMaterial({color:0xfdfcfa,transparent:true,opacity:.65,side:THREE.DoubleSide});
    [[-180,260,-300],[80,270,-350],[220,250,-280],[-300,240,-180],[140,268,-400]].forEach(([x,y,z])=>{
      for(let i=0;i<4;i++){
        const m=new THREE.Mesh(new THREE.SphereGeometry(28+Math.random()*24,6,4),cm);
        m.scale.y=.28; m.position.set(x+(Math.random()-.5)*65,y+Math.random()*10,z+(Math.random()-.5)*42);
        scene.add(m);
      }
    });
  }
}

export function updateSky(top,hor,gnd) {
  if (!skyMesh) return;
  const c=document.createElement("canvas"); c.width=4; c.height=256;
  const sx=c.getContext("2d");
  const g=sx.createLinearGradient(0,0,0,256);
  g.addColorStop(0,top); g.addColorStop(.5,hor); g.addColorStop(1,gnd);
  sx.fillStyle=g; sx.fillRect(0,0,4,256);
  skyMesh.material.map=new THREE.CanvasTexture(c);
  skyMesh.material.needsUpdate=true;
}

//        GEOMETRY HELPERS
function box(w,h,d,mat,pos=[0,0,0],ry=0,shadow=true){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  m.position.set(...pos); m.rotation.y=ry;
  m.castShadow=shadow&&h>.3; m.receiveShadow=true; return m;
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

// Materials
const MATS = {
  villaBody:  ()=>new THREE.MeshStandardMaterial({color:0xF5E6B0,roughness:.75,metalness:.02}),
  villaRoof:  ()=>new THREE.MeshStandardMaterial({color:0xC9A84C,roughness:.65,metalness:.08}),
  loftBody:   ()=>new THREE.MeshStandardMaterial({color:0xE8E0D0,roughness:.78}),
  loftRoof:   ()=>new THREE.MeshStandardMaterial({color:0xD4622A,roughness:.7}),
  flatGrey:   ()=>new THREE.MeshStandardMaterial({color:0xDDDDDD,roughness:.7}),
  clubWhite:  ()=>new THREE.MeshStandardMaterial({color:0xF0ECE0,roughness:.7}),
  stableBrick:()=>new THREE.MeshStandardMaterial({color:0xC4A882,roughness:.88}),
  stableRoof: ()=>new THREE.MeshStandardMaterial({color:0x8B6914,roughness:.8}),
  roadAsph:   ()=>new THREE.MeshStandardMaterial({color:0x1a1e1c,roughness:.88}),
  safetyBrown:()=>new THREE.MeshStandardMaterial({color:0x8B4513,roughness:.95}),
  grassGreen: ()=>new THREE.MeshStandardMaterial({color:0x3a7a28,roughness:.92}),
  lawnGreen:  ()=>new THREE.MeshStandardMaterial({color:0x4a8a38,roughness:.9}),
  hedgeGreen: ()=>new THREE.MeshStandardMaterial({color:0x2a5a20,roughness:.95}),
  cobble:     ()=>new THREE.MeshStandardMaterial({color:0x9A7A5A,roughness:.9}),
  concrete:   ()=>new THREE.MeshStandardMaterial({color:0xc8c0b0,roughness:.8}),
  railWhite:  ()=>new THREE.MeshStandardMaterial({color:0xfcfaf8,roughness:.5}),
  plotAvail:    () => new THREE.MeshStandardMaterial({ color: 0x00ff88, transparent: true, opacity: 0.0, depthWrite: false }),
  plotReserved: () => new THREE.MeshStandardMaterial({ color: 0xff4444, transparent: true, opacity: 0.0, depthWrite: false }),
};

//        ENVIRONMENT
function buildEnvironment(){
  addGround();
  addPoloField();
  addGrassRing();
  addSafetyZone();
  addYardMarkings();
  addRoads();
  addLake();
  addEastLake();
  addClubhouse();
  addVillaRing();
  addLoftTerraces();
  addWestCompound();
  addStables();
  addPaddock();
  addGamePark();
  addCommercialBlock();
  addServiceCompound();
  addLandscaping();
}

//        GROUND
function addGround(){
  s(plane(900,700,PBR.dirt(),[0,0,30]));
  s(plane(500,400,PBR.grass(),[0,.01,0]));
  s(plane(180,80,MATS.concrete(),[0,.02,122]));
  s(plane(90,70,MATS.cobble(),[-355,.02,90]));
  s(plane(200,280,MATS.lawnGreen(),[-310,.01,30]));
}

//        POLO FIELD
function addGrassRing(){
  const cards = [
    ...addGrassField( 0, -115, 140, 12, PERF_MODE==='fast'?120:250),
    ...addGrassField( 0,  115, 140, 12, PERF_MODE==='fast'?120:250),
    ...addGrassField(-165,  0,  12, 90, PERF_MODE==='fast'? 80:160),
    ...addGrassField( 165,  0,  12, 90, PERF_MODE==='fast'? 80:160),
  ];
  cards.forEach(card => scene.add(card));
}

function addPoloField(){
  const sc=document.createElement("canvas"); sc.width=512; sc.height=256;
  const ctx=sc.getContext("2d");
  for(let i=0;i<14;i++){
    ctx.fillStyle=i%2===0?"#5a9448":"#4a8038";
    ctx.fillRect(0,i*(256/14),512,256/14+1);
  }
  const st=new THREE.CanvasTexture(sc);
  st.colorSpace=THREE.SRGBColorSpace; st.wrapS=st.wrapT=THREE.RepeatWrapping; st.repeat.set(1,1);
  const fm=MAT_GRASS_FIELD(); fm.map=st;
  s(plane(274,146,fm,[0,.12,0]));
  const lm=new THREE.MeshStandardMaterial({color:0xf8f5e0,roughness:.4});
  s(box(.5,.05,146,lm,[0,.14,0],0,false));
  s(box(274,.05,.5,lm,[0,.14,0],0,false));
}

//        SAFETY ZONE
function addSafetyZone(){
  const dm=PBR.dirt(); dm.color.set(0x8B4513);
  s(plane(298,25,dm,[0,.11,-85.5]));
  s(plane(298,25,dm,[0,.11, 85.5]));
  s(plane(11,146,dm,[-142.5,.11,0]));
  s(plane(11,146,dm,[ 142.5,.11,0]));
  for(const [cx,cz] of [[-132,-80],[132,-80],[-132,80],[132,80]])
    s(plane(20,20,dm,[cx,.11,cz]));
}

//        YARD MARKINGS
function addYardMarkings(){
  const lm=new THREE.MeshStandardMaterial({color:0xf8f5e0,roughness:.4});
  for(const side of[-1,1]) for(const d of[27.4,36.6,54.9])
    s(box(.5,.05,146,lm,[side*(137-d),.14,0],0,false));
  const pm=MATS.railWhite(); pm.metalness=.2;
  for(const gx of[-137,137]) for(const pz of[0,-7.3,7.3])
    s(cyl(.12,.12,3,8,pm,[gx,1.5,pz]));
  for(const z of[-55,0,55]) s(box(100,.05,.4,lm,[-390,.14,z],0,false));
  for(const gz of[-80,80]) for(const pz of[0,-7.3,7.3])
    s(cyl(.12,.12,3,8,pm,[-390,1.5,gz+pz]));
}

//        ROADS
function addRoads(){
  const am=PBR.asphalt();
  const lm=new THREE.MeshStandardMaterial({color:0xf0ecd0,roughness:.5});
  const Y=.13;
  s(plane(700,30,am,[0,Y,215]));
  s(plane(700,4,MATS.grassGreen(),[0,Y+.01,215]));
  for(let x=-300;x<=300;x+=18) s(box(8,.04,.35,lm,[x,Y+.03,215],0,false));
  for(let x=-280;x<=280;x+=10) addPalmSprite(x,Y+.1,206,1.3);
  for(let x=-260;x<=260;x+=8){
    const cz=-168-Math.abs(x)*.05;
    s(plane(8,8,am,[x,Y,cz]));
  }
  s(plane(8,220,am,[-155,Y,0]));
  s(plane(8,220,am,[ 155,Y,0]));
  s(plane(320,8,am,[0,Y,-104]));
  s(plane(320,8,am,[0,Y,104]));
  for(const[cx,cz] of[[-150,-100],[150,-100],[-150,100],[150,100]])
    s(plane(16,16,am,[cx,Y,cz]));
  s(plane(8,220,am,[-177,Y,-5]));
  s(plane(8,220,am,[ 177,Y,-5]));
  s(plane(320,7,am,[30,Y,-118]));
  s(plane(400,8,am,[0,Y,128]));
  s(plane(130,35,am,[0,Y,148]));
  s(plane(8,280,am,[-270,Y,20]));
  s(plane(8,200,am,[-230,Y,10]));
  s(plane(150,8,am,[-310,Y,145]));
  s(plane(8,100,am,[-170,Y,10]));
  s(plane(8,250,am,[200,Y,10]));
  s(plane(55,8,am,[215,Y,120]));
}

//        LAKE
function addLake(){
  const wm=createWaterMat();
  const lb=new THREE.Mesh(new THREE.BoxGeometry(195,.35,22),wm);
  lb.position.set(30,.16,-115); lb.receiveShadow=true; scene.add(lb); waterMeshes.push(lb);
  for(const[ex,sc2] of[[-60,.9],[120,1.0]]){
    const ep=new THREE.Mesh(new THREE.SphereGeometry(13,12,4),wm);
    ep.position.set(ex,.05,-115); ep.scale.set(1,.2,sc2); scene.add(ep); waterMeshes.push(ep);
  }
  const sg=MATS.grassGreen();
  s(plane(220,6,sg,[30,.12,-104]));
  s(plane(220,6,sg,[30,.12,-126]));
}

function addEastLake(){
  const wm=createWaterMat();
  const el=new THREE.Mesh(new THREE.BoxGeometry(10,.25,38),wm);
  el.position.set(220,.12,-48); scene.add(el); waterMeshes.push(el);
}

//        CLUBHOUSE
function addClubhouse(){
  const parkM=MATS.roadAsph();
  s(plane(55,28,parkM,[-65,.13,128]));
  s(plane(55,28,parkM,[ 65,.13,128]));
}

function addUmbrella(parent,pos){
  const g=new THREE.Group(); g.position.set(...pos);
  g.add(cyl(.08,.08,3.0,6,MAT_GOLD(),[0,1.5,0]));
  g.add(cyl(3.2,3.6,.45,16,new THREE.MeshStandardMaterial({color:0xf0e8d8,roughness:.7}),[0,3.2,0]));
  parent.add(g);
}

//        GLB SYSTEM
function makeDracoLoader() {
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/draco/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader;
}

function loadOneGLB(path, scale, yOff, onDone, onFail) {
  makeDracoLoader().load(path,
    gltf => {
      gltf.scene.scale.setScalar(scale);
      gltf.scene.traverse(child => {
        if (child.isMesh) {
          child.castShadow = false; // Optimization: Static buildings do not cast dynamic shadows
          child.receiveShadow = true;
          child.frustumCulled = true;
        }
      });
      const bbox = new THREE.Box3().setFromObject(gltf.scene);
      const autoLift = bbox.min.y < 0 ? -bbox.min.y : 0;
      gltf.scene.position.y = yOff + autoLift;
      onDone(gltf.scene);
    },
    undefined,
    err => { console.error("GLB failed:", path, err.message||err); if(onFail) onFail(); }
  );
}

function loadClubhouseGLB(){
  loadOneGLB("assets/clubhouse-mesh.glb", 60.975, 0, tmpl=>{
    clubGLBTemplate=tmpl;
    const g=new THREE.Group(); g.position.set(0,0,108); g.rotation.y=Math.PI;
    const bbox = new THREE.Box3().setFromObject(g);
    const minY = bbox.min.y;
    if(minY < -0.5) g.position.y -= minY;
    g.add(tmpl.clone(true)); scene.add(g);
    const bbox2 = new THREE.Box3().setFromObject(g);
    if(bbox2.min.y < -0.5) g.position.y -= bbox2.min.y;
    console.log("Clubhouse GLB OK, minY:", bbox2.min.y.toFixed(2));
  });
}

function loadStablesGLB(){
  loadOneGLB("assets/stables-mesh.glb", 18.846, 0, tmpl=>{
    stablesGLBTemplate=tmpl;
    const g=new THREE.Group(); g.position.set(-375,0,90);
    g.add(tmpl.clone(true)); scene.add(g);
    const bbox = new THREE.Box3().setFromObject(g);
    if(bbox.min.y < -0.5) g.position.y -= bbox.min.y;
    console.log("Stables GLB OK, minY:", bbox.min.y.toFixed(2));
  });
}

function loadVillaGLB(){
  makeDracoLoader().load("assets/villa-mesh.glb",
    gltf=>{
      gltf.scene.scale.setScalar(VILLA_SCALE);
      gltf.scene.traverse(c=>{
        if(c.isMesh){
          c.castShadow=false; c.receiveShadow=true;
          if(c.material){ c.material.envMapIntensity=0.4; c.material.needsUpdate=true; }
        }
      });
      const bbox = new THREE.Box3().setFromObject(gltf.scene);
      const autoLift = bbox.min.y < 0 ? -bbox.min.y : VILLA_Y;
      gltf.scene.position.y = autoLift;
      const wrapper = new THREE.Group();
      wrapper.add(gltf.scene);
      villaGLBScene = wrapper;
      pendingVillas.forEach(({x,z,ry,plotKey})=>placeVillaGLB(x,z,ry,plotKey));
      pendingVillas=[];
      console.log("Villa GLB loaded OK, minY:", bbox.min.y.toFixed(2));
    },
    xhr=>{ if(xhr.total) console.log("Villa GLB:", Math.round(xhr.loaded/xhr.total*100)+"%"); },
    err=>{
      console.error("Villa GLB failed:", err);
      pendingVillas.forEach(({x,z,ry})=>{ const v=createVillaFallback(); v.position.set(x,0,z); v.rotation.y=ry; scene.add(v); });
      pendingVillas=[];
    }
  );
}

function loadApartmentGLB(){
  makeDracoLoader().load("assets/apartment-mesh.glb",
    gltf=>{
      gltf.scene.scale.setScalar(APT_SCALE);
      gltf.scene.traverse(c=>{
        if(c.isMesh){ c.castShadow=false; c.receiveShadow=true;
          if(c.material){ c.material.envMapIntensity=0.3; c.material.needsUpdate=true; }
        }
      });
      const bbox = new THREE.Box3().setFromObject(gltf.scene);
      const autoLift = bbox.min.y < 0 ? -bbox.min.y : APT_Y;
      gltf.scene.position.y = autoLift;
      const wrapper = new THREE.Group();
      wrapper.add(gltf.scene);
      aptGLBScene=wrapper;
      pendingApts.forEach(({x,z,ry})=>placeAptGLB(x,z,ry));
      pendingApts=[];
      console.log("Apartment GLB loaded OK, minY:", bbox.min.y.toFixed(2));
    },
    null,
    ()=>{ pendingApts.forEach(({x,z})=>{ scene.add(createFlatBlock(x,z)); }); pendingApts=[]; }
  );
}

function placeVillaGLB(x,z,ry,plotKey){
  if(!villaGLBScene){ pendingVillas.push({x,z,ry,plotKey}); return; }
  const clone=villaGLBScene.clone(true);
  clone.position.set(x,0,z);
  clone.rotation.y=ry;
  clone.userData.isVillaGLB=true;
  clone.userData.baseRotY=ry;
  clone.userData.plotKey=plotKey;
  scene.add(clone);
  if(plotKey) addPlotOverlay(x,z,ry,plotKey,clone);
}

function placeAptGLB(x,z,ry=0){
  if(!aptGLBScene){ pendingApts.push({x,z,ry}); return; }
  const clone=aptGLBScene.clone(true);
  clone.position.set(x,0,z);
  clone.rotation.y=ry;
  scene.add(clone);
}

//        PLOT RESERVATION SYSTEM
function addPlotOverlay(x,z,ry,plotKey,villaClone){
  const mat=MATS.plotAvail();
  const overlay=new THREE.Mesh(new THREE.PlaneGeometry(20,18),mat);
  overlay.rotation.x=-Math.PI/2;
  overlay.rotation.y=ry;
  overlay.position.set(x,.25,z);
  overlay.userData.plotKey=plotKey;
  overlay.userData.isPlotOverlay=true;
  overlay.userData.villaClone=villaClone;
  scene.add(overlay);
  plotRegistry.set(plotKey,{ status:"available", overlay, villaClone, x,z,ry });
}

export function reservePlot(plotKey){
  const plot=plotRegistry.get(plotKey);
  if(!plot||plot.status==="reserved") return false;
  plot.status="reserved";
  plot.villaClone && plot.villaClone.traverse(c=>{
    if(c.isMesh&&c.material){
      c.material=c.material.clone();
      c.material.color.set(0x888888);
      c.material.opacity=.7; c.material.transparent=true;
    }
  });
  if(plot.overlay){
    plot.overlay.material=MATS.plotReserved();
    plot.overlay.material.transparent=true;
    plot.overlay.material.opacity=.5;
  }
  plotRegistry.set(plotKey,plot);
  return true;
}

export function getPlotAtRay(raycaster){
  const overlays=[];
  scene.traverse(o=>{ if(o.userData.isPlotOverlay) overlays.push(o); });
  const hits=raycaster.intersectObjects(overlays,false);
  return hits.length>0 ? hits[0].object.userData.plotKey : null;
}

//        LOFT TERRACE GLB
function loadLoftGLB(){
  makeDracoLoader().load("assets/loft-mesh.glb",
    gltf=>{
      gltf.scene.scale.setScalar(LOFT_SCALE);
      gltf.scene.traverse(child=>{
        if(child.isMesh){
          child.castShadow=false; child.receiveShadow=true;
          if(child.material){ child.material.envMapIntensity=0.3; child.material.needsUpdate=true; }
        }
      });
      const bbox = new THREE.Box3().setFromObject(gltf.scene);
      const autoLift = bbox.min.y < 0 ? -bbox.min.y : LOFT_Y;
      gltf.scene.position.y = autoLift;
      const wrapper=new THREE.Group();
      wrapper.add(gltf.scene);
      loftGLBScene=wrapper;
      pendingLofts.forEach(({x,z,ry})=>placeLoftGLB(x,z,ry));
      pendingLofts=[];
      console.log("Loft GLB loaded OK, minY:", bbox.min.y.toFixed(2));
    },
    null,
    err=>{
      console.error("Loft GLB failed:",err);
      pendingLofts.forEach(({x,z,ry})=>{ scene.add(createLoftBlock(x,z,ry)); });
      pendingLofts=[];
    }
  );
}

function placeLoftGLB(x,z,ry){
  ry = ry || 0;
  if(!loftGLBScene){ pendingLofts.push({x,z,ry}); return; }
  const clone=loftGLBScene.clone(true);
  clone.position.set(x,0,z);
  clone.rotation.y=ry;
  scene.add(clone);
}

//        VILLA RING
function addVillaRing(){
  const PLOT=28;
  for(let i=0;i<8;i++){ const z=-96+i*PLOT; placeVillaWithLandscape(-162,z,Math.PI/2); }
  for(let i=0;i<7;i++){ const z=-82+i*PLOT; placeVillaWithLandscape(-192,z,Math.PI/2); }
  for(let i=0;i<8;i++){ const z=-96+i*PLOT; placeVillaWithLandscape(162,z,-Math.PI/2); }
  for(let i=0;i<7;i++){ const z=-82+i*PLOT; placeVillaWithLandscape(192,z,-Math.PI/2); }
  const LAKE_CX=30, LAKE_R=90, BOW=17;
  const northX=[-140,-116,-92,-68,-44,-20,4,28,52,76,100,124,148,172,196];
  northX.forEach(x=>{
    const dx=x-LAKE_CX;
    const bow=dx*dx<LAKE_R*LAKE_R ? BOW*(1-(dx*dx)/(LAKE_R*LAKE_R)) : 0;
    placeVillaWithLandscape(x, -132-bow, 0);
  });
  for(const side of[-1,1]){
    [65,93,121].forEach(xabs=>{
      const x=side*xabs;
      const z=105+Math.abs(x)*.04;
      placeVillaWithLandscape(x,z,0);
    });
  }
}

function placeVillaWithLandscape(x,z,ry){
  const plotKey=`${Math.round(x)},${Math.round(z)}`;
  registerVillaFootprint(x,z);
  placeVillaGLB(x,z,ry,plotKey);
  addPlotLandscaping(x,z,ry);
  const forwardX=Math.sin(ry)*(-9);
  const forwardZ=Math.cos(ry)*(-9);
  const rightX=Math.cos(ry)*8;
  const rightZ=-Math.sin(ry)*8;
  addCypressAt(x+rightX+forwardX, z+rightZ+forwardZ);
  addCypressAt(x-rightX+forwardX, z-rightZ+forwardZ);
}

function addPlotLandscaping(vx,vz,ry){
  const hm=MATS.hedgeGreen();
  const gm2=new THREE.MeshStandardMaterial({color:0x8a7050,roughness:.7,metalness:.2});
  const pm=new THREE.MeshStandardMaterial({color:0xd0c8b4,roughness:.8});
  const g=new THREE.Group(); g.position.set(vx,0,vz); g.rotation.y=ry;
  const hl=new THREE.Mesh(new THREE.BoxGeometry(.4,1.1,18),hm);
  hl.position.set(-10,.55,0); hl.receiveShadow=true; hl.castShadow=true; g.add(hl);
  const hr=hl.clone(); hr.position.set(10,.55,0); g.add(hr);
  const hf=new THREE.Mesh(new THREE.BoxGeometry(18,.7,.4),hm);
  hf.position.set(0,.35,-10); hf.receiveShadow=true; g.add(hf);
  for(const gx of[-2.5,2.5]){
    const gp=new THREE.Mesh(new THREE.BoxGeometry(.3,1.5,.3),gm2);
    gp.position.set(gx,.75,-10); gp.castShadow=true; g.add(gp);
  }
  const dp=new THREE.Mesh(new THREE.PlaneGeometry(4.5,5),pm);
  dp.rotation.x=-Math.PI/2; dp.position.set(0,.02,-7.5); dp.receiveShadow=true; g.add(dp);
  scene.add(g);
}

function createVillaFallback(){
  const g=new THREE.Group();
  const bm=MATS.villaBody(); const rm=MATS.villaRoof();
  const wm=MAT_WHITE_TRIM(); const gw=MAT_GLASS_WARM(.55);
  g.add(box(16,2.1,13,new THREE.MeshStandardMaterial({color:0xb0a898,roughness:.8}),[0,1.05,0]));
  g.add(box(16,5.8,13,bm,[0,5.15,0]));
  g.add(box(15,2.2,.4,gw,[0,5.5,-6.6]));
  const roofPyramid=new THREE.ConeGeometry(12,3.5,4);
  const rm2=new THREE.Mesh(roofPyramid,rm);
  rm2.position.set(0,9.85,0); rm2.rotation.y=Math.PI/4; g.add(rm2);
  g.add(box(16,.18,4,wm,[0,4.03,-8.5],0,false));
  return g;
}

//        LOFT TERRACES
function addLoftTerraces(){
  for(let x=-310; x<=-110; x+=36){
    const cz=-162-Math.abs(x)*.05;
    registerVillaFootprint(x,cz);
    placeLoftGLB(x,cz,Math.PI);
  }
  for(let x=95; x<=310; x+=36){
    const cz=-162-Math.abs(x)*.05;
    registerVillaFootprint(x,cz);
    placeLoftGLB(x,cz,Math.PI);
  }
  registerVillaFootprint(-220,-40);
  registerVillaFootprint(-220, 40);
  placeLoftGLB(-220,-40,-Math.PI/2);
  placeLoftGLB(-220, 40,-Math.PI/2);
}

function createLoftBlock(x,z,ry){
  const g=new THREE.Group(); g.position.set(x,0,z); g.rotation.y=ry;
  const UNITS=4, UW=10.0, UD=11.0;
  const TW=UNITS*UW;
  const bm=MATS.loftBody(); const rm=MATS.loftRoof();
  const gw=MAT_GLASS_WARM(.6); const tm=MAT_TIMBER();
  g.add(box(TW,3.2,UD,new THREE.MeshStandardMaterial({color:0x9a8a78,roughness:.9}),[0,1.6,0]));
  g.add(box(TW,3.2,UD,bm,[0,4.85,0]));
  for(let u=0;u<UNITS;u++){
    const ux=-TW/2+UW/2+u*UW;
    g.add(box(7.5,2.6,.06,gw,[ux,3.0,-UD/2-.03]));
    g.add(box(7.5,2.5,.06,gw,[ux,4.85,-UD/2-.03]));
    g.add(box(.4,6.4,.4,tm,[ux-UW/2,3.2,-UD/2]));
  }
  g.add(box(TW+.4,.4,UD+.4,rm,[0,6.65,0],0,false));
  g.add(box(TW+.2,.18,UD+.2,MAT_WHITE_TRIM(),[0,3.19,0],0,false));
  return g;
}

//        WEST COMPOUND
function addWestCompound(){
  const gm=MAT_GRASS_FIELD(); const dm=MATS.safetyBrown();
  s(plane(120,185,dm,[-390,.06,0]));
  s(plane(100,160,gm,[-390,.10,0]));
  placeAptGLB(-248,-25,Math.PI/2);
  placeAptGLB(-248, 55,Math.PI/2);
}

function createFlatBlock(x,z){
  const g=new THREE.Group(); g.position.set(x,0,z);
  const bm=MATS.flatGrey(); const wm=MAT_WHITE_TRIM();
  g.add(box(80,20,28,bm,[0,10,0]));
  g.add(box(82,.3,30,wm,[0,20.1,0],0,false));
  scene.add(g); return g;
}

//        STABLES
function addStables(){ return; }

//        PADDOCK
function addPaddock(){
  s(plane(40,38,MAT_GRASS_FIELD(),[218,.07,0]));
  const post=MATS.railWhite(); const rail=MATS.railWhite();
  for(let fz=-19;fz<=19;fz+=4){ s(cyl(.1,.1,1.6,6,post,[198,.8,fz])); s(cyl(.1,.1,1.6,6,post,[238,.8,fz])); }
  for(let fx=198;fx<=238;fx+=4){ s(cyl(.1,.1,1.6,6,post,[fx,.8,-19])); s(cyl(.1,.1,1.6,6,post,[fx,.8,19])); }
  s(box(.08,.1,38,rail,[198,1.0,0],0,false)); s(box(.08,.1,38,rail,[238,1.0,0],0,false));
  s(box(40,.1,.08,rail,[218,1.0,-19],0,false)); s(box(40,.1,.08,rail,[218,1.0,19],0,false));
  s(box(.08,.1,38,rail,[198,1.55,0],0,false)); s(box(.08,.1,38,rail,[238,1.55,0],0,false));
  s(box(40,.1,.08,rail,[218,1.55,-19],0,false)); s(box(40,.1,.08,rail,[218,1.55,19],0,false));
  s(plane(60,60,MATS.grassGreen(),[255,.06,-58]));
  for(let tx=235;tx<=280;tx+=7) for(let tz=-85;tz<=-30;tz+=7) addTreeAt(tx,.1,tz,.7+Math.random()*.5);
}

function addGamePark(){
  s(plane(54,44,MAT_GRASS_FIELD(),[218,.07,52]));
  const cols=[0xe8602a,0x2a88c8,0xe8c82a,0x4ac84a];
  for(let i=0;i<5;i++){
    const h=2.6+i*.4;
    s(box(3.2,h,3.2,new THREE.MeshStandardMaterial({color:cols[i%4],roughness:.6}),[203+i*7,h/2,50+(i%2)*8]));
  }
}

function addCommercialBlock(){
  const g=new THREE.Group(); g.position.set(270,0,65);
  g.add(box(42,9,26,MATS.flatGrey(),[0,4.5,0]));
  g.add(box(42,.55,28,MAT_WHITE_TRIM(),[0,9.3,0],0,false));
  g.add(box(.4,8.5,22,MAT_GLASS(.5),[-21.2,4.5,0]));
  scene.add(g);
}

function addServiceCompound(){
  s(box(16,5.0,13,new THREE.MeshStandardMaterial({color:0xcc2200,roughness:.7}),[-270,2.5,95]));
  s(box(17,.5,14,new THREE.MeshStandardMaterial({color:0xaa1800,roughness:.7}),[-270,5.1,95],0,false));
  s(box(30,6,17,MATS.flatGrey(),[-240,3,100]));
  s(box(12,4,10,MATS.concrete(),[-220,2,88]));
}

//        LANDSCAPING
const PALM_SRCS=["assets/palm-sprite.png","assets/palm-sprite-2.png"];
const palmMats=[];

function initPalmMats(){
  if(palmMats.length) return;
  const tl=new THREE.TextureLoader();
  PALM_SRCS.forEach(src=>{
    const t=tl.load(src); t.colorSpace=THREE.SRGBColorSpace;
    palmMats.push(new THREE.MeshBasicMaterial({map:t,transparent:true,alphaTest:.1,depthWrite:false,side:THREE.DoubleSide}));
  });
}

function addPalmSprite(x,y,z,scale=1){
  if(isInNoBuildZone(x,z)) return;
  initPalmMats();
  const mat=palmMats[Math.floor(Math.random()*palmMats.length)];
  const h=(13+Math.random()*5)*scale, w=h*.5;
  for(const ry of[0,Math.PI/2]){
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);
    m.position.set(x,y+h/2,z); m.rotation.y=ry;
    scene.add(m); palmBillboards.push(m);
  }
}

function addCypressAt(x,z){
  return; // TEMPORARILY DISABLED TO FIX GREEN CONES
}

// ─── NO-BUILD ZONE REGISTRY ───────────────────────────────────────────────────
const NO_BUILD_ZONES = [
  [0, 128, 75, 55],
  [-375, 90, 55, 45],
  [-248, -25, 50, 22],
  [-248,  55, 50, 22],
  [-390,  0, 65, 100],
  [-255, 95, 30, 20],
  [-240, 100, 22, 10],
  [270, 65, 28, 18],
  [218, 0, 28, 28],
  [218, 52, 30, 26],
  [0, 0, 140, 76],
  [30, -115, 105, 18],
  [220, -48, 12, 22],
];

const villaFootprints = [];

function registerVillaFootprint(x,z){
  villaFootprints.push({cx:x, cz:z, r:12});
}

function isInNoBuildZone(x,z){
  for(const [cx,cz,hw,hd] of NO_BUILD_ZONES){
    if(Math.abs(x-cx)<=hw && Math.abs(z-cz)<=hd) return true;
  }
  for(const {cx,cz,r} of villaFootprints){
    if((x-cx)*(x-cx)+(z-cz)*(z-cz) <= r*r) return true;
  }
  return false;
}

// ─── 3D TREE GLB SYSTEM ───────────────────────────────────────────────────────
let treeGLBTemplate = null;
let pendingTrees    = [];

function loadTreeGLB(){
  makeDracoLoader().load("assets/tree-mesh-v1.glb",
    gltf=>{
      gltf.scene.traverse(c=>{
        if(c.isMesh){
          c.castShadow=true; c.receiveShadow=true;
          if(c.material){
            c.material = c.material.clone();
            c.material.side = THREE.DoubleSide;
            c.material.needsUpdate = true;
          }
        }
      });
      const bbox = new THREE.Box3().setFromObject(gltf.scene);
      if(bbox.min.y < 0) gltf.scene.position.y = -bbox.min.y;
      treeGLBTemplate = gltf.scene;
      pendingTrees.forEach(({x,y,z,scale})=>_placeTreeGLB(x,y,z,scale));
      pendingTrees=[];
      console.log("Tree GLB loaded OK");
    },
    null,
    err=>{
      console.warn("Tree GLB failed, procedural fallback:", err.message||err);
      pendingTrees.forEach(({x,y,z,scale})=>_fallbackTree(x,y,z,scale));
      pendingTrees=[];
    }
  );
}

function _fallbackTree(x,y,z,scale=1){
  cyl(.15,.22,4*scale,6,new THREE.MeshStandardMaterial({color:0x5c3c18,roughness:.88}),[x,2*scale,z]);
  const cr=new THREE.Mesh(new THREE.SphereGeometry(1.8*scale,6,5),MATS.grassGreen());
  cr.position.set(x,(4+1.8)*scale,z); cr.castShadow=true; scene.add(cr);
}

function _placeTreeGLB(x,y,z,scale=1){
  if(!treeGLBTemplate){ pendingTrees.push({x,y,z,scale}); return; }
  const group = new THREE.Group();
  group.position.set(x, y || 0, z);
  // Fast mode: single clone (saves 2/3 draw calls per tree)
  const cloneCount = PERF_MODE === 'fast' ? 1 : 3;
  for(let i=0;i<cloneCount;i++){
    const clone = treeGLBTemplate.clone(true);
    clone.rotation.y = (i * Math.PI * 2) / Math.max(cloneCount,1);
    clone.scale.setScalar(scale);
    const jitter = 0.95 + Math.random()*0.1;
    clone.scale.multiplyScalar(jitter);
    group.add(clone);
  }
  scene.add(group);
}

function addTreeAt(x,y,z,scale=1){
  if(isInNoBuildZone(x,z)) return;
  _placeTreeGLB(x, y||0, z, scale);
}

function addLandscaping(){
  return; // TEMPORARILY DISABLED TO FOCUS ON MOVEMENT PERFORMANCE
}

//        TICK
let _tickFrame = 0;
export function tickScene(elapsed, camera){
  _tickFrame++;
  tickWater(waterMeshes, elapsed);
  tickGrass(camera);

  // Palm billboard face-camera: rate-limited in Fast/Balanced modes
  const palmDiv = PERF_SETTINGS[PERF_MODE].palmTickDiv;
  if (_tickFrame % palmDiv === 0) {
    palmBillboards.forEach(s=>{
      s.rotation.y=Math.atan2(camera.position.x-s.position.x,camera.position.z-s.position.z);
    });
  }
}

export function getRenderer() { return renderer; }
export function getScene()    { return scene;    }
export function getCamera()   { return camera;   }
export function getClock()    { return clock;    }
