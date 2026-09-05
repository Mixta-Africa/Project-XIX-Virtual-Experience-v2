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

import { VIEWPOINTS, ZONES, WORLD } from "./data.js?v=79";
// villa-interior.js removed — dead file, superseded by interior.js
import {
  initScene, getRenderer, getScene, getCamera, getClock,
  tickScene, updateSky, updateSkyForTime, plotRegistry, reservePlot, getPlotAtRay,
  highlightPlot, setPerfMode, PERF_MODE, pickPlotFast, unreservePlot, markPickTargetsDirty, refreshReservedOverlays,
  RIDER_EYE_HEIGHT, FOOT_EYE_HEIGHT, tickHorse, tickHorseAnim,
  setHorsePosition, getThirdPersonCameraOffset, setAerialMode,
  getSunLight, getHorseGroup, updateNightLights, updateBuildingNightGlow,
  enterVillaInterior, teleportVillaRoom, exitVillaInterior,
  setAudioMuted, isAudioMuted, setMixLevel, getMixLevels, getMixDefaults, resetMixLevels, getAudioStatus,
  setPlotOverlaysSuppressed,
  tickVillaLOD,
} from "./scene.js?v=79";
import { initPostProcessing, resizeComposer, renderFrame, setBloomForTime, setPerfModeGraphics, setInteriorDOF, setWeatherBloomModifier, setFieldWetness } from "./graphics.js?v=79";
import {
  initControls, activate, deactivate, setView, updateControls, getYaw,
  requestGyro, enterVR, setYOwner
} from "./controls.js?v=79";
import {
  initMinimap, updateMinimap,
  buildViewpointStrip, showZonePanel, hideZonePanel,
  showLoading, hideLoading, setLoadingProgress,
  setCaption as _setCaption_raw, showEnterPrompt, hideEnterPrompt,
  showVRButton, showJoystick, hideJoystick, isMobile,
  enableAudio, updateSpatialAudio, initAudio
} from "./ui.js?v=79";

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
  setPlotOverlaysSuppressed(true);
  showHint('Inside the villa — WASD to walk, the strip below switches rooms, Esc to step back out',
           { key: 'interior-enter', ms: 5200 });    // kill the green box you would be standing in
  if (typeof activate === 'function') activate();
};

window.exitVillaWalkthrough = function() {
  exitVillaInterior();
  document.getElementById('interior-overlay')?.classList.remove('open');
  document.body.classList.remove('interior-open');
  setPlotOverlaysSuppressed(false);
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

window.switchPerfMode = function(mode, auto) {
  setPerfMode(mode);          // updates scene (shadow map, pixel ratio, fog) — clamps to GPU ceiling
  setPerfModeGraphics(mode);  // updates graphics pipeline (bloom, SMAA, direct render)
  // Reflect the tier that was ACTUALLY applied (setPerfMode may have clamped it
  // down to the GPU ceiling), not the one that was requested.
  const applied = PERF_MODE;
  document.querySelectorAll('.perf-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === applied));
  if (!auto) {
    window._xixManualQualityUntil = performance.now() + 30000; // 30s respect window
  }
};

// Mark tiers above the GPU's recommended default with a hint, but NEVER disable
// them. The earlier version greyed 'Rich' out entirely, which took away a choice
// the user is entitled to make on their own hardware.
window._xixApplyQualityCeilingUI = function() {
  const cap = window._xixMaxTier;
  if (!cap) return;
  const ORDER = ['fast', 'balanced', 'rich'];
  document.querySelectorAll('.perf-btn').forEach(b => {
    const m = b.dataset.mode;
    if (!m) return;
    b.disabled = false;
    b.style.opacity = '';
    b.style.cursor  = '';
    b.title = ORDER.indexOf(m) > ORDER.indexOf(cap)
      ? `Above the recommended setting for this GPU — may reduce framerate`
      : '';
  });
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
    
    sprite.visible = false;   // distance-culled — see _tickBadgeVisibility
    sc.add(sprite);
    plot.badgeSprite = sprite; // Store reference for fast updates
  });
}

