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
import { RGBELoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/RGBELoader.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import {
  MAT_GRASS_FIELD, MAT_DIRT, MAT_ASPHALT,
  MAT_BRICK, MAT_CONCRETE, MAT_TIMBER, MAT_STONE, MAT_TILE_ROOF,
  MAT_GLASS, MAT_GLASS_WARM, MAT_WHITE_TRIM, MAT_GOLD, MAT_DARK_METAL, MAT_WATER,
} from "./materials.js";

//        MODULE STATE                                                                                                                                                                                        
let scene, renderer, camera, clock, skyMesh;
let waterMeshes = [], palmBillboards = [];

// Villa GLB (3-bed premium villa mesh)
const VILLA_SCALE = 12.558;
const VILLA_Y     = 4.94;
let villaGLBScene = null;
let pendingVillas  = [];

// Apartment GLB
const APT_SCALE = 28.417;
const APT_Y     = 7.25;
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
  renderer.toneMappingExposure = 1.05;
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
  return { scene, renderer, camera, clock };
}

//        HDRI                                                                                                                                                                                                                
function loadHDRI() {
  new RGBELoader().load("assets/shanghai_bund_4k.hdr", hdr => {
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdr;
  });
}

//        LIGHTING                                                                                                                                                                                                    
let sunLight, hemiLight;
export function getSunLight() { return sunLight; }
export function getHemiLight() { return hemiLight; }

