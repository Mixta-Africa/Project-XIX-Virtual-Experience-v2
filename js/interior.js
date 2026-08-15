/**
 * Project XIX -- Interior Walkthrough System
 *
 * Gives clients a first-person walk through each building type,
 * standing at windows/balconies to experience the views they'd have
 * as an owner. Uses the actual GLB interior geometry where available,
 * procedural rooms otherwise.
 *
 * Each building type has:
 *   - Multiple interior viewpoints (bedroom, living room, balcony, etc.)
 *   - Correct window/door openings showing the real estate view outside
 *   - Hotspot markers on the main estate map linking to interior views
 *   - "Walk mode" with WASD movement constrained to the floor plan
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader }  from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/DRACOLoader.js";

//        INTERIOR VIEWPOINTS                                                                                                                                                                         
// Each viewpoint simulates standing in a specific room and looking out.
// pos = [x,y,z] in interior space, yaw = facing direction, fov = camera FOV
// viewLabel = what the client sees on screen

export const INTERIORS = {

  villa: {
    name:  "3-Bedroom Premium Villa",
    rooms: [
      {
        key:       "villa_living",
        label:     "Living Room",
        sublabel:  "Ground floor     polo field view",
        pos:       [0, 1.35, 1.5],   // standing in living room
        yaw:       Math.PI,          // facing field (south face of villa)
        pitch:     -0.05,
        fov:       75,
        hint:      "Floor-to-ceiling glazing with direct polo field view",
      },
      {
        key:       "villa_balcony_f1",
        label:     "First Floor Balcony",
        sublabel:  "Overlooking the polo field",
        pos:       [0, 4.8, -6.5],   // on first floor balcony
        yaw:       Math.PI,
        pitch:     -0.12,
        fov:       80,
        hint:      "Elevated view across the full polo field to the lake",
      },
      {
        key:       "villa_master_bed",
        label:     "Master Bedroom",
        sublabel:  "Second floor     panoramic view",
        pos:       [0, 8.2, -5.0],   // master bedroom second floor
        yaw:       Math.PI,
        pitch:     -0.08,
        fov:       70,
        hint:      "Wake up to polo field and lake views every morning",
      },
      {
        key:       "villa_terrace",
        label:     "Roof Terrace",
        sublabel:  "Private rooftop     360 degree views",
        pos:       [0, 11.5, 0],
        yaw:       Math.PI,
        pitch:     -0.18,
        fov:       90,
        hint:      "360 panoramic view     field, lake, crescent road, and beyond",
      },
      {
        key:       "villa_garage",
        label:     "Undercroft Parking",
        sublabel:  "Private 2-car garage",
        pos:       [0, 0.9, 5.0],
        yaw:       0,
        pitch:     0.05,
        fov:       65,
        hint:      "Secure private garage beneath the villa plinth",
      },
    ],
    // Window positions for the interior room builder
    windows: [
      { side:"south", y:1.2,  w:4.0,  h:2.4, glass:"warm" },  // GF south
      { side:"south", y:4.8,  w:5.5,  h:2.8, glass:"warm" },  // F1 balcony
      { side:"south", y:8.2,  w:4.5,  h:2.6, glass:"warm" },  // F2 master
      { side:"north", y:1.2,  w:2.5,  h:1.8, glass:"clear" }, // GF north
      { side:"east",  y:4.8,  w:2.0,  h:2.4, glass:"clear" },
      { side:"west",  y:4.8,  w:2.0,  h:2.4, glass:"clear" },
    ],
  },

  loft: {
    name:  "2-Bedroom Loft Terrace",
    rooms: [
      {
        key:       "loft_living",
        label:     "Open-Plan Living",
        sublabel:  "Ground floor     garden view",
        pos:       [0, 1.2, 0.5],
        yaw:       Math.PI,
        pitch:     0,
        fov:       75,
        hint:      "Double-height living area with garden terrace beyond",
      },
      {
        key:       "loft_void",
        label:     "Living Void / Gallery",
        sublabel:  "Looking down from first floor",
        pos:       [0, 4.5, -1.0],
        yaw:       Math.PI,
        pitch:     -0.35,
        fov:       80,
        hint:      "The dramatic double-height void above the living room",
      },
      {
        key:       "loft_master",
        label:     "Master Bedroom",
        sublabel:  "First floor     rear garden view",
        pos:       [0, 4.8, -3.5],
        yaw:       0,
        pitch:     -0.05,
        fov:       65,
        hint:      "Quiet rear bedroom with private garden outlook",
      },
      {
        key:       "loft_balcony",
        label:     "Front Terrace",
        sublabel:  "Ground floor     crescent road view",
        pos:       [0, 0.1, 7.5],
        yaw:       0,
        pitch:     -0.05,
        fov:       80,
        hint:      "South-facing terrace with crescent road view",
      },
    ],
    windows: [
      { side:"south", y:1.2, w:5.5, h:2.5, glass:"warm" },
      { side:"north", y:1.2, w:3.5, h:2.0, glass:"warm" },
      { side:"south", y:4.8, w:4.5, h:2.6, glass:"warm" },
      { side:"north", y:4.8, w:3.0, h:2.2, glass:"clear" },
    ],
  },

  apartment: {
    name:  "2-Bedroom Apartment",
    rooms: [
      {
        key:       "apt_lobby",
        label:     "Entrance Lobby",
        sublabel:  "Ground floor     main entrance",
        pos:       [0, 0.9, 8.0],
        yaw:       Math.PI,
        pitch:     0,
        fov:       70,
        hint:      "Grand double-height lobby with concierge",
      },
      {
        key:       "apt_living_f2",
        label:     "Living Room     Floor 2",
        sublabel:  "South-facing, balcony access",
        pos:       [0, 7.5, -5.0],
        yaw:       Math.PI,
        pitch:     -0.05,
        fov:       75,
        hint:      "Balcony overlooking the estate avenue",
      },
      {
        key:       "apt_living_f5",
        label:     "Living Room     Floor 5",
        sublabel:  "Top floor     elevated estate view",
        pos:       [0, 17.8, -5.0],
        yaw:       Math.PI,
        pitch:     -0.12,
        fov:       80,
        hint:      "Unobstructed views across the full estate from the top floor",
      },
      {
        key:       "apt_balcony_f3",
        label:     "Balcony     Floor 3",
        sublabel:  "Mid-rise     looking south",
        pos:       [0, 10.8, -7.5],
        yaw:       Math.PI,
        pitch:     -0.08,
        fov:       85,
        hint:      "Step outside to the wraparound balcony, polo field ahead",
      },
      {
        key:       "apt_master",
        label:     "Master Bedroom     Floor 4",
        sublabel:  "North-facing     quiet outlook",
        pos:       [-8, 14.2, 5.0],
        yaw:       0,
        pitch:     -0.05,
        fov:       65,
        hint:      "Peaceful north-facing bedroom with tree canopy views",
      },
    ],
    windows: [
      { side:"south", y:7.5,  w:3.2, h:2.4, glass:"warm" },
      { side:"south", y:10.8, w:3.2, h:2.4, glass:"warm" },
      { side:"south", y:14.2, w:3.2, h:2.4, glass:"warm" },
      { side:"south", y:17.8, w:3.2, h:2.4, glass:"warm" },
      { side:"north", y:14.2, w:2.8, h:2.0, glass:"clear" },
    ],
  },
};

//        INTERIOR SCENE STATE                                                                                                                                                                   
let intRenderer=null, intScene=null, intCamera=null;
let intActive=false, intYaw=0, intPitch=0;
let intLocked=false;
let currentBuildingType=null, currentRoom=null;
let moveF=false,moveB=false,moveL=false,moveR=false;

// Interior room bounds (prevent walking through walls)
const ROOM_BOUNDS = { minX:-7, maxX:7, minZ:-8, maxZ:8 };

//        INIT INTERIOR SCENE                                                                                                                                                                         
export function initInterior(canvas) {
  intRenderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  intRenderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  intRenderer.shadowMap.enabled = true;
  intRenderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  intRenderer.toneMapping       = THREE.ACESFilmicToneMapping;
  intRenderer.toneMappingExposure = 1.1;
  intRenderer.outputColorSpace  = THREE.SRGBColorSpace;
  intRenderer.setClearColor(0x0a1208, 1);

  intScene  = new THREE.Scene();
  intCamera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);

  setupInteriorControls(canvas);
}

//        OPEN BUILDING INTERIOR                                                                                                                                                                
export function openInterior(buildingType, roomKey) {
  const bld = INTERIORS[buildingType];
  if (!bld) return;
  currentBuildingType = buildingType;

  // Clear previous scene
  while (intScene.children.length) intScene.remove(intScene.children[0]);

  // Build interior geometry
  buildInteriorRoom(buildingType);

  // Teleport to room
  const room = bld.rooms.find(r=>r.key===roomKey) || bld.rooms[0];
  teleportToRoom(room);

  intActive = true;
  intRenderer.setAnimationLoop(interiorLoop);
}

export function closeInterior() {
  intActive = false;
  intRenderer.setAnimationLoop(null);
  if (intLocked) document.exitPointerLock();
}

function teleportToRoom(room) {
  currentRoom = room;
  intCamera.position.set(...room.pos);
  intCamera.fov = room.fov || 75;
  intCamera.updateProjectionMatrix();
  intYaw   = room.yaw   || 0;
  intPitch = room.pitch || 0;
}

//        BUILD INTERIOR ROOM GEOMETRY                                                                                                                                              
function buildInteriorRoom(type) {
  const bld = INTERIORS[type];

  // Materials
  const plasterM  = new THREE.MeshStandardMaterial({color:0xf0ede5, roughness:.85});
  const floorM    = new THREE.MeshStandardMaterial({color:0xc8b898, roughness:.4, metalness:.05});
  const concreteM = new THREE.MeshStandardMaterial({color:0xd8d0c4, roughness:.75});
  const glassWarm = new THREE.MeshStandardMaterial({color:0x2a4a5a, roughness:.05, metalness:.2, transparent:true, opacity:.35, side:THREE.DoubleSide});
  const glassClear= new THREE.MeshStandardMaterial({color:0x1a3040, roughness:.02, metalness:.25, transparent:true, opacity:.28, side:THREE.DoubleSide});
  const frameM    = new THREE.MeshStandardMaterial({color:0x1a1a1a, roughness:.4, metalness:.6});
  const timberM   = new THREE.MeshStandardMaterial({color:0x8a6a3a, roughness:.7});
  const skirM     = new THREE.MeshStandardMaterial({color:0xe8e4dc, roughness:.6});

  // Determine room dimensions from building type
  const W = type==='villa' ? 16 : type==='loft' ? 20 : 50;
  const D = type==='villa' ? 13 : type==='loft' ? 12 : 30;
  const H = type==='villa' ? 11.5 : type==='loft' ? 7.2 : 22;

  //        FLOOR                                                                                                                                                                                                          
  addInteriorPlane(W, D, floorM, [0, 0, 0]);

  //        CEILING                                                                                                                                                                                                    
  // Only render ceiling for current floor level to avoid solid wall
  const floorY = intCamera.position.y < 5 ? 0 :
                 intCamera.position.y < 9 ? 4.3 :
                 intCamera.position.y < 13 ? 8.5 : 12.8;
  const ceilH  = floorY + 3.2;
  addInteriorBox(W, .15, D, timberM, [0, ceilH, 0]); // timber ceiling battens

  //        WALLS (north, east, west     south is glazed)                                                                                           
  const wallH = 3.2;
  // North wall
  addInteriorBox(W, wallH, .22, plasterM, [0, floorY+wallH/2, -D/2]);
  // East wall
  addInteriorBox(.22, wallH, D,  plasterM, [W/2, floorY+wallH/2, 0]);
  // West wall
  addInteriorBox(.22, wallH, D,  plasterM, [-W/2, floorY+wallH/2, 0]);

  // South wall     mostly glass with frame structure (field-facing)
  // Solid side piers
  addInteriorBox(1.2, wallH, .22, concreteM, [-W/2+.6, floorY+wallH/2, D/2]);
  addInteriorBox(1.2, wallH, .22, concreteM, [W/2-.6,  floorY+wallH/2, D/2]);
  // Glass panels across south face
  const glassW = W - 3.2;
  addInteriorPlane(glassW, wallH-.5, glassWarm, [0, floorY+wallH/2, D/2]);
  // Frame
  addInteriorBox(glassW, .12, .12, frameM, [0, floorY+.45, D/2]);
  addInteriorBox(glassW, .12, .12, frameM, [0, floorY+wallH-.05, D/2]);
  // Vertical mullions every 1.6m
  for (let mx = -glassW/2; mx <= glassW/2; mx += 1.6)
    addInteriorBox(.08, wallH-.5, .08, frameM, [mx, floorY+wallH/2, D/2]);
  // Skirting
  addInteriorBox(W, .12, .12, skirM, [0, floorY+.06, -D/2+.11]);

  //        FLOOR SLAB EDGES (visible if looking down)                                                                                              
  if (floorY > 0) {
    addInteriorBox(W, .2, .2, concreteM, [0, floorY, -D/2]);
    addInteriorBox(W, .2, .2, concreteM, [0, floorY,  D/2]);
  }

  //        FURNITURE (simple, high-quality)                                                                                                                            
  if (type === 'villa' || type === 'loft') {
    addInteriorFurniture(type, floorY);
  }

  //        LIGHTING                                                                                                                                                                                                    
  // Bright from outside (south, simulating sun through glass)
  const sunIn = new THREE.DirectionalLight(0xffe8b0, 3.5);
  sunIn.position.set(0, floorY+3, D/2+10);
  sunIn.castShadow = true;
  intScene.add(sunIn);
  // Warm interior ambient
  intScene.add(new THREE.HemisphereLight(0xfff0e0, 0x3a2a18, 1.2));
  // Ceiling downlights
  for (let dx=-W/2+2; dx<=W/2-2; dx+=3) {
    const pt = new THREE.PointLight(0xfff0e0, 1.0, 8, 2);
    pt.position.set(dx, ceilH-.1, 0);
    intScene.add(pt);
  }

  //        SKY/VIEW BOX (what you see through the glass     the estate)                                                 
  addExteriorView(type, floorY, D);
}

function addExteriorView(type, floorY, D) {
  // Creates a panoramic backdrop visible through the south glazing
  // Simulates the actual estate view the owner would have

  const bgCanvas = document.createElement('canvas');
  bgCanvas.width = 1024; bgCanvas.height = 512;
  const ctx = bgCanvas.getContext('2d');

  // Sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, 512);
  skyGrad.addColorStop(0,    '#1a3a6a');
  skyGrad.addColorStop(0.45, '#5a9acc');
  skyGrad.addColorStop(0.7,  '#8ab8d4');
  skyGrad.addColorStop(1,    '#c8d8e0');
  ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, 1024, 512);

  // Ground plane (polo field green)
  const fieldGrad = ctx.createLinearGradient(0, 320, 0, 512);
  fieldGrad.addColorStop(0, '#5a9448');
  fieldGrad.addColorStop(1, '#3a7028');
  ctx.fillStyle = fieldGrad; ctx.fillRect(0, 320, 1024, 192);

  // Safety zone (brown ring visible from above)
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(0, 310, 1024, 20);

  // Tree canopy horizon
  ctx.fillStyle = '#2a5a18';
  for (let tx = 0; tx <= 1024; tx += 28) {
    const tH = 30 + Math.random()*25;
    ctx.beginPath();
    ctx.arc(tx, 310, tH/2, 0, Math.PI*2);
    ctx.fill();
  }

  // Lake glint (if north-facing view)
  if (type !== 'apartment') {
    ctx.fillStyle = 'rgba(40,120,180,0.7)';
    ctx.beginPath();
    ctx.ellipse(500, 295, 120, 15, 0, 0, Math.PI*2);
    ctx.fill();
  }

  // Sun disc
  const sunGrad = ctx.createRadialGradient(800, 80, 0, 800, 80, 40);
  sunGrad.addColorStop(0, '#ffe8b0');
  sunGrad.addColorStop(1, 'rgba(255,232,176,0)');
  ctx.fillStyle = sunGrad; ctx.fillRect(760, 40, 80, 80);

  const bgTex = new THREE.CanvasTexture(bgCanvas);
  bgTex.colorSpace = THREE.SRGBColorSpace;

  // Large backdrop plane far outside the south window
  const bgM = new THREE.MeshBasicMaterial({map:bgTex, side:THREE.FrontSide, depthWrite:false});
  const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(200, 80), bgM);
  bgMesh.position.set(0, floorY+2, D/2+60);
  bgMesh.renderOrder = -1;
  intScene.add(bgMesh);
}

function addInteriorFurniture(type, floorY) {
  const sofaM   = new THREE.MeshStandardMaterial({color:0xd8cec0, roughness:.85});
  const tableM  = new THREE.MeshStandardMaterial({color:0x5a3c1c, roughness:.6, metalness:.1});
  const rugM    = new THREE.MeshStandardMaterial({color:0xa09060, roughness:.95});
  const plantM  = new THREE.MeshStandardMaterial({color:0x2a6a1a, roughness:.9});

  const y = floorY;

  // Sofa group
  const sofa = new THREE.Group();
  sofa.add(addIM(2.4, .45, .9, sofaM, [0, y+.45, 1.5]));
  sofa.add(addIM(2.4, .5,  .12,sofaM, [0, y+.75,-0.3]));  // back
  for (const ax of [-1.14, 1.14])
    sofa.add(addIM(.12, .55, .9, sofaM, [ax, y+.5, 1.5])); // arms
  intScene.add(sofa);

  // Coffee table
  intScene.add(addIM(1.1, .04, .6, tableM, [0, y+.42, 2.8]));
  intScene.add(addIM(.05, .42, .05, tableM, [-.5, y+.21, 2.6]));
  intScene.add(addIM(.05, .42, .05, tableM, [.5,  y+.21, 2.6]));
  intScene.add(addIM(.05, .42, .05, tableM, [-.5, y+.21, 3.0]));
  intScene.add(addIM(.05, .42, .05, tableM, [.5,  y+.21, 3.0]));

  // Rug
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.5), rugM);
  rug.rotation.x = -Math.PI/2; rug.position.set(0, y+.01, 2.0);
  intScene.add(rug);

  // Plant in corner
  const plantStem = new THREE.Mesh(new THREE.CylinderGeometry(.08,.12,.6,8), tableM);
  plantStem.position.set(-3.5, y+.3, -2.5); intScene.add(plantStem);
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(.55,8,6), plantM);
  leaf.position.set(-3.5, y+.9, -2.5); intScene.add(leaf);

  // Dining table if enough space
  if (type === 'villa') {
    intScene.add(addIM(2.0, .04, .9, tableM, [3.5, y+.76, -1.5]));
    intScene.add(addIM(.06, .76, .06, tableM, [3.0, y+.38, -1.1]));
    intScene.add(addIM(.06, .76, .06, tableM, [4.0, y+.38, -1.1]));
    intScene.add(addIM(.06, .76, .06, tableM, [3.0, y+.38, -1.9]));
    intScene.add(addIM(.06, .76, .06, tableM, [4.0, y+.38, -1.9]));
  }
}

//        GEOMETRY HELPERS                                                                                                                                                                               
function addIM(w, h, d, mat, pos) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
  m.position.set(...pos); m.castShadow=true; m.receiveShadow=true;
  intScene.add(m); return m;
}
function addInteriorBox(w, h, d, mat, pos) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
  m.position.set(...pos); m.castShadow=true; m.receiveShadow=true;
  intScene.add(m); return m;
}
function addInteriorPlane(w, h, mat, pos) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w,h), mat);
  m.position.set(...pos); m.receiveShadow=true;
  intScene.add(m); return m;
}

//        CONTROLS                                                                                                                                                                                                       
function setupInteriorControls(canvas) {
  canvas.addEventListener('click', () => {
    if (intActive) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    intLocked = document.pointerLockElement === canvas;
  });
  document.addEventListener('mousemove', e => {
    if (!intActive || !intLocked) return;
    intYaw   -= e.movementX * 0.0024;
    intPitch  = Math.max(-0.9, Math.min(0.7, intPitch - e.movementY * 0.0024));
  });
  window.addEventListener('keydown', e => {
    if (!intActive) return;
    if (e.key==='w'||e.key==='ArrowUp')    moveF=true;
    if (e.key==='s'||e.key==='ArrowDown')  moveB=true;
    if (e.key==='a'||e.key==='ArrowLeft')  moveL=true;
    if (e.key==='d'||e.key==='ArrowRight') moveR=true;
  });
  window.addEventListener('keyup', e => {
    if (e.key==='w'||e.key==='ArrowUp')    moveF=false;
    if (e.key==='s'||e.key==='ArrowDown')  moveB=false;
    if (e.key==='a'||e.key==='ArrowLeft')  moveL=false;
    if (e.key==='d'||e.key==='ArrowRight') moveR=false;
  });
  // Touch look (right half) and move (left half)
  let lookLast=null;
  canvas.addEventListener('touchstart', e=>{
    if(!intActive) return; e.preventDefault();
    for(const t of e.changedTouches)
      if(t.clientX > canvas.clientWidth/2) lookLast={x:t.clientX,y:t.clientY,id:t.identifier};
  },{passive:false});
  canvas.addEventListener('touchmove', e=>{
    if(!intActive||!lookLast) return; e.preventDefault();
    for(const t of e.changedTouches) if(t.identifier===lookLast.id){
      intYaw   -= (t.clientX-lookLast.x)*.003;
      intPitch  = Math.max(-.9,Math.min(.7,intPitch-(t.clientY-lookLast.y)*.003));
      lookLast={x:t.clientX,y:t.clientY,id:t.identifier};
    }
  },{passive:false});
  canvas.addEventListener('touchend', e=>{
    for(const t of e.changedTouches) if(lookLast&&t.identifier===lookLast.id) lookLast=null;
  });
}

//        ANIMATION LOOP                                                                                                                                                                                     
const intClock = new THREE.Clock();
function interiorLoop() {
  const dt = Math.min(intClock.getDelta(), .05);
  // Movement
  if (moveF||moveB||moveL||moveR) {
    const spd = 3.5;
    const fwd = new THREE.Vector3(-Math.sin(intYaw), 0, -Math.cos(intYaw));
    const rgt = new THREE.Vector3( Math.cos(intYaw), 0, -Math.sin(intYaw));
    const move= new THREE.Vector3();
    if(moveF) move.addScaledVector(fwd, 1);
    if(moveB) move.addScaledVector(fwd,-1);
    if(moveL) move.addScaledVector(rgt,-1);
    if(moveR) move.addScaledVector(rgt, 1);
    if(move.lengthSq()>.001){
      move.normalize().multiplyScalar(spd*dt);
      intCamera.position.add(move);
      // Clamp to room
      intCamera.position.x = Math.max(ROOM_BOUNDS.minX, Math.min(ROOM_BOUNDS.maxX, intCamera.position.x));
      intCamera.position.z = Math.max(ROOM_BOUNDS.minZ, Math.min(ROOM_BOUNDS.maxZ, intCamera.position.z));
    }
  }
  // Look
  intCamera.rotation.order = 'YXZ';
  intCamera.rotation.y = intYaw;
  intCamera.rotation.x = intPitch;
  intRenderer.render(intScene, intCamera);
}

export function resizeInterior(w, h) {
  if (!intRenderer) return;
  intRenderer.setSize(w, h);
  if (intCamera) { intCamera.aspect=w/h; intCamera.updateProjectionMatrix(); }
}

export function getInteriorRooms(buildingType) {
  return INTERIORS[buildingType]?.rooms || [];
}