// ─── BADGE DISTANCE CULLING ──────────────────────────────────────────────────
// 223 AVAILABLE/RESERVED labels floating over the whole estate turned the wide
// shot into visual noise — from aerial they read as clutter rather than
// information, and they obscured the architecture that is meant to be the
// subject. They now appear only within close range, where they are genuinely
// useful, and fade out beyond it.
// Runs on a 6-frame cadence: a label appearing 100ms late is imperceptible,
// and this keeps 223 distance checks off the critical path.
let _badgeTick = 0;
function _tickBadgeVisibility(camera) {
  if (!camera || typeof plotRegistry === 'undefined') return;
  if ((_badgeTick++ % 6) !== 0) return;
  if (isInteriorMode()) { plotRegistry.forEach(p => { if (p.badgeSprite) p.badgeSprite.visible = false; }); return; }
  const cx = camera.position.x, cz = camera.position.z;
  // 3D distance — camera HEIGHT must count. This used only dx/dz, so from the
  // aerial camera (~118m up) a plot directly below measured 0m horizontally and
  // its badge stayed visible. That is the leftover floating AVAILABLE labels.
  const dy = camera.position.y - 1.6;
  const SHOW2 = 95 * 95;
  plotRegistry.forEach(plot => {
    const b = plot.badgeSprite;
    if (!b) return;
    const dx = plot.x - cx, dz = plot.z - cz;
    b.visible = (dx * dx + dz * dz + dy * dy) < SHOW2;
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
  // ─── INSTANT HOVER HIGHLIGHT ───────────────────────────────────────────────
  // Rewritten for Windows-desktop-style immediacy. The old version:
  //   • bailed unless the pointer was locked → never ran in aerial at all
  //   • throttled to 50ms (20Hz) → visibly behind the cursor
  //   • raycast every top-level scene child looking for badges
  // Now: driven by real mousemove, coalesced to at most one raycast per
  // animation frame (so it can never outpace rendering), tests only the cached
  // overlay planes, and lights up on the same frame the cursor arrives.
  // Distance within which a plot highlights on hover and opens on ONE click.
  // Beyond this, hover stays clean and selection requires a double-click.
  const HOVER_RANGE = 70;
  const _hoverNDC = new THREE.Vector2(0, 0);
  let _hoverRafPending = false;
  let _hoverClientX = 0, _hoverClientY = 0;
  let _hoverPointerLocked = false;

  function _runHoverPick() {
    _hoverRafPending = false;
    // Inside a unit, looking around must not re-select the building you are in.
    if (isInteriorMode()) { window.setHoveredPlot(null); _updateHoverLabel(null); return; }
    const overlay = document.getElementById("world-overlay");
    if (!overlay || !overlay.classList.contains("open")) return;

    const cam = typeof getCamera === 'function' ? getCamera() : null;
    if (!cam) return;

    // Pointer-locked walkthrough aims from the screen centre (the crosshair);
    // aerial and any unlocked mode aim from the actual cursor position.
    if (_hoverPointerLocked) _hoverNDC.set(0, 0);

    _crosshairRay.setFromCamera(_hoverNDC, cam);
    let plotKey = (typeof pickPlotFast === 'function')
      ? pickPlotFast(_crosshairRay)
      : (typeof getPlotAtRay === 'function' ? getPlotAtRay(_crosshairRay) : null);

    // ── PROXIMITY GATE ───────────────────────────────────────────────────────
    // Standing at the centre spot and panning should NOT keep selecting houses
    // 150m away. A highlight is a statement that you are looking at something
    // you could walk up to; at distance the ray sweeps across dozens of plots
    // and the flicker is noise, not information.
    // Inside HOVER_RANGE the plot highlights and one click opens it.
    // Beyond it nothing highlights on hover and selection needs a double-click,
    // which makes distant selection deliberate rather than accidental.
    // AERIAL IS EXEMPT. In aerial the camera sits ~118m above the estate, so
    // EVERY plot fails a 70m test and hover died completely — a regression I
    // introduced with this gate. Aerial is a top-down selection interface: its
    // entire purpose is picking plots from above, and the cursor points at one
    // plot at a time, so there is no flicker to suppress.
    // The gate exists for WALKTHROUGH, where panning at ground level sweeps the
    // ray across dozens of distant plots.
    const _inAerial = !!window._aerialModeActive;
    if (!_inAerial && plotKey && typeof plotRegistry !== 'undefined') {
      const pl = plotRegistry.get(plotKey);
      if (pl) {
        const dx = pl.x - cam.position.x, dz = pl.z - cam.position.z;
        const dy = cam.position.y - 1.6;
        const d = Math.sqrt(dx*dx + dz*dz + dy*dy);
        window._xixHoverDist = d;
        if (d > HOVER_RANGE) plotKey = null;   // too far to hover-highlight
      }
    }

    if (typeof window.setHoveredPlot === 'function') window.setHoveredPlot(plotKey);
    _updateHoverLabel(plotKey);
  }

  function _queueHoverPick() {
    if (_hoverRafPending) return;      // coalesce: at most one pick per frame
    _hoverRafPending = true;
    requestAnimationFrame(_runHoverPick);
  }

  // Clearing hover when the cursor leaves the canvas onto UI chrome. Without
  // this the last highlight stayed lit — the cursor was down on the viewpoint
  // strip while a building was still glowing, because no further pick ran.
  ['#viewpoint-strip', '.world-topbar', '#minimap', '#xix-property-directory'].forEach(sel => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.addEventListener('mouseenter', () => {
      if (typeof window.setHoveredPlot === 'function') window.setHoveredPlot(null);
      _updateHoverLabel(null);
    }, { passive: true });
  });

  canvas.addEventListener('mousemove', e => {
    _hoverPointerLocked = !!document.pointerLockElement;
    if (!_hoverPointerLocked) {
      const r = canvas.getBoundingClientRect();
      _hoverNDC.set(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      );
      _hoverClientX = e.clientX;
      _hoverClientY = e.clientY;
    }
    _queueHoverPick();
  }, { passive: true });

  // Clear the highlight when the cursor leaves the canvas
  canvas.addEventListener('mouseleave', () => {
    if (typeof window.setHoveredPlot === 'function') window.setHoveredPlot(null);
    _updateHoverLabel(null);
  }, { passive: true });

  // In pointer-locked walkthrough the mouse doesn't emit position changes the
  // same way, and the camera itself moves — so re-pick every frame from centre.
  // This is cheap now (one raycast against cached quads, no allocations).
  // Re-pick every frame in BOTH modes, from the last known cursor position.
  //  • Pointer-locked walkthrough: the camera moves as you walk, so the plot
  //    under the fixed centre crosshair changes constantly.
  //  • Aerial: the camera ORBITS, so the estate rotates beneath a stationary
  //    cursor and the plot under it changes every frame. The earlier version
  //    bailed out unless the pointer was locked, so in aerial the highlight
  //    only updated when the mouse physically moved — it drifted out of sync
  //    with the scene the moment you stopped moving. That is the opposite of
  //    the desktop-cursor immediacy this is meant to have.
  // The pick itself is one raycast against cached quads with no allocation, so
  // running it per frame is cheap; _queueHoverPick coalesces to one per frame.
  window._tickCrosshairHover = function() {
    const locked = !!document.pointerLockElement;
    const aerial = !!window._aerialModeActive;
    if (!locked && !aerial) return;   // idle, unlocked, non-aerial: mousemove drives it
    _hoverPointerLocked = locked;
    _queueHoverPick();
  };

  // ─── PLOT NUMBER LABEL ─────────────────────────────────────────────────────
  // Follows the cursor (or sits just under the crosshair when pointer-locked)
  // and shows the plot number, type and status the instant a plot is hovered.
  let _hoverLabelEl = null;
  let _hoverLabelKey = null;
  function _updateHoverLabel(plotKey) {
    if (!_hoverLabelEl) {
      _hoverLabelEl = document.createElement('div');
      _hoverLabelEl.id = 'plot-hover-label';
      _hoverLabelEl.style.cssText =
        'position:fixed;pointer-events:none;z-index:10000;display:none;' +
        'background:rgba(8,16,10,0.94);border:1px solid rgba(201,168,76,0.55);' +
        'border-radius:7px;padding:7px 11px;font-family:Inter,system-ui,sans-serif;' +
        'font-size:12.5px;line-height:1.35;color:#f2e9d0;white-space:nowrap;' +
        'box-shadow:0 4px 14px rgba(0,0,0,0.45);';
      document.body.appendChild(_hoverLabelEl);
    }

    if (!plotKey) {
      if (_hoverLabelEl.style.display !== 'none') _hoverLabelEl.style.display = 'none';
      _hoverLabelKey = null;
      return;
    }

    const plot = (typeof plotRegistry !== 'undefined') ? plotRegistry.get(plotKey) : null;
    if (!plot) { _hoverLabelEl.style.display = 'none'; _hoverLabelKey = null; return; }

    // Only rebuild the markup when the plot actually changes; on plain cursor
    // movement over the same plot we just reposition, which costs nothing.
    if (_hoverLabelKey !== plotKey) {
      _hoverLabelKey = plotKey;
      const reserved = plot.status === 'reserved';
      const statusCol = reserved ? '#e0704a' : '#5fd07a';
      const statusTxt = reserved ? 'RESERVED' : 'AVAILABLE';
      _hoverLabelEl.innerHTML =
        `<div style="color:#c9a84c;font-weight:600;letter-spacing:0.4px;">PLOT ${plotKey}</div>` +
        `<div style="opacity:0.85;font-size:11.5px;">${plot.type || 'Villa'}</div>` +
        `<div style="color:${statusCol};font-size:10.5px;font-weight:600;letter-spacing:0.6px;margin-top:2px;">${statusTxt}</div>`;
      _hoverLabelEl.style.display = 'block';
    }

    // Position: follow the cursor when free, sit under the crosshair when locked
    let lx, ly;
    if (_hoverPointerLocked) {
      lx = window.innerWidth / 2 + 18;
      ly = window.innerHeight / 2 + 14;
    } else {
      lx = _hoverClientX + 16;
      ly = _hoverClientY + 16;
    }
    // Keep it on screen
    const w = _hoverLabelEl.offsetWidth || 150, h = _hoverLabelEl.offsetHeight || 50;
    if (lx + w > window.innerWidth - 8)  lx = _hoverClientX - w - 16;
    if (ly + h > window.innerHeight - 8) ly = _hoverClientY - h - 16;
    _hoverLabelEl.style.left = lx + 'px';
    _hoverLabelEl.style.top  = ly + 'px';
  }

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

      // Same cached overlay picker the hover uses — no full-scene traversal.
      // Clicking inside a unit is "click to look", never "select a property".
      if (isInteriorMode()) { _isDragging = false; return; }
      const plotKey = (typeof pickPlotFast === 'function')
        ? pickPlotFast(raycaster)
        : (typeof getPlotAtRay === 'function' ? getPlotAtRay(raycaster) : null);

      if (plotKey) {
        const plot = typeof plotRegistry !== 'undefined' ? plotRegistry.get(plotKey) : null;

        // ── DISTANCE-GATED SELECTION ──────────────────────────────────────
        // Near a building (within SELECT_NEAR) a single click opens it — you
        // are clearly standing at the thing you mean.
        // Far away, the ray crosses dozens of plots and a single click is
        // usually an accident while panning, so selection needs a DELIBERATE
        // double-click. The first click arms the plot and tells the user what
        // to do; a second click on the SAME plot within the window opens it.
        // Aerial is exempt for the same reason: you are deliberately aiming at
        // a plot from above, so one click should open it.
        let far = false;
        if (plot && !window._aerialModeActive) {
          const cam2 = getCamera();
          const dx = plot.x - cam2.position.x, dz = plot.z - cam2.position.z;
          const dy = cam2.position.y - 1.6;
          far = Math.sqrt(dx*dx + dz*dz + dy*dy) > SELECT_NEAR;
        }

        if (far) {
          const now = performance.now();
          const same = (_armedPlot === plotKey) && (now - _armedAt < DBL_WINDOW);
          if (!same) {
            // First click at distance — arm it, don't open.
            _armedPlot = plotKey; _armedAt = now;
            if (typeof window.setHoveredPlot === 'function') window.setHoveredPlot(plotKey);
            if (typeof showNotification === 'function') {
              showNotification(`Plot ${plotKey} — click again to open, or walk closer`);
            }
            _isDragging = false;
            return;
          }
          _armedPlot = null;   // second click landed — fall through and open
        }

        if (document.pointerLockElement) document.exitPointerLock();

        // From the air, travel to the unit as well as opening the pane, so the
        // buyer sees the actual property rather than just a form.
        if (window._aerialModeActive) { try { flyToUnit(plotKey); } catch (e) {} }

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

  // Free the cursor as the panel slides in.
  releaseCursorForPanel('Cursor released — use the panel on the left');

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
// Selection distance model. Inside SELECT_NEAR one click opens a plot; beyond
// it, two clicks on the same plot within DBL_WINDOW are required so that
// panning across the estate never opens a property by accident.
const SELECT_NEAR = 70;      // matches HOVER_RANGE — highlight and 1-click agree
const DBL_WINDOW  = 900;     // ms between the arming click and the confirming one
let _armedPlot = null, _armedAt = 0;

const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwR4JKertI953T1GDB90RGgCwNNZvh2CCruaR4MAb_ViViVZ3Pd4OZG3qEmwjA-axSf/exec";

// ═══════════════════════════════════════════════════════════════════════════
// SHEET SYNC  —  the sheet is the single source of truth
// ═══════════════════════════════════════════════════════════════════════════
// GOOGLE_SCRIPT_URL existed but NOTHING EVER CALLED doGet, so the app never
// read the sheet. Plots you had marked RESERVED in the spreadsheet still showed
// as AVAILABLE in the walkthrough — a straight sales-data disconnect.
//
// This polls doGet and applies the result in BOTH directions:
//   AVAILABLE -> RESERVED   marks the plot reserved (red overlay, badge, and
//                           the Reserve button disabled)
//   RESERVED  -> AVAILABLE  releases it again
// So editing a cell in the sheet now updates the environment, which is the
// backward compatibility that was missing.
let _lastStatusMap = {};
let _syncTimer = null;

async function syncPlotStatusFromSheet(quiet = false) {
  try {
    const res = await fetch(GOOGLE_SCRIPT_URL, { method: 'GET' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const map = await res.json();
    let applied = 0;

    Object.keys(map).forEach(id => {
      const status = String(map[id] || '').trim().toUpperCase();
      const plot = plotRegistry.get(String(id));
      if (!plot) return;                       // id in sheet with no plot in scene
      const wantReserved = (status === 'RESERVED');
      const isReserved   = (plot.status === 'reserved');
      if (wantReserved === isReserved) return; // already correct — no work
      if (wantReserved) { reservePlot(String(id)); }
      else              { unreservePlot(String(id)); }
      applied++;
    });

    _lastStatusMap = map;
    if (applied || !quiet) {
      console.log(`[XIX] Sheet sync: ${Object.keys(map).length} rows read, ${applied} plot(s) updated`);
    }
    return applied;
  } catch (err) {
    console.warn('[XIX] Sheet sync failed:', err.message);
    return -1;
  }
}

// Poll every 20s so a change made in the sheet during a live viewing appears
// without a reload. Pauses while the tab is hidden so it costs nothing in the
// background, and re-syncs immediately on return.
function startSheetSync() {
  syncPlotStatusFromSheet(false);
  if (_syncTimer) clearInterval(_syncTimer);
  _syncTimer = setInterval(() => {
    if (document.visibilityState === 'visible') syncPlotStatusFromSheet(true);
  }, 20000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncPlotStatusFromSheet(true);
  });
}
window.syncPlotStatusFromSheet = syncPlotStatusFromSheet;

window.openReservationModal = function(propertyName, plotId = "") {
  const modal = document.getElementById('reservation-modal');
  if (!modal) return;
  releaseCursorForPanel('Cursor released — fill in the form to reserve');
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
    // TYPOLOGY — was never sent, which is why every villa row in the sheet read
    // "Property" while lofts and apartments showed their real unit type. The
    // registry already knows the type per plot, so send it and let the Apps
    // Script write it to column G.
    typology:     (() => {
      const id = document.getElementById('res-plot-id').value;
      const pl = id && typeof plotRegistry !== 'undefined' ? plotRegistry.get(String(id)) : null;
      return (pl && pl.type) ? pl.type
           : (document.getElementById('res-property-name').value || 'Property');
    })(),
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
    _injectInteriorViewpoints();   // must run before the strip is built
    buildViewpointStrip(document.getElementById("viewpoint-strip"), (key, vp) => teleportTo(key, vp));

    // ── VIEWPOINTS PRECISION OVERRIDE ──────────────────────────────────────────
    // Override data.js VIEWPOINTS with exact camera positions for each strip button.
    // This replaces whatever coordinates data.js has with ground-truth estate coords.
    const VP_OVERRIDES = {
      'field_centre': { pos:[0,    1.72, 0],      yaw: 0,           pitch: 0,     caption: 'Main polo field — facing north' },
      'field_south':  { pos:[0,    1.72, 95],     yaw: Math.PI,     pitch: -0.04, caption: 'South goal — Clubhouse behind you' },
      'clubhouse':    { pos:[0,    1.72, 135],    yaw: Math.PI,     pitch: -0.05, caption: 'Clubhouse — estate social anchor' },
      // z was -108, which sits INSIDE the water once NORTH_SHIFT (+12) moved
      // the lake to z -87..-116 — the camera was submerged. Now on the field-side
      // shore at z=-80, looking north across the water to the villa arc.
      'lake_north':   { pos:[0,    1.72,  -80],   yaw: Math.PI,     pitch: -0.02, caption: 'Crescent Lake — across the water to the north arc' },
      // Was (-280,80): 135m short of the compound, facing +X at empty ground.
      // Stables GLB is at (-320,120) with its cobble yard at (-355,90). Now
      // standing in the yard looking north-east at the blocks. yaw=atan2(25,25).
      'stables':      { pos:[-345, 1.72,  95],   yaw: Math.PI/4,   pitch: 0,     caption: 'Stables — cobbled yard, blocks ahead' },
      // Was (-175,0): 85m east of the field, facing +X across empty laterite.
      // Training field spans x -352..-168, z -97..21, oriented north-south.
      // Now standing at its south end looking down the full length. yaw=PI (-Z).
      'training':     { pos:[-260, 1.72,   12],  yaw: Math.PI,     pitch: -0.02, caption: 'Training Field — polo academy, looking north' },
      'lofts':        { pos:[-218, 1.72, -5],     yaw: -Math.PI/2,  pitch: 0,     caption: 'Loft terraces — south precinct' },
      'paddock':      { pos:[155,  1.72, -60],    yaw: -Math.PI/2,  pitch: 0,     caption: 'Paddock — east precinct' },
    };
    Object.entries(VP_OVERRIDES).forEach(([k, v]) => {
      if (VIEWPOINTS[k]) Object.assign(VIEWPOINTS[k], v);
    });

    // Dropdowns are attached after the overlay opens (see openWorldAt).

    sceneReady = true; setLoadingProgress(100);
  }

  const overlay = document.getElementById("world-overlay");
  overlay.classList.add("open");
  document.body.classList.add("in-estate");
  document.body.style.overflow = "hidden";
  // Belt and braces alongside the CSS rule — the pre-entry CTA must not survive
  // into the 3D view on large touchscreens.
  const _cta = document.getElementById('billboard-cta');
  if (_cta) _cta.style.display = 'none';

  // Size the buffers BEFORE anything is shown, then render one correct frame
  // while the loading screen is still up. Previously the overlay opened, the
  // debounced resize lagged 150ms behind, and the first frames were drawn at
  // the wrong buffer size and upscaled — the blurry flash.
  resizeWorldNow();
  await new Promise(r => requestAnimationFrame(r));
  resizeWorldNow();                     // second pass: layout has settled
  try { renderFrame(); } catch (e) {}   // one correct frame, still behind the loader
  await new Promise(r => requestAnimationFrame(r));

  hideLoading();
  window.addEventListener("resize", resizeWorld);

  // Phase 4: Mount persistent sales badges once the world opens
  setTimeout(() => buildVillaStatusOverlays(), 100);
  // Sheet is the source of truth — pull it once the registry is populated.
  setTimeout(() => startSheetSync(), 3000);
  // Collision volumes come from the plot registry — rebuild once everything has loaded.
  setTimeout(() => { try { _buildCollisionBoxes(); } catch(e){} }, 6000);

  // ── TOPBAR CONTROLS BINDING ──────────────────────────────────────────────────
  // Bind TIME / WEATHER / QUALITY / TOUR topbar dropdowns and their sub-buttons.
  // This runs each time the world opens (sceneReady check means it's idempotent).
  _bindTopbarControls();
  // GPU detection has run inside initScene by now — grey out unreachable tiers
  // and mark the tier actually in use as active.
  if (typeof window._xixApplyQualityCeilingUI === 'function') window._xixApplyQualityCeilingUI();
  document.querySelectorAll('.perf-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === PERF_MODE));

  // Dropdowns need no JS wiring — ui.js builds the villas menu as a body-level
  // portal, and index.html + styles.css handle the topbar via :hover/:focus-within.

  // Suppress the stale "Drag right to look" caption coming from data.js
  _nukeStaleCaption();

  // Initialize the searchable property directory
  injectPropertyDirectory();

  // Chrome settles back while exploring so the estate reads full-screen.
  initAutoFadingChrome();
  
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
  // Restore the button to the mute state persisted in localStorage. This also
  // used a typeof guard against an unimported function, so after a reload the
  // button always showed "unmuted" even when the audio was actually muted.
  _syncSoundBtn(isAudioMuted());

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
    showHint('Hover a plot to highlight it, click to open. Drag to steer the orbit.',
             { key: 'aerial-enter', ms: 5000 });
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
  el.addEventListener("touchstart",aerialTouchStart,{passive:true});
  el.addEventListener("touchmove",aerialTouchMove,{passive:false});
  // RELEASE MUST BE ON WINDOW, NOT THE ELEMENT.
  // mouseup/touchend were bound to the canvas, so releasing the button OUTSIDE
  // it (over the topbar, the strip, or off-window) never fired — aerialDragging
  // stayed true forever and every later mouse move rotated the camera with no
  // click held. That is the "keeps rotating, trails the cursor" behaviour, and
  // on a hybrid touch+mouse laptop it triggers constantly because a touch can
  // begin a drag that no matching mouseup ever ends.
  window.addEventListener("mouseup",aerialMouseUp,{passive:true});
  window.addEventListener("touchend",aerialMouseUp,{passive:true});
  window.addEventListener("touchcancel",aerialMouseUp,{passive:true});
  window.addEventListener("pointercancel",aerialMouseUp,{passive:true});
  window.addEventListener("blur",aerialMouseUp,{passive:true});
}
function unbindAerialPointer(){
  const el=getRenderer()?.domElement; if(!el) return;
  el.removeEventListener("mousedown",aerialMouseDown);
  el.removeEventListener("mousemove",aerialMouseMove);
  el.removeEventListener("touchstart",aerialTouchStart);
  el.removeEventListener("touchmove",aerialTouchMove);
  window.removeEventListener("mouseup",aerialMouseUp);
  window.removeEventListener("touchend",aerialMouseUp);
  window.removeEventListener("touchcancel",aerialMouseUp);
  window.removeEventListener("pointercancel",aerialMouseUp);
  window.removeEventListener("blur",aerialMouseUp);
}
function aerialMouseDown(e){aerialDragging=true;aerialLastX=e.clientX;aerialLastY=e.clientY;}
function aerialMouseUp(){aerialDragging=false;}
function aerialMouseMove(e){
  // Definitive guard: e.buttons is 0 when NO button is physically held. This
  // self-corrects a stuck drag no matter which release event was missed, so a
  // lost mouseup can never leave the camera spinning with the cursor again.
  if (e.buttons === 0) { aerialDragging = false; return; }
  if (window.__tourActive) return;   // the tour drives the camera itself
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






// ── INTERIOR VIEWPOINTS — injected into the VILLAS dropdown ──────────────────
// These were previously written into PROPERTY_DATA[...].interior, which only
// gates a gallery button — they were never reachable as camera positions, so
// "step inside a unit" did not actually exist for east, north or south.
// The viewpoint strip builds its dropdown from `vp.subViews`, and teleportTo
// falls back to `vp.pos` for any key it does not recognise, so sub-views that
// carry their own pos/yaw/pitch work without touching data.js.
//
// Yaw convention verified against the working 'villas' viewpoint:
//   +PI/2 faces +X (east) · -PI/2 faces -X · PI faces -Z (north) · 0 faces +Z
// Floor heights: ground 2.0m · first 5.5m · roof terrace 9.0m.
function _injectInteriorViewpoints() {
  if (typeof VIEWPOINTS === 'undefined' || !VIEWPOINTS.villas) return;
  // Positions snapped to REAL villa coordinates, verified against the actual
  // placement arrays. An earlier version used round numbers (x=±162, z=0) which
  // put the "interior" views 19m away in empty space — there is no villa at
  // z=0 on either column. These sit inside actual units:
  //   west/east columns  z = -19  (villas at z = -75,-47,-19,19,47,75)
  //   north arc          x = 0, z = -116  (arc apex after NORTH_SHIFT)
  //   south row          x = -65, z = 90.6  (z = 88 + x*0.04)
  const V = [
    { key:'int_w_g', label:'Inside · West · Ground',  pos:[-162,2.0,-19],   yaw: Math.PI/2, pitch: 0,    caption:'Inside west villa · ground floor — polo field ahead' },
    { key:'int_w_1', label:'Inside · West · First',   pos:[-162,5.5,-19],   yaw: Math.PI/2, pitch:-0.10, caption:'Inside west villa · first floor — elevated polo view' },
    { key:'int_w_r', label:'Inside · West · Roof',    pos:[-162,9.0,-19],   yaw: Math.PI/2, pitch:-0.15, caption:'West villa roof terrace — estate panorama' },
    { key:'int_e_g', label:'Inside · East · Ground',  pos:[162,2.0,-19],    yaw:-Math.PI/2, pitch: 0,    caption:'Inside east villa · ground floor — polo field ahead' },
    { key:'int_e_1', label:'Inside · East · First',   pos:[162,5.5,-19],    yaw:-Math.PI/2, pitch:-0.10, caption:'Inside east villa · first floor — elevated polo view' },
    { key:'int_e_r', label:'Inside · East · Roof',    pos:[162,9.0,-19],    yaw:-Math.PI/2, pitch:-0.15, caption:'East villa roof terrace — clubhouse and field' },
    { key:'int_n_g', label:'Inside · North · Ground', pos:[0,2.0,-116],     yaw: Math.PI,   pitch: 0,    caption:'Inside north arc villa · ground floor — lake in the foreground' },
    { key:'int_n_1', label:'Inside · North · First',  pos:[0,5.5,-116],     yaw: Math.PI,   pitch:-0.10, caption:'Inside north arc villa · first floor — over the lake' },
    { key:'int_n_r', label:'Inside · North · Roof',   pos:[0,9.0,-116],     yaw: Math.PI,   pitch:-0.16, caption:'North arc roof terrace — lake and full estate' },
    { key:'int_s_g', label:'Inside · South · Ground', pos:[-65,2.0,90.6],   yaw: 0,         pitch: 0,    caption:'Inside south villa · ground floor — field and lake beyond' },
    { key:'int_s_1', label:'Inside · South · First',  pos:[-65,5.5,90.6],   yaw: 0,         pitch:-0.10, caption:'Inside south villa · first floor — full field length' },
    { key:'int_s_r', label:'Inside · South · Roof',   pos:[-65,9.0,90.6],   yaw: 0,         pitch:-0.16, caption:'South villa roof terrace — estate panorama' },
  ];
  const existing = VIEWPOINTS.villas.subViews || [];
  // Keep whatever data.js already defines; append ours if not already present.
  const have = new Set(existing.map(x => x.key));
  VIEWPOINTS.villas.subViews = existing.concat(V.filter(x => !have.has(x.key)));
  console.log(`[XIX] Interior viewpoints: ${VIEWPOINTS.villas.subViews.length} available under VILLAS`);
}

// ═══════════════════════════════════════════════════════════════════════════
// GUIDED TOUR  —  cinematic, hands-off
// ═══════════════════════════════════════════════════════════════════════════
// window.startTour was referenced by the TOUR button but NEVER DEFINED, which
// is why the tour did nothing at all.
//
// Shape of it: five stops. Each one arrives at a fixed vantage point, then pans
// slowly across the subject to reveal it and its surroundings, holds a beat,
// fades to black, and cuts to the next. No controls, no input required — it
// plays like a film. Any click or key press exits immediately.
// Dolly is deliberately slight: a gentle push while panning reads as a camera
// move rather than a turntable, and keeps the frame alive without drawing
// attention to itself.
const TOUR_STOPS = [
  {
    name: 'The Polo Field',
    sub:  'Regulation 274 × 146m · the heart of the estate',
    pos:  [0, 2.6, 62],  yaw: Math.PI,      pitch: -0.02,
    panTo: Math.PI + 0.85,                 // sweep across the pitch
    dolly: [0, 2.6, 46],
    hold: 8500,
  },
  {
    name: 'The Clubhouse',
    sub:  '3,490m² · three floors · rooftop terrace',
    pos:  [-46, 3.4, 132], yaw: -0.55,      pitch: -0.02,
    panTo: 0.55,                            // reveal the full facade
    dolly: [-14, 3.4, 128],
    hold: 8000,
  },
  {
    name: 'Crescent Lake',
    sub:  '200m waterfront · premium north plots',
    pos:  [-72, 2.4, -70], yaw: -0.35,      pitch: 0.01,
    panTo: 0.75,                            // across the water to the arc
    dolly: [-30, 2.4, -76],
    hold: 8500,
  },
  {
    name: 'Premium Villas',
    sub:  '330m² · polo-facing · 43 units',
    pos:  [-140, 3.0, 34], yaw: Math.PI / 2, pitch: -0.03,
    panTo: Math.PI / 2 - 0.9,               // down the villa run
    dolly: [-140, 3.0, -6],
    hold: 8000,
  },
  {
    name: 'Stables & Training Field',
    sub:  'Polo academy · 5,000m² training ground',
    pos:  [-300, 3.2, 30], yaw: -1.15,      pitch: -0.02,
    panTo: -0.15,                           // stables across to the field
    dolly: [-284, 3.2, 6],
    hold: 7500,
  },
];

window.__tourActive = false;
let _tourIdx = 0, _tourRAF = null, _tourTimer = null, _tourFadeEl = null, _tourCardEl = null;
let _tourPan = null;

// Stepped once per frame from frame(), after updateControls(). Linear on
// purpose — easing a reveal pan makes it feel like it is starting and stopping,
// where a constant rate reads as a locked-off camera move.
function tickTourPan() {
  if (!window.__tourActive || !_tourPan) return;
  const p = _tourPan;
  const t = Math.min(1, (performance.now() - p.t0) / p.hold);
  setView(
    [ p.from[0] + (p.to[0]-p.from[0])*t,
      p.from[1] + (p.to[1]-p.from[1])*t,
      p.from[2] + (p.to[2]-p.from[2])*t ],
    p.yaw + (p.panTo - p.yaw) * t,
    p.pitch
  );
  if (t >= 1) _tourPan = null;
}

function _tourFade() {
  if (_tourFadeEl) return _tourFadeEl;
  const f = document.createElement('div');
  f.id = 'tour-fade';
  f.style.cssText =
    'position:fixed;inset:0;z-index:10050;background:#050c07;opacity:0;' +
    'pointer-events:none;transition:opacity 0.75s ease;';
  document.body.appendChild(f);
  _tourFadeEl = f;
  return f;
}

function _tourCard() {
  if (_tourCardEl) return _tourCardEl;
  const c = document.createElement('div');
  c.id = 'tour-card';
  c.style.cssText =
    'position:fixed;left:50%;bottom:14%;transform:translateX(-50%);z-index:10051;' +
    'text-align:center;pointer-events:none;opacity:0;transition:opacity 0.9s ease;' +
    'font-family:Inter,system-ui,sans-serif;text-shadow:0 2px 14px rgba(0,0,0,0.85);';
  document.body.appendChild(c);
  _tourCardEl = c;
  return c;
}

function _tourShowCard(stop) {
  const c = _tourCard();
  c.innerHTML =
    '<div style="color:#c9a84c;font-size:11px;letter-spacing:3.5px;margin-bottom:7px;">PROJECT XIX</div>' +
    '<div style="color:#fff;font-size:27px;font-weight:300;letter-spacing:0.6px;">' + stop.name + '</div>' +
    '<div style="color:rgba(255,255,255,0.68);font-size:12.5px;margin-top:6px;letter-spacing:0.4px;">' + stop.sub + '</div>';
  c.style.opacity = '1';
  setTimeout(() => { if (window.__tourActive) c.style.opacity = '0'; }, 4200);
}

// One stop: arrive, then pan + dolly across the subject for the hold duration.
function _tourRunStop(i) {
  if (!window.__tourActive) return;
  const stop = TOUR_STOPS[i];
  const fade = _tourFade();

  setView(stop.pos, stop.yaw, stop.pitch);
  setCaption(stop.name + ' — ' + stop.sub);
  fade.style.opacity = '0';
  _tourShowCard(stop);

  // The pan used to run on its OWN requestAnimationFrame calling setView each
  // frame. That is what made the camera shake:
  //   • setView() snaps BOTH targetYaw and currentYaw (it exists to kill the
  //     sweep on teleport), so per-frame calls bypass the exponential decay
  //     smoothing in controls.js completely;
  //   • updateControls() was still active in the MAIN loop writing
  //     camera.rotation.y from its own state, so two callbacks in two separate
  //     rAFs wrote the camera every frame with no guaranteed ordering.
  //
  // Now the pan is state only, stepped once per frame from frame() after
  // updateControls, and controls are deactivated for the duration — one writer,
  // fixed ordering, no jitter.
  _tourPan = {
    t0: performance.now(),
    from: stop.pos,
    to: stop.dolly || stop.pos,
    yaw: stop.yaw, panTo: stop.panTo, pitch: stop.pitch, hold: stop.hold,
  };

  // Fade out just before the pan ends, so the cut lands on black.
  _tourTimer = setTimeout(() => {
    if (!window.__tourActive) return;
    fade.style.opacity = '1';
    if (_tourCardEl) _tourCardEl.style.opacity = '0';
    setTimeout(() => {
      if (!window.__tourActive) return;
      _tourIdx = (i + 1) % TOUR_STOPS.length;
      if (_tourIdx === 0) { window.__tourStop(); return; }   // one full pass
      _tourRunStop(_tourIdx);
    }, 800);
  }, stop.hold - 400);
}

window.startTour = function() {
  if (window.__tourActive) return;
  window.__tourActive = true;
  _tourIdx = 0;

  if (aerialOrbit) toggleAerial(document.getElementById('btn-aerial'));
  if (document.pointerLockElement) document.exitPointerLock();

  // Hand the camera over completely. While active, updateControls() returns
  // early, so tickTourPan() is the only thing writing camera transform.
  if (typeof deactivate === 'function') deactivate();

  // Hide the interface — the tour is the film, not the tool.
  document.body.classList.add('tour-running');
  const btn = document.getElementById('btn-tour');
  if (btn) btn.classList.add('active');

  // Any input exits. Registered on the next tick so the click that STARTED the
  // tour does not immediately stop it.
  setTimeout(() => {
    if (window.__tourActive) {
      window.addEventListener('pointerdown', window.__tourStop, { once: true });
      window.addEventListener('keydown',     window.__tourStop, { once: true });
    }
  }, 400);

  _tourRunStop(0);
};

window.__tourStop = function() {
  if (!window.__tourActive) return;
  window.__tourActive = false;
  _tourPan = null;
  if (typeof activate === 'function') activate();   // hand the camera back
  if (_tourRAF)   cancelAnimationFrame(_tourRAF);
  if (_tourTimer) clearTimeout(_tourTimer);
  _tourRAF = null; _tourTimer = null;
  if (_tourFadeEl) _tourFadeEl.style.opacity = '0';
  if (_tourCardEl) _tourCardEl.style.opacity = '0';
  document.body.classList.remove('tour-running');
  const btn = document.getElementById('btn-tour');
  if (btn) btn.classList.remove('active');
  setCaption('');
};



// ── FULLSCREEN ───────────────────────────────────────────────────────────────
// Same outcome as F11, but reachable from inside the estate. On a web-hosted
// experience the address bar, tab strip and bookmarks can take 100-150px of
// vertical space, which is a real loss on a laptop and worse on a tablet.
// Requests fullscreen on documentElement rather than the canvas so the overlay
// UI comes with it — fullscreening just the canvas would leave the controls
// behind.
// GUARD: on a laptop with BOTH touch and mouse, a single tap fires a touch
// event AND a synthesised mouse click. Two toggles land in ~300ms, so it enters
// fullscreen and immediately exits — which is exactly the reported symptom.
// A short lockout collapses the pair into one action.
let _fsLock = 0;
window.toggleFullscreen = function () {
  const now = performance.now();
  if (now - _fsLock < 600) return;
  _fsLock = now;
  const el = document.documentElement;
  const isFs = document.fullscreenElement || document.webkitFullscreenElement;
  try {
    if (!isFs) {
      (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen).call(el);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen).call(document);
    }
  } catch (e) {
    console.warn('[XIX] Fullscreen unavailable:', e.message);
  }
};

// Block the gestures that were breaking fullscreen on tablets. A two-finger
// pinch or an edge swipe inside the canvas is interpreted by the browser as
// zoom / navigation, which resizes the visual viewport and can exit fullscreen.
// Registered non-passive because preventDefault is the whole point.
(function _guardFullscreenGestures() {
  const canvas = document.getElementById('world-canvas');
  if (!canvas) return;
  canvas.addEventListener('touchmove', (e) => {
    // Multi-touch inside the canvas is orbit/zoom for US, never for the page.
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  // Ctrl+wheel is browser zoom, which also breaks the fullscreen layout.
  canvas.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  // iOS Safari gesture events — no-ops elsewhere, essential on iPad.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev =>
    canvas.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));
  // A drag that begins on the canvas must never start a text selection.
  canvas.addEventListener('selectstart', (e) => e.preventDefault());
})();

// Keep the label in sync, including when the user leaves fullscreen with Esc or
// F11 rather than the button — otherwise it lies about the current state.
['fullscreenchange', 'webkitfullscreenchange'].forEach(ev =>
  document.addEventListener(ev, () => {
    const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
    const lbl = document.getElementById('fs-label');
    const btn = document.getElementById('btn-fullscreen');
    if (lbl) lbl.textContent = on ? 'Exit Full' : 'Fullscreen';
    if (btn) btn.classList.toggle('active', on);
    // The canvas must be resized to the new viewport or the render stays at the
    // old size and is stretched.
    // Resize twice. Several browsers still report the OLD viewport size in the
    // first fullscreenchange tick, so a single resize leaves the canvas at the
    // previous dimensions and stretched.
    try { resizeWorldNow(); } catch (e) {}
    setTimeout(() => { try { resizeWorldNow(); } catch (e) {} }, 150);
    setTimeout(() => { try { resizeWorldNow(); } catch (e) {} }, 450);
  })
);

// F key as a shortcut, consistent with M for mute and D for diagnostics.
document.addEventListener('keydown', (e) => {
  if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.repeat) return;   // holding F must not toggle repeatedly
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!document.getElementById('world-overlay')?.classList.contains('open')) return;
    e.preventDefault();
    window.toggleFullscreen();
  }
});



// ═══════════════════════════════════════════════════════════════════════════
// CONTEXTUAL HINTS  —  a few, at the right moment, never a wall of tips
// ═══════════════════════════════════════════════════════════════════════════
// Rule applied here: a hint appears only at a moment the interface has just
// CHANGED STATE in a way the user did not initiate, and only ONCE per session
// for that state. Persistent instructions belong in the Controls panel; hints
// are for "something just happened, here is what it means".
// Anything shown more than once becomes noise the user learns to ignore.
const _hintsShown = new Set();
let _hintEl = null, _hintTimer = null;

function showHint(text, opts = {}) {
  const key = opts.key || text;
  if (!opts.repeat && _hintsShown.has(key)) return;   // once per session
  _hintsShown.add(key);

  if (!_hintEl) {
    _hintEl = document.createElement('div');
    _hintEl.id = 'xix-hint';
    _hintEl.style.cssText =
      'position:fixed;left:50%;bottom:16%;transform:translateX(-50%);z-index:10040;' +
      'background:rgba(8,18,10,0.93);border:1px solid rgba(201,168,76,0.5);' +
      'border-radius:8px;padding:10px 16px;font-family:Inter,system-ui,sans-serif;' +
      'font-size:12.5px;color:#f2e9d0;pointer-events:none;opacity:0;' +
      'transition:opacity 0.5s ease;box-shadow:0 6px 22px rgba(0,0,0,0.5);' +
      'max-width:min(420px,88vw);text-align:center;line-height:1.4;';
    document.body.appendChild(_hintEl);
  }
  _hintEl.textContent = text;
  _hintEl.style.opacity = '1';
  if (_hintTimer) clearTimeout(_hintTimer);
  _hintTimer = setTimeout(() => { if (_hintEl) _hintEl.style.opacity = '0'; }, opts.ms || 4200);
}
window.showHint = showHint;

// ═══════════════════════════════════════════════════════════════════════════
// INTERIOR MODE GATE  —  one switch, every conflicting system off
// ═══════════════════════════════════════════════════════════════════════════
// Standing inside a villa, FIVE systems were fighting each other:
//   1. The plot overlay is now a BOX enclosing the building (v=66), so from
//      inside you are literally standing in a translucent green cube — that is
//      the green tint over everything.
//   2. Hover picking kept raycasting plots, so looking around re-selected the
//      house you were standing in.
//   3. Click picking opened the property panel every time you clicked to look,
//      which is why clicking to move selected the building instead.
//   4. Eye-height smoothing (_targetEyeY) kept pulling the camera toward 1.72m
//      while rooms sit at floorY 0.0 or 2.85 — the camera drifting up and down
//      continuously is these two fighting frame by frame.
//   5. AVAILABLE badges still rendered through the walls.
// isInteriorMode() is now the single source of truth and every one of those
// systems checks it.
// Every panel that asks for input must free the cursor. Individual call sites
// kept getting missed, so this is the one helper they all use — and it also
// shows the contextual hint, so the two can never drift apart.
function releaseCursorForPanel(hintText) {
  if (document.pointerLockElement) document.exitPointerLock();
  if (typeof window._xixSuspendLook === 'function') window._xixSuspendLook(true);
  if (hintText) showHint(hintText);
}
window.releaseCursorForPanel = releaseCursorForPanel;

function isInteriorMode() {
  return document.body.classList.contains('interior-open');
}
window.isInteriorMode = isInteriorMode;

// Hide/show everything that only makes sense outdoors.
function _setExteriorUIVisible(visible) {
  try {
    if (typeof plotRegistry === 'undefined') return;
    plotRegistry.forEach(plot => {
      if (plot.overlay) {
        // Park the overlay out of the way entirely rather than only fading it:
        // an invisible box still sits around you and can still be raycast.
        plot.overlay.visible = visible ? plot.overlay.visible : false;
        plot.overlay.userData._suppressed = !visible;
      }
      if (plot.badgeSprite) plot.badgeSprite.visible = false;   // re-evaluated by the cull each frame
    });
    if (typeof setHoveredPlot === 'function') window.setHoveredPlot(null);
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILDING COLLISION  —  you cannot walk through a house
// ═══════════════════════════════════════════════════════════════════════════
// Walking through a villa exposed the untextured inside of an exterior shell,
// which looks broken and undoes the quality of everything around it. Interiors
// are a CURATED experience — the "Inside ·" viewpoints and Step Inside — not
// something to stumble into.
// Implemented as a push-out rather than a hard stop: if the camera ends a frame
// inside a footprint, it is moved to the nearest point just outside. That slides
// along walls naturally instead of sticking, which is what a hard stop does.
// Runs on the plot registry, so every villa, loft and apartment is covered
// automatically and nothing needs registering by hand.
const COLLIDE_PAD = 1.1;          // body radius — keeps the camera off the wall
let _collideBoxes = null;

function _buildCollisionBoxes() {
  _collideBoxes = [];
  plotRegistry.forEach(plot => {
    if (!plot.overlay || !plot.overlay.geometry || !plot.overlay.geometry.parameters) return;
    const g = plot.overlay.geometry.parameters;
    if (!g.width || !g.depth) return;           // skip anything not a box
    _collideBoxes.push({
      x: plot.x, z: plot.z, ry: plot.ry || 0,
      // The overlay box is 0.72 of the plot footprint; the building itself is
      // smaller still, so collide against a slightly tighter volume than the
      // highlight or doorways feel unreachable.
      hw: (g.width  * 0.5) * 0.86 + COLLIDE_PAD,
      hd: (g.depth  * 0.5) * 0.86 + COLLIDE_PAD,
    });
  });
}

function _resolveBuildingCollision(camera) {
  if (window.__tourActive) return;                 // the tour flies its own path
  if (document.body.classList.contains('interior-open')) return;  // curated interior
  if (aerialOrbit) return;                         // aerial is above everything
  if (!_collideBoxes) _buildCollisionBoxes();
  if (!_collideBoxes.length) return;
  if (camera.position.y > 14) return;              // above roof height — no collision

  const px = camera.position.x, pz = camera.position.z;
  for (const b of _collideBoxes) {
    // Transform the camera into the box's local frame so rotated units
    // (the north arc, all four corners) collide correctly rather than using an
    // axis-aligned approximation.
    const dx = px - b.x, dz = pz - b.z;
    const c = Math.cos(-b.ry), sn = Math.sin(-b.ry);
    const lx = dx * c - dz * sn;
    const lz = dx * sn + dz * c;
    if (Math.abs(lx) >= b.hw || Math.abs(lz) >= b.hd) continue;   // outside

    // Inside: push out along whichever axis needs the least movement, so the
    // camera slides along the nearest wall instead of popping across the room.
    const ox = b.hw - Math.abs(lx);
    const oz = b.hd - Math.abs(lz);
    let nlx = lx, nlz = lz;
    if (ox < oz) nlx = (lx < 0 ? -b.hw : b.hw);
    else         nlz = (lz < 0 ? -b.hd : b.hd);

    const cc = Math.cos(b.ry), ss = Math.sin(b.ry);
    camera.position.x = b.x + (nlx * cc - nlz * ss);
    camera.position.z = b.z + (nlx * ss + nlz * cc);
    return;   // one resolution per frame is enough and avoids jitter between two boxes
  }
}
window._rebuildCollision = _buildCollisionBoxes;

// ═══════════════════════════════════════════════════════════════════════════
// FLY TO UNIT  —  aerial click takes you to the property
// ═══════════════════════════════════════════════════════════════════════════
// Selecting a plot from the air used to only open the reservation pane, which
// left the buyer looking at a form with no idea where that unit actually sits.
// Now the camera travels to a standing position in front of the unit, facing
// it, so the pane and the property are on screen together.
// Position is derived from the plot's own rotation: every unit stores `ry`, and
// its frontage is the direction it faces, so we stand off along that vector.
function flyToUnit(plotKey, opts = {}) {
  const plot = plotRegistry.get(String(plotKey));
  if (!plot) return false;
  const camera = getCamera();
  if (!camera) return false;

  const standOff = opts.distance || 26;   // metres in front of the facade
  const eyeY     = opts.height   || 6.5;  // slightly raised — reads the whole unit

  // A villa placed with rotation ry faces -Z rotated by ry. Standing in front
  // means stepping out along that facing vector, then looking back at the unit.
  const ry = plot.ry || 0;
  const fx = Math.sin(ry), fz = Math.cos(ry);    // unit's facing vector, same convention
  const camX = plot.x + fx * standOff;
  const camZ = plot.z + fz * standOff;

  // Yaw so the camera looks from its position back toward the unit.
  // CONVENTION (derived from the two viewpoints known to be correct — 'villas'
  // at yaw +PI/2 facing +X, and 'clubhouse' at yaw PI facing -Z):
  //     direction = (sin yaw, cos yaw)   =>   yaw = atan2(dx, dz)
  // This previously used atan2(dx, -dz), which flips the Z component and would
  // have pointed the camera away from the unit on any non-axis-aligned plot —
  // i.e. the whole north arc and all four corners.
  const yaw = Math.atan2(plot.x - camX, plot.z - camZ);

  if (aerialOrbit) toggleAerial(document.getElementById('btn-aerial'));

  _cinematicFlyTo(
    { x: camX, y: eyeY, z: camZ },
    yaw, -0.06,
    `Plot ${plotKey} — ${plot.type || 'Villa'}`,
    opts.duration || 1500
  );
  return true;
}
window.flyToUnit = flyToUnit;

// Smooth camera move built on setView(pos, yaw, pitch) — the same call
// teleportTo uses, so this behaves identically to a viewpoint jump except that
// it is interpolated rather than instant.
let _flyRAF = null;
function _cinematicFlyTo(toPos, toYaw, toPitch, caption, ms = 1500) {
  const camera = getCamera();
  if (!camera) return;
  if (_flyRAF) cancelAnimationFrame(_flyRAF);

  const fromPos = camera.position.clone();
  const fromYaw = (typeof getYaw === 'function') ? getYaw() : 0;

  // Shortest angular path — without this the camera can spin the long way round.
  let dYaw = toYaw - fromYaw;
  while (dYaw >  Math.PI) dYaw -= Math.PI * 2;
  while (dYaw < -Math.PI) dYaw += Math.PI * 2;

  const t0 = performance.now();
  const ease = t => (t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2);  // easeInOutCubic

  (function step(now) {
    const t = Math.min(1, (now - t0) / ms);
    const k = ease(t);
    setView(
      [ fromPos.x + (toPos.x - fromPos.x) * k,
        fromPos.y + (toPos.y - fromPos.y) * k,
        fromPos.z + (toPos.z - fromPos.z) * k ],
      fromYaw + dYaw * k,
      toPitch * k
    );
    if (t < 1) _flyRAF = requestAnimationFrame(step);
    else {
      _flyRAF = null;
      if (caption) setCaption(caption);
    }
  })(t0);
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-FADING CHROME  —  full-screen presence without hiding the controls
// ═══════════════════════════════════════════════════════════════════════════
// Goal: the estate fills the frame and the interface recedes, without a
// first-time viewer ever feeling lost.
//
// DESIGN NOTE — one deliberate deviation from "reveal on hover over that area":
// hover-zone-only reveal is how good interfaces become frustrating. The user
// has to already know the controls are there AND aim at the right strip. Every
// mature full-screen interface (video players, map tools, game HUDs) instead
// treats ANY intentional input as a request for the interface: move the mouse
// and the chrome returns wherever the cursor is. The edge hot-zones are kept as
// an additional affordance for the instinctive "sweep to the edge" gesture, and
// hovering a strip directly PINS it open for as long as the cursor stays there.
//
// Safeguards that matter more than the effect itself:
//   • It never fully disappears — idle is 0.28 opacity, not 0. A new user can
//     always see that controls exist.
//   • Clicks work at any opacity; pointer-events are never disabled.
//   • It never fades while a panel is open, or during the opening grace period.
//   • A pin locks it permanently visible, and that choice is remembered.
//   • A one-time hint explains the behaviour on first visit.
const CHROME_IDLE_MS = 2600;   // inactivity before the interface settles back
let _chromeIdleTimer = null;
let _chromeLocked = false;
let _chromeHoverHold = false;

function _chromePanelOpen() {
  // BUG THAT BROKE THE FADE: this used to end with
  //   return !!document.querySelector('.plot-panel, #xix-plot-panel');
  // but #plot-panel is a PERMANENT element in index.html (line ~541), so the
  // selector always matched, _chromePanelOpen() was always true, and the chrome
  // never faded once. Existence is not the same as visibility — every check
  // below tests whether the element is actually SHOWN.
  const isShown = (el) => {
    if (!el) return false;
    if (el.style.display === 'none') return false;
    if (el.classList.contains('open') || el.classList.contains('active')) return true;
    // Computed check catches CSS-driven visibility (transform/opacity panels).
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    return parseFloat(cs.opacity || '1') > 0.05 && el.offsetParent !== null;
  };
  return ['sound-mixer', 'controls-panel', 'reservation-modal', 'plot-panel']
    .some(id => isShown(document.getElementById(id)));
}

function _chromeWake() {
  // During the tour the interface stays hidden regardless of input — otherwise
  // the pan itself would keep waking it and the chrome would flicker on screen
  // through the whole film.
  if (window.__tourActive) return;
  if (_chromeLocked) return;
  document.body.classList.remove('chrome-idle');
  if (_chromeIdleTimer) clearTimeout(_chromeIdleTimer);
  _chromeIdleTimer = setTimeout(() => {
    // Hold the interface up while the cursor rests on it, while a panel is
    // open, or while the user is typing — fading mid-task is hostile.
    if (_chromeLocked || _chromeHoverHold || _chromePanelOpen()) { _chromeWake(); return; }
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) { _chromeWake(); return; }
    document.body.classList.add('chrome-idle');
  }, CHROME_IDLE_MS);
}

function _setChromeLocked(locked) {
  _chromeLocked = locked;
  document.body.classList.toggle('chrome-locked', locked);
  const pin = document.getElementById('chrome-pin');
  if (pin) {
    pin.classList.toggle('active', locked);
    pin.title = locked ? 'Controls pinned — click to auto-hide' : 'Auto-hiding — click to keep controls visible';
    pin.setAttribute('aria-pressed', locked ? 'true' : 'false');
  }
  try { localStorage.setItem('xix_chrome_locked', locked ? '1' : '0'); } catch (e) {}
  if (locked) document.body.classList.remove('chrome-idle');
  else _chromeWake();
}

function initAutoFadingChrome() {
  if (document.getElementById('chrome-pin')) return;

  // NOTE: there are deliberately NO hot-zone ELEMENTS here.
  // A previous version created two invisible full-width divs (92px tall, fixed
  // top and bottom) to catch mouseenter. They sat directly over the topbar and
  // the viewpoint strip and — because their z-index was above the controls —
  // they swallowed every click. The controls became completely unresponsive.
  // `pointer-events: none` is not an option either, because that also kills the
  // mouseenter they exist for.
  // The edge behaviour needs no DOM at all: the global mousemove handler below
  // already knows the cursor position, so proximity to the top/bottom edge is a
  // simple coordinate check. Nothing overlays the interface.

  // Pin
  const pin = document.createElement('button');
  pin.id = 'chrome-pin';
  pin.setAttribute('aria-label', 'Keep controls visible');
  pin.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14l-1.5-4.5V6a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v6.5L5 17z"/></svg>';
  pin.addEventListener('click', () => _setChromeLocked(!_chromeLocked));
  document.body.appendChild(pin);

  // Any intentional input counts as "show me the interface".
  ['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach(ev =>
    window.addEventListener(ev, _chromeWake, { passive: true }));

  // Mousemove additionally does the edge check that the old overlay divs did —
  // purely from coordinates, so nothing is layered over the controls.
  const EDGE = 96;
  window.addEventListener('mousemove', (e) => {
    _chromeHoverHold = (e.clientY < EDGE) || (e.clientY > window.innerHeight - EDGE);
    _chromeWake();
  }, { passive: true });

  // Restore the user's pin choice.
  let saved = '0';
  try { saved = localStorage.getItem('xix_chrome_locked') || '0'; } catch (e) {}
  _setChromeLocked(saved === '1');

  // GRACE PERIOD — never fade in the first few seconds. A viewer arriving for
  // the first time should see the full interface, read it, and only then have
  // it settle back once they have started exploring.
  if (!_chromeLocked) {
    document.body.classList.remove('chrome-idle');
    setTimeout(() => _chromeWake(), 3500);   // shorter grace — the effect must be felt
  }

  _showChromeHintOnce();
}

// One-time explanation. Without it, auto-hiding chrome is a surprise; with it,
// it reads as intentional design. Shown once ever, per browser.
function _showChromeHintOnce() {
  let seen = '0';
  try { seen = localStorage.getItem('xix_chrome_hint') || '0'; } catch (e) {}
  if (seen === '1') return;
  const hint = document.createElement('div');
  hint.id = 'chrome-hint';
  hint.innerHTML =
    'The controls dim while you explore — <strong>move your mouse</strong> to bring them back, ' +
    'or use the <strong>pin</strong> on the right to keep them visible.';
  document.body.appendChild(hint);
  setTimeout(() => { hint.style.display = 'block'; }, 4200);
  setTimeout(() => { hint.style.display = 'none'; }, 12000);
  try { localStorage.setItem('xix_chrome_hint', '1'); } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTROLS PANEL  —  everything you need to move and interact, in one place
// ═══════════════════════════════════════════════════════════════════════════
// A first-time viewer has no idea that hovering highlights a plot, that far
// plots need a double-click, or that the viewpoint strip exists. Nothing in the
// interface said so. This is grouped by what someone is trying to DO rather
// than by input device, because that is how people look for help.
let _ctrlPanelEl = null;

const CONTROL_SECTIONS = [
  { title: 'Moving around', items: [
    ['W A S D  /  Arrow keys', 'Walk through the estate'],
    ['Move the mouse',         'Look around'],
    ['Shift (hold)',           'Move faster'],
    ['Click the view once',    'Capture the mouse for smooth looking'],
    ['Esc',                    'Release the mouse'],
  ]},
  { title: 'Seeing the estate', items: [
    ['AERIAL',                 'Orbiting view of the whole estate — drag to steer'],
    ['Bottom strip',           'Jump to Centre Field, Clubhouse, Lake, Stables and more'],
    ['VILLAS ▸',               'Step inside a unit — ground floor, first floor, roof terrace'],
    ['TOUR',                   'Guided sequence through the estate'],
  ]},
  { title: 'Choosing a property', items: [
    ['Hover nearby',           'The plot lights up green and shows its number'],
    ['Click (close up)',       'Opens the property details'],
    ['Click twice (far away)', 'Confirms which plot you mean before opening'],
    ['Property Directory',     'Search all units by number or type'],
  ]},
  { title: 'Atmosphere', items: [
    ['TIME',                   'Morning, afternoon, sunset, night'],
    ['WEATHER',                'Clear, overcast, rain'],
    ['QUALITY',                'Fast, Balanced, Rich — lower it if movement feels heavy'],
    ['SOUND',                  'Per-element mixer and mute'],
  ]},
  { title: 'The interface', items: [
    ['Controls dim when idle', 'Keeps the estate full-screen — move the mouse to bring them back'],
    ['Pin (right edge)',       'Keeps the controls visible at all times'],
  ]},
  { title: 'Shortcuts', items: [
    ['F',                      'Fullscreen — hides the browser bars'],
    ['M',                      'Mute / unmute'],
    ['D',                      'Performance diagnostics'],
    ['Esc',                    'Release mouse, or close the estate view'],
  ]},
];

function _buildControlsPanel() {
  if (_ctrlPanelEl) return _ctrlPanelEl;
  const el = document.createElement('div');
  el.id = 'controls-panel';
  el.style.cssText =
    'position:fixed;top:88px;right:16px;z-index:10001;width:min(370px,92vw);' +
    'max-height:calc(100vh - 190px);overflow-y:auto;display:none;' +
    'background:rgba(8,18,10,0.97);border:1px solid rgba(201,168,76,0.4);border-radius:10px;' +
    'padding:16px 18px;font-family:Inter,system-ui,sans-serif;color:#eee;' +
    'box-shadow:0 10px 34px rgba(0,0,0,0.55);';

  el.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
      '<span style="color:#c9a84c;font-size:12px;font-weight:600;letter-spacing:1.2px;">CONTROLS</span>' +
      '<button id="ctrl-close" style="background:none;border:none;color:#888;font-size:17px;cursor:pointer;line-height:1;">&times;</button>' +
    '</div>' +
    CONTROL_SECTIONS.map(sec =>
      '<div style="margin-bottom:14px;">' +
        '<div style="font-size:10.5px;letter-spacing:1px;text-transform:uppercase;' +
          'color:rgba(201,168,76,0.75);margin-bottom:6px;">' + sec.title + '</div>' +
        sec.items.map(([k, v]) =>
          '<div style="display:flex;gap:10px;margin-bottom:5px;align-items:baseline;">' +
            '<span style="flex:0 0 132px;font-size:11.5px;color:#f2e9d0;font-weight:500;">' + k + '</span>' +
            '<span style="flex:1;font-size:11.5px;color:rgba(255,255,255,0.62);line-height:1.35;">' + v + '</span>' +
          '</div>').join('') +
      '</div>').join('') +
    '<div style="font-size:10.5px;color:rgba(255,255,255,0.35);border-top:1px solid rgba(255,255,255,0.09);padding-top:9px;">' +
      'Tip — if movement feels heavy, set QUALITY to Balanced or Fast. Quality adjusts itself automatically if the frame rate drops.' +
    '</div>';

  document.body.appendChild(el);
  el.querySelector('#ctrl-close').addEventListener('click', () => _toggleControlsPanel(false));
  _ctrlPanelEl = el;
  return el;
}

function _toggleControlsPanel(force) {
  const el = _buildControlsPanel();
  const open = (force !== undefined) ? force : (el.style.display === 'none');
  el.style.display = open ? 'block' : 'none';
  // Only one right-hand panel at a time, and free the cursor so it is usable.
  if (open) {
    if (_mixPanelEl) _mixPanelEl.style.display = 'none';
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
window.toggleControlsPanel = () => _toggleControlsPanel();

// Why is the chrome not fading? Run window._chromeState() in the console.
if (typeof window !== 'undefined') {
  window._chromeState = () => ({
    idle:      document.body.classList.contains('chrome-idle'),
    locked:    _chromeLocked,
    hoverHold: _chromeHoverHold,
    panelOpen: _chromePanelOpen(),
    idleMs:    CHROME_IDLE_MS,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SOUND MIXER PANEL  —  opens from the SOUND button
// ═══════════════════════════════════════════════════════════════════════════
// Mute alone was too blunt for a curated viewing: an agent may want the birds
// up and traffic gone, or the water forward while standing at the lake. Each
// slider drives a bus that sits between its sources and the master, so all the
// proximity and time-of-day logic keeps working underneath — the slider is a
// multiplier on top, never a replacement for it.
// The experience always OPENS at the designed default balance; Reset restores it.
let _mixPanelEl = null;

const MIX_ROWS = [
  { key:'master',  label:'Master',        hint:'Overall level' },
  { key:'birds',   label:'Birds & Nature', hint:'Time-of-day ambience' },
  { key:'water',   label:'Lake Water',     hint:'Audible near the crescent lake' },
  { key:'wind',    label:'Wind & Palms',   hint:'Along the west avenue' },
  { key:'horses',  label:'Horses',         hint:'Whinny, snort, hooves' },
  { key:'traffic', label:'Traffic',        hint:'Perimeter roads only' },
];

function _buildMixPanel() {
  if (_mixPanelEl) return _mixPanelEl;
  const levels = getMixLevels();
  const el = document.createElement('div');
  el.id = 'sound-mixer';
  el.style.cssText =
    'position:fixed;top:88px;right:16px;z-index:10001;width:290px;display:none;' +
    'background:rgba(8,18,10,0.97);border:1px solid rgba(201,168,76,0.4);border-radius:10px;' +
    'padding:14px 16px 12px;font-family:Inter,system-ui,sans-serif;color:#eee;' +
    'box-shadow:0 10px 34px rgba(0,0,0,0.55);';

  el.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">' +
      '<span style="color:#c9a84c;font-size:12px;font-weight:600;letter-spacing:1.2px;">SOUND MIXER</span>' +
      '<button id="mix-close" style="background:none;border:none;color:#888;font-size:17px;cursor:pointer;line-height:1;">&times;</button>' +
    '</div>' +
    // Quick mute stays one tap away — the SOUND button now opens this panel
    // rather than muting directly, so mute needs a home inside it. M also works.
    '<button id="mix-mute" style="width:100%;margin-bottom:12px;background:rgba(255,255,255,0.06);' +
      'border:1px solid rgba(255,255,255,0.16);color:#e8e2d2;padding:8px;border-radius:6px;' +
      'font-size:11.5px;font-weight:600;letter-spacing:0.6px;cursor:pointer;">' +
      (isAudioMuted() ? 'UNMUTE ALL  (M)' : 'MUTE ALL  (M)') + '</button>' +
    MIX_ROWS.map(r =>
      '<div style="margin-bottom:11px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:baseline;">' +
          '<label style="font-size:12.5px;color:#e8e2d2;">' + r.label + '</label>' +
          '<span id="mixval-' + r.key + '" style="font-size:11px;color:#c9a84c;font-variant-numeric:tabular-nums;">' +
            Math.round((levels[r.key] ?? 1) * 100) + '%</span>' +
        '</div>' +
        '<input type="range" id="mix-' + r.key + '" min="0" max="120" value="' +
          Math.round((levels[r.key] ?? 1) * 100) + '" ' +
          'style="width:100%;accent-color:#c9a84c;margin:3px 0 1px;cursor:pointer;">' +
        '<div style="font-size:10px;color:rgba(255,255,255,0.38);">' + r.hint + '</div>' +
      '</div>').join('') +
    '<button id="mix-reset" style="width:100%;margin-top:4px;background:rgba(201,168,76,0.14);' +
      'border:1px solid rgba(201,168,76,0.45);color:#c9a84c;padding:8px;border-radius:6px;' +
      'font-size:11.5px;font-weight:600;letter-spacing:0.6px;cursor:pointer;">RESET TO DEFAULTS</button>';

  document.body.appendChild(el);

  MIX_ROWS.forEach(r => {
    const slider = el.querySelector('#mix-' + r.key);
    const out    = el.querySelector('#mixval-' + r.key);
    slider.addEventListener('input', () => {
      const pct = parseInt(slider.value, 10);
      out.textContent = pct + '%';
      setMixLevel(r.key, pct / 100);
    });
  });

  el.querySelector('#mix-close').addEventListener('click', () => _toggleMixPanel(false));
  el.querySelector('#mix-mute').addEventListener('click', () => {
    window.toggleSound();
    el.querySelector('#mix-mute').textContent = isAudioMuted() ? 'UNMUTE ALL  (M)' : 'MUTE ALL  (M)';
  });
  el.querySelector('#mix-reset').addEventListener('click', () => {
    resetMixLevels();
    const d = getMixDefaults();
    MIX_ROWS.forEach(r => {
      const pct = Math.round((d[r.key] ?? 1) * 100);
      el.querySelector('#mix-' + r.key).value = pct;
      el.querySelector('#mixval-' + r.key).textContent = pct + '%';
    });
    if (typeof showNotification === 'function') showNotification('Sound levels reset to defaults');
  });

  _mixPanelEl = el;
  return el;
}

function _toggleMixPanel(force) {
  const el = _buildMixPanel();
  const open = (force !== undefined) ? force : (el.style.display === 'none');
  el.style.display = open ? 'block' : 'none';
  if (open) {
    if (_ctrlPanelEl) _ctrlPanelEl.style.display = 'none';
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
window.toggleSoundMixer = () => _toggleMixPanel();

function _syncSoundBtn(muted) {
  const btn = document.getElementById('btn-sound');
  if (!btn) return;
  btn.classList.toggle('active', !muted);
  btn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  btn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  btn.title = muted ? 'Sound off — click to unmute' : 'Sound on — click to mute';
  // Make the state unmistakable at a glance: muted dims the whole control and
  // drains the gold accent, rather than relying on the small icon change alone.
  btn.style.opacity = muted ? '0.45' : '';
  const icon = btn.querySelector('.sound-icon');
  if (icon) {
    icon.style.color = muted ? '#8a8a8a' : '';
    icon.innerHTML = muted
      ? '<path d="M11 5 6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>'
      : '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>';
  }
  const label = btn.querySelector('.world-btn-label');
  if (label) label.textContent = muted ? 'Muted' : 'Sound';
}
window.toggleSound = function() {
  // NOTE: this previously called setAudioMuted/isAudioMuted behind
  // `typeof x === 'function'` guards, but neither was imported from scene.js —
  // so both guards were false, the audio was never touched, and the button
  // only swapped its own icon. They are imported now and called directly, so
  // any future breakage surfaces as an error instead of silently doing nothing.
  const nowMuted = !isAudioMuted();
  setAudioMuted(nowMuted);

  // Unmuting from a click is a user gesture — a good moment to resume an
  // AudioContext the browser suspended under its autoplay policy.
  if (!nowMuted && typeof enableAudio === 'function') {
    try { enableAudio(); } catch (e) {}
  }

  _syncSoundBtn(nowMuted);
  // Keep the mixer's mute button label correct if M was used while it is open.
  const mb = document.getElementById('mix-mute');
  if (mb) mb.textContent = nowMuted ? 'UNMUTE ALL  (M)' : 'MUTE ALL  (M)';
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
      // ── VIEW FROM INSIDE THE UNIT ──────────────────────────────────────────
      // The point of these is simple: stand where a buyer would stand inside
      // their own home, at each floor level, and look out at the estate. Not a
      // modelled room — the view THROUGH the unit, which is what is actually
      // being sold. Elevation is what changes: higher floor, more estate.
      // Previously only the WEST row existed, so a buyer looking at an east or
      // north-arc plot had no way to see their own outlook.
      // Floor heights: ground 2m, first 5.5m, roof terrace 9m.
      interior: [
        // ---- WEST ROW (x=-162) — looks east across the field (+X, yaw +PI/2)
        { label:'West · Ground Floor',   pos:[-162,2,0],    yaw:Math.PI/2,  pitch:0,     caption:'West villa · ground floor — polo field ahead' },
        { label:'West · First Floor',    pos:[-162,5.5,0],  yaw:Math.PI/2,  pitch:-0.10, caption:'West villa · first floor — elevated polo view' },
        { label:'West · Roof Terrace',   pos:[-162,9,0],    yaw:Math.PI/2,  pitch:-0.15, caption:'West villa · roof terrace — panoramic estate view' },
        { label:'West · Garden',         pos:[-148,1.72,0], yaw:-Math.PI/2, pitch:0,     caption:'Private garden — looking back at your villa' },

        // ---- EAST ROW (x=+162) — looks west across the field (-X, yaw -PI/2)
        { label:'East · Ground Floor',   pos:[162,2,0],     yaw:-Math.PI/2, pitch:0,     caption:'East villa · ground floor — polo field ahead' },
        { label:'East · First Floor',    pos:[162,5.5,0],   yaw:-Math.PI/2, pitch:-0.10, caption:'East villa · first floor — elevated polo view' },
        { label:'East · Roof Terrace',   pos:[162,9,0],     yaw:-Math.PI/2, pitch:-0.15, caption:'East villa · roof terrace — clubhouse and field' },

        // ---- NORTH ARC (z=-108) — looks south over the lake to the field
        { label:'North · Ground Floor',  pos:[0,2,-108],    yaw:Math.PI,    pitch:0,     caption:'North arc · ground floor — lake in the foreground' },
        { label:'North · First Floor',   pos:[0,5.5,-108],  yaw:Math.PI,    pitch:-0.10, caption:'North arc · first floor — over the lake to the field' },
        { label:'North · Roof Terrace',  pos:[0,9,-108],    yaw:Math.PI,    pitch:-0.16, caption:'North arc · roof terrace — lake and full estate' },

        // ---- SOUTH ROW (z=+88) — looks north up the length of the field
        { label:'South · Ground Floor',  pos:[-65,2,88],    yaw:0,          pitch:0,     caption:'South villa · ground floor — field and lake beyond' },
        { label:'South · First Floor',   pos:[-65,5.5,88],  yaw:0,          pitch:-0.10, caption:'South villa · first floor — full field length' },
        { label:'South · Roof Terrace',  pos:[-65,9,88],    yaw:0,          pitch:-0.16, caption:'South villa · roof terrace — estate panorama' },
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
      // Lofts are two-storey, so ground and upper terrace only (no roof level).
      // West column faces the field across the compound; the north row looks
      // south down the length of the estate.
      interior: [
        { label:'West Col · Ground',    pos:[-200,2,10],    yaw:Math.PI/2,  pitch:0,     caption:'Loft · ground floor — looking toward the field' },
        { label:'West Col · Terrace',   pos:[-200,5.2,10],  yaw:Math.PI/2,  pitch:-0.10, caption:'Loft · upper terrace — elevated estate view' },
        { label:'North Row · Ground',   pos:[-200,2,-165],  yaw:Math.PI,    pitch:0,     caption:'North loft row · ground floor — estate ahead' },
        { label:'North Row · Terrace',  pos:[-200,5.2,-165],yaw:Math.PI,    pitch:-0.10, caption:'North loft row · terrace — over the estate' },
        { label:'Street Approach',      pos:[-180,1.72,10], yaw:-Math.PI/2, pitch:0,     caption:'Looking back at the loft terrace row' },
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
      'lake_north':   { pos:[0,    1.72,   -80], yaw: Math.PI,     pitch:-0.02,  caption: 'Crescent Lake — across the water to the north arc' },
      // Stables
      // Was (-280,80): 135m short of the compound, facing +X at empty ground.
      // Stables GLB is at (-320,120) with its cobble yard at (-355,90). Now
      // standing in the yard looking north-east at the blocks. yaw=atan2(25,25).
      'stables':      { pos:[-345, 1.72,  95],   yaw: Math.PI/4,   pitch: 0,     caption: 'Stables — cobbled yard, blocks ahead' },
      // Training
      // Was (-175,0): 85m east of the field, facing +X across empty laterite.
      // Training field spans x -352..-168, z -97..21, oriented north-south.
      // Now standing at its south end looking down the full length. yaw=PI (-Z).
      'training':     { pos:[-260, 1.72,   12],  yaw: Math.PI,     pitch: -0.02, caption: 'Training Field — polo academy, looking north' },
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

    // M — mute / unmute. Ignored while typing in the reservation form or the
    // property search box, and only active while the 3D world is open.
    if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing) return;
      if (!document.getElementById("world-overlay")?.classList.contains("open")) return;
      e.preventDefault();
      window.toggleSound();
    }

    // D — diagnostics panel (draw calls, triangles, GPU, load-time [XIX] logs)
    if ((e.key === 'd' || e.key === 'D') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t2 = e.target;
      if (t2 && (t2.tagName === 'INPUT' || t2.tagName === 'TEXTAREA' || t2.isContentEditable)) return;
      e.preventDefault();
      _toggleDiag();
    }
  });
}

function closeWorld(){
  document.body.classList.remove('in-estate');
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

// Brief, non-intrusive toast shown when the governor auto-drops quality, so the
// visual change isn't mysterious. Auto-dismisses; reuses one element.
let _qualityNoteEl = null, _qualityNoteTimer = null;
// ── QUALITY SUGGESTION PROMPT ───────────────────────────────────────────────
// The governor used to switch quality by itself. Two problems with that: the
// picture changed under you with no way to refuse, and because step-down had no
// recovery path a single bad window — reliably produced by the 1.9M-triangle
// decode during load — pinned the whole session to fast.
//
// It now only ASKS. One prompt at a time, dismissible, and "Not now" suppresses
// further suggestions for the rest of the session so it can never nag.
let _qualityPromptEl = null;
let _qualitySuggestionsMuted = false;

function _suggestQualityChange(tier, reason) {
  if (_qualitySuggestionsMuted) return;
  if (_qualityPromptEl && _qualityPromptEl.isConnected) return;   // one at a time

  const label = tier.charAt(0).toUpperCase() + tier.slice(1);
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;bottom:96px;left:50%;transform:translateX(-50%) translateY(8px);' +
    'background:rgba(10,20,12,0.94);color:#e8e4d9;padding:14px 18px;border-radius:10px;' +
    'font-family:Inter,sans-serif;font-size:13px;z-index:9999;' +
    'border:1px solid rgba(201,168,76,0.4);box-shadow:0 8px 28px rgba(0,0,0,0.45);' +
    'opacity:0;transition:opacity .3s,transform .3s;max-width:min(92vw,420px);';
  el.innerHTML =
    `<div style="margin-bottom:4px;color:#c9a84c;font-weight:600;">Switch to ${label} mode?</div>` +
    `<div style="opacity:.75;margin-bottom:11px;line-height:1.4;">${reason}</div>` +
    `<div style="display:flex;gap:8px;justify-content:flex-end;">` +
      `<button data-a="no"  style="background:none;border:1px solid rgba(232,228,217,0.25);color:#e8e4d9;padding:6px 14px;border-radius:6px;font:inherit;cursor:pointer;">Not now</button>` +
      `<button data-a="yes" style="background:#c9a84c;border:1px solid #c9a84c;color:#0a140c;padding:6px 16px;border-radius:6px;font:inherit;font-weight:600;cursor:pointer;">Yes</button>` +
    `</div>`;
  (document.getElementById('world-overlay') || document.body).appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)'; });
  _qualityPromptEl = el;

  const close = () => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
    _qualityPromptEl = null;
  };
  el.querySelector('[data-a="yes"]').onclick = () => {
    if (typeof window.switchPerfMode === 'function') window.switchPerfMode(tier, true);
    close();
  };
  el.querySelector('[data-a="no"]').onclick = () => {
    // Asked once and declined — the answer does not change three minutes later.
    _qualitySuggestionsMuted = true;
    console.log('[XIX] Quality suggestions muted for this session');
    close();
  };
  // No auto-dismiss: a prompt that vanishes mid-read is worse than none.
}

function _showQualityNote(tier) {
  const label = tier.charAt(0).toUpperCase() + tier.slice(1);
  if (!_qualityNoteEl) {
    _qualityNoteEl = document.createElement('div');
    _qualityNoteEl.style.cssText = 'position:fixed;bottom:88px;left:50%;transform:translateX(-50%);background:rgba(10,20,12,0.9);color:#c9a84c;padding:9px 16px;border-radius:8px;font-family:Inter,sans-serif;font-size:12.5px;z-index:9998;border:1px solid rgba(201,168,76,0.35);pointer-events:none;transition:opacity 0.4s;opacity:0;';
    (document.getElementById('world-overlay') || document.body).appendChild(_qualityNoteEl);
  }
  _qualityNoteEl.textContent = `Graphics set to ${label} for smoother performance`;
  _qualityNoteEl.style.opacity = '1';
  if (_qualityNoteTimer) clearTimeout(_qualityNoteTimer);
  _qualityNoteTimer = setTimeout(() => { if (_qualityNoteEl) _qualityNoteEl.style.opacity = '0'; }, 3200);
}


// ═══════════════════════════════════════════════════════════════════════════
// DIAGNOSTICS PANEL  —  press D to toggle
// ═══════════════════════════════════════════════════════════════════════════
// Shows the numbers that actually decide performance work, so decisions are
// made from measurement rather than estimate. Read it like this:
//   DRAW CALLS — how many separate things the CPU asks the GPU to draw each
//     frame. Above ~1500 on integrated graphics is where it starts to hurt.
//   TRIANGLES  — raw geometry load. Millions here means the models are too
//     detailed for the distance, which needs LOD, not batching.
// Those two point at completely different fixes, which is why the number
// matters: high calls + low triangles = batch; low calls + high triangles = LOD.
let _diagEl = null, _diagOn = false, _diagLog = [];
let _lastFpsForDiag = 0;

// Capture every [XIX] console line so the panel can show load-time stats that
// have already scrolled past — no need to catch them live or reload.
(function _hookXIXLogs(){
  const orig = console.log.bind(console);
  console.log = function(...a){
    try {
      const first = a[0];
      if (typeof first === 'string' && first.startsWith('[XIX]')) {
        _diagLog.push(a.join(' '));
        if (_diagLog.length > 14) _diagLog.shift();
      }
    } catch(e){}
    orig(...a);
  };
})();

function _toggleDiag() {
  _diagOn = !_diagOn;
  if (!_diagEl) {
    _diagEl = document.createElement('div');
    _diagEl.style.cssText =
      'position:fixed;top:96px;left:16px;z-index:100001;background:rgba(6,14,8,0.94);' +
      'border:1px solid rgba(201,168,76,0.45);border-radius:8px;padding:12px 14px;' +
      'font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.55;' +
      'color:#dfe8dc;white-space:pre;pointer-events:none;max-width:min(560px,80vw);' +
      'box-shadow:0 6px 22px rgba(0,0,0,0.5);';
    document.body.appendChild(_diagEl);
  }
  _diagEl.style.display = _diagOn ? 'block' : 'none';
}

let _diagFrame = 0;
function _tickDiag(fps) {
  if (!_diagOn || !_diagEl) return;
  if ((_diagFrame++ % 12) !== 0) return;   // 5Hz is plenty for reading numbers
  const r = getRenderer();
  if (!r) return;
  const i = r.info;
  const calls = i.render.calls;
  const tris  = i.render.triangles;
  const verdict =
    calls > 1200 ? 'DRAW CALLS are the bottleneck -> batch/merge more'
    : tris > 3.5e6 ? 'TRIANGLES are the bottleneck -> needs real LOD'
    : 'within budget';
  _diagEl.textContent =
    'PROJECT XIX — DIAGNOSTICS   (press D to hide)\n' +
    '──────────────────────────────────────────────\n' +
    `FPS          ${fps ? fps.toFixed(0) : '—'}\n` +
    `QUALITY      ${PERF_MODE}\n` +
    `GPU          ${(window._xixGPUName || 'unknown').slice(0, 46)}\n` +
    `GPU TIER     ${window._xixGPUTier || '—'}\n` +
    '──────────────────────────────────────────────\n' +
    `DRAW CALLS   ${calls}\n` +
    `TRIANGLES    ${tris.toLocaleString()}\n` +
    `GEOMETRIES   ${i.memory.geometries}\n` +
    `TEXTURES     ${i.memory.textures}\n` +
    `SHADERS      ${r.info.programs ? r.info.programs.length : '—'}\n` +
    '──────────────────────────────────────────────\n' +
    `VERDICT      ${verdict}\n` +
    `VILLA MODEL  ${window._xixVillaFallbackActive ? '** BOX FALLBACK — GLB FAILED **'
                    : (window._xixVillaLowActive ? 'GLB + low LOD' : 'GLB (full only)')}\n` +
    (() => { try {
      const a = getAudioStatus();
      return `AUDIO        ${a.samplesLoaded}/${a.samplesExpected} samples · beds ${a.timeBeds} · now "${a.activeBed}"${a.muted ? ' · MUTED' : ''}\n` +
             (a.missing.length ? `MISSING      ${a.missing.slice(0,4).join(', ')}${a.missing.length>4?' +'+(a.missing.length-4):''}\n` : '');
    } catch(e){ return ''; } })() +
    '──────────────────────────────────────────────\n' +
    _diagLog.join('\n');
}

function startRenderLoop(){
  if(animFrameId) cancelAnimationFrame(animFrameId);
  const clock=getClock();
  const startTime=performance.now();

  // Track consecutive errors — if too many, stop the loop gracefully
  let _frameErrors = 0;

  // ── ADAPTIVE FRAME-RATE GOVERNOR ─────────────────────────────────────────
  // Measures real frame time and steps quality DOWN (never up) when the machine
  // can't sustain the target. Rich → Balanced → Fast. This is what keeps "Rich"
  // usable: capable GPUs stay on it; slower ones auto-drop instead of grinding.
  // Design:
  //  • Rolling window of the last 90 frame durations (~1.5s at 60fps).
  //  • If the MEDIAN fps over that window is below the step-down threshold,
  //    and it's been at least 3s since the last change, drop one tier.
  //  • Only steps down. The user can always manually pick a higher tier again;
  //    we record that and back off so we never override a deliberate choice.
  //  • Uses median, not mean, so a single GC hitch or alt-tab stall doesn't
  //    trigger a drop — only sustained low framerate does.
  const _fpsSamples = new Float32Array(90);
  let   _fpsIdx = 0, _fpsCount = 0;
  let   _lastGovT = performance.now();
  let   _govCooldownUntil = performance.now() + 4000; // 4s grace after load before first action
  const _TIER_ORDER = ['fast', 'balanced', 'rich'];
  const _STEP_DOWN_FPS = 32;   // sustained median below this → drop a tier
  // Recovery. Without this the governor is one-way: a single bad window — and
  // the 1.9M-triangle Draco decode during load reliably produces one — pinned
  // the session to fast for good, with no way back short of a reload. The gap
  // between 32 and 52 is deliberate hysteresis so it cannot oscillate.
  const _STEP_UP_FPS = 52;

  function _governorTick(now) {
    const dt = now - _lastGovT;
    _lastGovT = now;
    if (dt <= 0 || dt > 200) return;   // ignore first frame and post-stall spikes
    const fps = 1000 / dt;
    _lastFpsForDiag = fps;
    _fpsSamples[_fpsIdx] = fps;
    _fpsIdx = (_fpsIdx + 1) % _fpsSamples.length;
    if (_fpsCount < _fpsSamples.length) _fpsCount++;

    // Only evaluate on a full window and outside the cooldown
    if (_fpsCount < _fpsSamples.length) return;
    if (now < _govCooldownUntil) return;
    // Respect a recent manual quality choice (set by switchPerfMode wrapper)
    if (window._xixManualQualityUntil && now < window._xixManualQualityUntil) return;

    // Median of the window
    const arr = Array.prototype.slice.call(_fpsSamples).sort((a,b)=>a-b);
    const medianFps = arr[arr.length >> 1];

    // ── STEP UP ───────────────────────────────────────────────────────────
    // Only ever up to window._xixMaxTier, the GPU-derived ceiling — recovery
    // must never put a machine into a mode detectMobileTier() ruled out.
    if (medianFps > _STEP_UP_FPS) {
      const cur  = PERF_MODE || 'fast';
      const capI = _TIER_ORDER.indexOf(window._xixMaxTier || 'balanced');
      const idx  = _TIER_ORDER.indexOf(cur);
      if (idx >= 0 && idx < capI) {
        const next = _TIER_ORDER[idx + 1];
        console.log(`[XIX] Quality suggestion: ${cur} → ${next} (median ${medianFps.toFixed(0)} fps, cap ${window._xixMaxTier})`);
        _suggestQualityChange(next, `Running smoothly at ${medianFps.toFixed(0)} fps.`);
        _govCooldownUntil = now + 30000;
        _fpsCount = 0; _fpsIdx = 0;
      }
      return;
    }

    if (medianFps < _STEP_DOWN_FPS) {
      const cur = PERF_MODE || 'rich';   // live ES-module binding from scene.js
      const idx = _TIER_ORDER.indexOf(cur);
      if (idx > 0) {
        const next = _TIER_ORDER[idx - 1];
        const gpu = window._xixGPUTier ? ` [GPU: ${window._xixGPUTier}]` : '';
        console.warn(`[XIX] Auto quality: ${cur} → ${next} (median ${medianFps.toFixed(0)} fps)${gpu}`);
        _suggestQualityChange(next, `Frame rate is dropping (${medianFps.toFixed(0)} fps).`);
        _govCooldownUntil = now + 3500;   // let it settle before considering another drop
        // Reset the window so the new tier is measured fresh
        _fpsCount = 0; _fpsIdx = 0;
        // Brief on-screen note so the drop isn't mysterious
        _showQualityNote(next);
      }
    }
  }

  function frame(){
    animFrameId=requestAnimationFrame(frame);
    try {
    const delta=Math.min(clock.getDelta(),0.033);
    const elapsed=(performance.now()-startTime)/1000;
    const camera=getCamera();
    if (!camera) return; // scene not ready yet

    // Cap how many villas render at full detail. Internally throttled — only
    // recomputes when the camera has moved ~2 m, so this is near-free.
    tickVillaLOD(camera);
    tickTourPan();      // must run after updateControls — see tickTourPan()

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

    _resolveBuildingCollision(camera);   // keep the camera out of buildings
  // The interior owns camera Y. Eye-height smoothing pulling toward 1.72m while
  // a first-floor room sits at 2.85m is what made the camera drift up and down.
  if (isInteriorMode()) { _targetEyeY = camera.position.y; _currentEyeY = camera.position.y; }
    tickScene(elapsed,camera);
    if (typeof window._tickCrosshairHover === 'function') window._tickCrosshairHover();
    if (typeof window._tickPlotPulse === 'function') window._tickPlotPulse(delta);
    _tickBadgeVisibility(camera);   // hide AVAILABLE labels beyond 95m
    tickDayCycle(elapsed);  // Auto day/night cycle
    updateMinimap(camera.position.x,camera.position.z,getYaw());
    updateSpatialAudio(camera.position.x, camera.position.z, camera.position.y);
    renderFrame();
    _governorTick(performance.now());   // adaptive quality step-down
    _tickDiag(_lastFpsForDiag);         // diagnostics panel (press D)
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
// Un-debounced resize. The debounced resizeWorld() below is right for live
// window dragging, but WRONG for the first paint: the canvas rendered at its
// default buffer size for up to 150ms and was then stretched to fit, which is
// the blurry pixelated frame that flashes just before the aerial view appears.
// Called directly when the world opens so frame one is already correct.
function resizeWorldNow(){
  const renderer = getRenderer(), camera = getCamera();
  if (!renderer || !camera) return;
  const canvas = document.getElementById("world-canvas");
  if (!canvas || !canvas.parentElement) return;
  const w = canvas.parentElement.clientWidth, h = canvas.parentElement.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  resizeComposer(w, h);
}

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
