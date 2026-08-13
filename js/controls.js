/**
 * Project XIX — Controls Module
 * Handles: keyboard/mouse free-walk, pointer lock (FPS),
 * touch joystick + gyroscope (mobile), WebXR VR mode.
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { WORLD } from "./data.js";

const WALK_SPEED   = 12;
const SPRINT_SPEED = 26;
const DAMPING      = 0.84;
const EYE_HEIGHT   = 1.65;
const PITCH_MIN    = -0.72;
const PITCH_MAX    =  0.62;
const MOUSE_SENS   = 0.0028;
const TOUCH_SENS   = 0.003;

let camera, renderer;
let yaw   = Math.PI;   // facing south (toward clubhouse) by default
let pitch = 0;
let velocity = new THREE.Vector3();
let active = false;

const keys = new Set();

// Touch joystick state
let joystickOrigin = null;
let joystickDelta  = { x: 0, y: 0 };
let lookTouch = null;
let lastLookPos = null;

// Gyroscope
let gyroEnabled = false;
let gyroAlpha   = 0;
let gyroBeta    = 0;
let gyroGamma   = 0;

// Pointer lock
let pointerLocked = false;

export function initControls(cam, ren) {
  camera   = cam;
  renderer = ren;

  // Keyboard
  window.addEventListener("keydown", e => {
    keys.add(e.key.toLowerCase());
    if (e.key.toLowerCase() === "escape" && pointerLocked) {
      document.exitPointerLock();
    }
  });
  window.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));

  // Mouse look (drag on canvas, no pointer lock required)
  renderer.domElement.addEventListener("mousemove", onMouseMove);
  renderer.domElement.addEventListener("mousedown", () => {
    if (!pointerLocked && active) {
      renderer.domElement.requestPointerLock();
    }
  });
  document.addEventListener("pointerlockchange", () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
  });

  // Touch joystick + look
  renderer.domElement.addEventListener("touchstart",  onTouchStart,  { passive: false });
  renderer.domElement.addEventListener("touchmove",   onTouchMove,   { passive: false });
  renderer.domElement.addEventListener("touchend",    onTouchEnd,    { passive: false });

  // Gyroscope (mobile VR-lite)
  if (window.DeviceOrientationEvent) {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      // iOS 13+ — will be requested on first user gesture
    } else {
      window.addEventListener("deviceorientation", onGyro);
      gyroEnabled = true;
    }
  }

  return { activate, deactivate, setView, update: updateControls };
}

export function activate() { active = true; }
export function deactivate() { active = false; velocity.set(0, 0, 0); }

export function setView(pos, newYaw = Math.PI, newPitch = 0) {
  camera.position.set(...pos);
  yaw   = newYaw;
  pitch = newPitch;
  velocity.set(0, 0, 0);
  applyRotation();
}

export function getYaw() { return yaw; }

// ─── GYROSCOPE REQUEST ───────────────────────────────────────────────────────

export async function requestGyro() {
  if (typeof DeviceOrientationEvent.requestPermission === "function") {
    const result = await DeviceOrientationEvent.requestPermission();
    if (result === "granted") {
      window.addEventListener("deviceorientation", onGyro);
      gyroEnabled = true;
    }
  }
}

function onGyro(e) {
  if (!active || !gyroEnabled) return;
  gyroAlpha = e.alpha || 0;
  gyroBeta  = (e.beta || 0)  * (Math.PI / 180);
  gyroGamma = (e.gamma || 0) * (Math.PI / 180);
  yaw   = -gyroAlpha * (Math.PI / 180);
  pitch = clamp(gyroBeta - Math.PI / 6, PITCH_MIN, PITCH_MAX);
}

// ─── MOUSE ────────────────────────────────────────────────────────────────────

function onMouseMove(e) {
  if (!active) return;
  if (pointerLocked) {
    yaw   -= e.movementX * MOUSE_SENS;
    pitch  = clamp(pitch - e.movementY * MOUSE_SENS, PITCH_MIN, PITCH_MAX);
  }
}

// ─── TOUCH ────────────────────────────────────────────────────────────────────

function onTouchStart(e) {
  if (!active) return;
  e.preventDefault();
  for (const t of e.changedTouches) {
    const halfW = renderer.domElement.clientWidth / 2;
    if (t.clientX < halfW) {
      // Left side — joystick
      joystickOrigin = { x: t.clientX, y: t.clientY, id: t.identifier };
    } else {
      // Right side — look
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
        x: clamp((t.clientX - joystickOrigin.x) / 60, -1, 1),
        y: clamp((t.clientY - joystickOrigin.y) / 60, -1, 1),
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
  for (const t of e.changedTouches) {
    if (joystickOrigin && t.identifier === joystickOrigin.id) {
      joystickOrigin = null;
      joystickDelta  = { x: 0, y: 0 };
    }
    if (lookTouch && t.identifier === lookTouch.id) {
      lookTouch   = null;
      lastLookPos = null;
    }
  }
}

// ─── UPDATE (called every frame) ─────────────────────────────────────────────

export function updateControls(delta) {
  if (!active || !camera) return;

  const speed   = keys.has("shift") ? SPRINT_SPEED : WALK_SPEED;
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right   = new THREE.Vector3( Math.cos(yaw), 0, -Math.sin(yaw));
  const move    = new THREE.Vector3();

  // Keyboard WASD / arrow keys
  if (keys.has("w") || keys.has("arrowup"))    move.add(forward);
  if (keys.has("s") || keys.has("arrowdown"))  move.addScaledVector(forward, -1);
  if (keys.has("d") || keys.has("arrowright")) move.add(right);
  if (keys.has("a") || keys.has("arrowleft"))  move.addScaledVector(right, -1);

  // Touch joystick
  if (joystickDelta.x || joystickDelta.y) {
    move.addScaledVector(right,   joystickDelta.x);
    move.addScaledVector(forward, -joystickDelta.y);
  }

  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(speed);
    velocity.copy(move);
  } else {
    velocity.multiplyScalar(DAMPING);
  }

  camera.position.addScaledVector(velocity, delta);
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
  camera.position.y = clamp(camera.position.y, 0.8, 15);
  if (camera.position.y < EYE_HEIGHT) camera.position.y = EYE_HEIGHT;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ─── WEBXR ───────────────────────────────────────────────────────────────────

export async function enterVR(renderer, scene, camera, clock, onFrame) {
  if (!("xr" in navigator)) { alert("WebXR not supported on this device or browser."); return; }
  try {
    const session = await navigator.xr.requestSession("immersive-vr", {
      requiredFeatures: ["local-floor"],
    });
    renderer.xr.enabled = true;
    renderer.xr.setSession(session);
    renderer.setAnimationLoop((t, frame) => {
      onFrame(clock.getDelta());
      renderer.render(scene, camera);
    });
    session.addEventListener("end", () => {
      renderer.xr.enabled = false;
      renderer.setAnimationLoop(null);
    });
  } catch (err) {
    console.warn("WebXR session error:", err);
    alert("VR session could not start: " + err.message);
  }
}
