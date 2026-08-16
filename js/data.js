/**
 * Project XIX     Estate Data Layer  v2
 * Change: WORLD bounds expanded to cover full scene geometry
 * (stables at x=-375, commercial at x=+270, perimeter roads)
 */

export const ESTATE = {
  name: "Project XIX",
  developer: "Mixta Africa",
  architect: "ECAD Architecture",
  location: "Lakowe, Ibeju-Lekki, Lagos State, Nigeria",
  siteArea: "18.8 hectares",
  totalUnits: 223,
};

export const UNIT_SCHEDULE = [
  { type: "Club House",          units: 1,  gfa: 3419,  total: 3419  },
  { type: "3 Bed Villa",         units: 43, gfa: 330,   total: 14190 },
  { type: "2 Bed Loft Apartment",units: 96, gfa: 125,   total: 12000 },
  { type: "1 Bed Maisonette",    units: 24, gfa: 117.2, total: 2813  },
  { type: "2 Bed Flat",          units: 48, gfa: 204,   total: 9792  },
  { type: "Studio",              units: 12, gfa: 33,    total: 396   },
];

export const WORLD = {
  // Camera clamping bounds — must cover full scene geometry
  // Stables at x=-375, commercial at x=+280, polo perimeter ±155
  xMin: -400, xMax: 310,
  zMin: -230, zMax: 245,
  // Minimap world extents
  mapXMin: -400, mapXMax: 310,
  mapZMin: -230, mapZMax: 245,
};

export const VIEWPOINTS = {
  // intro removed — causes gate fly-in we don't want
  field_centre: { label:"Centre Field",     pos:[0,1.72,0],    yaw:0,           pitch:0,     caption:"Halfway line — facing north toward the lake",       icon:"pitch"    },
  field_south:  { label:"South Goal",       pos:[0,1.72,100],  yaw:Math.PI,     pitch:0,     caption:"South goal line — Clubhouse behind you",            icon:"pitch"    },
  clubhouse:    { label:"Clubhouse",        pos:[0,4,148],     yaw:Math.PI,     pitch:-0.05, caption:"Clubhouse terrace — looking north over the field",   icon:"clubhouse", zoneKey:"clubhouse" },
  lake_north:   { label:"The Lake",         pos:[0,1.72,-108], yaw:0,           pitch:0,     caption:"Crescent lake — between safety zone and villas",     icon:"lake",    zoneKey:"lake"     },
  villas:       { label:"Villas",           pos:[-92,4,0],     yaw:Math.PI/2,   pitch:0,     caption:"Premium Villas — walk the ring",                     icon:"villa",   zoneKey:"villas",
    subViews: [
      { key:"villa_west",  label:"West Row",   pos:[-92,1.72,0],    yaw:Math.PI/2,  pitch:0, caption:"West villa row — facing the polo field" },
      { key:"villa_east",  label:"East Row",   pos:[92,1.72,0],     yaw:-Math.PI/2, pitch:0, caption:"East villa row — facing the polo field" },
      { key:"villa_north", label:"North Arc",  pos:[0,1.72,-132],   yaw:Math.PI,    pitch:0, caption:"North arc — lake behind, field ahead" },
      { key:"villa_south", label:"South Arc",  pos:[80,1.72,105],   yaw:0,          pitch:0, caption:"South arc — clubhouse behind, field ahead" },
    ]
  },
  stables:      { label:"Stables",          pos:[-220,1.72,80],yaw:Math.PI/2,   pitch:0,     caption:"Horse stables — equestrian compound, southwest",     icon:"stables", zoneKey:"stables"  },
  training:     { label:"Training Field",   pos:[-175,1.72,0], yaw:Math.PI/2,   pitch:0,     caption:"Training field — polo academy, perpendicular axis",   icon:"pitch",   zoneKey:"training" },
  lofts:        { label:"Loft Terrace",     pos:[-218,1.72,-5],yaw:-Math.PI/2,  pitch:0,     caption:"West compound loft terraces — beside training field", icon:"loft",    zoneKey:"lofts"    },
  paddock:      { label:"Paddock",          pos:[155,1.72,-60],yaw:-Math.PI/2,  pitch:0,     caption:"Northeast paddock — post and rail enclosed",          icon:"pitch",   zoneKey:"paddock"  },
};

