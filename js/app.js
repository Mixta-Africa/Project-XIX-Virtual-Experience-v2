import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
/**
 * Project XIX     Main Application Entry Point
 * Optimized: Unified rendering (villa interior physically added to main world)
 * Optimized: EffectComposer totally bypassed in 'fast' mode
 */

import { VIEWPOINTS, ZONES, WORLD } from "./data.js";
import { buildVillaInterior, VILLA_VIEWPOINTS } from "./villa-interior.js";
import {
  initScene, getRenderer, getScene, getCamera, getClock, tickScene, updateSky,
  plotRegistry, reservePlot, getPlotAtRay,
  setPerfMode, PERF_MODE, RIDER_EYE_HEIGHT, FOOT_EYE_HEIGHT,
  tickHorseAnim, setHorsePosition,
} from "./scene.js?v=23";
import { initPostProcessing, resizeComposer, renderFrame, setBloomForTime } from "./graphics.js";
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

//           STATE
let sceneReady      = false;
let introPlaying    = false;
let currentViewKey  = "field_centre";
let animFrameId     = null;
let composer        = null;
let aerialOrbit     = false;
let aerialAngle     = 0;
let aerialYawOffset = 0;
let aerialPitch     = -Math.PI / 2.5;
let aerialDragging  = false;
let aerialLastX     = 0, aerialLastY = 0;
const AERIAL_RADIUS = 220;
const AERIAL_HEIGHT = 200;
const AERIAL_SPEED  = 0.12;

let horseMode = true; // ON by default
let _prevCamX = 0, _prevCamZ = 0;

//           WEATHER / TIME PRESETS
const TIME_PRESETS = {
  morning:   { sky:["#1e3a5a","#7aaac8","#4a7a38"], sunCol:0xffd080, sunInt:1.8, sunPos:[-80,55,-80],   fog:"#8ab8cc", fogD:0.0008, exp:0.92, hemiInt:0.9 },
  afternoon: { sky:["#1a3a6a","#5a9acc","#3a6a30"], sunCol:0xffe8b0, sunInt:2.2, sunPos:[-160,160,100], fog:"#8ab8cc", fogD:0.0009, exp:1.02, hemiInt:1.2 },
  sunset:    { sky:["#0a1830","#c84818","#4a2a10"], sunCol:0xff8030, sunInt:1.6, sunPos:[-100,28,60],   fog:"#c06040", fogD:0.0012, exp:1.05, hemiInt:0.8 },
  night:     { sky:["#000508","#020a14","#050a08"], sunCol:0x304870, sunInt:0.12,sunPos:[0,40,-80],     fog:"#020810", fogD:0.0015, exp:0.55, hemiInt:0.15 },
};

function applyTimePreset(name) {
  const p = TIME_PRESETS[name]; if (!p) return;
  document.querySelectorAll(".wx-time-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.time === name));
  try { updateSky(...p.sky); } catch(e){}
  try { setBloomForTime(name); } catch(e){}
  const sc = getScene();
  if (sc && sc.fog) { sc.fog.color.set(p.fog); sc.fog.density = p.fogD; }
  if (sc) {
    sc.traverse(o => {
      if (o.isDirectionalLight && o.castShadow) {
        o.color.setHex(p.sunCol); o.intensity = p.sunInt; o.position.set(...p.sunPos);
      }
      if (o.isHemisphereLight) o.intensity = p.hemiInt || 1.2;
    });
  }
  const r = getRenderer();
  if (r) r.toneMappingExposure = p.exp;
}

function applyWeather(w) {
  document.querySelectorAll(".wx-weather-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.weather === w));
  const sc = getScene();
  if (!sc || !sc.fog) return;
  const baseD = TIME_PRESETS.afternoon.fogD;
  if (w === "rain")        sc.fog.density = baseD * 3.5;
  else if (w === "cloudy") sc.fog.density = baseD * 1.8;
  else                     sc.fog.density = baseD;
}

window.applyTimePreset = applyTimePreset;
window.applyWeather = applyWeather;

//           PERFORMANCE MODE TOGGLE
window.switchPerfMode = function(mode) {
  window.PERF_MODE = mode; // Store globally so render loop knows to bypass
  setPerfMode(mode);
  document.querySelectorAll('.perf-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
};

//           PANEL CLOSE FIX
function bindAllPanelCloses() {
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-close-panel], .panel-close, .plot-close, #plot-panel-close, .zone-panel-close, .zone-close, [aria-label="Close"], .btn-close');
    if (!btn) return;
    e.stopPropagation();
    const panel = btn.closest('.panel, .zone-panel, #plot-panel, .product-panel, .info-panel, [class*="-panel"]');
    if (panel) {
      panel.classList.remove('visible', 'open', 'active');
      panel.style.display = '';
    }
  }, true); 

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('plot-panel-close')?.addEventListener('click', e => {
      e.stopImmediatePropagation();
      document.getElementById('plot-panel')?.classList.remove('visible');
    }, { capture: true });
  });
}

