import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
/**
 * Project XIX  —  Main Application Entry Point  v24
 * Changes from v23:
 *  - Villa 0°/90°/180°/270° buttons removed from toolbar (still available via console: rotateVillaGLB())
 *  - Horse GLB used; tickHorse(delta) called each frame; setHorsePosition() synced to camera
 *  - setPerfMode now wired through to graphics.js (postfx bypassed in Fast)
 *  - switchPerfMode() updates both scene and graphics
 *  - Plot panel: highlightPlot() called on open so overlay briefly shows, hides on close
 *  - Villas dropdown: wired and styled — works on click
 */

import { VIEWPOINTS, ZONES, WORLD } from "./data.js";
import { buildVillaInterior, VILLA_VIEWPOINTS } from "./villa-interior.js";
import {
  initScene, getRenderer, getScene, getCamera, getClock,
  tickScene, updateSky, updateSkyForTime, plotRegistry, reservePlot, getPlotAtRay,
  highlightPlot, setPerfMode, PERF_MODE,
  RIDER_EYE_HEIGHT, FOOT_EYE_HEIGHT, tickHorse, tickHorseAnim,
  setHorsePosition, getThirdPersonCameraOffset, setAerialMode,
  getSunLight, getHorseGroup, updateNightLights, updateBuildingNightGlow,
} from "./scene.js";
import { initPostProcessing, resizeComposer, renderFrame, setBloomForTime, setPerfModeGraphics, setInteriorDOF } from "./graphics.js";
import {
  initControls, activate, deactivate, setView, updateControls, getYaw,
  requestGyro, enterVR, setYOwner
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
let sceneReady     = false;
let villaScene     = null, villaRenderer = null;
let introPlaying   = false;

// ── AUTO DAY CYCLE ─────────────────────────────────────────────────────────────
// 5-minute full day cycle (morning→afternoon→sunset→night→morning).
// Pauses for 120s when user manually selects a time preset.
const DAY_CYCLE_DURATION = 5 * 60; // 5 minutes per full cycle in seconds
let   _dayAutoRun  = true;   // false when user manually picks a time
let   _dayPauseEnd = 0;      // performance.now() timestamp when auto-run resumes
let   _lastDayApplied = '';  // prevent calling applyTimePreset every frame

const DAY_STOPS = [
  { t: 0.00, name: 'morning'   },  // 0%  — 0:00
  { t: 0.30, name: 'afternoon' },  // 30% — 1:30
  { t: 0.65, name: 'sunset'    },  // 65% — 3:15
  { t: 0.80, name: 'night'     },  // 80% — 4:00
  { t: 1.00, name: 'morning'   },  // wraps back
];

function tickDayCycle(elapsed) {
  if (!_dayAutoRun) return;
  if (performance.now() < _dayPauseEnd) return;
  // Determine current phase within 5-min cycle
  const phase = (elapsed % DAY_CYCLE_DURATION) / DAY_CYCLE_DURATION; // 0.0-1.0
  // Find which named stop we're in
  let name = 'afternoon';
  for (let i = 0; i < DAY_STOPS.length - 1; i++) {
    if (phase >= DAY_STOPS[i].t && phase < DAY_STOPS[i+1].t) {
      name = DAY_STOPS[i].name; break;
    }
  }
  if (name !== _lastDayApplied) {
    _lastDayApplied = name;
    applyTimePreset(name);
  }
}

// Patch applyTimePreset: when user clicks, pause auto-cycle for 2 minutes
const _origApplyTimePreset = applyTimePreset;
function applyTimePresetWithPause(name) {
  _dayPauseEnd = performance.now() + 120_000; // pause 2 min
  _origApplyTimePreset(name);
}
window.applyTimePreset = applyTimePresetWithPause;
let currentViewKey = "field_centre";
let animFrameId    = null;
let composer       = null;
let aerialOrbit    = false;
let aerialAngle    = 0, aerialYawOffset = 0;
// Correct depression: camera at R=340 x=0, y=280 → atan(280/340) ≈ 0.685 rad
let aerialPitch    = -0.685;
let aerialDragging = false, aerialLastX = 0, aerialLastY = 0;
const AERIAL_RADIUS = 340, AERIAL_HEIGHT = 280, AERIAL_SPEED = 0.12;

// Movement mode: 'walk' = free roam on foot (default), 'ride' = mounted horse
let moveMode = 'walk'; // 'walk' | 'ride'
let _prevCamX = 0, _prevCamZ = 0;
let _targetEyeY = FOOT_EYE_HEIGHT;  // walk is default
let _currentEyeY = FOOT_EYE_HEIGHT;

// Expose toggle for the mode button
window.setMoveMode = function(mode) {
  if (mode === 'aerial') {
    // Only enter aerial if not already in it
    if (!aerialOrbit) toggleAerial(null);
    return;
  }

  // CRITICAL: If we're in aerial, fully tear it down first before switching to ground mode.
  // Without this, aerialOrbit stays true and the aerial render branch keeps running.
  if (aerialOrbit) {
    aerialOrbit = false;         // flip state first so toggleAerial exit branch runs
    unbindAerialPointer();       // remove aerial touch/mouse listeners
    const cam = getCamera();
    if (cam) { cam.fov = 65; cam.far = 1200; cam.updateProjectionMatrix(); }
    const sc = getScene();
    if (sc && sc.fog) sc.fog.density = _fogEnabled ? _currentFogD : 0.000001;
    if (typeof setAerialMode === 'function') setAerialMode(false);
    document.querySelectorAll('.move-mode-btn').forEach(b => b.classList.remove('active'));
  }

  moveMode = mode;
  setYOwner(mode === 'ride' ? 'app' : 'controls');
  _targetEyeY = (mode === 'ride')
    ? (typeof RIDER_EYE_HEIGHT !== 'undefined' ? RIDER_EYE_HEIGHT : 3.1)
    : (typeof FOOT_EYE_HEIGHT  !== 'undefined' ? FOOT_EYE_HEIGHT  : 1.72);
  if (mode === 'walk') _currentEyeY = _targetEyeY;

  // Always re-engage controls after a mode switch — recovers from lost pointer lock
  activate();

  document.querySelectorAll('.move-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
};

//           TIME PRESETS
const TIME_PRESETS = {
  morning:   { sky:["#1e3a5a","#7aaac8","#4a7a38"], sunCol:0xffd080, sunInt:1.8, sunPos:[-80,55,-80],   fog:"#8ab8cc", fogD:0.00018, exp:0.92, hemiInt:0.9 },
  afternoon: { sky:["#1a3a6a","#5a9acc","#3a6a30"], sunCol:0xffe8b0, sunInt:2.2, sunPos:[-160,160,100], fog:"#8ab8cc", fogD:0.00014, exp:1.02, hemiInt:1.2 },
  sunset:    { sky:["#0a1830","#c84818","#4a2a10"], sunCol:0xff8030, sunInt:1.6, sunPos:[-100,28,60],   fog:"#c06040", fogD:0.00022, exp:1.05, hemiInt:0.8 },
  night:     { sky:["#000508","#020a14","#050a08"], sunCol:0x304870, sunInt:0.12,sunPos:[0,40,-80],     fog:"#020810", fogD:0.00035, exp:0.55, hemiInt:0.15 },
};

function applyTimePreset(name) {
  const p = TIME_PRESETS[name]; if (!p) return;
  document.querySelectorAll(".wx-time-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.time === name));
  if (window._updateDayClock) window._updateDayClock(name);
  try {
    // updateSkyForTime uses the atmospheric sky (Preetham scattering)
    if (typeof updateSkyForTime === 'function') updateSkyForTime(name);
    else if (typeof updateSky === 'function') updateSky(...(p.sky||[]));
  } catch(e){ console.warn('[XIX] sky update:', e.message); }
  try { setBloomForTime(name); } catch(e){}
  // Night security lights and building glow — uses actual scene exports
  try { if (typeof updateNightLights === 'function') updateNightLights(name); } catch(e){}
  try { if (typeof updateBuildingNightGlow === 'function') updateBuildingNightGlow(name); } catch(e){}
  const sc = getScene();
  if (sc && sc.fog) {
    sc.fog.color.set(p.fog);
    _currentFogD = p.fogD;
    sc.fog.density = _fogEnabled ? p.fogD : 0.000001;
  }
  // Update lights directly via cached refs — no scene.traverse
  const _sun = typeof getSunLight === 'function' ? getSunLight() : null;
  if (_sun) { _sun.color.setHex(p.sunCol); _sun.intensity = p.sunInt; _sun.position.set(...p.sunPos); }
  const r = getRenderer();
  if (r) r.toneMappingExposure = p.exp;
}

function applyWeather(w) {
  document.querySelectorAll(".wx-weather-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.weather === w));
  const sc = getScene();
  if (!sc || !sc.fog) return;
  if (w === "rain")        _currentFogD = _currentFogD * 3.5;
  else if (w === "cloudy") _currentFogD = _currentFogD * 1.8;
  // else "clear" — _currentFogD stays at the time preset value (set by applyTimePreset)
  if (_fogEnabled) sc.fog.density = _currentFogD;
}

window.applyTimePreset = applyTimePreset;
window.applyWeather    = applyWeather;

// ─── FOG TOGGLE ───────────────────────────────────────────────────────────────
let _fogEnabled  = true;
let _currentFogD = TIME_PRESETS.afternoon.fogD;

window.setFogEnabled = function(enabled) {
  _fogEnabled = enabled;
  const sc = getScene();
  if (!sc || !sc.fog) return;
  sc.fog.density = enabled ? _currentFogD : 0.000001;
  // Sync toggle button state if present
  const btn = document.getElementById('fog-toggle-btn');
  if (btn) btn.classList.toggle('active', enabled);
};
window.isFogEnabled = function() { return _fogEnabled; };

// rotateVillaGLB still works from console — just not in toolbar
window.rotateVillaGLB = function(degrees) {
  const rads = degrees * Math.PI / 180;
  const sc = getScene();
  if (!sc) return;
  sc.traverse(obj => {
    if (obj.userData?.isVillaGLB)
      obj.rotation.y = obj.userData.baseRotY + rads;
  });
  console.log('[XIX] Villa GLB rotated', degrees, 'deg');
};

// ── DAY CLOCK: on-screen time display synced to cycle ─────────────────────────
function injectDayClock() {
  if (document.getElementById('day-clock')) return;
  const s = document.createElement('style');
  s.textContent = `
    #day-clock {
      position: absolute;
      top: 54px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 200;
      background: rgba(8,18,10,0.72);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(201,168,76,0.25);
      border-radius: 20px;
      padding: 5px 16px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: Inter, sans-serif;
      font-size: 12px;
      color: rgba(240,236,224,0.85);
      pointer-events: none;
      transition: opacity .4s;
      white-space: nowrap;
    }
    #day-clock .clock-icon { font-size: 14px; }
    #day-clock .clock-time { font-variant-numeric: tabular-nums; letter-spacing:.05em; }
    #day-clock .clock-label { color: rgba(201,168,76,0.75); font-size:10px; letter-spacing:.1em; }
    @media(max-width:640px){ #day-clock { top: 48px; font-size:10px; padding:4px 12px; } }
  `;
  document.head.appendChild(s);

  const el = document.createElement('div');
  el.id = 'day-clock';
  el.innerHTML = '<span class="clock-icon">☀️</span><span class="clock-time">12:00</span><span class="clock-label">AFTERNOON</span>';
  document.getElementById('world-overlay')?.appendChild(el);

  // Update every second
  const icons = { morning:'🌅', afternoon:'☀️', sunset:'🌇', night:'🌙' };
  const labels = { morning:'MORNING', afternoon:'AFTERNOON', sunset:'SUNSET', night:'NIGHT' };
  // Map cycle phase → simulated clock time
  const clockTimes = { morning:'07:30', afternoon:'13:00', sunset:'18:45', night:'22:00' };

  window._updateDayClock = function(phaseName) {
    const ico = el.querySelector('.clock-icon');
    const tim = el.querySelector('.clock-time');
    const lbl = el.querySelector('.clock-label');
    if(ico) ico.textContent = icons[phaseName] || '☀️';
    if(tim) tim.textContent = clockTimes[phaseName] || '12:00';
    if(lbl) lbl.textContent = labels[phaseName] || 'DAY';
  };
  window._updateDayClock('afternoon');
}

// ── FIX: Topbar dropdowns — reliable on desktop and touch ──────────────────────
// Root cause of unresponsiveness was duplicate listeners (one with capture:true +
// stopPropagation blocking the second). This version uses a single delegated
// listener per wrapper with class-toggle state and no stopPropagation conflicts.
function fixTopbarDropdowns() {
  // Inject styles once
  const styleId = 'topbar-dropdown-fix';
  if (!document.getElementById(styleId)) {
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      /* Disable CSS :hover on dropdowns — JS controls open state only */
      .topbar-dropdown .topbar-dropdown-menu {
        display: none;
        position: fixed;
        z-index: 9998;
        min-width: 160px;
        flex-direction: column;
        background: rgba(8,18,10,0.97);
        border: 1px solid rgba(201,168,76,0.35);
        border-radius: 8px;
        padding: 4px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.7);
        overflow: hidden;
        pointer-events: all;
      }
      .topbar-dropdown:hover .topbar-dropdown-menu { display: none; }
      .topbar-dropdown .topbar-dropdown-menu.open { display: flex; }
      .wx-btn {
        background: none;
        color: rgba(240,236,224,0.85);
        border: none;
        padding: 12px 16px;
        cursor: pointer;
        font-size: 13px;
        text-align: left;
        white-space: nowrap;
        border-radius: 5px;
        transition: background .12s;
        min-height: 48px;
        display: flex;
        align-items: center;
        gap: 8px;
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        width: 100%;
        box-sizing: border-box;
        pointer-events: all;
      }
      .wx-btn:hover, .wx-btn.active { background: rgba(201,168,76,0.18); color: #c9a84c; }
      .wx-btn.active { font-weight: 600; }
      .world-btn {
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        min-height: 44px;
        cursor: pointer;
        pointer-events: all;
      }
      /* Ensure dropdown trigger buttons are always clickable */
      .topbar-dropdown > .world-btn {
        position: relative;
        z-index: 10;
        pointer-events: all;
      }
    `;
    document.head.appendChild(s);
  }

  function closeAll() {
    document.querySelectorAll('.topbar-dropdown-menu').forEach(m => {
      m.classList.remove('open');
    });
  }

  // Wire each dropdown — skip already-wired wrappers
  document.querySelectorAll('.topbar-dropdown').forEach(wrapper => {
    if (wrapper.dataset.dropdownFixed) return;
    wrapper.dataset.dropdownFixed = '1';

    const trigger = wrapper.querySelector('.world-btn[aria-haspopup]');
    const menu    = wrapper.querySelector('.topbar-dropdown-menu');
    if (!trigger || !menu) return;

    // Position menu under trigger when opened
    function positionMenu() {
      const r = trigger.getBoundingClientRect();
      menu.style.top  = (r.bottom + 4) + 'px';
      menu.style.left = Math.max(4, r.left) + 'px';
    }

    // Single clean listener — no capture, no stopPropagation
    trigger.addEventListener('pointerup', e => {
      e.preventDefault();
      const wasOpen = menu.classList.contains('open');
      closeAll();
      if (!wasOpen) {
        positionMenu();
        menu.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
      } else {
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    // Each item: call its own onclick (already set in HTML) then close
    menu.querySelectorAll('button, .wx-btn').forEach(item => {
      item.addEventListener('pointerup', () => {
        // Let the item's own onclick fire first (it's inline in HTML)
        requestAnimationFrame(() => closeAll());
      });
    });
  });

  // Close on canvas click
  document.getElementById('world-canvas')?.addEventListener('pointerdown', closeAll, { passive: true });
}


//           PERFORMANCE MODE TOGGLE
function injectPerfToggle() {
  if (document.getElementById('perf-toggle-bar')) return;
  const style = document.createElement('style');
  style.textContent = `
    #perf-toggle-bar { position:absolute; top:14px; right:14px; z-index:200;
      display:flex; align-items:center; gap:4px;
      background:rgba(10,20,12,0.78); backdrop-filter:blur(8px);
      border:1px solid rgba(201,168,76,0.3); border-radius:8px;
      padding:5px 10px; font-family:Inter,sans-serif; pointer-events:all; }
    #perf-toggle-bar .perf-label { color:rgba(255,255,255,0.45); font-size:11px; margin-right:2px; }
    #perf-toggle-bar .perf-btn {
      background:rgba(255,255,255,0.07); color:rgba(255,255,255,0.65);
      border:1px solid rgba(255,255,255,0.12); border-radius:5px;
      padding:3px 11px; cursor:pointer; font-size:11px; transition:all .15s; }
    #perf-toggle-bar .perf-btn.active {
      background:rgba(201,168,76,0.9); color:#0a1008;
      border-color:transparent; font-weight:600; }
    #perf-toggle-bar .perf-btn:hover:not(.active) { background:rgba(255,255,255,0.14); }
  `;
  document.head.appendChild(style);
  const bar = document.createElement('div');
  bar.id = 'perf-toggle-bar';
  bar.innerHTML = `
    <span class="perf-label">Quality</span>
    <button class="perf-btn active" data-mode="fast"     onclick="window.switchPerfMode('fast')">Fast</button>
    <button class="perf-btn"        data-mode="balanced" onclick="window.switchPerfMode('balanced')">Balanced</button>
    <button class="perf-btn"        data-mode="rich"     onclick="window.switchPerfMode('rich')">Rich</button>
  `;
  document.getElementById('world-overlay')?.appendChild(bar);
}

// ── MODE TOGGLE: Walk / Ride / Aerial ─────────────────────────────────────────
function injectModeToggle() {
  if (document.getElementById('mode-toggle-bar')) return;
  const style = document.createElement('style');
  style.textContent = `
    /* ── Mode toggle: bottom-right, clear of joystick (bottom-left) ── */
    #mode-toggle-bar {
      position: absolute;
      bottom: 90px;        /* above viewpoint strip */
      right: 12px;
      left: auto;
      transform: none;
      z-index: 210;
      display: flex;
      flex-direction: column; /* stack vertically on mobile so it's narrow */
      align-items: stretch;
      gap: 2px;
      background: rgba(10,20,12,0.88);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      border: 1px solid rgba(201,168,76,0.35);
      border-radius: 10px;
      overflow: hidden;
      pointer-events: all;
      font-family: Inter, sans-serif;
      min-width: 88px;
    }
    .move-mode-btn {
      background: none;
      color: rgba(255,255,255,0.65);
      border: none;
      padding: 10px 16px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 7px;
      min-height: 40px;
      transition: background .15s, color .15s;
      white-space: nowrap;
      -webkit-tap-highlight-color: transparent;
      width: 100%;
    }
    .move-mode-btn.active {
      background: rgba(201,168,76,0.9);
      color: #0a1008;
    }
    .move-mode-btn:hover:not(.active) { background: rgba(255,255,255,0.08); }
    .mode-divider { height: 1px; background: rgba(201,168,76,0.18); width: 100%; }

    /* Desktop: horizontal row */
    @media (min-width: 641px) {
      #mode-toggle-bar {
        flex-direction: row;
        bottom: 28px;
        right: 16px;
        min-width: unset;
      }
      .mode-divider { height: auto; width: 1px; align-self: stretch; }
      .move-mode-btn { padding: 8px 16px; min-height: 38px; width: auto; }
    }

    /* V key hint — desktop only */
    #view-hint {
      position: absolute;
      bottom: 76px;
      right: 16px;
      z-index: 200;
      font-size: 10px;
      color: rgba(255,255,255,0.32);
      letter-spacing: .06em;
      pointer-events: none;
      font-family: Inter, sans-serif;
      transition: opacity 1s;
    }

    /* Quality toggle — always visible, slightly smaller on mobile */
    @media (max-width: 640px) {
      #perf-toggle-bar { top: 6px; right: 6px; padding: 3px 6px; }
      #perf-toggle-bar .perf-btn { padding: 2px 7px; font-size: 10px; }
      #perf-toggle-bar .perf-label { display: none; }
    }
  `;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'mode-toggle-bar';
  // Walk is default active
  bar.innerHTML = `
    <button class="move-mode-btn" data-mode="ride"
      onclick="window.setMoveMode('ride')" aria-label="Ride mode">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M4 17c1-2 3-3 5-3s3 1 4 2 3 2 5 1"/>
        <circle cx="7" cy="11" r="2"/><path d="M9 11c1-3 4-5 7-4l2 1 1 3-2 1"/>
      </svg>
      Ride
    </button>
    <div class="mode-divider"></div>
    <button class="move-mode-btn active" data-mode="walk"
      onclick="window.setMoveMode('walk')" aria-label="Walk mode">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="12" cy="5" r="1.5"/>
        <path d="M9 19l1-5 2 3 2-3 1 5M8 12l1-3 3 2 3-2 1 3"/>
      </svg>
      Walk
    </button>
    <div class="mode-divider"></div>
    <button class="move-mode-btn" data-mode="aerial"
      onclick="window.setMoveMode('aerial')" aria-label="Aerial view">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/>
      </svg>
      Aerial
    </button>
  `;
  document.getElementById('world-overlay')?.appendChild(bar);

  // V key hint — desktop only, fades after 8s
  if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) {
    const hint = document.createElement('div');
    hint.id = 'view-hint';
    hint.textContent = 'V — 1st / 3rd person';
    document.getElementById('world-overlay')?.appendChild(hint);
    setTimeout(() => { hint.style.opacity = '0'; }, 8000);
  }
}

window.switchPerfMode = function(mode) {
  setPerfMode(mode);          // updates scene (shadow map, pixel ratio, fog)
  setPerfModeGraphics(mode);  // updates graphics pipeline (bloom, SMAA, direct render)
  document.querySelectorAll('.perf-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
};

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
  window.__moduleReady = Object.assign(window.__moduleReady || {}, {
    applyTimePreset, applyWeather, toggleAerial, rotateVillaGLB: window.rotateVillaGLB,
    switchPerfMode: window.switchPerfMode,
    // showProductPanel: wired below once product-panel module loads
  });
  // Wire our in-world property panel as the showProductPanel handler
  // This is called by ui.js buildViewpointStrip when a bottom button is clicked
  window.__moduleReady.showProductPanel = (key) => {
    try { openPropertyPanel(key); } catch(e) { console.error('[XIX] property panel:', e); }
  };
  window.showProductPanel = window.__moduleReady.showProductPanel;
  (window._pendingCalls || []).forEach(({fn,args}) => {
    if(window.__moduleReady[fn]) window.__moduleReady[fn](...args);
  });
  window._pendingCalls = [];
});

//           HERO CANVAS
function bootLandingCanvas() {
  const canvas = document.getElementById("hero-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let tick = 0, w = 0, h = 0;
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    w = canvas.offsetWidth; h = canvas.offsetHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function draw() {
    tick += 0.004;
    const sky = ctx.createLinearGradient(0,0,0,h);
    sky.addColorStop(0,"#0d2218"); sky.addColorStop(0.55,"#0a1810"); sky.addColorStop(1,"#070d08");
    ctx.fillStyle=sky; ctx.fillRect(0,0,w,h);
    ctx.fillStyle="rgba(255,248,220,0.7)";
    for(let i=0;i<60;i++){
      const sx=((i*137.5)%w), sy=((i*91.3)%(h*0.45));
      const size=(Math.sin(tick*2+i)*0.5+0.5)*1.2+0.4;
      ctx.beginPath(); ctx.arc(sx,sy,size,0,Math.PI*2); ctx.fill();
    }
    const ground=ctx.createLinearGradient(0,h*0.52,0,h);
    ground.addColorStop(0,"rgba(22,65,40,0.9)"); ground.addColorStop(1,"rgba(10,30,18,1)");
    ctx.fillStyle=ground;
    ctx.beginPath(); ctx.moveTo(0,h*0.52);
    ctx.bezierCurveTo(w*0.25,h*0.48,w*0.75,h*0.56,w,h*0.50);
    ctx.lineTo(w,h); ctx.lineTo(0,h); ctx.closePath(); ctx.fill();
    for(let i=0;i<14;i++){
      const px=(i/13)*w, pBase=h*0.51+Math.sin(i*1.7)*h*0.03, pScale=0.7+Math.sin(i*0.9)*0.3;
      drawPalmSilhouette(ctx,px,pBase,pScale,tick+i);
    }
    requestAnimationFrame(draw);
  }
  window.addEventListener("resize", resize);
  resize(); draw();
}

function drawPalmSilhouette(ctx,x,base,scale,phase){
  const h_trunk=55*scale;
  ctx.strokeStyle="rgba(8,22,14,0.9)"; ctx.lineWidth=2.5*scale;
  ctx.beginPath(); ctx.moveTo(x,base);
  const lean=Math.sin(phase*0.5)*4;
  ctx.bezierCurveTo(x+lean,base-h_trunk*0.4,x+lean*1.5,base-h_trunk*0.7,x+lean*2,base-h_trunk);
  ctx.stroke();
  ctx.lineWidth=1.2*scale;
  for(let i=0;i<7;i++){
    const angle=(i/7)*Math.PI*2+phase*0.2;
    ctx.beginPath(); ctx.moveTo(x+lean*2,base-h_trunk);
    ctx.quadraticCurveTo(x+lean*2+Math.cos(angle)*22*scale,base-h_trunk+Math.sin(angle)*8*scale-10*scale,
      x+lean*2+Math.cos(angle)*30*scale,base-h_trunk+Math.sin(angle)*18*scale);
    ctx.stroke();
  }
}

//           MASTERPLAN
function bindMasterplan() {
  const planImg=document.getElementById("plan-image");
  const zoneLayer=document.getElementById("zone-layer");
  if(!planImg||!zoneLayer) return;
  const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
  svg.setAttribute("viewBox","0 0 100 100");
  svg.setAttribute("preserveAspectRatio","none");
  svg.style.cssText="position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;";
  Object.entries(ZONES).forEach(([key,zone])=>{
    const {l,t,w,h}=zone.hot;
    const rect=document.createElementNS("http://www.w3.org/2000/svg","rect");
    rect.setAttribute("x",l); rect.setAttribute("y",t);
    rect.setAttribute("width",w); rect.setAttribute("height",h);
    rect.setAttribute("rx","0.8");
    rect.setAttribute("fill",zone.color+"28"); rect.setAttribute("stroke",zone.color);
    rect.setAttribute("stroke-width","0.4");
    rect.style.cursor="pointer"; rect.style.transition="fill 0.2s";
    const text=document.createElementNS("http://www.w3.org/2000/svg","text");
    text.setAttribute("x",l+w/2); text.setAttribute("y",t+h/2+1);
    text.setAttribute("text-anchor","middle"); text.setAttribute("font-size","2.2");
    text.setAttribute("fill","#f8f4e8"); text.setAttribute("font-family","Inter,sans-serif");
    text.setAttribute("font-weight","500"); text.setAttribute("paint-order","stroke");
    text.setAttribute("stroke","#0a1008"); text.setAttribute("stroke-width","0.8");
    text.setAttribute("pointer-events","none"); text.textContent=zone.label;
    rect.addEventListener("mouseenter",()=>{ rect.setAttribute("fill",zone.color+"55"); showZonePanel(key); });
    rect.addEventListener("mouseleave",()=>{ rect.setAttribute("fill",zone.color+"28"); });
    rect.addEventListener("click",()=>{ showZonePanel(key); if(zone.viewpoint) openWorldAt(zone.viewpoint); });
    svg.appendChild(rect); svg.appendChild(text);
  });
  zoneLayer.appendChild(svg);
}

// ─── PHASE 4: PERSISTENT VILLA AVAILABILITY OVERLAYS ─────────────────────────
function buildVillaStatusOverlays() {
  const sc = getScene();
  if (!sc) return;

  plotRegistry.forEach((plot, plotKey) => {
    if (document.getElementById(`plot-badge-${plotKey}`)) return;

    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 48;
    const ctx = canvas.getContext('2d');

    const isAvail = plot.status === 'available';

    // Badge Pill Background
    ctx.fillStyle = isAvail ? 'rgba(6,18,8,0.88)' : 'rgba(28,10,10,0.88)';
    ctx.beginPath();
    ctx.roundRect(2, 2, 156, 44, 10);
    ctx.fill();

    // Border
    ctx.strokeStyle = isAvail ? '#C9A84C' : 'rgba(220,70,70,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Status Text
    ctx.fillStyle = isAvail ? '#C9A84C' : '#ff6666';
    ctx.font = 'bold 15px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isAvail ? 'AVAILABLE' : 'RESERVED', 80, 24);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true
    });
    const sprite = new THREE.Sprite(mat);

    // Position sprite above the villa roof level
    sprite.scale.set(6, 1.8, 1);
    sprite.position.set(plot.x, 9.5, plot.z);
    sprite.userData = { isPlotBadge: true, plotKey };

    sc.add(sprite);
  });
}

//           PLOT SYSTEM
function bindPlotSystem() {
  const canvas = document.getElementById("world-canvas");
  if (!canvas) return;
  canvas.addEventListener("click", e => {
    if (!document.getElementById("world-overlay")?.classList.contains("open")) return;
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
     -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, getCamera());

    // 1. Check for floating availability badges first
    const badgeHits = raycaster.intersectObjects(getScene().children, false)
      .filter(h => h.object.userData?.isPlotBadge);

    if (badgeHits.length > 0) {
      const key = badgeHits[0].object.userData.plotKey;
      showPlotPanel(key);
      return;
    }

    // 2. Fallback to ground plot overlays
    const plotKey = getPlotAtRay(raycaster);
    if (plotKey) showPlotPanel(plotKey);
  });
}

function showPlotPanel(plotKey) {
  const plot=plotRegistry.get(plotKey);
  if(!plot) return;
  const panel=document.getElementById("plot-panel");
  if(!panel) return;
  // Stop aerial auto-pan so user can inspect the plot without camera drift
  if (aerialOrbit) { aerialOrbit = false; activate(); }
  const [x,z]=plotKey.split(",").map(Number);
  const side=x<0?"West":x===0?"Centre":"East";
  const pos=z<-50?"North":z>50?"South":"Mid";
  panel.querySelector(".plot-id").textContent       = `Plot ${plotKey}`;
  panel.querySelector(".plot-location").textContent = `${pos} ${side}  —  Premium Villa`;
  panel.querySelector(".plot-status").textContent   = plot.status==="available"?"Available":"Reserved";
  panel.querySelector(".plot-status").className     = "plot-status "+plot.status;
  const btn=panel.querySelector(".plot-reserve-btn");
  btn.disabled    = plot.status!=="available";
  btn.textContent = plot.status==="available"?"Reserve This Plot":"Already Reserved";
  btn.onclick=()=>{ if(reservePlot(plotKey)){ showPlotPanel(plotKey); showNotification("Plot reserved! Our team will contact you within 24 hours."); }};
  panel.classList.add("visible");
  // Real-time gold pulse highlight on selected plot
  highlightPlot(plotKey);
  _startPlotGlow(plotKey);

  // Close button — guaranteed immediate
  const closeBtn=document.getElementById("plot-panel-close");
  if(closeBtn){
    const handler=e=>{ e.stopImmediatePropagation(); panel.classList.remove("visible"); _stopPlotHighlightPulse(); closeBtn.removeEventListener('click',handler,true); };
    closeBtn.addEventListener('click',handler,{capture:true,once:true});
  }
}

// Gold pulsing glow on the selected plot overlay while the panel is open
let _glowAnimId = null;
function _startPlotGlow(plotKey) {
  if (_glowAnimId) cancelAnimationFrame(_glowAnimId);
  const plot = plotRegistry.get(plotKey);
  if (!plot || !plot.overlay) return;
  const mat = plot.overlay.material;
  const baseCol = plot.status === 'reserved' ? 0xff4444 : 0xC9A84C;
  mat.color.setHex(baseCol);
  const startT = performance.now();
  function pulse() {
    if (!document.getElementById('plot-panel')?.classList.contains('visible')) {
      mat.opacity = 0; return; // panel closed — stop
    }
    const t = (performance.now() - startT) / 1000;
    // Pulse between 0.25 and 0.60 opacity, 1.4s cycle
    mat.opacity = 0.38 + Math.sin(t * Math.PI * 1.4) * 0.22;
    _glowAnimId = requestAnimationFrame(pulse);
  }
  pulse();
}

// ── Gold pulse on selected villa overlay ────────────────────────────────────
let _pulseInterval = null;
function _startPlotHighlightPulse(plotKey) {
  _stopPlotHighlightPulse();
  let t = 0;
  _pulseInterval = setInterval(() => {
    t += 0.08;
    const alpha = 0.15 + Math.abs(Math.sin(t)) * 0.30;
    try {
      const sc = getScene();
      if (!sc) return;
      sc.traverse(o => {
        if (o.userData?.isPlotOverlay && o.userData?.plotKey === plotKey && o.material) {
          o.material.opacity = alpha;
          o.material.color.setHex(0xC9A84C);
          o.material.needsUpdate = true;
        }
      });
    } catch(e){}
  }, 50);
}
function _stopPlotHighlightPulse() {
  if (_pulseInterval) { clearInterval(_pulseInterval); _pulseInterval = null; }
  try { highlightPlot(null); } catch(e){}
}

function showNotification(msg) {
  const n=document.getElementById("notification");
  if(!n) return;
  n.textContent=msg; n.classList.add("show");
  setTimeout(()=>n.classList.remove("show"),4500);
}

window.closeWorldAndPlot=function(){
  document.getElementById("plot-panel")?.classList.remove("visible");
  document.getElementById("world-overlay")?.classList.remove("open");
  document.body.style.overflow="";
};

function bindNav() {
  document.querySelectorAll("[data-section]").forEach(link=>{
    link.addEventListener("click",e=>{
      e.preventDefault();
      document.getElementById(link.dataset.section)?.scrollIntoView({behavior:"smooth"});
    });
  });
  document.querySelectorAll(".btn-explore").forEach(btn=>{
    btn.addEventListener("click",()=>document.getElementById("masterplan").scrollIntoView({behavior:"smooth"}));
  });
  document.querySelectorAll(".btn-enter-3d").forEach(btn=>{
    btn.addEventListener("click",()=>openWorldAt("field_centre"));
  });
}

//           WORLD ENTRY
async function openWorldAt(viewKey) {
  currentViewKey=viewKey;
  const vp=VIEWPOINTS[viewKey]||VIEWPOINTS.field_centre;
  showLoading(); setLoadingProgress(10);

  if(!sceneReady){
    const canvas3d=document.getElementById("world-canvas");
    initScene(canvas3d);
    setLoadingProgress(40);
    initControls(getCamera(),getRenderer());
    setLoadingProgress(70);
    initMinimap("assets/plan-2d.png");
    setLoadingProgress(85);
    // Resize canvas BEFORE initPostProcessing so it has real pixel dimensions.
    // SMAAPass crashes if width/height are 0.
    resizeWorld();
    composer=initPostProcessing(getRenderer(),getScene(),getCamera());
    // Apply Fast mode to graphics immediately
    setPerfModeGraphics('fast');
    setLoadingProgress(90);
    showVRButton(()=>{
      enterVR(getRenderer(),getScene(),getCamera(),getClock(),tick=>{
        updateControls(tick);
        updateMinimap(getCamera().position.x,getCamera().position.z,getYaw());
        updateSpatialAudio(getCamera().position.x,getCamera().position.z);
      });
    });
    buildViewpointStrip(document.getElementById("viewpoint-strip"),(key,vp)=>teleportTo(key,vp));
    sceneReady=true; setLoadingProgress(100);
  }

  await new Promise(r=>setTimeout(r,300));
  hideLoading();
  const overlay=document.getElementById("world-overlay");
  overlay.classList.add("open");
  document.body.style.overflow="hidden";
  injectPerfToggle();
  injectModeToggle();
  fixTopbarDropdowns(); // Make TIME/WEATHER/QUALITY work on touch
  injectDayClock();     // On-screen time-of-day clock
  resizeWorld();
  window.addEventListener("resize",resizeWorld);

  // Phase 4: Mount persistent sales badges once the world opens
  setTimeout(() => buildVillaStatusOverlays(), 100);

  // Always open at field_centre — walk mode, ground level, facing north
  const _fieldVp = VIEWPOINTS['field_centre'];
  setView(_fieldVp.pos, _fieldVp.yaw, 0);
  setCaption(_fieldVp.caption);
  const cam = getCamera();
  const _walkH = 1.72; // matches controls.js EYE_H constant
  const _rideH = 3.10;
  const startY = (moveMode === 'ride') ? _rideH : _walkH;
  cam.position.y = startY;
  _currentEyeY = startY;
  _targetEyeY  = startY;
  if (typeof setYOwner === 'function') setYOwner(moveMode === 'ride' ? 'app' : 'controls');
  activate();
  if(isMobile()){
    showJoystick();
    // Inject sprint button above the joystick — clean position, not floating
    if (!document.getElementById('sprint-btn-mobile')) {
      const spStyle = document.createElement('style');
      spStyle.textContent = `
        #sprint-btn-mobile {
          position: absolute;
          bottom: 155px;
          left: 28px;
          z-index: 210;
          background: rgba(10,20,12,0.82);
          border: 1px solid rgba(201,168,76,0.4);
          color: rgba(201,168,76,0.9);
          border-radius: 8px;
          padding: 8px 18px;
          font-family: Inter, sans-serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: .08em;
          pointer-events: all;
          -webkit-tap-highlight-color: transparent;
          user-select: none;
          touch-action: none;
        }
        #sprint-btn-mobile.active {
          background: rgba(201,168,76,0.9);
          color: #0a1008;
        }
      `;
      document.head.appendChild(spStyle);
      const spBtn = document.createElement('button');
      spBtn.id = 'sprint-btn-mobile';
      spBtn.textContent = 'SPRINT';
      spBtn.addEventListener('touchstart', e => {
        e.preventDefault();
        window.__touchSprint = true;
        spBtn.classList.add('active');
      }, { passive: false });
      spBtn.addEventListener('touchend', e => {
        e.preventDefault();
        window.__touchSprint = false;
        spBtn.classList.remove('active');
      }, { passive: false });
      document.getElementById('world-overlay')?.appendChild(spBtn);
    }
    // Don't show enter prompt on mobile — joystick is self-evident
  } else {
    // Desktop: show prompt for 10s, then auto-hide
    showEnterPrompt("Click to lock cursor  •  WASD to walk  •  Shift to sprint");
    setTimeout(hideEnterPrompt, 10000);
    // Re-show briefly (2s) on first keyboard movement attempt
    let _promptShown = false;
    function _onFirstMove(e) {
      const mvKeys = new Set(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright']);
      if (mvKeys.has((e.key||'').toLowerCase()) && !_promptShown) {
        _promptShown = true;
        showEnterPrompt("Click to lock cursor  •  WASD to walk");
        setTimeout(hideEnterPrompt, 2000);
        document.removeEventListener('keydown', _onFirstMove);
      }
    }
    document.addEventListener('keydown', _onFirstMove, { passive:true });
    // Mobile/touch: 2s flash when joystick is first touched
    const _joy = document.getElementById('joystick-overlay');
    if (_joy) {
      _joy.addEventListener('touchstart', () => {
        if (!_promptShown) {
          _promptShown = true;
          showEnterPrompt('Drag right to look  •  Joystick to move');
          setTimeout(hideEnterPrompt, 2000);
        }
      }, { passive:true, once:true });
    }
  }
  enableAudio();
  startRenderLoop();
}

async function cinematicIntro(){
  introPlaying = true;
  const targetVp = VIEWPOINTS.field_centre;
  const cam = getCamera();
  
  // Lock controls so user cannot interrupt the cinematic camera movement
  if (typeof deactivate === 'function') deactivate(); 

  // 1. Inject Title Overlay Card with Luxury Vignette
  const titleCard = document.createElement('div');
  titleCard.id = 'cinematic-title-card';
  titleCard.style.cssText = `
    position: fixed; inset: 0; z-index: 3000;
    background: radial-gradient(circle, rgba(6,18,8,0.4) 0%, rgba(6,18,8,0.98) 100%);
    background-color: rgba(6,18,8,0.90);
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: #f0ece0; font-family: 'Cormorant Garamond', serif; pointer-events: none;
    opacity: 1; transition: opacity 1.5s ease;
  `;
  titleCard.innerHTML = `
    <h1 style="font-size: 2.8rem; font-weight: 300; letter-spacing: 0.15em; color: #C9A84C; margin: 0 0 8px 0; text-shadow: 0 4px 12px rgba(0,0,0,0.5);">PROJECT XIX</h1>
    <p style="font-size: 1rem; font-family: Inter, sans-serif; letter-spacing: 0.2em; color: rgba(240,236,224,0.7); text-transform: uppercase;">Lakowe, Ibeju-Lekki</p>
  `;
  document.body.appendChild(titleCard);

  // 2. Play Procedural Warm Piano Stinger (Web Audio API)
  if (window.AudioContext || window.webkitAudioContext) {
    try {
      const actx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      osc.type = 'sine'; // Pure, warm tone
      osc.frequency.value = 432; 
      gain.gain.setValueAtTime(0, actx.currentTime);
      gain.gain.linearRampToValueAtTime(0.4, actx.currentTime + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 4.0);
      osc.connect(gain);
      gain.connect(actx.destination);
      osc.start();
      osc.stop(actx.currentTime + 4.0);
    } catch(e) { console.warn('[XIX] Audio stinger skipped:', e); }
  }

  // 3. Setup Bezier Drone Path
  const endPos = targetVp.pos; // [0, 1.72, 0]
  // P0: Start 300m high, 180m back
  const p0 = [0, 300, 180];
  // P1: Control Point pulls the camera to drop sharply first, then skim forward
  const p1 = [0, 10, 180]; 
  // P2: End Position (Polo Field Centre)
  const p2 = endPos;

  const startPitch = -Math.PI / 2; // Looking straight down
  const endPitch = targetVp.pitch || 0;
  const targetYaw = targetVp.yaw || 0;
  
  cam.position.set(...p0);
  cam.rotation.set(startPitch, targetYaw, 0, "YXZ");

  // 4. Execute 4.5s Sequence (1.5s Hold + 3.0s Swoop)
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  // Fade out title card while descent begins
  titleCard.style.opacity = '0';
  setTimeout(() => titleCard.remove(), 1500);

  const duration = 3000;
  const start = performance.now();

  await new Promise(resolve => {
    // Smooth cubic ease-in-out for the velocity of the camera
    function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    
    function step(now) {
      const t = Math.min((now - start) / duration, 1);
      const e = ease(t);
      
      // Quadratic Bezier interpolation for a curved spatial arc
      const mt = 1 - e;
      cam.position.x = mt*mt*p0[0] + 2*mt*e*p1[0] + e*e*p2[0];
      cam.position.y = mt*mt*p0[1] + 2*mt*e*p1[1] + e*e*p2[1];
      cam.position.z = mt*mt*p0[2] + 2*mt*e*p1[2] + e*e*p2[2];
      
      // Linear interpolation for the camera tilting up as it lands
      cam.rotation.x = startPitch + (endPitch - startPitch) * e;
      
      if(t < 1) requestAnimationFrame(step);
      else resolve();
    }
    requestAnimationFrame(step);
  });

  // Re-engage normal estate controls
  if (typeof activate === 'function') activate();
  setView(endPos, targetYaw, endPitch);
  setCaption(targetVp.caption);
  introPlaying = false;
}

function toggleAerial(btn){
  aerialOrbit=!aerialOrbit;
  if(aerialOrbit){
    btn&&btn.classList.add("active");
    deactivate();
    aerialAngle=0; aerialYawOffset=0; aerialPitch=-0.685;
    // Widen FOV — 90° shows full estate in portrait mobile
    const _aerCam = getCamera();
    _aerCam.fov = 90; _aerCam.far = 2000; _aerCam.updateProjectionMatrix();
    // Disable fog — exponential fog hides buildings at orbital distance
    const _sc = getScene();
    if (_sc && _sc.fog) _sc.fog.density = 0.000001;
    // Freeze LOD on all villas → force full-detail level visible
    // O(n) once here, zero per-frame cost during orbit
    if (typeof setAerialMode === 'function') setAerialMode(true);
    setCaption("Aerial view — drag to steer");
    bindAerialPointer();
    // Mark aerial button active in mode toggle
    document.querySelectorAll('.move-mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === 'aerial')
    );
  } else {
    btn&&btn.classList.remove("active");
    unbindAerialPointer();
    activate();
    const cam = getCamera();
    // Restore normal FOV + far plane
    cam.fov = 65; cam.far = 1200; cam.updateProjectionMatrix();
    // Restore fog to current time/weather density (respects fog toggle)
    const _scR = getScene();
    if (_scR && _scR.fog) _scR.fog.density = _fogEnabled ? _currentFogD : 0.000001;
    // Re-enable LOD auto-update — renderer resumes distance-based switching
    if (typeof setAerialMode === 'function') setAerialMode(false);
    const walkH = (typeof FOOT_EYE_HEIGHT  !== 'undefined') ? FOOT_EYE_HEIGHT  : 1.72;
    const rideH = (typeof RIDER_EYE_HEIGHT !== 'undefined') ? RIDER_EYE_HEIGHT : 3.10;
    const targetY = (moveMode === 'ride') ? rideH : walkH;
    cam.position.y = targetY;
    _currentEyeY = targetY;
    _targetEyeY  = targetY;
    // Restore mode toggle to current ground mode
    document.querySelectorAll('.move-mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === moveMode)
    );
  }
}

function bindAerialPointer(){
  const el=getRenderer()?.domElement; if(!el) return;
  el.addEventListener("mousedown",aerialMouseDown,{passive:true});
  el.addEventListener("mousemove",aerialMouseMove,{passive:true});
  el.addEventListener("mouseup",aerialMouseUp,{passive:true});
  el.addEventListener("touchstart",aerialTouchStart,{passive:true});
  el.addEventListener("touchmove",aerialTouchMove,{passive:false});
  el.addEventListener("touchend",aerialMouseUp,{passive:true});
}
function unbindAerialPointer(){
  const el=getRenderer()?.domElement; if(!el) return;
  el.removeEventListener("mousedown",aerialMouseDown);
  el.removeEventListener("mousemove",aerialMouseMove);
  el.removeEventListener("mouseup",aerialMouseUp);
  el.removeEventListener("touchstart",aerialTouchStart);
  el.removeEventListener("touchmove",aerialTouchMove);
  el.removeEventListener("touchend",aerialMouseUp);
}
function aerialMouseDown(e){aerialDragging=true;aerialLastX=e.clientX;aerialLastY=e.clientY;}
function aerialMouseUp(){aerialDragging=false;}
function aerialMouseMove(e){
  if(!aerialDragging) return;
  aerialYawOffset-=(e.clientX-aerialLastX)*0.004;
  aerialPitch=Math.max(-1.4,Math.min(-0.25,aerialPitch-(e.clientY-aerialLastY)*0.003));
  aerialLastX=e.clientX; aerialLastY=e.clientY;
}
function aerialTouchStart(e){const t=e.touches[0];aerialDragging=true;aerialLastX=t.clientX;aerialLastY=t.clientY;}
function aerialTouchMove(e){
  e.preventDefault();
  const t=e.touches[0];
  aerialYawOffset-=(t.clientX-aerialLastX)*0.004;
  aerialPitch=Math.max(-1.4,Math.min(-0.25,aerialPitch-(t.clientY-aerialLastY)*0.003));
  aerialLastX=t.clientX; aerialLastY=t.clientY;
}
window.toggleAerial=toggleAerial;

// Property detail panel — opens over the 3D world for any viewpoint with a productKey
// Contains: zone description, interior viewpoints, reservation option
function openPropertyPanel(key) {
  const PROPERTY_DATA = {
    villas: {
      title: 'Premium Villa — 3 Bedroom',
      type: 'Residential',
      area: '330 m²',
      price: 'Available on application',
      description: 'Three-storey polo-facing villa with two-car undercroft, full-height glazing on all floors, private landscaped garden, and direct views over the main polo field. Designed by ECAD Architecture.',
      features: ['Full-height glazing — polo field view','2-car undercroft parking','Private landscaped garden with hedges','Terrace on each floor','Residents polo membership included'],
      canReserve: true,
      interior: [
        { label:'Ground Floor — Living', pos:[-162,2,0],   yaw:Math.PI/2,  pitch:0,    caption:'Ground floor living — polo field ahead' },
        { label:'First Floor — Master',  pos:[-162,5.5,0], yaw:Math.PI/2,  pitch:-0.1, caption:'Master bedroom — elevated polo view' },
        { label:'Roof Terrace',          pos:[-162,9,0],   yaw:Math.PI/2,  pitch:-0.15,caption:'Roof terrace — panoramic estate view' },
        { label:'Garden — Approach',     pos:[-148,1.72,0],yaw:-Math.PI/2, pitch:0,    caption:'Private garden — looking back at your villa' },
      ],
    },
    clubhouse: {
      title: 'Club House',
      type: 'Social Anchor',
      area: '3,419 m²',
      price: 'Members only',
      description: 'Three-storey Clubhouse on the south edge of the polo field. VIP skyboxes on the upper levels, restaurant and bar at ground level, open terraces for match-day viewing.',
      features: ['8 VIP skyboxes','Full-service restaurant & bar','Terraced polo viewing','Members lounge','Event hosting capacity 500+'],
      canReserve: false,
      interior: [
        { label:'Ground Terrace',   pos:[0,4,148],  yaw:Math.PI,     pitch:-0.08, caption:'Clubhouse terrace — north toward the polo field' },
        { label:'Upper Skybox',     pos:[0,10,135], yaw:Math.PI,     pitch:-0.18, caption:'VIP skybox level — tournament day view' },
        { label:'Polo View — Full', pos:[0,4,80],   yaw:Math.PI,     pitch:0,     caption:'From mid-field looking south to the Clubhouse' },
      ],
    },
    stables: {
      title: 'Equestrian Stables',
      type: 'Equestrian Facility',
      area: '4 blocks · 56 stalls',
      price: 'Stall leases available',
      description: 'Four stable blocks with 14 stalls each, a veterinary facility, quarantine paddock, and cobblestone courtyard. The beating heart of polo operations at Project XIX.',
      features: ['56 individual stalls','On-site veterinary clinic','Cobblestone farrier yard','Groom quarters','Secure truck parking'],
      canReserve: true,
      interior: [
        { label:'Stable Approach',   pos:[-220,1.72,80], yaw:Math.PI/2, pitch:0,    caption:'Equestrian compound — stable blocks ahead' },
        { label:'Courtyard View',    pos:[-350,1.72,90], yaw:0,         pitch:0,    caption:'Cobblestone courtyard — between stable blocks' },
        { label:'From The Field',    pos:[-175,1.72,0],  yaw:-Math.PI/2,pitch:0,    caption:'Looking west toward the stables' },
      ],
    },
    training: {
      title: 'Training Field',
      type: 'Sporting Facility',
      area: '5,000 m²',
      price: 'Academy enrolment',
      description: 'Full-size practice polo field perpendicular to the main arena. Used by the Project XIX polo academy and for warm-up sessions on match days.',
      features: ['FIP yard markings','Polo academy coaching','North–south orientation','Separate from main field','Floodlight-ready'],
      canReserve: false,
      interior: [
        { label:'Training Field',    pos:[-175,1.72,0],  yaw:Math.PI/2, pitch:0, caption:'Training field — coaching sessions daily' },
        { label:'From Touch Line',   pos:[-260,1.72,-40],yaw:Math.PI/2, pitch:0, caption:'Touch line — full field view' },
      ],
    },
    lofts: {
      title: 'Loft Terrace Apartments',
      type: '2-Bedroom Loft',
      area: '125 m² per unit',
      price: 'Available on application',
      description: 'Ninety-six loft terrace apartments in two rows along the south precinct. Ground floor in natural gabion stone, upper floor in vertical timber slats and full-width glazing — tropical terrace living.',
      features: ['Full-width terrace per unit','Vertical timber facade','Gabion stone ground floor','Polo estate address','Strong rental yield potential'],
      canReserve: true,
      interior: [
        { label:'Loft Terrace — West',  pos:[-218,1.72,-5], yaw:-Math.PI/2, pitch:0, caption:'West compound loft terraces' },
        { label:'Looking South',        pos:[-155,1.72,-40],yaw:0,           pitch:0, caption:'South precinct — loft row ahead' },
      ],
    },
    paddock: {
      title: 'Paddock & Recreation',
      type: 'Family Amenity',
      area: '1,645 m²',
      price: 'Residents access',
      description: 'The east paddock with post-and-rail fencing for horse exercise, a game park, and a playground — the recreational heart of the east precinct.',
      features: ['Post-and-rail horse paddock','Game park','Playground area','Lakeside position','Residents-only access'],
      canReserve: false,
      interior: [
        { label:'Paddock View',    pos:[155,1.72,-60], yaw:-Math.PI/2, pitch:0, caption:'Northeast paddock — horses at exercise' },
        { label:'From East Road',  pos:[200,1.72,0],   yaw:-Math.PI/2, pitch:0, caption:'Looking west — paddock and polo field' },
      ],
    },
    lake_north: {
      title: 'Crescent Lake',
      type: 'Lifestyle Feature',
      area: '200m crescent',
      price: 'All north-arc villas',
      description: 'The crescent lake runs the full length of the north safety zone boundary, directly fronted by the north-arc premium villas. A natural centrepiece visible from the Clubhouse, the polo field, and every north-arc residence.',
      features: ['200m crescent water feature','Waterfront villa frontage','Polo field reflection','Private lake promenade','Resident exclusivity'],
      canReserve: false,
      interior: [
        { label:'Lake North Shore',  pos:[0,1.72,-108],    yaw:0,       pitch:-0.05, caption:'Crescent lake — north shore walk' },
        { label:'From Polo Field',   pos:[0,1.72,-50],     yaw:0,       pitch:-0.08, caption:'Looking north — lake and villas beyond' },
        { label:'West Lake End',     pos:[-80,1.72,-108],  yaw:Math.PI/2, pitch:0,  caption:'West end of the crescent lake' },
      ],
    },
    field_centre: {
      title: 'Main Polo Field',
      type: 'FIP International Standard',
      area: '274m × 146m',
      price: 'Match-day access',
      description: 'The central polo field is the gravitational core of Project XIX. FIP international standard, 30/40/60-yard markings, with the Clubhouse at the south end and the crescent lake to the north.',
      features: ['FIP international standard','274m × 146m','30/40/60 yard markings','Clubhouse south end','Match-day events'],
      canReserve: false,
      interior: [
        { label:'Centre Field',      pos:[0,1.72,0],       yaw:0,       pitch:0,     caption:'Halfway line — facing north toward the lake' },
        { label:'South Goal',        pos:[0,1.72,100],     yaw:Math.PI, pitch:0,     caption:'South goal line — Clubhouse behind you' },
        { label:'North Goal',        pos:[0,1.72,-100],    yaw:0,       pitch:0,     caption:'North goal — lake directly ahead' },
        { label:'Touch Line East',   pos:[130,1.72,0],     yaw:-Math.PI/2,pitch:0,   caption:'East touch line — full field view' },
      ],
    },
  };

  // Map bottom strip keys to property data keys
  const KEY_MAP = {
    'field_centre':'field_centre','field_south':'field_centre',
    'clubhouse':'clubhouse','lake_north':'lake_north',
    'villas':'villas','villa_west':'villas','villa_east':'villas','villa_north':'villas','villa_south':'villas',
    'stables':'stables','training':'training','lofts':'lofts','paddock':'paddock',
  };
  const propKey = KEY_MAP[key] || key;
  const data = PROPERTY_DATA[propKey];
  if (!data) { console.warn('[XIX] No property data for', key); return; }
  _showPropertyPanel(data, propKey);

  // Activate Bokeh DOF for interior or residence detail inspection
  if (['villas', 'lofts', 'clubhouse'].includes(propKey)) {
    if (typeof setInteriorDOF === 'function') setInteriorDOF(true, 3.5);
  }
}

function _showPropertyPanel(data, propKey) {
  // Remove any existing panel
  document.getElementById('xix-prop-panel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'xix-prop-panel';
  panel.style.cssText = `
    position:fixed; top:0; right:0; bottom:0; width:min(480px,100vw);
    background:rgba(6,14,8,0.97); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px);
    border-left:1px solid rgba(201,168,76,0.3); z-index:2000;
    display:flex; flex-direction:column; overflow:hidden;
    transform:translateX(100%); transition:transform .32s cubic-bezier(.22,.61,.36,1);
    font-family:Inter,sans-serif;
  `;

  // Interior viewpoint index
  let _intIdx = 0;
  const interior = data.interior || [];

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 20px 14px;border-bottom:1px solid rgba(201,168,76,0.15);flex-shrink:0;">
      <div>
        <div style="font-size:10px;color:rgba(201,168,76,0.7);letter-spacing:.12em;text-transform:uppercase;margin-bottom:4px;">${data.type}</div>
        <div style="font-size:1.25rem;font-weight:500;color:#f0ece0;font-family:'Cormorant Garamond',serif;">${data.title}</div>
      </div>
      <button id="pp-close-btn" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:50%;width:36px;height:36px;color:rgba(255,255,255,0.6);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">✕</button>
    </div>
    <div style="overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1;padding:0 0 40px;">
      <!-- Interior walkthrough section -->
      ${interior.length > 0 ? `
      <div style="background:rgba(201,168,76,0.06);border-bottom:1px solid rgba(201,168,76,0.12);padding:14px 20px;">
        <div style="font-size:10px;color:rgba(201,168,76,0.6);letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px;">Immersive Walkthrough</div>
        <div style="font-size:13px;color:rgba(240,236,224,0.75);margin-bottom:10px;">Experience each viewpoint in the 3D world</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${interior.map((vp,i)=>`
            <button data-vpidx="${i}" class="pp-vp-btn" style="
              background:rgba(255,255,255,0.05);border:1px solid rgba(201,168,76,0.25);
              border-radius:5px;padding:7px 12px;color:rgba(240,236,224,0.85);
              cursor:pointer;font-size:11px;font-family:Inter,sans-serif;
              transition:all .12s;-webkit-tap-highlight-color:transparent;min-height:36px;">
              ${vp.label}
            </button>
          `).join('')}
        </div>
      </div>` : ''}
      <!-- Specs -->
      <div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;">
          <div><div style="font-size:10px;color:rgba(201,168,76,0.6);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px;">Area</div><div style="font-size:15px;color:#f0ece0;font-weight:500;">${data.area}</div></div>
          <div><div style="font-size:10px;color:rgba(201,168,76,0.6);text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px;">Pricing</div><div style="font-size:13px;color:#f0ece0;">${data.price}</div></div>
        </div>
        <p style="font-size:13px;color:rgba(240,236,224,0.7);line-height:1.7;margin:0;">${data.description}</p>
      </div>
      <!-- Features -->
      <div style="padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:10px;color:rgba(201,168,76,0.6);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Key Features</div>
        ${data.features.map(f=>`
          <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:7px;">
            <span style="color:#c9a84c;font-size:12px;margin-top:2px;flex-shrink:0;">◆</span>
            <span style="font-size:13px;color:rgba(240,236,224,0.75);">${f}</span>
          </div>
        `).join('')}
      </div>
      <!-- CTA -->
      ${data.canReserve ? `
      <div style="padding:16px 20px;">
        <div style="font-size:10px;color:rgba(201,168,76,0.6);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Reserve Your Plot</div>
        <button id="pp-reserve-btn" style="
          width:100%;background:rgba(201,168,76,0.88);color:#061208;border:none;
          border-radius:6px;padding:14px;font-size:14px;font-weight:600;cursor:pointer;
          font-family:Inter,sans-serif;letter-spacing:.04em;transition:background .15s;margin-bottom:10px;">
          Register Interest
        </button>
        <a href="mailto:o.olasunkanmi@mixtafrica.com?subject=Project XIX — ${encodeURIComponent(data.title)} Enquiry" style="
          display:block;text-align:center;padding:12px;border:1px solid rgba(201,168,76,0.3);
          border-radius:6px;color:rgba(201,168,76,0.8);font-size:13px;letter-spacing:.04em;text-decoration:none;">
          Email the Project Team
        </a>
      </div>` : `
      <div style="padding:16px 20px;">
        <a href="mailto:o.olasunkanmi@mixtafrica.com?subject=Project XIX — ${encodeURIComponent(data.title)} Enquiry" style="
          display:block;text-align:center;padding:14px;background:rgba(201,168,76,0.88);
          border-radius:6px;color:#061208;font-size:14px;font-weight:600;letter-spacing:.04em;text-decoration:none;">
          Make an Enquiry
        </a>
      </div>`}
    </div>
  `;

  document.getElementById('world-overlay')?.appendChild(panel);
  // Animate in
  requestAnimationFrame(() => panel.style.transform = 'translateX(0)');

  // Close
  panel.querySelector('#pp-close-btn')?.addEventListener('click', () => {
    panel.style.transform = 'translateX(100%)';
    
    // Reset DOF back to global free-roam clarity when panel closes
    if (typeof setInteriorDOF === 'function') setInteriorDOF(false);

    setTimeout(() => panel.remove(), 340);
    _stopPlotHighlightPulse?.();
  });

  // Interior viewpoint buttons — teleport camera to each position
  panel.querySelectorAll('.pp-vp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.vpidx, 10);
      const vp = interior[idx];
      if (!vp) return;
      // Highlight active
      panel.querySelectorAll('.pp-vp-btn').forEach(b => b.style.borderColor = 'rgba(201,168,76,0.25)');
      btn.style.borderColor = '#c9a84c';
      btn.style.color = '#c9a84c';
      // Teleport to interior position
      try {
        setView(vp.pos, vp.yaw || 0, vp.pitch || 0);
        setCaption(vp.caption || vp.label);
        // Ensure walk mode for interior exploration
        if (moveMode === 'ride' || aerialOrbit) window.setMoveMode('walk');
      } catch(e) { console.warn('[XIX] Interior teleport:', e); }
    });
  });

  // Reserve button
  panel.querySelector('#pp-reserve-btn')?.addEventListener('click', () => {
    const reserveSection = panel.querySelector('#pp-reserve-btn').parentNode;
    reserveSection.innerHTML = `
      <div style="background:rgba(30,80,30,0.25);border:1px solid rgba(100,200,80,0.3);border-radius:6px;padding:16px;text-align:center;">
        <div style="color:#8cde6a;font-size:20px;margin-bottom:8px;">✓</div>
        <div style="color:#f0ece0;font-weight:600;margin-bottom:4px;">Interest Registered</div>
        <div style="color:rgba(240,236,224,0.6);font-size:12px;">Our team will contact you within 24 hours.</div>
      </div>`;
  });
}

