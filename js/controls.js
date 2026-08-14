/**
 * Project XIX — Controls Module v3
 * Fixes: immediate velocity zero on key release (no drift),
 * page-scroll prevention, mobile joystick state cleanup,
 * WebXR VR mode.
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { WORLD } from "./data.js";

const WALK_SPEED   = 10;
const SPRINT_SPEED = 22;
const EYE_HEIGHT   = 1.72;
const PITCH_MIN    = -0.68;
const PITCH_MAX    =  0.58;
const MOUSE_SENS   = 0.0026;
const TOUCH_SENS   = 0.0028;

let camera, renderer;
let yaw   = Math.PI;
let pitch = 0;
let active = false;
let pointerLocked = false;

// Key state — tracks exactly which keys are currently held
const keysHeld = new Set();

// Touch joystick
let joystickOrigin = null;   // { x, y, id }
let joystickDelta  = { x: 0, y: 0 };
let lookTouch      = null;   // { id }
let lastLookPos    = null;   // { x, y }

// Gyroscope
let gyroEnabled = false;

export function initControls(cam, ren) {
  camera   = cam;
  renderer = ren;

  // ── Keyboard ──────────────────────────────────────────────
  window.addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    keysHeld.add(k);

    // Prevent page scroll when in 3D world
    if (active && ["arrowup","arrowdown","arrowleft","arrowright"," "].includes(k)) {
      e.preventDefault();
    }
    if (k === "escape" && pointerLocked) document.exitPointerLock();
  });

  window.addEventListener("keyup", e => {
    // CRITICAL FIX: remove key immediately on keyup — no drift
    keysHeld.delete(e.key.toLowerCase());
  });

  // Clear all keys when window loses focus (prevents stuck keys)
  window.addEventListener("blur", () => keysHeld.clear());
  window.addEventListener("visibilitychange", () => { if (document.hidden) keysHeld.clear(); });

  // ── Pointer lock (mouse look) ──────────────────────────────
  renderer.domElement.addEventListener("click", () => {
    if (active && !pointerLocked) renderer.domElement.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    document.body.classList.toggle("pointer-locked", pointerLocked);
  });
  document.addEventListener("mousemove", onMouseMove);

  // ── Touch ──────────────────────────────────────────────────
  renderer.domElement.addEventListener("touchstart",  onTouchStart,  { passive: false });
  renderer.domElement.addEventListener("touchmove",   onTouchMove,   { passive: false });
  renderer.domElement.addEventListener("touchend",    onTouchEnd,    { passive: false });
  renderer.domElement.addEventListener("touchcancel", onTouchEnd,    { passive: false });

  // ── Gyroscope ──────────────────────────────────────────────
  if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission !== "function") {
    window.addEventListener("deviceorientation", onGyro, { passive: true });
    gyroEnabled = true;
  }

  return { activate, deactivate, setView, update: updateControls };
}

export function activate()   { active = true;  keysHeld.clear(); }
export function deactivate() {
  active = false;
  keysHeld.clear();
  joystickOrigin = null;
  joystickDelta  = { x: 0, y: 0 };
  lookTouch = null; lastLookPos = null;
}

export function setView(pos, newYaw = Math.PI, newPitch = 0) {
  if (!camera) return;
  camera.position.set(...pos);
  yaw   = newYaw;
  pitch = newPitch;
  applyRotation();
}

export function getYaw() { return yaw; }

// ── Gyro ────────────────────────────────────────────────────
export async function requestGyro() {
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    const r = await DeviceOrientationEvent.requestPermission();
    if (r === "granted") {
      window.addEventListener("deviceorientation", onGyro, { passive: true });
      gyroEnabled = true;
    }
  }
}

function onGyro(e) {
  if (!active || !gyroEnabled || pointerLocked) return;
  yaw   = -(e.alpha || 0) * (Math.PI / 180);
  pitch = clamp(((e.beta || 0) - 30) * (Math.PI / 180), PITCH_MIN, PITCH_MAX);
}

// ── Mouse ────────────────────────────────────────────────────
function onMouseMove(e) {
  if (!active || !pointerLocked) return;
  yaw   -= e.movementX * MOUSE_SENS;
  pitch  = clamp(pitch - e.movementY * MOUSE_SENS, PITCH_MIN, PITCH_MAX);
}

// ── Touch ────────────────────────────────────────────────────
function onTouchStart(e) {
  if (!active) return;
  e.preventDefault();
  const halfW = renderer.domElement.clientWidth / 2;
  for (const t of e.changedTouches) {
    if (t.clientX < halfW && !joystickOrigin) {
      joystickOrigin = { x: t.clientX, y: t.clientY, id: t.identifier };
      joystickDelta  = { x: 0, y: 0 };
    } else if (t.clientX >= halfW && !lookTouch) {
      lookTouch   = { id: t.identifier };
      lastLookPos = { x: t.clientX, y: t.clientY };
    }
  }
}

function onTouchMove(e) {
  if (!active) return;
  e.preventDefault();
  for (const t of e.changedTouches) {
    if (joystickOrigin && t.identifier === joystickOrigin.id) {
      joystickDelta = {
        x: clamp((t.clientX - joystickOrigin.x) / 55, -1, 1),
        y: clamp((t.clientY - joystickOrigin.y) / 55, -1, 1),
      };
    }
    if (lookTouch && t.identifier === lookTouch.id && lastLookPos) {
      yaw   -= (t.clientX - lastLookPos.x) * TOUCH_SENS;
      pitch  = clamp(pitch - (t.clientY - lastLookPos.y) * TOUCH_SENS, PITCH_MIN, PITCH_MAX);
      lastLookPos = { x: t.clientX, y: t.clientY };
    }
  }
}

function onTouchEnd(e) {
  // CRITICAL FIX: always clean up on touchend/touchcancel
  for (const t of e.changedTouches) {
    if (joystickOrigin && t.identifier === joystickOrigin.id) {
      joystickOrigin = null;
      joystickDelta  = { x: 0, y: 0 }; // immediate stop
    }
    if (lookTouch && t.identifier === lookTouch.id) {
      lookTouch   = null;
      lastLookPos = null;
    }
  }
}

// ── UPDATE ────────────────────────────────────────────────────
export function updateControls(delta) {
  if (!active || !camera) return;

  const speed   = keysHeld.has("shift") ? SPRINT_SPEED : WALK_SPEED;
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right   = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw));
  const move    = new THREE.Vector3();

  // Keyboard — WASD + arrows
  if (keysHeld.has("w") || keysHeld.has("arrowup"))    move.addScaledVector(forward,  1);
  if (keysHeld.has("s") || keysHeld.has("arrowdown"))  move.addScaledVector(forward, -1);
  if (keysHeld.has("d") || keysHeld.has("arrowright")) move.addScaledVector(right,    1);
  if (keysHeld.has("a") || keysHeld.has("arrowleft"))  move.addScaledVector(right,   -1);

  // Touch joystick
  if (joystickOrigin) {
    move.addScaledVector(right,   joystickDelta.x);
    move.addScaledVector(forward, -joystickDelta.y);
  }

  // CRITICAL FIX: directly set position with no velocity accumulation
  // If no keys/joystick held → move = zero → camera stays perfectly still
  if (move.lengthSq() > 0.0001) {
    move.normalize().multiplyScalar(speed * delta);
    camera.position.add(move);
  }

  clampCamera();
  applyRotation();
}

function applyRotation() {
  if (!camera) return;
  camera.rotation.order = "YXZ";
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

function clampCamera() {
  camera.position.x = clamp(camera.position.x, WORLD.xMin, WORLD.xMax);
  camera.position.z = clamp(camera.position.z, WORLD.zMin, WORLD.zMax);
  camera.position.y = EYE_HEIGHT;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ── WebXR ─────────────────────────────────────────────────────
export async function enterVR(renderer, scene, camera, clock, onFrame) {
  if (!("xr" in navigator)) { alert("WebXR not supported on this device."); return; }
  try {
    const session = await navigator.xr.requestSession("immersive-vr", {
      requiredFeatures: ["local-floor"],
    });
    renderer.xr.enabled = true;
    await renderer.xr.setSession(session);
    renderer.setAnimationLoop((t, frame) => {
      onFrame(clock.getDelta());
      renderer.render(scene, camera);
    });
    session.addEventListener("end", () => {
      renderer.xr.enabled = false;
      renderer.setAnimationLoop(null);
    });
  } catch (err) {
    alert("VR session could not start: " + err.message);
  }
}