//           BOOT
document.addEventListener("DOMContentLoaded", () => {
  bootLandingCanvas();
  bindMasterplan();
  bindNav();
  bindExitButton();
  bindSectionScrollAnim();
  bindPlotSystem();
  bindVillaInteriorBtn();
  initAudio();
  bindAllPanelCloses();
  window.__moduleReady = Object.assign(window.__moduleReady || {}, {
    applyTimePreset, applyWeather, toggleAerial, switchPerfMode: window.switchPerfMode,
  });
  (window._pendingCalls || []).forEach(({fn,args}) => {
    if(window.__moduleReady[fn]) window.__moduleReady[fn](...args);
  });
  window._pendingCalls = [];
});

//           HERO CANVAS ANIMATION
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
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0,    "#0d2218");
    sky.addColorStop(0.55, "#0a1810");
    sky.addColorStop(1,    "#070d08");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "rgba(255,248,220,0.7)";
    for (let i = 0; i < 60; i++) {
      const sx = ((i * 137.5) % w);
      const sy = ((i * 91.3) % (h * 0.45));
      const size = (Math.sin(tick * 2 + i) * 0.5 + 0.5) * 1.2 + 0.4;
      ctx.beginPath();
      ctx.arc(sx, sy, size, 0, Math.PI * 2);
      ctx.fill();
    }

    const lakeGlow = ctx.createRadialGradient(w * 0.5, h * 0.22, 20, w * 0.5, h * 0.22, w * 0.38);
    lakeGlow.addColorStop(0,   `rgba(30,130,170,${0.18 + Math.sin(tick * 3) * 0.04})`);
    lakeGlow.addColorStop(1,   "rgba(0,0,0,0)");
    ctx.fillStyle = lakeGlow;
    ctx.fillRect(0, 0, w, h);

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

    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  resize();
  draw();
}

//           MASTERPLAN
function bindMasterplan() {
  const planImg  = document.getElementById("plan-image");
  const zoneLayer = document.getElementById("zone-layer");
  if (!planImg || !zoneLayer) return;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;";

  Object.entries(ZONES).forEach(([key, zone]) => {
    const { l, t, w, h } = zone.hot;
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", l); rect.setAttribute("y", t);
    rect.setAttribute("width", w); rect.setAttribute("height", h);
    rect.setAttribute("rx", "0.8");
    rect.setAttribute("fill", zone.color + "28");
    rect.setAttribute("stroke", zone.color);
    rect.setAttribute("stroke-width", "0.4");
    rect.style.cursor = "pointer"; rect.style.transition = "fill 0.2s";
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", l + w / 2); text.setAttribute("y", t + h / 2 + 1);
    text.setAttribute("text-anchor", "middle"); text.setAttribute("font-size", "2.2");
    text.setAttribute("fill", "#f8f4e8"); text.setAttribute("font-family", "Inter, sans-serif");
    text.setAttribute("font-weight", "500"); text.setAttribute("paint-order", "stroke");
    text.setAttribute("stroke", "#0a1008"); text.setAttribute("stroke-width", "0.8");
    text.setAttribute("pointer-events", "none"); text.textContent = zone.label;
    rect.addEventListener("mouseenter", () => { rect.setAttribute("fill", zone.color + "55"); showZonePanel(key); });
    rect.addEventListener("mouseleave", () => { rect.setAttribute("fill", zone.color + "28"); });
    rect.addEventListener("click", () => { showZonePanel(key); if (zone.viewpoint) openWorldAt(zone.viewpoint); });
    svg.appendChild(rect); svg.appendChild(text);
  });
  zoneLayer.appendChild(svg);
}

//           NAV
function bindPlotSystem() {
  const canvas = document.getElementById("world-canvas");
  if (!canvas) return;
  canvas.addEventListener("click", e => {
    if (!document.getElementById("world-overlay")?.classList.contains("open")) return;
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width)  * 2 - 1,
     -((e.clientY - rect.top)  / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, getCamera());
    const plotKey = getPlotAtRay(raycaster);
    if (plotKey) showPlotPanel(plotKey);
  });
}

