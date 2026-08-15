/**
 * Project XIX -- Product Panel
 * Dedicated product view for each building type.
 * Shows: 3D GLB viewer (rotatable), floor plan image, specs, and reserve CTA.
 * Opens when user clicks a bottom nav button.
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { GLTFLoader }      from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls }   from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js";

//        PRODUCT CATALOGUE                                                                                                                                                                            
export const PRODUCTS = {
  villas: {
    title:    "3-Bedroom Premium Villa",
    type:     "Residential",
    tagline:  "Polo-front living. 330m. Three levels. Private garden.",
    glb:      "assets/villa-mesh.glb",
    glbScale: 1.5,
    glbOffsetY: 0.5,
    specs: [
      { label:"Bedrooms",     value:"3" },
      { label:"Bathrooms",    value:"3 + guest WC" },
      { label:"Total Area",   value:"330 m\u00b2" },
      { label:"Floors",       value:"3 levels + undercroft" },
      { label:"Parking",      value:"2-car undercroft" },
      { label:"Garden",       value:"Private landscaped" },
      { label:"View",         value:"Direct polo field" },
      { label:"Typology",     value:"Detached villa" },
    ],
    floorPlans: [
      { label:"Ground Level",  img:"assets/villa-3-bedroom.png" },
    ],
    description: "The premium villa sits directly on the polo field perimeter, giving each unit an unobstructed match-day view from the terrace. Three floors of contemporary design with a two-car undercroft, full-height glazed living areas, and a private rear garden.",
  },
  clubhouse: {
    title:    "The Clubhouse",
    type:     "Social & Hospitality",
    tagline:  "3,419m\u00b2. Three floors. 8 skyboxes. Restaurant & bar.",
    glb:      null,
    specs: [
      { label:"GFA",          value:"3,419 m\u00b2" },
      { label:"Floors",       value:"3" },
      { label:"Capacity",     value:"1,200+ members" },
      { label:"Skyboxes",     value:"8 VIP suites" },
      { label:"Grandstand",   value:"Tiered seating" },
      { label:"F&B",          value:"Restaurant + bar" },
      { label:"Events",       value:"Tournament hosting" },
      { label:"Terrace",      value:"Field-facing" },
    ],
    floorPlans: [
      { label:"Exterior Render", img:"assets/clubhouse.png" },
    ],
    description: "The social heart of Project XIX. Positioned centre-south on the field axis, the clubhouse provides panoramic views of the full polo field from every floor. Designed for both match-day events and everyday membership use.",
  },
  stables: {
    title:    "Horse Stables",
    type:     "Equestrian Facility",
    tagline:  "4 stable blocks. 56 stalls. Cobblestone courtyard.",
    glb:      null,
    specs: [
      { label:"Stalls",       value:"56 total" },
      { label:"Blocks",       value:"4 stable blocks" },
      { label:"Courtyard",    value:"Cobblestone" },
      { label:"Veterinary",   value:"On-site clinic" },
      { label:"Quarantine",   value:"Dedicated paddock" },
      { label:"Trucks Park",  value:"Equine transport" },
      { label:"Staff",        value:"Groom quarters" },
      { label:"Material",     value:"Laterite brick" },
    ],
    floorPlans: [
      { label:"3D View", img:"assets/horse-stables.png" },
    ],
    description: "The equestrian compound in the southwest corner includes four laterite-brick stable blocks with exposed timber trusses, a veterinary clinic, quarantine paddock, and cobblestone courtyard. This is a working equestrian facility to international polo standards.",
  },
  lofts: {
    title:    "2-Bedroom Loft Terrace",
    type:     "Residential",
    tagline:  "96 units. 125m\u00b2. Lock-up-and-leave. Crescent address.",
    glb:      "assets/loft-mesh.glb",
    glbScale: 1.2,
    glbOffsetY: 0.1,
    specs: [
      { label:"Bedrooms",     value:"2" },
      { label:"Bathrooms",    value:"2" },
      { label:"Total Area",   value:"125 m\u00b2" },
      { label:"Floors",       value:"2 + garage" },
      { label:"Parking",      value:"2-car garage" },
      { label:"Garden",       value:"Rear terrace" },
      { label:"Units",        value:"96 total" },
      { label:"Address",      value:"Crescent road" },
    ],
    floorPlans: [
      { label:"3D View",      img:"assets/loft-terrace.png" },
    ],
    description: "The loft terrace units occupy the crescent road north of the polo ring. Each unit has a private garage, ground-floor living areas, and an upper-floor master bedroom with void over living. Ideal for polo club members and investors seeking estate yield.",
  },
  flats: {
    title:    "Apartment Block",
    type:     "Residential",
    tagline:  "48 units. 204m\u00b2. 7 floors. Wave parapet crown.",
    glb:      "assets/apartment-mesh.glb",
    glbScale: 1.2,
    glbOffsetY: 0.4,
    specs: [
      { label:"Bedrooms",     value:"2" },
      { label:"Bathrooms",    value:"2" },
      { label:"Total Area",   value:"204 m\u00b2" },
      { label:"Floors",       value:"7 residential + podium" },
      { label:"Parking",      value:"Podium deck" },
      { label:"Units",        value:"48 total" },
      { label:"Lifts",        value:"2 per core" },
      { label:"Outlook",      value:"West compound" },
    ],
    floorPlans: [
      { label:"3D View",      img:"assets/apartment-block.png" },
    ],
    description: "The apartment blocks occupy the west compound, offering a different typology from the polo-facing villas. Seven floors of two-bedroom apartments above a ground-floor parking podium, crowned by the signature wave parapet that is visible across the estate.",
  },
  training: {
    title:    "Training Field",
    type:     "Sporting Facility",
    tagline:  "FIP standard. 100m x 160m. Polo academy.",
    glb:      null,
    specs: [
      { label:"Dimensions",   value:"100m x 160m" },
      { label:"Standard",     value:"FIP international" },
      { label:"Markings",     value:"30/40/60 yard lines" },
      { label:"Orientation",  value:"North-South" },
      { label:"Goalposts",    value:"Both ends" },
      { label:"Access",       value:"West compound road" },
      { label:"Use",          value:"Academy + private hire" },
      { label:"Surface",      value:"Natural turf" },
    ],
    floorPlans: null,
    description: "The training field runs perpendicular to the main polo field in the southwest compound. Used for polo coaching, youth development, and private practice sessions. FIP standard dimensions and markings.",
  },
  paddock: {
    title:    "Paddock & Recreation",
    type:     "Equestrian & Leisure",
    tagline:  "Post-and-rail paddock. Game park. Family amenity.",
    glb:      null,
    specs: [
      { label:"Paddock",      value:"40m x 38m" },
      { label:"Fencing",      value:"Post and rail" },
      { label:"Game Park",    value:"Adjacent green" },
      { label:"Play Ground",  value:"Family equipment" },
      { label:"Green Area",   value:"Dense planting" },
      { label:"Location",     value:"Northeast" },
      { label:"Access",       value:"East boundary road" },
      { label:"Use",          value:"Horse warming + leisure" },
    ],
    floorPlans: null,
    description: "The northeast corner combines an enclosed equestrian paddock with a family recreation zone. Post-and-rail fencing defines the paddock. The adjacent game park provides play equipment and green space for residents.",
  },
};

//        PANEL STATE                                                                                                                                                                                              
let panelRenderer = null, panelScene = null, panelCamera = null, panelControls = null;
let panelAnimId  = null;
let currentProduct = null;

//        OPEN PANEL                                                                                                                                                                                                 
export function openProductPanel(productKey) {
  const product = PRODUCTS[productKey];
  if (!product) return;
  currentProduct = productKey;

  const panel = document.getElementById("product-panel");
  if (!panel) return;

  // Populate header
  panel.querySelector(".pp-type").textContent    = product.type;
  panel.querySelector(".pp-title").textContent   = product.title;
  panel.querySelector(".pp-tagline").textContent = product.tagline;
  panel.querySelector(".pp-desc").textContent    = product.description;

  // Add "Experience from Inside" button if building has interior walkthrough
  const interiorMap = {villas:"villa", lofts:"loft", flats:"apartment"};
  const intType = interiorMap[productKey];
  const existingIntBtn = panel.querySelector(".pp-interior-btn");
  if (existingIntBtn) existingIntBtn.remove();
  if (intType) {
    const intBtn = document.createElement("button");
    intBtn.className = "pp-interior-btn";
    intBtn.innerHTML = "&#127968; Experience from Inside";
    intBtn.onclick = () => {
      closeProductPanel();
      if (window.openInteriorView) window.openInteriorView(intType, null);
    };
    // Insert before the specs section
    const specsEl = panel.querySelector(".pp-specs-section");
    if (specsEl) panel.querySelector(".pp-body .pp-details").insertBefore(intBtn, specsEl);
  }

  // Populate specs grid
  const grid = panel.querySelector(".pp-specs");
  grid.innerHTML = product.specs.map(s =>
    `<div class="pp-spec"><span class="pp-spec-label">${s.label}</span><span class="pp-spec-val">${s.value}</span></div>`
  ).join("");

  // Floor plan tabs
  const tabsEl = panel.querySelector(".pp-plan-tabs");
  const planImg = panel.querySelector(".pp-plan-img");
  if (product.floorPlans && product.floorPlans.length > 0) {
    tabsEl.innerHTML = product.floorPlans.map((fp, i) =>
      `<button class="pp-tab${i===0?" active":""}" data-idx="${i}">${fp.label}</button>`
    ).join("");
    planImg.src = product.floorPlans[0].img;
    planImg.style.display = "block";
    tabsEl.querySelectorAll(".pp-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        tabsEl.querySelectorAll(".pp-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        planImg.src = product.floorPlans[parseInt(btn.dataset.idx)].img;
      });
    });
  } else {
    tabsEl.innerHTML = "";
    planImg.style.display = "none";
  }

  panel.classList.add("open");
  document.body.classList.add("panel-open");

  // Init or update 3D viewer
  initGLBViewer(product);
}

export function closeProductPanel() {
  const panel = document.getElementById("product-panel");
  if (panel) panel.classList.remove("open");
  document.body.classList.remove("panel-open");
  if (panelAnimId) { cancelAnimationFrame(panelAnimId); panelAnimId = null; }
}

//        3D GLB VIEWER                                                                                                                                                                                        
function initGLBViewer(product) {
  const canvas = document.getElementById("pp-glb-canvas");
  if (!canvas) return;

  // Clear previous
  if (panelAnimId) cancelAnimationFrame(panelAnimId);
  if (panelRenderer) { panelRenderer.dispose(); panelRenderer = null; }
  canvas.style.display = "block";
  const fallback = document.getElementById("pp-glb-fallback");

  // Check canvas dimensions (may be 0 if panel just opened)
  const W = canvas.clientWidth  || 480;
  const H = canvas.clientHeight || 320;

  // Create renderer
  panelRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  panelRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  panelRenderer.setSize(W, H);
  panelRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  panelRenderer.toneMappingExposure = 1.0;
  panelRenderer.outputColorSpace = THREE.SRGBColorSpace;
  panelRenderer.setClearColor(0x0d1a10, 1);

  // Scene
  panelScene = new THREE.Scene();
  panelScene.background = new THREE.Color(0x0d1a10);

  // Lighting (warm studio 3-point)
  panelScene.add(new THREE.AmbientLight(0xfff0e0, 0.8));
  const key = new THREE.DirectionalLight(0xffe8a0, 2.5);
  key.position.set(3, 5, 4); key.castShadow = false;
  panelScene.add(key);
  const fill = new THREE.DirectionalLight(0xa0c8ff, 0.8);
  fill.position.set(-3, 3, -2);
  panelScene.add(fill);
  const back = new THREE.DirectionalLight(0xffeedd, 0.5);
  back.position.set(0, -2, -5);
  panelScene.add(back);
  // Ground plane
  const gp = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshStandardMaterial({ color: 0x1a3020, roughness: 0.95 })
  );
  gp.rotation.x = -Math.PI/2; gp.position.y = -0.01;
  panelScene.add(gp);

  // Camera
  panelCamera = new THREE.PerspectiveCamera(42, W/H, 0.01, 200);
  panelCamera.position.set(2, 1.5, 3);

  // OrbitControls (rotate around building)
  panelControls = new OrbitControls(panelCamera, canvas);
  panelControls.enableDamping  = true;
  panelControls.dampingFactor  = 0.08;
  panelControls.minDistance    = 0.5;
  panelControls.maxDistance    = 8;
  panelControls.maxPolarAngle  = Math.PI / 1.8;
  panelControls.autoRotate     = true;
  panelControls.autoRotateSpeed = 0.6;
  panelControls.target.set(0, 0.6, 0);
  panelControls.update();

  if (product.glb) {
    if (fallback) fallback.style.display = "none";
    new GLTFLoader().load(
      product.glb,
      gltf => {
        // Centre and scale the model
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const targetSize = 2.0 * (product.glbScale || 1.5);
        const scale = targetSize / maxDim;
        gltf.scene.scale.setScalar(scale);
        // Sit on ground
        box.setFromObject(gltf.scene);
        gltf.scene.position.y = -box.min.y + (product.glbOffsetY || 0);
        // Centre X/Z
        const centre = box.getCenter(new THREE.Vector3());
        gltf.scene.position.x = -centre.x * scale;
        gltf.scene.position.z = -centre.z * scale;
        // Enable shadows
        gltf.scene.traverse(c => {
          if (c.isMesh) {
            c.castShadow = c.receiveShadow = true;
            if (c.material) {
              c.material.envMapIntensity = 0.3;
              c.material.needsUpdate    = true;
            }
          }
        });
        panelScene.add(gltf.scene);
        panelControls.target.set(0, size.y * scale * 0.4, 0);
        panelControls.update();
      },
      null,
      err => {
        console.warn("Product GLB failed:", err);
        if (fallback) fallback.style.display = "flex";
      }
    );
  } else {
    // No GLB - show render image
    canvas.style.display = "none";
    if (fallback) fallback.style.display = "flex";
  }

  // Render loop
  function loop() {
    panelAnimId = requestAnimationFrame(loop);
    panelControls.update();
    panelRenderer.render(panelScene, panelCamera);
  }
  loop();
}

// Resize viewer when panel resizes
export function resizePanelViewer() {
  const canvas = document.getElementById("pp-glb-canvas");
  if (!canvas || !panelRenderer || !panelCamera) return;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  if (!W || !H) return;
  panelRenderer.setSize(W, H);
  panelCamera.aspect = W / H;
  panelCamera.updateProjectionMatrix();
}