function teleportTo(key, vp){
  try {
    // vp may be a subView (has pos) or just a key reference (look up in VIEWPOINTS)
    const resolved = (vp && vp.pos) ? vp : (VIEWPOINTS[key] || null);
    if (!resolved || !Array.isArray(resolved.pos) || resolved.pos.length < 3) {
      console.warn('[XIX] teleportTo: bad viewpoint for key', key, resolved);
      return;
    }
    setView(resolved.pos, resolved.yaw || 0, resolved.pitch || 0);
    setCaption(resolved.caption || key);
    // Restore Y for current ground mode after teleport
    const cam = getCamera();
    if (moveMode !== 'aerial') {
      const eyeY = (moveMode === 'ride') ? 3.10 : 1.72;
      cam.position.y = eyeY;
      _currentEyeY = eyeY;
      _targetEyeY  = eyeY;
    }
    if (resolved.zoneKey) showZonePanel(resolved.zoneKey); else hideZonePanel();
  } catch(err) {
    console.error('[XIX] teleportTo error:', err);
  }
}

//           EXIT
function bindExitButton(){
  document.getElementById("btn-close-world")?.addEventListener("click",closeWorld,{capture:true});
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"&&document.getElementById("world-overlay")?.classList.contains("open")){
      // Safeguard: Reset DOF to crisp focus when hitting Escape
      if (typeof setInteriorDOF === 'function') setInteriorDOF(false);

      if(document.pointerLockElement) document.exitPointerLock();
      else closeWorld();
    }
  });
}

