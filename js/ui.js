/**
 * Project XIX     UI Module
 * Minimap, loading screen, viewpoint strip, zone info panel, spatial audio stubs.
 */

import { WORLD, VIEWPOINTS, ZONES } from "./data.js";
// app.js imports initAudio/enableAudio/updateSpatialAudio from THIS file,
// not from scene.js — a real system (filtered noise for wind, envelope
// bursts for birds/hooves, a synthesized neigh, all routed through one
// mutable master gain) already exists there. Delegating to it below
// instead of maintaining a second, competing implementation here.
import { initAudio as _sceneInitAudio, enableAudio as _sceneEnableAudio,
         updateSpatialAudio as _sceneUpdateSpatialAudio,
         setAudioMuted as _sceneSetAudioMuted,
         isAudioMuted as _sceneIsAudioMuted } from "./scene.js";

//           LOADING SCREEN                                                                                                                                                                                  

export function showLoading() {
  const el = document.getElementById("loading-screen");
  if (el) el.style.display = "flex";
}

export function hideLoading() {
  const el = document.getElementById("loading-screen");
  if (!el) return;
  el.style.opacity = "0";
  setTimeout(() => { el.style.display = "none"; }, 600);
}

export function setLoadingProgress(pct) {
  const bar = document.getElementById("loading-bar-fill");
  if (bar) bar.style.width = `${Math.min(100, pct)}%`;
}

//           MINIMAP                                                                                                                                                                                                    

let minimapCanvas, minimapCtx, minimapPlanImage;
let minimapReady = false;

//        MINIMAP WORLD     CANVAS CALIBRATION                                                                         
// The plan-2d.png image maps to the scene as follows:
//   Image LEFT edge  = world X     -252 (west perimeter)
//   Image RIGHT edge = world X     +252 (east perimeter)
//   Image TOP edge   = world Z     -200 (north / lake side)
//   Image BOTTOM edge= world Z     +210 (south / Lagos Road)
// These are tuned to the actual scene geometry in scene.js.
// Bounds calibrated to corrected scene.js geometry:
// North (lake side) = z=-260, South (Lagos Road) = z=+225
// West (stables) = x=-270, East (commercial) = x=+225
// Minimap world bounds — must match scene geometry in scene.js
// Stables at x=-375, commercial at x=+270, north perimeter at z=-210, Lagos Road at z=+225
const MAP = {
  xMin: -420, xMax: 300,
  zMin: -230, zMax: 240,
};

export function initMinimap(planImageSrc) {
  minimapCanvas = document.getElementById("minimap-canvas");
  if (!minimapCanvas) return;

  //        CRITICAL: set canvas pixel dimensions to match its CSS display size
  // CSS: width=200px height=130px (updated below). Canvas must match exactly
  // so coordinate math is pixel-perfect.
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  minimapCanvas.width  = 200 * dpr;
  minimapCanvas.height = 130 * dpr;
  minimapCtx = minimapCanvas.getContext("2d");
  minimapCtx.scale(dpr, dpr);  // scale for HiDPI

  minimapPlanImage = new Image();
  minimapPlanImage.onload = () => { minimapReady = true; };
  minimapPlanImage.src = planImageSrc;
}

