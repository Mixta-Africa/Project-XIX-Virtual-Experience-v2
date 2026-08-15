/**
 * Project XIX - Scene v11 (Full Commercial Grade - All 36 Audit Items)
 *
 * GROUND TRUTH (from pixel-measured plan-2d.png):
 *   North=-Z  South=+Z  East=+X  West=-X  Origin=field centre
 *   Polo field: 274m E-W x 146m N-S
 *   Safety zone: N z=-73 to -98, S z=+73 to +98, W x=-137 to -148, E x=+137 to +148
 *   Lake: centre x=-10,z=-78. Spans x=-115 to +90. Between safety zone and Tier1 villas.
 *   Ring road: runs BETWEEN safety zone outer edge and inner villa column
 *   Villas inner: W x=-162, E x=+162. Outer: W x=-185, E x=+185
 *   Clubhouse: x=0, z=+152 (centred, south of field)
 *   Blocks of flats: x=-248, N z=-25, S z=+55 (WEST compound, E-W oriented)
 *   Training field: x=-390, z=0 (N-S oriented)
 *   Stables: x=-375, z=+90
 *   Crescent road: z=-168 (north, curved parabolic: z = -168 - abs(x)*0.05)
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

//        MODULE STATE                                                                                                                                                                                        
let scene, renderer, camera, clock, skyMesh;
let waterMeshes = [], palmBillboards = [];

// Villa GLB (3-bed premium villa mesh)
const VILLA_SCALE = 12.56;
const VILLA_Y     = 4.94;
let villaGLBScene = null;
let pendingVillas  = [];

// Apartment GLB
const APT_SCALE = 31.18;
const APT_Y     = 7.95;

// Loft Terrace GLB
const LOFT_SCALE = 20.0;
const LOFT_Y     = 1.34;
let loftGLBScene = null;
let pendingLofts  = [];
let aptGLBScene  = null;
let pendingApts  = [];

// Plot reservation system
export const plotRegistry = new Map(); // key="x,z"     {status:"available"|"reserved"|"sold", color, mesh}
export let onPlotSelected = null;      // callback set by app.js

//        INIT                                                                                                                                                                                                                
export function initScene(canvas) {
  clock = new THREE.Clock();
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled   = true;
  renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88; // reduced - no HDR boost
  renderer.outputColorSpace    = THREE.SRGBColorSpace;
  scene  = new THREE.Scene();
  scene.background = new THREE.Color(0x8ab8cc);
  scene.fog = new THREE.FogExp2(0x8ab8cc, 0.0009); // reduced fog density
  camera = new THREE.PerspectiveCamera(65, 1, 0.1, 1600);
  loadHDRI();
  buildLighting();
  buildSky();
  buildEnvironment();
  loadVillaGLB();
  loadApartmentGLB();
  loadLoftGLB();
  return { scene, renderer, camera, clock };
}

//        HDRI                                                                                                                                                                                                                
// HDRI removed - caused white glare from Shanghai bund HDR
function loadHDRI() {
  // Generate soft environment map from scene colours (no HDR file needed)
  // Gives glass and metal surfaces subtle reflections without glare
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envC = document.createElement("canvas"); envC.width=4; envC.height=4;
    const ex = envC.getContext("2d"); ex.fillStyle="#88aac8"; ex.fillRect(0,0,4,4);
    const envTex = new THREE.CanvasTexture(envC);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(envTex).texture;
    pmrem.dispose(); envTex.dispose();
  } catch(e) { console.warn("PMREM env skipped:", e.message); }
}

//        LIGHTING                                                                                                                                                                                                    
let sunLight, hemiLight;
export function getSunLight() { return sunLight; }
export function getHemiLight() { return hemiLight; }

function buildLighting() {
  // Hemisphere (sky/ground bounce)
  // Hemisphere: warm sky colour to match tropical Lagos afternoon
  hemiLight = new THREE.HemisphereLight(0xb8d4f0, 0x6a8040, 1.4);
  scene.add(hemiLight);
  // Second ambient fill so GLB underfaces aren't black
  const ambFill = new THREE.AmbientLight(0xfff8f0, 0.55);
  scene.add(ambFill);
  // Main sun - afternoon SW elevation to show front face of villas
  sunLight = new THREE.DirectionalLight(0xffe8b0, 2.8);
  sunLight.position.set(-180, 200, 100);
  sunLight.castShadow = true;
  sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -420;
  sunLight.shadow.camera.right = sunLight.shadow.camera.top   =  420;
  sunLight.shadow.camera.far   = 1000;
  sunLight.shadow.mapSize.set(4096, 4096);
  sunLight.shadow.bias        = -0.0002;
  sunLight.shadow.normalBias  =  0.02;
  sunLight.shadow.radius      =  3.5;
  scene.add(sunLight);
  // Soft fill
  const fill = new THREE.DirectionalLight(0xb8d0e8, 0.45);
  fill.position.set(120, 80, -100); scene.add(fill);
  // Clubhouse interior glow
  [[-40,8,115],[0,8,115],[40,8,115]].forEach(p => {
    const pt = new THREE.PointLight(0xffe0a0, 2.0, 48, 2);
    pt.position.set(...p); scene.add(pt);
  });
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
  skyMesh = new THREE.Mesh(new THREE.SphereGeometry(900,32,16),
    new THREE.MeshBasicMaterial({map:st, side:THREE.BackSide}));
  scene.add(skyMesh);
  // Sun disc
  const sunM = new THREE.Mesh(new THREE.SphereGeometry(15,16,8),
    new THREE.MeshBasicMaterial({color:0xffe8b0}));
  sunM.position.set(-300,310,180); scene.add(sunM);
  // Clouds
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

// Distinct materials for each typology (Audit 3.3)
const MATS = {
  villaBody:  ()=>new THREE.MeshStandardMaterial({color:0xF5E6B0,roughness:.75,metalness:.02}), // warm cream-yellow
  villaRoof:  ()=>new THREE.MeshStandardMaterial({color:0xC9A84C,roughness:.65,metalness:.08}), // ochre gold
  loftBody:   ()=>new THREE.MeshStandardMaterial({color:0xE8E0D0,roughness:.78}),
  loftRoof:   ()=>new THREE.MeshStandardMaterial({color:0xD4622A,roughness:.7}),  // terracotta orange
  flatGrey:   ()=>new THREE.MeshStandardMaterial({color:0xDDDDDD,roughness:.7}),
  clubWhite:  ()=>new THREE.MeshStandardMaterial({color:0xF0ECE0,roughness:.7}),
  stableBrick:()=>new THREE.MeshStandardMaterial({color:0xC4A882,roughness:.88}),
  stableRoof: ()=>new THREE.MeshStandardMaterial({color:0x8B6914,roughness:.8}),
  roadAsph:   ()=>new THREE.MeshStandardMaterial({color:0x1a1e1c,roughness:.88}),
  safetyBrown:()=>new THREE.MeshStandardMaterial({color:0x8B4513,roughness:.95}), // saddle brown
  grassGreen: ()=>new THREE.MeshStandardMaterial({color:0x3a7a28,roughness:.92}),
  lawnGreen:  ()=>new THREE.MeshStandardMaterial({color:0x4a8a38,roughness:.9}),
  hedgeGreen: ()=>new THREE.MeshStandardMaterial({color:0x2a5a20,roughness:.95}),
  cobble:     ()=>new THREE.MeshStandardMaterial({color:0x9A7A5A,roughness:.9}),
  concrete:   ()=>new THREE.MeshStandardMaterial({color:0xc8c0b0,roughness:.8}),
  railWhite:  ()=>new THREE.MeshStandardMaterial({color:0xfcfaf8,roughness:.5}),
  plotAvail:  ()=>new THREE.MeshStandardMaterial({color:0x00ff88,transparent:true,opacity:.35}),
  plotReserved:()=>new THREE.MeshStandardMaterial({color:0xff4444,transparent:true,opacity:.5}),
};

//        ENVIRONMENT                                                                                                                                                                                              
function buildEnvironment(){
  addGround();
  addPoloField();
  addGrassRing();   // per-blade grass cards around field
  addSafetyZone();
  addYardMarkings();
  addRoads();
  addLake();
  addEastLake();
  addClubhouse();
  addVillaRing();        // GLB-based, with plot reservation
  addLoftTerraces();
  addWestCompound();     // flats GLB + training field
  addStables();
  addPaddock();
  addGamePark();
  addCommercialBlock();
  addServiceCompound();
  addLandscaping();      // systematic palms + trees (Audit 10.x)
}

//        GROUND (6 distinct materials - Audit 1.1)                                                                                                    
function addGround(){
  // Base laterite (only shows where nothing else is placed)
  // PBR ground surfaces
  s(plane(900,700,PBR.dirt(),[0,0,30]));
  s(plane(500,400,PBR.grass(),[0,.01,0]));
  // Clubhouse forecourt paving
  s(plane(180,80,MATS.concrete(),[0,.02,122]));
  // Stables courtyard
  s(plane(90,70,MATS.cobble(),[-355,.02,90]));
  // West compound ground
  s(plane(200,280,MATS.lawnGreen(),[-310,.01,30]));
}

//        POLO FIELD                                                                                                                                                                                                 
// GRASS CARD RING (alpha blades around field perimeter)
function addGrassRing(){
  const cards = [
    ...addGrassField( 0, -115, 140, 12, 250),
    ...addGrassField( 0,  115, 140, 12, 250),
    ...addGrassField(-165,  0,  12, 90, 160),
    ...addGrassField( 165,  0,  12, 90, 160),
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
  // Centre lines
  const lm=new THREE.MeshStandardMaterial({color:0xf8f5e0,roughness:.4});
  s(box(.5,.05,146,lm,[0,.14,0],0,false));
  s(box(274,.05,.5,lm,[0,.14,0],0,false));
}

//        SAFETY ZONE (saddle brown - Audit 2.3)                                                                                                             
function addSafetyZone(){
  const dm=PBR.dirt(); dm.color.set(0x8B4513); // saddle brown override on dirt PBR
  s(plane(298,25,dm,[0,.11,-85.5]));   // North
  s(plane(298,25,dm,[0,.11, 85.5]));   // South
  s(plane(11,146,dm,[-142.5,.11,0]));  // West
  s(plane(11,146,dm,[ 142.5,.11,0]));  // East
  for(const [cx,cz] of [[-132,-80],[132,-80],[-132,80],[132,80]])
    s(plane(20,20,dm,[cx,.11,cz]));
}

//        YARD MARKINGS (correct 30/40/60yd positions - Audit 2.1)                                                       
function addYardMarkings(){
  const lm=new THREE.MeshStandardMaterial({color:0xf8f5e0,roughness:.4});
  // From each goal (x=  137), 30yd=27.4m, 40yd=36.6m, 60yd=54.9m
  for(const side of[-1,1]) for(const d of[27.4,36.6,54.9])
    s(box(.5,.05,146,lm,[side*(137-d),.14,0],0,false));
  // Goal posts at BOTH east AND west ends (Audit 2.2)
  const pm=MATS.railWhite(); pm.metalness=.2;
  for(const gx of[-137,137]) for(const pz of[0,-7.3,7.3])
    s(cyl(.12,.12,3,8,pm,[gx,1.5,pz]));
  // Training field yard markings (Audit 7.1) + goalposts (Audit 7.2)
  for(const z of[-55,0,55]) s(box(100,.05,.4,lm,[-390,.14,z],0,false));
  for(const gz of[-80,80]) for(const pz of[0,-7.3,7.3])
    s(cyl(.12,.12,3,8,pm,[-390,1.5,gz+pz]));
}

//        ROADS (full network - Audit 1.2, 1.3, 1.4)                                                                                                 
function addRoads(){
  const am=PBR.asphalt();
  const lm=new THREE.MeshStandardMaterial({color:0xf0ecd0,roughness:.5});
  const Y=.13;

  // LAGOS ROAD - dual carriageway 30m wide (Audit 1.4)
  s(plane(700,30,am,[0,Y,215]));
  s(plane(700,4,MATS.grassGreen(),[0,Y+.01,215])); // median strip
  for(let x=-300;x<=300;x+=18) s(box(8,.04,.35,lm,[x,Y+.03,215],0,false));
  // Palms along Lagos Road (Audit 10.1)
  for(let x=-280;x<=280;x+=10) addPalmSprite(x,Y+.1,206,1.3);

  // CRESCENT ROAD (north, z=-168, curved)
  for(let x=-260;x<=260;x+=8){
    const cz=-168-Math.abs(x)*.05;
    s(plane(8,8,am,[x,Y,cz]));
  }

  // RING ROAD: sits BETWEEN safety zone edge and inner villa front face
  // W: safety zone edge x=-148, inner villa x=-162 -> road centreline x=-155
  // E: safety zone edge x=+148, inner villa x=+162 -> road centreline x=+155
  // N: safety zone edge z=-98,  inner villa z~-132 -> road centreline z=-104
  // S: safety zone edge z=+98,  inner villa z~+105 -> road centreline z=+104
  s(plane(8,220,am,[-155,Y,0]));    // W ring N-S (between safety zone and W villas)
  s(plane(8,220,am,[ 155,Y,0]));    // E ring N-S (between safety zone and E villas)
  s(plane(320,8,am,[0,Y,-104]));    // N ring E-W (between safety zone and N villas)
  s(plane(320,8,am,[0,Y,104]));     // S ring E-W (between safety zone and S villas)
  // Corner sweeps
  for(const[cx,cz] of[[-150,-100],[150,-100],[-150,100],[150,100]])
    s(plane(16,16,am,[cx,Y,cz]));

  // INTERNAL ACCESS ROAD (between inner x=-162 and outer x=-192 villa columns)
  // Sits at x=-177 (midpoint between -162 and -192)
  s(plane(8,220,am,[-177,Y,-5]));   // W internal lane
  s(plane(8,220,am,[ 177,Y,-5]));   // E internal lane

  // NORTH SETBACK ROAD (between north ring road z=-104 and villa south face z~-132)
  // Runs at z=-118     directly in front of north villa row
  s(plane(320,7,am,[30,Y,-118]));

  // SOUTH INTERNAL E-W connector + forecourt
  s(plane(400,8,am,[0,Y,128]));
  s(plane(130,35,am,[0,Y,148]));

  // WEST COMPOUND roads (Audit 1.3)
  s(plane(8,280,am,[-270,Y,20]));   // main N-S spine
  s(plane(8,280,am,[-310,Y,20]));   // road between training field and flats
  s(plane(8,200,am,[-230,Y,10]));   // secondary E road beside lofts+villas
  s(plane(150,8,am,[-310,Y,145]));  // E-W to stables
  s(plane(8,100,am,[-170,Y,10]));   // east side of training field

  // EAST COMPOUND road
  s(plane(8,250,am,[200,Y,10]));
  s(plane(55,8,am,[215,Y,120]));
}

//        LAKE (north, between safety zone and tier1 villas)                                                                         
function addLake(){
  const wm=createWaterMat();
  // Crescent shape: offset east (lake centre x=-10 per measurements)
  const lb=new THREE.Mesh(new THREE.BoxGeometry(195,.35,22),wm);
  lb.position.set(30,.16,-115); lb.receiveShadow=true; scene.add(lb); waterMeshes.push(lb);
  // West cap x=30-90=-60, east cap x=30+90=120
  for(const[ex,sc2] of[[-60,.9],[120,1.0]]){
    const ep=new THREE.Mesh(new THREE.SphereGeometry(13,16,4),wm);
    ep.position.set(ex,.05,-115); ep.scale.set(1,.2,sc2); scene.add(ep); waterMeshes.push(ep);
  }
  // Shore grass: south shore z=-104, north shore z=-126
  const sg=MATS.grassGreen();
  s(plane(220,6,sg,[30,.12,-104]));
  s(plane(220,6,sg,[30,.12,-126]));
}

function addEastLake(){
  const wm=createWaterMat();
  const el=new THREE.Mesh(new THREE.BoxGeometry(10,.25,38),wm);
  el.position.set(220,.12,-48); scene.add(el); waterMeshes.push(el);
}

//        CLUBHOUSE (Audit 4.1, 4.2, 4.3)                                                                                                                               
function addClubhouse(){
  const g=new THREE.Group(); g.position.set(0,0,108);
  const cm=MATS.clubWhite();
  const gw=MAT_GLASS_WARM(.55);
  const gm=MAT_GLASS(.48);
  const tm=MAT_TIMBER();
  const wm=MAT_WHITE_TRIM();
  const gld=MAT_GOLD();

  // Main building 110m wide (Audit 4.2)
  g.add(box(110,4.8,26,cm,[0,2.4,0]));
  // Bleachers facing north
  for(let i=0;i<8;i++)
    g.add(box(92,.45,2.2,new THREE.MeshStandardMaterial({color:0xd0c8b8,roughness:.7}),
      [0,.55+i*.52,-12.5+i*1.6],0,false));
  for(let x=-50;x<=50;x+=12) g.add(box(1.1,5.2,1.1,cm,[x,2.7,-13]));
  // Floor 1
  g.add(box(122,4.6,27,cm,[0,7.3,.5]));
  g.add(box(110,3.4,.45,gw,[0,7.3,-13.2]));
  g.add(box(110,.95,.3,gld,[0,5.3,-13.2],0,false));
  for(const ux of[-35,0,35]) addUmbrella(g,[ux,5.9,-10]);
  // Floor 2
  g.add(box(130,4.4,28,cm,[0,12.1,1.0]));
  g.add(box(118,3.4,.45,gm,[0,12.1,-13.4]));
  // Slab overhangs
  [4.85,9.65,14.55].forEach(y=>g.add(box(135,.65,30,wm,[0,y,1.0],0,false)));
  for(let x=-55;x<=55;x+=12){
    g.add(box(.7,4.5,.7,wm,[x,7.3,-13]));
    g.add(box(.7,4.3,.7,wm,[x,12.1,-13.2]));
  }
  for(const side of[-48,48]){
    g.add(box(16,6.5,16,cm,[side,18.0,.5]));
    g.add(box(17.5,.7,17.5,wm,[side,21.5,.5],0,false));
  }
  g.add(box(14,5.2,1.0,tm,[0,2.6,-13.5]));
  scene.add(g);

  // PARKING both sides (Audit 4.1) - 50x20m each
  const am=MATS.roadAsph();
  const bayM=MATS.railWhite();
  s(plane(50,20,am,[-68,.13,128]));
  s(plane(50,20,am,[ 68,.13,128]));
  for(const bx of[-68,68]) for(let i=-22;i<=22;i+=4.5)
    s(box(.06,.04,5.5,bayM,[bx+i,.16,128],0,false));

  // Clubhouse avenue - double row of 8 palms (Audit 10.1)
  for(let pz=93;pz<=113;pz+=8){ addPalmSprite(-12,.1,pz,1.3); addPalmSprite(12,.1,pz,1.3); }
}

function addUmbrella(parent,pos){
  const g=new THREE.Group(); g.position.set(...pos);
  g.add(cyl(.08,.08,3.0,6,MAT_GOLD(),[0,1.5,0]));
  g.add(cyl(3.2,3.6,.45,16,new THREE.MeshStandardMaterial({color:0xf0e8d8,roughness:.7}),[0,3.2,0]));
  parent.add(g);
}

// GLB LOADING SYSTEM
// Pattern: load once, store template, clone per placement
let villaGLBTemplate = null;
let aptGLBTemplate   = null;
let loftGLBTemplate  = null;

function makeDracoLoader() {
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/draco/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader;
}

function loadVillaGLB(){
  makeDracoLoader().load("assets/villa-mesh.glb", (gltf) => {
    gltf.scene.scale.setScalar(VILLA_SCALE);
    gltf.scene.position.y = VILLA_Y;
    gltf.scene.traverse(child => {
      if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    villaGLBTemplate = gltf.scene;
    villaGLBScene    = gltf.scene;
    console.log("Villa GLB loaded");
    pendingVillas.forEach(p => placeVillaGLB(p.x, p.z, p.ry, p.plotKey));
    pendingVillas = [];
  }, undefined, err => {
    console.error("Villa GLB failed:", err);
    pendingVillas = [];
  });
}

function loadApartmentGLB(){
  makeDracoLoader().load("assets/apartment-mesh.glb", (gltf) => {
    gltf.scene.scale.setScalar(APT_SCALE);
    gltf.scene.position.y = APT_Y;
    gltf.scene.traverse(child => {
      if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    aptGLBTemplate = gltf.scene;
    aptGLBScene    = gltf.scene;
    console.log("Apartment GLB loaded");
    pendingApts.forEach(p => placeAptGLB(p.x, p.z, p.ry));
    pendingApts = [];
  }, undefined, err => {
    console.error("Apt GLB failed:", err);
    pendingApts = [];
  });
}

function loadLoftGLB(){
  makeDracoLoader().load("assets/loft-mesh.glb", (gltf) => {
    gltf.scene.scale.setScalar(LOFT_SCALE);
    gltf.scene.position.y = LOFT_Y;
    gltf.scene.traverse(child => {
      if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    loftGLBTemplate = gltf.scene;
    loftGLBScene    = gltf.scene;
    console.log("Loft GLB loaded");
    pendingLofts.forEach(p => placeLoftGLB(p.x, p.z, p.ry));
    pendingLofts = [];
  }, undefined, err => {
    console.error("Loft GLB failed:", err);
    pendingLofts = [];
  });
}

function placeVillaGLB(x, z, ry, plotKey) {
  ry = ry || 0;
  if (!villaGLBTemplate) { pendingVillas.push({x, z, ry, plotKey}); return; }
  const container = new THREE.Group();
  container.position.set(x, 0, z);
  container.rotation.y = ry;
  container.userData.isVillaGLB = true;
  container.userData.baseRotY   = ry;
  container.userData.plotKey    = plotKey;
  container.add(villaGLBTemplate.clone(true));
  scene.add(container);
  if (plotKey) addPlotOverlay(x, z, ry, plotKey, container);
}

function placeAptGLB(x, z, ry) {
  ry = ry || 0;
  if (!aptGLBTemplate) { pendingApts.push({x, z, ry}); return; }
  const container = new THREE.Group();
  container.position.set(x, 0, z);
  container.rotation.y = ry;
  container.add(aptGLBTemplate.clone(true));
  scene.add(container);
}

function placeLoftGLB(x, z, ry) {
  ry = ry || 0;
  if (!loftGLBTemplate) { pendingLofts.push({x, z, ry}); return; }
  const container = new THREE.Group();
  container.position.set(x, 0, z);
  container.rotation.y = ry;
  container.add(loftGLBTemplate.clone(true));
  scene.add(container);
}

//        VILLA RING (all using GLB mesh, standalone plots, Audit 3.1-3.6)                               
function addVillaRing(){
  const PLOT=28; // 28m spacing - 14m villa + 7m gap each side (Audit 3.5 fix)

  // WEST INNER column x=-162, z=-96 to +96 (8 units, 28m spacing)
  for(let i=0;i<8;i++){
    const z=-96+i*PLOT;
    placeVillaWithLandscape(-162,z,Math.PI/2);
  }
  // WEST OUTER column x=-192, staggered by PLOT/2 (7 units)
  for(let i=0;i<7;i++){
    const z=-82+i*PLOT;
    placeVillaWithLandscape(-192,z,Math.PI/2);
  }
  // EAST INNER column x=+162 (8 units)
  for(let i=0;i<8;i++){
    const z=-96+i*PLOT;
    placeVillaWithLandscape(162,z,-Math.PI/2);
  }
  // EAST OUTER column x=+192 (7 units)
  for(let i=0;i<7;i++){
    const z=-82+i*PLOT;
    placeVillaWithLandscape(192,z,-Math.PI/2);
  }
  // ONE continuous north row bowing over the lake.
  // Lake centre x=+30, radius=90m, peak bow=17m northward at lake centre.
  const LAKE_CX=30, LAKE_R=90, BOW=17;
  const northX=[-140,-116,-92,-68,-44,-20,4,28,52,76,100,124,148,172,196];
  northX.forEach(x=>{
    const dx=x-LAKE_CX;
    const bow=dx*dx<LAKE_R*LAKE_R ? BOW*(1-(dx*dx)/(LAKE_R*LAKE_R)) : 0;
    placeVillaWithLandscape(x, -132-bow, 0);
  });
  // SOUTH ARC: gap at centre for clubhouse (x=0, width 110m, so |x|<55 is blocked)
  // Only place where |x|>=65. Base z=105 flush with clubhouse front.
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
  placeVillaGLB(x,z,ry,plotKey);
  addPlotLandscaping(x,z,ry);
  // 2 cypress trees per villa (Audit 3.5)
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
  // Side hedges with CLEAR 7m gap from next villa (Audit 3.5)
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
  // Undercroft plinth
  g.add(box(16,2.1,13,new THREE.MeshStandardMaterial({color:0xb0a898,roughness:.8}),[0,1.05,0]));
  // Main body
  g.add(box(16,5.8,13,bm,[0,5.15,0]));
  g.add(box(15,2.2,.4,gw,[0,5.5,-6.6]));
  // Hip roof (Audit 3.4)
  const roofPyramid=new THREE.ConeGeometry(12,3.5,4);
  const rm2=new THREE.Mesh(roofPyramid,rm);
  rm2.position.set(0,9.85,0); rm2.rotation.y=Math.PI/4; g.add(rm2);
  // Cantilevered terrace slab
  g.add(box(16,.18,4,wm,[0,4.03,-8.5],0,false));
  return g;
}

//        LOFT TERRACES                                                                                                                                                                                        
// Single row north crescent (NW arm + NE arm). West compound between villas and flats.
function addLoftTerraces(){
  // NORTH WEST COMPOUND ROW (above training field, z~-169)
  // Two distinct E-W groups above the west compound
  // Left group: above training field (x=-414 to -291)
  for (let x = -400; x <= -295; x += 36) {
    placeLoftGLB(x, -169, 0);   // face south
  }
  // Right group: above flats+loft zone (x=-248 to -163)
  for (let x = -245; x <= -163; x += 36) {
    placeLoftGLB(x, -169, 0);   // face south
  }

  // NORTH CRESCENT - SINGLE ROW, NW ARM
  // Parabolic curve: z = -162 - abs(x)*0.05
  // Stops at x=-110 (lake west edge ~x=-110)
  for(let x=-310; x<=-110; x+=36){
    const cz=-162-Math.abs(x)*.05;
    placeLoftGLB(x,cz,Math.PI);
  }
  // NORTH CRESCENT - SINGLE ROW, NE ARM
  // Starts at x=+95 (lake east edge ~x=+90)
  for(let x=95; x<=310; x+=36){
    const cz=-162-Math.abs(x)*.05;
    placeLoftGLB(x,cz,Math.PI);
  }
  // WEST COMPOUND LOFTS
  // Pixel-measured: x=-218, z matches flat blocks (-14 and +112)
  // Face east toward polo field
  placeLoftGLB(-218, -14, -Math.PI/2);
  placeLoftGLB(-218, 112, -Math.PI/2);
}

function createLoftBlock(x,z,ry){
  const g=new THREE.Group(); g.position.set(x,0,z); g.rotation.y=ry;
  // Smaller than villa (Audit 5.3) - 10m wide per unit, 4 units = 40m total
  const UNITS=4, UW=10.0, UD=11.0;
  const TW=UNITS*UW;
  const bm=MATS.loftBody(); const rm=MATS.loftRoof();
  const gw=MAT_GLASS_WARM(.6); const tm=MAT_TIMBER();
  // Ground floor stone base
  g.add(box(TW,3.2,UD,new THREE.MeshStandardMaterial({color:0x9a8a78,roughness:.9}),[0,1.6,0]));
  // Upper floor concrete
  g.add(box(TW,3.2,UD,bm,[0,4.85,0]));
  // Windows rhythm
  for(let u=0;u<UNITS;u++){
    const ux=-TW/2+UW/2+u*UW;
    g.add(box(7.5,2.6,.06,gw,[ux,3.0,-UD/2-.03]));
    g.add(box(7.5,2.5,.06,gw,[ux,4.85,-UD/2-.03]));
    // Timber pier
    g.add(box(.4,6.4,.4,tm,[ux-UW/2,3.2,-UD/2]));
  }
  // Flat roof (Audit 5.3 - orange tile material)
  g.add(box(TW+.4,.4,UD+.4,rm,[0,6.65,0],0,false));
  // Floor slab
  g.add(box(TW+.2,.18,UD+.2,MAT_WHITE_TRIM(),[0,3.19,0],0,false));
  return g;
}

//        WEST COMPOUND (Audit 6.1, 6.2, 7.1, 7.2)                                                                                                    
function addWestCompound(){
  const gm=MAT_GRASS_FIELD(); const dm=MATS.safetyBrown();
  // Training field: pixel-measured centre x=-347, z=+42 (N edge z=-66, S edge z=+149)
  s(plane(120,220,dm,[-347,.06,42]));
  s(plane(100,200,gm,[-347,.10,42]));

  // Blocks of flats via GLB
  // Pixel-measured: centre x=-275, N block z=-14, S block z=+112
  // Road at x=-270 separates them from training field at x=-347
  placeAptGLB(-275, -14, Math.PI/2);
  placeAptGLB(-275, 112, Math.PI/2);
}

function createFlatBlock(x,z){ // fallback if GLB fails
  const g=new THREE.Group(); g.position.set(x,0,z);
  const bm=MATS.flatGrey(); const wm=MAT_WHITE_TRIM();
  // 80m E-W x 28m N-S (Audit 6.2 correct orientation)
  g.add(box(80,20,28,bm,[0,10,0]));
  g.add(box(82,.3,30,wm,[0,20.1,0],0,false));
  scene.add(g); return g;
}

//        STABLES (Audit 9.1, 9.2)                                                                                                                                                    
function addStables(){
  // Courtyard floor (Audit 9.2)
  s(plane(90,70,MATS.cobble(),[-358,.02,90]));
  // 4 stable blocks with pitched roof and brick material (Audit 9.1)
  [[-375,80],[-375,100],[-342,80],[-342,100]].forEach(([x,z])=>{
    const g=new THREE.Group(); g.position.set(x,0,z);
    const brickM=PBR.brick(); brickM.color.set(0xC4A882);
    g.add(box(34,4.2,12,brickM,[0,2.1,0]));
    const rL=box(36,.45,16,MATS.stableRoof(),[0,4.6,0]); rL.rotation.z=.17; g.add(rL);
    const rR=box(36,.45,16,MATS.stableRoof(),[0,4.6,0]); rR.rotation.z=-.17; g.add(rR);
    g.add(box(36,.28,.28,MATS.stableRoof(),[0,5.9,0]));
    for(let px=-14;px<=14;px+=7) g.add(cyl(.16,.16,4.4,8,MAT_DARK_METAL(),[px,2.2,-6.2]));
    scene.add(g);
  });
}

//        PADDOCK (Audit 8.1, 8.2)                                                                                                                                                    
function addPaddock(){
  s(plane(40,38,MAT_GRASS_FIELD(),[218,.07,0]));
  // Post-and-rail fence (Audit 8.1)
  const post=MATS.railWhite(); const rail=MATS.railWhite();
  for(let fz=-19;fz<=19;fz+=4){ s(cyl(.1,.1,1.6,6,post,[198,.8,fz])); s(cyl(.1,.1,1.6,6,post,[238,.8,fz])); }
  for(let fx=198;fx<=238;fx+=4){ s(cyl(.1,.1,1.6,6,post,[fx,.8,-19])); s(cyl(.1,.1,1.6,6,post,[fx,.8,19])); }
  s(box(.08,.1,38,rail,[198,1.0,0],0,false)); s(box(.08,.1,38,rail,[238,1.0,0],0,false));
  s(box(40,.1,.08,rail,[218,1.0,-19],0,false)); s(box(40,.1,.08,rail,[218,1.0,19],0,false));
  s(box(.08,.1,38,rail,[198,1.55,0],0,false)); s(box(.08,.1,38,rail,[238,1.55,0],0,false));
  s(box(40,.1,.08,rail,[218,1.55,-19],0,false)); s(box(40,.1,.08,rail,[218,1.55,19],0,false));
  // Green area (Audit 10.3)
  s(plane(60,60,MATS.grassGreen(),[255,.06,-58]));
  for(let tx=235;tx<=280;tx+=7) for(let tz=-85;tz<=-30;tz+=7) addTreeAt(tx,.1,tz,.7+Math.random()*.5);
}

function addGamePark(){ // Audit 8.2
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
  // Pixel-measured positions from layout
  // Service centre (RED) at world (-261, +245)
  const redMat = new THREE.MeshStandardMaterial({color:0xcc2200,roughness:.7});
  const greyM  = MATS.flatGrey();
  const brickM = new THREE.MeshStandardMaterial({color:0xc8a870,roughness:.85});
  const concM  = MATS.concrete();

  // Red service building
  s(box(18, 5.2, 14, redMat, [-261, 2.6, 195]));
  s(box(19, .5,  15, new THREE.MeshStandardMaterial({color:0xaa1800,roughness:.7}), [-261, 5.3, 195], 0, false));

  // Mechanical/electrical block at (-218, 245)
  s(box(28, 6.5, 18, greyM,  [-218, 3.25, 195]));
  // FM building
  s(box(14, 4.2, 12, concM,  [-290, 2.1,  195]));
  // Trucks parking
  s(plane(30, 18, MATS.roadAsph(), [-320, .12, 195]));

  // STABLES compound at (-383, 245) -- rows of stable blocks
  s(plane(65, 45, MATS.cobble(), [-383, .02, 225]));  // courtyard
  // Stable rows (4 blocks E-W)
  for (let sx = -405; sx <= -355; sx += 18) {
    const sg = new THREE.Group(); sg.position.set(sx, 0, 218);
    sg.add(box(16, 4.0, 10, brickM, [0, 2.0, 0]));
    const rL = box(17, .4, 13, MATS.stableRoof(), [0, 4.2, 0]);
    rL.rotation.z = .18; sg.add(rL);
    const rR = box(17, .4, 13, MATS.stableRoof(), [0, 4.2, 0]);
    rR.rotation.z = -.18; sg.add(rR);
    for (let dp = -6; dp <= 6; dp += 3)
      sg.add(cyl(.12,.12,3.8,6,MAT_DARK_METAL(),[dp,2.0,-5.2]));
    scene.add(sg);
  }
  // Vet clinic
  s(box(12, 3.8, 10, concM,  [-350, 1.9, 218]));
  // Storage building
  s(box(14, 4.5, 10, greyM,  [-338, 2.25, 232]));

  // MINI PADDOCKS x2 (pixel-measured: x=-389,-359, z=+186)
  const fenceM = new THREE.MeshStandardMaterial({color:0xfcfaf5,roughness:.6});
  for (const [px, pz] of [[-389, 170], [-359, 170]]) {
    s(plane(22, 18, MAT_GRASS_FIELD(), [px, .06, pz]));
    // Post and rail fence
    for (let fz = pz-9; fz <= pz+9; fz += 4) {
      s(cyl(.08,.08,1.5,6,fenceM,[px-11,.75,fz]));
      s(cyl(.08,.08,1.5,6,fenceM,[px+11,.75,fz]));
    }
    for (let fx = px-11; fx <= px+11; fx += 4) {
      s(cyl(.08,.08,1.5,6,fenceM,[fx,.75,pz-9]));
      s(cyl(.08,.08,1.5,6,fenceM,[fx,.75,pz+9]));
    }
    s(box(.06,.06,18,fenceM,[px-11,1.1,pz],0,false));
    s(box(.06,.06,18,fenceM,[px+11,1.1,pz],0,false));
    s(box(22,.06,.06,fenceM,[px,1.1,pz-9],0,false));
    s(box(22,.06,.06,fenceM,[px,1.1,pz+9],0,false));
  }
}

//        SYSTEMATIC LANDSCAPING (Audit 10.1, 10.2, 10.3)                                                                            
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
  for(const ry of[0,Math.PI/2]){
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);
    m.position.set(x,y+h/2,z); m.rotation.y=ry;
    scene.add(m); palmBillboards.push(m);
  }
}

function addCypressAt(x,z){ // slender accent tree per villa
  cyl(.25,.38,5,8,MATS.stableRoof(),[x,2.5,z]);
  const cone=new THREE.Mesh(new THREE.ConeGeometry(.7,4.5,8),MATS.hedgeGreen());
  cone.position.set(x,5.5,z); cone.castShadow=true; scene.add(cone);
}

function addTreeAt(x,y,z,scale=1){ // generic tropical tree
  cyl(.15,.22,4*scale,8,new THREE.MeshStandardMaterial({color:0x5c3c18,roughness:.88}),[x,2*scale,z]);
  const cr=new THREE.Mesh(new THREE.SphereGeometry(1.8*scale,8,6),MATS.grassGreen());
  cr.position.set(x,(4+1.8)*scale,z); cr.castShadow=true; scene.add(cr);
}

function addLandscaping(){
  // Lagos Road palm avenue (Audit 10.1)
  for(let x=-280;x<=280;x+=28){ addPalmSprite(x,.1,206,1.3); addPalmSprite(x,.1,224,1.2); }

  // Ring road palms outer side (Audit 10.1)
  for(let z=-95;z<=95;z+=40){ addPalmSprite(-160,.1,z,1.1); addPalmSprite(160,.1,z,1.1); }
  for(let x=-150;x<=150;x+=40){ addPalmSprite(x,.1,-102,1.1); addPalmSprite(x,.1,102,1.1); }

  // North backdrop tree canopy (Audit 10.2)
  for(let x=-310;x<=310;x+=18){
    addTreeAt(x,.1,-210,.8+Math.random()*.5);
  }

  // Perimeter tree belt (all four sides)
  for(let x=-300;x<=300;x+=35){ addPalmSprite(x,.1,-225,.9+Math.random()*.3); addPalmSprite(x,.1,215,.9+Math.random()*.3); }
  for(let z=-220;z<=215;z+=35){ addPalmSprite(-310,.1,z,.9+Math.random()*.25); addPalmSprite(310,.1,z,.9+Math.random()*.25); }

  // Lake shore palms
  // Lake shore palms removed - not realistic to have palms at water edge

  // Clubhouse avenue flanks
  for(const pz of[95,103,111,119]){ addPalmSprite(-16,.1,pz,1.2); addPalmSprite(16,.1,pz,1.2); }

  // East green area dense planting (Audit 10.3)
  for(let tx=240;tx<=290;tx+=7) for(let tz=-80;tz<=-20;tz+=7) addTreeAt(tx,.1,tz,.7+Math.random()*.6);

  // Stables compound trees
  [[-400,78],[-400,100],[-340,78],[-340,100]].forEach(([x,z])=>addPalmSprite(x,.1,z,1.1));
}

// PLOT RESERVATION SYSTEM
function addPlotOverlay(x, z, ry, plotKey, villaClone){
  const mat = new THREE.MeshStandardMaterial({color:0x00ff88,transparent:true,opacity:.35});
  const overlay = new THREE.Mesh(new THREE.PlaneGeometry(20,18), mat);
  overlay.rotation.x = -Math.PI/2;
  overlay.rotation.y = ry;
  overlay.position.set(x, .25, z);
  overlay.userData.plotKey       = plotKey;
  overlay.userData.isPlotOverlay = true;
  overlay.userData.villaClone    = villaClone;
  scene.add(overlay);
  plotRegistry.set(plotKey, { status:"available", overlay, villaClone, x, z, ry });
}

export function reservePlot(plotKey){
  const plot = plotRegistry.get(plotKey);
  if (!plot || plot.status === "reserved") return false;
  plot.status = "reserved";
  if (plot.villaClone) plot.villaClone.traverse(child => {
    if (child.isMesh && child.material){
      child.material = child.material.clone();
      child.material.color.set(0x888888);
      child.material.opacity = .7;
      child.material.transparent = true;
    }
  });
  if (plot.overlay){
    plot.overlay.material = new THREE.MeshStandardMaterial({color:0xff4444,transparent:true,opacity:.5});
  }
  plotRegistry.set(plotKey, plot);
  return true;
}

export function getPlotAtRay(raycaster){
  const overlays = [];
  scene.traverse(o => { if (o.userData.isPlotOverlay) overlays.push(o); });
  const hits = raycaster.intersectObjects(overlays, false);
  return hits.length > 0 ? hits[0].object.userData.plotKey : null;
}

//        TICK
export function tickScene(elapsed,camera){
  tickWater(waterMeshes, elapsed);
  tickGrass(camera);
  palmBillboards.forEach(s=>{
    s.rotation.y=Math.atan2(camera.position.x-s.position.x,camera.position.z-s.position.z);
  });
}

export function getRenderer() { return renderer; }
export function getScene()    { return scene;    }
export function getCamera()   { return camera;   }
export function getClock()    { return clock;    }