function buildLighting() {
  // Hemisphere (sky/ground bounce)
  hemiLight = new THREE.HemisphereLight(0xd4e8ff, 0x4a6a30, 1.2);
  scene.add(hemiLight);
  // Main sun - late afternoon SW position for dramatic field shadows
  sunLight = new THREE.DirectionalLight(0xffe8b0, 2.6);
  sunLight.position.set(-180, 160, 100); // SW elevation ~35 deg
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
  [[-40,8,162],[0,8,162],[40,8,162]].forEach(p => {
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
  s(plane(900,700,MATS.safetyBrown(),[0,0,30]));
  // Estate grass (wide green lawn buffer around the polo ring)
  s(plane(500,400,MATS.grassGreen(),[0,.01,0]));
  // Clubhouse forecourt paving
  s(plane(180,80,MATS.concrete(),[0,.02,170]));
  // Stables courtyard
  s(plane(90,70,MATS.cobble(),[-355,.02,90]));
  // West compound ground
  s(plane(200,280,MATS.lawnGreen(),[-310,.01,30]));
}

//        POLO FIELD                                                                                                                                                                                                 
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
  const dm=MATS.safetyBrown();
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
  const am=MATS.roadAsph();
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

  // RING ROAD around polo oval (Audit 1.2)
  s(plane(8,200,am,[-152,Y,0]));    // W ring N-S
  s(plane(8,200,am,[ 152,Y,0]));    // E ring N-S
  s(plane(310,8,am,[0,Y,-97]));     // N ring E-W
  s(plane(310,8,am,[0,Y,97]));      // S ring E-W
  for(const[cx,cz] of[[-145,-92],[145,-92],[-145,92],[145,92]])
    s(plane(18,18,am,[cx,Y,cz]));

  // INTERNAL ACCESS ROAD (between inner and outer villa columns)
  s(plane(8,220,am,[-174,Y,-5]));
  s(plane(8,220,am,[ 174,Y,-5]));

  // NORTH ARC ACCESS (behind tier1 villas between them and lake)
  s(plane(300,7,am,[0,Y,-104]));

  // SOUTH INTERNAL E-W connector + forecourt
  s(plane(400,8,am,[0,Y,128]));
  s(plane(130,35,am,[0,Y,148]));

  // WEST COMPOUND roads (Audit 1.3)
  s(plane(8,280,am,[-270,Y,20]));   // main N-S spine
  s(plane(8,200,am,[-230,Y,10]));   // secondary E road beside lofts
  s(plane(150,8,am,[-310,Y,145]));  // E-W to stables
  s(plane(8,100,am,[-170,Y,10]));   // east side of training field

  // EAST COMPOUND road
  s(plane(8,250,am,[200,Y,10]));
  s(plane(55,8,am,[215,Y,120]));
}

//        LAKE (north, between safety zone and tier1 villas)                                                                         
function addLake(){
  const wm=MAT_WATER();
  // Crescent shape: offset east (lake centre x=-10 per measurements)
  const lb=new THREE.Mesh(new THREE.BoxGeometry(195,.35,22),wm);
  lb.position.set(-10,.16,-78); lb.receiveShadow=true; scene.add(lb); waterMeshes.push(lb);
  // End caps
  for(const[ex,sc2] of[[-107,.9],[ 85,1.1]]){
    const ep=new THREE.Mesh(new THREE.SphereGeometry(13,16,4),wm);
    ep.position.set(ex,.05,-78); ep.scale.set(1,.2,sc2); scene.add(ep); waterMeshes.push(ep);
  }
  // Shore grass
  const sg=MATS.grassGreen();
  s(plane(220,6,sg,[-10,.12,-67]));
  s(plane(220,6,sg,[-10,.12,-91]));
}

function addEastLake(){
  const wm=MAT_WATER();
  const el=new THREE.Mesh(new THREE.BoxGeometry(10,.25,38),wm);
  el.position.set(220,.12,-48); scene.add(el); waterMeshes.push(el);
}

//        CLUBHOUSE (Audit 4.1, 4.2, 4.3)                                                                                                                               
function addClubhouse(){
  const g=new THREE.Group(); g.position.set(0,0,155);
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
  s(plane(50,20,am,[-68,.13,175]));
  s(plane(50,20,am,[ 68,.13,175]));
  for(const bx of[-68,68]) for(let i=-22;i<=22;i+=4.5)
    s(box(.06,.04,5.5,bayM,[bx+i,.16,175],0,false));

  // Clubhouse avenue - double row of 8 palms (Audit 10.1)
  for(let pz=140;pz<=160;pz+=8){ addPalmSprite(-12,.1,pz,1.3); addPalmSprite(12,.1,pz,1.3); }
}

function addUmbrella(parent,pos){
  const g=new THREE.Group(); g.position.set(...pos);
  g.add(cyl(.08,.08,3.0,6,MAT_GOLD(),[0,1.5,0]));
  g.add(cyl(3.2,3.6,.45,16,new THREE.MeshStandardMaterial({color:0xf0e8d8,roughness:.7}),[0,3.2,0]));
  parent.add(g);
}

//        VILLA GLB SYSTEM                                                                                                                                                                               
function loadVillaGLB(){
  new GLTFLoader().load("assets/villa-mesh.glb",
    gltf=>{
      villaGLBScene=gltf.scene;
      villaGLBScene.scale.setScalar(VILLA_SCALE);
      villaGLBScene.position.y=VILLA_Y;
      villaGLBScene.traverse(c=>{
        if(c.isMesh){
          c.castShadow=true; c.receiveShadow=true;
          if(c.material) c.material.envMapIntensity=1.1;
        }
      });
      pendingVillas.forEach(({x,z,ry,plotKey})=>placeVillaGLB(x,z,ry,plotKey));
      pendingVillas=[];
    },
    null,
    ()=>{ pendingVillas.forEach(({x,z,ry})=>{ const v=createVillaFallback(); v.position.set(x,0,z); v.rotation.y=ry; scene.add(v); }); pendingVillas=[]; }
  );
}

function loadApartmentGLB(){
  new GLTFLoader().load("assets/apartment-mesh.glb",
    gltf=>{
      aptGLBScene=gltf.scene;
      aptGLBScene.scale.setScalar(APT_SCALE);
      aptGLBScene.position.y=APT_Y;
      aptGLBScene.traverse(c=>{
        if(c.isMesh){ c.castShadow=true; c.receiveShadow=true; }
      });
      pendingApts.forEach(({x,z,ry})=>placeAptGLB(x,z,ry));
      pendingApts=[];
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
  // Add plot selection overlay (Audit - reservation system)
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
  // Selection plane hovering slightly above ground at plot position
  const mat=MATS.plotAvail();
  const overlay=new THREE.Mesh(new THREE.PlaneGeometry(20,18),mat);
  overlay.rotation.x=-Math.PI/2;
  overlay.rotation.y=ry;
  overlay.position.set(x,.25,z);
  overlay.userData.plotKey=plotKey;
  overlay.userData.isPlotOverlay=true;
  overlay.userData.villaClone=villaClone;
  scene.add(overlay);
  plotRegistry.set(plotKey,{
    status:"available",
    overlay, villaClone,
    x,z,ry,
  });
}

export function reservePlot(plotKey){
  const plot=plotRegistry.get(plotKey);
  if(!plot||plot.status==="reserved") return false;
  plot.status="reserved";
  // Grey out villa mesh
  plot.villaClone && plot.villaClone.traverse(c=>{
    if(c.isMesh&&c.material){
      c.material=c.material.clone();
      c.material.color.set(0x888888);
      c.material.opacity=.7; c.material.transparent=true;
    }
  });
  // Turn overlay red
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
  // NORTH WEST ROW (straight, z=-108, west of lake gap x<-115)
  for(const x of[-168,-140,-112,-84,-56,-28]){
    placeVillaWithLandscape(x,-108,0); // face south
  }
  // NORTH EAST ROW (straight, z=-108, east of lake gap x>+90)
  for(const x of[96,124,152,180,208,236,264]){
    placeVillaWithLandscape(x,-108,0);
  }
  // SOUTH SW arc (5 units, face north ry=0, Audit 3.6)
  for(const side of[-1,1]){
    [20,48,76,104,132].forEach(xabs=>{
      const x=side*xabs;
      const z=100+Math.abs(x)*.04;
      placeVillaWithLandscape(x,z,0); // ALL face north (Audit 3.6 fix)
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

//        LOFT TERRACES (Audit 5.1-5.4)                                                                                                                                     
function addLoftTerraces(){
  // CRESCENT ROW 1 (curved with road, Audit 5.1)
  // NW arm: x=-310 to -85, NE arm: x=+85 to +265, gap abs(x)<80 (Audit 5.2)
  for(let x=-310;x<=280;x+=22){
    if(Math.abs(x)<82) continue; // wider gap over lake
    const cz=-168-Math.abs(x)*.05; // parabolic curve (Audit 5.1)
    s(createLoftBlock(x,cz,Math.PI)); // face south
  }
  // CRESCENT ROW 2 (outer row, z   -182)
  for(let x=-295;x<=265;x+=22){
    if(Math.abs(x)<82) continue;
    const cz=-182-Math.abs(x)*.04;
    s(createLoftBlock(x,cz,Math.PI));
  }
  // WEST COMPOUND loft clusters (Audit 5.4)
  s(createLoftBlock(-285,-38,-Math.PI/2));
  s(createLoftBlock(-285, 29,-Math.PI/2));
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
  // Training field: N-S oriented, x=-390, z=0
  s(plane(120,185,dm,[-390,.06,0]));
  s(plane(100,160,gm,[-390,.10,0]));

  // Blocks of flats via GLB (E-W oriented, Audit 6.2)
  // North block: x=-248, z=-25. South block: x=-248, z=+55
  placeAptGLB(-248,-25,0);   // E-W oriented (ry=0)
  placeAptGLB(-248, 55,0);
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
    g.add(box(34,4.2,12,MATS.stableBrick(),[0,2.1,0]));
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
  s(box(16,5.0,13,new THREE.MeshStandardMaterial({color:0xcc2200,roughness:.7}),[-270,2.5,95]));
  s(box(17,.5,14,new THREE.MeshStandardMaterial({color:0xaa1800,roughness:.7}),[-270,5.1,95],0,false));
  s(box(30,6,17,MATS.flatGrey(),[-240,3,100]));
  s(box(12,4,10,MATS.concrete(),[-220,2,88]));
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
  for(let x=-280;x<=280;x+=10){ addPalmSprite(x,.1,206,1.3); addPalmSprite(x,.1,224,1.2); }

  // Ring road palms outer side (Audit 10.1)
  for(let z=-95;z<=95;z+=15){ addPalmSprite(-160,.1,z,1.1); addPalmSprite(160,.1,z,1.1); }
  for(let x=-150;x<=150;x+=15){ addPalmSprite(x,.1,-102,1.1); addPalmSprite(x,.1,102,1.1); }

  // North backdrop tree canopy (Audit 10.2)
  for(let x=-310;x<=310;x+=6){
    addTreeAt(x,.1,-205,.8+Math.random()*.5);
    addTreeAt(x+3,.1,-215,.6+Math.random()*.5);
  }

  // Perimeter tree belt (all four sides)
  for(let x=-300;x<=300;x+=12){ addPalmSprite(x,.1,-225,.9+Math.random()*.3); addPalmSprite(x,.1,215,.9+Math.random()*.3); }
  for(let z=-220;z<=215;z+=14){ addPalmSprite(-310,.1,z,.9+Math.random()*.25); addPalmSprite(310,.1,z,.9+Math.random()*.25); }

  // Lake shore palms
  for(let x=-100;x<=85;x+=16){ addPalmSprite(x,.1,-64,1.1); addPalmSprite(x,.1,-94,1.0); }

  // Clubhouse avenue flanks
  for(const pz of[142,150,158,166]){ addPalmSprite(-16,.1,pz,1.2); addPalmSprite(16,.1,pz,1.2); }

  // East green area dense planting (Audit 10.3)
  for(let tx=240;tx<=290;tx+=7) for(let tz=-80;tz<=-20;tz+=7) addTreeAt(tx,.1,tz,.7+Math.random()*.6);

  // Stables compound trees
  [[-400,78],[-400,100],[-340,78],[-340,100]].forEach(([x,z])=>addPalmSprite(x,.1,z,1.1));
}

//        TICK                                                                                                                                                                                                                
export function tickScene(elapsed,camera){
  waterMeshes.forEach(m=>{
    if(m.material&&m.material.normalMap){
      m.material.normalMap.offset.x=elapsed*.018;
      m.material.normalMap.offset.y=elapsed*.012;
    }
  });
  palmBillboards.forEach(s=>{
    s.rotation.y=Math.atan2(camera.position.x-s.position.x,camera.position.z-s.position.z);
  });
}

export function getRenderer() { return renderer; }
export function getScene()    { return scene;    }
export function getCamera()   { return camera;   }
export function getClock()    { return clock;    }