export const ZONES = {
  polo: {
    label: "Polo Field",
    type: "Signature Experience",
    tagline: "FIP international standard. 274m × 146m.",
    description: "The central east–west polo field is the gravitational core of the estate. 30, 40, and 60-yard markings from both goal lines define international match standard. The Safety Zone surrounds all four sides.",
    clientLens: "Prestige, spectacle, and a clear centre of value for every surrounding property.",
    hot: { l: 32, t: 20, w: 55, h: 62 },
    viewpoint: "field_centre",
    color: "#3d7a45",
  },
  lake: {
    label: "Proposed Lake",
    type: "Lifestyle Premium",
    tagline: "Crescent water feature along the north edge.",
    description: "An elongated crescent lake runs along the full north edge of the Safety Zone, directly fronted by the Garden Museum Villas. The lake defines the premium northern address and anchors visual value for the Loft Apartments on the Crescent.",
    clientLens: "Outlook, privacy, waterfront value, and photography.",
    hot: { l: 36, t: 10, w: 46, h: 10 },
    viewpoint: "lake_north",
    color: "#1e7a9e",
  },
  villas: {
    label: "Premium Villas",
    type: "Residential Offer",
    tagline: "43 units × 330 sqm. 3 bedrooms. Polo-facing.",
    description: "Premium Villas wrap the polo field on all four sides — north arc, south strip, and both east and west columns — creating an oval colosseum of private residences. Each villa has a two-car undercroft, full-height glazing, and direct polo views.",
    clientLens: "Polo-front living, family retreat, status, long-term capital value.",
    hot: { l: 30, t: 18, w: 59, h: 66 },
    viewpoint: "villas",
    color: "#c9a84c",
  },
  clubhouse: {
    label: "Club House",
    type: "Social Anchor",
    tagline: "3,419 sqm. 3 floors. 8 skyboxes. Restaurant & bar.",
    description: "The Clubhouse sits centred on the south edge of the Safety Zone, looking directly north onto the polo field. Three floors of deep-shadowed slab architecture, full-width terraces, twin pavilion towers, and tiered bleacher seating for tournament days.",
    clientLens: "Belonging, hosting, member experience, and event access.",
    hot: { l: 47, t: 79, w: 12, h: 10 },
    viewpoint: "clubhouse",
    color: "#8c6d4f",
  },
  lofts: {
    label: "Loft Apartments",
    type: "Residential Offer",
    tagline: "96 units × 125 sqm. 2 bedrooms. South precinct.",
    description: "Two rows of 2-Bedroom Loft Terrace blocks occupy the south precinct west of the Clubhouse. Ground floors in natural gabion stone, upper floors in vertical timber slats and glazing — terrace architecture designed for tropical living.",
    clientLens: "Yield potential, lock-up-and-leave convenience, polo estate address.",
    hot: { l: 14, t: 3,  w: 72, h: 7  },
    viewpoint: "lofts",
    color: "#8c7a5e",
  },
  flats: {
    label: "Block of Flats",
    type: "Residential Offer",
    tagline: "48 units × 204 sqm. 2 bedrooms. South zone.",
    description: "Two large apartment blocks south of the Loft Terrace precinct house the 2-Bedroom Flat typology. Seven-storey towers with the signature wave-shaped roofline canopy, dark louvre fins, and piloti ground floor parking.",
    clientLens: "Higher-density investment, estate address, community living.",
    hot: { l: 8,  t: 28, w: 10, h: 42 },
    viewpoint: "lofts",
    color: "#6e8096",
  },
  training: {
    label: "Training Field",
    type: "Sporting Depth",
    tagline: "5,000 sqm. North–south orientation. Polo academy.",
    description: "The Training Field is a separate full-size practice field on the south-west of the estate, oriented north–south perpendicular to the main field. It has its own 30/40/60-yard markings for structured coaching and youth polo programmes.",
    clientLens: "Operational credibility, sporting culture, future polo academy value.",
    hot: { l: 8, t: 73, w: 18, h: 22 },
    viewpoint: "training",
    color: "#4a7a38",
  },
  stables: {
    label: "Stables & Equestrian",
    type: "Authenticity Layer",
    tagline: "4 blocks. 56 stalls. Veterinary. Trucks park.",
    description: "The equestrian operations compound in the south-west corner includes four stable blocks (14 stalls each), a veterinary facility, quarantine paddock, and trucks park. Vivid red-orange laterite brick with exposed timber trusses and cobblestone courtyards.",
    clientLens: "Sporting culture, real equestrian heritage, operational confidence.",
    hot: { l: 2, t: 83, w: 10, h: 14 },
    viewpoint: "stables",
    color: "#c84820",
  },
  paddock: {
    label: "Paddock & Recreation",
    type: "Family Amenity",
    tagline: "Main paddock. Game park. Play ground.",
    description: "The east precinct contains the main paddock (1,645 sqm), a landscaped green area, and a Game Park & Play Ground — creating a family and recreation edge distinct from the equestrian compound on the west.",
    clientLens: "Family dwell time, lifestyle appeal, community programming.",
    hot: { l: 88, t: 15, w: 10, h: 45 },
    viewpoint: "paddock",
    color: "#557a3d",
  },
  commercial: {
    label: "Commercial Block",
    type: "Revenue Layer",
    tagline: "Commercial Block 1 & 2. South-east corner.",
    description: "Commercial Block 1 & 2 anchor the south-east corner near the east parking area and Proposed Lagos Road frontage. Retail, F&B, and service uses serving both residents and the broader Lakowe corridor.",
    clientLens: "Convenience, investor confidence, mixed-use return.",
    hot: { l: 89, t: 73, w: 9, h: 12 },
    viewpoint: "paddock",
    color: "#7a6e5e",
  },
  lagosRoad: {
    label: "Proposed Lagos Road",
    type: "Access & Visibility",
    tagline: "Primary arterial boundary. Main arrival frontage.",
    description: "Proposed Lagos Road spans the entire southern boundary, defining the primary arrival sequence for the Clubhouse, parking, and Commercial Block. This frontage will establish the estate's address on the main Ibeju-Lekki corridor.",
    clientLens: "Findability, frontage value, and future commercial visibility.",
    hot: { l: 10, t: 95, w: 80, h: 5 },
    viewpoint: "field_centre",
    color: "#4a4a4a",
  },
};