export function updateMinimap(worldX, worldZ, yawRad) {
  if (!minimapCtx) return;

  // Display size (matches CSS)
  const W = 200;
  const H = 130;

  minimapCtx.clearRect(0, 0, W, H);

  //        Background: plan image
  if (minimapReady && minimapPlanImage.complete) {
    minimapCtx.globalAlpha = 0.9;
    minimapCtx.drawImage(minimapPlanImage, 0, 0, W, H);
    minimapCtx.globalAlpha = 1;
  } else {
    // Fallback: dark green fill with field outline
    minimapCtx.fillStyle = "#0d2018";
    minimapCtx.fillRect(0, 0, W, H);
    minimapCtx.strokeStyle = "#3a7a50";
    minimapCtx.lineWidth = 1;
    // Field rectangle approx (centre of map)
    minimapCtx.strokeRect(W*0.28, H*0.25, W*0.44, H*0.50);
  }

  //        World     canvas pixel mapping (clamped)
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const px = clamp(
    ((worldX - MAP.xMin) / (MAP.xMax - MAP.xMin)) * W,
    4, W - 4
  );
  const py = clamp(
    ((worldZ - MAP.zMin) / (MAP.zMax - MAP.zMin)) * H,
    4, H - 4
  );

  //        Accuracy ring (shows approx position area)
  minimapCtx.beginPath();
  minimapCtx.arc(px, py, 10, 0, Math.PI * 2);
  minimapCtx.fillStyle = "rgba(201,168,76,0.15)";
  minimapCtx.fill();

  //        Direction wedge (facing direction)
  minimapCtx.save();
  minimapCtx.translate(px, py);
  //  HEADING WAS MIRRORED. controls.js defines forward as
  //      (-sin(yaw), 0, -cos(yaw))
  //  so yaw = PI/2 gives (-1, 0, 0), which is -X, which is WEST. The old
  //  comment here claimed PI/2 was east and the canvas rotated by +yaw, which
  //  turns the arrow clockwise and lands it due east — a mirror of the truth
  //  about the north-south axis. Facing the apartment blocks in the west read
  //  as east on the map.
  //
  //  Canvas +y runs down and py maps +Z downward, so screen-up already equals
  //  -Z = north and yaw 0 needs no rotation. Negating fixes every other
  //  heading: PI/2 -> arrow left (west), PI -> arrow down (south).
  minimapCtx.rotate(-yawRad);

  minimapCtx.beginPath();
  minimapCtx.moveTo(0, -14);
  minimapCtx.lineTo(6, 4);
  minimapCtx.lineTo(0, 0);
  minimapCtx.lineTo(-6, 4);
  minimapCtx.closePath();
  minimapCtx.fillStyle = "#ffffff";
  minimapCtx.strokeStyle = "#0a0f0c";
  minimapCtx.lineWidth = 1.5;
  minimapCtx.shadowColor = "#ffffff";
  minimapCtx.shadowBlur = 8;
  minimapCtx.fill();
  minimapCtx.stroke();

  minimapCtx.restore();

  //        Bright position dot (always visible)
  minimapCtx.beginPath();
  minimapCtx.arc(px, py, 4.5, 0, Math.PI * 2);
  minimapCtx.fillStyle = "#ff4444";
  minimapCtx.strokeStyle = "#ffffff";
  minimapCtx.lineWidth = 1.5;
  minimapCtx.shadowColor = "#ff4444";
  minimapCtx.shadowBlur = 10;
  minimapCtx.fill();
  minimapCtx.stroke();

  //        Crosshair lines through dot
  minimapCtx.shadowBlur = 0;
  minimapCtx.strokeStyle = "rgba(255,255,255,0.5)";
  minimapCtx.lineWidth = 0.5;
  minimapCtx.beginPath();
  minimapCtx.moveTo(px - 8, py); minimapCtx.lineTo(px + 8, py);
  minimapCtx.moveTo(px, py - 8); minimapCtx.lineTo(px, py + 8);
  minimapCtx.stroke();

  //        Coordinates readout (bottom-left of minimap)
  minimapCtx.font = "bold 8px monospace";
  minimapCtx.fillStyle = "rgba(201,168,76,0.9)";
  minimapCtx.shadowColor = "#000";
  minimapCtx.shadowBlur = 3;
  minimapCtx.fillText(
    `${Math.round(worldX)}m E  ${Math.round(-worldZ)}m N`,
    4, H - 4
  );
}

//           VIEWPOINT STRIP                                                                                                                                                                               

const viewpointIcons = {
  pitch:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 6v12M2 12h5M22 12h-5"/></svg>`,
  clubhouse:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-5h6v5"/></svg>`,
  lake:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>`,
  villa:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21h18M4 21V9l8-6 8 6v12M10 21v-4h4v4M8 12h8"/></svg>`,
  loft:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 21h16M4 21v-8l8-4 8 4v8M8 21v-6h8v6M12 9V3M9 3h6"/></svg>`,
  stables:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 21h18M5 21v-8M19 21v-8M5 13l7-4 7 4M12 9v12M8 17h8"/></svg>`,
  aerial:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M6.5 6.5l2 2M17.5 17.5l-2-2M17.5 6.5l-2 2M6.5 17.5l2-2"/></svg>`,
};