function showPlotPanel(plotKey) {
  const plot = plotRegistry.get(plotKey);
  if (!plot) return;
  const panel = document.getElementById("plot-panel");
  if (!panel) return;
  const [x, z] = plotKey.split(",").map(Number);
  const side = x < 0 ? "West" : x === 0 ? "Centre" : "East";
  const pos  = z < -50 ? "North" : z > 50 ? "South" : "Mid";
  panel.querySelector(".plot-id").textContent      = `Plot ${plotKey}`;
  panel.querySelector(".plot-location").textContent = `${pos} ${side}     Premium Villa`;
  panel.querySelector(".plot-status").textContent   = plot.status === "available" ? "Available" : "Reserved";
  panel.querySelector(".plot-status").className     = "plot-status " + plot.status;
  const btn = panel.querySelector(".plot-reserve-btn");
  btn.disabled    = plot.status !== "available";
  btn.textContent = plot.status === "available" ? "Reserve This Plot" : "Already Reserved";
  btn.onclick = () => {
    if (reservePlot(plotKey)) {
      showPlotPanel(plotKey);
      showNotification("Plot reserved! Our team will contact you within 24 hours.");
    }
  };
  panel.classList.add("visible");
  
  const closeBtn = document.getElementById("plot-panel-close");
  if (closeBtn) {
    const closeHandler = e => {
      e.stopImmediatePropagation();
      panel.classList.remove("visible");
      closeBtn.removeEventListener('click', closeHandler, true);
    };
    closeBtn.addEventListener('click', closeHandler, { capture: true, once: true });
  }
}

function showNotification(msg) {
  const n = document.getElementById("notification");
  if (!n) return;
  n.textContent = msg; n.classList.add("show");
  setTimeout(() => n.classList.remove("show"), 4500);
}

window.closeWorldAndPlot = function() {
  document.getElementById("plot-panel")?.classList.remove("visible");
  document.getElementById("world-overlay")?.classList.remove("open");
  document.body.style.overflow = "";
};

function bindNav() {
  document.querySelectorAll("[data-section]").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const target = document.getElementById(link.dataset.section);
      if (target) target.scrollIntoView({ behavior: "smooth" });
    });
  });
  document.querySelectorAll(".btn-explore").forEach(btn => {
    btn.addEventListener("click", () => document.getElementById("masterplan").scrollIntoView({ behavior: "smooth" }));
  });
  document.querySelectorAll(".btn-enter-3d").forEach(btn => {
    btn.addEventListener("click", () => openWorldAt("field_centre"));
  });
}

//           WORLD ENTRY
async function openWorldAt(viewKey) {
  currentViewKey = viewKey;
  const vp = VIEWPOINTS[viewKey] || VIEWPOINTS.field_centre;

  showLoading();
  setLoadingProgress(10);

  if (!sceneReady) {
    const canvas3d = document.getElementById("world-canvas");
    initScene(canvas3d);
    setLoadingProgress(40);
    initControls(getCamera(), getRenderer());
    setLoadingProgress(70);
    initMinimap("assets/plan-2d.png");
    setLoadingProgress(85);
    composer = initPostProcessing(getRenderer(), getScene(), getCamera());
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

  const overlay = document.getElementById("world-overlay");
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";

  resizeWorld();
  window.addEventListener("resize", resizeWorld);

  if (viewKey === "field_centre" && !introPlaying) {
    await cinematicIntro();
  } else {
    const pos = vp.pos;
    setView(pos, vp.yaw, vp.pitch || 0);
    setCaption(vp.caption);
  }

  if (horseMode) {
    const cam = getCamera();
    cam.position.y = RIDER_EYE_HEIGHT;
  }

  activate();

  if (isMobile()) {
    showJoystick();
    showEnterPrompt("Drag right to look    Left joystick to walk");
  } else {
    showEnterPrompt("Click to lock cursor    WASD / arrows to walk    Shift to sprint");
  }

  enableAudio();
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
  const duration = 3800;
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
      const startP = introVp.pitch;
      const camPitch = startP + (0 - startP) * e;
      cam.rotation.order = "YXZ";
      cam.rotation.x = camPitch;
      cam.rotation.y = introVp.yaw + (targetVp.yaw - introVp.yaw) * e;
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });

  setView(endPos, targetVp.yaw, 0);
  setCaption(targetVp.caption);
}

