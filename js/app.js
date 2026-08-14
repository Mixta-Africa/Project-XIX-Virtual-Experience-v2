import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
/**
 * Project XIX — Main Application Entry Point
 * Orchestrates: landing, masterplan, 3D walkthrough, VR.
 */

import { VIEWPOINTS, ZONES, WORLD } from "./data.js";
import { buildVillaInterior, VILLA_VIEWPOINTS } from "./villa-interior.js";
import { initScene, getRenderer, getScene, getCamera, getClock, tickScene } from "./scene.js";
import {
  initControls, activate, deactivate, setView, updateControls, getYaw,
  requestGyro, enterVR
} from "./controls.js";
import {
  initMinimap, updateMinimap,
  buildViewpointStrip, showZonePanel, hideZonePanel,
  showLoading, hideLoading, setLoadingProgress,
  setCaption, showEnterPrompt, hideEnterPrompt,
  showVRButton, showJoystick, hideJoystick, isMobile,
  enableAudio, updateSpatialAudio, initAudio
} from "./ui.js";

// ─── STATE ────────────────────────────────────────────────────────────────────

let sceneReady = false;
let villaInteriorActive = false;
let villaScene = null;
let villaRenderer = null;
let introPlaying = false;
let currentViewKey = "field_centre";
let animFrameId = null;

// ─── BOOT ─────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  bootLandingCanvas();
  bindMasterplan();
  bindNav();
  bindExitButton();
  bindSectionScrollAnim();
  bindVillaInteriorBtn();
  initAudio();
});

// ─── HERO CANVAS ANIMATION ────────────────────────────────────────────────────

