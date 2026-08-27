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

import { VIEWPOINTS, ZONES, WORLD } from "./data.js?v=31";
// villa-interior.js removed — dead file, superseded by interior.js
import {
  initScene, getRenderer, getScene, getCamera, getClock,
  tickScene, updateSky, updateSkyForTime, plotRegistry, reservePlot, getPlotAtRay,
  highlightPlot, setPerfMode, PERF_MODE,
  RIDER_EYE_HEIGHT, FOOT_EYE_HEIGHT, tickHorse, tickHorseAnim,
  setHorsePosition, getThirdPersonCameraOffset, setAerialMode,
  getSunLight, getHorseGroup, updateNightLights, updateBuildingNightGlow,
  enterVillaInterior, teleportVillaRoom, exitVillaInterior,
} from "./scene.js?v=31";
import { initPostProcessing, resizeComposer, renderFrame, setBloomForTime, setPerfModeGraphics, setInteriorDOF, setWeatherBloomModifier, setFieldWetness } from "./graphics.js?v=31";
import {
  initControls, activate, deactivate, setView, updateControls, getYaw,
  requestGyro, enterVR, setYOwner
} from "./controls.js?v=31";
import {
  initMinimap, updateMinimap,
  buildViewpointStrip, showZonePanel, hideZonePanel,
  showLoading, hideLoading, setLoadingProgress,
  setCaption as _setCaption_raw, showEnterPrompt, hideEnterPrompt,
  showVRButton, showJoystick, hideJoystick, isMobile,
  enableAudio, updateSpatialAudio, initAudio
} from "./ui.js?v=31";

window.plotRegistry = plotRegistry;

function _findAnyVillaPlotKey() {
  for (const [key, plot] of plotRegistry) if (plot.type === '3 BED VILLA') return key;
  return null;
}
const _INTERIOR_TYPE_TO_PLOT_TYPE = {
  villa: '3 BED VILLA', loft: '2 BED LOFT TERRACE', apartment: '2 Bed Flat Block (24 units)',
};
window._xixFindAnyPlot = function(interiorType) {
  const wantType = _INTERIOR_TYPE_TO_PLOT_TYPE[interiorType];
  if (!wantType) return null;
  for (const [key, plot] of plotRegistry) if (plot.type === wantType) return key;
  return null;
};