function toggleAerial(btn) {
  aerialOrbit = !aerialOrbit;
  if (aerialOrbit) {
    btn && btn.classList.add("active");
    deactivate();
    aerialAngle = 0; aerialYawOffset = 0; aerialPitch = -Math.PI / 2.5;
    setCaption("Aerial view     hover orbits automatically    drag to steer");
    bindAerialPointer();
  } else {
    btn && btn.classList.remove("active");
    unbindAerialPointer();
    activate();
    teleportTo("field_centre", VIEWPOINTS.field_centre);
  }
}

function bindAerialPointer() {
  const el = getRenderer()?.domElement;
  if (!el) return;
  el.addEventListener("mousedown",  aerialMouseDown,  { passive:true });
  el.addEventListener("mousemove",  aerialMouseMove,  { passive:true });
  el.addEventListener("mouseup",    aerialMouseUp,    { passive:true });
  el.addEventListener("touchstart", aerialTouchStart, { passive:true });
  el.addEventListener("touchmove",  aerialTouchMove,  { passive:false });
  el.addEventListener("touchend",   aerialMouseUp,    { passive:true });
}
function unbindAerialPointer() {
  const el = getRenderer()?.domElement;
  if (!el) return;
  el.removeEventListener("mousedown",  aerialMouseDown);
  el.removeEventListener("mousemove",  aerialMouseMove);
  el.removeEventListener("mouseup",    aerialMouseUp);
  el.removeEventListener("touchstart", aerialTouchStart);
  el.removeEventListener("touchmove",  aerialTouchMove);
  el.removeEventListener("touchend",   aerialMouseUp);
}
function aerialMouseDown(e)  { aerialDragging=true; aerialLastX=e.clientX; aerialLastY=e.clientY; }
function aerialMouseUp()     { aerialDragging=false; }
function aerialMouseMove(e)  {
  if (!aerialDragging) return;
  aerialYawOffset -= (e.clientX - aerialLastX) * 0.004;
  aerialPitch = Math.max(-Math.PI*0.9, Math.min(-0.15, aerialPitch - (e.clientY - aerialLastY) * 0.003));
  aerialLastX=e.clientX; aerialLastY=e.clientY;
}
function aerialTouchStart(e) { const t=e.touches[0]; aerialDragging=true; aerialLastX=t.clientX; aerialLastY=t.clientY; }
function aerialTouchMove(e) {
  e.preventDefault();
  const t=e.touches[0];
  aerialYawOffset -= (t.clientX - aerialLastX) * 0.004;
  aerialPitch = Math.max(-Math.PI*0.9, Math.min(-0.15, aerialPitch - (t.clientY - aerialLastY) * 0.003));
  aerialLastX=t.clientX; aerialLastY=t.clientY;
}
window.toggleAerial = toggleAerial;

function teleportTo(key, vp) {
  setView(vp.pos, vp.yaw, vp.pitch || 0);
  setCaption(vp.caption);
  if (vp.zoneKey) showZonePanel(vp.zoneKey);
  else hideZonePanel();
}

//           EXIT WORLD
function bindExitButton() {
  document.getElementById("btn-close-world")?.addEventListener("click", closeWorld, { capture: true });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && document.getElementById("world-overlay")?.classList.contains("open")) {
      if (document.pointerLockElement) document.exitPointerLock();
      else closeWorld();
    }
  });
}

function closeWorld() {
  deactivate();
  hideJoystick();
  document.getElementById("world-overlay")?.classList.remove("open");
  document.getElementById("plot-panel")?.classList.remove("visible");  // also close any open panel
  document.body.style.overflow = "";
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
  window.removeEventListener("resize", resizeWorld);
}