function closeWorld(){
  // Safeguard: Reset DOF when fully exiting the 3D overlay
  if (typeof setInteriorDOF === 'function') setInteriorDOF(false);

  deactivate(); hideJoystick();
  document.getElementById("world-overlay")?.classList.remove("open");
  document.getElementById("plot-panel")?.classList.remove("visible");
  document.body.style.overflow="";
  if(animFrameId){cancelAnimationFrame(animFrameId);animFrameId=null;}
  window.removeEventListener("resize",resizeWorld);
}

//           RENDER LOOP
function startRenderLoop(){
  if(animFrameId) cancelAnimationFrame(animFrameId);
  const clock=getClock();
  const startTime=performance.now();

  // Track consecutive errors — if too many, stop the loop gracefully
  let _frameErrors = 0;

  function frame(){
    animFrameId=requestAnimationFrame(frame);
    try {
    const delta=Math.min(clock.getDelta(),0.033);
    const elapsed=(performance.now()-startTime)/1000;
    const camera=getCamera();
    if (!camera) return; // scene not ready yet

    if(aerialOrbit){
      aerialAngle += AERIAL_SPEED * delta;
      const totalAngle = aerialAngle + aerialYawOffset;
      // Spherical orbit: user pitch controls tilt (aerialPitch: -1.4 steep to -0.25 shallow)
      // Clamp so camera never goes below horizon or flips through nadir
      const elevAngle = Math.max(0.22, Math.min(1.35, -aerialPitch)); // radians from zenith
      const R_ground = 260 * Math.sin(elevAngle); // horizontal radius
      const H_pos    = 260 * Math.cos(elevAngle); // camera height
      camera.position.x = Math.sin(totalAngle) * R_ground;
      camera.position.z = Math.cos(totalAngle) * R_ground;
      camera.position.y = Math.max(30, H_pos);   // never below 30m
      // lookAt estate centre — always correct, no gimbal issues at these angles
      camera.lookAt(0, 0, 0);
    } else {
      updateControls(delta);

      // Eye height: ONLY in ride mode. Walk mode: controls.js owns Y completely.
      // This was the source of camera shake — two systems fighting Y every frame.
      if (moveMode === 'ride') {
        _currentEyeY += (_targetEyeY - _currentEyeY) * Math.min(delta * 8, 1);
        camera.position.y = _currentEyeY;
      }

      // Detect movement for animation speed
      const moved = Math.abs(camera.position.x - _prevCamX) > 0.008 ||
                    Math.abs(camera.position.z - _prevCamZ) > 0.008;
      _prevCamX = camera.position.x;
      _prevCamZ = camera.position.z;

      // Horse: direct reference via exported getter — O(1), no scene walk
      const _horseRoot = getHorseGroup();

      if (moveMode === 'ride') {
        if (_horseRoot) _horseRoot.visible = true;
        // Place horse at camera XZ on true ground. Camera sits at rider eye height.
        // Horse faces the direction of travel (same as camera yaw).
        if (typeof setHorsePosition === 'function') {
          setHorsePosition(camera.position.x, camera.position.z, camera.rotation.y);
        }
        if (typeof tickHorseAnim === 'function') tickHorseAnim(delta, moved);
      } else {
        if (_horseRoot) _horseRoot.visible = false;
      }
    }

    tickScene(elapsed,camera);
    tickDayCycle(elapsed);  // Auto day/night cycle
    updateMinimap(camera.position.x,camera.position.z,getYaw());
    updateSpatialAudio(camera.position.x,camera.position.z);
    renderFrame();
    _frameErrors = 0; // reset on successful frame
    } catch(err) {
      _frameErrors++;
      console.error('[XIX] frame error #' + _frameErrors + ':', err);
      // After 10 consecutive errors, stop gracefully rather than crashing iOS
      if (_frameErrors > 10) {
        cancelAnimationFrame(animFrameId);
        animFrameId = null;
        console.error('[XIX] Render loop stopped after too many errors. Tap screen to restart.');
        // Show a non-intrusive restart nudge
        const nudge = document.createElement('div');
        nudge.style.cssText = 'position:fixed;bottom:50%;left:50%;transform:translate(-50%,50%);background:rgba(10,20,12,0.92);color:#c9a84c;padding:16px 24px;border-radius:8px;font-family:Inter,sans-serif;font-size:14px;z-index:9999;cursor:pointer;border:1px solid rgba(201,168,76,0.4);';
        nudge.textContent = 'Tap to resume';
        nudge.onclick = () => { nudge.remove(); startRenderLoop(); };
        document.getElementById('world-overlay')?.appendChild(nudge);
      }
    }
  }

  frame();
}