function bootLandingCanvas() {
  const canvas = document.getElementById("hero-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let tick = 0;
  let w = 0, h = 0;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    w = canvas.offsetWidth; h = canvas.offsetHeight;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    tick += 0.004;
    // Deep green-to-black sky
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0,    "#0d2218");
    sky.addColorStop(0.55, "#0a1810");
    sky.addColorStop(1,    "#070d08");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // Stars (static seed)
    ctx.fillStyle = "rgba(255,248,220,0.7)";
    for (let i = 0; i < 60; i++) {
      const sx = ((i * 137.5) % w);
      const sy = ((i * 91.3) % (h * 0.45));
      const size = (Math.sin(tick * 2 + i) * 0.5 + 0.5) * 1.2 + 0.4;
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Crescent lake reflection glow
    const lakeGlow = ctx.createRadialGradient(w * 0.5, h * 0.22, 20, w * 0.5, h * 0.22, w * 0.38);
    lakeGlow.addColorStop(0,   `rgba(30,130,170,${0.18 + Math.sin(tick * 3) * 0.04})`);
    lakeGlow.addColorStop(1,   "rgba(0,0,0,0)");
    ctx.fillStyle = lakeGlow;
    ctx.fillRect(0, 0, w, h);

    // Ground horizon
    const ground = ctx.createLinearGradient(0, h * 0.52, 0, h);
    ground.addColorStop(0, "rgba(22, 65, 40, 0.9)");
    ground.addColorStop(1, "rgba(10, 30, 18, 1)");
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.52);
    ctx.bezierCurveTo(w * 0.25, h * 0.48, w * 0.75, h * 0.56, w, h * 0.50);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    // Polo field — mowed stripe perspective
    ctx.save();
    const fW = w * 0.56, fH = h * 0.26;
    const fX = (w - fW) / 2, fY = h * 0.55;
    for (let i = 0; i < 10; i++) {
      const alpha = 0.12 + (i / 10) * 0.15;
      ctx.fillStyle = i % 2 === 0
        ? `rgba(70,155,65,${alpha})`
        : `rgba(55,130,50,${alpha})`;
      ctx.fillRect(fX, fY + (i / 10) * fH, fW, fH / 10 + 1);
    }
    // Field border lines
    ctx.strokeStyle = "rgba(248,245,220,0.35)";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(fX, fY, fW, fH);
    // Yard lines
    for (const xFrac of [0.22, 0.33, 0.5, 0.67, 0.78]) {
      ctx.beginPath();
      ctx.moveTo(fX + fW * xFrac, fY);
      ctx.lineTo(fX + fW * xFrac, fY + fH);
      ctx.stroke();
    }
    ctx.restore();

    // Approach lights (vanishing perspective)
    for (let i = 0; i < 28; i++) {
      const depth = i / 28;
      const spread = w * (0.04 + depth * 0.55);
      const lightY = h * (0.54 + depth * 0.44);
      const glow = 0.25 - depth * 0.14 + Math.sin(tick * 18 + i * 0.7) * 0.04;
      ctx.fillStyle = `rgba(201, 168, 76, ${Math.max(0.04, glow)})`;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(w * 0.5 + side * spread, lightY, 2.5 + depth * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Distant palm silhouettes
    for (let i = 0; i < 14; i++) {
      const px = (i / 13) * w;
      const pBase = h * 0.51 + Math.sin(i * 1.7) * h * 0.03;
      const pScale = 0.7 + Math.sin(i * 0.9) * 0.3;
      drawPalmSilhouette(ctx, px, pBase, pScale, tick + i);
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  resize();
  draw();
}

function drawPalmSilhouette(ctx, x, base, scale, phase) {
  const h_trunk = 55 * scale;
  ctx.strokeStyle = `rgba(8, 22, 14, 0.9)`;
  ctx.lineWidth = 2.5 * scale;
  ctx.beginPath();
  ctx.moveTo(x, base);
  const lean = Math.sin(phase * 0.5) * 4;
  ctx.bezierCurveTo(x + lean, base - h_trunk * 0.4, x + lean * 1.5, base - h_trunk * 0.7, x + lean * 2, base - h_trunk);
  ctx.stroke();

  // Fronds
  ctx.lineWidth = 1.2 * scale;
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2 + phase * 0.2;
    ctx.beginPath();
    ctx.moveTo(x + lean * 2, base - h_trunk);
    ctx.quadraticCurveTo(
      x + lean * 2 + Math.cos(angle) * 22 * scale,
      base - h_trunk + Math.sin(angle) * 8 * scale - 10 * scale,
      x + lean * 2 + Math.cos(angle) * 30 * scale,
      base - h_trunk + Math.sin(angle) * 18 * scale
    );
    ctx.stroke();
  }
}

// ─── MASTERPLAN ───────────────────────────────────────────────────────────────

function bindMasterplan() {
  const planImg  = document.getElementById("plan-image");
  const zoneLayer = document.getElementById("zone-layer");
  if (!planImg || !zoneLayer) return;

  // Build SVG zone hotspots
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;";

  Object.entries(ZONES).forEach(([key, zone]) => {
    const { l, t, w, h } = zone.hot;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", l);
    rect.setAttribute("y", t);
    rect.setAttribute("width", w);
    rect.setAttribute("height", h);
    rect.setAttribute("rx", "0.8");
    rect.setAttribute("fill", zone.color + "28");
    rect.setAttribute("stroke", zone.color);
    rect.setAttribute("stroke-width", "0.4");
    rect.style.cursor = "pointer";
    rect.style.transition = "fill 0.2s";

    // Label
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", l + w / 2);
    text.setAttribute("y", t + h / 2 + 1);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("font-size", "2.2");
    text.setAttribute("fill", "#f8f4e8");
    text.setAttribute("font-family", "Inter, sans-serif");
    text.setAttribute("font-weight", "500");
    text.setAttribute("paint-order", "stroke");
    text.setAttribute("stroke", "#0a1008");
    text.setAttribute("stroke-width", "0.8");
    text.setAttribute("pointer-events", "none");
    text.textContent = zone.label;

    rect.addEventListener("mouseenter", () => {
      rect.setAttribute("fill", zone.color + "55");
      showZonePanel(key);
    });
    rect.addEventListener("mouseleave", () => {
      rect.setAttribute("fill", zone.color + "28");
    });
    rect.addEventListener("click", () => {
      showZonePanel(key);
      if (zone.viewpoint) {
        openWorldAt(zone.viewpoint);
      }
    });

    svg.appendChild(rect);
    svg.appendChild(text);
  });

  zoneLayer.appendChild(svg);
}

// ─── NAV ──────────────────────────────────────────────────────────────────────

function bindNav() {
  document.querySelectorAll("[data-section]").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const target = document.getElementById(link.dataset.section);
      if (target) target.scrollIntoView({ behavior: "smooth" });
    });
  });

  // Explore button → masterplan section
  document.querySelectorAll(".btn-explore").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("masterplan").scrollIntoView({ behavior: "smooth" });
    });
  });

  // Enter 3D button
  document.querySelectorAll(".btn-enter-3d").forEach(btn => {
    btn.addEventListener("click", () => openWorldAt("field_centre"));
  });
}

// ─── WORLD ENTRY ──────────────────────────────────────────────────────────────

