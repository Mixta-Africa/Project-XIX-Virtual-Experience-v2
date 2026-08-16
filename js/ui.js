/**
 * Project XIX     UI Module
 * Minimap, loading screen, viewpoint strip, zone info panel, spatial audio stubs.
 */

import { WORLD, VIEWPOINTS, ZONES } from "./data.js";

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
const MAP = {
  xMin: -270, xMax: 225,
  zMin: -260, zMax: 225,
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
  minimapCtx.rotate(yawRad); // yaw 0 = north (-Z) = arrow up; yaw PI/2 = east (+X) = arrow right

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
  pitch:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="8" width="18" height="10" rx="1"/><line x1="12" y1="8" x2="12" y2="18"/></svg>`,
  clubhouse:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="11" width="18" height="8"/><path d="M2 11L12 4l10 7"/></svg>`,
  lake:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M2 18c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/></svg>`,
  villa:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4" y="10" width="16" height="10"/><path d="M2 10L12 3l10 7"/><rect x="9" y="14" width="6" height="6"/></svg>`,
  loft:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="8" width="20" height="13"/><line x1="7" y1="8" x2="7" y2="21"/><line x1="14" y1="8" x2="14" y2="21"/></svg>`,
  stables:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 20V10l8-6 8 6v10"/><path d="M10 20v-5h4v5"/></svg>`,
  aerial:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>`,
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
          e.preventDefault();   // Prevent default behavior
          e.stopPropagation();  // STOP the click from bubbling up to the main button
          
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
          // Break out of the overflow container
          const rect = btn.getBoundingClientRect();
          menu.style.position = "fixed";
          menu.style.left = rect.left + "px";
          menu.style.bottom = "95px"; // Safely above the toolbar
          menu.style.zIndex = "9999";
          btn.querySelector(".vp-chevron").innerHTML = "&#9662;";
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

let audioCtx;
const audioSources = {};

export function initAudio() {
  // Lazily created on first user gesture
}

export async function enableAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Ambient wind / birds     synthesised
    addAmbientLoop(220, 0.018, "wind");
    addAmbientLoop(880, 0.005, "birds", true);
  } catch (_) {}
}

function addAmbientLoop(baseFreq, gain, name, random = false) {
  if (!audioCtx) return;
  const oscillator = audioCtx.createOscillator();
  const gainNode   = audioCtx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = baseFreq;
  gainNode.gain.value = gain;
  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  oscillator.start();
  audioSources[name] = { oscillator, gainNode };

  if (random) {
    // Randomise freq to simulate bird calls
    setInterval(() => {
      oscillator.frequency.setTargetAtTime(baseFreq + Math.random() * 200, audioCtx.currentTime, 0.05);
      gainNode.gain.setTargetAtTime(Math.random() * 0.008, audioCtx.currentTime, 0.1);
    }, 800 + Math.random() * 1200);
  }
}

export function updateSpatialAudio(worldX, worldZ) {
  if (!audioCtx || !audioSources.wind) return;
  // Increase wind near north/south perimeter
  const dist = Math.min(Math.abs(worldZ - WORLD.zMin), Math.abs(worldZ - WORLD.zMax));
  const windGain = 0.015 + (1 - Math.min(dist / 100, 1)) * 0.02;
  audioSources.wind.gainNode.gain.setTargetAtTime(windGain, audioCtx.currentTime, 0.3);
}

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

//           TOUCH JOYSTICK OVERLAY                                                                                                                                                          

export function showJoystick() {
  const el = document.getElementById("joystick-overlay");
  if (el) el.style.display = "flex";
}

export function hideJoystick() {
  const el = document.getElementById("joystick-overlay");
  if (el) el.style.display = "none";
}

export function isMobile() {
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 768;
}