function resizeWorld(){
  const renderer=getRenderer(), camera=getCamera();
  if(!renderer||!camera) return;
  const canvas=document.getElementById("world-canvas");
  const w=canvas.parentElement.clientWidth, h=canvas.parentElement.clientHeight;
  renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix();
  resizeComposer(w,h);
}

//           SCROLL ANIM
function bindSectionScrollAnim(){
  const io=new IntersectionObserver(entries=>{
    entries.forEach(e=>{if(e.isIntersecting) e.target.classList.add("in-view");});
  },{threshold:0.12});
  document.querySelectorAll(".anim-fade").forEach(el=>io.observe(el));
}

//           VILLA INTERIOR
function bindVillaInteriorBtn(){
  document.addEventListener("click",e=>{
    const enterBtn=e.target.closest(".residence-card-btn");
    const card=enterBtn?.closest(".residence-card");
    if(enterBtn&&card?.querySelector(".residence-card-type")?.textContent?.includes("3 Bed")){
      openVillaInterior(); return;
    }
    const tab=e.target.closest(".plan-tab");
    if(tab){
      document.querySelectorAll(".plan-tab").forEach(t=>t.classList.remove("active"));
      tab.classList.add("active");
      document.querySelectorAll(".plan-rooms").forEach(r=>r.classList.add("hidden"));
      document.getElementById("plan-"+tab.dataset.plan)?.classList.remove("hidden");
      return;
    }
    const room=e.target.closest(".plan-room");
    if(room?.dataset.key){
      teleportVillaTo(room.dataset.key);
      document.querySelectorAll(".plan-room").forEach(r=>r.classList.remove("active"));
      room.classList.add("active");
    }
  });
  document.getElementById("btn-close-villa")?.addEventListener("click",closeVillaInterior,{capture:true});
}