function _buildInteriorRoomStrip(rooms, activeKey) {
  const strip = document.getElementById('int-room-strip');
  if (!strip) return;
  strip.innerHTML = '';
  rooms.forEach(room => {
    const btn = document.createElement('button');
    btn.className = 'int-room-btn' + (room.key === activeKey ? ' active' : '');
    btn.dataset.key = room.key;
    btn.innerHTML = `<span class="irb-label">${room.label}</span><span class="irb-sub">${room.sublabel}</span>`;
    btn.addEventListener('click', () => {
      const result = teleportVillaRoom(room.key);
      if (!result) return;
      setView(result.view.pos, result.view.yaw, result.view.pitch);
      strip.querySelectorAll('.int-room-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const overlay = document.getElementById('interior-overlay');
      overlay?.querySelector('.int-room-label')?.replaceChildren(document.createTextNode(result.room.label));
      overlay?.querySelector('.int-room-hint')?.replaceChildren(document.createTextNode(result.room.hint || result.room.sublabel));
    });
    strip.appendChild(btn);
  });
}

// The one real entry point for every "Step Inside" / "Walk through" button.
// plotKey is optional — omit it (or pass one that isn't a real villa) to get
// a representative real villa instead, for entry points that were never
// tied to a specific building (the marketing page, the toolbar zone panel).
// plotKey may be a villa, loft, or apartment plot — enterVillaInterior derives
// the correct room catalogue from that plot's real registered type. Falls
// back to a representative real villa only if no plotKey (or an invalid one)
// was given at all, which previously silently discarded any loft/apartment
// key passed in and always opened a villa regardless — a real bug fixed here
// alongside the wider integration.
window.stepInsideVilla = function(plotKey) {
  let key = (plotKey && plotRegistry.get(plotKey)) ? plotKey : null;
  if (!key) key = _findAnyVillaPlotKey();
  if (!key) { console.warn('[XIX] stepInsideVilla: no plot available'); return; }

  const result = enterVillaInterior(key, null);
  if (!result) return;

  if (typeof setMoveMode === 'function') setMoveMode('walk');
  setView(result.view.pos, result.view.yaw, result.view.pitch);

  const overlay = document.getElementById('interior-overlay');
  overlay?.querySelector('.int-building-name')?.replaceChildren(document.createTextNode(result.buildingName));
  overlay?.querySelector('.int-room-label')?.replaceChildren(document.createTextNode(result.room.label));
  overlay?.querySelector('.int-room-hint')?.replaceChildren(document.createTextNode(result.room.hint || result.room.sublabel));
  _buildInteriorRoomStrip(result.rooms, result.room.key);

  overlay?.classList.add('open');
  document.body.classList.add('interior-open');
  if (typeof activate === 'function') activate();
};

window.exitVillaWalkthrough = function() {
  exitVillaInterior();
  document.getElementById('interior-overlay')?.classList.remove('open');
  document.body.classList.remove('interior-open');
  if (typeof setMoveMode === 'function') setMoveMode('ride');
};
document.getElementById('int-exit-btn')?.addEventListener('click', () => window.exitVillaWalkthrough());

// ── setCaption filter — must come after imports so _setCaption_raw is resolved ──
// Suppresses stale captions from data.js (e.g. "Drag right to look")
const _BAD_CAPTIONS = new Set([
  'Drag right to look', 'drag to look', 'Click to look',
  'field_centre', 'field_south', 'lake_north', 'stables', 'training', 'lofts', 'paddock',
]);
function setCaption(text) {
  if (!text || _BAD_CAPTIONS.has(text.trim())) { _setCaption_raw(''); return; }
  _setCaption_raw(text);
}

//           STATE
let sceneReady      = false;
let introPlaying    = false;
window.currentViewKey = 'field_centre'; // Exposed globally
let animFrameId     = null;
let composer        = null;
let moveMode        = 'walk';

// Aerial orbit state
let aerialOrbit     = false;
let aerialAngle     = 0;
let aerialYawOffset = 0;
let aerialPitch     = -0.685;
let aerialDragging  = false;
let aerialLastX     = 0;
let aerialLastY     = 0;
const AERIAL_SPEED  = 0.08; // radians/sec

// Eye-height smoothing (ride mode only)
let _currentEyeY    = 1.72;
let _targetEyeY     = 1.72;

// Previous camera position (for horse animation)
let _prevCamX       = 0;
let _prevCamZ       = 0;

// ── AUTO DAY CYCLE & WEATHER (Linear 12-Hour) ──────────────────────────────────
const DAY_CYCLE_DURATION = 5 * 60; // 5 minutes real-time per full day loop
let   _dayAutoRun  = true;   
let   _dayPauseEnd = 0;      
let   _lastDayApplied = '';  
let   _currentWeather = 'clear';

function tickDayCycle(elapsed) {
  if (!_dayAutoRun) return;
  if (performance.now() < _dayPauseEnd) return;

  const phase = (elapsed % DAY_CYCLE_DURATION) / DAY_CYCLE_DURATION; 
  // Map 0.0 -> 1.0 phase smoothly from 6:00 AM to 6:00 AM the next day
  const currentHourDec = 6 + (phase * 24);
  const hr24 = Math.floor(currentHourDec) % 24;
  const mins = Math.floor((currentHourDec % 1) * 60);

  let name = 'afternoon';
  if (hr24 >= 6 && hr24 < 10) name = 'morning';
  else if (hr24 >= 10 && hr24 < 17) name = 'afternoon';
  else if (hr24 >= 17 && hr24 < 19) name = 'sunset';
  else name = 'night';

  if (name !== _lastDayApplied) {
    _lastDayApplied = name;
    applyTimePreset(name, true);
  }

  if (window._updateDayClock) window._updateDayClock(hr24, mins, name);
}

const TIME_PRESETS = {
  morning:   { sky:["#1e3a5a","#7aaac8","#4a7a38"], sunCol:0xffd080, sunInt:1.3, sunPos:[-80,55,-80],   fog:"#8ab8cc", fogD:0.00018, exp:0.72 },
  afternoon: { sky:["#1a3a6a","#5a9acc","#3a6a30"], sunCol:0xffe8b0, sunInt:1.6, sunPos:[-160,160,100], fog:"#8ab8cc", fogD:0.00014, exp:0.78 }, // was 2.2/1.02 — kills the overexposed glare
  sunset:    { sky:["#0a1830","#c84818","#4a2a10"], sunCol:0xff8030, sunInt:1.3, sunPos:[-100,28,60],   fog:"#c06040", fogD:0.00022, exp:0.88 },
  night:     { sky:["#000508","#020a14","#050a08"], sunCol:0x304870, sunInt:0.10,sunPos:[0,40,-80],     fog:"#020810", fogD:0.00035, exp:0.48 },
};

function applyTimePreset(name, fromWeather = false) {
  const p = TIME_PRESETS[name]; if (!p) return;
  if (!fromWeather) {
    _dayPauseEnd = performance.now() + 120_000;
    document.querySelectorAll(".wx-time-btn").forEach(b => b.classList.toggle("active", b.dataset.time === name));
  }

  // Calculate strict weather modifiers
  let fogMult = 1, sunMult = 1;
  if (_currentWeather === 'clear')  { fogMult = 0.05; sunMult = 1.0; } // Almost zero fog
  if (_currentWeather === 'cloudy') { fogMult = 2.0;  sunMult = 0.5; }
  if (_currentWeather === 'rain')   { fogMult = 5.0;  sunMult = 0.1; } // Heavy fog, dim sun

  try { if (typeof updateSkyForTime === 'function') updateSkyForTime(name); } catch(e){}
  try { setBloomForTime(name); } catch(e){}
  try { if (typeof updateNightLights === 'function') updateNightLights(name); } catch(e){}
  try { if (typeof updateBuildingNightGlow === 'function') updateBuildingNightGlow(name); } catch(e){}

  const sc = getScene();
  if (sc && sc.fog) {
    sc.fog.color.set(p.fog);
    _currentFogD = p.fogD * fogMult;
    sc.fog.density = _fogEnabled ? _currentFogD : 0.000001;
  }
  
  const _sun = typeof getSunLight === 'function' ? getSunLight() : null;
  if (_sun) {
    _sun.color.setHex(p.sunCol);
    _sun.intensity = p.sunInt * sunMult; 
    _sun.position.set(...p.sunPos);
  }
  const r = getRenderer();
  if (r) r.toneMappingExposure = p.exp;
}

function applyWeather(w) {
  _currentWeather = w;
  window._currentWeather = w; // Expose globally for scene.js
  document.querySelectorAll(".wx-weather-btn").forEach(b => b.classList.toggle("active", b.dataset.weather === w));

  let bloomMult = 1;
  if (w === 'clear')  bloomMult = 0.2;
  if (w === 'cloudy') bloomMult = 0.5;
  if (w === 'rain')   bloomMult = 0.1;

  const sc = getScene();
  if (sc && sc.fog) {
    sc.fog.density = (w === 'clear') ? 0.000008 : (w === 'cloudy' ? 0.00035 : 0.00085);
  }

  // Drive polo field + lake wetness shader uniform (0 = dry, 1 = soaked)
  // Both lerp smoothly toward this value in tickScene — no harsh snap
  const wetnessMap = { clear: 0.0, cloudy: 0.2, rain: 0.85 };
  const wetnessVal = wetnessMap[w] || 0.0;
  if (typeof setFieldWetness === 'function') setFieldWetness(wetnessVal);
  // Sync palm wind strength with weather — rain increases gusts
  if (window._xixPalmUniforms) {
    const baseWind = { clear:0.65, cloudy:0.85, rain:1.0 }[w] || 0.65;
    window._xixPalmUniforms.uWindStr.value = baseWind;
  }
  // Lake + road wetness: tickScene lerps toward window._xixWetness

  if (typeof setWeatherBloomModifier === 'function') setWeatherBloomModifier(bloomMult);
  if (_lastDayApplied) applyTimePreset(_lastDayApplied, true);
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

// ── DAY CLOCK: 12-Hour format & Line Art ──────────────────────────────────────
function injectDayClock() {
  if (document.getElementById('day-clock')) return;
  const s = document.createElement('style');
  s.textContent = `
    #day-clock { position: absolute; top: 54px; left: 50%; transform: translateX(-50%); z-index: 200; background: rgba(8,18,10,0.72); backdrop-filter: blur(8px); border: 1px solid rgba(201,168,76,0.25); border-radius: 20px; padding: 5px 16px; display: flex; align-items: center; gap: 8px; font-family: Inter, sans-serif; font-size: 12px; color: rgba(240,236,224,0.85); pointer-events: none; transition: opacity .4s; white-space: nowrap; }
    #day-clock .clock-icon { display:flex; align-items:center; }
    #day-clock .clock-time { font-variant-numeric: tabular-nums; letter-spacing:.05em; }
    #day-clock .clock-label { color: rgba(201,168,76,0.75); font-size:10px; letter-spacing:.1em; }
    @media(max-width:640px){ #day-clock { top: 48px; font-size:10px; padding:4px 12px; } }
  `;
  document.head.appendChild(s);

  const el = document.createElement('div');
  el.id = 'day-clock';
  el.innerHTML = '<span class="clock-icon"></span><span class="clock-time">12:00 PM</span><span class="clock-label">AFTERNOON</span>';
  document.getElementById('world-overlay')?.appendChild(el);

  const lineIcons = {
    morning: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/><circle cx="12" cy="12" r="4"/></svg>',
    afternoon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="5"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>',
    sunset: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 8a4 4 0 0 1 4 4H8a4 4 0 0 1 4-4zM2 16h20M12 2v2M4.2 4.2l1.4 1.4M19.8 4.2l-1.4 1.4"/></svg>',
    night: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
  };

  window._updateDayClock = function(hr24, mins, phaseName) {
    if (!el) return;
    const isPM = hr24 >= 12;
    const hr12 = (hr24 % 12) || 12; 
    const timeStr = `${hr12}:${mins.toString().padStart(2, '0')} ${isPM ? 'PM' : 'AM'}`;
    
    el.querySelector('.clock-icon').innerHTML = lineIcons[phaseName] || lineIcons.afternoon;
    el.querySelector('.clock-time').textContent = timeStr;
    el.querySelector('.clock-label').textContent = (phaseName || '').toUpperCase();
  };
}

// ── MODE TOGGLE: Walk / Aerial ─────────────────────────────────────────
function injectModeToggle() {
  if (document.getElementById('mode-toggle-bar')) return;
  const style = document.createElement('style');
  style.textContent = `
    /* ── Mode toggle: bottom-right, clear of joystick (bottom-left) ── */
    #mode-toggle-bar {
      position: absolute;
      bottom: 90px;        
      right: 12px;
      left: auto;
      transform: none;
      z-index: 210;
      display: flex;
      flex-direction: column; 
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
  bar.innerHTML = `
    <button class="move-mode-btn active" data-mode="walk"
      onclick="window.setMoveMode('walk')" aria-label="Walk mode">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="5" r="2"/><path d="M12 7v7"/><path d="M9 19l3-5 3 5"/><path d="M8 10h8"/>
      </svg>
      Walk
    </button>
    <div class="mode-divider"></div>
    <button class="move-mode-btn" data-mode="aerial"
      onclick="window.setMoveMode('aerial')" aria-label="Aerial view">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M22 12A10 10 0 0 0 12 2a10 10 0 0 0 0 20 10 10 0 0 0 10-10z"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/><path d="M2 12h20"/>
      </svg>
      Aerial
    </button>
  `;
  document.getElementById('world-overlay')?.appendChild(bar);
}

window.switchPerfMode = function(mode) {
  setPerfMode(mode);          // updates scene (shadow map, pixel ratio, fog)
  setPerfModeGraphics(mode);  // updates graphics pipeline (bloom, SMAA, direct render)
  document.querySelectorAll('.perf-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
};

window.setMoveMode = function(mode) {
  if (mode === 'aerial') {
    if (!aerialOrbit) toggleAerial(null);
    return;
  }
  // Exiting aerial
  if (aerialOrbit) toggleAerial(null);
  moveMode = mode;
  document.querySelectorAll('.move-mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode)
  );
  const eyeY = (mode === 'ride') ? 3.10 : 1.72;
  _targetEyeY = eyeY;
  if (typeof setYOwner === 'function') setYOwner(mode === 'ride' ? 'app' : 'controls');
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
    window.openWorldAt = openWorldAt; // Allows HTML buttons to trigger world entry

  window.__moduleReady = Object.assign(window.__moduleReady || {}, {
    applyTimePreset, applyWeather, toggleAerial, rotateVillaGLB: window.rotateVillaGLB,
    switchPerfMode: window.switchPerfMode,
    openWorldAt, // Available to other modules
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

  // ─── MASTER UI CLOSER ───────────────────────────────────────────────────────
  // Guarantees topbar and viewpoint dropdowns close when clicking outside
  document.addEventListener('pointerdown', (e) => {
    // Topbar: close touch-mode menus (desktop uses :hover, unaffected)
    if (!e.target.closest('.topbar-dropdown')) {
      document.querySelectorAll('.topbar-dropdown.tb-open')
              .forEach(d => d.classList.remove('tb-open'));
    }
    // Viewpoint strip: ui.js appends .vp-dropdown to document.body, so a menu
    // ITEM is NOT inside .vp-wrapper. Checking only .vp-wrapper meant pointerdown
    // hid the menu before the item's click could fire — which is why the villa
    // sub-items appeared unclickable. Must exclude .vp-dropdown as well.
    if (!e.target.closest('.vp-wrapper') && !e.target.closest('.vp-dropdown')) {
      document.querySelectorAll('.vp-dropdown').forEach(m => m.style.display = 'none');
      document.querySelectorAll('.vp-chevron').forEach(ch => ch.innerHTML = '&#9652;');
    }
  }, { passive: true });
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

// ─── PHASE 4: PERSISTENT VILLA AVAILABILITY OVERLAYS (ULTRA-OPTIMIZED) ───
window._sharedBadgeMats = null;

function buildVillaStatusOverlays() {
  const sc = getScene();
  if (!sc) return;

  // 1. Create the canvases exactly ONCE to save 99% of mobile RAM
  if (!window._sharedBadgeMats) {
    const createMat = (isAvail) => {
      const canvas = document.createElement('canvas');
      canvas.width = 160; canvas.height = 48;
      const ctx = canvas.getContext('2d');
      // Fill first, then stroke with the path INSET by 1px so the full
      // stroke width sits inside the fill — eliminates the ghost outer
      // rectangle that appeared at distance as a second crossing frame.
      ctx.fillStyle = isAvail ? 'rgba(6,18,8,0.88)' : 'rgba(28,10,10,0.88)';
      ctx.beginPath(); ctx.roundRect(2, 2, 156, 44, 10); ctx.fill();
      ctx.strokeStyle = isAvail ? '#C9A84C' : 'rgba(220,70,70,0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.roundRect(3, 3, 154, 42, 9); ctx.stroke();
      ctx.fillStyle = isAvail ? '#C9A84C' : '#ff6666';
      ctx.font = 'bold 15px Inter, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(isAvail ? 'AVAILABLE' : 'RESERVED', 80, 24);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      return new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true });
    };
    window._sharedBadgeMats = { avail: createMat(true), res: createMat(false) };
  }

  // 2. Pre-compute apartment type counts for cluster badges
  const _aptCounts = {};
  plotRegistry.forEach((plot, plotKey) => {
    if (!plot.isApt || plot.x === undefined) return;
    const key = plot.type + '_' + plot.x + '_' + plot.z;
    if (!_aptCounts[key]) _aptCounts[key] = { type: plot.type, x: plot.x, z: plot.z, total: 0, reserved: 0, badgeDone: false };
    _aptCounts[key].total++;
    if (plot.status === 'reserved') _aptCounts[key].reserved++;
  });

  // Build cluster badges for apartment types
  Object.values(_aptCounts).forEach(cluster => {
    if (cluster.badgeDone) return;
    cluster.badgeDone = true;
    const label = `${cluster.reserved}/${cluster.total} reserved`;
    const typeShort = cluster.type.replace('BED ', '').replace(' MAISONETTE', ' MAIS.');
    const canvas = document.createElement('canvas');
    canvas.width = 220; canvas.height = 56;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(6,18,8,0.88)';
    ctx.beginPath(); ctx.roundRect(2,2,216,52,10); ctx.fill();
    ctx.strokeStyle = 'rgba(201,168,76,0.6)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#C9A84C';
    ctx.font = 'bold 13px Inter, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(typeShort, 110, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText(label, 110, 38);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.88, depthWrite: false, sizeAttenuation: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(7, 1.8, 1);
    // Offset each type vertically to avoid overlap
    const yOffset = cluster.type.includes('FLAT') ? 12 : cluster.type.includes('MAIS') ? 14 : 10;
    sprite.position.set(cluster.x, yOffset, cluster.z);
    sc.add(sprite);
  });

  // 3. Apply shared materials to all physical individual plots (villas + lofts)
  plotRegistry.forEach((plot, plotKey) => {
    // Skip abstract apartment units — handled above as cluster badges
    if (plot.isApt) return;
    if (plot.x === undefined || plot.z === undefined) return;
    if (plot.badgeSprite) return; // Already built

    const isAvail = plot.status === 'available';
    const sprite = new THREE.Sprite(isAvail ? window._sharedBadgeMats.avail : window._sharedBadgeMats.res);

    sprite.scale.set(5.5, 1.6, 1);
    sprite.position.set(plot.x, 7.0, plot.z); // 7m — just above roofline
    sprite.userData = { isPlotBadge: true, plotKey };
    
    sc.add(sprite);
    plot.badgeSprite = sprite; // Store reference for fast updates
  });
}

window.updatePlotBadge = function(plotKey, status) {
  const plot = typeof plotRegistry !== 'undefined' ? plotRegistry.get(plotKey) : null;
  if (!plot || !plot.badgeSprite || !window._sharedBadgeMats) return;
  
  // Instantly swap the shared material without drawing new canvases
  const isRes = status === 'RESERVED';
  plot.badgeSprite.material = isRes ? window._sharedBadgeMats.res : window._sharedBadgeMats.avail;
};

//           PLOT SYSTEM (INFINITY MODEL)
function bindPlotSystem() {
  const canvas = document.getElementById("world-canvas");
  if (!canvas) return;

  let _isDragging = false;
  let _dragStartX = 0;
  let _dragStartY = 0;
  let _lastHoverTime = 0;

  canvas.addEventListener("pointerdown", e => { 
    _isDragging = false;
    _dragStartX = e.clientX; 
    _dragStartY = e.clientY; 
  });

  // 1. Hover State — FREE MOUSE only. Locked/walk-mode hover is driven from
  //    the render loop (see _tickCrosshairHover, wired near tickScene), not
  //    from input events, because the old "if(pointerLockElement)return"
  //    guard here disabled hover completely the instant the user clicked to
  //    look around. Input events are also the wrong trigger for a crosshair:
  //    controls.js EASES the camera toward the mouse's target rotation over
  //    several frames, so the view keeps turning after the mouse itself goes
  //    still. An event-driven raycast misses that tail entirely, which is
  //    why the highlight lagged or stuck on the wrong building while panning.
  canvas.addEventListener("pointermove", e => {
    if (Math.abs(e.clientX - _dragStartX) > 6 || Math.abs(e.clientY - _dragStartY) > 6) {
      _isDragging = true;
    }
    if (document.pointerLockElement) return;   // frame loop owns this case

    const now = performance.now();
    if (!_isDragging && (now - _lastHoverTime > 50)) {
      _lastHoverTime = now;
      if (!document.getElementById("world-overlay")?.classList.contains("open")) return;

      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
       -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const raycaster = new THREE.Raycaster();
      const cam = typeof getCamera === 'function' ? getCamera() : null;
      if (!cam) return;
      raycaster.setFromCamera(mouse, cam);
      const sc = typeof getScene === 'function' ? getScene() : null;
      if (!sc) return;

      const badgeHits = raycaster.intersectObjects(sc.children, false).filter(h => h.object.userData?.isPlotBadge);
      let plotKey = null;
      if (badgeHits.length > 0) {
        plotKey = badgeHits[0].object.userData.plotKey;
      } else if (typeof getPlotAtRay === 'function') {
        plotKey = getPlotAtRay(raycaster);
      }
      if (typeof window.setHoveredPlot === 'function') window.setHoveredPlot(plotKey);
    }
  });

  // Locked-mode hover: same raycast, driven every frame from _tickCrosshairHover
  // (called from the main animation loop) using screen centre as the pick
  // ray — the crosshair position. Exposed on window so the frame loop, which
  // lives further down this file, can reach it without a module import cycle.
  let _lastCrosshairHover = 0;
  const _crosshairRay = new THREE.Raycaster();
  const _screenCentre = new THREE.Vector2(0, 0);
  window._tickCrosshairHover = function() {
    if (!document.pointerLockElement) return;
    if (!document.getElementById("world-overlay")?.classList.contains("open")) return;
    const now = performance.now();
    if (now - _lastCrosshairHover < 50) return;   // match the old 20/sec cadence
    _lastCrosshairHover = now;

    const cam = typeof getCamera === 'function' ? getCamera() : null;
    const sc  = typeof getScene  === 'function' ? getScene()  : null;
    if (!cam || !sc) return;
    const raycaster = _crosshairRay;
    raycaster.setFromCamera(_screenCentre, cam);   // screen centre, reused each call

    const badgeHits = raycaster.intersectObjects(sc.children, false)
      .filter(h => h.object.userData?.isPlotBadge);
    let plotKey = null;
    if (badgeHits.length > 0) {
      plotKey = badgeHits[0].object.userData.plotKey;
    } else if (typeof getPlotAtRay === 'function') {
      plotKey = getPlotAtRay(raycaster);
    }
    if (typeof window.setHoveredPlot === 'function') window.setHoveredPlot(plotKey);
  };

  // 2. Click to Select (Only fires on clean taps)
  canvas.addEventListener("pointerup", e => {
    if (!document.getElementById("world-overlay")?.classList.contains("open")) return;

    if (!_isDragging) {
      const rect = canvas.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
       -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      
      const raycaster = new THREE.Raycaster();
      const cam = typeof getCamera === 'function' ? getCamera() : null;
      if (!cam) return;
      raycaster.setFromCamera(mouse, cam);

      const sc = typeof getScene === 'function' ? getScene() : null;
      if (!sc) return;

      const badgeHits = raycaster.intersectObjects(sc.children, false).filter(h => h.object.userData?.isPlotBadge);
      let plotKey = null;
      
      if (badgeHits.length > 0) {
        plotKey = badgeHits[0].object.userData.plotKey;
      } else if (typeof getPlotAtRay === 'function') {
        plotKey = getPlotAtRay(raycaster);
      }

      if (plotKey) {
        if (document.pointerLockElement) document.exitPointerLock();
        const plot = typeof plotRegistry !== 'undefined' ? plotRegistry.get(plotKey) : null;
        
        if (plot && plot.status === "reserved") {
          if (typeof showNotification === 'function') showNotification("This has been Reserved, please choose another property.");
        } else {
          showPlotPanel(plotKey);
        }
      }
    }
    _isDragging = false; // Reset state
  });
}

function showPlotPanel(plotKey) {
  // Guaranteed here regardless of caller — non-tech and tablet users have no
  // way to know Esc releases the cursor, so the panel must never appear
  // while the pointer is still captured.
  if (document.pointerLockElement) document.exitPointerLock();
  document.getElementById('xix-plot-panel')?.remove();
  const plot = typeof plotRegistry !== 'undefined' ? plotRegistry.get(plotKey) : null;
  const _ptData = getPlotTypeData(plot?.type);   // moved after `plot` — was a TDZ error
  // Maps plot.type -> the exact key interior.js's INTERIORS object uses.
  // Confirmed against interior.js directly: INTERIORS has villa/loft/apartment.
  const _INTERIOR_TYPE = {
    '3 BED VILLA': 'villa',
    '2 BED LOFT TERRACE': 'loft',
    '2 Bed Flat Block (24 units)': 'apartment',
  }[plot?.type] || null;
  const isReserved = plot?.status === "reserved";

  const panel = document.createElement('div');
  panel.id = 'xix-plot-panel';
  panel.style.cssText = `
    position:fixed; top:0; left:0; bottom:0; width:min(380px,100vw);
    background:rgba(6,14,8,0.94); backdrop-filter:blur(16px);
    border-right:1px solid rgba(201,168,76,0.3); z-index:2000;
    display:flex; flex-direction:column; overflow:hidden;
    transform:translateX(-100%); transition:transform .4s cubic-bezier(0.16, 1, 0.3, 1);
    font-family:Inter,sans-serif;
  `;

  panel.innerHTML = `
    <div style="display:flex; flex-direction:column; padding:24px; border-bottom:1px solid rgba(201,168,76,0.15); position:relative;">
      <button id="plot-close-btn" style="position:absolute; top:16px; right:16px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:50%; width:32px; height:32px; color:#fff; cursor:pointer;">✕</button>
      <div style="font-size:10px; color:rgba(201,168,76,0.8); letter-spacing:.15em; text-transform:uppercase;">${_ptData.header}</div>
      <h2 style="font-size:1.8rem; font-weight:300; color:#f0ece0; font-family:'Cormorant Garamond',serif; margin:6px 0 16px 0;">Plot ${plotKey}</h2>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:12px; color:#f0ece0;">
        <div><span style="color:rgba(240,236,224,0.5); display:block; font-size:9px;">TYPE</span>${_ptData.title}</div>
        <div><span style="color:rgba(240,236,224,0.5); display:block; font-size:9px;">AREA</span>${_ptData.area}</div>
      </div>
    </div>

    <div style="flex:1; overflow-y:auto; padding:24px;">
      <div style="margin-bottom:20px;">
        <h4 style="font-size:10px; color:rgba(201,168,76,0.8); text-transform:uppercase; border-bottom:1px solid rgba(201,168,76,0.2); padding-bottom:6px; margin:0 0 12px 0;">Architectural Plans & Gallery</h4>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
          <button onclick="window.openGallery('floorplans','${plotKey}')" style="background:rgba(201,168,76,0.1); border:1px solid rgba(201,168,76,0.3); border-radius:4px; padding:10px; color:#e4c878; cursor:pointer; font-size:11px; text-transform:uppercase;">View Floorplans</button>
          <button onclick="window.openGallery('renders','${plotKey}')" style="background:rgba(201,168,76,0.1); border:1px solid rgba(201,168,76,0.3); border-radius:4px; padding:10px; color:#e4c878; cursor:pointer; font-size:11px; text-transform:uppercase;">View 3D Renders</button>
        </div>
      </div>

      ${_INTERIOR_TYPE ? `
      <div style="margin-bottom:24px;">
        <h4 style="font-size:10px; color:rgba(201,168,76,0.8); text-transform:uppercase; border-bottom:1px solid rgba(201,168,76,0.2); padding-bottom:6px; margin:0 0 12px 0;">1st-Person Walkthrough</h4>
        <button onclick="document.getElementById('xix-plot-panel')?.remove(); window.stepInsideVilla('${plotKey}')" style="width:100%; background:rgba(201,168,76,0.15); border:1px solid rgba(201,168,76,0.4); border-radius:4px; padding:14px; color:#e4c878; cursor:pointer; font-size:13px; font-weight:600; letter-spacing:.04em;">
          Step Inside — ${_ptData.title}
        </button>
      </div>` : ''}
    </div>

    <div style="padding:20px 24px; border-top:1px solid rgba(201,168,76,0.15); background:rgba(6,18,8,0.95);">
      ${isReserved ? `
        <button disabled style="width:100%; background:rgba(220,50,50,0.2); color:#ff6666; border:1px solid rgba(220,50,50,0.4); padding:14px; border-radius:4px; font-weight:600;">RESERVED</button>
      ` : `
        <button id="plot-reserve-btn" style="width:100%; background:#c9a84c; color:#061208; border:none; padding:14px; border-radius:4px; font-weight:600; cursor:pointer;">RESERVE THIS PLOT</button>
      `}
    </div>
  `;

  document.getElementById('world-overlay')?.appendChild(panel);
  requestAnimationFrame(() => panel.style.transform = 'translateX(0)');

  panel.querySelector('#plot-close-btn')?.addEventListener('click', () => {
    panel.style.transform = 'translateX(-100%)';
    setTimeout(() => panel.remove(), 400);
  });

  panel.querySelector('#plot-reserve-btn')?.addEventListener('click', () => {
    window.openReservationModal(`Plot ${plotKey}`, plotKey);
  });
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
// Previously used setInterval + scene.traverse at 50ms (20×/second), which is
// an O(n) GC-heavy traversal of the full scene graph on every tick. Replaced
// with a direct reference to the plot's overlay mesh, updated in the render
// loop via window._xixPulseOverlay rather than traversal.
let _pulseOverlayMesh = null;
let _pulseT = 0;

// Called from startRenderLoop's frame() each tick — zero traversal, zero GC.
window._tickPlotPulse = function(delta) {
  if (!_pulseOverlayMesh) return;
  _pulseT += delta;
  const alpha = 0.15 + Math.abs(Math.sin(_pulseT * 2.8)) * 0.30;
  _pulseOverlayMesh.material.opacity = alpha;
  _pulseOverlayMesh.material.color.setHex(0xC9A84C);
};

function _startPlotHighlightPulse(plotKey) {
  _stopPlotHighlightPulse();
  _pulseT = 0;
  const plot = plotRegistry.get(plotKey);
  _pulseOverlayMesh = (plot && plot.overlay) ? plot.overlay : null;
  if (_pulseOverlayMesh) {
    _pulseOverlayMesh.visible = true;
  }
}
function _stopPlotHighlightPulse() {
  if (_pulseOverlayMesh) {
    _pulseOverlayMesh.material.opacity = 0;
    _pulseOverlayMesh.visible = false;
    _pulseOverlayMesh = null;
  }
  try { highlightPlot(null); } catch(e){}
}

function showNotification(msg) {
  const n=document.getElementById("notification");
  if(!n) return;
  n.textContent=msg; n.classList.add("show");
  setTimeout(()=>n.classList.remove("show"),4500);
}

// ─── RESERVATION MODAL LOGIC ──────────────────────────────────────────────────
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwR4JKertI953T1GDB90RGgCwNNZvh2CCruaR4MAb_ViViVZ3Pd4OZG3qEmwjA-axSf/exec";

window.openReservationModal = function(propertyName, plotId = "") {
  const modal = document.getElementById('reservation-modal');
  if (!modal) return;
  document.getElementById('res-property-name').value = propertyName || "General";
  document.getElementById('res-plot-id').value = plotId || "";
  document.getElementById('res-form-title').textContent = plotId ? `Reserve ${plotId}` : `Reserve ${propertyName}`;
  modal.style.display = 'flex';
};

document.getElementById('res-close-btn')?.addEventListener('click', () => {
  document.getElementById('reservation-modal').style.display = 'none';
});

// Submit button is type="button" (not type="submit") to prevent iOS Safari
// scroll-to-top + keyboard dismiss. We wire the click handler here instead.
// The e.preventDefault() is kept for safety in case a submit event fires anyway.
document.getElementById('reservation-form')?.addEventListener('submit', async (e) => { e.preventDefault(); });
document.getElementById('res-submit-btn')?.addEventListener('click', async () => {
  const e = { preventDefault: () => {} }; // shim for legacy code below
  const btn = document.getElementById('res-submit-btn');
  btn.textContent = "Submitting...";
  btn.disabled = true;

  const payload = {
    propertyName: document.getElementById('res-property-name').value,
    plotId:       document.getElementById('res-plot-id').value,
    fullName:     document.getElementById('res-name').value,
    email:        document.getElementById('res-email').value,
    phone:        document.getElementById('res-phone').value,
    notes:        document.getElementById('res-notes').value,
  };

  try {
    await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors", 
      // 'text/plain' completely bypasses Google's strict CORS block
      headers: { "Content-Type": "text/plain;charset=utf-8" }, 
      body: JSON.stringify(payload)
    });

    // 1. If it was a specific 3D plot, reserve it on the map and show notification
    if (payload.plotId && typeof reservePlot === 'function') {
      reservePlot(payload.plotId);
      showPlotPanel(payload.plotId); // Refresh panel to show "Reserved" status
      showNotification("Plot reserved! Our team will contact you within 24 hours.");
    } 
    // 2. If it was a general property (like a Loft or Stable), update the panel UI
    else {
      const propPanelBtn = document.getElementById('pp-reserve-btn');
      if (propPanelBtn) {
        const reserveSection = propPanelBtn.parentNode;
        reserveSection.innerHTML = `
          <div style="background:rgba(30,80,30,0.25);border:1px solid rgba(100,200,80,0.3);border-radius:4px;padding:16px;text-align:center;">
            <div style="color:#8cde6a;font-size:24px;margin-bottom:8px;">✓</div>
            <div style="color:#f0ece0;font-weight:600;margin-bottom:4px;">Interest Registered</div>
            <div style="color:rgba(240,236,224,0.6);font-size:12px;">Our team will contact you within 24 hours.</div>
          </div>`;
      } else {
        alert("Reservation submitted successfully! The concierge team will contact you shortly.");
      }
    }

    document.getElementById('reservation-modal').style.display = 'none';
    document.getElementById('reservation-form').reset();
  } catch (err) {
    alert("Submission failed. Please check your connection and try again.");
  } finally {
    btn.textContent = "Submit Reservation";
    btn.disabled = false;
  }
});
// ──────────────────────────────────────────────────────────────────────────────

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
  window.currentViewKey = viewKey; 
  showLoading(); setLoadingProgress(10);

  if(!sceneReady){
    const canvas3d = document.getElementById("world-canvas");
    initScene(canvas3d);
    setLoadingProgress(40);
    initControls(getCamera(), getRenderer());
    setLoadingProgress(70);
    initMinimap("assets/plan-2d.png");
    setLoadingProgress(85);
    resizeWorld();
    composer = initPostProcessing(getRenderer(), getScene(), getCamera());
    setPerfModeGraphics('fast');
    setLoadingProgress(90);
    buildViewpointStrip(document.getElementById("viewpoint-strip"), (key, vp) => teleportTo(key, vp));

    // ── VIEWPOINTS PRECISION OVERRIDE ──────────────────────────────────────────
    // Override data.js VIEWPOINTS with exact camera positions for each strip button.
    // This replaces whatever coordinates data.js has with ground-truth estate coords.
    const VP_OVERRIDES = {
      'field_centre': { pos:[0,    1.72, 0],      yaw: 0,           pitch: 0,     caption: 'Main polo field — facing north' },
      'field_south':  { pos:[0,    1.72, 95],     yaw: Math.PI,     pitch: -0.04, caption: 'South goal — Clubhouse behind you' },
      'clubhouse':    { pos:[0,    1.72, 135],    yaw: Math.PI,     pitch: -0.05, caption: 'Clubhouse — estate social anchor' },
      'lake_north':   { pos:[0,    1.72, -108],   yaw: 0,           pitch: -0.04, caption: 'Crescent lake — north shore' },
      'stables':      { pos:[-280, 1.72, 80],     yaw: Math.PI/2,   pitch: 0,     caption: 'Equestrian quarter — 56 stalls' },
      'training':     { pos:[-260, 1.72, -40],    yaw: Math.PI/2,   pitch: 0,     caption: 'Training field — polo academy' },
      'lofts':        { pos:[-218, 1.72, -5],     yaw: -Math.PI/2,  pitch: 0,     caption: 'Loft terraces — south precinct' },
      'paddock':      { pos:[155,  1.72, -60],    yaw: -Math.PI/2,  pitch: 0,     caption: 'Paddock — east precinct' },
    };
    Object.entries(VP_OVERRIDES).forEach(([k, v]) => {
      if (VIEWPOINTS[k]) Object.assign(VIEWPOINTS[k], v);
    });

    // Dropdowns are attached after the overlay opens (see openWorldAt).

    sceneReady = true; setLoadingProgress(100);
  }

  await new Promise(r => setTimeout(r, 300));
  hideLoading();
  const overlay = document.getElementById("world-overlay");
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
  resizeWorld();
  window.addEventListener("resize", resizeWorld);

  // Phase 4: Mount persistent sales badges once the world opens
  setTimeout(() => buildVillaStatusOverlays(), 100);

  // ── TOPBAR CONTROLS BINDING ──────────────────────────────────────────────────
  // Bind TIME / WEATHER / QUALITY / TOUR topbar dropdowns and their sub-buttons.
  // This runs each time the world opens (sceneReady check means it's idempotent).
  _bindTopbarControls();

  // Dropdowns need no JS wiring — ui.js builds the villas menu as a body-level
  // portal, and index.html + styles.css handle the topbar via :hover/:focus-within.

  // Suppress the stale "Drag right to look" caption coming from data.js
  _nukeStaleCaption();

  // Initialize the searchable property directory
  injectPropertyDirectory();
  
  // Always open at field_centre — walk mode, ground level, facing north
  const _fieldVp = VIEWPOINTS['field_centre'];
  setView(_fieldVp.pos, _fieldVp.yaw, 0);
  setCaption(''); // Caption hidden — controls are self-evident
  const cam = getCamera();
  const _walkH = 1.72; // matches controls.js EYE_H constant
  const _rideH = 3.10;
  const startY = (moveMode === 'ride') ? _rideH : _walkH;
  cam.position.y = startY;
  _currentEyeY = startY;
  _targetEyeY  = startY;
  if (typeof setYOwner === 'function') setYOwner(moveMode === 'ride' ? 'app' : 'controls');
  activate();
  
  // Joystick: only show on genuine touch screens (tablets/phones) — not laptops with touchpads
  const _hasTouchScreen = navigator.maxTouchPoints > 1 || window.matchMedia('(pointer:coarse)').matches;
  if(_hasTouchScreen){
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
    
    }
  
  // NEW: Instantly hide joystick on laptops if a physical mouse is moved
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' && typeof hideJoystick === 'function') {
      hideJoystick();
    }
  }, { passive: true, once: true });

  // EXECUTIVE MODE: Auto-start in Aerial Orbit
  const aerialBtn = document.getElementById('btn-aerial');
  if (typeof toggleAerial === 'function' && !window.aerialOrbit) {
    toggleAerial(aerialBtn);
  }
  
  enableAudio();
  // Sync the topbar button icon to whatever mute state was restored from
  // localStorage in initAudio(), so the button never opens in the wrong state.
  if (typeof isAudioMuted === 'function') _syncSoundBtn(isAudioMuted());

  // Cinematic intro: desktop only.
  // On mobile the 300m aerial descent causes a ~3s jank spike before controls
  // engage, and the raw oscillator AudioContext creation inside it triggers
  // iOS Safari's autoplay policy guard (must be initiated from a direct user
  // gesture, not a setTimeout chain). Skip it and go straight to the field.
  // cinematicIntro() is still defined below for manual console testing.
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
    document.getElementById('xix-property-directory').style.display = 'block';
    btn&&btn.classList.add("active");
    deactivate();
    // elevAngle in the render loop = -aerialPitch, measured FROM THE ZENITH.
    // Small value = straight down (top view). For the low oblique establishing
    // angle, elevAngle must be LARGE (~1.1 rad ≈ 63° off vertical).
    // -1.1 → R_ground≈232m, height≈118m: camera low and out, looking across.
    aerialAngle=-0.8; aerialYawOffset=0; aerialPitch=-1.1;
    // Narrow FOV — 55° completely removes architectural edge warping
    const _aerCam = getCamera();
    _aerCam.fov = 55; _aerCam.far = 2000; _aerCam.updateProjectionMatrix();
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
    document.getElementById('xix-property-directory').style.display = 'none';
    btn&&btn.classList.remove("active");
    unbindAerialPointer();
    activate();
    const cam = getCamera();
    // Restore normal FOV + far plane
    cam.fov = 50; cam.far = 1200; cam.updateProjectionMatrix();
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

// ─── SOUND TOGGLE ───────────────────────────────────────────────────────────
function _syncSoundBtn(muted) {
  const btn = document.getElementById('btn-sound');
  if (!btn) return;
  btn.classList.toggle('active', !muted);
  btn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  const icon = btn.querySelector('.sound-icon');
  if (icon) icon.innerHTML = muted
    ? '<path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
    : '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>';
}
window.toggleSound = function() {
  const nowMuted = !(typeof isAudioMuted === 'function' ? isAudioMuted() : false);
  if (typeof setAudioMuted === 'function') setAudioMuted(nowMuted);
  _syncSoundBtn(nowMuted);
};

// Property detail panel — opens over the 3D world for any viewpoint with a productKey
// Contains: zone description, interior viewpoints, reservation option
function openPropertyPanel(key) {
  // Same mapping as showPlotPanel above, keyed by the zone/toolbar key
  // instead of plot.type. Only villas and lofts have an interior.js entry
  // reachable through this particular panel today.
  const _INTERIOR_TYPE = { villas: 'villa', lofts: 'loft' }[key] || null;
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
  document.getElementById('xix-prop-panel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'xix-prop-panel';
  panel.style.cssText = `
    position:fixed; top:0; right:0; bottom:0; width:min(380px,100vw);
    background:rgba(6,14,8,0.92); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px);
    border-left:1px solid rgba(201,168,76,0.3); z-index:2000;
    display:flex; flex-direction:column; overflow:hidden;
    transform:translateX(100%); transition:transform .4s cubic-bezier(0.16, 1, 0.3, 1);
    font-family:Inter,sans-serif;
  `;

  panel.innerHTML = `
    <div style="display:flex; flex-direction:column; padding:24px; border-bottom:1px solid rgba(201,168,76,0.15); position:relative; flex-shrink:0;">
      <button id="pp-close-btn" style="position:absolute; top:16px; right:16px; background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); border-radius:50%; width:32px; height:32px; color:rgba(255,255,255,0.6); cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:16px; transition:all 0.2s;">✕</button>
      <div style="font-size:10px; color:rgba(201,168,76,0.8); letter-spacing:.15em; text-transform:uppercase; margin-bottom:6px;">${data.type}</div>
      <h2 style="font-size:1.8rem; font-weight:300; color:#f0ece0; font-family:'Cormorant Garamond',serif; margin:0 0 16px 0; line-height:1.1;">${data.title}</h2>
      <div style="display:flex; gap:24px;">
        <div><div style="font-size:9px; color:rgba(240,236,224,0.5); text-transform:uppercase; letter-spacing:.1em; margin-bottom:2px;">Area</div><div style="font-size:14px; color:#f0ece0; font-weight:500;">${data.area}</div></div>
        <div><div style="font-size:9px; color:rgba(240,236,224,0.5); text-transform:uppercase; letter-spacing:.1em; margin-bottom:2px;">Pricing</div><div style="font-size:14px; color:#c9a84c;">${data.price}</div></div>
      </div>
    </div>
    <div style="flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; padding:24px;">
      <p style="font-size:13px; color:rgba(240,236,224,0.7); line-height:1.6; margin-bottom:24px; margin-top:0;">${data.description}</p>
      
      <div style="margin-bottom:24px;">
        <h4 style="font-size:10px; color:rgba(201,168,76,0.8); text-transform:uppercase; letter-spacing:.1em; border-bottom:1px solid rgba(201,168,76,0.2); padding-bottom:6px; margin:0 0 12px 0;">Key Features</h4>
        <ul style="list-style:none; padding:0; margin:0;">
          ${data.features.map(f => `<li style="font-size:13px; color:rgba(240,236,224,0.8); margin-bottom:8px; display:flex; gap:8px; align-items:flex-start;"><span style="color:#c9a84c; margin-top:2px;">◆</span> ${f}</li>`).join('')}
        </ul>
      </div>

      ${data.interior && data.interior.length > 0 ? `
      <div style="margin-bottom:24px;">
        <h4 style="font-size:10px; color:rgba(201,168,76,0.8); text-transform:uppercase; letter-spacing:.1em; border-bottom:1px solid rgba(201,168,76,0.2); padding-bottom:6px; margin:0 0 12px 0;">Architectural Plans & Gallery</h4>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
          <button onclick="window.openGallery('floorplans')" style="background:rgba(201,168,76,0.1); border:1px solid rgba(201,168,76,0.3); border-radius:4px; padding:10px; color:var(--gold-300, #e4c878); cursor:pointer; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; transition:all 0.2s;">View Floorplans</button>
          <button onclick="window.openGallery('renders')" style="background:rgba(201,168,76,0.1); border:1px solid rgba(201,168,76,0.3); border-radius:4px; padding:10px; color:var(--gold-300, #e4c878); cursor:pointer; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; transition:all 0.2s;">View 3D Renders</button>
        </div>
      </div>

      ${_INTERIOR_TYPE ? `
      <div>
        <h4 style="font-size:10px; color:rgba(201,168,76,0.8); text-transform:uppercase; letter-spacing:.1em; border-bottom:1px solid rgba(201,168,76,0.2); padding-bottom:6px; margin:0 0 12px 0;">Interactive Walkthrough</h4>
        <div style="font-size:12px;color:rgba(240,236,224,0.6);margin-bottom:10px;">Experience the space in 1st-person 3D.</div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <button onclick="document.getElementById('xix-prop-panel')?.remove(); window.stepInsideVilla(window._xixFindAnyPlot ? window._xixFindAnyPlot('${_INTERIOR_TYPE}') : null)" style="background:rgba(201,168,76,0.9); border:none; border-radius:4px; padding:14px; color:#061208; cursor:pointer; font-size:13px; font-weight:700; font-family:Inter,sans-serif; text-align:center; transition:all 0.2s; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
            Step Inside — ${data.title}
          </button>
        </div>
      </div>` : ''}` : ''}
    </div>

    ${data.canReserve ? `
    <div style="padding:20px 24px; border-top:1px solid rgba(201,168,76,0.15); background:rgba(6,18,8,0.95); flex-shrink:0;">
      <div style="font-size:10px;color:rgba(201,168,76,0.6);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px;">Reserve Your Plot</div>
      <button id="pp-reserve-btn" style="width:100%; background:var(--gold-500, #c9a84c); color:#061208; border:none; padding:14px; font-size:14px; font-weight:600; cursor:pointer; border-radius:4px; transition:opacity 0.2s; margin-bottom:10px;">Register Interest</button>
      <a href="mailto:o.olasunkanmi@mixtafrica.com?subject=Project XIX — ${encodeURIComponent(data.title)} Enquiry" style="display:block; text-align:center; padding:12px; border:1px solid rgba(201,168,76,0.3); border-radius:4px; color:rgba(201,168,76,0.8); font-size:13px; text-decoration:none;">Email the Project Team</a>
    </div>` : `
    <div style="padding:20px 24px; border-top:1px solid rgba(201,168,76,0.15); background:rgba(6,18,8,0.95); flex-shrink:0;">
      <a href="mailto:o.olasunkanmi@mixtafrica.com?subject=Project XIX — ${encodeURIComponent(data.title)} Enquiry" style="display:block; text-align:center; padding:14px; background:rgba(201,168,76,0.88); border-radius:4px; color:#061208; font-size:14px; font-weight:600; text-decoration:none;">Make an Enquiry</a>
    </div>`}
  `;

  document.getElementById('world-overlay')?.appendChild(panel);
  requestAnimationFrame(() => panel.style.transform = 'translateX(0)');

  // Close Button Logic
  panel.querySelector('#pp-close-btn')?.addEventListener('click', () => {
    panel.style.transform = 'translateX(100%)';
    if (typeof setInteriorDOF === 'function') setInteriorDOF(false);
    setTimeout(() => panel.remove(), 400);
    if (typeof _stopPlotHighlightPulse === 'function') _stopPlotHighlightPulse();
  });

  // Reservation Button Logic
  panel.querySelector('#pp-reserve-btn')?.addEventListener('click', () => {
    window.openReservationModal(data.title, propKey); // Passing propKey correctly here
  });
}

// ─── PER-PROPERTY-TYPE CATALOG ───────────────────────────────────────────────
//  Keyed by the exact plot.type string stored in plotRegistry (see
//  registerVillaFootprint / placeLoftGLB / the APT-BLOCK-1/2 seed in
//  scene.js). One place owns title, area, gallery images and whether the
//  interior walkthrough applies, so showPlotPanel and openGallery can never
//  drift out of sync the way villa text was hardcoded into both
//  independently before.
const PLOT_TYPE_DATA = {
  '3 BED VILLA': {
    header: 'PROJECT XIX — PREMIUM VILLA PLOT',
    title: '3-Bedroom Premium Villa',
    area: '330 m²',
    hasInterior: true,
    interiorLabel: 'Step Inside — 3-Bedroom Villa',
    floorplans: [
      { src: 'assets/plans/villa-plan-level2.png', title: 'Ground Floor - Living, Dining & Kitchen (42m²)' },
      { src: 'assets/plans/villa-plan-level3.png', title: 'First Floor - Master Bedroom & Family Lounge (27m²)' },
      { src: 'assets/plans/villa-plan-level0.png', title: 'Undercroft Level - Parking & Staff Quarters' },
      { src: 'assets/plans/villa-section.png', title: 'Architectural Section & Level Heights' },
    ],
    renders: [
      { src: 'assets/plans/villa-render-front.png', title: '3D Perspective - Front Exterior Elevation' },
      { src: 'assets/plans/villa-render-back.png', title: '3D Perspective - Rear Garden & Terrace' },
    ],
  },
  '2 BED LOFT TERRACE': {
    header: 'PROJECT XIX — LOFT TERRACE PLOT',
    title: '2-Bedroom Loft Terrace',
    area: '125 m²',
    hasInterior: false,
    floorplans: [
      { src: 'assets/plans/loft-plan-ground.png', title: 'Ground Floor Plan' },
      { src: 'assets/plans/loft-plan-first.png', title: 'First Floor Plan' },
    ],
    renders: [
      { src: 'assets/plans/loft-render-front.png', title: '3D Perspective - Exterior' },
    ],
  },
  '2 Bed Flat Block (24 units)': {
    header: 'PROJECT XIX — BLOCK OF FLATS',
    title: '2-Bedroom Flat',
    area: '204 m² · 24 units per block',
    hasInterior: false,
    floorplans: [
      { src: 'assets/plans/flats-site-layout.png', title: 'Site Layout - Parking & Access' },
      { src: 'assets/plans/flats-plan-ground.png', title: 'Ground Floor Plan' },
      { src: 'assets/plans/flats-plan-second.png', title: 'Second Floor Plan (Typical)' },
      { src: 'assets/plans/flats-elevation.png', title: 'Front Elevation' },
    ],
    renders: [
      { src: 'assets/plans/flats-render-front.png', title: '3D Perspective - Front Exterior' },
      { src: 'assets/plans/flats-render-angle.png', title: '3D Perspective - Angled View' },
    ],
  },
};
// Fallback for any plot.type not yet catalogued above, so an unmapped type
// shows an honest placeholder rather than someone else's building.
const PLOT_TYPE_FALLBACK = {
  header: 'PROJECT XIX', title: 'Residential Plot', area: '',
  hasInterior: false, floorplans: [], renders: [],
};
function getPlotTypeData(type) { return PLOT_TYPE_DATA[type] || PLOT_TYPE_FALLBACK; }

// ─── FULL-SCREEN IMAGE LIGHTBOX VIEWER ───────────────────────────────────────
//  Now takes the SAME plotKey shown in the panel, looks up its real type,
//  and opens THAT property's images — previously this always opened the
//  villa set regardless of what was clicked.
window.openGallery = function(kind, plotKey) {
  const plot = (plotKey && typeof plotRegistry !== 'undefined') ? plotRegistry.get(plotKey) : null;
  const data = getPlotTypeData(plot?.type);
  const images = kind === 'floorplans' ? data.floorplans : data.renders;

  const existing = document.getElementById('xix-lightbox');
  if (existing) existing.remove();

  let activeIdx = 0;

  const modal = document.createElement('div');
  modal.id = 'xix-lightbox';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(6, 18, 8, 0.95); backdrop-filter: blur(12px);
    z-index: 10000; display: flex; flex-direction: column;
    align-items: center; justify-content: center; font-family: Inter, sans-serif;
  `;

  const renderLightbox = () => {
    modal.innerHTML = `
      <div style="position: absolute; top: 20px; right: 25px; cursor: pointer; color: #C9A84C; font-size: 28px; font-weight: bold; line-height: 1;" onclick="document.getElementById('xix-lightbox').remove()">✕</div>
      <div style="color: #C9A84C; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 12px;">
        ${type === 'floorplans' ? 'Architectural Floorplans' : '3D Renders'} (${activeIdx + 1} of ${images.length})
      </div>
      <img src="${images[activeIdx].src}" style="max-width: 85vw; max-height: 68vh; border: 1px solid rgba(201, 168, 76, 0.3); border-radius: 8px; object-fit: contain; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.8);" />
      <div style="color: #f0ece0; font-size: 13px; margin-top: 16px; font-weight: 500; text-align: center; max-width: 80vw;">
        ${images[activeIdx].title}
      </div>
      <div style="display: flex; gap: 16px; margin-top: 20px;">
        <button id="lb-prev" style="background: rgba(201, 168, 76, 0.12); border: 1px solid rgba(201, 168, 76, 0.4); color: #C9A84C; padding: 8px 20px; border-radius: 4px; cursor: pointer; font-size: 12px;">← Previous</button>
        <button id="lb-next" style="background: rgba(201, 168, 76, 0.12); border: 1px solid rgba(201, 168, 76, 0.4); color: #C9A84C; padding: 8px 20px; border-radius: 4px; cursor: pointer; font-size: 12px;">Next →</button>
      </div>
    `;

    document.getElementById('lb-prev').addEventListener('click', () => {
      activeIdx = (activeIdx - 1 + images.length) % images.length;
      renderLightbox();
    });
    document.getElementById('lb-next').addEventListener('click', () => {
      activeIdx = (activeIdx + 1) % images.length;
      renderLightbox();
    });
  };

  document.body.appendChild(modal);
  renderLightbox();
};

// ─── SPAWN-ON-DEMAND INTERIOR TRIGGER ────────────────────────────────────────
// ─── VILLA EXPERIENCE (replaces the fake interior shell) ─────────────────────
// Interior walkthrough: window.stepInsideVilla() below, built into the main scene.

function teleportTo(key, vp){
  try {
    // 1. Exit Aerial view if active so orbital math stops overriding the camera
    if (typeof aerialOrbit !== 'undefined' && aerialOrbit) {
      toggleAerial(document.getElementById('btn-aerial'));
    }

    // 2. Set mode to walk and ensure controls are active
    if (typeof setMoveMode === 'function') setMoveMode('walk');

    // 3. Resolve position data
    // Villa sub-zone keys: override with meaningful in-world positions
    // All bottom-strip viewpoint overrides — ground-truth estate coordinates
    const PRECISE_VIEWPOINTS = {
      // Polo field
      'field_centre': { pos:[0,    1.72,  0],    yaw: 0,           pitch: 0,     caption: 'Main polo field — facing north' },
      'field_south':  { pos:[0,    1.72,  95],   yaw: Math.PI,     pitch:-0.04,  caption: 'South goal — Clubhouse behind you' },
      // Clubhouse
      'clubhouse':    { pos:[0,    1.72,  135],  yaw: Math.PI,     pitch:-0.05,  caption: 'Clubhouse — estate social anchor' },
      // Lake
      'lake_north':   { pos:[0,    1.72,  -108], yaw: 0,           pitch:-0.04,  caption: 'Crescent lake — north shore' },
      // Stables
      'stables':      { pos:[-280, 1.72,  80],   yaw: Math.PI/2,   pitch: 0,     caption: 'Equestrian quarter — 56 stalls' },
      // Training
      'training':     { pos:[-260, 1.72,  -40],  yaw: Math.PI/2,   pitch: 0,     caption: 'Training field — polo academy' },
      // Lofts
      'lofts':        { pos:[-218, 1.72,  -5],   yaw: -Math.PI/2,  pitch: 0,     caption: 'Loft terraces — south precinct' },
      // Paddock
      'paddock':      { pos:[155,  1.72,  -60],  yaw: -Math.PI/2,  pitch: 0,     caption: 'Paddock — east precinct' },
      // Villa sub-zones
      'villa_west':   { pos:[-162, 1.72,   0],   yaw:  Math.PI/2,  pitch: 0,     caption: 'West villa row — polo field ahead' },
      'villa_east':   { pos:[ 162, 1.72,   0],   yaw: -Math.PI/2,  pitch: 0,     caption: 'East villa row — polo field ahead' },
      'villa_north':  { pos:[  0,  1.72, -120],  yaw:  0,          pitch: 0,     caption: 'North arc — crescent lake view' },
      'villa_south':  { pos:[  0,  1.72,   90],  yaw:  Math.PI,    pitch: 0,     caption: 'South villas — looking toward the field' },
      // Villas (main button)
      'villas':       { pos:[-162, 1.72,   0],   yaw:  Math.PI/2,  pitch: 0,     caption: 'West villa row — polo field ahead' },
    };
    const resolved = PRECISE_VIEWPOINTS[key] || (vp && vp.pos ? vp : (VIEWPOINTS[key] || null));
    if (!resolved || !Array.isArray(resolved.pos) || resolved.pos.length < 3) {
      console.warn('[XIX] teleportTo: bad viewpoint for key', key, resolved);
      return;
    }

    // 4. Set camera ground position, yaw, and pitch
    setView(resolved.pos, resolved.yaw || 0, resolved.pitch || 0);
    setCaption(resolved.caption || key);

    // 5. Enforce ground eye height
    const cam = getCamera();
    const eyeY = (moveMode === 'ride') ? 3.10 : 1.72;
    cam.position.y = eyeY;
    _currentEyeY = eyeY;
    _targetEyeY  = eyeY;

    if (resolved.zoneKey) showZonePanel(resolved.zoneKey); else hideZonePanel();
  } catch(err) {
    console.error('[XIX] teleportTo error:', err);
  }
}

function injectPerfToggle() { /* wired via ui.js or topbar.js */ }

// ── Topbar controls — binds TIME, WEATHER, QUALITY, TOUR buttons ─────────────
// Finds buttons by data-time / data-weather / data-mode attributes and
// wires them to the correct window functions. Also opens dropdown menus.
// ── Stale caption cleaner ─────────────────────────────────────────────────────
// data.js sets field_centre.caption to "Drag right to look". setCaption() already
// filters it, but ui.js writes to #scene-caption directly in some paths, so a
// MutationObserver is the only reliable way to keep it clear.
function _nukeStaleCaption() {
  if (window._xixCaptionObserver) return;
  const BAD = ['drag right to look', 'drag to look', 'click to look', 'drag right'];
  const el = document.getElementById('scene-caption') ||
             document.getElementById('viewpoint-caption');
  if (!el) return;
  const clean = () => {
    const t = (el.textContent || '').trim().toLowerCase();
    if (BAD.some(b => t === b || t.startsWith(b))) el.textContent = '';
  };
  clean();
  window._xixCaptionObserver = new MutationObserver(clean);
  window._xixCaptionObserver.observe(el, {
    childList: true, subtree: true, characterData: true,
  });
}

function _bindTopbarControls() {
  // ── INTENTIONALLY MINIMAL ───────────────────────────────────────────────
  // index.html already wires every topbar control with inline handlers:
  //   <button onclick="applyTimePreset('morning')">
  //   <button onclick="applyWeather('clear')">
  //   <button onclick="switchPerfMode('fast')">
  // and app.js exposes applyTimePreset / applyWeather / switchPerfMode on
  // window. Adding addEventListener to those same buttons made every action
  // fire twice. The menus themselves open via CSS:
  //   .topbar-dropdown:hover .topbar-dropdown-menu       { display: flex }
  //   .topbar-dropdown:focus-within .topbar-dropdown-menu { display: flex }
  // Nothing here should touch any of that.
  //
  // The one genuine gap: :hover does not fire on touch screens. tabindex="0"
  // plus :focus-within covers most of it, but iOS Safari only focuses a div
  // on tap if it is explicitly focusable AND the tap is not swallowed. So we
  // add a touch-only click toggle that sets .tb-open, and a CSS rule for it.
  if (window._topbarTouchBound) return;
  window._topbarTouchBound = true;

  const isTouch = navigator.maxTouchPoints > 1 ||
                  window.matchMedia('(pointer: coarse)').matches;
  if (!isTouch) return;   // Desktop uses :hover — leave it completely alone

  const st = document.createElement('style');
  st.id = 'xix-topbar-touch';
  st.textContent =
    '.topbar-dropdown.tb-open .topbar-dropdown-menu { display: flex; }';
  document.head.appendChild(st);

  document.querySelectorAll('.topbar-dropdown').forEach(dd => {
    const trigger = dd.querySelector('.world-btn');
    if (!trigger) return;
    trigger.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const wasOpen = dd.classList.contains('tb-open');
      document.querySelectorAll('.topbar-dropdown.tb-open')
              .forEach(d => d.classList.remove('tb-open'));
      if (!wasOpen) dd.classList.add('tb-open');
    });
  });

  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('.topbar-dropdown')) {
      document.querySelectorAll('.topbar-dropdown.tb-open')
              .forEach(d => d.classList.remove('tb-open'));
    }
  }, { passive: true });
}
function fixTopbarDropdowns() { /* touch fix — no-op if handled in HTML */ }

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
// Exposed so index.html's interior-walkthrough module can pause the entire
// estate render loop while the interior overlay is open. Confirmed nothing
// currently stops it — the estate keeps rendering fully hidden behind any overlay.
// full estate (43 villas, shadows, GTAO, ambient horses, hologram fades) was
// rendering every frame, completely hidden, fighting the lightweight
// interior scene for the same GPU the whole time someone was "inside" a
// villa. That is the actual reason movement felt heavy — the interior's own
// code is lean; it just never got the GPU to itself.
// The real system never needs a second scene, so it never needs to pause
// the main one — this stays exported only in case something else relies on
// it, but villa walkthroughs no longer call it.
window.pauseMainRenderLoop = function() {
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }
};
window.resumeMainRenderLoop = function() {
  if (!animFrameId) startRenderLoop();
};

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

      // Player-mount horse removed graphically — this block used to place the
      // horse model at the camera's own XZ position every frame, meaning the
      // camera sat essentially inside the horse's body continuously in 'ride'
      // mode: the "ghostly giant horse" that filled the screen. getHorseGroup
      // now always returns null and the setter/tick functions are no-ops, so
      // this block is intentionally empty rather than deleted — moveMode still
      // distinguishes ride/walk eye height elsewhere, which was not asked to
      // change, only the horse's visual presence.
    }

    tickScene(elapsed,camera);
    if (typeof window._tickCrosshairHover === 'function') window._tickCrosshairHover();
    if (typeof window._tickPlotPulse === 'function') window._tickPlotPulse(delta);
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

