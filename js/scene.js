/**
 * Project XIX     Scene v20
 * SINGLE SOURCE OF TRUTH: PROJECT_XIX_COMPLETE_VR_DEVELOPER_BRIEF v3.0
 * All positions, dimensions, materials from the authoritative ECAD brief.
 *
 * COORDINATE SYSTEM (locked):
 *   Origin = field centre. X=East(+)/West(-). Z=South(+)/North(-). Y=up.
 *   Eye height = 1.65m.
 *
 * KEY POSITIONS (from brief Section 2):
 *   Field: 274m E-W x 146m N-S
 *   Safety zone: N z=-98, S z=+98, W x=-148, E x=+148
 *   Ring road: W x=-152, E x=+152
 *   Villa inner: W x=-162, E x=+162. Outer: W x=-192, E x=+192
 *   Lake: centre (x=+30, z=-115), W cap x=-70, E cap x=+120
 *   Crescent road: z=-168 (parabolic bow, formula in addLoftTerraces)
 *   N villa row: z=-132 base (bow peak z=-149)
 *   Clubhouse: x=+80, z=+155 (east of centreline)
 *   Training field: x=-390, z=+195
 *   Stables: x=-375, z=+80 to +100
 *   Apartment blocks: x=-248
 *   Paddock: x=+212
 *   Commercial plots: x=+240, z=-185 (LASG Road frontage, NE)
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { RGBELoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/RGBELoader.js";
import { GLTFLoader }  from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/DRACOLoader.js";
import { PBR, createWaterMat, addGrassField, tickGrass, tickWater } from "./graphics.js";
import {
  MAT_GRASS_FIELD, MAT_DIRT, MAT_ASPHALT,
  MAT_BRICK, MAT_CONCRETE, MAT_TIMBER, MAT_STONE, MAT_TILE_ROOF,
  MAT_GLASS, MAT_GLASS_WARM, MAT_WHITE_TRIM, MAT_GOLD, MAT_DARK_METAL, MAT_WATER,
} from "./materials.js";

//        MODULE STATE                                                                                                                                                                                           
let scene, renderer, camera, clock, skyMesh;
let waterMeshes = [], palmBillboards = [];

// GLB templates (load once, clone per instance)
let villaGLBTemplate=null, aptGLBTemplate=null, loftGLBTemplate=null;
let clubGLBTemplate=null,   stablesGLBTemplate=null;

// Pending queues while GLBs load async
let pendingVillas=[], pendingApts=[], pendingLofts=[];

// Plot reservation
export const plotRegistry = new Map();
export let onPlotSelected = null;

// GLB constants (scale to real-world dimensions)
const VILLA_SCALE=12.56, VILLA_Y=4.94;    // 16.5m wide, 11.6m tall
const APT_SCALE=31.18,   APT_Y=7.95;     // 42m wide, 23m tall
const LOFT_SCALE=20.0,   LOFT_Y=1.34;    // 34m wide, 6.9m tall
const CLUB_SCALE=60.975, CLUB_Y=13.38;   // 110m wide, 29.6m tall
const STAB_SCALE=18.846, STAB_Y=2.50;    // 36m wide, 4.9m tall

//        INIT                                                                                                                                                                                                                   
export function initScene(canvas) {
  clock = new THREE.Clock();
  renderer = new THREE.WebGLRenderer({ canvas, antialias:true, powerPreference:"high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  renderer.shadowMap.enabled  = true;
  renderer.shadowMap.type     = THREE.PCFSoftShadowMap;
  renderer.toneMapping        = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure= 0.88;
  renderer.outputColorSpace   = THREE.SRGBColorSpace;
  scene  = new THREE.Scene();
  scene.background = new THREE.Color(0x88b8cc);
  scene.fog = new THREE.FogExp2(0x88b8cc, 0.0009);
  camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1600);
  loadHDRI();
  buildLighting();
  buildSky();
  buildEnvironment();
  loadVillaGLB();
  loadApartmentGLB();
  loadLoftGLB();
  loadClubhouseGLB();
  loadStablesGLB();
  return { scene, renderer, camera, clock };
}

//        HDRI (soft procedural env for glass reflections)                                                                            
function loadHDRI() {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envC = document.createElement("canvas"); envC.width=4; envC.height=4;
    const ex = envC.getContext("2d"); ex.fillStyle="#88b8cc"; ex.fillRect(0,0,4,4);
    const envTex = new THREE.CanvasTexture(envC);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(envTex).texture;
    pmrem.dispose(); envTex.dispose();
  } catch(e) { console.warn("PMREM env skipped:", e.message); }
}

//        LIGHTING                                                                                                                                                                                                       
let sunLight, hemiLight;
export function getSunLight()  { return sunLight; }
export function getHemiLight() { return hemiLight; }

function buildLighting() {
  hemiLight = new THREE.HemisphereLight(0xb8d4f0, 0x6a8040, 1.4);
  scene.add(hemiLight);
  const ambFill = new THREE.AmbientLight(0xfff8f0, 0.55);
  scene.add(ambFill);
  sunLight = new THREE.DirectionalLight(0xffe8b0, 2.8);
  sunLight.position.set(-180, 200, 100);
  sunLight.castShadow = true;
  sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -300;
  sunLight.shadow.camera.right = sunLight.shadow.camera.top  =  300;
  sunLight.shadow.camera.far   = 700;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.bias        = -0.0003;
  sunLight.shadow.normalBias  =  0.02;
  sunLight.shadow.radius      =  2;
  scene.add(sunLight);
  const fill = new THREE.DirectionalLight(0xb8d0e8, 0.45);
  fill.position.set(120, 80, -100); scene.add(fill);
  // Clubhouse warm glow (x=+80, z=+155)
  [[-30,8,162],[80,8,155],[190,8,162]].forEach(p => {
    const pt = new THREE.PointLight(0xffe0a0, 1.8, 48, 2);
    pt.position.set(...p); scene.add(pt);
  });
}

//        SKY                                                                                                                                                                                                                      
function buildSky() {
  const skyC = document.createElement("canvas"); skyC.width=4; skyC.height=256;
  const sc = skyC.getContext("2d");
  const g = sc.createLinearGradient(0,0,0,256);
  g.addColorStop(0,"#1a3a6a"); g.addColorStop(.45,"#5a9acc"); g.addColorStop(1,"#c8d8e0");
  sc.fillStyle=g; sc.fillRect(0,0,4,256);
  const st = new THREE.CanvasTexture(skyC); st.colorSpace=THREE.SRGBColorSpace;
  skyMesh = new THREE.Mesh(new THREE.SphereGeometry(900,32,16),
    new THREE.MeshBasicMaterial({map:st, side:THREE.BackSide}));
  scene.add(skyMesh);
  const sunM = new THREE.Mesh(new THREE.SphereGeometry(15,16,8),
    new THREE.MeshBasicMaterial({color:0xffe8b0}));
  sunM.position.set(-300,310,180); scene.add(sunM);
  const cm = new THREE.MeshBasicMaterial({color:0xfdfcfa,transparent:true,opacity:.65,side:THREE.DoubleSide});
  [[-180,260,-300],[80,270,-350],[220,250,-280],[-300,240,-180],[140,268,-400]].forEach(([x,y,z])=>{
    for(let i=0;i<4;i++){
      const m=new THREE.Mesh(new THREE.SphereGeometry(28+Math.random()*24,8,5),cm);
      m.scale.y=.28; m.position.set(x+(Math.random()-.5)*65,y+Math.random()*10,z+(Math.random()-.5)*42);
      scene.add(m);
    }
  });
}

export function updateSky(top,hor,gnd) {
  if(!skyMesh) return;
  const c=document.createElement("canvas"); c.width=4; c.height=256;
  const sx=c.getContext("2d");
  const g=sx.createLinearGradient(0,0,0,256);
  g.addColorStop(0,top); g.addColorStop(.5,hor); g.addColorStop(1,gnd);
  sx.fillStyle=g; sx.fillRect(0,0,4,256);
  skyMesh.material.map=new THREE.CanvasTexture(c);
  skyMesh.material.needsUpdate=true;
}

//        HELPERS                                                                                                                                                                                                          
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

// Distinct material palette
const MATS = {
  safetyBrown: ()=>new THREE.MeshStandardMaterial({color:0x8B4513,roughness:.95}),
  grassGreen:  ()=>new THREE.MeshStandardMaterial({color:0x4a8a38,roughness:.92}),
  hedgeGreen:  ()=>new THREE.MeshStandardMaterial({color:0x2a5a20,roughness:.95}),
  lawnGreen:   ()=>new THREE.MeshStandardMaterial({color:0x4a8a38,roughness:.9}),
  roadAsph:    ()=>new THREE.MeshStandardMaterial({color:0x1a1e1c,roughness:.88}),
  concrete:    ()=>new THREE.MeshStandardMaterial({color:0xc8c0b0,roughness:.8}),
  cobble:      ()=>new THREE.MeshStandardMaterial({color:0x9A7A5A,roughness:.9}),
  flatGrey:    ()=>new THREE.MeshStandardMaterial({color:0xDDDDDD,roughness:.7}),
  railWhite:   ()=>new THREE.MeshStandardMaterial({color:0xfcfaf8,roughness:.5}),
  stableRoof:  ()=>new THREE.MeshStandardMaterial({color:0xB05020,roughness:.8}),
  stableBrick: ()=>new THREE.MeshStandardMaterial({color:0xC04020,roughness:.85}),
};

//        GLB LOADING SYSTEM                                                                                                                                                                         
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
      gltf.scene.position.y = yOff;
      gltf.scene.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          child.frustumCulled = true;
        }
      });
      onDone(gltf.scene);
    },
    undefined,
    err => { console.error("GLB failed:", path, err.message||err); if(onFail) onFail(); }
  );
}

function loadVillaGLB(){
  loadOneGLB("assets/villa-mesh.glb", VILLA_SCALE, VILLA_Y, tmpl=>{
    villaGLBTemplate=tmpl; villaGLBScene=tmpl;
    pendingVillas.forEach(p=>placeVillaGLB(p.x,p.z,p.ry,p.plotKey));
    pendingVillas=[]; console.log("Villa GLB OK");
  }, ()=>{pendingVillas=[];});
}

function loadApartmentGLB(){
  loadOneGLB("assets/apartment-mesh.glb", APT_SCALE, APT_Y, tmpl=>{
    aptGLBTemplate=tmpl; aptGLBScene=tmpl;
    pendingApts.forEach(p=>placeAptGLB(p.x,p.z,p.ry));
    pendingApts=[]; console.log("Apt GLB OK");
  }, ()=>{pendingApts=[];});
}

function loadLoftGLB(){
  loadOneGLB("assets/loft-mesh.glb", LOFT_SCALE, LOFT_Y, tmpl=>{
    loftGLBTemplate=tmpl; loftGLBScene=tmpl;
    pendingLofts.forEach(p=>placeLoftGLB(p.x,p.z,p.ry));
    pendingLofts=[]; console.log("Loft GLB OK");
  }, ()=>{pendingLofts=[];});
}

function loadClubhouseGLB(){
  // Clubhouse: x=+80, z=+155 (east of centreline), facing north (ry=PI)
  loadOneGLB("assets/clubhouse-mesh.glb", CLUB_SCALE, CLUB_Y, tmpl=>{
    clubGLBTemplate=tmpl;
    const g=new THREE.Group(); g.position.set(80,0,155); g.rotation.y=Math.PI;
    g.add(tmpl.clone(true)); scene.add(g);
    console.log("Clubhouse GLB OK");
  });
}

function loadStablesGLB(){
  // Stables: SW compound, x=-375, z=+80 to +100 (brief Section 2)
  loadOneGLB("assets/stables-mesh.glb", STAB_SCALE, STAB_Y, tmpl=>{
    stablesGLBTemplate=tmpl;
    const g=new THREE.Group(); g.position.set(-375,0,90);
    g.add(tmpl.clone(true)); scene.add(g);
    console.log("Stables GLB OK");
  });
}

let villaGLBScene=null; // alias for legacy code
let aptGLBScene=null;
let loftGLBScene=null;

function placeVillaGLB(x,z,ry,plotKey) {
  ry=ry||0;
  if(!villaGLBTemplate){pendingVillas.push({x,z,ry,plotKey}); return;}
  const container=new THREE.Group();
  container.position.set(x,0,z); container.rotation.y=ry;
  container.userData.isVillaGLB=true; container.userData.baseRotY=ry;
  container.userData.plotKey=plotKey;
  container.add(villaGLBTemplate.clone(true));
  scene.add(container);
  if(plotKey) addPlotOverlay(x,z,ry,plotKey,container);
}

function placeAptGLB(x,z,ry=0){
  if(!aptGLBTemplate){pendingApts.push({x,z,ry}); return;}
  const g=new THREE.Group(); g.position.set(x,0,z); g.rotation.y=ry;
  g.add(aptGLBTemplate.clone(true)); scene.add(g);
}

function placeLoftGLB(x,z,ry){
  ry=ry||0;
  if(!loftGLBTemplate){pendingLofts.push({x,z,ry}); return;}
  const g=new THREE.Group(); g.position.set(x,0,z); g.rotation.y=ry;
  g.add(loftGLBTemplate.clone(true)); scene.add(g);
}

//        ENVIRONMENT                                                                                                                                                                                              
function buildEnvironment(){
  addGround();
  addPoloField();
  addSafetyZone();
  addYardMarkings();
  addRoads();
  addLake();
  addEastLake();
  addClubhouse();
  addVillaRing();
  addLoftTerraces();
  addWestCompound();
  addPaddock();
  addGamePark();
  addCommercialPlots();
  addServiceCompound();
  addGrassRing();
  addLandscaping();
}

//        GROUND                                                                                                                                                                                                             
function addGround(){
  // Estate grass base (no orange dirt     brief Section 11)
  s(plane(900,700,MATS.lawnGreen(),[0,0,30]));
  s(plane(500,400,MATS.grassGreen(),[0,.01,0]));
  // Clubhouse forecourt paving (x=+80, z=+178)
  s(plane(120,50,MATS.concrete(),[80,.02,178]));
  // Stables courtyard cobblestone (brief: #9A7A5A)
  s(plane(90,60,MATS.cobble(),[-355,.02,90]));
  // West compound lawn
  s(plane(200,320,MATS.lawnGreen(),[-310,.01,100]));
}

//        POLO FIELD (brief Section 5, Zone E)                                                                                                                
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
  // Centre line (Z axis, full field length)
  const lm=new THREE.MeshStandardMaterial({color:0xF8F5E0,roughness:.4});
  s(box(.5,.05,146,lm,[0,.14,0],0,false));
  // East-West centre line
  s(box(274,.05,.5,lm,[0,.14,0],0,false));
}

//        SAFETY ZONE (brief: #8B4513, N z=-98, S z=+98, W x=-148, E x=+148)                   
function addSafetyZone(){
  const dm=MATS.safetyBrown();
  s(plane(298,25,dm,[0,.11,-85.5]));   // N cap z=-73 to -98
  s(plane(298,25,dm,[0,.11, 85.5]));   // S cap
  s(plane(11,146,dm,[-142.5,.11,0]));  // W strip
  s(plane(11,146,dm,[ 142.5,.11,0]));  // E strip
  for(const [cx,cz] of [[-132,-80],[132,-80],[-132,80],[132,80]])
    s(plane(20,20,dm,[cx,.11,cz]));
}

//        YARD MARKINGS (brief: 30yd=27.43m, 40yd=36.58m, 60yd=54.86m)                                     
function addYardMarkings(){
  const lm=new THREE.MeshStandardMaterial({color:0xF8F5E0,roughness:.4});
  for(const side of [-1,1]) for(const d of [27.43,36.58,54.86])
    s(box(.5,.05,146,lm,[side*(137-d),.14,0],0,false));
  // Goalposts BOTH ends (brief: at x=-137 AND x=+137)
  const pm=MATS.railWhite(); pm.metalness=.2;
  for(const gx of [-137,137]) for(const pz of [0,-7.3,7.3])
    s(cyl(.12,.12,3,8,pm,[gx,1.5,pz]));
  // Training field yard markings (brief Zone K)
  for(const mz of [+155,+195,+235])
    s(box(100,.05,.4,lm,[-390,.14,mz],0,false));
  // Training field goalposts
  for(const gz of [+155,+235]) for(const pz of [0,-7.3,7.3])
    s(cyl(.12,.12,3,8,pm,[-390,1.5,gz+pz]));
}

//        ROADS (brief Section 7)                                                                                                                                                          
function addRoads(){
  const am=MATS.roadAsph();
  const lm=new THREE.MeshStandardMaterial({color:0xf0ecd0,roughness:.5});
  const Y=.13;

  // Lagos Road z=+215, 30m wide dual carriageway
  s(plane(700,30,am,[0,Y,215]));
  s(plane(700,4,MATS.grassGreen(),[0,Y+.01,215])); // 4m median
  for(let x=-300;x<=300;x+=18) s(box(8,.04,.35,lm,[x,Y+.03,215],0,false));

  // LASG Road z=-200, 20m wide
  s(plane(700,20,am,[0,Y,-200]));

  // Crescent road z=-168 (parabolic, brief Zone B formula)
  for(let x=-310;x<=265;x+=8){
    const bow = 8*(1-Math.min(1,(Math.abs(x)-82)/130));
    const cz = -168 - (Math.abs(x)<82 ? bow : 0);
    s(plane(8,8,am,[x,Y,cz]));
  }

  // Ring road (brief Section 7): W x=-152, E x=+152, N z=-104, S z=+104
  s(plane(8,210,am,[-152,Y,0]));
  s(plane(8,210,am,[ 152,Y,0]));
  s(plane(310,8,am,[0,Y,-104]));
  s(plane(310,8,am,[0,Y,104]));
  for(const [cx,cz] of [[-148,-100],[148,-100],[-148,100],[148,100]])
    s(plane(16,16,am,[cx,Y,cz]));

  // Internal villa lanes (brief: W x=-174, E x=+174)
  s(plane(8,220,am,[-174,Y,0]));
  s(plane(8,220,am,[ 174,Y,0]));

  // North setback road (between ring z=-104 and N villa row z~-132)
  s(plane(320,7,am,[30,Y,-118]));

  // South internal E-W connector + clubhouse approach
  s(plane(400,8,am,[0,Y,128]));
  // Clubhouse forecourt road and palm avenue axis (x=+80)
  s(plane(55,8,am,[80,Y,120]));
  s(plane(55,40,MATS.concrete(),[80,Y,175])); // forecourt paving

  // West compound roads (brief Section 7)
  s(plane(8,320,am,[-270,Y,80]));  // main N-S spine x=-270
  s(plane(8,320,am,[-230,Y,80]));  // secondary x=-230
  s(plane(150,8,am,[-310,Y,145])); // E-W stables access z=+145
  s(plane(8,140,am,[-170,Y,110])); // training field east side x=-170

  // East compound road (brief: x=+200)
  s(plane(8,260,am,[200,Y,10]));

  // Clubhouse entrance road from east (brief: east boundary access)
  s(plane(55,8,am,[200,Y,155]));
}

//        LAKE (brief Zone C: centre x=+30,z=-115, W cap x=-70, E cap x=+120)                
function addLake(){
  const wm=createWaterMat();
  // Flat PlaneGeometry     no sphere caps (they cause edge bulges)
  const main=new THREE.Mesh(new THREE.PlaneGeometry(190,26),wm);
  main.rotation.x=-Math.PI/2; main.position.set(30,.15,-115);
  main.receiveShadow=true; scene.add(main); waterMeshes.push(main);
  // West arm to x=-70
  const wA=new THREE.Mesh(new THREE.PlaneGeometry(28,18),wm);
  wA.rotation.x=-Math.PI/2; wA.rotation.z=.18; wA.position.set(-67,.14,-116);
  scene.add(wA); waterMeshes.push(wA);
  // East arm to x=+120
  const eA=new THREE.Mesh(new THREE.PlaneGeometry(28,18),wm);
  eA.rotation.x=-Math.PI/2; eA.rotation.z=-.12; eA.position.set(118,.14,-115);
  scene.add(eA); waterMeshes.push(eA);
  // Shore grass strips (6m wide each, brief Section 8)
  s(plane(230,6,MATS.grassGreen(),[30,.12,-102])); // south shore z=-102
  s(plane(230,6,MATS.grassGreen(),[30,.12,-128])); // north shore z=-128
  // Lake south shore palms: 1 every 16m at z=-104 (brief Section 8)
  for(let x=-90;x<=115;x+=16) addPalmSprite(x,.1,-104,1.1);
}

//        EAST LAKE (brief Zone I: paddock side water feature)                                                                
function addEastLake(){
  const wm=createWaterMat();
  const el=new THREE.Mesh(new THREE.PlaneGeometry(20,40),wm);
  el.rotation.x=-Math.PI/2; el.position.set(215,.14,-40);
  scene.add(el); waterMeshes.push(el);
}

//        CLUBHOUSE (brief: x=+80,z=+155, GLB handles visual, add surroundings)             
function addClubhouse(){
  // Parking (brief: ~28 bays, z~+178, x=+80)
  const am=MATS.roadAsph();
  const bayM=MATS.railWhite();
  s(plane(50,22,am,[40,.13,185]));
  s(plane(50,22,am,[120,.13,185]));
  for(const bx of [40,120]) for(let i=-22;i<=22;i+=4.5)
    s(box(.06,.04,5.5,bayM,[bx+i,.16,185],0,false));
  // Clubhouse approach avenue palms (brief Section 8: x=+-12 to +-16, z=+95 to +140)
  for(let pz=95;pz<=140;pz+=8){
    addPalmSprite(68,.1,pz,1.3);   // west of approach axis
    addPalmSprite(92,.1,pz,1.3);   // east
  }
}

//        VILLA RING                                                                                                                                                                                                 
// 43 villas total (brief Section 3).
// West: ONE inner column x=-162. East: inner x=+162 AND outer x=+192.
// North: 15 villas in one parabolic E-W row (brief Zone D formula).
// South: small arc flanking clubhouse.
function addVillaRing(){
  const PLOT=28; // 22m villa + 5m minimum gap (brief: 5m minimum)

  // WEST INNER column (x=-162, 8 units, facing east toward field)
  for(let i=0;i<8;i++){
    const z=-96+i*PLOT;
    placeVillaWithLandscape(-162,z,Math.PI/2);
  }

  // EAST INNER column (x=+162, 8 units, facing west toward field)
  for(let i=0;i<8;i++){
    const z=-96+i*PLOT;
    placeVillaWithLandscape(162,z,-Math.PI/2);
  }

  // EAST OUTER column (x=+192, 7 units staggered, brief east compound)
  for(let i=0;i<7;i++){
    const z=-82+i*PLOT;
    placeVillaWithLandscape(192,z,-Math.PI/2);
  }

  // NORTH ROW     15 villas, one continuous E-W row with parabolic bow
  // Brief Zone D formula (authoritative):
  // base z=-132, peak bow=-17m at lake centre x=+30, radius=90m
  const LAKE_CX=30, LAKE_R=90, MAX_BOW=17;
  const northX=[-140,-116,-92,-68,-44,-20,4,28,52,76,100,124,148,172,196];
  northX.forEach(x=>{
    const dx=x-LAKE_CX;
    const bow=dx*dx<LAKE_R*LAKE_R ? MAX_BOW*(1-(dx*dx)/(LAKE_R*LAKE_R)) : 0;
    placeVillaWithLandscape(x,-132-bow,0); // all face south (ry=0)
  });

  // SOUTH ARC     flanking clubhouse, |x|>=65 only (brief: gap for clubhouse at x=+80)
  // South villa arc z~+105 to +118 (brief Section 2)
  for(const side of [-1,1]){
    [65,93,121].forEach(xabs=>{
      const x=side*xabs;
      const z=105+Math.abs(x)*.04;
      placeVillaWithLandscape(x,z,0); // face north toward field
    });
  }
}

function placeVillaWithLandscape(x,z,ry){
  const plotKey=`${Math.round(x)},${Math.round(z)}`;
  placeVillaGLB(x,z,ry,plotKey);
  addPlotLandscaping(x,z,ry);
}

function addPlotLandscaping(vx,vz,ry){
  const hm=MATS.hedgeGreen();
  const gm=new THREE.MeshStandardMaterial({color:0x8a7050,roughness:.7,metalness:.2});
  const pm=new THREE.MeshStandardMaterial({color:0xd0c8b4,roughness:.8});
  const g=new THREE.Group(); g.position.set(vx,0,vz); g.rotation.y=ry;
  const hl=new THREE.Mesh(new THREE.BoxGeometry(.4,1.1,18),hm);
  hl.position.set(-10,.55,0); g.add(hl);
  const hr=hl.clone(); hr.position.set(10,.55,0); g.add(hr);
  const hf=new THREE.Mesh(new THREE.BoxGeometry(18,.7,.4),hm);
  hf.position.set(0,.35,-10); g.add(hf);
  for(const gx of [-2.5,2.5]){
    const gp=new THREE.Mesh(new THREE.BoxGeometry(.3,1.5,.3),gm);
    gp.position.set(gx,.75,-10); g.add(gp);
  }
  const dp=new THREE.Mesh(new THREE.PlaneGeometry(4.5,5),pm);
  dp.rotation.x=-Math.PI/2; dp.position.set(0,.02,-7.5); g.add(dp);
  scene.add(g);
  // 2 cypress trees per villa, flanking undercroft entry (brief Section 8)
  const fwdX=Math.sin(ry)*(-9), fwdZ=Math.cos(ry)*(-9);
  const rX=Math.cos(ry)*8,      rZ=-Math.sin(ry)*8;
  addCypressAt(vx+rX+fwdX, vz+rZ+fwdZ);
  addCypressAt(vx-rX+fwdX, vz-rZ+fwdZ);
}

//        LOFT TERRACES (brief Zone B + Zone N)                                                                                                             
// Zone B: 88 units on crescent road, groups of 4, step=28m
// Brief formula: const bow=8*(1-Math.min(1,(Math.abs(x)-82)/130));
//               const z=-168-bow; skip abs(x)<82
// Zone N: 2 south compound clusters at (-80,+170) and (+10,+170)
function addLoftTerraces(){
  // CRESCENT ROAD LOFT ROW (Zone B)
  // West arm x=-310 to -82, step 28m, facing south
  for(let x=-310;x<=-82;x+=28){
    const bow=8*(1-Math.min(1,(Math.abs(x)-82)/130));
    const cz=-168-bow;
    placeLoftGLB(x,cz,Math.PI);
  }
  // East arm x=+82 to +265, step 28m
  for(let x=82;x<=265;x+=28){
    const bow=8*(1-Math.min(1,(Math.abs(x)-82)/130));
    const cz=-168-bow;
    placeLoftGLB(x,cz,Math.PI);
  }

  // ZONE N     South compound loft clusters (brief Section 5, Zone N)
  placeLoftGLB(-80,170,0);  // SW cluster, face north
  placeLoftGLB( 10,170,0);  // SE cluster, face north
}

//        WEST COMPOUND (brief Zone K)                                                                                                                                        
// ORDER (field outward east to west):
// 1. One villa column x=-162 (done in addVillaRing)
// 2. Loft terraces x=-192 (N-S column, face east)
// 3. Block of flats x=-248 (E-W oriented, brief: 80m x 28m)
// 4. Training field x=-390, z=+195 centre (brief Section 2)
// Stables: x=-375, z=+80 to +100 (brief Section 2, handled by GLB)
function addWestCompound(){
  const gm=MAT_GRASS_FIELD(); const dm=MATS.safetyBrown();
  const PLOT=28;

  // LOFT TERRACES column (x=-192, N-S, face east)
  for(let i=0;i<7;i++){
    placeLoftGLB(-192,-82+i*PLOT,Math.PI/2);
  }

  // APARTMENT BLOCKS (x=-248, two blocks, brief: N z=-14, S z=+112... adjust to brief)
  // Brief says apartment blocks at x~-248, orientation E-W
  placeAptGLB(-248, -14, Math.PI/2);
  placeAptGLB(-248, 112, Math.PI/2);

  // TRAINING FIELD (brief: x=-390, z=+195 centre, N-S oriented ~80m x 100m)
  s(plane(120,130,dm,[-390,.06,195]));
  s(plane(100,110,gm,[-390,.10,195]));

  // West compound internal roads (brief Section 7)
  const am=MATS.roadAsph();
  s(plane(8,220,am,[-170,.12,80]));   // x=-170 training field east
  s(plane(8,320,am,[-220,.12,100]));  // x=-220 between lofts and flats
  s(plane(8,280,am,[-300,.12,100]));  // x=-300 between flats and training
}

//        PADDOCK (brief Zone I: x~+212, post-and-rail)                                                                                     
function addPaddock(){
  const PX=212, PZ=0, PW=30, PD=90;
  s(plane(PW,PD,MAT_GRASS_FIELD(),[PX,.07,PZ]));
  const post=MATS.railWhite(), rail=MATS.railWhite();
  const x1=PX-PW/2, x2=PX+PW/2, z1=PZ-PD/2, z2=PZ+PD/2;
  for(let fz=z1;fz<=z2;fz+=5){ s(cyl(.1,.1,1.7,6,post,[x1,.85,fz])); s(cyl(.1,.1,1.7,6,post,[x2,.85,fz])); }
  for(let fx=x1;fx<=x2;fx+=5){ s(cyl(.1,.1,1.7,6,post,[fx,.85,z1])); s(cyl(.1,.1,1.7,6,post,[fx,.85,z2])); }
  for(const h of [1.1,1.6]){
    s(box(.07,.07,PD,rail,[x1,h,PZ],0,false)); s(box(.07,.07,PD,rail,[x2,h,PZ],0,false));
    s(box(PW,.07,.07,rail,[PX,h,z1],0,false)); s(box(PW,.07,.07,rail,[PX,h,z2],0,false));
  }
  // East green area (brief Zone I: x=+240 to +290, z=-80 to -20)
  s(plane(50,60,MATS.grassGreen(),[265,.06,-50]));
  for(let tx=244;tx<=290;tx+=14) for(let tz=-78;tz<=-22;tz+=14)
    addTreeAt(tx,.1,tz,.8+Math.random()*.5);
}

//        GAME PARK / PLAY GROUND (brief Zone I, beside paddock)                                                          
function addGamePark(){
  s(plane(40,36,MAT_GRASS_FIELD(),[212,.07,62]));
  const cols=[0xe8602a,0x2a88c8,0xe8c82a,0x4ac84a];
  for(let i=0;i<5;i++){
    const h=2.6+i*.4;
    s(box(3.2,h,3.2,new THREE.MeshStandardMaterial({color:cols[i%4],roughness:.6}),
      [197+i*7,h/2,60+(i%2)*7]));
  }
}

//        COMMERCIAL PLOTS (brief Zone A: LASG Road frontage, NE corner)                                     
// Commercial Plot A: 917sqm, Plot B: 786sqm     at NE, LASG Road frontage
// Brief: north-east, z~-185, x~+240
function addCommercialPlots(){
  const gm=MATS.flatGrey(); const wm=MAT_WHITE_TRIM();
  // Plot A (917sqm ~30x30m)
  const gA=new THREE.Group(); gA.position.set(240,0,-185);
  gA.add(box(32,9,28,gm,[0,4.5,0]));
  gA.add(box(32,.55,30,wm,[0,9.3,0],0,false));
  scene.add(gA);
  // Plot B (786sqm ~28x28m)
  const gB=new THREE.Group(); gB.position.set(278,0,-185);
  gB.add(box(28,8,26,gm,[0,4.0,0]));
  gB.add(box(28,.5,28,wm,[0,8.1,0],0,false));
  scene.add(gB);
}

//        SERVICE COMPOUND (brief Zone M)                                                                                                                               
function addServiceCompound(){
  const redMat=new THREE.MeshStandardMaterial({color:0xcc2200,roughness:.7});
  const greyM=MATS.flatGrey(); const concM=MATS.concrete();
  // Service centre (red building, brief: position ~x=-240, z=+100)
  s(box(18,5.2,14,redMat,[-240,2.6,100]));
  s(box(19,.5,15,new THREE.MeshStandardMaterial({color:0xaa1800,roughness:.7}),[-240,5.1,100],0,false));
  // Mechanical & electrical (brief: x=-240, z=+100)
  s(box(30,6.5,17,greyM,[-280,3.25,100]));
  // FM/utility building
  s(box(20,4,12,concM,[-310,2,95]));
  // Quarantine / Vet (brief: x=-300, z=+95)
  s(box(20,4,10,concM,[-300,2,95]));
  // Trucks park (brief: x=-310, z=+120, hardstand)
  s(plane(50,30,MATS.roadAsph(),[-310,.12,120]));
  // Mini paddocks x2 (brief: beside stables)
  const fenceM=MATS.railWhite();
  for(const [px,pz] of [[-398,72],[-358,72]]){
    s(plane(22,18,MAT_GRASS_FIELD(),[px,.06,pz]));
    for(let fz=pz-9;fz<=pz+9;fz+=4){
      s(cyl(.08,.08,1.5,6,fenceM,[px-11,.75,fz]));
      s(cyl(.08,.08,1.5,6,fenceM,[px+11,.75,fz]));
    }
    for(let fx=px-11;fx<=px+11;fx+=4){
      s(cyl(.08,.08,1.5,6,fenceM,[fx,.75,pz-9]));
      s(cyl(.08,.08,1.5,6,fenceM,[fx,.75,pz+9]));
    }
    s(box(.06,.06,18,fenceM,[px-11,1.1,pz],0,false));
    s(box(.06,.06,18,fenceM,[px+11,1.1,pz],0,false));
    s(box(22,.06,.06,fenceM,[px,1.1,pz-9],0,false));
    s(box(22,.06,.06,fenceM,[px,1.1,pz+9],0,false));
  }
}

//        GRASS CARD RING (brief: polo field perimeter density)                                                             
function addGrassRing(){
  const cards=[
    ...addGrassField(0,-115,140,12,60),
    ...addGrassField(0, 115,140,12,60),
    ...addGrassField(-165,0,12,90,40),
    ...addGrassField( 165,0,12,90,40),
  ];
  cards.forEach(card=>scene.add(card));
}

//        LANDSCAPING SYSTEM (brief Section 8)                                                                                                                
function addLandscaping(){
  // Lagos Road z=+215: 1 palm every 10m both sides (brief)
  for(let x=-280;x<=280;x+=10){ addPalmSprite(x,.1,206,1.3); addPalmSprite(x,.1,224,1.2); }
  // LASG Road z=-200: 1 palm every 12m inside edge
  for(let x=-280;x<=280;x+=12) addPalmSprite(x,.1,-196,1.0);
  // Ring road outer: 1 palm every 15m all 4 segments (brief)
  for(let z=-100;z<=100;z+=15){ addPalmSprite(-160,.1,z,1.1); addPalmSprite(160,.1,z,1.1); }
  for(let x=-150;x<=150;x+=15){ addPalmSprite(x,.1,-108,1.1); addPalmSprite(x,.1,108,1.1); }
  // North canopy backdrop z=-205 to -220 (brief Section 8)
  for(let x=-310;x<=310;x+=18) addTreeAt(x,.1,-210,.8+Math.random()*.5);
  // East green area dense trees (brief Section 8: x=+240 to +290, z=-80 to -20)
  for(let tx=244;tx<=290;tx+=14) for(let tz=-78;tz<=-22;tz+=14)
    addTreeAt(tx,.1,tz,.7+Math.random()*.6);
  // Perimeter belt
  for(let x=-300;x<=300;x+=35){ addPalmSprite(x,.1,-225,.9); addPalmSprite(x,.1,218,.9); }
  for(let z=-220;z<=218;z+=35){ addPalmSprite(-315,.1,z,.9); addPalmSprite(315,.1,z,.9); }
  // Stables compound: 1 palm at each corner of each block (brief Section 8)
  [[-395,78],[-395,100],[-355,78],[-355,100]].forEach(([x,z])=>addPalmSprite(x,.1,z,1.1));
}

//        PALM SPRITES                                                                                                                                                                                           
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
  initPalmMats();
  const mat=palmMats[Math.floor(Math.random()*palmMats.length)];
  const h=(13+Math.random()*5)*scale, w=h*.5;
  for(const ry of [0,Math.PI/2]){
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);
    m.position.set(x,y+h/2,z); m.rotation.y=ry;
    scene.add(m); palmBillboards.push(m);
  }
}
function addCypressAt(x,z){
  const trunkM=new THREE.MeshStandardMaterial({color:0x4a3010,roughness:.9});
  const coneM=MATS.hedgeGreen();
  s(cyl(.18,.24,5,8,trunkM,[x,2.5,z]));
  const cone=new THREE.Mesh(new THREE.ConeGeometry(.65,4.5,8),coneM);
  cone.position.set(x,5.5,z); cone.castShadow=true; scene.add(cone);
}
function addTreeAt(x,y,z,scale=1){
  const trunkM=new THREE.MeshStandardMaterial({color:0x5c3c18,roughness:.88});
  const leafM=MATS.grassGreen();
  s(cyl(.14,.2,4*scale,8,trunkM,[x,2*scale,z]));
  const cr=new THREE.Mesh(new THREE.SphereGeometry(1.6*scale,8,6),leafM);
  cr.position.set(x,(4+1.6)*scale,z); cr.castShadow=true; scene.add(cr);
}

//        PLOT RESERVATION SYSTEM                                                                                                                                                          
function addPlotOverlay(x,z,ry,plotKey,villaClone){
  const mat=new THREE.MeshStandardMaterial({color:0x00ff88,transparent:true,opacity:.35});
  const overlay=new THREE.Mesh(new THREE.PlaneGeometry(20,18),mat);
  overlay.rotation.x=-Math.PI/2; overlay.rotation.y=ry;
  overlay.position.set(x,.25,z);
  overlay.userData.plotKey=plotKey;
  overlay.userData.isPlotOverlay=true;
  overlay.userData.villaClone=villaClone;
  scene.add(overlay);
  plotRegistry.set(plotKey,{status:"available",overlay,villaClone,x,z,ry});
}

export function reservePlot(plotKey){
  const plot=plotRegistry.get(plotKey);
  if(!plot||plot.status==="reserved") return false;
  plot.status="reserved";
  if(plot.villaClone) plot.villaClone.traverse(c=>{
    if(c.isMesh&&c.material){
      c.material=c.material.clone();
      c.material.color.set(0x888888);
      c.material.opacity=.7; c.material.transparent=true;
    }
  });
  if(plot.overlay){
    plot.overlay.material=new THREE.MeshStandardMaterial({color:0xff4444,transparent:true,opacity:.5});
  }
  plotRegistry.set(plotKey,plot); return true;
}

export function getPlotAtRay(raycaster){
  const overlays=[];
  scene.traverse(o=>{if(o.userData.isPlotOverlay) overlays.push(o);});
  const hits=raycaster.intersectObjects(overlays,false);
  return hits.length>0 ? hits[0].object.userData.plotKey : null;
}

//        TICK                                                                                                                                                                                                                   
export function tickScene(elapsed,camera){
  tickWater(waterMeshes,elapsed);
  tickGrass(camera);
  palmBillboards.forEach(s=>{
    s.rotation.y=Math.atan2(camera.position.x-s.position.x,camera.position.z-s.position.z);
  });
}

export function getRenderer(){ return renderer; }
export function getScene()   { return scene;    }
export function getCamera()  { return camera;   }
export function getClock()   { return clock;    }