async function openWorldAt(viewKey) {
  currentViewKey = viewKey;
  const vp = VIEWPOINTS[viewKey] || VIEWPOINTS.field_centre;

  showLoading();
  setLoadingProgress(10);

  // Lazy-initialise Three.js scene
  if (!sceneReady) {
    const canvas3d = document.getElementById("world-canvas");
    initScene(canvas3d);
    setLoadingProgress(40);
    initControls(getCamera(), getRenderer());
    setLoadingProgress(70);
    initMinimap("assets/plan-2d.png");
    setLoadingProgress(90);

    showVRButton(() => {
      enterVR(getRenderer(), getScene(), getCamera(), getClock(), tick => {
        updateControls(tick);
        updateMinimap(getCamera().position.x, getCamera().position.z, getYaw());
        updateSpatialAudio(getCamera().position.x, getCamera().position.z);
      });
    });

    buildViewpointStrip(
      document.getElementById("viewpoint-strip"),
      (key, vp) => teleportTo(key, vp)
    );

    sceneReady = true;
    setLoadingProgress(100);
  }

  await new Promise(r => setTimeout(r, 300));
  hideLoading();

  // Show world overlay
  const overlay = document.getElementById("world-overlay");
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";

  // Resize renderer
  resizeWorld();
  window.addEventListener("resize", resizeWorld);

  // Cinematic intro on first open
  if (viewKey === "field_centre" && !introPlaying) {
    await cinematicIntro();
  } else {
    const pos = vp.pos;
    setView(pos, vp.yaw, vp.pitch || 0);
    setCaption(vp.caption);
  }

  activate();

  if (isMobile()) {
    showJoystick();
    showEnterPrompt("Drag right to look · Left joystick to walk");
  } else {
    showEnterPrompt("Click to lock cursor · WASD / arrows to walk · Shift to sprint");
  }

  // Enable audio on user gesture
  enableAudio();

  // Start render loop
  startRenderLoop();
}

async function cinematicIntro() {
  introPlaying = true;
  const introVp = VIEWPOINTS.intro;
  setView(introVp.pos, introVp.yaw, introVp.pitch);
  setCaption(introVp.caption);

  const targetVp = VIEWPOINTS.field_centre;
  const startPos = [...introVp.pos];
  const endPos   = targetVp.pos;
  const duration = 3800; // ms
  const start    = performance.now();

  await new Promise(resolve => {
    function ease(t) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t; }
    function step(now) {
      const t = Math.min((now - start) / duration, 1);
      const e = ease(t);
      const cam = getCamera();
      cam.position.x = startPos[0] + (endPos[0] - startPos[0]) * e;
      cam.position.y = startPos[1] + (endPos[1] - startPos[1]) * e;
      cam.position.z = startPos[2] + (endPos[2] - startPos[2]) * e;
      // Pitch: tilt from down-looking to horizontal
      const startP = introVp.pitch;
      const camPitch = startP + (0 - startP) * e;
      getCamera().rotation.order = "YXZ";
      getCamera().rotation.x = camPitch;
      getCamera().rotation.y = introVp.yaw + (targetVp.yaw - introVp.yaw) * e;
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });

  setView(endPos, targetVp.yaw, 0);
  setCaption(targetVp.caption);
}

function teleportTo(key, vp) {
  setView(vp.pos, vp.yaw, vp.pitch || 0);
  setCaption(vp.caption);
  if (vp.zoneKey) showZonePanel(vp.zoneKey);
  else hideZonePanel();
}

// ─── EXIT WORLD ───────────────────────────────────────────────────────────────

function bindExitButton() {
  document.getElementById("btn-close-world")?.addEventListener("click", closeWorld);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && document.getElementById("world-overlay")?.classList.contains("open")) {
      if (document.pointerLockElement) {
        document.exitPointerLock();
      } else {
        closeWorld();
      }
    }
  });
}

function closeWorld() {
  deactivate();
  hideJoystick();
  document.getElementById("world-overlay")?.classList.remove("open");
  document.body.style.overflow = "";
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  window.removeEventListener("resize", resizeWorld);
}

// ─── RENDER LOOP ──────────────────────────────────────────────────────────────

function startRenderLoop() {
  if (animFrameId) cancelAnimationFrame(animFrameId);
  const renderer = getRenderer();
  const scene    = getScene();
  const camera   = getCamera();
  const clock    = getClock();

  const startTime = performance.now();
  function frame() {
    animFrameId = requestAnimationFrame(frame);
    const delta   = Math.min(clock.getDelta(), 0.05);
    const elapsed = (performance.now() - startTime) / 1000;
    updateControls(delta);
    tickScene(elapsed, camera);
    updateMinimap(camera.position.x, camera.position.z, getYaw());
    updateSpatialAudio(camera.position.x, camera.position.z);
    renderer.render(scene, camera);
  }

  frame();
}

