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


export function getInteriorRooms(t){return INTERIORS[t]?.rooms||[];}

// ═══════════════════════════════════════════════════════════════════════════
//  GEOMETRY FACTORY — this file no longer owns a scene, camera, renderer, or
//  controls. It previously ran an entire second, isolated Three.js app
//  (initInterior/openInterior/loop/bindControls) rendering a hand-painted
//  canvas texture standing in for "the view" — which is why stepping inside
//  a villa never showed the real polo field: the real field was never in
//  that scene at all, nothing could be. buildVillaRoomGroup() below returns
//  a self-contained THREE.Group of room geometry (walls, floor, ceiling,
//  glazing, furniture, fixture lighting) with NO exterior backdrop and NO
//  sun/hemisphere light of its own — the caller (scene.js) positions and
//  rotates this group at a specific villa's real world coordinates and adds
//  it directly into the estate's own scene, so whatever is visible through
//  the glazing is the same lake, clubhouse and polo field that were always
//  there, lit by the same sun already lighting the rest of the estate.
// ═══════════════════════════════════════════════════════════════════════════
export function buildVillaRoomGroup(room) {
  const group = new THREE.Group();
  group.name = `villaRoom_${room.key}`;

  const { floorY, ceilH, W, D } = room;
  const wallH = ceilH - floorY;
  const halfW = W / 2, halfD = D / 2;

  const add = (mesh) => { group.add(mesh); return mesh; };
  const addIM = (w, h, d, mat, pos) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(...pos);
    return add(m);
  };
  const addSB = (mat, x1, x2, y, z1, z2) => {
    add(new THREE.Mesh(new THREE.BoxGeometry(x2 - x1, 0.1, 0.02), mat)).position.set((x1 + x2) / 2, y + 0.05, z1);
    add(new THREE.Mesh(new THREE.BoxGeometry(x2 - x1, 0.1, 0.02), mat)).position.set((x1 + x2) / 2, y + 0.05, z2);
  };

  //        MATERIALS
  const M = {
    plaster:  new THREE.MeshStandardMaterial({color:0xf2efe7, roughness:.88, side:THREE.BackSide}),
    plasterF: new THREE.MeshStandardMaterial({color:0xf2efe7, roughness:.88}),
    floor:    new THREE.MeshStandardMaterial({color:0xc8b898, roughness:.35, metalness:.06}),
    ceil:     new THREE.MeshStandardMaterial({color:0xe8e5de, roughness:.9, side:THREE.BackSide}),
    timber:   new THREE.MeshStandardMaterial({color:0x8a6a3a, roughness:.65}),
    // Real transmission, not a painted-on tint — the whole point is that the
    // real estate scene shows through. depthWrite:false so this can never
    // wrongly occlude anything genuinely behind it (a bug fixed on the old
    // system's glass, kept here since it's the same underlying pitfall).
    glassW:   new THREE.MeshPhysicalMaterial({
      color: 0xaecbe0, roughness: 0.05, metalness: 0.0,
      transmission: 0.92, thickness: 0.02, ior: 1.5,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }),
    frame:    new THREE.MeshStandardMaterial({color:0x181818, roughness:.45, metalness:.65}),
    skirt:    new THREE.MeshStandardMaterial({color:0xe5e2d8, roughness:.6}),
    concrete: new THREE.MeshStandardMaterial({color:0xd5cfc5, roughness:.8}),
    rail:     new THREE.MeshStandardMaterial({color:0x1a1a1a, roughness:.4, metalness:.8, transparent:true, opacity:.7}),
    railGlass:new THREE.MeshPhysicalMaterial({color:0xaecbe0, roughness:.05, transmission:.85, thickness:.02, ior:1.5, transparent:true, depthWrite:false, side:THREE.DoubleSide}),
  };

  //        FLOOR
  const floorM = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M.floor);
  floorM.rotation.x = -Math.PI / 2; floorM.position.set(0, floorY, 0);
  floorM.receiveShadow = true; add(floorM);
  addSB(M.skirt, -halfW, halfW, floorY, halfD, halfD);

  //        CEILING
  const ceilM = new THREE.Mesh(new THREE.PlaneGeometry(W, D), M.ceil);
  ceilM.rotation.x = Math.PI / 2; ceilM.position.set(0, ceilH, 0);
  add(ceilM);
  for (let bx = -halfW + .5; bx <= halfW - .5; bx += .55) {
    addIM(.08, .08, D - .3, M.timber, [bx, ceilH - .05, 0]);
  }

  //        WALLS — north/east/west solid, south glazed. Matches what the
  //        original system actually built (its own addWall() never used the
  //        windows array on those three sides either); a per-window cutout
  //        on every wall is a bigger geometry task than this pass needs.
  const wall = (x, y, z, w, h, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.plaster);
    m.position.set(x, y, z); m.receiveShadow = true; add(m);
  };
  wall(0, floorY + wallH / 2, -halfD, W, wallH, .22);      // north
  wall(halfW, floorY + wallH / 2, 0, .22, wallH, D);        // east
  wall(-halfW, floorY + wallH / 2, 0, .22, wallH, D);       // west

  // South glazing
  addIM(1.4, wallH, .22, M.plasterF, [-W/2+.7, floorY+wallH/2, halfD]);
  addIM(1.4, wallH, .22, M.plasterF, [ W/2-.7, floorY+wallH/2, halfD]);
  addIM(W-3.0, .45, .28, M.concrete, [0, floorY+.22, halfD]);
  const glassW = W - 3.2;
  addIM(glassW, wallH-.6, .06, M.glassW, [0, floorY+wallH/2+.2, halfD]);
  addIM(glassW, .08, .08, M.frame, [0, floorY+.45, halfD]);
  addIM(glassW, .08, .08, M.frame, [0, floorY+wallH-.05, halfD]);
  for (let mx = -glassW/2+.8; mx <= glassW/2-.8; mx += 1.55)
    addIM(.08, wallH-.6, .08, M.frame, [mx, floorY+wallH/2+.2, halfD]);
  addIM(glassW, .9, .06, M.railGlass, [0, floorY+.5, halfD+.5]);
  addIM(glassW, .06, .06, M.rail, [0, floorY+.96, halfD+.5]);

  //        FLOOR SLAB EDGE (visible from below, on upper floors)
  if (floorY > 0.5) {
    addIM(W+.5, .22, D+.5, M.concrete, [0, floorY-.11, 0]);
  }

  //        FURNITURE
  addFurniture(add, room, M, floorY);

  //        FIXTURE LIGHTING ONLY — no sun, no hemisphere. The real estate
  //        scene already has both; adding a second sun inside the room
  //        would double-light the space and wash out the real one visible
  //        through the glazing. Ceiling downlights and bedside lamps are
  //        real room fixtures, so those stay.
  for (let dx = -W/2+1.5; dx <= W/2-1.5; dx += 1.5) {
    const pt = new THREE.PointLight(0xfff0e0, .55, 6, 2);
    pt.position.set(dx, ceilH-.12, 0); add(pt);
  }
  if (room.key.includes('bedroom') || room.key.includes('master')) {
    for (const bx of [-.9, .9]) {
      const lmp = new THREE.PointLight(0xffcc70, .8, 3.5, 2);
      lmp.position.set(bx, floorY+1.3, -.9); add(lmp);
    }
  }

  return group;
}