function openVillaInterior(){
  const overlay=document.getElementById("villa-overlay");
  if(!overlay) return;
  overlay.classList.add("open");
  document.body.style.overflow="hidden";
  if(!villaScene){
    const canvas=document.getElementById("villa-canvas");
    if(!canvas) return;
    villaRenderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:"high-performance"});
    villaRenderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
    villaRenderer.shadowMap.enabled=true;
    villaRenderer.shadowMap.type=THREE.PCFSoftShadowMap;
    villaRenderer.toneMapping=THREE.ACESFilmicToneMapping;
    villaRenderer.toneMappingExposure=1.1;
    villaRenderer.outputColorSpace=THREE.SRGBColorSpace;
    villaScene=new THREE.Scene();
    villaScene.background=new THREE.Color(0x7ab4d4);
    villaScene.fog=new THREE.FogExp2(0x9ac5d4,0.006);
    buildVillaInterior(villaScene);
  }
  teleportVillaTo("approach");
  activate(); resizeVilla();
  window.addEventListener("resize",resizeVilla);
  startVillaLoop(); buildVillaStrip();
}

function closeVillaInterior(){
  document.getElementById("villa-overlay")?.classList.remove("open");
  document.body.style.overflow="";
  deactivate();
  window.removeEventListener("resize",resizeVilla);
  if(villaAnimId){cancelAnimationFrame(villaAnimId);villaAnimId=null;}
}