function resizeWorld() {
  const renderer = getRenderer();
  const camera   = getCamera();
  if (!renderer || !camera) return;
  const canvas = document.getElementById("world-canvas");
  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ─── SCROLL ANIMATIONS ────────────────────────────────────────────────────────

function bindSectionScrollAnim() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) e.target.classList.add("in-view");
    });
  }, { threshold: 0.12 });
  document.querySelectorAll(".anim-fade").forEach(el => io.observe(el));
}

// ─── VILLA INTERIOR ───────────────────────────────────────────────────────────

function bindVillaInteriorBtn() {
  // Open from any "Walk through" button on villa cards
  document.addEventListener("click", e => {
    // Villa enter buttons
    const enterBtn = e.target.closest(".residence-card-btn");
    const card = enterBtn?.closest(".residence-card");
    if (enterBtn && card?.querySelector(".residence-card-type")?.textContent?.includes("3 Bed")) {
      openVillaInterior(); return;
    }

    // Plan tab switching
    const tab = e.target.closest(".plan-tab");
    if (tab) {
      document.querySelectorAll(".plan-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const plan = tab.dataset.plan;
      document.querySelectorAll(".plan-rooms").forEach(r => r.classList.add("hidden"));
      document.getElementById("plan-" + plan)?.classList.remove("hidden");
      return;
    }

    // Room click -> teleport
    const room = e.target.closest(".plan-room");
    if (room?.dataset.key) {
      teleportVillaTo(room.dataset.key);
      document.querySelectorAll(".plan-room").forEach(r => r.classList.remove("active"));
      room.classList.add("active");
      return;
    }
  });

  document.getElementById("btn-close-villa")?.addEventListener("click", closeVillaInterior);
}

function openVillaInterior() {
  const overlay = document.getElementById("villa-overlay");
  if (!overlay) return;
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";

  if (!villaScene) {
    // Build interior scene on demand
    const canvas = document.getElementById("villa-canvas");
    if (!canvas) return;

    villaRenderer = new (THREE.WebGLRenderer)({ canvas, antialias: true, powerPreference: "high-performance" });
    villaRenderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
    villaRenderer.shadowMap.enabled  = true;
    villaRenderer.shadowMap.type     = THREE.PCFSoftShadowMap;
    villaRenderer.toneMapping        = THREE.ACESFilmicToneMapping;
    villaRenderer.toneMappingExposure = 1.1;
    villaRenderer.outputColorSpace   = THREE.SRGBColorSpace;

    villaScene = new THREE.Scene();
    villaScene.background = new THREE.Color(0x7ab4d4);
    villaScene.fog = new THREE.FogExp2(0x9ac5d4, 0.025);

    buildVillaInterior(villaScene);
  }

  // Start at approach viewpoint
  teleportVillaTo("approach");
  activate();
  resizeVilla();
  window.addEventListener("resize", resizeVilla);
  startVillaLoop();

  // Populate viewpoint strip
  buildVillaStrip();
}

function closeVillaInterior() {
  document.getElementById("villa-overlay")?.classList.remove("open");
  document.body.style.overflow = "";
  deactivate();
  window.removeEventListener("resize", resizeVilla);
  if (villaAnimId) { cancelAnimationFrame(villaAnimId); villaAnimId = null; }
}

let villaAnimId = null;

function startVillaLoop() {
  if (villaAnimId) cancelAnimationFrame(villaAnimId);
  const cam = getCamera();
  function frame() {
    villaAnimId = requestAnimationFrame(frame);
    const delta = Math.min(getClock().getDelta(), 0.05);
    updateControls(delta);
    if (villaRenderer && villaScene) villaRenderer.render(villaScene, cam);
  }
  frame();
}

function resizeVilla() {
  const canvas = document.getElementById("villa-canvas");
  if (!canvas || !villaRenderer) return;
  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;
  villaRenderer.setSize(w, h);
  const cam = getCamera();
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
}

function teleportVillaTo(key) {
  const vp = VILLA_VIEWPOINTS.find(v => v.key === key);
  if (!vp) return;
  setView(vp.pos, vp.yaw, 0);
  setCaption(vp.caption || vp.label);

  // Update floor plan highlight
  document.querySelectorAll(".vp-floor-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.key === key);
  });
}

function buildVillaStrip() {
  const strip = document.getElementById("villa-vp-strip");
  if (!strip) return;
  strip.innerHTML = "";
  VILLA_VIEWPOINTS.forEach(vp => {
    const btn = document.createElement("button");
    btn.className = "vp-btn vp-floor-btn";
    btn.dataset.key = vp.key;
    btn.innerHTML = `<span class="vp-label">\${vp.label}</span>`;
    btn.addEventListener("click", () => teleportVillaTo(vp.key));
    strip.appendChild(btn);
  });
}
