/**
 * Project XIX -- Interior Walkthrough System v2
 * Built from actual architectural drawings:
 *   - 3-Bed Villa floor plans + section + elevation
 * All dimensions in metres, sourced from drawings:
 *   Level 0=0m, Level 5=2.1m (undercroft), Level 2=2.85m (GF floor),
 *   Level 3=6.15m (F1 floor), Level 4=9.45m (roof base)
 *   Floor-to-floor = 3.3m each level
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";

//        ROOM CATALOGUE                                                                                                                                                                                        
// pos = [x, y, z] in interior space (centred on villa footprint)
// yaw = camera facing direction (0 = south/field, PI = north/lake)
// pitch = camera tilt (-ve = look down, +ve = look up)
export const INTERIORS = {

  villa: {
    name: "3-Bedroom Premium Villa",
    rooms: [
      {
        key:      "undercroft",
        label:    "Undercroft Parking",
        sublabel: "Ground level     2-car private garage",
        pos:      [-1.5, 1.2, 1.0],   // standing in undercroft, 1.2m eye (low)
        yaw:      Math.PI,             // looking out toward road/field
        pitch:    0,
        fov:      72,
        hint:     "Secure 2-car undercroft parking beneath the villa plinth. Ramp access from road.",
        floorY:   0.0,
        ceilH:    2.1,
        W: 6.0, D: 7.0,
        windows:  [{ side:"south", cx:0,   cy:1.05, w:5.5, h:1.8, type:"dark" }],
        exterior: { direction:"field", elevation:0 },
      },
      {
        key:      "living_dining",
        label:    "Living & Dining",
        sublabel: "Ground floor     42m       polo field view",
        pos:      [1.5, 4.5, 1.0],    // y=2.85+1.65=4.50
        yaw:      Math.PI,             // facing south (polo field)
        pitch:    -0.04,
        fov:      78,
        hint:     "42m   open-plan living and dining. Full-height south glazing frames the polo field. East terrace door to right.",
        floorY:   2.85,
        ceilH:    6.15,
        W: 7.0, D: 6.0,
        windows:  [
          { side:"south", cx:0,    cy:4.50, w:6.5, h:2.8, type:"warm" },
          { side:"east",  cx:0,    cy:4.50, w:2.0, h:2.4, type:"warm" },
        ],
        exterior: { direction:"field", elevation: 2.85 },
      },
      {
        key:      "kitchen",
        label:    "Kitchen",
        sublabel: "Ground floor     26m  ",
        pos:      [-3.0, 4.5, -1.5],
        yaw:      -Math.PI/2,          // facing west (polo field side)
        pitch:    0,
        fov:      70,
        hint:     "26m   kitchen with terrace access facing west toward the polo field. Natural light throughout the day.",
        floorY:   2.85,
        ceilH:    6.15,
        W: 5.6, D: 4.6,
        windows:  [
          { side:"west",  cx:0, cy:4.50, w:3.5, h:2.2, type:"warm" },
          { side:"north", cx:0, cy:4.50, w:2.2, h:1.8, type:"clear" },
        ],
        exterior: { direction:"field", elevation: 2.85 },
      },
      {
        key:      "west_terrace",
        label:    "West Terrace",
        sublabel: "Ground floor     polo field-facing terrace",
        pos:      [-5.5, 3.0, 0.0],   // on the terrace itself (cantilevered slab level)
        yaw:      -Math.PI/2,          // facing west, directly at polo field
        pitch:    -0.05,
        fov:      82,
        hint:     "Open terrace directly facing the polo field. Your private grandstand seat during match days.",
        floorY:   2.85,
        ceilH:    6.15,
        W: 3.0, D: 6.0,
        windows:  [],                  // open terrace - no walls
        exterior: { direction:"field", elevation: 2.85 },
      },
      {
        key:      "study",
        label:    "Study",
        sublabel: "Ground floor     22m  ",
        pos:      [3.5, 4.5, -2.5],
        yaw:      0,                   // facing north
        pitch:    0,
        fov:      65,
        hint:     "22m   study with north-facing outlook toward the lake and crescent road.",
        floorY:   2.85,
        ceilH:    6.15,
        W: 5.0, D: 4.4,
        windows:  [
          { side:"north", cx:0, cy:4.50, w:3.2, h:2.0, type:"clear" },
          { side:"east",  cx:0, cy:4.50, w:2.0, h:1.8, type:"clear" },
        ],
        exterior: { direction:"lake", elevation: 2.85 },
      },
      {
        key:      "master_bedroom",
        label:    "Master Bedroom",
        sublabel: "First floor     27m       lake view",
        pos:      [-2.5, 7.8, -2.5],  // y=6.15+1.65=7.80
        yaw:      0,                   // facing north (lake)
        pitch:    -0.06,
        fov:      68,
        hint:     "27m   master suite. Wake to views of the crescent lake through north-facing floor-to-ceiling glazing.",
        floorY:   6.15,
        ceilH:    9.45,
        W: 5.5, D: 4.9,
        windows:  [
          { side:"north", cx:0,    cy:7.80, w:4.2, h:2.6, type:"warm" },
          { side:"west",  cx:0,    cy:7.80, w:2.8, h:2.4, type:"warm" },
        ],
        exterior: { direction:"lake", elevation: 6.15 },
      },
      {
        key:      "bedroom2",
        label:    "Bedroom 2",
        sublabel: "First floor     16m       north aspect",
        pos:      [2.5, 7.8, -2.5],
        yaw:      0,                   // facing north
        pitch:    -0.04,
        fov:      65,
        hint:     "16m   second bedroom with north aspect. Quiet and private, overlooking the crescent road and loft terraces beyond.",
        floorY:   6.15,
        ceilH:    9.45,
        W: 4.2, D: 3.8,
        windows:  [
          { side:"north", cx:0, cy:7.80, w:3.0, h:2.2, type:"clear" },
        ],
        exterior: { direction:"lake", elevation: 6.15 },
      },
      {
        key:      "bedroom3",
        label:    "Bedroom 3",
        sublabel: "First floor     17m       south & west views",
        pos:      [-2.0, 7.8, 1.5],
        yaw:      Math.PI,             // facing south (polo field view from F1)
        pitch:    -0.06,
        fov:      68,
        hint:     "17m   third bedroom. South and west windows give first-floor polo field views     an elevated match-day seat.",
        floorY:   6.15,
        ceilH:    9.45,
        W: 4.5, D: 3.8,
        windows:  [
          { side:"south", cx:0,   cy:7.80, w:2.8, h:2.4, type:"warm" },
          { side:"west",  cx:0,   cy:7.80, w:2.2, h:2.0, type:"warm" },
        ],
        exterior: { direction:"field", elevation: 6.15 },
      },
      {
        key:      "family_lounge",
        label:    "Family Lounge",
        sublabel: "First floor     23m       south terrace",
        pos:      [2.5, 7.8, 1.5],
        yaw:      Math.PI,             // facing south toward balcony
        pitch:    -0.08,
        fov:      76,
        hint:     "23m   family lounge opening onto the south balcony. First-floor elevation gives an unobstructed polo field panorama.",
        floorY:   6.15,
        ceilH:    9.45,
        W: 5.2, D: 4.5,
        windows:  [
          { side:"south", cx:0, cy:7.80, w:4.5, h:2.8, type:"warm" },
          { side:"east",  cx:0, cy:7.80, w:2.0, h:2.4, type:"warm" },
        ],
        exterior: { direction:"field", elevation: 6.15 },
      },
      {
        key:      "south_balcony",
        label:    "South Balcony",
        sublabel: "First floor     elevated polo field view",
        pos:      [0.0, 6.35, 6.5],   // standing on balcony
        yaw:      Math.PI,             // looking south over polo field
        pitch:    -0.12,
        fov:      85,
        hint:     "First-floor south balcony. The entire polo field stretches before you. The clubhouse is visible in the distance.",
        floorY:   6.15,
        ceilH:    9.45,
        W: 7.0, D: 2.2,
        windows:  [],
        exterior: { direction:"field", elevation: 6.15 },
      },
    ],
  },

  loft: {
    name: "2-Bedroom Loft Terrace",
    rooms: [
      {
        key: "loft_living", label: "Open-Plan Living", sublabel: "Ground floor     crescent road view",
        pos: [0, 1.7, 0.5], yaw: Math.PI, pitch: -0.04, fov: 75,
        hint: "Open-plan living/dining with direct crescent road view through south glazing.",
        floorY: 0, ceilH: 3.2, W: 6.0, D: 8.0,
        windows: [{ side:"south", cx:0, cy:1.7, w:5.5, h:2.5, type:"warm" }],
        exterior: { direction:"road", elevation: 0 },
      },
      {
        key: "loft_master", label: "Master Bedroom", sublabel: "First floor     rear outlook",
        pos: [0, 4.9, -2.5], yaw: 0, pitch: -0.04, fov: 65,
        hint: "First-floor master bedroom. Private outlook over rear garden.",
        floorY: 3.2, ceilH: 6.4, W: 5.5, D: 4.2,
        windows: [{ side:"north", cx:0, cy:4.9, w:3.5, h:2.2, type:"warm" }],
        exterior: { direction:"garden", elevation: 3.2 },
      },
      {
        key: "loft_void", label: "Living Void", sublabel: "First floor     looking down",
        pos: [0, 5.0, 1.0], yaw: Math.PI, pitch: -0.5, fov: 80,
        hint: "The dramatic double-height void above the living room     a defining feature of the loft typology.",
        floorY: 3.2, ceilH: 6.4, W: 4.0, D: 3.5,
        windows: [],
        exterior: { direction:"none", elevation: 0 },
      },
      {
        key: "loft_terrace", label: "Front Terrace", sublabel: "Ground floor     crescent address",
        pos: [0, 0.1, 6.5], yaw: 0, pitch: -0.05, fov: 80,
        hint: "Private front terrace. Crescent road address with timber slatted privacy screen to fore.",
        floorY: 0, ceilH: 3.2, W: 6.0, D: 3.0,
        windows: [],
        exterior: { direction:"road", elevation: 0 },
      },
    ],
  },

  apartment: {
    name: "2-Bedroom Apartment",
    rooms: [
      {
        key: "apt_lobby", label: "Podium Lobby", sublabel: "Ground level     main entrance",
        pos: [0, 1.5, 8.0], yaw: Math.PI, pitch: 0, fov: 70,
        hint: "Grand double-height lobby with concierge desk.",
        floorY: 0, ceilH: 6.8, W: 12, D: 8,
        windows: [{ side:"south", cx:0, cy:3.4, w:10, h:5.5, type:"dark" }],
        exterior: { direction:"field", elevation: 0 },
      },
      {
        key: "apt_living_f2", label: "Living     Floor 2", sublabel: "First residential floor",
        pos: [0, 7.5, -4.0], yaw: Math.PI, pitch: -0.05, fov: 75,
        hint: "Open-plan living with south balcony access. Estate avenue view.",
        floorY: 6.8, ceilH: 10.1, W: 10, D: 6,
        windows: [{ side:"south", cx:0, cy:7.5, w:8.5, h:2.8, type:"warm" }],
        exterior: { direction:"field", elevation: 6.8 },
      },
      {
        key: "apt_living_f5", label: "Living     Floor 5", sublabel: "Top floor     full estate panorama",
        pos: [0, 17.8, -4.0], yaw: Math.PI, pitch: -0.12, fov: 82,
        hint: "Top-floor living. Unobstructed panorama across the entire estate and beyond.",
        floorY: 17.0, ceilH: 20.3, W: 10, D: 6,
        windows: [{ side:"south", cx:0, cy:17.8, w:8.5, h:2.8, type:"warm" }],
        exterior: { direction:"field", elevation: 17.0 },
      },
      {
        key: "apt_balcony_f3", label: "Balcony     Floor 3", sublabel: "Mid-rise south-facing",
        pos: [0, 10.8, -7.2], yaw: Math.PI, pitch: -0.10, fov: 88,
        hint: "Step outside to the wraparound balcony. The polo field spreads ahead at mid-rise height.",
        floorY: 10.1, ceilH: 13.4, W: 8, D: 1.8,
        windows: [],
        exterior: { direction:"field", elevation: 10.1 },
      },
      {
        key: "apt_master", label: "Master Bedroom", sublabel: "Floor 4     quiet north aspect",
        pos: [-4, 14.2, 3.5], yaw: 0, pitch: -0.05, fov: 65,
        hint: "North-facing master. Tree canopy views, quiet and private.",
        floorY: 13.4, ceilH: 16.7, W: 7, D: 5,
        windows: [{ side:"north", cx:0, cy:14.2, w:5.0, h:2.5, type:"clear" }],
        exterior: { direction:"north", elevation: 13.4 },
      },
    ],
  },
};

//        INTERIOR SCENE                                                                                                                                                                                     
let intRenderer=null, intScene=null, intCamera=null;
let intActive=false, intYaw=0, intPitch=0, intLocked=false;
let moveF=false,moveB=false,moveL=false,moveR=false;
let currentRoom=null;

export function initInterior(canvas) {
  intRenderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true });
  intRenderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
  intRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  intRenderer.toneMappingExposure = 1.05;
  intRenderer.outputColorSpace = THREE.SRGBColorSpace;
  intRenderer.setClearColor(0x0a1208, 1);
  intCamera = new THREE.PerspectiveCamera(75, 1, 0.02, 300);
  intScene  = new THREE.Scene();
  bindControls(canvas);
}

export function openInterior(buildingType, roomKey) {
  const bld = INTERIORS[buildingType];
  if (!bld) return;
  const room = bld.rooms.find(r=>r.key===roomKey) || bld.rooms[0];
  buildRoom(room);
  teleport(room);
  intActive = true;
  intRenderer.setAnimationLoop(loop);
}

export function closeInterior() {
  intActive = false;
  intRenderer.setAnimationLoop(null);
  if (intLocked) document.exitPointerLock();
  moveF=moveB=moveL=moveR=false;
}

function teleport(room) {
  currentRoom = room;
  intCamera.position.set(...room.pos);
  intCamera.fov = room.fov || 75;
  intCamera.updateProjectionMatrix();
  intYaw   = room.yaw || 0;
  intPitch = room.pitch || 0;
}

//        ROOM BUILDER                                                                                                                                                                                           
function buildRoom(room) {
  while (intScene.children.length) intScene.remove(intScene.children[0]);

  const { floorY, ceilH, W, D, windows, exterior } = room;
  const wallH   = ceilH - floorY;
  const floorCx = 0, floorCz = 0;
  const halfW   = W/2, halfD = D/2;

  //        MATERIALS                                                                                                                                                                                              
  const M = {
    plaster:  new THREE.MeshStandardMaterial({color:0xf2efe7, roughness:.88, side:THREE.BackSide}),
    plasterF: new THREE.MeshStandardMaterial({color:0xf2efe7, roughness:.88}),
    floor:    new THREE.MeshStandardMaterial({color:0xc8b898, roughness:.35, metalness:.06}),
    ceil:     new THREE.MeshStandardMaterial({color:0xe8e5de, roughness:.9, side:THREE.BackSide}),
    timber:   new THREE.MeshStandardMaterial({color:0x8a6a3a, roughness:.65}),
    glass:    new THREE.MeshStandardMaterial({color:0x2a6080, roughness:.04, metalness:.25, transparent:true, opacity:.32, side:THREE.DoubleSide}),
    glassW:   new THREE.MeshStandardMaterial({color:0x3a5870, roughness:.04, metalness:.2,  transparent:true, opacity:.28, side:THREE.DoubleSide}),
    frame:    new THREE.MeshStandardMaterial({color:0x181818, roughness:.45, metalness:.65}),
    skirt:    new THREE.MeshStandardMaterial({color:0xe5e2d8, roughness:.6}),
    concrete: new THREE.MeshStandardMaterial({color:0xd5cfc5, roughness:.8}),
    rail:     new THREE.MeshStandardMaterial({color:0x1a1a1a, roughness:.4, metalness:.8, transparent:true, opacity:.7}),
    railGlass:new THREE.MeshStandardMaterial({color:0x88aabb, roughness:.05, transparent:true, opacity:.25, side:THREE.DoubleSide}),
  };

  //        FLOOR                                                                                                                                                                                                          
  const floorG = new THREE.PlaneGeometry(W, D);
  const floorM = new THREE.Mesh(floorG, M.floor);
  floorM.rotation.x = -Math.PI/2; floorM.position.set(0, floorY, 0);
  floorM.receiveShadow = true; intScene.add(floorM);
  // Skirting board
  addSB(M.skirt, -halfW, halfW, floorY, halfD, halfD);

  //        CEILING                                                                                                                                                                                                       
  const ceilG = new THREE.PlaneGeometry(W, D);
  const ceilM = new THREE.Mesh(ceilG, M.ceil);
  ceilM.rotation.x = Math.PI/2; ceilM.position.set(0, ceilH, 0);
  intScene.add(ceilM);
  // Timber ceiling battens
  for (let bx=-halfW+.5; bx<=halfW-.5; bx+=.55) {
    const btn=new THREE.Mesh(new THREE.BoxGeometry(.08,.08,D-.3),M.timber);
    btn.position.set(bx, ceilH-.05, 0); intScene.add(btn);
  }

  //        WALLS                                                                                                                                                                                                             
  // Build a room box (open on field-facing side for large glazing)
  // North wall (always solid)
  addWall(M.plaster, 0, floorY+wallH/2, -halfD,   W, wallH, .22, 0, windows);
  // East wall
  addWall(M.plaster, halfW, floorY+wallH/2, 0,     .22, wallH, D,  0, windows, 'east');
  // West wall
  addWall(M.plaster,-halfW, floorY+wallH/2, 0,     .22, wallH, D,  0, windows, 'west');
  // South wall (glazed / partial)
  addSouthGlazing(M, floorY, wallH, W, halfD, windows);

  //        FLOOR SLAB EDGE (visible from below)                                                                                                                
  if (floorY > 0.5) {
    const slabM = new THREE.Mesh(new THREE.BoxGeometry(W+.5, .22, D+.5), M.concrete);
    slabM.position.set(0, floorY-.11, 0); intScene.add(slabM);
  }

  //        FURNITURE                                                                                                                                                                                                    
  addFurniture(room, M, floorY);

  //        EXTERIOR VIEW (what's visible through the glass)                                                                            
  addExteriorView(room, M);

  //        LIGHTING                                                                                                                                                                                                    
  addInteriorLighting(room, floorY, ceilH, W);
}

function addWall(mat, x, y, z, w, h, d, ry, windows, side) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
  m.position.set(x, y, z); m.rotation.y=ry||0;
  m.receiveShadow=true; intScene.add(m);
}

function addSouthGlazing(M, floorY, wallH, W, halfD, windows) {
  // Concrete piers on edges of south face
  addIM(1.4, wallH, .22, M.plasterF, [-W/2+.7, floorY+wallH/2, halfD]);
  addIM(1.4, wallH, .22, M.plasterF, [ W/2-.7, floorY+wallH/2, halfD]);
  // Sill
  addIM(W-3.0, .45, .28, M.concrete, [0, floorY+.22, halfD]);
  // Glass pane
  const glassW = W - 3.2;
  addIM(glassW, wallH-.6, .06, M.glassW, [0, floorY+wallH/2+.2, halfD]);
  // Frame lines
  addIM(glassW, .08, .08, M.frame, [0, floorY+.45, halfD]);
  addIM(glassW, .08, .08, M.frame, [0, floorY+wallH-.05, halfD]);
  for (let mx=-glassW/2+.8; mx<=glassW/2-.8; mx+=1.55)
    addIM(.08, wallH-.6, .08, M.frame, [mx, floorY+wallH/2+.2, halfD]);
  // Glass balustrade on balcony side (exterior)
  addIM(glassW, .9, .06, M.railGlass, [0, floorY+.5, halfD+.5]);
  addIM(glassW, .06, .06, M.rail, [0, floorY+.96, halfD+.5]);
}

function addSB(mat, x1, x2, y, z1, z2) { // skirting board
  [[x1,z1,x2,z1],[x1,z2,x2,z2],[x1,z1,x1,z2],[x2,z1,x2,z2]].forEach(([ax,az,bx,bz])=>{
    const len = Math.sqrt((bx-ax)**2+(bz-az)**2);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len,.1,.06), mat);
    m.position.set((ax+bx)/2, y+.05, (az+bz)/2);
    m.rotation.y = Math.atan2(bx-ax, bz-az);
    intScene.add(m);
  });
}

//        FURNITURE                                                                                                                                                                                                 
function addFurniture(room, M, floorY) {
  const y = floorY;
  const sofaM  = new THREE.MeshStandardMaterial({color:0xd4c8b4,roughness:.88});
  const tableM = new THREE.MeshStandardMaterial({color:0x3a2010,roughness:.5,metalness:.08});
  const bedM   = new THREE.MeshStandardMaterial({color:0xeae5dc,roughness:.9});
  const pillow = new THREE.MeshStandardMaterial({color:0xfdfcfa,roughness:.85});
  const rugM   = new THREE.MeshStandardMaterial({color:0x9a8060,roughness:.95});
  const plantM = new THREE.MeshStandardMaterial({color:0x2a5a18,roughness:.9});
  const potM   = new THREE.MeshStandardMaterial({color:0x3a6048,roughness:.6,metalness:.15});
  const tvM    = new THREE.MeshStandardMaterial({color:0x0a0a0a,roughness:.3,metalness:.7});

  const k = room.key;

  if (k==='living_dining' || k==='apt_living_f2' || k==='apt_living_f5') {
    // Sofa
    addIM(2.6,.46,1.0,sofaM,[0,y+.46, 1.2]);
    addIM(2.6,.52,.14,sofaM,[0,y+.72,-0.4]); // back
    for(const ax of[-1.23,1.23]) addIM(.14,.55,1.0,sofaM,[ax,y+.52,1.2]);
    // Coffee table
    addIM(1.2,.04,.65,tableM,[0,y+.42,2.6]);
    for(const [tx,tz] of [[-0.5,2.4],[.5,2.4],[-0.5,2.8],[.5,2.8]])
      addIM(.05,.42,.05,tableM,[tx,y+.21,tz]);
    // Rug
    const rug=new THREE.Mesh(new THREE.PlaneGeometry(3.8,2.8),rugM);
    rug.rotation.x=-Math.PI/2; rug.position.set(0,y+.01,1.8); intScene.add(rug);
    // TV on north wall
    addIM(1.6,.9,.06,tvM,[0,y+1.4,-2.9]);
    addIM(.04,.85,.04,tableM,[0,y+.42,-2.85]);
    // Side table + plant
    addIM(.45,.04,.45,tableM,[2.8,y+.55,-.5]);
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(.1,.14,.65,8),potM);
    stem.position.set(2.8,y+.65,-.5); intScene.add(stem);
    const leaf=new THREE.Mesh(new THREE.SphereGeometry(.62,8,6),plantM);
    leaf.position.set(2.8,y+1.1,-.5); intScene.add(leaf);
    // Dining table (villa only)
    if (k==='living_dining') {
      addIM(2.2,.04,1.1,tableM,[3.0,y+.76,-1.8]);
      for(const [tx,tz] of [[2.4,-1.4],[3.6,-1.4],[2.4,-2.2],[3.6,-2.2]])
        addIM(.05,.76,.05,tableM,[tx,y+.38,tz]);
      // Dining chairs (simple boxes)
      const chairM=new THREE.MeshStandardMaterial({color:0xd0c4b0,roughness:.85});
      for(const [cx,cz,cry] of [[2.0,-1.8,Math.PI/2],[4.0,-1.8,-Math.PI/2],[3.0,-1.1,0],[3.0,-2.5,Math.PI]])
        { addIM(.45,.45,.42,chairM,[cx,y+.45,cz]); addIM(.45,.6,.08,chairM,[cx,y+.72,cz+.21*Math.cos(cry)]); }
    }
  }

  if (k.includes('bedroom') || k.includes('master')) {
    const bW=1.6, bD=2.1;
    // Bed base
    addIM(bW,.45,bD,bedM,[0,y+.45,-.5]);
    // Mattress
    addIM(bW-.1,.18,bD-.1,new THREE.MeshStandardMaterial({color:0xfaf8f4,roughness:.92}),[0,y+.58,-.5]);
    // Pillows
    for(const px of [-.35,.35]) addIM(.55,.18,.35,pillow,[px,y+.77,-.5-bD/2+.25]);
    // Bedside tables
    for(const bx of [-(bW/2+.35),(bW/2+.35)]) {
      addIM(.5,.5,.45,tableM,[bx,y+.5,-.5]);
      // Lamp
      addIM(.08,.35,.08,tableM,[bx,y+.85,-.3]);
      const shade=new THREE.Mesh(new THREE.ConeGeometry(.22,.28,12),
        new THREE.MeshStandardMaterial({color:0xfff8e8,roughness:.6,emissive:new THREE.Color(0xffe0a0),emissiveIntensity:.4}));
      shade.position.set(bx,y+1.12,-.3); intScene.add(shade);
    }
    // Wardrobe
    addIM(1.8,2.1,.55,new THREE.MeshStandardMaterial({color:0xf0ece4,roughness:.7}),[-(room.W/2)+1.2,y+1.05,room.D/2-.35]);
    // Rug
    const rug2=new THREE.Mesh(new THREE.PlaneGeometry(2.5,3.0),rugM);
    rug2.rotation.x=-Math.PI/2; rug2.position.set(0,y+.01,-.3); intScene.add(rug2);
  }

  if (k==='west_terrace' || k==='south_balcony' || k==='loft_terrace') {
    // Outdoor lounge chairs
    const wicker=new THREE.MeshStandardMaterial({color:0xd4c098,roughness:.9});
    for(const [cx,cz] of [[-0.8,-.5],[.8,-.5]]) {
      addIM(.7,.45,.85,wicker,[cx,y+.45,cz]);
      addIM(.7,.55,.1,wicker,[cx,y+.72,cz-.45]);
    }
    // Small side table
    addIM(.55,.04,.55,tableM,[0,y+.42,.2]);
    // Potted plants on edges
    for(const px of [-2,2]) {
      const pot=new THREE.Mesh(new THREE.CylinderGeometry(.22,.18,.55,12),potM);
      pot.position.set(px,y+.28,1.0); intScene.add(pot);
      const pl=new THREE.Mesh(new THREE.SphereGeometry(.38,8,6),plantM);
      pl.position.set(px,y+.72,1.0); intScene.add(pl);
    }
  }
}

//        EXTERIOR VIEW BACKDROP                                                                                                                                                                
function addExteriorView(room, M) {
  const { exterior, floorY, D } = room;
  const dir = exterior?.direction || 'field';
  const elev = exterior?.elevation || floorY;

  const c = document.createElement('canvas'); c.width=2048; c.height=512;
  const ctx = c.getContext('2d');

  if (dir === 'none') return;

  // Sky
  const sky = ctx.createLinearGradient(0,0,0,512);
  sky.addColorStop(0,'#1a3a6a'); sky.addColorStop(.5,'#5a9acc'); sky.addColorStop(1,'#c8d8e0');
  ctx.fillStyle=sky; ctx.fillRect(0,0,2048,512);

  if (dir === 'field') {
    // Polo field view     green turf, brown safety zone, clubhouse silhouette
    // Ground plane
    const gnd = ctx.createLinearGradient(0,280,0,512);
    gnd.addColorStop(0,'#8B4513'); gnd.addColorStop(.15,'#5a9448'); gnd.addColorStop(1,'#3a7228');
    ctx.fillStyle=gnd; ctx.fillRect(0,280,2048,232);

    // Field stripes
    for(let i=0;i<14;i++) {
      ctx.fillStyle = i%2===0?'#5a9448':'#4a8038';
      ctx.fillRect(0, 310+i*8, 2048, 8);
    }

    // Tree canopy horizon
    ctx.fillStyle='#2a5a18';
    for(let tx=0;tx<=2048;tx+=32) {
      const th=18+Math.sin(tx*.05)*8+Math.random()*12;
      ctx.beginPath(); ctx.arc(tx,290,th/2,0,Math.PI*2); ctx.fill();
    }

    // Lake glint (if elevated enough to see it)
    if (elev >= 2.85) {
      ctx.fillStyle='rgba(40,120,180,.55)';
      ctx.beginPath(); ctx.ellipse(1024,285,220,14,0,0,Math.PI*2); ctx.fill();
    }

    // Clubhouse silhouette (south, visible from north-facing villas)
    ctx.fillStyle='rgba(240,235,225,.85)';
    ctx.fillRect(850,240,320,50); ctx.fillRect(860,215,30,30); ctx.fillRect(1150,215,30,30);

    // Elevation label     show perspective based on floor height
    // Higher elevation = more downward angle on field
    if (elev >= 6.0) {
      // F1 view     can see further, field recedes below
      ctx.fillStyle='rgba(200,180,150,.25)';
      ctx.beginPath(); ctx.moveTo(0,512); ctx.lineTo(2048,512); ctx.lineTo(1800,350); ctx.lineTo(248,350); ctx.closePath(); ctx.fill();
    }

    // Sun (afternoon, south-west)
    const sunG=ctx.createRadialGradient(1600,60,0,1600,60,55);
    sunG.addColorStop(0,'#ffe8b0'); sunG.addColorStop(1,'rgba(255,232,176,0)');
    ctx.fillStyle=sunG; ctx.fillRect(1545,5,110,110);
  }
  else if (dir === 'lake') {
    // North-facing     lake view
    const gnd=ctx.createLinearGradient(0,300,0,512);
    gnd.addColorStop(0,'#2a88c0'); gnd.addColorStop(.3,'#3a8848'); gnd.addColorStop(1,'#2a6828');
    ctx.fillStyle=gnd; ctx.fillRect(0,295,2048,217);
    // Lake water
    ctx.fillStyle='rgba(40,130,190,.8)';
    ctx.beginPath(); ctx.ellipse(1024,300,700,45,0,0,Math.PI*2); ctx.fill();
    // Ripples
    ctx.strokeStyle='rgba(255,255,255,.2)'; ctx.lineWidth=1.5;
    for(let i=0;i<5;i++) { ctx.beginPath(); ctx.ellipse(1024,305,500-i*50,20+i*3,0,0,Math.PI*2); ctx.stroke(); }
    // Tree line beyond lake
    ctx.fillStyle='#2a5a18';
    for(let tx=0;tx<=2048;tx+=28) {
      const th=22+Math.sin(tx*.04)*10;
      ctx.beginPath(); ctx.arc(tx,268,th/2,0,Math.PI*2); ctx.fill();
    }
  }
  else if (dir === 'road' || dir === 'garden') {
    const gnd=ctx.createLinearGradient(0,310,0,512);
    gnd.addColorStop(0,'#d0c8b0'); gnd.addColorStop(1,'#4a7a38');
    ctx.fillStyle=gnd; ctx.fillRect(0,300,2048,212);
    ctx.fillStyle='#3a7028';
    for(let tx=0;tx<=2048;tx+=24) {
      const th=14+Math.sin(tx*.08)*6;
      ctx.beginPath(); ctx.arc(tx,295,th/2,0,Math.PI*2); ctx.fill();
    }
  }

  const tex=new THREE.CanvasTexture(c); tex.colorSpace=THREE.SRGBColorSpace;
  const bg=new THREE.Mesh(new THREE.PlaneGeometry(250,80),
    new THREE.MeshBasicMaterial({map:tex,depthWrite:false}));
  bg.position.set(0, floorY+3.5, D/2+80);
  bg.renderOrder=-1; intScene.add(bg);
}

//        INTERIOR LIGHTING                                                                                                                                                                            
function addInteriorLighting(room, floorY, ceilH, W) {
  // Sun streaming in from south glass
  const sun=new THREE.DirectionalLight(0xffe8b0, 4.0);
  sun.position.set(-5, floorY+8, 30);
  sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);
  intScene.add(sun);

  // Warm ambient (plaster bounces warm)
  intScene.add(new THREE.HemisphereLight(0xfff4e8, 0x2a1808, 1.1));

  // Ceiling recessed downlights (every 1.5m)
  for(let dx=-W/2+1.5; dx<=W/2-1.5; dx+=1.5) {
    const pt=new THREE.PointLight(0xfff0e0, .9, 6, 2);
    pt.position.set(dx, ceilH-.12, 0); intScene.add(pt);
  }
  // Bedside lamps (warm glow for bedrooms)
  if (room.key.includes('bedroom') || room.key.includes('master')) {
    for(const bx of [-.9,.9]) {
      const lmp=new THREE.PointLight(0xffcc70, 1.2, 3.5, 2);
      lmp.position.set(bx, floorY+1.3, -.9); intScene.add(lmp);
    }
  }
}

//        GEOMETRY HELPER                                                                                                                                                                                  
function addIM(w,h,d,mat,pos) {
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  m.position.set(...pos); m.castShadow=true; m.receiveShadow=true;
  intScene.add(m); return m;
}

//        CONTROLS                                                                                                                                                                                                    
function bindControls(canvas) {
  canvas.addEventListener('click', ()=>{ if(intActive) canvas.requestPointerLock(); });
  document.addEventListener('pointerlockchange', ()=>{ intLocked=document.pointerLockElement===canvas; });
  document.addEventListener('mousemove', e=>{
    if(!intActive||!intLocked) return;
    intYaw   -= e.movementX*.0026;
    intPitch  = Math.max(-.85,Math.min(.65,intPitch-e.movementY*.0026));
  });
  window.addEventListener('keydown', e=>{
    if(!intActive) return;
    if(e.key==='w'||e.key==='ArrowUp')   moveF=true;
    if(e.key==='s'||e.key==='ArrowDown') moveB=true;
    if(e.key==='a'||e.key==='ArrowLeft') moveL=true;
    if(e.key==='d'||e.key==='ArrowRight')moveR=true;
  });
  window.addEventListener('keyup', e=>{
    if(e.key==='w'||e.key==='ArrowUp')   moveF=false;
    if(e.key==='s'||e.key==='ArrowDown') moveB=false;
    if(e.key==='a'||e.key==='ArrowLeft') moveL=false;
    if(e.key==='d'||e.key==='ArrowRight')moveR=false;
  });
  // Touch
  let lLast=null;
  canvas.addEventListener('touchstart',e=>{
    if(!intActive)return; e.preventDefault();
    for(const t of e.changedTouches)
      if(t.clientX>canvas.clientWidth/2) lLast={x:t.clientX,y:t.clientY,id:t.identifier};
  },{passive:false});
  canvas.addEventListener('touchmove',e=>{
    if(!intActive||!lLast)return; e.preventDefault();
    for(const t of e.changedTouches) if(t.identifier===lLast.id){
      intYaw-=(t.clientX-lLast.x)*.003;
      intPitch=Math.max(-.85,Math.min(.65,intPitch-(t.clientY-lLast.y)*.003));
      lLast={x:t.clientX,y:t.clientY,id:t.identifier};
    }
  },{passive:false});
  canvas.addEventListener('touchend',e=>{
    for(const t of e.changedTouches) if(lLast&&t.identifier===lLast.id) lLast=null;
  });
}

//        ANIMATION LOOP                                                                                                                                                                                     
const clk=new THREE.Clock();
function loop(){
  const dt=Math.min(clk.getDelta(),.05);
  if(moveF||moveB||moveL||moveR){
    const spd=3.0;
    const fwd=new THREE.Vector3(-Math.sin(intYaw),0,-Math.cos(intYaw));
    const rgt=new THREE.Vector3( Math.cos(intYaw),0,-Math.sin(intYaw));
    const mv=new THREE.Vector3();
    if(moveF) mv.addScaledVector(fwd,1);
    if(moveB) mv.addScaledVector(fwd,-1);
    if(moveL) mv.addScaledVector(rgt,-1);
    if(moveR) mv.addScaledVector(rgt,1);
    if(mv.lengthSq()>.001){
      mv.normalize().multiplyScalar(spd*dt);
      intCamera.position.add(mv);
      const r=currentRoom;
      if(r){
        intCamera.position.x=Math.max(-r.W/2+.3,Math.min(r.W/2-.3,intCamera.position.x));
        intCamera.position.z=Math.max(-r.D/2+.3,Math.min(r.D/2+2,intCamera.position.z));
        intCamera.position.y=Math.max(r.floorY+.8,Math.min(r.ceilH-.2,intCamera.position.y));
      }
    }
  }
  intCamera.rotation.order='YXZ';
  intCamera.rotation.y=intYaw;
  intCamera.rotation.x=intPitch;
  intRenderer.render(intScene,intCamera);
}

export function resizeInterior(w,h){
  if(!intRenderer)return;
  intRenderer.setSize(w,h);
  if(intCamera){intCamera.aspect=w/h;intCamera.updateProjectionMatrix();}
}
export function getInteriorRooms(t){return INTERIORS[t]?.rooms||[];}