let villaAnimId=null;

function startVillaLoop(){
  if(villaAnimId) cancelAnimationFrame(villaAnimId);
  const cam=getCamera();
  function frame(){
    villaAnimId=requestAnimationFrame(frame);
    const delta=Math.min(getClock().getDelta(),0.033);
    updateControls(delta);
    if(villaRenderer&&villaScene) villaRenderer.render(villaScene,cam);
  }
  frame();
}

function resizeVilla(){
  const canvas=document.getElementById("villa-canvas");
  if(!canvas||!villaRenderer) return;
  const w=canvas.parentElement.clientWidth, h=canvas.parentElement.clientHeight;
  villaRenderer.setSize(w,h);
  const cam=getCamera(); cam.aspect=w/h; cam.updateProjectionMatrix();
}

function teleportVillaTo(key){
  const vp=VILLA_VIEWPOINTS.find(v=>v.key===key); if(!vp) return;
  setView(vp.pos,vp.yaw,0); setCaption(vp.caption||vp.label);
  document.querySelectorAll(".vp-floor-btn").forEach(b=>b.classList.toggle("active",b.dataset.key===key));
}

function buildVillaStrip(){
  const strip=document.getElementById("villa-vp-strip"); if(!strip) return;
  strip.innerHTML="";
  VILLA_VIEWPOINTS.forEach(vp=>{
    const btn=document.createElement("button");
    btn.className="vp-btn vp-floor-btn"; btn.dataset.key=vp.key;
    btn.innerHTML=`<span class="vp-label">${vp.label}</span>`;
    btn.addEventListener("click",()=>teleportVillaTo(vp.key));
    strip.appendChild(btn);
  });
}