export function buildViewpointStrip(container, onSelect) {
  if (!container) return;
  container.innerHTML = "";

  // Map viewpoint keys to product panel keys
  const PRODUCT_MAP = {
    villas:"villas", clubhouse:"clubhouse", stables:"stables",
    lofts:"lofts", training:"training", paddock:"paddock", flats:"flats",
  };

  Object.entries(VIEWPOINTS).forEach(([key, vp]) => {
    if (key === "intro") return;

    const wrapper = document.createElement("div");
    wrapper.className = "vp-wrapper";

    const btn = document.createElement("button");
    btn.className   = "vp-btn";
    btn.dataset.key = key;
    const hasSubViews = vp.subViews && vp.subViews.length > 0;
    btn.innerHTML = `
      <span class="vp-icon">${viewpointIcons[vp.icon] || viewpointIcons.pitch}</span>
      <span class="vp-label">${vp.label}${hasSubViews ? " <span class=\"vp-chevron\">&#9652;</span>" : ""}</span>
    `;

    if (hasSubViews) {
      // Dropdown for viewpoints with sub-views (e.g. Villas: West/East/North/South)
      const menu = document.createElement("div");
      menu.className = "vp-dropdown";
      menu.style.display = "none";

      vp.subViews.forEach(sv => {
        const sbtn = document.createElement("button");
        sbtn.className   = "vp-dropdown-item";
        sbtn.textContent = sv.label;
        sbtn.addEventListener("click", e => {
          
          document.querySelectorAll(".vp-btn").forEach(b=>b.classList.remove("active"));
          btn.classList.add("active");
          menu.style.display = "none";
          const chevron = btn.querySelector(".vp-chevron");
          if (chevron) chevron.innerHTML = "&#9652;";
          
          onSelect(sv.key, sv);
          const fn = window.__moduleReady?.showProductPanel;
          if (fn) fn(PRODUCT_MAP[key] || PRODUCT_MAP[sv.key]);
        });
        menu.appendChild(sbtn);
      });

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isOpen = menu.style.display !== "none";
        
        document.querySelectorAll(".vp-dropdown").forEach(d=>d.style.display="none");
        document.querySelectorAll(".vp-chevron").forEach(ch=>ch.innerHTML="&#9652;");
        
        if (!isOpen) {
          menu.style.display = "flex";
          // Position above viewpoint strip
          const rect = btn.getBoundingClientRect();
          menu.style.position = "fixed";
          menu.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 170)) + "px";
          menu.style.bottom = (window.innerHeight - rect.top + 8) + "px";
          menu.style.zIndex = "9999";
          btn.querySelector(".vp-chevron").innerHTML = "&#9662;";
          // Close mode toggle to avoid overlap
          document.getElementById('mode-toggle-bar')?.style.setProperty('pointer-events','none');
          setTimeout(() => document.getElementById('mode-toggle-bar')?.style.removeProperty('pointer-events'), 1000);
        } else {
          btn.querySelector(".vp-chevron").innerHTML = "&#9652;";
        }
      });

      wrapper.appendChild(btn);
      // Append to body so it doesn't get clipped by the scrolling strip
      document.body.appendChild(menu); 

    } else {
      // Simple button: teleport + open product panel
      btn.addEventListener("click", () => {
        document.querySelectorAll(".vp-btn").forEach(b=>b.classList.remove("active"));
        document.querySelectorAll(".vp-dropdown").forEach(d=>d.style.display="none");
        btn.classList.add("active");
        // Teleport immediately
        onSelect(key, vp);
        // Open product panel if this key has one
        const productKey = PRODUCT_MAP[key];
        if (productKey) {
          const fn = window.__moduleReady?.showProductPanel;
          if (fn) fn(productKey);
        }
      });
      wrapper.appendChild(btn);
    }

    container.appendChild(wrapper);
  });

  // Close dropdowns on outside click - IGNORING clicks inside the dropdown itself
  document.addEventListener("click", e => {
    if (!e.target.closest(".vp-wrapper") && !e.target.closest(".vp-dropdown")) {
      document.querySelectorAll(".vp-dropdown").forEach(d=>d.style.display="none");
      document.querySelectorAll(".vp-chevron").forEach(ch=>ch.innerHTML="&#9652;");
    }
  }, { passive:true });
}

//           ZONE INFO PANEL                                                                                                                                                                               