// resizeWorld is debounced — iOS Safari fires the resize event continuously
// as the address bar shows/hides during scroll (up to 60× per second). Each
// call to renderer.setSize() is expensive; debouncing to 150ms means at most
// one real resize per scroll gesture.
let _resizeTimer = null;
function resizeWorld(){
  if (_resizeTimer) return;
  _resizeTimer = setTimeout(() => {
    _resizeTimer = null;
    const renderer=getRenderer(), camera=getCamera();
    if(!renderer||!camera) return;
    const canvas=document.getElementById("world-canvas");
    if (!canvas || !canvas.parentElement) return;
    const w=canvas.parentElement.clientWidth, h=canvas.parentElement.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w,h); camera.aspect=w/h; camera.updateProjectionMatrix();
    resizeComposer(w,h);
  }, 150);
}

//           SCROLL ANIM
function bindSectionScrollAnim(){
  const io=new IntersectionObserver(entries=>{
    entries.forEach(e=>{if(e.isIntersecting) e.target.classList.add("in-view");});
  },{threshold:0.12});
  document.querySelectorAll(".anim-fade").forEach(el=>io.observe(el));
}

//           VILLA INTERIOR
// Matches the residence-card-type text on the marketing page exactly as it
// appears in index.html ("3 Bed Villa", "2 Bed Loft", "2 Bed Flat") to the
// key interior.js's INTERIORS object actually uses.
const RESIDENCE_CARD_INTERIOR = { '3 Bed Villa': 'villa', '2 Bed Loft': 'loft', '2 Bed Flat': 'apartment' };

