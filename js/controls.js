/**
 * Project XIX -- Controls v6 (Phase 3 Luxury Production Pass)
 * Upgrades: Exponential Decay Look Smoothing, Cadence-Synced Head-Bob & Trot Pitch
 * Preserved: Mobile Joystick, WebXR, Gyro, App Y-Ownership Logic
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { WORLD } from "./data.js";

const WALK    = 8;
const SPRINT  = 18;
const EYE_H   = 1.72;
const P_MIN   = -0.7;
const P_MAX   =  0.6;
const M_SENS  = 0.0024;
const T_SENS  = 0.0028;

let camera, renderer;

// Phase 3: Target angles (input) vs Current angles (smoothed output)
let targetYaw = Math.PI, targetPitch = 0;
let currentYaw = Math.PI, currentPitch = 0;
let walkTime = 0;

let active = false, locked = false;
const keys = new Set();

// When true, app.js owns camera.position.y — controls.js must NOT touch it.
let _appOwnsY = true;   // ride mode by default
export function setYOwner(owner) { _appOwnsY = (owner === 'app'); }

// Touch state
let joyOrigin = null;  
let joyDelta  = { x: 0, y: 0 };
let lookTouch = null;  
let lookLast  = null;  

let joystickEl = null, joystickDotEl = null;
let touchSprint = false;

export function initControls(cam, ren) {
  camera = cam; renderer = ren;

  window.addEventListener('keydown', e => {
    keys.add(e.key.toLowerCase());
    if (active && ['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) e.preventDefault();
    if (e.key === 'Escape' && locked) document.exitPointerLock();
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });

  renderer.domElement.addEventListener('click', (e) => {
    if (!active || locked || isMobile()) return;
    const tag = e.target.tagName.toLowerCase();
    if (['button','a','input','select','textarea'].includes(tag)) return;
    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.bottom - e.clientY < 100) return; 
    if (e.clientY - rect.top < 60) return; 
    renderer.domElement.requestPointerLock();
  });

  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === renderer.domElement;
    document.body.classList.toggle('pointer-locked', locked);
  });

  document.addEventListener('mousemove', e => {
    if (!active || !locked) return;
    // Input modifies the TARGET, not the camera directly
    targetYaw   -= e.movementX * M_SENS;
    targetPitch  = clamp(targetPitch - e.movementY * M_SENS, P_MIN, P_MAX);
  });

  document.addEventListener('touchstart',  onTouchStart,  { passive: false });
  document.addEventListener('touchmove',   onTouchMove,   { passive: false });
  document.addEventListener('touchend',    onTouchEnd,    { passive: false });
  document.addEventListener('touchcancel', onTouchEnd,    { passive: false });

  buildJoystickUI();

  if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission !== 'function') {
    window.addEventListener('deviceorientation', onGyro, { passive: true });
  }

  return { activate, deactivate, setView, update: updateControls };
}

function buildJoystickUI() {
  const hasTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (!hasTouch) return;

  const overlay = document.getElementById('joystick-overlay');
  if (!overlay) return;

  joystickEl = document.createElement('div');
  joystickEl.className = 'vj-base';
  joystickEl.style.pointerEvents = 'auto'; 
  overlay.appendChild(joystickEl);

  joystickDotEl = document.createElement('div');
  joystickDotEl.className = 'vj-dot';
  joystickDotEl.style.pointerEvents = 'none';
  joystickEl.appendChild(joystickDotEl);
}

function updateJoystickDot() {
  if (!joystickDotEl) return;
  const MAX = 32;
  const dx = joyDelta.x * MAX;
  const dy = joyDelta.y * MAX;
  joystickDotEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

function onTouchStart(e) {
  if (!active) return;
  
  const isCanvas   = e.target.tagName.toLowerCase() === 'canvas';
  const isJoystick = !!e.target.closest('.vj-base');

  if (isCanvas || isJoystick) {
    e.preventDefault();
  } else {
    return; 
  }

  const screenW = window.innerWidth;

  for (const t of e.changedTouches) {
    if (isJoystick && !joyOrigin) {
      joyOrigin = { x: t.clientX, y: t.clientY, id: t.identifier };
      joyDelta  = { x: 0, y: 0 };
      if (joystickEl) joystickEl.style.opacity = '1';
    }
    else if (isCanvas) {
      const inLeftZone = t.clientX < screenW * 0.45;
      if (inLeftZone && !joyOrigin) {
        joyOrigin = { x: t.clientX, y: t.clientY, id: t.identifier };
        joyDelta  = { x: 0, y: 0 };
        if (joystickEl) joystickEl.style.opacity = '1';
      } else if (!inLeftZone && !lookTouch) {
        lookTouch = { id: t.identifier };
        lookLast  = { x: t.clientX, y: t.clientY };
      }
    }
  }
}

function onTouchMove(e) {
  if (!active) return;
  
  for (const t of e.changedTouches) {
    if (joyOrigin && t.identifier === joyOrigin.id) {
      e.preventDefault();
      const DEAD = 8;
      const dx = t.clientX - joyOrigin.x;
      const dy = t.clientY - joyOrigin.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < DEAD) {
        joyDelta = { x: 0, y: 0 };
      } else {
        joyDelta = { x: clamp(dx / 40, -1, 1), y: clamp(dy / 40, -1, 1) };
      }
      updateJoystickDot();
    }
    if (lookTouch && t.identifier === lookTouch.id && lookLast) {
      e.preventDefault();
      // Touch modifies the TARGET
      targetYaw   -= (t.clientX - lookLast.x) * T_SENS;
      targetPitch  = clamp(targetPitch - (t.clientY - lookLast.y) * T_SENS, P_MIN, P_MAX);
      lookLast = { x: t.clientX, y: t.clientY };
    }
  }
}

function onTouchEnd(e) {
  for (const t of e.changedTouches) {
    if (joyOrigin && t.identifier === joyOrigin.id) {
      joyOrigin = null;
      joyDelta  = { x: 0, y: 0 };
      updateJoystickDot();
      if (joystickEl) joystickEl.style.opacity = '0.35';
    }
    if (lookTouch && t.identifier === lookTouch.id) {
      lookTouch = null;
      lookLast  = null;
    }
  }
}

export async function requestGyro() {
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    const res = await DeviceOrientationEvent.requestPermission();
    if (res === 'granted') window.addEventListener('deviceorientation', onGyro, { passive: true });
  }
}

function onGyro(e) {
  if (!active || locked) return;
  // Gyro modifies the TARGET (smoothing removes gyro hand-jitter instantly)
  targetYaw   = -(e.alpha || 0) * (Math.PI / 180);
  targetPitch  = clamp(((e.beta || 0) - 30) * (Math.PI / 180), P_MIN, P_MAX);
}

export function updateControls(delta) {
  if (!active || !camera) return;

  // Phase 3: Matterport-style Exponential Decay Smoothing (Framerate Independent)
  const decay = 1 - Math.exp(-18 * delta);
  currentYaw += (targetYaw - currentYaw) * decay;
  currentPitch += (targetPitch - currentPitch) * decay;

  const speed   = (keys.has('shift') || touchSprint || window.__touchSprint) ? SPRINT : WALK;
  // Movement follows the smoothed current camera direction
  const forward = new THREE.Vector3(-Math.sin(currentYaw), 0, -Math.cos(currentYaw));
  const right   = new THREE.Vector3( Math.cos(currentYaw), 0, -Math.sin(currentYaw));
  const move    = new THREE.Vector3();

  if (keys.has('w') || keys.has('arrowup'))    move.addScaledVector(forward,  1);
  if (keys.has('s') || keys.has('arrowdown'))  move.addScaledVector(forward, -1);
  if (keys.has('d') || keys.has('arrowright')) move.addScaledVector(right,    1);
  if (keys.has('a') || keys.has('arrowleft'))  move.addScaledVector(right,   -1);

  if (joyOrigin) {
    move.addScaledVector(right,    joyDelta.x);
    move.addScaledVector(forward, -joyDelta.y);
  }

  const isMoving = move.lengthSq() > 0.0001;

  if (isMoving) {
    move.normalize().multiplyScalar(speed * delta);
    camera.position.add(move);
    walkTime += delta * (speed === SPRINT ? 15.0 : 10.0); // Advance cadence tracker
  }

  camera.position.x = clamp(camera.position.x, WORLD.xMin || -320, WORLD.xMax || 320);
  camera.position.z = clamp(camera.position.z, WORLD.zMin || -260, WORLD.zMax || 235);

  let finalPitch = currentPitch;

  // Phase 3: Head-Bob and Trot Synchronization
  if (!_appOwnsY) {
    // Walk Mode: controls.js owns Y. Apply footstep Y-axis bobbing.
    if (isMoving) {
      camera.position.y = EYE_H + Math.sin(walkTime) * 0.012;
    } else {
      // Gently settle back to standing height using framerate-independent decay
      camera.position.y += (EYE_H - camera.position.y) * (1 - Math.exp(-10 * delta));
    }
  } else {
    // Ride Mode: app.js owns Y. Apply a rhythmic horse-trot pitch oscillation instead.
    if (isMoving) {
      finalPitch += Math.sin(walkTime * 1.1) * 0.0035; 
    }
  }

  // Apply final smoothed rotation
  camera.rotation.order = 'YXZ';
  camera.rotation.y = currentYaw;
  camera.rotation.x = finalPitch;
}

export function activate()   {
  active = true; keys.clear();
  const hasTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (hasTouch) {
    const overlay = document.getElementById('joystick-overlay');
    if (overlay) overlay.style.display = 'block';
    if (joystickEl) joystickEl.style.opacity = '0.35';
  }
}

export function deactivate() {
  active = false; keys.clear();
  joyOrigin = null; joyDelta = { x:0, y:0 };
  lookTouch = null; lookLast = null;
  touchSprint = false;
  if (joystickEl) joystickEl.style.opacity = '0.35';
  const overlay = document.getElementById('joystick-overlay');
  if (overlay) overlay.style.display = 'none';
}

export function setView(pos, newYaw = Math.PI, newPitch = 0) {
  if (!camera) return;
  camera.position.set(...pos);
  // Snap BOTH target and current to prevent sweeping transition on teleport
  targetYaw = newYaw; currentYaw = newYaw;
  targetPitch = newPitch; currentPitch = newPitch;
  
  camera.rotation.order = 'YXZ';
  camera.rotation.y = currentYaw;
  camera.rotation.x = currentPitch;
}

export function getYaw() { return currentYaw; }

export function isMobile() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

export async function enterVR(renderer, scene, camera, clock, onFrame) {
  if (!('xr' in navigator)) { alert('WebXR not supported on this device.'); return; }
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'] });
    renderer.xr.enabled = true;
    await renderer.xr.setSession(session);
    renderer.setAnimationLoop((t, frame) => { onFrame(clock.getDelta()); renderer.render(scene, camera); });
    session.addEventListener('end', () => { renderer.xr.enabled = false; renderer.setAnimationLoop(null); });
  } catch(err) { alert('VR error: ' + err.message); }
}