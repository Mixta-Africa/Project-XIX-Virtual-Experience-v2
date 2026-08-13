/**
 * Project XIX — UI Module
 * Minimap, loading screen, viewpoint strip, zone info panel, spatial audio stubs.
 */

import { WORLD, VIEWPOINTS, ZONES } from "./data.js";

// ─── LOADING SCREEN ───────────────────────────────────────────────────────────

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

// ─── MINIMAP ─────────────────────────────────────────────────────────────────

let minimapCanvas, minimapCtx, minimapPlanImage;

export function initMinimap(planImageSrc) {
  minimapCanvas = document.getElementById("minimap-canvas");
  if (!minimapCanvas) return;
  minimapCtx = minimapCanvas.getContext("2d");

  minimapPlanImage = new Image();
  minimapPlanImage.src = planImageSrc;
}

export function updateMinimap(worldX, worldZ, yawRad) {
  if (!minimapCtx || !minimapPlanImage) return;

  const W = minimapCanvas.width;
  const H = minimapCanvas.height;
  minimapCtx.clearRect(0, 0, W, H);

  // Draw plan-2d as background
  if (minimapPlanImage.complete) {
    minimapCtx.globalAlpha = 0.85;
    minimapCtx.drawImage(minimapPlanImage, 0, 0, W, H);
    minimapCtx.globalAlpha = 1;
  }

  // World → canvas mapping
  const rx = ((worldX - WORLD.mapXMin) / (WORLD.mapXMax - WORLD.mapXMin)) * W;
  const ry = ((worldZ - WORLD.mapZMin) / (WORLD.mapZMax - WORLD.mapZMin)) * H;

  // Player dot
  minimapCtx.save();
  minimapCtx.translate(rx, ry);
  minimapCtx.rotate(yawRad + Math.PI / 2);

  // Gold arrow
  minimapCtx.fillStyle = "#c9a84c";
  minimapCtx.strokeStyle = "#0a1008";
  minimapCtx.lineWidth = 1.5;
  minimapCtx.shadowColor = "#c9a84c";
  minimapCtx.shadowBlur = 6;

  minimapCtx.beginPath();
  minimapCtx.moveTo(0, -8);
  minimapCtx.lineTo(4.5, 5);
  minimapCtx.lineTo(0, 2);
  minimapCtx.lineTo(-4.5, 5);
  minimapCtx.closePath();
  minimapCtx.fill();
  minimapCtx.stroke();

  minimapCtx.restore();
}

// ─── VIEWPOINT STRIP ──────────────────────────────────────────────────────────

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

  Object.entries(VIEWPOINTS).forEach(([key, vp]) => {
    if (key === "intro") return; // cinematic only
    const btn = document.createElement("button");
    btn.className = "vp-btn";
    btn.dataset.key = key;
    btn.innerHTML = `
      <span class="vp-icon">${viewpointIcons[vp.icon] || viewpointIcons.pitch}</span>
      <span class="vp-label">${vp.label}</span>
    `;
    btn.addEventListener("click", () => {
      document.querySelectorAll(".vp-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      onSelect(key, vp);
    });
    container.appendChild(btn);
  });
}

// ─── ZONE INFO PANEL ──────────────────────────────────────────────────────────

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

// ─── SPATIAL AUDIO ────────────────────────────────────────────────────────────

let audioCtx;
const audioSources = {};

export function initAudio() {
  // Lazily created on first user gesture
}

export async function enableAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    // Ambient wind / birds — synthesised
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

// ─── HUD: CAPTION & STATUS ────────────────────────────────────────────────────

export function setCaption(text) {
  const el = document.getElementById("scene-caption");
  if (el) el.textContent = text;
}

export function showEnterPrompt(text = "Click or tap to look around · WASD to walk") {
  const el = document.getElementById("enter-prompt");
  if (el) { el.textContent = text; el.style.opacity = "1"; }
}

export function hideEnterPrompt() {
  const el = document.getElementById("enter-prompt");
  if (el) el.style.opacity = "0";
}

// ─── VR BUTTON ────────────────────────────────────────────────────────────────

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

// ─── TOUCH JOYSTICK OVERLAY ───────────────────────────────────────────────────

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
