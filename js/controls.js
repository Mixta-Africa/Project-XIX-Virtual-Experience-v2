/**
 * Project XIX -- Controls v2
 * Full responsive + touch support:
 *   Desktop: WASD/arrows + pointer lock mouse look
 *   Mobile/tablet: virtual joystick (left thumb) + swipe look (right thumb)
 *   Gyroscope: auto-detected on mobile, optional permission request
 *   WebXR: immersive-vr session
 *   All inputs: instant stop on release (no drift)
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { WORLD } from "./data.js";

//        CONSTANTS                                                                                                                                                                                                    
const WALK    = 8;    // m/s walk
const SPRINT  = 18;   // m/s sprint
const EYE_H   = 1.72; // eye height metres
const P_MIN   = -0.7;
const P_MAX   =  0.6;
const M_SENS  = 0.0024;
const T_SENS  = 0.0028;

//        STATE                                                                                                                                                                                                                
let camera, renderer;
let yaw = Math.PI, pitch = 0;
let active = false, locked = false;
const keys = new Set();

// Touch state
let joyOrigin = null;  // { x, y, id }
let joyDelta  = { x: 0, y: 0 };
let lookTouch = null;  // { id }
let lookLast  = null;  // { x, y }

// Virtual joystick DOM element
let joystickEl = null, joystickDotEl = null;

//        INIT                                                                                                                                                                                                                
export function initControls(cam, ren) {
  camera = cam; renderer = ren;

  // Keyboard
  window.addEventListener('keydown', e => {
    keys.add(e.key.toLowerCase());
    if (active && ['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase()))
      e.preventDefault();
    if (e.key === 'Escape' && locked) document.exitPointerLock();
  });
  window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });

  // Pointer lock (desktop mouse look)
  renderer.domElement.addEventListener('click', () => {
    if (active && !locked && !isMobile()) renderer.domElement.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    locked = document.pointerLockElement === renderer.domElement;
    document.body.classList.toggle('pointer-locked', locked);
  });
  document.addEventListener('mousemove', e => {
    if (!active || !locked) return;
    yaw   -= e.movementX * M_SENS;
    pitch  = clamp(pitch - e.movementY * M_SENS, P_MIN, P_MAX);
  });

  // Touch (passive:false to allow preventDefault)
  const canvas = renderer.domElement;
  canvas.addEventListener('touchstart',  onTouchStart,  { passive: false });
  canvas.addEventListener('touchmove',   onTouchMove,   { passive: false });
  canvas.addEventListener('touchend',    onTouchEnd,    { passive: false });
  canvas.addEventListener('touchcancel', onTouchEnd,    { passive: false });

  // Create virtual joystick visuals
  buildJoystickUI();

  // Gyroscope (Android auto, iOS requires permission)
  if (window.DeviceOrientationEvent) {
    if (typeof DeviceOrientationEvent.requestPermission !== 'function') {
      window.addEventListener('deviceorientation', onGyro, { passive: true });
    }
  }

  return { activate, deactivate, setView, update: updateControls };
}

//        JOYSTICK UI                                                                                                                                                                                              
function buildJoystickUI() {
  // Only show on mobile
  if (!isMobile()) return;

  const overlay = document.getElementById('joystick-overlay');
  if (!overlay) return;

  // Base ring
  joystickEl = document.createElement('div');
  joystickEl.className = 'vj-base';
  overlay.appendChild(joystickEl);

  // Dot (thumb position indicator)
  joystickDotEl = document.createElement('div');
  joystickDotEl.className = 'vj-dot';
  joystickEl.appendChild(joystickDotEl);
}

function updateJoystickDot() {
  if (!joystickDotEl) return;
  const MAX = 32;
  const dx = joyDelta.x * MAX;
  const dy = joyDelta.y * MAX;
  joystickDotEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

//        TOUCH HANDLERS                                                                                                                                                                                     
function onTouchStart(e) {
  if (!active) return;
  e.preventDefault();
  const halfW = renderer.domElement.clientWidth / 2;
  for (const t of e.changedTouches) {
    if (t.clientX < halfW && !joyOrigin) {
      // Left half     joystick
      joyOrigin = { x: t.clientX, y: t.clientY, id: t.identifier };
      joyDelta  = { x: 0, y: 0 };
      // Position joystick ring at touch point
      if (joystickEl) {
        joystickEl.style.left = t.clientX + 'px';
        joystickEl.style.top  = t.clientY + 'px';
        joystickEl.style.opacity = '1';
      }
    } else if (t.clientX >= halfW && !lookTouch) {
      // Right half     look
      lookTouch = { id: t.identifier };
      lookLast  = { x: t.clientX, y: t.clientY };
    }
  }
}

function onTouchMove(e) {
  if (!active) return;
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (joyOrigin && t.identifier === joyOrigin.id) {
      const DEAD = 8;  // dead zone pixels
      const dx = t.clientX - joyOrigin.x;
      const dy = t.clientY - joyOrigin.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < DEAD) {
        joyDelta = { x: 0, y: 0 };
      } else {
        joyDelta = {
          x: clamp(dx / 55, -1, 1),
          y: clamp(dy / 55, -1, 1),
        };
      }
      updateJoystickDot();
    }
    if (lookTouch && t.identifier === lookTouch.id && lookLast) {
      yaw   -= (t.clientX - lookLast.x) * T_SENS;
      pitch  = clamp(pitch - (t.clientY - lookLast.y) * T_SENS, P_MIN, P_MAX);
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

//        GYROSCOPE                                                                                                                                                                                                    
export async function requestGyro() {
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    const res = await DeviceOrientationEvent.requestPermission();
    if (res === 'granted') window.addEventListener('deviceorientation', onGyro, { passive: true });
  }
}

function onGyro(e) {
  if (!active || locked) return;
  yaw   = -(e.alpha || 0) * (Math.PI / 180);
  pitch  = clamp(((e.beta || 0) - 30) * (Math.PI / 180), P_MIN, P_MAX);
}

//        UPDATE (per frame)                                                                                                                                                                         
export function updateControls(delta) {
  if (!active || !camera) return;

  const speed   = keys.has('shift') ? SPRINT : WALK;
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right   = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw));
  const move    = new THREE.Vector3();

  // Keyboard
  if (keys.has('w') || keys.has('arrowup'))    move.addScaledVector(forward,  1);
  if (keys.has('s') || keys.has('arrowdown'))  move.addScaledVector(forward, -1);
  if (keys.has('d') || keys.has('arrowright')) move.addScaledVector(right,    1);
  if (keys.has('a') || keys.has('arrowleft'))  move.addScaledVector(right,   -1);

  // Joystick
  if (joyOrigin) {
    move.addScaledVector(right,    joyDelta.x);
    move.addScaledVector(forward, -joyDelta.y);
  }

  // Apply movement (no velocity accumulation     instant stop)
  if (move.lengthSq() > 0.0001) {
    move.normalize().multiplyScalar(speed * delta);
    camera.position.add(move);
  }

  // Clamp to world bounds and eye height
  camera.position.x = clamp(camera.position.x, WORLD.xMin || -320, WORLD.xMax || 320);
  camera.position.z = clamp(camera.position.z, WORLD.zMin || -260, WORLD.zMax || 235);
  camera.position.y = EYE_H;

  // Apply rotation
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

//        HELPERS                                                                                                                                                                                                          
export function activate()   { active = true;  keys.clear(); }
export function deactivate() {
  active = false; keys.clear();
  joyOrigin = null; joyDelta = { x:0, y:0 };
  lookTouch = null; lookLast = null;
  if (joystickEl) joystickEl.style.opacity = '0.35';
}
export function setView(pos, newYaw = Math.PI, newPitch = 0) {
  if (!camera) return;
  camera.position.set(...pos);
  yaw = newYaw; pitch = newPitch;
  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}
export function getYaw() { return yaw; }
export function isMobile() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || window.innerWidth < 768;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

//        WEBXR                                                                                                                                                                                                                
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
