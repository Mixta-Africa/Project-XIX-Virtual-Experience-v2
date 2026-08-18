/**
 * Project XIX — Scene (Production Standard v25)
 * Upgrades: 
 * - Real-time Planar Water reflections
 * - 3D Spatial Audio (Web Audio API PannerNodes)
 * - LOD instancing, Atmospheric Sky, and guided tour integration
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { GLTFLoader }  from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/DRACOLoader.js";
import { Water } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/objects/Water.js";
import {
  PBR, createWaterMat, addGrassField, commitGrass, tickGrass, tickWater,
  buildPalmInstances, tickPalms,
  setPerfModeGraphics, setBloomForTime, setSkyForTime, createAtmosphericSky,
  buildEnvMapFromSky, applyPS4Materials,
  MAT_GRASS_FIELD, MAT_GLASS, MAT_GLASS_WARM, MAT_WHITE_TRIM, MAT_GOLD, MAT_DARK_METAL,
} from "./graphics.js";

// ─── PERFORMANCE MODE ─────────────────────────────────────────────────────────
export let PERF_MODE = 'fast';

const PERF_SETTINGS = {
  fast:     { shadowMapSize: 1024, pixelRatio: 1.5, fogDensity: 0.00002, palmTickDiv: 6 },
  balanced: { shadowMapSize: 2048, pixelRatio: 1.75,fogDensity: 0.00002, palmTickDiv: 3 },
  rich:     { shadowMapSize: 4096, pixelRatio: 2.0, fogDensity: 0.00002, palmTickDiv: 1 },
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
    if (sunLight.shadow.map) {
      sunLight.shadow.map.dispose();
      sunLight.shadow.map = null;
    }
  }
  
  // FIX: Only set performance-based fog if the user does NOT have clear weather active
  if (scene && scene.fog) {
    const isClear = (window._currentWeather === 'clear');
    scene.fog.density = isClear ? 0.000008 : s.fogDensity;
  }
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
const LOFT_SCALE = 28.5;

export const plotRegistry = new Map();
export let onPlotSelected = null;

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
    applyPS4Materials(model);
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
  if (!horseMixer) return;
  horseMixer.timeScale = isMoving ? 1.2 : 0.2;
  horseMixer.update(delta);
}

export function tickHorse(delta) {
  if (horseMixer) horseMixer.update(delta);
}

// ─── TERRAIN HEIGHT FOLLOWING ────────────────────────────────────────────────
const _terrainRaycaster = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0,-1,0), 0, 20);
let _terrainMeshes = []; 

function getGroundY(x, z) {
  if (_terrainMeshes.length === 0) return 0;
  _terrainRaycaster.ray.origin.set(x, 50, z); 
  const hits = _terrainRaycaster.intersectObjects(_terrainMeshes, false);
  return hits.length > 0 ? hits[0].point.y : 0;
}

export function setHorsePosition(x, z, yaw) {
  if (!horseGroup) return;
  const groundY = getGroundY(x, z);
  if (horseViewMode === 'first') {
    horseGroup.position.set(x + Math.sin(yaw) * 0.5, groundY, z + Math.cos(yaw) * 0.5);
  } else {
    horseGroup.position.set(x, groundY, z);
  }
  horseGroup.rotation.y = yaw; 
}

export function getThirdPersonCameraOffset() { return { back: 5.5, up: 2.4 }; }

// ─── NPC HORSES ──────────────────────────────────────────────────────────────
const npcHorses = [];
const NPC_PATHS = [
  [new THREE.Vector3(204,0,-5),new THREE.Vector3(232,0,-5),new THREE.Vector3(232,0,25),new THREE.Vector3(204,0,25)],
  [new THREE.Vector3(-120,0,65),new THREE.Vector3(0,0,60),new THREE.Vector3(120,0,65),new THREE.Vector3(120,0,-65),new THREE.Vector3(0,0,-60),new THREE.Vector3(-120,0,-65)],
  [new THREE.Vector3(-100,0,0),new THREE.Vector3(0,0,55),new THREE.Vector3(100,0,0),new THREE.Vector3(0,0,-55)],
  [new THREE.Vector3(-110,0,40),new THREE.Vector3(0,0,35),new THREE.Vector3(110,0,40),new THREE.Vector3(110,0,-40),new THREE.Vector3(0,0,-35),new THREE.Vector3(-110,0,-40)],
];

function spawnNPCHorse(pathIndex) {
  makeDracoLoader().load("./assets/horse.glb", gltf => {
    const model = gltf.scene;
    model.scale.setScalar(0.020); 
    applyPS4Materials(model);
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
    group.position.copy(path[0]);
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
    const dir = segment.normalize();
    if (dir.lengthSq() > 0) npc.group.rotation.y = Math.atan2(dir.x, dir.z);
  });
}

// ─── GUIDED TOUR ──────────────────────────────────────────────────────────────
export const TOUR_STOPS = [
  { pos:[-20, 3.1, 210], yaw:0,            pitch:-0.08, caption:"Welcome to Project XIX — 18.8 hectares of polo and equestrian living at Lakowe.",        voice:"Welcome to Project Nineteen. 18.8 hectares of polo and equestrian living at Lakowe, Ibeju-Lekki Lagos." },
  { pos:[-20, 3.1,  80], yaw:0,            pitch:-0.04, caption:"The main polo field — 275 metres long. Full FIP international standard.", voice:"Ahead of you, the main polo field. 275 metres long, built to full FIP international standard." },
  { pos:[-20, 3.1, -90], yaw:0,            pitch:-0.06, caption:"The lake — a 200-metre crescent between the polo ring and the villa north row.",                        voice:"The crescent lake. 200 metres of still water." },
  { pos:[-155, 3.1,  0], yaw: Math.PI/2,  pitch:-0.04, caption:"West villa row — 120 premium 3-bedroom villas with direct polo-field view.",                            voice:"The west villa row. 120 premium three-bedroom residences." },
  { pos:[  0, 3.1, 108], yaw: Math.PI,    pitch:-0.08, caption:"The Clubhouse — 3,419 m². 8 VIP skyboxes. Restaurant. Bar. The social heart of XIX.",                    voice:"The Clubhouse. 3,419 square metres. Eight VIP skyboxes, a restaurant, and bar." },
  { pos:[-375, 3.1, 90], yaw: Math.PI/2,  pitch:-0.05, caption:"The Equestrian Quarter — 56-stall stables, veterinary clinic, cobblestone courtyard.",                  voice:"The equestrian quarter. 56 stalls across four stable blocks." },
  { pos:[ 218, 3.1,  0], yaw:-Math.PI/2,  pitch:-0.04, caption:"The paddock — post-and-rail enclosure. Watch horses warm up from your east terrace.",                    voice:"The paddock. Post and rail fencing, used for horse warming." },
];

let _tourActive=false, _tourStop=0, _tourOnGetCam=null, _tourOnSetCam=null;
let _pauseT=0, _flyT=0, _flying=false, _flyFrom=null, _flyTo=null;
const _PAUSE_DUR=6.0, _FLY_DUR=3.5;

function _easeInOut(t) { return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2; }
function _bezierPoint(p0, p1, p2, t) {
  const mt = 1-t;
  return [mt*mt*p0[0] + 2*mt*t*p1[0] + t*t*p2[0], mt*mt*p0[1] + 2*mt*t*p1[1] + t*t*p2[1], mt*mt*p0[2] + 2*mt*t*p1[2] + t*t*p2[2]];
}

export function startTour(onGetCam, onSetCam) {
  _tourOnGetCam = onGetCam; _tourOnSetCam = onSetCam;
  _tourActive = true; _tourStop = 0; _pauseT = 0; _flying = false;
  _injectTourUI(); _startFly(_tourStop); _speakStop(0);
}

export function stopTour() {
  _tourActive = false; _flying = false;
  window.speechSynthesis && window.speechSynthesis.cancel();
  document.getElementById('tour-ui')?.remove();
}

export function isTourActive() { return _tourActive; }

function _startFly(toIdx) {
  const toStop = TOUR_STOPS[toIdx];
  _flyFrom = _tourOnGetCam ? _tourOnGetCam() : { pos:[0,3.1,200], yaw:0, pitch:0 };
  _flyTo   = { pos: toStop.pos, yaw: toStop.yaw, pitch: toStop.pitch || 0 };
  _flyT    = 0; _flying  = true;
}

function _speakStop(idx) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const stop = TOUR_STOPS[idx];
  const utt  = new SpeechSynthesisUtterance(stop.voice);
  utt.rate = 0.88; utt.pitch = 1.0;
  window.speechSynthesis.speak(utt);
  const capEl = document.getElementById('tour-caption');
  if (capEl) capEl.textContent = stop.caption;
  const cntEl = document.getElementById('tour-counter');
  if (cntEl) cntEl.textContent = `${idx + 1} / ${TOUR_STOPS.length}`;
}

function _injectTourUI() {
  if (document.getElementById('tour-ui')) return;
  const ui = document.createElement('div');
  ui.id = 'tour-ui';
  ui.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:500;background:rgba(6,18,8,0.82);backdrop-filter:blur(10px);border:1px solid rgba(201,168,76,0.4);border-radius:10px;padding:14px 20px;max-width:520px;width:90%;font-family:Inter,sans-serif;pointer-events:all;`;
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

window.__tourNext = () => { if(!_tourActive)return; _tourStop=(_tourStop+1)%TOUR_STOPS.length; _pauseT=0; _startFly(_tourStop); _speakStop(_tourStop); };
window.__tourPrev = () => { if(!_tourActive)return; _tourStop=(_tourStop-1+TOUR_STOPS.length)%TOUR_STOPS.length; _pauseT=0; _startFly(_tourStop); _speakStop(_tourStop); };
window.__tourStop = () => stopTour();

function tickTour(delta, cam) {
  if (!_tourActive) return;
  if (_flying) {
    _flyT = Math.min(_flyT + delta / _FLY_DUR, 1);
    const e = _easeInOut(_flyT);
    const p0 = _flyFrom.pos, p2 = _flyTo.pos;
    const p1 = [(p0[0]+p2[0])/2, Math.max(p0[1],p2[1]) + 25, (p0[2]+p2[2])/2];
    const bp = _bezierPoint(p0, p1, p2, e);
    let dy = (_flyTo.yaw||0) - (_flyFrom.yaw||0);
    if (dy >  Math.PI) dy -= Math.PI*2;
    if (dy < -Math.PI) dy += Math.PI*2;
    if (_tourOnSetCam) _tourOnSetCam(bp, (_flyFrom.yaw||0) + dy * e, (_flyFrom.pitch||0) + ((_flyTo.pitch||0) - (_flyFrom.pitch||0)) * e);
    if (_flyT >= 1) { _flying = false; _pauseT = 0; }
  } else {
    _pauseT += delta;
    if (_pauseT >= _PAUSE_DUR) {
      _pauseT = 0; _tourStop = (_tourStop + 1) % TOUR_STOPS.length;
      _startFly(_tourStop); _speakStop(_tourStop);
    }
  }
}

// ─── IMPROVEMENT 2: 3D SPATIAL AMBIENT SOUND (PANNER NODES) ───────────────────
let _audioCtx = null;
let _windGain = null, _birdsGain = null;
let _hoovesPanner = null, _lakePanner = null, _clubPanner = null;
let _hoovesGain = null;

export function initAmbientAudio() {
  if (_audioCtx) return;
  try {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    if (_audioCtx.listener.upX) {
      _audioCtx.listener.upX.value = 0;
      _audioCtx.listener.upY.value = 1;
      _audioCtx.listener.upZ.value = 0;
    }

    _windGain  = _makeNoise('wind', 0.012);
    _birdsGain = _makeBirds();
    
    const hoovesSetup = _makeHooves();
    _hoovesPanner = hoovesSetup.panner;
    _hoovesGain = hoovesSetup.gain;

    _lakePanner = _makePositionalNoise('water', 30, -115); 
    _clubPanner = _makePositionalNoise('murmur', 0, 108);  
  } catch(e) { console.warn('[XIX] Audio init failed:', e); }
}

function _createPanner(x, z, refDist = 20, maxDist = 150) {
  if (!_audioCtx) return null;
  const panner = _audioCtx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'exponential';
  panner.refDistance = refDist;
  panner.maxDistance = maxDist;
  panner.rolloffFactor = 1.2;
  panner.positionX.value = x;
  panner.positionY.value = 1.72;
  panner.positionZ.value = z;
  return panner;
}

function _makePositionalNoise(type, x, z) {
  if (!_audioCtx) return null;
  const panner = _createPanner(x, z, 30, 200);
  const bufSize = _audioCtx.sampleRate * 2;
  const buf = _audioCtx.createBuffer(1, bufSize, _audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);

  const source = _audioCtx.createBufferSource();
  source.buffer = buf; 
  source.loop = true;

  const filter = _audioCtx.createBiquadFilter();
  filter.type = type === 'water' ? 'lowpass' : 'bandpass';
  filter.frequency.value = type === 'water' ? 400 : 600;

  const gain = _audioCtx.createGain();
  gain.gain.value = type === 'water' ? 0.015 : 0.005;

  source.connect(filter); 
  filter.connect(gain); 
  gain.connect(panner); 
  panner.connect(_audioCtx.destination);
  source.start();
  return panner;
}

function _makeNoise(type, vol) {
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
  gain.gain.value = vol;

  source.connect(filter); filter.connect(gain); gain.connect(_audioCtx.destination);
  source.start();
  return gain;
}

function _makeBirds() {
  if (!_audioCtx) return null;
  const gain = _audioCtx.createGain();
  gain.gain.value = 0.0;
  gain.connect(_audioCtx.destination);
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
  
  const panner = _createPanner(0, 0, 5, 50);
  gain.connect(panner);
  panner.connect(_audioCtx.destination);

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
  return { panner, gain };
}

export function updateAudioForMovement(isMoving, worldX, worldZ) {
  if (!_audioCtx) return;

  const listener = _audioCtx.listener;
  if (listener.positionX) {
    listener.positionX.setTargetAtTime(worldX, _audioCtx.currentTime, 0.1);
    listener.positionY.setTargetAtTime(1.72, _audioCtx.currentTime, 0.1);
    listener.positionZ.setTargetAtTime(worldZ, _audioCtx.currentTime, 0.1);
  }

  if (_hoovesPanner) {
    _hoovesPanner.positionX.setTargetAtTime(worldX, _audioCtx.currentTime, 0.1);
    _hoovesPanner.positionZ.setTargetAtTime(worldZ, _audioCtx.currentTime, 0.1);
  }

  if (_windGain) {
    const edge = Math.min(Math.abs(worldZ + 220), Math.abs(worldZ - 215));
    const windVal = 0.008 + (1 - Math.min(edge / 80, 1)) * 0.018;
    _windGain.gain.setTargetAtTime(windVal, _audioCtx.currentTime, 0.4);
  }
  
  if (_hoovesGain) {
    _hoovesGain.gain.setTargetAtTime(isMoving ? 0.6 : 0, _audioCtx.currentTime, 0.3);
  }
  
  if (_birdsGain) {
    _birdsGain.gain.setTargetAtTime(isMoving ? 0 : 0.8, _audioCtx.currentTime, 0.8);
  }
}

// ─── INSTANCED RENDERING ──────────────────────────────────────────────────────
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

// ─── INSTANCED VILLA RENDERING WITH LOD ───────────────────────────────────────
const _villaInstData = [];   
let   _impostorMesh  = null; 
const _impostorMat   = new THREE.MeshStandardMaterial({ color:0xF5E6B0, roughness:.8 });
const _impostorGeo   = new THREE.BoxGeometry(14, 8, 12);

function placeVillaGLBWithLOD(x, z, ry, plotKey) {
  if (!villaGLBScene) { pendingVillas.push({x,z,ry,plotKey}); return; }

  const lod = new THREE.LOD();
  lod.position.set(x, 0, z);
  lod.rotation.y = ry;
  lod.userData.isVillaGLB  = true;
  lod.userData.baseRotY    = ry;
  lod.userData.plotKey     = plotKey;

  const highDetail = villaGLBScene.clone(true);
  highDetail.rotation.y = 0;
  lod.addLevel(highDetail, 0);          

  lod.addLevel(new THREE.Group(), 180); 
  lod.addLevel(new THREE.Group(), 350);

  scene.add(lod);
  if (plotKey) addPlotOverlay(x, z, ry, plotKey, lod);
  _villaInstData.push({ x, z, ry });
}

let _aerialModeActive = false;

export function setAerialMode(on) {
  _aerialModeActive = on;
  if (!scene) return;

  // We remove the LOD locking so the engine can natively swap to 
  // the highly optimized 1-draw-call impostor mesh when high in the sky.
  if (_impostorMesh) _impostorMesh.visible = true; 
}

function _buildVillaImpostors() {
  if (_villaInstData.length === 0) return;
  _impostorMesh = new THREE.InstancedMesh(_impostorGeo, _impostorMat, _villaInstData.length);
  _impostorMesh.receiveShadow = true;
  _impostorMesh.castShadow    = false;
  _impostorMesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  _villaInstData.forEach(({ x, z, ry }, i) => {
    dummy.position.set(x, 4, z); 
    dummy.rotation.y = ry;
    dummy.updateMatrix();
    _impostorMesh.setMatrixAt(i, dummy.matrix);
  });
  _impostorMesh.instanceMatrix.needsUpdate = true;
  _impostorMesh.renderOrder = -1;
  scene.add(_impostorMesh);
}

// ─── IN-WORLD SIGNAGE ─────────────────────────────────────────────────────────
function addEstateSignage() {
  const pillarMat = new THREE.MeshStandardMaterial({ color:0x2a3820, roughness:.7, metalness:.3 });
  const goldMat   = new THREE.MeshStandardMaterial({ color:0xC9A84C, roughness:.3, metalness:.8 });

  for (const gx of [-12, 12]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 6, 1.2), pillarMat);
    pillar.position.set(gx, 3, 218);
    pillar.castShadow = true; scene.add(pillar);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.6), goldMat);
    cap.position.set(gx, 6.25, 218); scene.add(cap);
  }

  const headerBar = new THREE.Mesh(new THREE.BoxGeometry(26, 0.5, 0.3), pillarMat);
  headerBar.position.set(0, 6.5, 218); scene.add(headerBar);

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

// ─── 3D FLOATING HOTSPOT LABELS ───────────────────────────────────────────────
const _hotspots = [];  

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
  ctx.beginPath();
  const r = 14;
  ctx.moveTo(r,0); ctx.lineTo(W-r,0); ctx.quadraticCurveTo(W,0,W,r);
  ctx.lineTo(W,H-r); ctx.quadraticCurveTo(W,H,W-r,H);
  ctx.lineTo(r,H); ctx.quadraticCurveTo(0,H,0,H-r);
  ctx.lineTo(0,r); ctx.quadraticCurveTo(0,0,r,0); ctx.closePath();
  ctx.fillStyle = 'rgba(6,18,8,0.88)';
  ctx.fill();
  ctx.strokeStyle = '#C9A84C'; ctx.lineWidth = 2; ctx.stroke();
  ctx.beginPath(); ctx.arc(22, H/2, 5, 0, Math.PI*2);
  ctx.fillStyle = '#C9A84C'; ctx.fill();
  ctx.fillStyle = '#f0ece0';
  ctx.font = 'bold 22px Inter, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, 36, H*0.38);
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
    const aspect = canvas.width / canvas.height;
    const worldH = 6; 
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

// ─── VILLA HEDGES ────────────────────────────────────────────────────────────
const _hedgeInstData = []; 

function collectVillaHedge(x, z, ry) {
  _hedgeInstData.push({ x, z, ry });
}

function buildAllVillaHedges() {
  if (_hedgeInstData.length === 0) return;
  const count = _hedgeInstData.length;
  const geo = new THREE.BoxGeometry(1, 1.4, 1);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2d5a1e, roughness: 0.95, metalness: 0, envMapIntensity: 0.2
  });

  const SEGS_PER_VILLA = 6;
  const total = count * SEGS_PER_VILLA;
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  let idx = 0;

  _hedgeInstData.forEach(({ x, z, ry }) => {
    const W = 10.5, D = 8.5, H = 0.7, T = 0.55;
    const segments = [
      { lx: 0,     lz: -(D+T),  sx: W*2, sz: T },
      { lx: -(W*0.5+1), lz: D+T, sx: W-2, sz: T },
      { lx:  (W*0.5+1), lz: D+T, sx: W-2, sz: T },
      { lx: -(W+T),  lz: 0,   sx: T, sz: D*2 },
      { lx:  (W+T),  lz: -D*0.3, sx: T, sz: D*1.4 },
      { lx:  (W+T),  lz:  D*0.7, sx: T, sz: D*0.6 },
    ];

    const cosR = Math.cos(ry), sinR = Math.sin(ry);
    segments.forEach(seg => {
      const wx = x + seg.lx * cosR - seg.lz * sinR;
      const wz = z + seg.lx * sinR + seg.lz * cosR;
      dummy.position.set(wx, H, wz);
      dummy.rotation.set(0, ry, 0);
      dummy.scale.set(seg.sx, 1, seg.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx++, dummy.matrix);
    });
  });

  mesh.count = idx; 
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
}

// ─── AO CONTACT SHADOWS ───────────────────────────────────────────────────────
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
  renderer.toneMappingExposure = 0.85; 
  renderer.outputColorSpace    = THREE.SRGBColorSpace;

  scene  = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x8ab8cc, perfS.fogDensity);

  camera = new THREE.PerspectiveCamera(65, 1, 0.5, 1200);

  buildLighting();

  const { skyObj, sun, skyUniforms } = createAtmosphericSky(scene, renderer);
  _skyObj = skyObj; _skySun = sun; _skyUniforms = skyUniforms;
  setSkyForTime(_skyUniforms, _skySun, sunLight, 'afternoon');

  requestAnimationFrame(() => requestAnimationFrame(() => {
    buildEnvMapFromSky(renderer, scene, skyObj);
  }));

  addGround();
  addPoloField();
  addSafetyZone();

  requestAnimationFrame(() => {
    addGrassRing();
    addYardMarkings();
    addRoads();
    addLake(); 
    addEastLake();
    addClubhouse();
    addEstateSignage();
    addLandmarkHotspots();

    requestAnimationFrame(() => {
      loadHorseGLB();
      loadVillaGLB();
      loadApartmentGLB();
      loadLoftGLB();
      loadClubhouseGLB();
      loadStablesGLB();
      addVillaRing();
      _buildVillaImpostors(); 
      addLoftTerraces();
      addWestCompound();
      addPaddock();
      addGamePark();
      addCommercialBlock();
      addServiceCompound();
      addLandscaping();

      requestAnimationFrame(() => {
        for (let i = 0; i < 8; i++) {
          setTimeout(() => spawnNPCHorse(i), i * 400);
        }
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
  updateNightLights(timeName);
  updateBuildingNightGlow(timeName);
}

export function updateSky(top, hor, gnd) {
  // no-op
}

function buildLighting() {
  const perfS = PERF_SETTINGS[PERF_MODE];
  hemiLight = new THREE.HemisphereLight(0xd4e8ff, 0x4a6a30, 1.0);
  scene.add(hemiLight);
  sunLight = new THREE.DirectionalLight(0xfff4e0, 2.8); 
  sunLight.position.set(-180, 180, 120);
  sunLight.castShadow = true; 
  sunLight.shadow.camera.left = sunLight.shadow.camera.bottom = -380;
  sunLight.shadow.camera.right = sunLight.shadow.camera.top   =  380;
  sunLight.shadow.camera.near  = 0.5;
  sunLight.shadow.camera.far   = 800;
  sunLight.shadow.mapSize.set(perfS.shadowMapSize, perfS.shadowMapSize);
  sunLight.shadow.bias        = -0.00015; 
  sunLight.shadow.normalBias  =  0.018;
  sunLight.shadow.radius      =  2.5;    
  scene.add(sunLight);

  const fill = new THREE.DirectionalLight(0xd4b890, 0.55);
  fill.position.set(100, 60, -120); scene.add(fill);

  const ambient = new THREE.DirectionalLight(0xb8d0ff, 0.28);
  ambient.position.set(-80, 20, 80); scene.add(ambient);
}

// ─── NIGHT SECURITY LIGHTS ────────────────────────────────────────────────────
const _nightLights = [];
let   _nightLightsActive = false;

function buildNightLights() {
  if (_nightLights.length > 0) return; 
  const lampPositions = [
    [-155,0,-80],[-155,0,-40],[-155,0,0],[-155,0,40],[-155,0,80],
    [155,0,-80],[155,0,-40],[155,0,0],[155,0,40],[155,0,80],
    [-120,0,215],[-60,0,215],[0,0,215],[60,0,215],[120,0,215],
    [-80,0,-105],[-20,0,-105],[40,0,-105],[100,0,-105],
    [-40,0,108],[0,0,108],[40,0,108],
    [-360,0,80],[-375,0,60],[-390,0,40],
  ];

  const postMat = new THREE.MeshStandardMaterial({ color:0x2a3020, roughness:.7 });
  const globeMat = new THREE.MeshStandardMaterial({
    color:0xffcc66, emissive:0xffaa33, emissiveIntensity:2.0,
    roughness:.3, transparent:true, opacity:.9
  });

  lampPositions.forEach(([x, , z]) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.10,5,6), postMat);
    post.position.set(x, 2.5, z);
    post.castShadow = false;
    scene.add(post);

    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.22,8,6), globeMat);
    globe.position.set(x, 5.25, z);
    scene.add(globe);
    _nightLights.push({ post, globe });

    const pt = new THREE.PointLight(0xffaa44, 0, 22, 1.8); 
    pt.position.set(x, 5.0, z);
    scene.add(pt);
    _nightLights.push({ pt });
  });
}

export function updateNightLights(timeName) {
  const isNight = (timeName === 'night');
  const isSunset = (timeName === 'sunset');

  if (isNight || isSunset) buildNightLights();

  _nightLights.forEach(item => {
    if (item.pt) {
      item.pt.intensity = isNight ? 2.8 : isSunset ? 1.2 : 0;
    }
    if (item.globe) {
      item.globe.material.emissiveIntensity = isNight ? 2.5 : isSunset ? 1.2 : 0;
      item.globe.material.opacity = (isNight || isSunset) ? 0.95 : 0.0;
    }
  });
  _nightLightsActive = isNight;
}

export function updateBuildingNightGlow(timeName) {
  if (!scene) return;
  const isNight = timeName === 'night';
  const isSunset = timeName === 'sunset';
  const emissiveInt = isNight ? 0.8 : isSunset ? 0.3 : 0.0;
  const emissiveCol = isNight ? new THREE.Color(0xffe8b0) : new THREE.Color(0xffcc88);
  scene.traverse(obj => {
    if (!obj.isMesh || !obj.material) return;
    const name = (obj.material.name || '').toLowerCase();
    if (name.includes('glass') || name.includes('window') || name.includes('glaz')) {
      obj.material.emissive = emissiveCol;
      obj.material.emissiveIntensity = emissiveInt;
      obj.material.needsUpdate = true;
    }
  });
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

// ─── PBR TEXTURE LOADERS ──────────────────────────────────────────────────────
let _dirtMatCache = null;
function getDirtMaterial() {
  if (_dirtMatCache) return _dirtMatCache;
  const tl = new THREE.TextureLoader();
  const dCol = tl.load('assets/textures/dirt-color.png'); dCol.colorSpace = THREE.SRGBColorSpace;
  const dNrm = tl.load('assets/textures/dirt-normal.png');
  const dRgh = tl.load('assets/textures/dirt-roughness.png');
  
  [dCol, dNrm, dRgh].forEach(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(100, 100); // Tiles the dirt texture beautifully across the estate
  });
  
  _dirtMatCache = new THREE.MeshStandardMaterial({
    map: dCol, normalMap: dNrm, roughnessMap: dRgh, roughness: 1.0
  });
  return _dirtMatCache;
}

const MATS = {
  villaRoof:  () => PBR.tileRoof(),
  loftBody:   () => PBR.concrete(),
  loftRoof:   () => PBR.timber(),
  flatGrey:   () => PBR.concrete(),
  stableRoof: () => PBR.timber(),
  roadAsph:   () => PBR.asphalt(),
  safetyBrown:() => getDirtMaterial(), // Now uses your custom dirt textures
  grassGreen: () => PBR.grass(),
  lawnGreen:  () => PBR.grass(),
  hedgeGreen: () => new THREE.MeshStandardMaterial({color:0x2a5a20,roughness:.95}), 
  cobble:     () => PBR.stone(),
  concrete:   () => PBR.concrete(),
  railWhite:  () => new THREE.MeshStandardMaterial({color:0xfcfaf8,roughness:.5}),
  plotAvail:  () => new THREE.MeshStandardMaterial({color:0x00ff88,transparent:true,opacity:0,depthWrite:false}),
  plotReserved:()=> new THREE.MeshStandardMaterial({color:0xff4444,transparent:true,opacity:0,depthWrite:false}),
};

function addGround(){
  const dirtMat = getDirtMaterial(); // Replaces the fake micro-texture with true PBR
  const grassMat = _makeMicroTexture(0x3d7028, 0x4a8035, 500, 400);

  const gp = plane(900,700,dirtMat,[0,0,30]); gp.receiveShadow=true; scene.add(gp);
  _terrainMeshes.push(gp);
  const gp2 = plane(500,400,grassMat,[0,.01,0]); gp2.receiveShadow=true; scene.add(gp2);
  _terrainMeshes.push(gp2);
  s(plane(180,80,MATS.concrete(),[0,.02,122]));
  s(plane(90,70,MATS.cobble(),[-355,.02,90]));
  s(plane(200,280,MATS.lawnGreen(),[-310,.01,30]));
}

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
  tex.repeat.set(planeW/4, planeD/4);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 1.0, metalness: 0.0, envMapIntensity: 0.0 });
}

function addGrassRing(){
  const count = PERF_MODE==='fast' ? 80 : 200;
  const allCards = [
    ...addGrassField(0,-115,140,12,count), ...addGrassField(0,115,140,12,count),
    ...addGrassField(-165,0,12,90,count/2), ...addGrassField(165,0,12,90,count/2),
  ];
  commitGrass(scene, allCards);
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
  const fm = MAT_GRASS_FIELD(); 
  fm.map = st;
  fm.roughness = 1.0; 
  fm.metalness = 0.0; 
  fm.envMapIntensity = 0.0; 
  const fp = plane(274, 146, fm, [0, .12, 0]); 
  scene.add(fp); _terrainMeshes.push(fp);
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
  const postPositions=[];
  for(const gx of[-137,137]) for(const pz of[0,-7.3,7.3]) postPositions.push([gx,1.5,pz]);
  buildInstancedFencePosts(postPositions);
}

function addRoads() {
  // 1. Custom PBR Asphalt Textures with Z-Fighting Protection
  const tl = new THREE.TextureLoader();
  const aCol = tl.load('assets/textures/asphalt-color.png'); aCol.colorSpace = THREE.SRGBColorSpace;
  const aNrm = tl.load('assets/textures/asphalt-normal.png');
  const aRgh = tl.load('assets/textures/asphalt-roughness.png');
  
  [aCol, aNrm, aRgh].forEach(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(120, 120); // Tiles the asphalt grain cleanly
  });

  const am = new THREE.MeshStandardMaterial({
    map: aCol,
    normalMap: aNrm,
    roughnessMap: aRgh,
    polygonOffset: true,
    polygonOffsetFactor: -1, 
    polygonOffsetUnits: -1
  }); 
  const Y = 0.13;
  
  // 2. The South Boulevard (Main Entrance)
  s(plane(700, 30, am, [0, Y, 215])); 
  s(plane(700, 4, MATS.grassGreen(), [0, Y + 0.01, 215])); // Green median
  
  // 3. The Polo Ring (Straight Edges)
  s(plane(8, 220, am, [-155, Y, 0])); // West Vertical
  s(plane(8, 220, am, [ 155, Y, 0])); // East Vertical
  s(plane(320, 8, am, [0, Y, 104]));  // South Horizontal
  s(plane(240, 8, am, [0, Y, -104])); // North Horizontal (Shortened for curve)
  
  // 4. Outer Avenues
  s(plane(8, 220, am, [-177, Y, -5])); // Outer West
  s(plane(8, 220, am, [ 177, Y, -5])); // Outer East
  
  // 5. Equestrian & Training Quarter Roads (West)
  s(plane(8, 280, am, [-270, Y, 20])); 
  s(plane(8, 200, am, [-230, Y, 10]));
  s(plane(150, 8, am, [-310, Y, 145]));
  
  // 6. East Precinct Roads (Commercial/Paddock)
  s(plane(8, 250, am, [ 200, Y, 10]));
  s(plane(55, 8, am, [ 215, Y, 120]));
  
  // 7. Clubhouse Driveways
  s(plane(400, 8, am, [0, Y, 128])); 
  s(plane(130, 35, am, [0, Y, 148]));

  // 8. THE CRESCENT ROAD (Behind the Northern Villas)
  const cShape = new THREE.Shape();
  cShape.moveTo(-160, -104); 
  cShape.lineTo(-120, -104);
  // Push the peak of the curve to Z: -155
  cShape.quadraticCurveTo(0, -155, 120, -104);
  cShape.lineTo(160, -104);
  // Add the 8m thickness
  cShape.lineTo(160, -112);
  cShape.quadraticCurveTo(0, -163, -120, -112);
  cShape.lineTo(-160, -112);
  cShape.lineTo(-160, -104);

  const cGeo = new THREE.ShapeGeometry(cShape, 64);
  const cMesh = new THREE.Mesh(cGeo, am);
  cMesh.rotation.x = -Math.PI / 2; // Lay it flat on the ground
  cMesh.position.set(0, Y, 0);
  cMesh.receiveShadow = true;
  scene.add(cMesh);
}

function addLake() {
  const shape = new THREE.Shape();
  shape.moveTo(-75, 92); 
  shape.lineTo(75, 92);  
  shape.quadraticCurveTo(85, 92, 80, 102); 
  shape.quadraticCurveTo(0, 135, -80, 102); 
  shape.quadraticCurveTo(-85, 92, -75, 92); 

  const waterGeo = new THREE.ShapeGeometry(shape, 64);

  const waterNormals = new THREE.TextureLoader().load('assets/textures/stone-normal.png', function(tex) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 6);
  });
  waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;

  const lakeReflection = new Water(waterGeo, {
    textureWidth: 512, textureHeight: 512,
    waterNormals: waterNormals, 
    sunDirection: new THREE.Vector3(-180, 180, 120).normalize(),
    sunColor: 0xfff4e0, waterColor: 0x1a6a98,
    distortionScale: 2.5, fog: scene.fog !== undefined
  });
  
  lakeReflection.position.set(0, 0.335, 0);
  lakeReflection.rotation.x = -Math.PI / 2;
  lakeReflection.userData.isPlanarWater = true;
  
  scene.add(lakeReflection);
  waterMeshes.push(lakeReflection);
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
    applyPS4Materials(gltf.scene);
    gltf.scene.traverse(child=>{ if(child.isMesh) child.frustumCulled=true; });
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

function loadStablesGLB() {
  loadOneGLB("assets/stables-mesh.glb", 18.846, 0, tmpl => {
    const g = new THREE.Group(); 
    g.position.set(-320, 0, 120); 
    g.add(tmpl.clone(true)); 
    scene.add(g);
  });
}

function loadVillaGLB(){
  makeDracoLoader().load("assets/villa-mesh.glb", gltf => {
    gltf.scene.scale.setScalar(VILLA_SCALE);
    gltf.scene.traverse(c => {
      if(c.isMesh){ 
        c.castShadow = false; 
        c.receiveShadow = true;
        if(c.material){ c.material.envMapIntensity = 0.4; c.material.needsUpdate = true; }
      }
    });
    const bbox = new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y = bbox.min.y < 0 ? -bbox.min.y : 0;
    const wrapper = new THREE.Group(); 
    wrapper.add(gltf.scene); 
    villaGLBScene = wrapper;

    const queue = [...pendingVillas];
    pendingVillas = [];

    function processBatch() {
      const batch = queue.splice(0, 6);
      batch.forEach(({x, z, ry, plotKey}) => placeVillaGLBWithLOD(x, z, ry, plotKey));
      if (queue.length > 0) {
        requestAnimationFrame(processBatch);
      }
    }
    processBatch();
  }, null, err => {
    pendingVillas.forEach(({x, z, ry}) => {
      const v = _createVillaFallback();
      v.position.set(x, 0, z);
      v.rotation.y = ry;
      scene.add(v);
    });
    pendingVillas = [];
  });
}

function loadApartmentGLB(){
  makeDracoLoader().load("assets/apartment-mesh.glb",gltf=>{
    gltf.scene.scale.setScalar(APT_SCALE);
    applyPS4Materials(gltf.scene);
    const bbox=new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y=bbox.min.y<0?-bbox.min.y:0;
    const wrapper=new THREE.Group(); wrapper.add(gltf.scene); aptGLBScene=wrapper;
    pendingApts.forEach(({x,z,ry})=>placeAptGLB(x,z,ry)); pendingApts=[];
  },null,()=>{pendingApts.forEach(({x,z})=>scene.add(_createFlatBlock(x,z)));pendingApts=[];});
}

function loadLoftGLB(){
  makeDracoLoader().load("assets/loft-mesh.glb",gltf=>{
    gltf.scene.scale.setScalar(LOFT_SCALE);
    applyPS4Materials(gltf.scene);
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
function placeLoftGLB(x,z,ry,plotKey){
  ry=ry||0; if(!loftGLBScene){pendingLofts.push({x,z,ry,plotKey});return;}
  const clone=loftGLBScene.clone(true); clone.position.set(x,0,z); clone.rotation.y=ry; scene.add(clone);
  if (plotKey) addPlotOverlay(x, z, ry, plotKey, clone); // Adds the green hover floor and registry entry
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

export function reservePlot(plotKey) {
  const plot = plotRegistry.get(plotKey); 
  if (!plot || plot.status === "reserved") return false;
  plot.status = "reserved";
  
  if (plot.villaClone) {
    plot.villaClone.traverse(c => {
      if (c.isMesh) {
        if (!c.userData.origMat) c.userData.origMat = c.material;
        c.material = new THREE.MeshBasicMaterial({
          color: 0xff2222, transparent: true, opacity: 0.5, wireframe: true
        });
      }
    });
  }
  
  if (plot.overlay) {
    plot.overlay.material.color.set(0xff2222);
    plot.overlay.material.opacity = 0;
  }
  
  plotRegistry.set(plotKey, plot); 
  if (typeof window.updatePlotBadge === 'function') window.updatePlotBadge(plotKey, "RESERVED");
  return true;
}

export function unreservePlot(plotKey) {
  const plot = plotRegistry.get(plotKey);
  if (!plot || plot.status !== "reserved") return false;
  plot.status = "available";
  
  if (plot.villaClone) {
    plot.villaClone.traverse(c => {
      if (c.isMesh && c.userData.origMat) {
        c.material = c.userData.origMat;
      }
    });
  }
  
  if (plot.overlay) {
    plot.overlay.material.color.set(0x00ff88);
    plot.overlay.material.opacity = 0;
  }
  
  plotRegistry.set(plotKey, plot);
  if (typeof window.updatePlotBadge === 'function') window.updatePlotBadge(plotKey, "AVAILABLE");
  return true;
}

export function getPlotAtRay(raycaster) {
  const targets = [];
  
  plotRegistry.forEach((plot, key) => {
    // 1. Add the ground overlay
    if (plot.overlay) {
      plot.overlay.material.opacity = 0.01;
      targets.push(plot.overlay);
    }
    // 2. Add the actual 3D building mesh
    if (plot.villaClone && plot.villaClone.visible) {
      // We assign the plotKey directly to the mesh so the raycaster knows what it hit
      plot.villaClone.traverse(c => {
        if (c.isMesh) {
          c.userData.plotKey = key;
          targets.push(c);
        }
      });
    }
  });
  
  const hits = raycaster.intersectObjects(targets, false);
  
  // Clean up the ground opacity
  plotRegistry.forEach(plot => {
    if (plot.overlay && plot.status !== 'reserved') plot.overlay.material.opacity = 0;
  });
  
  if (hits.length > 0) return hits[0].object.userData.plotKey;
  return null;
}
// ─── VILLA RING ───────────────────────────────────────────────────────────────
const NO_BUILD_ZONES=[[0,128,75,55],[-375,90,55,45],[-248,-25,50,22],[-248,55,50,22],
  [-390,0,65,100],[270,65,28,18],[218,0,28,28],[218,52,30,26],[0,0,140,76],[30,-115,105,18]];
const villaFootprints=[];
window._nextUnitId = 1; // Global sequential tracker starting at 1
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
    const plotKey=String(window._nextUnitId++); // Sequential numbering
    registerVillaFootprint(x,z,plotKey,"3 BED VILLA");
    placeVillaGLBWithLOD(x,z,ry,plotKey);
    addVillaContactShadow(x,z); 
    collectVillaHedge(x,z,ry); 
    const fx=Math.sin(ry)*(-9),fz=Math.cos(ry)*(-9),rx=Math.cos(ry)*8,rz=-Math.sin(ry)*8;
    if(!isInNoBuildZone(x+rx+fx,z+rz+fz)) cypressPositions.push([x+rx+fx,z+rz+fz]);
    if(!isInNoBuildZone(x-rx+fx,z-rz+fz)) cypressPositions.push([x-rx+fx,z-rz+fz]);
  }
  
  // PRESERVED: Exact North Straight Edges
  [-86, -108, -130, -152].forEach(x => { placeV(x, -120, 0); });
  placeV(-160, -104, -Math.PI / 4); 
  [86, 108, 130, 152].forEach(x => { placeV(x, -120, 0); });
  placeV(160, -104, Math.PI / 4); 

  // EDITED: Changed from 10 to 11 to add 1 missing villa around the lake
  for (let i = 0; i < 11; i++) {
    const t = 0.05 + (i / 10) * 0.90; 
    const x = -70 + (t * 140); 
    const z = -120 - Math.sin(t * Math.PI) * 18; 
    const rotY = Math.atan2(0 - x, -60 - z); 
    placeV(x, z, rotY);
  }

  // PRESERVED: Exact West & East Columns (Pony Lines)
  [-75, -47, -19].forEach(z => placeV(-162, z, Math.PI / 2));
  [19, 47, 75].forEach(z => placeV(-162, z, Math.PI / 2));
  placeV(-148, 105, 3 * Math.PI / 4);

  [-75, -47, -19].forEach(z => placeV(162, z, -Math.PI / 2));
  [19, 47, 75].forEach(z => placeV(162, z, -Math.PI / 2));
  placeV(148, 105, -3 * Math.PI / 4);

  // EDITED: Added 149 to both sides to spawn 2 missing villas at the south corners
  for(const side of [-1, 1]) {
    [65, 93, 121, 149].forEach(xa => {
      placeV(side * xa, 105 + xa * 0.04, 0);
    });
  }

  buildInstancedCypress(cypressPositions);
  buildAllVillaHedges();
}

function addLoftTerraces(){
  
  // New helper: Slices 1 physical block into 4 clickable units
  function placeLoftBlock(x, z, ry) {
    placeLoftGLB(x, z, ry, null); // Place 1 physical building
    const offsets = [-13.5, -4.5, 4.5, 13.5]; 
    const cosR = Math.cos(ry), sinR = Math.sin(ry);

    offsets.forEach(offsetX => {
      const unitX = x + offsetX * cosR;
      const unitZ = z - offsetX * sinR; 
      const key = String(window._nextUnitId++); // Registers 4 sequential IDs
      
      const hitbox = new THREE.Mesh(
        new THREE.BoxGeometry(9, 10, 16),
        new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0, depthWrite: false })
      );
      hitbox.position.set(unitX, 5, unitZ); 
      hitbox.rotation.y = ry;
      hitbox.userData = { isPlotOverlay: true, plotKey: key }; 
      scene.add(hitbox);
      
      plotRegistry.set(key, { x: unitX, z: unitZ, status: 'available', overlay: hitbox, type: "2 BED LOFT TERRACE", ry: ry });
    });
  }

  // PRESERVED: Your exact Northern wrap-around lofts (12 Blocks)
  for(let x=-310; x<=-110; x+=36){ 
    placeLoftBlock(x, -162-Math.abs(x)*.05, Math.PI); 
  }
  for(let x=95; x<=310; x+=36){ 
    placeLoftBlock(x, -162-Math.abs(x)*.05, Math.PI); 
  }
  
  // PRESERVED: Your exact West Column Lofts (7 Blocks)
  [-75, -45, -15].forEach(z => { placeLoftBlock(-200, z, 0); });
  [15, 45, 75, 105].forEach(z => { placeLoftBlock(-200, z, 0); });

  // NEW: The 5 Blocks on the Far East Column you were missing
  [-45, -15, 15, 45, 75].forEach(z => { placeLoftBlock(260, z, Math.PI); });
}
function addWestCompound() {
  // 1. Training Field (Far West Layer)
  s(plane(120, 185, MATS.safetyBrown(), [-320, .06, 0])); 
  s(plane(100, 160, MAT_GRASS_FIELD(), [-320, .10, 0]));
  
  // 2. Block of Flats (Middle Layer)
  placeAptGLB(-245, -45, Math.PI / 2); 
  placeAptGLB(-245, 45, Math.PI / 2);

  // 3. Register Individual Apartment Units sequentially
  // 24x 1 Bed Maisonette
  for (let i = 0; i < 24; i++) {
    const key = String(window._nextUnitId++);
    plotRegistry.set(key, { status: 'available', type: '1 BED MAISONETTE', x: -245, z: 0, isApt: true });
  }
  
  // 48x 2 Bed Flat
  for (let i = 0; i < 48; i++) {
    const key = String(window._nextUnitId++);
    plotRegistry.set(key, { status: 'available', type: '2 BED FLAT', x: -245, z: 0, isApt: true });
  }
  
  // 12x Studio
  for (let i = 0; i < 12; i++) {
    const key = String(window._nextUnitId++);
    plotRegistry.set(key, { status: 'available', type: 'STUDIO', x: -245, z: 0, isApt: true });
  }
}
function addPaddock() {
  s(plane(70, 60, MAT_GRASS_FIELD(), [240, 0.07, -30]));
  const postPos = [];
  const xMin = 205, xMax = 275, zMin = -60, zMax = 0;
  for(let fz = zMin; fz <= zMax; fz += 5) { 
    postPos.push([xMin, 0.8, fz]); 
    postPos.push([xMax, 0.8, fz]); 
  }
  for(let fx = xMin; fx <= xMax; fx += 5) { 
    postPos.push([fx, 0.8, zMin]); 
    postPos.push([fx, 0.8, zMax]); 
  }
  buildInstancedFencePosts(postPos); 

  const rm = MATS.railWhite();
  s(box(0.08, 0.1, 60, rm, [xMin, 1.0, -30], 0, false)); 
  s(box(0.08, 0.1, 60, rm, [xMax, 1.0, -30], 0, false)); 
  s(box(70, 0.1, 0.08, rm, [240, 1.0, zMin], 0, false)); 
  s(box(70, 0.1, 0.08, rm, [240, 1.0, zMax], 0, false)); 
}

function addGamePark() {
  s(plane(70, 60, MAT_GRASS_FIELD(), [240, 0.07, 40]));
  const cols = [0xe8602a, 0x2a88c8, 0xe8c82a, 0x4ac84a];
  for(let i = 0; i < 5; i++) {
    const h = 2.6 + i * 0.4;
    const mat = new THREE.MeshStandardMaterial({ color: cols[i % 4], roughness: 0.6 });
    s(box(3.2, h, 3.2, mat, [220 + i * 10, h / 2, 40 + (i % 2 === 0 ? -10 : 10)]));
  }
}

function addCommercialBlock() {
  const g = new THREE.Group(); 
  g.position.set(240, 0, 110);
  g.add(box(42, 9, 26, MATS.flatGrey(), [0, 4.5, 0]));
  g.add(box(0.4, 8.5, 22, MAT_GLASS(0.5), [-21.2, 4.5, 0]));
  scene.add(g);
}

function addServiceCompound(){
  s(box(16,5.0,13,new THREE.MeshStandardMaterial({color:0xcc2200,roughness:.7}),[-270,2.5,95]));
  s(box(30,6,17,MATS.flatGrey(),[-240,3,100]));
}

function addLandscaping(){
  const palmDefs=[];
  function queuePalm(x,y,z,scale=1){
    if(isInNoBuildZone(x,z)) return;
    palmDefs.push({x,y,z,scale,randH:Math.random()*5});
  }
  for(let x=-280;x<=280;x+=28){queuePalm(x,.1,206,1.3);queuePalm(x,.1,224,1.2);}
  for(let z=-95;z<=95;z+=40){queuePalm(-160,.1,z,1.1);queuePalm(160,.1,z,1.1);}
  for(const pz of[95,103,111,119]){queuePalm(-16,.1,pz,1.2);queuePalm(16,.1,pz,1.2);}
  buildPalmInstances(scene, palmDefs);
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
let _prevElapsed=0;

export function tickScene(elapsed, camera){
  _tickFrame++;
  
  tickWater(waterMeshes, elapsed);
  
  waterMeshes.forEach(m => {
    if (m.userData.isPlanarWater && m.material.uniforms && m.material.uniforms['time']) {
      m.material.uniforms['time'].value += 1.0 / 60.0;
    }
  });

  tickGrass(camera);
  
  const palmDiv = PERF_SETTINGS[PERF_MODE].palmTickDiv;
  if (_tickFrame % palmDiv === 0) {
    tickPalms(camera);
  }
  
  tickHotspots(elapsed);
  
  const _frameDelta = Math.min(elapsed - (_prevElapsed || 0), 0.033);
  _prevElapsed = elapsed;
  
  tickNPCHorses(_frameDelta);
  if (_tourActive) tickTour(_frameDelta, camera);
}

export function getRenderer()   { return renderer;   }
export function getScene()      { return scene;      }
export function getCamera()     { return camera;     }
export function getClock()      { return clock;      }
export function getHorseGroup() { return horseGroup; }

// ─── PHASE 2: HOVER VISUALS (GREEN HOLOGRAM) ────────────────────────────────
window._xixHoverState = null;

window.setHoveredPlot = function(plotKey) {
  if (window._aerialModeActive || window._xixHoverState === plotKey) return;
  
  // 1. RESTORE OLD PLOT (Remove the unique glowing material and restore the shared one)
  if (window._xixHoverState) {
    const old = plotRegistry.get(window._xixHoverState);
    if (old && old.villaClone && old.status !== 'reserved') {
      old.villaClone.traverse(c => {
        if (c.isMesh && c.userData.origMat) {
          c.material = c.userData.origMat; // Snap back to the high-performance shared material
          c.userData.origMat = null;
        }
      });
    }
  }
  
  window._xixHoverState = plotKey;
  
  // 2. APPLY NEW PLOT GLOW (Clone material for this specific house only)
  if (window._xixHoverState) {
    const cur = plotRegistry.get(window._xixHoverState);
    if (cur && cur.villaClone && cur.status !== 'reserved') {
      cur.villaClone.traverse(c => {
        if (c.isMesh) {
          // Backup the shared material
          if (!c.userData.origMat) c.userData.origMat = c.material;
          
          // Clone it so the green glow DOES NOT bleed to the rest of the row
          c.material = c.userData.origMat.clone();
          c.material.emissive.setHex(0x22cc44);
          c.material.emissiveIntensity = 0.35;
        }
      });
    }
  }
};

// ─── PHASE 3: PROCEDURAL 3D INTERIOR ENGINE ─────────────────────────────────
window._xixInteriorGroup = null;
window._xixInteriorPlotKey = null;

window.triggerInteriorBuild = function(plotKey) {
  const plot = plotRegistry.get(plotKey);
  if (!plot) return;

  if (window._xixInteriorGroup) scene.remove(window._xixInteriorGroup);
  if (plot.villaClone) plot.villaClone.visible = false;
  window._xixInteriorPlotKey = plotKey;

  window._xixInteriorGroup = new THREE.Group();
  window._xixInteriorGroup.position.set(plot.x, 0, plot.z);
  window._xixInteriorGroup.rotation.y = plot.ry;

  const floorMat = new THREE.MeshStandardMaterial({ color: 0xeae6dc, roughness: 0.7 }); 
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 }); 
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xccddff, transparent: true, opacity: 0.25, roughness: 0.1, metalness: 0.8 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xb58e65, roughness: 0.5 }); 

  const L2_Y = 2.85; const L3_Y = 6.15; const CEIL_H = 3.3; 
  
  window._xixInteriorGroup.add(box(16, 0.2, 13, floorMat, [0, L2_Y, 0], 0, false)); 
  window._xixInteriorGroup.add(box(16, CEIL_H, 0.4, wallMat, [0, L2_Y + (CEIL_H/2), -6.3])); 
  window._xixInteriorGroup.add(box(0.4, CEIL_H, 13, wallMat, [-7.8, L2_Y + (CEIL_H/2), 0])); 
  window._xixInteriorGroup.add(box(0.4, CEIL_H, 13, wallMat, [7.8, L2_Y + (CEIL_H/2), 0]));  
  window._xixInteriorGroup.add(box(6, CEIL_H, 0.3, wallMat, [-3, L2_Y + (CEIL_H/2), -2]));
  window._xixInteriorGroup.add(box(3.5, 0.9, 1.2, new THREE.MeshStandardMaterial({color: 0x222222}), [-4, L2_Y + 0.45, -2])); 
  window._xixInteriorGroup.add(box(15.2, CEIL_H, 0.1, glassMat, [0, L2_Y + (CEIL_H/2), 6.3]));
  window._xixInteriorGroup.add(box(15.2, 1.1, 0.05, glassMat, [0, L2_Y + 0.55, 7.5])); 
  
  const steps = 20; const stepH = (L3_Y - L2_Y) / steps; const stepD = 0.28; 
  for (let i = 0; i < steps; i++) {
    window._xixInteriorGroup.add(box(1.5, stepH, stepD, woodMat, [6, L2_Y + (i * stepH) + (stepH/2), -2 + (i * stepD)], 0, false));
  }

  window._xixInteriorGroup.add(box(12.5, 0.2, 13, floorMat, [-1.75, L3_Y, 0], 0, false)); 
  window._xixInteriorGroup.add(box(3.5, 0.2, 7.4, floorMat, [6.25, L3_Y, 2.8], 0, false)); 
  window._xixInteriorGroup.add(box(16, CEIL_H, 0.4, wallMat, [0, L3_Y + (CEIL_H/2), -6.3])); 
  window._xixInteriorGroup.add(box(0.4, CEIL_H, 13, wallMat, [-7.8, L3_Y + (CEIL_H/2), 0])); 
  window._xixInteriorGroup.add(box(0.4, CEIL_H, 13, wallMat, [7.8, L3_Y + (CEIL_H/2), 0]));  
  window._xixInteriorGroup.add(box(8, CEIL_H, 0.2, wallMat, [-3.8, L3_Y + (CEIL_H/2), 0])); 
  window._xixInteriorGroup.add(box(0.2, CEIL_H, 6.3, wallMat, [0.2, L3_Y + (CEIL_H/2), 3.15])); 
  window._xixInteriorGroup.add(box(2.2, 0.6, 2.4, new THREE.MeshStandardMaterial({color: 0x99aaff}), [-4, L3_Y + 0.3, 2]));
  window._xixInteriorGroup.add(box(15.2, CEIL_H, 0.1, glassMat, [0, L3_Y + (CEIL_H/2), 6.3]));
  window._xixInteriorGroup.add(box(15.2, 1.1, 0.05, glassMat, [0, L3_Y + 0.55, 7.5])); 

  scene.add(window._xixInteriorGroup);

  const camLocalZ = 2.0; 
  const worldX = plot.x + Math.sin(plot.ry) * camLocalZ;
  const worldZ = plot.z + Math.cos(plot.ry) * camLocalZ;
  const camY = L2_Y + 1.65; 
  
  if (typeof window.setMoveMode === 'function') window.setMoveMode('walk');
  if (typeof setView === 'function') setView([worldX, camY, worldZ], plot.ry, 0);
};

window.destroyInteriorBuild = function() {
  if (window._xixInteriorGroup) {
    scene.remove(window._xixInteriorGroup);
    window._xixInteriorGroup = null;
  }
  if (window._xixInteriorPlotKey) {
    const plot = plotRegistry.get(window._xixInteriorPlotKey);
    if (plot && plot.villaClone) plot.villaClone.visible = true;
    window._xixInteriorPlotKey = null;
  }
};
