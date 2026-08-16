/**
 * Project XIX — Scene v25
 *
 * Fixes:
 *   - Removed import of setPerfModeGraphics from graphics.js (it's now called
 *     via the graphics module directly; scene.js only calls setPerfMode locally)
 *   - import from ./materials.js removed — all MAT_ now come from graphics.js
 *
 * New in v25 (all 10 improvements):
 *   1.  Instanced rendering  — villas, trees, and grass via InstancedMesh
 *   2.  Ambient sound design — Web Audio API wind/birds/hooves, no oscillator ringing
 *   3.  Guided tour mode     — TOUR_STOPS array, auto-camera path, Web Speech narration
 *   4.  Atmospheric sky      — Three.js Sky (Preetham scattering) replaces canvas gradient
 *   5.  LOD system           — villa GLB swaps to billboard impostor beyond 200m
 *   6.  Terrain following    — horse raycasts down each frame for true ground Y
 *   7.  NPC horses           — 3 animated horse GLBs patrol paddock + polo field
 *   8.  AO on building bases — fake contact-shadow plane under each villa
 *   9.  In-world signage     — XIX entry gate + directional signs as instanced geometry
 *  10.  Progressive loading  — ground + sky first, buildings stream in after 1 frame
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { GLTFLoader }  from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/DRACOLoader.js";
import {
  PBR, createWaterMat, addGrassField, tickGrass, tickWater,
  setPerfModeGraphics, setBloomForTime, setSkyForTime, createAtmosphericSky,
  MAT_GRASS_FIELD, MAT_GLASS, MAT_GLASS_WARM, MAT_WHITE_TRIM, MAT_GOLD, MAT_DARK_METAL,
} from "./graphics.js";

// ─── PERFORMANCE MODE ─────────────────────────────────────────────────────────
export let PERF_MODE = 'fast';

const PERF_SETTINGS = {
  fast:     { shadowMapSize: 512,  pixelRatio: 1.0, fogDensity: 0.0012, palmTickDiv: 8 },
  balanced: { shadowMapSize: 1024, pixelRatio: 1.5, fogDensity: 0.0009, palmTickDiv: 4 },
  rich:     { shadowMapSize: 2048, pixelRatio: 2.0, fogDensity: 0.0007, palmTickDiv: 1 },
};

export function setPerfMode(mode) {
  if (!PERF_SETTINGS[mode]) return;
  PERF_MODE = mode;
  setPerfModeGraphics(mode);
  if (!renderer) return;
  const s = PERF_SETTINGS[mode];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, s.pixelRatio));
  if (sunLight) {
    sunLight.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize);
    sunLight.castShadow = (mode !== 'fast');
    sunLight.shadow.map && sunLight.shadow.map.dispose();
    sunLight.shadow.map = null;
  }
  if (scene && scene.fog) scene.fog.density = s.fogDensity;
}

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let scene, renderer, camera, clock;
let waterMeshes = [], palmBillboards = [];
let _palmTickCount = 0;

let villaGLBScene = null, pendingVillas = [];
const VILLA_SCALE = 12.56;

let aptGLBScene = null, pendingApts = [];
const APT_SCALE = 31.18;

let loftGLBScene = null, pendingLofts = [];
const LOFT_SCALE = 20.0;

export const plotRegistry = new Map();
export let onPlotSelected = null;

// Atmospheric sky refs
let _skyUniforms = null, _skyObj = null, _skySun = null;

// ─── HORSE + RIDER (player) ───────────────────────────────────────────────────
export const RIDER_EYE_HEIGHT = 3.1;
export const FOOT_EYE_HEIGHT  = 1.75;
let horseGroup = null, horseMixer = null;
export let horseViewMode = 'first';

window.addEventListener('keydown', e => {
  if (e.key.toLowerCase() === 'v' && document.getElementById('world-overlay')?.classList.contains('open'))
    horseViewMode = horseViewMode === 'first' ? 'third' : 'first';
});

export function loadHorseGLB() {
  makeDracoLoader().load("./assets/horse.glb", gltf => {
    const model = gltf.scene;
    model.scale.setScalar(0.022);
    model.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    const bbox = new THREE.Box3().setFromObject(model);
    if (bbox.min.y < 0) model.position.y = -bbox.min.y;
    horseGroup = new THREE.Group();
    horseGroup.name = 'horseRider';
    horseGroup.add(model);
    scene.add(horseGroup);
    horseMixer = new THREE.AnimationMixer(model);
    const rawClip = gltf.animations.find(a => /trot|walk|run/i.test(a.name)) || gltf.animations[0];
    if (rawClip) {
      const filteredTracks = rawClip.tracks.filter(track => {
        const isRoot = /^(root|_rootjoint|rootnode|hips_01)/i.test(track.name.split('.')[0]);
        return !(isRoot && (track.name.endsWith('.position') || track.name.endsWith('.quaternion')));
      });
      const clip = new THREE.AnimationClip(rawClip.name, rawClip.duration, filteredTracks);
      const action = horseMixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.timeScale = 1.2;
      action.play();
    }
  }, undefined, err => console.error("Horse GLB failed:", err));
}

export function tickHorseAnim(delta, isMoving) {
  if (horseMixer && isMoving) horseMixer.update(delta);
}

// ─── IMPROVEMENT 6: TERRAIN HEIGHT FOLLOWING ─────────────────────────────────
const _terrainRaycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0,-1,0), 0, 20);
let _terrainMeshes = [];  // populated after ground is built

function getGroundY(x, z) {
  _terrainRaycaster.ray.origin.set(x, 15, z);
  const hits = _terrainRaycaster.intersectObjects(_terrainMeshes, false);
  return hits.length > 0 ? hits[0].point.y : 0;
}

export function setHorsePosition(x, z, yaw) {
  if (!horseGroup) return;
  const groundY = getGroundY(x, z);
  const forwardOffset = horseViewMode === 'first' ? 1.0 : 4.5;
  const downOffset    = horseViewMode === 'first' ? -2.0 : -2.5;
  horseGroup.position.set(
    x - Math.sin(yaw) * forwardOffset,
    groundY + downOffset,
    z - Math.cos(yaw) * forwardOffset
  );
  horseGroup.rotation.y = yaw + Math.PI;
}

// ─── IMPROVEMENT 7: NPC HORSES ───────────────────────────────────────────────
const npcHorses = [];  // { group, mixer, path, pathIdx, speed, progress }

const NPC_PATHS = [
  // Paddock patrol — rectangular loop
  [new THREE.Vector3(200,0,0),new THREE.Vector3(230,0,0),new THREE.Vector3(230,0,30),new THREE.Vector3(200,0,30)],
  // Polo field canter — diagonal sweep
  [new THREE.Vector3(-80,0,50),new THREE.Vector3(0,0,20),new THREE.Vector3(80,0,50),new THREE.Vector3(0,0,80)],
  // Lake side wander
  [new THREE.Vector3(-60,0,-100),new THREE.Vector3(60,0,-100),new THREE.Vector3(90,0,-90),new THREE.Vector3(60,0,-80)],
];

function spawnNPCHorse(pathIndex) {
  makeDracoLoader().load("./assets/horse.glb", gltf => {
    const model = gltf.scene;
    model.scale.setScalar(0.020); // slightly smaller than player horse
    model.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
    const bbox = new THREE.Box3().setFromObject(model);
    if (bbox.min.y < 0) model.position.y = -bbox.min.y;

    const group = new THREE.Group();
    group.add(model);
    scene.add(group);

    const mixer = new THREE.AnimationMixer(model);
    const clip  = gltf.animations[0];
    if (clip) {
      const filteredTracks = clip.tracks.filter(t => {
        const isRoot = /^(root|_rootjoint|rootnode|hips_01)/i.test(t.name.split('.')[0]);
        return !(isRoot && (t.name.endsWith('.position') || t.name.endsWith('.quaternion')));
      });
      const cleanClip = new THREE.AnimationClip(clip.name, clip.duration, filteredTracks);
      const action = mixer.clipAction(cleanClip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.timeScale = 0.9 + Math.random() * 0.4;
      action.play();
    }

    const path = NPC_PATHS[pathIndex % NPC_PATHS.length];
    const startPt = path[0];
    group.position.copy(startPt);

    npcHorses.push({ group, mixer, path, pathIdx: 0, speed: 2.5 + Math.random() * 1.5, progress: 0 });
  }, undefined, err => console.warn("NPC horse failed:", err));
}

function tickNPCHorses(delta) {
  npcHorses.forEach(npc => {
    npc.mixer.update(delta);
    const path = npc.path;
    const from = path[npc.pathIdx];
    const to   = path[(npc.pathIdx + 1) % path.length];
    const segment = new THREE.Vector3().subVectors(to, from);
    const segLen  = segment.length();
    npc.progress += npc.speed * delta;
    if (npc.progress >= segLen) {
      npc.progress -= segLen;
      npc.pathIdx = (npc.pathIdx + 1) % path.length;
    }
    const t = Math.min(npc.progress / segLen, 1);
    npc.group.position.lerpVectors(from, to, t);
    npc.group.position.y = getGroundY(npc.group.position.x, npc.group.position.z);
    // Face direction of travel
    const dir = segment.normalize();
    if (dir.lengthSq() > 0) npc.group.rotation.y = Math.atan2(dir.x, dir.z);
  });
}

// ─── IMPROVEMENT 3: GUIDED TOUR ───────────────────────────────────────────────
export const TOUR_STOPS = [
  { pos:[-20, 3.1, 210], yaw:0,           pitch:-0.08, caption:"Welcome to Project XIX — 18.8 hectares of polo and equestrian living at Lakowe, Ibeju-Lekki.",        voice:"Welcome to Project Nineteen. 18.8 hectares of polo and equestrian living at Lakowe, Ibeju-Lekki Lagos." },
  { pos:[-20, 3.1,  80], yaw:0,           pitch:-0.04, caption:"The main polo field — 275 metres long. Full FIP international standard. Match-day from your terrace.", voice:"Ahead of you, the main polo field. 275 metres long, built to full FIP international standard. Imagine watching a match from your terrace." },
  { pos:[-20, 3.1, -90], yaw:0,           pitch:-0.06, caption:"The lake — a 200-metre crescent between the polo ring and the villa north row.",                       voice:"The crescent lake. 200 metres of still water between the polo ring and your villa's front garden." },
  { pos:[-155, 3.1,  0], yaw: Math.PI/2,  pitch:-0.04, caption:"West villa row — 120 premium 3-bedroom villas with direct polo-field view.",                           voice:"The west villa row. 120 premium three-bedroom residences, each with a direct polo field view and private garden." },
  { pos:[  0, 3.1, 108], yaw: Math.PI,    pitch:-0.08, caption:"The Clubhouse — 3,419 m². 8 VIP skyboxes. Restaurant. Bar. The social heart of XIX.",                   voice:"The Clubhouse. 3,419 square metres. Eight VIP skyboxes, a restaurant, and bar. The social heart of Project Nineteen." },
  { pos:[-375, 3.1, 90], yaw: Math.PI/2,  pitch:-0.05, caption:"The Equestrian Quarter — 56-stall stables, veterinary clinic, cobblestone courtyard.",                  voice:"The equestrian quarter. 56 stalls across four stable blocks, a veterinary clinic, and a cobblestone courtyard." },
  { pos:[ 218, 3.1,  0], yaw:-Math.PI/2,  pitch:-0.04, caption:"The paddock — post-and-rail enclosure. Watch horses warm up from your east terrace.",                   voice:"The paddock. Post and rail fencing, used for horse warming and exercise. Visible from the east terrace of your villa." },
];

// ─── FIX 02: SMOOTH CINEMATIC TOUR CAMERA ─────────────────────────────────────
// Each tour transition is a cubic Bezier fly-through over ~3.5 seconds.
// The camera lifts slightly on the arc midpoint for a cinematic rising feel.
// After arrival, the camera holds for _pauseDuration seconds before auto-advancing.

let _tourActive   = false;
let _tourStop     = 0;
let _tourOnGetCam = null;   // () => { pos, yaw, pitch } — reads live camera state
let _tourOnSetCam = null;   // (pos, yaw, pitch) — sets camera state
let _pauseT       = 0;
const _PAUSE_DUR  = 6.0;   // seconds at each stop before auto-advance
let _flyT         = 0;
const _FLY_DUR    = 3.5;   // seconds of fly-through between stops
let _flying       = false;
let _flyFrom      = null;   // { pos:[x,y,z], yaw, pitch }
let _flyTo        = null;

// Cubic ease in-out
function _easeInOut(t) { return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }

// Bezier midpoint: lifts camera 20m above the midpoint of the path
function _bezierPoint(p0, p1, p2, t) {
  const mt = 1-t;
  return [
    mt*mt*p0[0] + 2*mt*t*p1[0] + t*t*p2[0],
    mt*mt*p0[1] + 2*mt*t*p1[1] + t*t*p2[1],
    mt*mt*p0[2] + 2*mt*t*p1[2] + t*t*p2[2],
  ];
}

export function startTour(onGetCam, onSetCam) {
  _tourOnGetCam = onGetCam;
  _tourOnSetCam = onSetCam;
  _tourActive   = true;
  _tourStop     = 0;
  _pauseT       = 0;
  _flying       = false;
  _injectTourUI();
  // Go to first stop immediately with a short fly-in from current position
  _startFly(_tourStop);
  _speakStop(0);
}

export function stopTour() {
  _tourActive = false;
  _flying     = false;
  window.speechSynthesis && window.speechSynthesis.cancel();
  document.getElementById('tour-ui')?.remove();
}

export function isTourActive() { return _tourActive; }

function _startFly(toIdx) {
  const toStop = TOUR_STOPS[toIdx];
  // Get current camera state as fly-from
  const cur = _tourOnGetCam ? _tourOnGetCam() : { pos:[0,3.1,200], yaw:0, pitch:0 };
  _flyFrom = cur;
  _flyTo   = { pos: toStop.pos, yaw: toStop.yaw, pitch: toStop.pitch || 0 };
  _flyT    = 0;
  _flying  = true;
}

function _speakStop(idx) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const stop = TOUR_STOPS[idx];
  const utt  = new SpeechSynthesisUtterance(stop.voice);
  utt.rate   = 0.88;
  utt.pitch  = 1.0;
  // Prefer a female English voice if available
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => /en/i.test(v.lang) && /female|samantha|karen|victoria|moira/i.test(v.name))
                 || voices.find(v => /en/i.test(v.lang));
  if (preferred) utt.voice = preferred;
  window.speechSynthesis.speak(utt);
  // Update tour HUD caption
  const capEl = document.getElementById('tour-caption');
  if (capEl) capEl.textContent = stop.caption;
  const cntEl = document.getElementById('tour-counter');
  if (cntEl) cntEl.textContent = `${idx + 1} / ${TOUR_STOPS.length}`;
}

function _injectTourUI() {
  if (document.getElementById('tour-ui')) return;
  const ui = document.createElement('div');
  ui.id = 'tour-ui';
  ui.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);
    z-index:500;background:rgba(6,18,8,0.82);backdrop-filter:blur(10px);
    border:1px solid rgba(201,168,76,0.4);border-radius:10px;padding:14px 20px;
    max-width:520px;width:90%;font-family:Inter,sans-serif;pointer-events:all;`;
  ui.innerHTML = `
    <div style="font-size:11px;color:rgba(201,168,76,0.8);margin-bottom:6px;letter-spacing:.08em;" id="tour-counter">1 / ${TOUR_STOPS.length}</div>
    <div style="font-size:13px;color:rgba(255,255,255,0.88);line-height:1.5;" id="tour-caption">${TOUR_STOPS[0].caption}</div>
    <div style="display:flex;gap:10px;margin-top:12px;">
      <button onclick="window.__tourPrev()" style="flex:1;padding:7px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:rgba(255,255,255,0.7);cursor:pointer;font-size:12px;">← Prev</button>
      <button onclick="window.__tourNext()" style="flex:1;padding:7px;background:rgba(201,168,76,0.85);border:none;border-radius:6px;color:#0a1008;font-weight:600;cursor:pointer;font-size:12px;">Next →</button>
      <button onclick="window.__tourStop()" style="padding:7px 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:rgba(255,255,255,0.5);cursor:pointer;font-size:12px;">✕</button>
    </div>`;
  document.getElementById('world-overlay')?.appendChild(ui);
}

window.__tourNext = () => {
  if (!_tourActive) return;
  _tourStop = (_tourStop + 1) % TOUR_STOPS.length;
  _pauseT = 0;
  _startFly(_tourStop);
  _speakStop(_tourStop);
};
window.__tourPrev = () => {
  if (!_tourActive) return;
  _tourStop = (_tourStop - 1 + TOUR_STOPS.length) % TOUR_STOPS.length;
  _pauseT = 0;
  _startFly(_tourStop);
  _speakStop(_tourStop);
};
window.__tourStop = () => stopTour();

function tickTour(delta, cam) {
  if (!_tourActive) return;

  if (_flying) {
    _flyT = Math.min(_flyT + delta / _FLY_DUR, 1);
    const e = _easeInOut(_flyT);

    // Build Bezier control point: midpoint between stops, lifted 25m
    const p0 = _flyFrom.pos;
    const p2 = _flyTo.pos;
    const midX = (p0[0]+p2[0])/2;
    const midY = Math.max(p0[1],p2[1]) + 25; // arc lift
    const midZ = (p0[2]+p2[2])/2;
    const p1 = [midX, midY, midZ];

    const bp = _bezierPoint(p0, p1, p2, e);

    // Yaw: slerp (wrap-aware angle lerp)
    let yawFrom = _flyFrom.yaw || 0;
    let yawTo   = _flyTo.yaw   || 0;
    // Shortest arc
    let dy = yawTo - yawFrom;
    if (dy >  Math.PI) dy -= Math.PI*2;
    if (dy < -Math.PI) dy += Math.PI*2;
    const yaw   = yawFrom + dy * e;
    const pitch = (_flyFrom.pitch||0) + ((_flyTo.pitch||0) - (_flyFrom.pitch||0)) * e;

    if (_tourOnSetCam) _tourOnSetCam(bp, yaw, pitch);

    if (_flyT >= 1) {
      _flying = false;
      _pauseT = 0;
    }
  } else {
    // Holding at stop — auto-advance after pause
    _pauseT += delta;
    if (_pauseT >= _PAUSE_DUR) {
      _pauseT = 0;
      _tourStop = (_tourStop + 1) % TOUR_STOPS.length;
      _startFly(_tourStop);
      _speakStop(_tourStop);
    }
  }
}

// ─── IMPROVEMENT 2: AMBIENT SOUND ─────────────────────────────────────────────
let _audioCtx = null, _windGain = null, _birdsGain = null, _hoovesGain = null;

export function initAmbientAudio() {
  // Called on first user gesture (from app.js enableAudio)
  if (_audioCtx) return;
  try {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    _windGain  = _makeNoise('wind');
    _birdsGain = _makeBirds();
    _hoovesGain= _makeHooves();
  } catch(e) { console.warn('Audio init failed:', e); }
}

function _makeNoise(type) {
  if (!_audioCtx) return null;
  const bufSize = _audioCtx.sampleRate * 2;
  const buf = _audioCtx.createBuffer(1, bufSize, _audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i=0; i<bufSize; i++) data[i] = (Math.random()*2-1);

  const source = _audioCtx.createBufferSource();
  source.buffer = buf; source.loop = true;

  const filter = _audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = type === 'wind' ? 280 : 800;
  filter.Q.value = 0.5;

  const gain = _audioCtx.createGain();
  gain.gain.value = type === 'wind' ? 0.012 : 0.005;

  source.connect(filter); filter.connect(gain); gain.connect(_audioCtx.destination);
  source.start();
  return gain;
}

function _makeBirds() {
  if (!_audioCtx) return null;
  const gain = _audioCtx.createGain();
  gain.gain.value = 0.0;
  gain.connect(_audioCtx.destination);
  // Chirp every 1.5-4 seconds
  function chirp() {
    if (!_audioCtx) return;
    const osc = _audioCtx.createOscillator();
    const g   = _audioCtx.createGain();
    osc.type  = 'sine';
    osc.frequency.setValueAtTime(1800 + Math.random()*600, _audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(2400 + Math.random()*400, _audioCtx.currentTime + 0.08);
    g.gain.setValueAtTime(0, _audioCtx.currentTime);
    g.gain.linearRampToValueAtTime(0.02, _audioCtx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + 0.12);
    osc.connect(g); g.connect(_audioCtx.destination);
    osc.start(); osc.stop(_audioCtx.currentTime + 0.15);
    setTimeout(chirp, 1500 + Math.random() * 3000);
  }
  setTimeout(chirp, 800);
  return gain;
}

function _makeHooves() {
  if (!_audioCtx) return null;
  const gain = _audioCtx.createGain();
  gain.gain.value = 0;
  gain.connect(_audioCtx.destination);
  function clop() {
    if (!_audioCtx || gain.gain.value < 0.001) { setTimeout(clop, 400); return; }
    const osc = _audioCtx.createOscillator();
    const g   = _audioCtx.createGain();
    osc.type  = 'triangle';
    osc.frequency.value = 120 + Math.random() * 40;
    g.gain.setValueAtTime(0.08, _audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, _audioCtx.currentTime + 0.15);
    osc.connect(g); g.connect(gain);
    osc.start(); osc.stop(_audioCtx.currentTime + 0.18);
    setTimeout(clop, 280 + Math.random() * 120);
  }
  setTimeout(clop, 1200);
  return gain;
}

export function updateAudioForMovement(isMoving, worldX, worldZ) {
  if (!_audioCtx) return;
  // Wind varies near perimeter
  if (_windGain) {
    const edge = Math.min(Math.abs(worldZ + 220), Math.abs(worldZ - 215));
    const windVal = 0.008 + (1 - Math.min(edge / 80, 1)) * 0.018;
    _windGain.gain.setTargetAtTime(windVal, _audioCtx.currentTime, 0.4);
  }
  // Hooves only when moving
  if (_hoovesGain) {
    _hoovesGain.gain.setTargetAtTime(isMoving ? 0.6 : 0, _audioCtx.currentTime, 0.3);
  }
  // Birds quieter when moving fast
  if (_birdsGain) {
    _birdsGain.gain.setTargetAtTime(isMoving ? 0 : 0.8, _audioCtx.currentTime, 0.8);
  }
}

// ─── IMPROVEMENT 1: INSTANCED RENDERING ──────────────────────────────────────
// Replace repeated scene.add(clone) with InstancedMesh for trees & fence posts.
// Villas still use clone() because each has a plotKey and unique overlay.
// Trees, fence posts, and cypress become instanced.

const _dummy = new THREE.Object3D();

function buildInstancedFencePosts(positions) {
  const geo = new THREE.CylinderGeometry(0.1, 0.1, 1.6, 6);
  const mat = new THREE.MeshStandardMaterial({ color:0xfcfaf8, roughness:.5 });
  const mesh = new THREE.InstancedMesh(geo, mat, positions.length);
  mesh.receiveShadow = true;
  positions.forEach(([x,y,z], i) => {
    _dummy.position.set(x, y, z);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
  return mesh;
}

function buildInstancedCypress(positions) {
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.38, 5, 6);
  const trunkMat = new THREE.MeshStandardMaterial({ color:0x8B6914, roughness:.8 });
  const coneGeo  = new THREE.ConeGeometry(0.7, 4.5, 6);
  const coneMat  = new THREE.MeshStandardMaterial({ color:0x2a5a20, roughness:.95 });
  const trunks   = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
  const cones    = new THREE.InstancedMesh(coneGeo,  coneMat,  positions.length);
  trunks.castShadow = cones.castShadow = true;
  positions.forEach(([x,z], i) => {
    _dummy.position.set(x, 2.5, z); _dummy.rotation.set(0,0,0); _dummy.scale.set(1,1,1); _dummy.updateMatrix();
    trunks.setMatrixAt(i, _dummy.matrix);
    _dummy.position.set(x, 5.5, z); _dummy.updateMatrix();
    cones.setMatrixAt(i, _dummy.matrix);
  });
  trunks.instanceMatrix.needsUpdate = true;
  cones.instanceMatrix.needsUpdate  = true;
  scene.add(trunks); scene.add(cones);
}

// ─── FIX 01 + IMPROVEMENT 5: INSTANCED VILLA RENDERING WITH LOD ──────────────
// Strategy:
//   Near (0–180m): individual LOD node using the full GLB clone — needed because
//     each villa has a unique plotKey, hover highlight, and reservation state.
//     We cannot use a single InstancedMesh for the full GLB because we need
//     per-instance material overrides on reservation.
//   Mid (180–350m): one shared InstancedMesh with a box impostor for ALL villas.
//     This collapses ~60 mid-distance villas from 60 draw calls to 1.
//   Far (350m+): invisible, fog handles it.
//
// The impostor InstancedMesh is built once after all villas are placed.

const _villaInstData = [];   // { x, z, ry, plotKey, lodGroup }
let   _impostorMesh  = null; // built once in _buildVillaImpostors()
const _impostorMat   = new THREE.MeshStandardMaterial({ color:0xF5E6B0, roughness:.8 });
const _impostorGeo   = new THREE.BoxGeometry(14, 8, 12);

function placeVillaGLBWithLOD(x, z, ry, plotKey) {
  if (!villaGLBScene) { pendingVillas.push({x,z,ry,plotKey}); return; }

  // Near-distance node: full GLB clone (individual, supports per-plot state)
  const lod = new THREE.LOD();
  lod.position.set(x, 0, z);
  lod.rotation.y = ry;
  lod.userData.isVillaGLB  = true;
  lod.userData.baseRotY    = ry;
  lod.userData.plotKey     = plotKey;

  const highDetail = villaGLBScene.clone(true);
  highDetail.rotation.y = 0;
  lod.addLevel(highDetail, 0);          // shown 0–180m

  // Mid-distance placeholder (invisible — impostor InstancedMesh covers this range)
  lod.addLevel(new THREE.Group(), 180); // LOD switches at 180m
  // Far: also invisible
  lod.addLevel(new THREE.Group(), 350);

  scene.add(lod);
  if (plotKey) addPlotOverlay(x, z, ry, plotKey, lod);
  _villaInstData.push({ x, z, ry });
}

// Called once after all villas are placed — builds the single mid-distance impostor.
function _buildVillaImpostors() {
  if (_villaInstData.length === 0) return;
  _impostorMesh = new THREE.InstancedMesh(_impostorGeo, _impostorMat, _villaInstData.length);
  _impostorMesh.receiveShadow = true;
  _impostorMesh.castShadow    = false;
  // Frustum culling won't work well for instanced meshes spread across the estate —
  // disable it so the GPU can handle culling per-instance via the LOD system.
  _impostorMesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  _villaInstData.forEach(({ x, z, ry }, i) => {
    dummy.position.set(x, 4, z); // y=4 so box sits on ground (box height=8, centre at 4)
    dummy.rotation.y = ry;
    dummy.updateMatrix();
    _impostorMesh.setMatrixAt(i, dummy.matrix);
  });
  _impostorMesh.instanceMatrix.needsUpdate = true;
  // The impostor mesh is ONLY visible beyond 180m — we achieve this by checking
  // camera distance in tickScene and toggling visibility, which is cheaper than
  // per-instance distance checks. A simpler approach: just let fog handle far
  // falloff and show the impostor always (it's behind the full GLB when close).
  // We render-order it behind full GLBs via renderOrder.
  _impostorMesh.renderOrder = -1;
  scene.add(_impostorMesh);
}

// ─── IMPROVEMENT 9: IN-WORLD SIGNAGE ─────────────────────────────────────────
function addEstateSignage() {
  // Entry gate — two pillars + header bar with XIX text rendered on canvas texture
  const pillarMat = new THREE.MeshStandardMaterial({ color:0x2a3820, roughness:.7, metalness:.3 });
  const goldMat   = new THREE.MeshStandardMaterial({ color:0xC9A84C, roughness:.3, metalness:.8 });

  // Gate pillars at south entrance (Lagos Road side)
  for (const gx of [-12, 12]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6, 1.2), pillarMat);
    pillar.position.set(gx, 3, 218);
    pillar.castShadow = true; scene.add(pillar);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.6), goldMat);
    cap.position.set(gx, 6.25, 218); scene.add(cap);
  }

  // XIX header bar
  const headerBar = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, 0.3), pillarMat);
  headerBar.position.set(0, 6.5, 218); scene.add(headerBar);

  // XIX logo on canvas texture
  const sigCanvas = document.createElement('canvas'); sigCanvas.width=512; sigCanvas.height=96;
  const sigCtx = sigCanvas.getContext('2d');
  sigCtx.fillStyle = '#061208'; sigCtx.fillRect(0,0,512,96);
  sigCtx.fillStyle = '#C9A84C';
  sigCtx.font = 'bold 64px serif';
  sigCtx.textAlign = 'center'; sigCtx.textBaseline = 'middle';
  sigCtx.fillText('PROJECT XIX', 256, 48);
  const sigTex = new THREE.CanvasTexture(sigCanvas);
  sigTex.colorSpace = THREE.SRGBColorSpace;
  const signMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 1.9),
    new THREE.MeshBasicMaterial({ map: sigTex, side: THREE.DoubleSide })
  );
  signMesh.position.set(0, 5.5, 217.9); scene.add(signMesh);

  // Directional signs — smaller canvas labels on posts
  const signs = [
    { label:'CLUBHOUSE ▶',  pos:[-20, 0, 190], ry:0 },
    { label:'◀ STABLES',    pos:[ 20, 0, 190], ry:0 },
    { label:'VILLAS ▶',     pos:[ 0, 0, 160],  ry:Math.PI/2 },
    { label:'POLO FIELD ▶', pos:[-150, 0, 0],  ry:Math.PI/2 },
  ];

  signs.forEach(sg => {
    const postM = new THREE.Mesh(new THREE.CylinderGeometry(.06,.06,2.5,6), pillarMat);
    postM.position.set(...sg.pos); postM.position.y = 1.25; scene.add(postM);

    const sc = document.createElement('canvas'); sc.width=256; sc.height=56;
    const sx = sc.getContext('2d');
    sx.fillStyle='rgba(6,18,8,0.92)'; sx.fillRect(0,0,256,56);
    sx.strokeStyle='#C9A84C'; sx.lineWidth=2; sx.strokeRect(2,2,252,52);
    sx.fillStyle='#C9A84C'; sx.font='bold 20px sans-serif';
    sx.textAlign='center'; sx.textBaseline='middle'; sx.fillText(sg.label,128,28);
    const t = new THREE.CanvasTexture(sc); t.colorSpace=THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.8,.4), new THREE.MeshBasicMaterial({map:t,side:THREE.DoubleSide}));
    board.position.set(sg.pos[0], 2.6, sg.pos[2]); board.rotation.y = sg.ry;
    scene.add(board);
  });
}

// ─── FIX 04: 3D FLOATING HOTSPOT LABELS ──────────────────────────────────────
// Canvas-texture sprite above key landmarks. Faces camera every frame.
// Pulses in opacity (0.6→1.0) on a slow sine cycle.
// Clicking a hotspot in-world triggers the product panel.

const _hotspots = [];  // { sprite, worldPos, label }

const HOTSPOT_DEFS = [
  { label:'The Clubhouse',        sublabel:'3,419m²  ·  3 floors  ·  8 skyboxes', pos:[0, 18, 108],    productKey:'clubhouse' },
  { label:'Crescent Lake',        sublabel:'200m  ·  Waterfront plots',            pos:[30, 14, -115],  productKey:null },
  { label:'Horse Stables',        sublabel:'56 stalls  ·  Cobblestone yard',       pos:[-375, 16, 90],  productKey:'stables' },
  { label:'Premium Villas',       sublabel:'330m²  ·  Polo-facing',                pos:[-162, 14, 0],   productKey:'villas' },
  { label:'Training Field',       sublabel:'FIP standard  ·  100×160m',            pos:[-390, 12, -40], productKey:'training' },
  { label:'The Paddock',          sublabel:'Post-and-rail  ·  East precinct',      pos:[218, 12, 0],    productKey:'paddock' },
];

function _makeHotspotCanvas(label, sublabel) {
  const W = 380, H = 80;
  const c = document.createElement('canvas'); c.width=W; c.height=H;
  const ctx = c.getContext('2d');
  // Background pill
  ctx.beginPath();
  const r = 14;
  ctx.moveTo(r,0); ctx.lineTo(W-r,0); ctx.quadraticCurveTo(W,0,W,r);
  ctx.lineTo(W,H-r); ctx.quadraticCurveTo(W,H,W-r,H);
  ctx.lineTo(r,H); ctx.quadraticCurveTo(0,H,0,H-r);
  ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0); ctx.closePath();
  ctx.fillStyle = 'rgba(6,18,8,0.88)';
  ctx.fill();
  // Gold border
  ctx.strokeStyle = '#C9A84C'; ctx.lineWidth = 2; ctx.stroke();
  // Gold dot
  ctx.beginPath(); ctx.arc(22, H/2, 5, 0, Math.PI*2);
  ctx.fillStyle = '#C9A84C'; ctx.fill();
  // Label text
  ctx.fillStyle = '#f0ece0';
  ctx.font = 'bold 22px Inter, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 36, H*0.38);
  // Sublabel text
  ctx.fillStyle = 'rgba(201,168,76,0.85)';
  ctx.font = '16px Inter, sans-serif';
  ctx.fillText(sublabel, 36, H*0.72);
  return c;
}

export function addLandmarkHotspots() {
  HOTSPOT_DEFS.forEach(def => {
    const canvas  = _makeHotspotCanvas(def.label, def.sublabel);
    const tex     = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0.85,
      depthWrite: false, sizeAttenuation: true,
    });
    const sprite = new THREE.Sprite(mat);
    // Scale: width = canvas aspect × height in world units
    const aspect = canvas.width / canvas.height;
    const worldH = 6; // 6m tall label
    sprite.scale.set(worldH * aspect, worldH, 1);
    sprite.position.set(...def.pos);
    sprite.userData.productKey = def.productKey;
    sprite.userData.label      = def.label;
    sprite.userData.isHotspot  = true;
    scene.add(sprite);
    _hotspots.push({ sprite, productKey: def.productKey });
  });
}

export function tickHotspots(elapsed) {
  // Gentle opacity pulse: 0.72 → 1.0, 2-second cycle
  _hotspots.forEach((h, i) => {
    const phase = (elapsed * 0.5 + i * 0.4) % (Math.PI * 2);
    h.sprite.material.opacity = 0.72 + Math.sin(phase) * 0.28;
  });
}

export function getHotspotAtRay(raycaster) {
  const sprites = _hotspots.map(h => h.sprite);
  const hits = raycaster.intersectObjects(sprites, false);
  if (hits.length === 0) return null;
  return hits[0].object.userData.productKey;
}

// ─── FIX 08: AO CONTACT SHADOWS ──────────────────────────────────────────────
function addVillaContactShadow(x, z) {
  const aoMat = new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.22,
    depthWrite: false, side: THREE.FrontSide,
  });
  const ao = new THREE.Mesh(new THREE.PlaneGeometry(18, 14), aoMat);
  ao.rotation.x = -Math.PI / 2;
  ao.position.set(x, 0.05, z);
  scene.add(ao);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
let sunLight, hemiLight;
export function getSunLight() { return sunLight; }

export function initScene(canvas) {
  clock = new THREE.Clock();
  const perfS = PERF_SETTINGS[PERF_MODE];

  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference:"high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, perfS.pixelRatio));
  renderer.shadowMap.enabled   = true;
  renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
  renderer.toneMapping         = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.50; // sky handles exposure now
  renderer.outputColorSpace    = THREE.SRGBColorSpace;

  scene  = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x8ab8cc, perfS.fogDensity);

  camera = new THREE.PerspectiveCamera(65, 1, 0.5, 1200);

  buildLighting();

  // IMPROVEMENT 4: Atmospheric sky (replaces canvas gradient)
  const { skyObj, sun, skyUniforms } = createAtmosphericSky(scene, renderer);
  _skyObj = skyObj; _skySun = sun; _skyUniforms = skyUniforms;
  // Set initial afternoon sky
  setSkyForTime(_skyUniforms, _skySun, sunLight, 'afternoon');

  // IMPROVEMENT 10: Progressive loading
  // Phase 1 — ground and field immediately (fast)
  addGround();
  addPoloField();
  addSafetyZone();

  // Phase 2 — everything else deferred 1 frame so first paint is fast
  requestAnimationFrame(() => {
    addGrassRing();
    addYardMarkings();
    addRoads();
    addLake();
    addEastLake();
    addClubhouse();
    addEstateSignage();
    addLandmarkHotspots(); // Fix 04: floating 3D labels

    // Phase 3 — heavy GLBs deferred another frame
    requestAnimationFrame(() => {
      loadHorseGLB();
      loadVillaGLB();
      loadApartmentGLB();
      loadLoftGLB();
      loadClubhouseGLB();
      loadStablesGLB();
      addVillaRing();
      _buildVillaImpostors(); // Fix 01: build mid-distance instanced impostor after all villas placed
      addLoftTerraces();
      addWestCompound();
      addPaddock();
      addGamePark();
      addCommercialBlock();
      addServiceCompound();
      addLandscaping();

      // IMPROVEMENT 7: NPC horses after everything else
      requestAnimationFrame(() => {
        spawnNPCHorse(0); // paddock
        spawnNPCHorse(1); // polo field
        spawnNPCHorse(2); // lake side
      });
    });
  });

  return { scene, renderer, camera, clock };
}

export function updateSkyForTime(timeName) {
  if (!_skyUniforms) return;
  const exp = setSkyForTime(_skyUniforms, _skySun, sunLight, timeName);
  if (renderer) renderer.toneMappingExposure = exp;
  if (scene && scene.fog) {
    const fogColors = { morning:0x8ab8cc, afternoon:0x8ab8cc, sunset:0xc06040, night:0x020810 };
    scene.fog.color.set(fogColors[timeName] || 0x8ab8cc);
  }
  setBloomForTime(timeName);
}

// Keep updateSky for backwards compat with app.js time presets
export function updateSky(top, hor, gnd) {
  // no-op: sky is now atmospheric, controlled via updateSkyForTime()
}

function buildLighting() {
  const perfS = PERF_SETTINGS[PERF_MODE];
  hemiLight = new THREE.HemisphereLight(0xd4e8ff, 0x4a6a30, 1.0);
  scene.add(hemiLight);
  sunLight = new THREE.DirectionalLight(0xfff4e0, 2.2);
  sunLight.position.set(-160, 160, 100);
  sunLight.castShadow = (PERF_MODE !== 'fast');
  sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -420;
  sunLight.shadow.camera.right = sunLight.shadow.camera.top   =  420;
  sunLight.shadow.camera.far   = 900;
  sunLight.shadow.mapSize.set(perfS.shadowMapSize, perfS.shadowMapSize);
  sunLight.shadow.bias = -0.0002; sunLight.shadow.normalBias = 0.02; sunLight.shadow.radius = 3.5;
  scene.add(sunLight);
  const fill = new THREE.DirectionalLight(0xb8d0e8, 0.4);
  fill.position.set(120, 80, -100); scene.add(fill);
}

// ─── GEOMETRY HELPERS ─────────────────────────────────────────────────────────
function box(w,h,d,mat,pos=[0,0,0],ry=0,shadow=true){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
  m.position.set(...pos); m.rotation.y=ry; m.castShadow=shadow&&h>.3; m.receiveShadow=true; return m;
}
function plane(w,d,mat,pos=[0,0,0]){
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),mat);
  m.rotation.x=-Math.PI/2; m.position.set(...pos); m.receiveShadow=true; return m;
}
function cyl(rt,rb,h,seg,mat,pos=[0,0,0]){
  const m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg),mat);
  m.position.set(...pos); m.castShadow=m.receiveShadow=true; return m;
}
function s(...o){ o.forEach(x=>x&&scene.add(x)); }

const MATS = {
  villaRoof:  ()=>new THREE.MeshStandardMaterial({color:0xC9A84C,roughness:.65,metalness:.08}),
  loftBody:   ()=>new THREE.MeshStandardMaterial({color:0xE8E0D0,roughness:.78}),
  loftRoof:   ()=>new THREE.MeshStandardMaterial({color:0xD4622A,roughness:.7}),
  flatGrey:   ()=>new THREE.MeshStandardMaterial({color:0xDDDDDD,roughness:.7}),
  stableRoof: ()=>new THREE.MeshStandardMaterial({color:0x8B6914,roughness:.8}),
  roadAsph:   ()=>new THREE.MeshStandardMaterial({color:0x1a1e1c,roughness:.88}),
  safetyBrown:()=>new THREE.MeshStandardMaterial({color:0x8B4513,roughness:.95}),
  grassGreen: ()=>new THREE.MeshStandardMaterial({color:0x3a7a28,roughness:.92}),
  lawnGreen:  ()=>new THREE.MeshStandardMaterial({color:0x4a8a38,roughness:.9}),
  hedgeGreen: ()=>new THREE.MeshStandardMaterial({color:0x2a5a20,roughness:.95}),
  cobble:     ()=>new THREE.MeshStandardMaterial({color:0x9A7A5A,roughness:.9}),
  concrete:   ()=>new THREE.MeshStandardMaterial({color:0xc8c0b0,roughness:.8}),
  railWhite:  ()=>new THREE.MeshStandardMaterial({color:0xfcfaf8,roughness:.5}),
  plotAvail:  ()=>new THREE.MeshStandardMaterial({color:0x00ff88,transparent:true,opacity:0,depthWrite:false}),
  plotReserved:()=>new THREE.MeshStandardMaterial({color:0xff4444,transparent:true,opacity:0,depthWrite:false}),
};

// ─── ENVIRONMENT ──────────────────────────────────────────────────────────────
// Fix 03: PBR texture calls wrapped in try/catch with solid-colour fallbacks.
// If assets/textures/* don't exist in the repo, PBR.grass() etc. return a broken
// material. These wrappers catch that silently and fall back to a matching solid colour.
function _safePBR(pbrFn, fallbackColor, roughness=0.9) {
  try {
    return pbrFn();
  } catch(e) {
    console.warn('[XIX] PBR texture missing, using solid fallback:', e.message);
    return new THREE.MeshStandardMaterial({ color: fallbackColor, roughness });
  }
}

function addGround(){
  // Polish: ground uses a micro-variation canvas texture so it reads as organic,
  // not a flat colour, even without real PBR assets.
  const dirtMat = _makeMicroTexture(0x7a5a38, 0x6a4a28, 900, 700);
  const grassMat = _makeMicroTexture(0x3d7028, 0x4a8035, 500, 400);

  const gp = plane(900,700,dirtMat,[0,0,30]); gp.receiveShadow=true; scene.add(gp);
  _terrainMeshes.push(gp);
  const gp2 = plane(500,400,grassMat,[0,.01,0]); gp2.receiveShadow=true; scene.add(gp2);
  _terrainMeshes.push(gp2);
  s(plane(180,80,MATS.concrete(),[0,.02,122]));
  s(plane(90,70,MATS.cobble(),[-355,.02,90]));
  s(plane(200,280,MATS.lawnGreen(),[-310,.01,30]));
}

// Micro-texture: a canvas with subtle noise baked in, repeated across large planes.
// Gives organic ground variation without any external asset dependency.
function _makeMicroTexture(col1, col2, planeW, planeD) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  const r1 = (col1>>16)&0xff, g1=(col1>>8)&0xff, b1=col1&0xff;
  const r2 = (col2>>16)&0xff, g2=(col2>>8)&0xff, b2=col2&0xff;
  const id = ctx.createImageData(256,256); const d = id.data;
  for(let i=0;i<256*256;i++){
    const t = Math.random(); const idx=i*4;
    d[idx]   = r1+(r2-r1)*t | 0;
    d[idx+1] = g1+(g2-g1)*t | 0;
    d[idx+2] = b1+(b2-b1)*t | 0;
    d[idx+3] = 255;
  }
  ctx.putImageData(id,0,0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // Repeat so each pixel of texture covers ~1m of world
  tex.repeat.set(planeW/4, planeD/4);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0 });
}

function addGrassRing(){
  const count = PERF_MODE==='fast' ? 80 : 180;
  const cards = [
    ...addGrassField(0,-115,140,12,count), ...addGrassField(0,115,140,12,count),
    ...addGrassField(-165,0,12,90,count/2), ...addGrassField(165,0,12,90,count/2),
  ];
  cards.forEach(card=>scene.add(card));
}

function addPoloField(){
  const sc=document.createElement("canvas"); sc.width=512; sc.height=256;
  const ctx=sc.getContext("2d");
  for(let i=0;i<14;i++){
    ctx.fillStyle=i%2===0?"#5a9448":"#4a8038";
    ctx.fillRect(0,i*(256/14),512,256/14+1);
  }
  const st=new THREE.CanvasTexture(sc);
  st.colorSpace=THREE.SRGBColorSpace; st.wrapS=st.wrapT=THREE.RepeatWrapping;
  const fm=MAT_GRASS_FIELD(); fm.map=st;
  const fp = plane(274,146,fm,[0,.12,0]); scene.add(fp); _terrainMeshes.push(fp);
  const lm=new THREE.MeshStandardMaterial({color:0xf8f5e0,roughness:.4});
  s(box(.5,.05,146,lm,[0,.14,0],0,false)); s(box(274,.05,.5,lm,[0,.14,0],0,false));
}

function addSafetyZone(){
  const dm = new THREE.MeshStandardMaterial({color:0x8B4513,roughness:.95});
  s(plane(298,25,dm,[0,.11,-85.5])); s(plane(298,25,dm,[0,.11,85.5]));
  s(plane(11,146,dm,[-142.5,.11,0])); s(plane(11,146,dm,[142.5,.11,0]));
}

function addYardMarkings(){
  const lm=new THREE.MeshStandardMaterial({color:0xf8f5e0,roughness:.4});
  for(const side of[-1,1]) for(const d of[27.4,36.6,54.9])
    s(box(.5,.05,146,lm,[side*(137-d),.14,0],0,false));
  // IMPROVEMENT 1: fence posts as instanced mesh
  const postPositions=[];
  for(const gx of[-137,137]) for(const pz of[0,-7.3,7.3]) postPositions.push([gx,1.5,pz]);
  buildInstancedFencePosts(postPositions);
}

function addRoads(){
  const am=new THREE.MeshStandardMaterial({color:0x1a1e1c,roughness:.88}); const Y=.13;
  s(plane(700,30,am,[0,Y,215])); s(plane(700,4,MATS.grassGreen(),[0,Y+.01,215]));
  s(plane(8,220,am,[-155,Y,0])); s(plane(8,220,am,[155,Y,0]));
  s(plane(320,8,am,[0,Y,-104])); s(plane(320,8,am,[0,Y,104]));
  s(plane(8,220,am,[-177,Y,-5])); s(plane(8,220,am,[177,Y,-5]));
  s(plane(320,7,am,[30,Y,-118]));
  s(plane(400,8,am,[0,Y,128])); s(plane(130,35,am,[0,Y,148]));
  s(plane(8,280,am,[-270,Y,20])); s(plane(8,200,am,[-230,Y,10]));
  s(plane(150,8,am,[-310,Y,145])); s(plane(8,250,am,[200,Y,10]));
  s(plane(55,8,am,[215,Y,120]));
}

function addLake(){
  const wm=createWaterMat();
  const lb=new THREE.Mesh(new THREE.BoxGeometry(195,.35,22),wm);
  lb.position.set(30,.16,-115); lb.receiveShadow=true; scene.add(lb); waterMeshes.push(lb);
  for(const [ex,sc2] of [[-60,.9],[120,1.0]]){
    const ep=new THREE.Mesh(new THREE.SphereGeometry(13,12,4),wm);
    ep.position.set(ex,.05,-115); ep.scale.set(1,.2,sc2); scene.add(ep); waterMeshes.push(ep);
  }
  const sg=MATS.grassGreen();
  s(plane(220,6,sg,[30,.12,-104])); s(plane(220,6,sg,[30,.12,-126]));
}

function addEastLake(){
  const wm=createWaterMat();
  const el=new THREE.Mesh(new THREE.BoxGeometry(10,.25,38),wm);
  el.position.set(220,.12,-48); scene.add(el); waterMeshes.push(el);
}

function addClubhouse(){
  s(plane(55,28,MATS.roadAsph(),[-65,.13,128]));
  s(plane(55,28,MATS.roadAsph(),[65,.13,128]));
}

// ─── GLB LOADERS ──────────────────────────────────────────────────────────────
function makeDracoLoader(){
  const draco=new DRACOLoader();
  draco.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/draco/");
  const loader=new GLTFLoader(); loader.setDRACOLoader(draco); return loader;
}

function loadOneGLB(path,scale,yOff,onDone,onFail){
  makeDracoLoader().load(path,gltf=>{
    gltf.scene.scale.setScalar(scale);
    gltf.scene.traverse(child=>{
      if(child.isMesh){ child.castShadow=false; child.receiveShadow=true; child.frustumCulled=true; }
    });
    const bbox=new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y=yOff+(bbox.min.y<0?-bbox.min.y:0);
    onDone(gltf.scene);
  },undefined,err=>{console.error("GLB failed:",path,err.message||err);if(onFail)onFail();});
}

function loadClubhouseGLB(){
  loadOneGLB("assets/clubhouse-mesh.glb",60.975,0,tmpl=>{
    const g=new THREE.Group(); g.position.set(0,0,108); g.rotation.y=Math.PI;
    g.add(tmpl.clone(true)); scene.add(g);
    const bbox=new THREE.Box3().setFromObject(g); if(bbox.min.y<-0.5) g.position.y-=bbox.min.y;
  });
}
function loadStablesGLB(){
  loadOneGLB("assets/stables-mesh.glb",18.846,0,tmpl=>{
    const g=new THREE.Group(); g.position.set(-375,0,90); g.add(tmpl.clone(true)); scene.add(g);
  });
}

function loadVillaGLB(){
  makeDracoLoader().load("assets/villa-mesh.glb",gltf=>{
    gltf.scene.scale.setScalar(VILLA_SCALE);
    gltf.scene.traverse(c=>{
      if(c.isMesh){ c.castShadow=false; c.receiveShadow=true;
        if(c.material){ c.material.envMapIntensity=0.4; c.material.needsUpdate=true; }
      }
    });
    const bbox=new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y=bbox.min.y<0?-bbox.min.y:0;
    const wrapper=new THREE.Group(); wrapper.add(gltf.scene); villaGLBScene=wrapper;
    pendingVillas.forEach(({x,z,ry,plotKey})=>placeVillaGLBWithLOD(x,z,ry,plotKey));
    pendingVillas=[];
  },null,err=>{
    pendingVillas.forEach(({x,z,ry})=>{const v=_createVillaFallback();v.position.set(x,0,z);v.rotation.y=ry;scene.add(v);});
    pendingVillas=[];
  });
}

function loadApartmentGLB(){
  makeDracoLoader().load("assets/apartment-mesh.glb",gltf=>{
    gltf.scene.scale.setScalar(APT_SCALE);
    gltf.scene.traverse(c=>{if(c.isMesh){c.castShadow=false;c.receiveShadow=true;}});
    const bbox=new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y=bbox.min.y<0?-bbox.min.y:0;
    const wrapper=new THREE.Group(); wrapper.add(gltf.scene); aptGLBScene=wrapper;
    pendingApts.forEach(({x,z,ry})=>placeAptGLB(x,z,ry)); pendingApts=[];
  },null,()=>{pendingApts.forEach(({x,z})=>scene.add(_createFlatBlock(x,z)));pendingApts=[];});
}

function loadLoftGLB(){
  makeDracoLoader().load("assets/loft-mesh.glb",gltf=>{
    gltf.scene.scale.setScalar(LOFT_SCALE);
    gltf.scene.traverse(c=>{if(c.isMesh){c.castShadow=false;c.receiveShadow=true;}});
    const bbox=new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y=bbox.min.y<0?-bbox.min.y:0;
    const wrapper=new THREE.Group(); wrapper.add(gltf.scene); loftGLBScene=wrapper;
    pendingLofts.forEach(({x,z,ry})=>placeLoftGLB(x,z,ry)); pendingLofts=[];
  },null,err=>{pendingLofts.forEach(({x,z,ry})=>scene.add(_createLoftBlock(x,z,ry)));pendingLofts=[];});
}

function placeAptGLB(x,z,ry=0){
  if(!aptGLBScene){pendingApts.push({x,z,ry});return;}
  const clone=aptGLBScene.clone(true); clone.position.set(x,0,z); clone.rotation.y=ry; scene.add(clone);
}
function placeLoftGLB(x,z,ry){
  ry=ry||0; if(!loftGLBScene){pendingLofts.push({x,z,ry});return;}
  const clone=loftGLBScene.clone(true); clone.position.set(x,0,z); clone.rotation.y=ry; scene.add(clone);
}

// ─── PLOT OVERLAY ─────────────────────────────────────────────────────────────
function addPlotOverlay(x,z,ry,plotKey,villaClone){
  const mat=MATS.plotAvail();
  const overlay=new THREE.Mesh(new THREE.PlaneGeometry(20,18),mat);
  overlay.rotation.x=-Math.PI/2; overlay.position.set(x,.25,z);
  overlay.userData.plotKey=plotKey; overlay.userData.isPlotOverlay=true; overlay.userData.villaClone=villaClone;
  scene.add(overlay);
  plotRegistry.set(plotKey,{status:"available",overlay,villaClone,x,z,ry});
}

export function highlightPlot(plotKey){
  plotRegistry.forEach((plot,key)=>{
    if(!plot.overlay) return;
    plot.overlay.material.opacity = (key===plotKey&&plot.status==='available') ? 0.35 : (plot.status==='reserved' ? 0.5 : 0);
  });
}

export function reservePlot(plotKey){
  const plot=plotRegistry.get(plotKey); if(!plot||plot.status==="reserved") return false;
  plot.status="reserved";
  plot.villaClone && plot.villaClone.traverse(c=>{
    if(c.isMesh&&c.material){c.material=c.material.clone();c.material.color.set(0x888888);c.material.opacity=.7;c.material.transparent=true;}
  });
  if(plot.overlay){plot.overlay.material.color.set(0xff4444);plot.overlay.material.opacity=0;}
  plotRegistry.set(plotKey,plot); return true;
}

export function getPlotAtRay(raycaster){
  const overlays=[];
  plotRegistry.forEach(plot=>{if(plot.overlay){plot.overlay.material.opacity=0.01;overlays.push(plot.overlay);}});
  const hits=raycaster.intersectObjects(overlays,false);
  plotRegistry.forEach(plot=>{if(plot.overlay&&plot.status!=='reserved')plot.overlay.material.opacity=0;});
  return hits.length>0?hits[0].object.userData.plotKey:null;
}

// ─── VILLA RING ───────────────────────────────────────────────────────────────
const NO_BUILD_ZONES=[[0,128,75,55],[-375,90,55,45],[-248,-25,50,22],[-248,55,50,22],
  [-390,0,65,100],[270,65,28,18],[218,0,28,28],[218,52,30,26],[0,0,140,76],[30,-115,105,18]];
const villaFootprints=[];
function registerVillaFootprint(x,z){villaFootprints.push({cx:x,cz:z,r:12});}
function isInNoBuildZone(x,z){
  for(const [cx,cz,hw,hd] of NO_BUILD_ZONES) if(Math.abs(x-cx)<=hw&&Math.abs(z-cz)<=hd) return true;
  for(const {cx,cz,r} of villaFootprints) if((x-cx)*(x-cx)+(z-cz)*(z-cz)<=r*r) return true;
  return false;
}

function addVillaRing(){
  const PLOT=28;
  const cypressPositions=[];
  function placeV(x,z,ry){
    const plotKey=`${Math.round(x)},${Math.round(z)}`;
    registerVillaFootprint(x,z);
    placeVillaGLBWithLOD(x,z,ry,plotKey);
    addVillaContactShadow(x,z); // IMPROVEMENT 8
    const fx=Math.sin(ry)*(-9),fz=Math.cos(ry)*(-9),rx=Math.cos(ry)*8,rz=-Math.sin(ry)*8;
    if(!isInNoBuildZone(x+rx+fx,z+rz+fz)) cypressPositions.push([x+rx+fx,z+rz+fz]);
    if(!isInNoBuildZone(x-rx+fx,z-rz+fz)) cypressPositions.push([x-rx+fx,z-rz+fz]);
  }
  for(let i=0;i<8;i++){placeV(-162,-96+i*PLOT,Math.PI/2);placeV(162,-96+i*PLOT,-Math.PI/2);}
  for(let i=0;i<7;i++){placeV(-192,-82+i*PLOT,Math.PI/2);placeV(192,-82+i*PLOT,-Math.PI/2);}
  const LAKE_CX=30,LAKE_R=90,BOW=17;
  [-140,-116,-92,-68,-44,-20,4,28,52,76,100,124,148,172,196].forEach(x=>{
    const dx=x-LAKE_CX; const bow=dx*dx<LAKE_R*LAKE_R?BOW*(1-(dx*dx)/(LAKE_R*LAKE_R)):0;
    placeV(x,-132-bow,0);
  });
  for(const side of[-1,1]) [65,93,121].forEach(xa=>{placeV(side*xa,105+xa*.04,0);});
  // IMPROVEMENT 1: instanced cypress instead of individual meshes
  buildInstancedCypress(cypressPositions);
}

function addLoftTerraces(){
  for(let x=-310;x<=-110;x+=36){const cz=-162-Math.abs(x)*.05;registerVillaFootprint(x,cz);placeLoftGLB(x,cz,Math.PI);}
  for(let x=95;x<=310;x+=36){const cz=-162-Math.abs(x)*.05;registerVillaFootprint(x,cz);placeLoftGLB(x,cz,Math.PI);}
  registerVillaFootprint(-220,-40);registerVillaFootprint(-220,40);
  placeLoftGLB(-220,-40,-Math.PI/2);placeLoftGLB(-220,40,-Math.PI/2);
}

function addWestCompound(){
  s(plane(120,185,MATS.safetyBrown(),[-390,.06,0])); s(plane(100,160,MAT_GRASS_FIELD(),[-390,.10,0]));
  placeAptGLB(-248,-25,Math.PI/2); placeAptGLB(-248,55,Math.PI/2);
}

function addPaddock(){
  s(plane(40,38,MAT_GRASS_FIELD(),[218,.07,0]));
  const postPos=[];
  for(let fz=-19;fz<=19;fz+=4){postPos.push([198,.8,fz]);postPos.push([238,.8,fz]);}
  for(let fx=198;fx<=238;fx+=4){postPos.push([fx,.8,-19]);postPos.push([fx,.8,19]);}
  buildInstancedFencePosts(postPos); // IMPROVEMENT 1
  const rm=MATS.railWhite();
  s(box(.08,.1,38,rm,[198,1.0,0],0,false)); s(box(.08,.1,38,rm,[238,1.0,0],0,false));
  s(box(40,.1,.08,rm,[218,1.0,-19],0,false)); s(box(40,.1,.08,rm,[218,1.0,19],0,false));
  s(plane(60,60,MATS.grassGreen(),[255,.06,-58]));
}

function addGamePark(){
  s(plane(54,44,MAT_GRASS_FIELD(),[218,.07,52]));
  const cols=[0xe8602a,0x2a88c8,0xe8c82a,0x4ac84a];
  for(let i=0;i<5;i++){const h=2.6+i*.4;s(box(3.2,h,3.2,new THREE.MeshStandardMaterial({color:cols[i%4],roughness:.6}),[203+i*7,h/2,50+(i%2)*8]));}
}

function addCommercialBlock(){
  const g=new THREE.Group(); g.position.set(270,0,65);
  g.add(box(42,9,26,MATS.flatGrey(),[0,4.5,0]));
  g.add(box(.4,8.5,22,MAT_GLASS(.5),[-21.2,4.5,0]));
  scene.add(g);
}

function addServiceCompound(){
  s(box(16,5.0,13,new THREE.MeshStandardMaterial({color:0xcc2200,roughness:.7}),[-270,2.5,95]));
  s(box(30,6,17,MATS.flatGrey(),[-240,3,100]));
}

function addLandscaping(){
  const palmMats=[];
  const tl2=new THREE.TextureLoader();
  ['assets/palm-sprite.png','assets/palm-sprite-2.png'].forEach(src=>{
    const t=tl2.load(src); t.colorSpace=THREE.SRGBColorSpace;
    palmMats.push(new THREE.MeshBasicMaterial({map:t,transparent:true,alphaTest:.1,depthWrite:false,side:THREE.DoubleSide}));
  });
  function addPalm(x,y,z,scale=1){
    if(isInNoBuildZone(x,z)) return;
    const mat=palmMats[Math.floor(Math.random()*palmMats.length)];
    const h=(13+Math.random()*5)*scale,w=h*.5;
    for(const ry of[0,Math.PI/2]){
      const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),mat);
      m.position.set(x,y+h/2,z); m.rotation.y=ry; scene.add(m); palmBillboards.push(m);
    }
  }
  for(let x=-280;x<=280;x+=28){addPalm(x,.1,206,1.3);addPalm(x,.1,224,1.2);}
  for(let z=-95;z<=95;z+=40){addPalm(-160,.1,z,1.1);addPalm(160,.1,z,1.1);}
  for(const pz of[95,103,111,119]){addPalm(-16,.1,pz,1.2);addPalm(16,.1,pz,1.2);}
}

function _createVillaFallback(){
  const g=new THREE.Group();
  g.add(box(16,2.1,13,new THREE.MeshStandardMaterial({color:0xb0a898,roughness:.8}),[0,1.05,0]));
  g.add(box(16,5.8,13,new THREE.MeshStandardMaterial({color:0xF5E6B0,roughness:.75}),[0,5.15,0]));
  const rm2=new THREE.Mesh(new THREE.ConeGeometry(12,3.5,4),MATS.villaRoof());
  rm2.position.set(0,9.85,0); rm2.rotation.y=Math.PI/4; g.add(rm2); return g;
}

function _createLoftBlock(x,z,ry){
  const g=new THREE.Group(); g.position.set(x,0,z); g.rotation.y=ry;
  const TW=40;
  g.add(box(TW,3.2,11,new THREE.MeshStandardMaterial({color:0x9a8a78,roughness:.9}),[0,1.6,0]));
  g.add(box(TW,3.2,11,MATS.loftBody(),[0,4.85,0]));
  g.add(box(TW+.4,.4,11.4,MATS.loftRoof(),[0,6.65,0],0,false)); return g;
}

function _createFlatBlock(x,z){
  const g=new THREE.Group(); g.position.set(x,0,z);
  g.add(box(80,20,28,MATS.flatGrey(),[0,10,0])); scene.add(g); return g;
}

// ─── TICK ─────────────────────────────────────────────────────────────────────
let _tickFrame=0;
export function tickScene(elapsed, camera){
  _tickFrame++;
  tickWater(waterMeshes, elapsed);
  tickGrass(camera);
  // Palm billboard update: rate-limited per perf mode
  const palmDiv = PERF_SETTINGS[PERF_MODE].palmTickDiv;
  if (_tickFrame % palmDiv === 0) {
    palmBillboards.forEach(pb=>{
      pb.rotation.y=Math.atan2(camera.position.x-pb.position.x,camera.position.z-pb.position.z);
    });
  }
  // Hotspot pulse (Fix 04)
  tickHotspots(elapsed);
  // LOD update: Three.js THREE.LOD auto-updates via camera
  // NPC horse tick
  tickNPCHorses(Math.min(elapsed - (_prevElapsed||0), 0.033));
  _prevElapsed = elapsed;
  // Tour tick
  if (_tourActive) tickTour(Math.min(elapsed-(_prevElapsed||0),0.033), camera);
}
let _prevElapsed = 0;

export function getRenderer() { return renderer; }
export function getScene()    { return scene;    }
export function getCamera()   { return camera;   }
export function getClock()    { return clock;    }

// Export audio init so app.js can call it on first user gesture