//           RENDER LOOP
function startRenderLoop() {
  if (animFrameId) cancelAnimationFrame(animFrameId);
  const renderer = getRenderer();
  const scene    = getScene();
  const camera   = getCamera();
  const clock    = getClock();
  const startTime = performance.now();

  function frame() {
    animFrameId = requestAnimationFrame(frame);
    const delta   = Math.min(clock.getDelta(), 0.033);
    const elapsed = (performance.now() - startTime) / 1000;

    if (aerialOrbit) {
      aerialAngle += AERIAL_SPEED * delta;
      const totalAngle = aerialAngle + aerialYawOffset;
      camera.position.x = Math.sin(totalAngle) * AERIAL_RADIUS;
      camera.position.z = Math.cos(totalAngle) * AERIAL_RADIUS;
      camera.position.y = AERIAL_HEIGHT;
      camera.lookAt(0, 0, 0);
      camera.rotation.x = aerialPitch;
    } else {
      updateControls(delta);

      if (horseMode) {
        camera.position.y += (RIDER_EYE_HEIGHT - camera.position.y) * Math.min(delta * 12, 1);
      }

      const moved = Math.abs(camera.position.x - _prevCamX) > 0.01 || Math.abs(camera.position.z - _prevCamZ) > 0.01;
      _prevCamX = camera.position.x;
      _prevCamZ = camera.position.z;

      setHorsePosition(camera.position.x, 0, camera.position.z, getYaw());
      tickHorseAnim(delta, moved);
    }

    tickScene(elapsed, camera);
    updateMinimap(camera.position.x, camera.position.z, getYaw());
    updateSpatialAudio(camera.position.x, camera.position.z);
    
    // OPTIMIZATION: Bypass EffectComposer completely in fast mode
    if (window.PERF_MODE === 'fast' || !composer) {
      renderer.render(scene, camera);
    } else {
      renderFrame();
    }
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
  resizeComposer(w, h);
}

//           SCROLL ANIMATIONS
function bindSectionScrollAnim() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add("in-view"); });
  }, { threshold: 0.12 });
  document.querySelectorAll(".anim-fade").forEach(el => io.observe(el));
}

//           VILLA INTERIOR (INTEGRATED INTO MAIN WORLD)
let isVillaBuiltInWorld = false;

function bindVillaInteriorBtn() {
  document.addEventListener("click", e => {
    const enterBtn = e.target.closest(".residence-card-btn");
    const card = enterBtn?.closest(".residence-card");
    if (enterBtn && card?.querySelector(".residence-card-type")?.textContent?.includes("3 Bed")) {
      openVillaInterior(); return;
    }
    const tab = e.target.closest(".plan-tab");
    if (tab) {
      document.querySelectorAll(".plan-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const plan = tab.dataset.plan;
      document.querySelectorAll(".plan-rooms").forEach(r => r.classList.add("hidden"));
      document.getElementById("plan-" + plan)?.classList.remove("hidden");
      return;
    }
    const room = e.target.closest(".plan-room");
    if (room?.dataset.key) {
      teleportVillaTo(room.dataset.key);
      document.querySelectorAll(".plan-room").forEach(r => r.classList.remove("active"));
      room.classList.add("active");
      return;
    }
  });
  document.getElementById("btn-close-villa")?.addEventListener("click", closeVillaInterior, { capture: true });
}

function openVillaInterior() {
  const overlay = document.getElementById("villa-overlay");
  if (!overlay) return;
  
  // Make the UI overlay transparent and hide the black canvas so the real world shows through
  overlay.style.background = "transparent";
  const vCanvas = document.getElementById("villa-canvas");
  if (vCanvas) vCanvas.style.display = "none";
  
  overlay.classList.add("open");

  // Physically spawn the interior walls into the main scene at the North Villa coordinates
  if (!isVillaBuiltInWorld) {
    const intGroup = new THREE.Group();
    intGroup.position.set(0, 0.1, -132); // Exact North Villa plot
    getScene().add(intGroup);
    buildVillaInterior(intGroup);
    isVillaBuiltInWorld = true;
  }

  teleportVillaTo("approach");
  activate();
  buildVillaStrip();
}

function closeVillaInterior() {
  document.getElementById("villa-overlay")?.classList.remove("open");
  // Return to the main field when exiting the house
  teleportTo("field_centre", VIEWPOINTS.field_centre);
}

function teleportVillaTo(key) {
  const vp = VILLA_VIEWPOINTS.find(v => v.key === key);
  if (!vp) return;
  
  // Translate the local interior coordinates to physical world coordinates
  const worldX = vp.pos[0];
  const worldY = vp.pos[1];
  const worldZ = vp.pos[2] - 132;
  const worldYaw = vp.yaw + Math.PI; // Look the correct direction

  setView([worldX, worldY, worldZ], worldYaw, vp.pitch || 0);
  setCaption(vp.caption || vp.label);
  
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
    btn.innerHTML = `<span class="vp-label">${vp.label}</span>`;
    btn.addEventListener("click", () => teleportVillaTo(vp.key));
    strip.appendChild(btn);
  });
}