function bindVillaInteriorBtn(){
  document.addEventListener("click",e=>{
    const enterBtn=e.target.closest(".residence-card-btn");
    const card=enterBtn?.closest(".residence-card");
    const cardType=card?.querySelector(".residence-card-type")?.textContent?.trim();
    const interiorType=cardType && RESIDENCE_CARD_INTERIOR[cardType];
    if(enterBtn&&interiorType){
      window.stepInsideVilla(window._xixFindAnyPlot ? window._xixFindAnyPlot(interiorType) : null);
      return;
    }
    // .plan-tab / .plan-room: the static Floor Plans panel already present
    // in villa-overlay markup. data-key values match interior.js's own room
    // keys exactly (confirmed: "undercroft", "approach", etc.), so route
    // straight into the real system rather than the tab switching alone.
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
      document.querySelectorAll(".plan-room").forEach(r=>r.classList.remove("active"));
      room.classList.add("active");
      // Already inside the real system (this panel only ever shows villa
      // rooms) — just switch rooms within the current session, or start
      // one at a representative villa if none is open yet.
      const r = teleportVillaRoom(room.dataset.key);
      if (r) { setView(r.view.pos, r.view.yaw, r.view.pitch); }
      else { window.stepInsideVilla(); }
    }
  });
}

// Interior walkthrough is entirely owned by window.stepInsideVilla, defined above.