export function showZonePanel(zoneKey) {
  const zone = ZONES[zoneKey];
  if (!zone) return;
  const panel = document.getElementById("zone-panel");
  if (!panel) return;

  panel.querySelector(".zone-type").textContent     = zone.type;
  panel.querySelector(".zone-label").textContent    = zone.label;
  panel.querySelector(".zone-tagline").textContent  = zone.tagline;
  panel.querySelector(".zone-desc").textContent     = zone.description;
  panel.querySelector(".zone-client").textContent   = zone.clientLens;
  panel.classList.add("visible");
}

export function hideZonePanel() {
  const panel = document.getElementById("zone-panel");
  if (panel) panel.classList.remove("visible");
}

//           SPATIAL AUDIO                                                                                                                                                                                     
//
//  THIS WAS THE ENTIRE REASON NOTHING PLAYED. app.js imports initAudio /
//  enableAudio / updateSpatialAudio from THIS file, not from scene.js — a
//  detail missed for several rounds of "fixing" the wrong file. And this
//  copy was not merely a stub: enableAudio() created an AudioContext and
//  then explicitly never called addAmbientLoop() for anything, per its own
//  comment — "Oscillators completely disabled to kill the high-pitched
//  ringing sound." That ringing came from raw, unfiltered sine oscillators
//  held at a sustained audible pitch with no envelope — a real defect, but
//  the fix chosen was to silence everything permanently instead of fixing
//  the oscillator. scene.js already has the correct version of this
//  system: filtered NOISE buffers for wind (not a tone), enveloped bursts
//  for birds and hooves (not a sustained pitch), a synthesized neigh, and a
//  shared mute-able master gain. Delegating to it here removes the broken
//  duplicate instead of maintaining two competing audio systems.
export function initAudio() { _sceneInitAudio(); }
export async function enableAudio() { _sceneEnableAudio(); }
export function updateSpatialAudio(worldX, worldZ) { _sceneUpdateSpatialAudio(worldX, worldZ); }
export function setAudioMuted(muted) { _sceneSetAudioMuted(muted); }
export function isAudioMuted() { return _sceneIsAudioMuted(); }

//           HUD: CAPTION & STATUS                                                                                                                                                             

export function setCaption(text) {
  const el = document.getElementById("scene-caption");
  if (el) el.textContent = text;
}

export function showEnterPrompt(text = "Click or tap to look around    WASD to walk") {
  const el = document.getElementById("enter-prompt");
  if (el) { el.textContent = text; el.style.opacity = "1"; }
}

export function hideEnterPrompt() {
  const el = document.getElementById("enter-prompt");
  if (el) el.style.opacity = "0";
}

//           VR BUTTON                                                                                                                                                                                                 

export function showVRButton(onClick) {
  if (!("xr" in navigator)) return;
  navigator.xr.isSessionSupported("immersive-vr").then(supported => {
    if (!supported) return;
    const btn = document.getElementById("vr-btn");
    if (!btn) return;
    btn.style.display = "flex";
    btn.addEventListener("click", onClick);
  });
}

//           TOUCH JOYSTICK OVERLAY — PINNED BOTTOM-LEFT
// MutationObserver prevents any other code from repositioning it.

const JOYSTICK_PINNED = 'display:flex !important;position:fixed !important;bottom:28px !important;left:28px !important;right:auto !important;top:auto !important;transform:none !important;z-index:9999 !important;pointer-events:auto !important;';
let _joystickObs = null;

export function showJoystick() {
  const el = document.getElementById("joystick-overlay");
  if (!el) return;
  el.style.cssText = JOYSTICK_PINNED;
  // Also inject a permanent CSS rule so no stylesheet can override it
  if (!document.getElementById('joy-pin-rule')) {
    const s = document.createElement('style');
    s.id = 'joy-pin-rule';
    s.textContent = '#joystick-overlay { ' + JOYSTICK_PINNED.replace(/;/g, ' !important;') + ' }';
    document.head.appendChild(s);
  }
  if (_joystickObs) { _joystickObs.disconnect(); _joystickObs = null; }
  _joystickObs = new MutationObserver(() => {
    if (el.style.position !== 'fixed') el.style.cssText = JOYSTICK_PINNED;
  });
  _joystickObs.observe(el, { attributes: true, attributeFilter: ['style'] });
}

export function hideJoystick() {
  const el = document.getElementById("joystick-overlay");
  if (!el) return;
  if (_joystickObs) { _joystickObs.disconnect(); _joystickObs = null; }
  el.style.display = "none";
}

export function isMobile() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 768;
}