function addFurniture(add, room, M, floorY) {
  const k = room.key;
  const y = floorY;
  if (k==='living_dining' || k==='apt_living_f2' || k==='apt_living_f5') {
    const rugM = new THREE.MeshStandardMaterial({color:0xb8a888, roughness:.9});
    const rug = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), rugM);
    rug.rotation.x = -Math.PI/2; rug.position.set(0, y+.01, 1.8); add(rug);

    const potM = new THREE.MeshStandardMaterial({color:0x6a5a4a, roughness:.8});
    const leafM = new THREE.MeshStandardMaterial({color:0x2a6828, roughness:.7});
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(.22,.28,1.1,10), potM);
    stem.position.set(2.8, y+.65, -.5); add(stem);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(.55,10,8), leafM);
    leaf.scale.set(1,1.3,1); leaf.position.set(2.8, y+1.1, -.5); add(leaf);
  }
  if (k==='master_bedroom' || k==='apt_master') {
    const bedM = new THREE.MeshStandardMaterial({color:0xe8e0d0, roughness:.85});
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.0,.5,2.1), bedM);
    bed.position.set(0, y+.25, -.3); add(bed);
    const shadeM = new THREE.MeshStandardMaterial({color:0xf0e8d0, roughness:.7, emissive:0x332200, emissiveIntensity:.3});
    for (const bx of [-.9,.9]) {
      const shade = new THREE.Mesh(new THREE.CylinderGeometry(.18,.22,.35,10), shadeM);
      shade.position.set(bx, y+1.12, -.3); add(shade);
    }
    const rugM = new THREE.MeshStandardMaterial({color:0xa89878, roughness:.9});
    const rug2 = new THREE.Mesh(new THREE.PlaneGeometry(2.4,1.6), rugM);
    rug2.rotation.x = -Math.PI/2; rug2.position.set(0, y+.01, -.3); add(rug2);
  }
  if (k==='loft_living') {
    const potM = new THREE.MeshStandardMaterial({color:0x6a5a4a, roughness:.8});
    const plantM = new THREE.MeshStandardMaterial({color:0x2a6828, roughness:.7});
    for (const px of [-2.2, 2.2]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(.2,.24,.4,10), potM);
      pot.position.set(px, y+.28, 1.0); add(pot);
      const pl = new THREE.Mesh(new THREE.SphereGeometry(.4,10,8), plantM);
      pl.position.set(px, y+.72, 1.0); add(pl);
    }
  }
}