// ─── SEARCHABLE PROPERTY DIRECTORY (AERIAL MODE) ──────────────────────────
function injectPropertyDirectory() {
  if (document.getElementById('xix-property-directory')) return;

  // BLACK RECTANGLE FIX: Forcefully hide the crosshair and empty panels
  if (!document.getElementById('xix-safe-css')) {
    const safeCss = document.createElement('style');
    safeCss.id = 'xix-safe-css';
    safeCss.textContent = `#dir-dropdown-panel:empty, .xix-tooltip:empty, #crosshair { display: none !important; }`;
    document.head.appendChild(safeCss);
  }

  // 1. Create Main Container
  const dirContainer = document.createElement('div');
  dirContainer.id = 'xix-property-directory';
  dirContainer.style.cssText = 'position: absolute; top: 80px; left: 24px; z-index: 2000; font-family: Inter, sans-serif; pointer-events: none; display: none;';

  // 2. Create Toggle Button
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'dir-toggle-btn';
  toggleBtn.textContent = 'Property Directory ▾';
  // Removed the blur here as well for maximum mobile stability
  toggleBtn.style.cssText = 'pointer-events: all; background: rgb(10, 25, 14); border: 1px solid rgba(201,168,76,0.6); color: #c9a84c; padding: 10px 18px; border-radius: 6px; font-weight: 600; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);';

  // 3. Create Dropdown Panel (SOLID BACKGROUND, NO BLUR)
  const panel = document.createElement('div');
  panel.id = 'dir-dropdown-panel';
  panel.style.cssText = 'pointer-events: all; background: rgb(8, 20, 12); border: 1px solid rgba(201,168,76,0.5); border-radius: 6px; margin-top: 8px; width: 300px; display: none; flex-direction: column; box-shadow: 0 12px 40px rgba(0,0,0,0.8);';

  // 4. Create Search Bar
  const searchDiv = document.createElement('div');
  searchDiv.style.cssText = 'padding: 12px; border-bottom: 1px solid rgba(201,168,76,0.2);';
  const searchInput = document.createElement('input');
  searchInput.id = 'dir-search-input';
  searchInput.type = 'text';
  searchInput.placeholder = 'Search Unit ID or Typology...';
  searchInput.style.cssText = 'width: 100%; background: rgba(255,255,255,0.08); border: 1px solid rgba(201,168,76,0.4); color: #f0ece0; padding: 10px 12px; border-radius: 4px; font-size: 13px; outline: none; box-sizing: border-box;';
  searchDiv.appendChild(searchInput);

  // 5. Create List Container
  const listContainer = document.createElement('div');
  listContainer.id = 'dir-list-container';
  listContainer.style.cssText = 'max-height: 350px; overflow-y: auto; padding: 8px; -webkit-overflow-scrolling: touch;';

  // Assemble UI
  panel.appendChild(searchDiv);
  panel.appendChild(listContainer);
  dirContainer.appendChild(toggleBtn);
  dirContainer.appendChild(panel);
  document.getElementById('world-overlay')?.appendChild(dirContainer);

  // 6. Logic: Toggle Open/Close
  toggleBtn.addEventListener('click', () => {
    const isOpen = panel.style.display === 'flex';
    panel.style.display = isOpen ? 'none' : 'flex';
    if (!isOpen) {
      searchInput.value = '';
      populateDirectoryList('');
      searchInput.focus();
    }
  });

  // 7. Logic: Search Filtering — debounced to avoid rebuilding 223 DOM nodes
  // on every keystroke. 120ms feels instant to the user but batches fast typing.
  let _dirSearchTimer = null;
  searchInput.addEventListener('input', (e) => {
    if (_dirSearchTimer) clearTimeout(_dirSearchTimer);
    _dirSearchTimer = setTimeout(() => populateDirectoryList(e.target.value.toLowerCase()), 120);
  });

  // 8. Logic: Build the List dynamically (USING DOCUMENT FRAGMENT FOR SPEED)
  function populateDirectoryList(searchTerm) {
    listContainer.innerHTML = '';
    let matchCount = 0;

    if (typeof plotRegistry === 'undefined') return;

    const sortedKeys = Array.from(plotRegistry.keys()).sort((a, b) => Number(a) - Number(b));
    
    // PERFORMANCE FIX: Build the list in memory first
    const fragment = document.createDocumentFragment();

    sortedKeys.forEach(key => {
      const plot = plotRegistry.get(key);
      const typeLabel = plot.type || "Property";
      
      if (key.toLowerCase().includes(searchTerm) || typeLabel.toLowerCase().includes(searchTerm)) {
        matchCount++;
        const isAvail = plot.status === 'available';
        
        const item = document.createElement('div');
        item.style.cssText = 'padding: 12px 10px; border-radius: 4px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.05);';
        
        // Left side text
        const leftDiv = document.createElement('div');
        leftDiv.innerHTML = `Unit ${key}${typeLabel}`;
        
        // Right side badge
        const rightDiv = document.createElement('div');
        rightDiv.style.cssText = `font-size: 9px; font-weight: bold; padding: 4px 8px; border-radius: 4px; background: ${isAvail ? 'rgba(100,230,120,0.15)' : 'rgba(230,80,80,0.15)'}; color: ${isAvail ? '#66ff99' : '#ff6666'};`;
        rightDiv.textContent = isAvail ? 'AVAILABLE' : 'RESERVED';
        
        item.appendChild(leftDiv);
        item.appendChild(rightDiv);

        // Click to fly
        item.addEventListener('click', () => {
          panel.style.display = 'none';
          if (plot.isApt) {
             if (typeof setView === 'function') setView([-245, 40, 0], Math.PI/2, -0.4);
          } else {
             if (typeof setView === 'function') setView([plot.x, 30, plot.z + 40], 0, -0.6);
             if (typeof showPlotPanel === 'function') showPlotPanel(key);
          }
        });

        fragment.appendChild(item);
      }
    });

    if (matchCount === 0) {
      listContainer.innerHTML = 'No properties found.';
    } else {
      // Append all 223 items simultaneously in 1 millisecond
      listContainer.appendChild(fragment);
    }
  }
}

// ─── MOBILE UI CLEANUP: DESTROY STUCK RECTANGLES ───
document.addEventListener("DOMContentLoaded", () => {
  const cleanupCss = document.createElement('style');
  cleanupCss.textContent = `
    /* Hides crosshairs, empty prompts, and stuck tooltips completely */
    #crosshair, #reticle, .crosshair, .reticle { display: none !important; }
    #enter-prompt:empty, #notification:empty, #viewpoint-caption:empty { 
      display: none !important; 
      opacity: 0 !important; 
      pointer-events: none !important;
    }
    /* Hide joystick and sprint on non-touch devices via CSS media query */
    @media (hover: hover) and (pointer: fine) {
      #joystick-container, #joystick, .joystick-wrapper,
      #sprint-btn-mobile { display: none !important; }
    }
  `;
  document.head.appendChild(cleanupCss);
});
