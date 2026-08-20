/**
 * Project XIX — Scene (Production Standard v25)
 * Upgrades: 
 * - Fast PBR Water (No texture crash loop)
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
  buildEnvMapFromSky, scheduleEnvMapRefresh, applyPS4Materials,
  loadHDRI, applyHDRITimeModulation,
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
// Impostor material: fully transparent — if LOD kicks in at extreme distance, invisible not beige box
const _impostorMat   = new THREE.MeshStandardMaterial({ color:0xF5E6B0, roughness:.8, transparent:true, opacity:0.0 });
const _impostorGeo   = new THREE.BoxGeometry(14, 8, 12);

function placeVillaGLBWithLOD(x, z, ry, plotKey) {
  if (!villaGLBScene) { 
    // Frame 1: Place a lightweight box immediately so the estate looks full
    const dummy = new THREE.Mesh(_impostorGeo, _impostorMat);
    dummy.position.set(x, 4, z);
    dummy.rotation.y = ry;
    scene.add(dummy);
    
    // Save reference so we can delete it when the real GLB arrives
    pendingVillas.push({x, z, ry, plotKey, placeholder: dummy}); 
    if (plotKey) addPlotOverlay(x, z, ry, plotKey, dummy); 
    return; 
  }

  const lod = new THREE.LOD();
  lod.position.set(x, 0, z);
  lod.rotation.y = ry;
  lod.userData.isVillaGLB  = true;
  lod.userData.baseRotY    = ry;
  lod.userData.plotKey     = plotKey;

  const highDetail = villaGLBScene.clone(true);
  highDetail.rotation.y = 0;
  lod.addLevel(highDetail, 0);          
  
  // LOD swap at 400m — well beyond walking range, prevents boxes showing inside estate
  const lowDetail = new THREE.Mesh(_impostorGeo, _impostorMat);
  lowDetail.position.y = 4;
  lod.addLevel(lowDetail, 400); 

  scene.add(lod);
  if (plotKey) addPlotOverlay(x, z, ry, plotKey, lod);
}

export function setAerialMode(on) {
  // Empty function - the LOD distance parameter automatically handles Aerial views now!
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

// ─── MOBILE / GPU TIER AUTO-DETECTION ────────────────────────────────────────
// Call detectMobileTier() immediately after renderer is created in initScene().
// On mobile UA: locks PERF_MODE to 'fast' regardless of user setting.
// On low-end GPU: caps at 'balanced' if max texture size < 4096.
function detectMobileTier() {
  const isMobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent);
  if (isMobile) {
    PERF_MODE = 'fast';
    if (typeof setPerfModeGraphics === 'function') setPerfModeGraphics('fast');
    console.log('[XIX] Mobile UA detected → PERF_MODE locked to fast');
    return;
  }
  if (renderer) {
    const gl     = renderer.getContext();
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (maxTex < 4096 && PERF_MODE === 'rich') {
      PERF_MODE = 'balanced';
      console.log('[XIX] Low-end GPU (maxTex:', maxTex, ') → PERF_MODE capped to balanced');
    }
  }
}


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
  detectMobileTier(); // Auto-lock PERF_MODE for mobile/low-end GPU

  scene  = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x8ab8cc, perfS.fogDensity);

  camera = new THREE.PerspectiveCamera(65, 1, 0.5, 1200);

  buildLighting();

  const { skyObj, sun, skyUniforms } = createAtmosphericSky(scene, renderer);
  _skyObj = skyObj; _skySun = sun; _skyUniforms = skyUniforms;
  window._xixSkyObj = skyObj;
  setSkyForTime(_skyUniforms, _skySun, sunLight, 'afternoon');

  // ── HDRI IBL — async, non-blocking ──────────────────────────────────────
  // The HDR file loads in the background. Scene renders immediately.
  // Once baked, HDRI replaces sky-capture IBL on every PBR material.
  // All four time presets are driven by intensity/tint modulation — one file.
  loadHDRI(renderer, scene, (envMap) => {
    scene.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        if (m.isMeshStandardMaterial) { m.envMap = envMap; m.needsUpdate = true; }
      });
    });
    applyHDRITimeModulation(window._currentTimeOfDay || 'afternoon', scene);
    window._hdriReady = true;
    console.log('[XIX] HDRI IBL active');
  });

  // Sky PMREM fallback — fires only if HDRI hasn't loaded within 4 seconds
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!window._hdriReady) buildEnvMapFromSky(renderer, scene, skyObj);
    // Retry fallback after 4s
    setTimeout(() => { if (!window._hdriReady) buildEnvMapFromSky(renderer, scene, skyObj); }, 4000);
  }));

  // ── Ground + field always first — visible within frame 1 ──
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

    // Load main asset first, stagger the rest using separate loaders to prevent Web Worker deadlock
    loadVillaGLB();
    addVillaRing();

    setTimeout(() => { loadLoftGLB(); addLoftTerraces(); }, 400);
    setTimeout(() => { loadApartmentGLB(); addWestCompound(); }, 800);
    setTimeout(() => { loadClubhouseGLB(); }, 1200);
    setTimeout(() => { loadStablesGLB(); }, 1600);
    setTimeout(() => { loadHorseGLB(); }, 2000);
    
    addPaddock();
    addGamePark();
    addCommercialBlock();
    addServiceCompound();
    addLandscaping();

    // Cap NPC horses at 4 — each is a separate GLB+Draco load; 8 was too expensive
    for (let i = 0; i < 4; i++) {
      setTimeout(() => spawnNPCHorse(i), 3000 + i * 600);
    }
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

  // HDRI time modulation — adjusts IBL intensity for this time of day (instant, no re-bake)
  window._currentTimeOfDay = timeName;
  applyHDRITimeModulation(timeName, scene);
  // Sky PMREM re-capture only fires if HDRI hasn't loaded (scheduleEnvMapRefresh is a no-op when HDRI active)
  if (PERF_MODE !== 'fast' && renderer && scene && _skyObj) {
    scheduleEnvMapRefresh(renderer, scene, _skyObj);
  }

  // Update glass panel sun glint intensity based on time of day
  // Afternoon: moderate glint. Sunset: strong warm glint. Night: none.
  const glintMap = { morning: 0.12, afternoon: 0.18, sunset: 0.42, night: 0.0 };
  window._xixSunGlintIntensity = glintMap[timeName] ?? 0.15;
}

export function updateSky(top, hor, gnd) {
  // no-op
}

function buildLighting() {
  const perfS = PERF_SETTINGS[PERF_MODE];

  // Sky dome ambient — blue above, warm laterite bounce below (Lagos ground colour)
  hemiLight = new THREE.HemisphereLight(0x7CB8D4, 0x4a6a30, 0.45);
  scene.add(hemiLight);

  // Ground bounce — warm terracotta fill from Lagos laterite soil
  const groundBounce = new THREE.HemisphereLight(0xFFFFFF, 0xD4803A, 0.25);
  groundBounce.position.set(0, -10, 0);
  scene.add(groundBounce);

  sunLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
  sunLight.position.set(120, 220, 100);

  if (PERF_MODE === 'fast') {
    // ── FAST: shadows OFF entirely — saves 4-8ms/frame on mobile ──────────
    sunLight.castShadow = false;
  } else {
    // ── BALANCED / RICH: tight frustum = far better shadow texel density ──
    // Current: ±380m frustum on 2048 map = 2.7mm/texel (blurry)
    // New: ±100m frustum on 2048 = 0.5mm/texel (crisp architectural shadows)
    const fHalf = PERF_MODE === 'rich' ? 120 : 100;
    sunLight.castShadow = true;
    sunLight.shadow.camera.left   = -fHalf;
    sunLight.shadow.camera.right  =  fHalf;
    sunLight.shadow.camera.top    =  fHalf;
    sunLight.shadow.camera.bottom = -fHalf;
    sunLight.shadow.camera.near   = 0.5;
    sunLight.shadow.camera.far    = 600;
    sunLight.shadow.mapSize.set(perfS.shadowMapSize, perfS.shadowMapSize);
    // Tuned per mode — eliminates acne without peter-panning
    if (PERF_MODE === 'balanced') {
      sunLight.shadow.bias       = -0.00012;
      sunLight.shadow.normalBias =  0.012;
      sunLight.shadow.radius     =  2.0;
    } else {
      sunLight.shadow.bias       = -0.00008;
      sunLight.shadow.normalBias =  0.008;
      sunLight.shadow.radius     =  1.5;
    }
  }
  scene.add(sunLight);

  // Warm fill (opposite sun — prevents pure black shadows)
  const fill = new THREE.DirectionalLight(0xd4b890, 0.25);
  fill.position.set(100, 60, -120);
  scene.add(fill);

  // Blue sky fill from north
  const ambient = new THREE.DirectionalLight(0xb8d0ff, 0.15);
  ambient.position.set(-80, 20, 80);
  scene.add(ambient);
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

// Glass mesh cache — populated by applyPS4Materials via userData.isGlassPanel flag.
// Avoids scene.traverse() on every time-of-day change (expensive at scale).
const _glassMeshCache = [];
export function registerGlassMesh(mesh) {
  if (!_glassMeshCache.includes(mesh)) _glassMeshCache.push(mesh);
}

export function updateBuildingNightGlow(timeName) {
  if (!scene) return;
  const isNight   = timeName === 'night';
  const isSunset  = timeName === 'sunset';

  // Interior warm glow — the "inhabited" feel at night
  // Night: full warm amber glow from interior lighting (0.65)
  // Sunset: subtle pre-dusk warmth (0.22)
  // Afternoon: tiny hint so glass is never completely cold (0.04)
  const glowInt = isNight ? 0.65 : isSunset ? 0.22 : 0.04;
  const glowCol = isNight
    ? new THREE.Color(0xffe4a0)   // warm incandescent interior
    : new THREE.Color(0xffcc88);  // soft warm pre-sunset

  // Target for the live sun-glint system (handled by tickScene)
  window._xixSunGlintIntensity = isNight ? 0.0 : isSunset ? 0.42 : 0.18;

  // Apply to cached glass meshes first (fast path — from applyPS4Materials)
  _glassMeshCache.forEach(obj => {
    if (!obj.material) return;
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (!mat) return;
    mat.emissive = glowCol;
    mat.emissiveIntensity = glowInt;
  });

  // Fallback: also traverse for any glass that wasn't caught by applyPS4Materials
  // (e.g. geometry built inline with MAT_GLASS). Runs only on time change, not per-frame.
  if (_glassMeshCache.length === 0) {
    scene.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      if (!mat) return;
      const name = (mat.name || obj.name || '').toLowerCase();
      if (name.includes('glass') || name.includes('window') || name.includes('glaz')) {
        mat.emissive = glowCol; mat.emissiveIntensity = glowInt; mat.needsUpdate = true;
      }
    });
  }
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
// ── PROCEDURAL GROUND SYSTEM ─────────────────────────────────────────────────
// Lagos laterite and grass ground — no external texture dependency.
// Zones: laterite perimeter → dry grass transitional → rich green inner estate.
// Procedural so it never tiles, never repeats, and always looks right at any scale.

let _groundMat = null;
function buildGroundMaterial() {
  if (_groundMat) return _groundMat;

  const groundVert = /* glsl */`
    varying vec2 vWorldXZ;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    void main() {
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      vWorldXZ  = vWorldPos.xz;
      vNormal   = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const groundFrag = /* glsl */`
    precision highp float;
    uniform float uTime;
    uniform vec3  uSunDir;
    uniform vec3  uSunColor;

    varying vec2 vWorldXZ;
    varying vec3 vWorldPos;
    varying vec3 vNormal;

    // ── Noise helpers ──────────────────────────────────────────────────────
    float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise2(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f*f*(3.0-2.0*f);
      return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),
                 mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x),f.y);
    }
    float fbm2(vec2 p) {
      float v=0.0, a=0.5;
      for(int i=0;i<4;i++){ v+=a*noise2(p); p*=2.1; a*=0.5; }
      return v;
    }

    void main() {
      vec2 wx = vWorldXZ;

      // ── 1. ZONE MAPPING ────────────────────────────────────────────────
      // Estate occupies roughly ±165m × ±125m at centre.
      // Outside that: Lagos laterite. Inside: graded grass.
      float outerR  = max(abs(wx.x) / 165.0, abs(wx.y) / 125.0); // 0=centre, 1=edge, >1=outside
      float zoneT   = smoothstep(0.85, 1.4, outerR); // 0=inner, 1=outer laterite

      // ── 2. INNER GRASS ZONE ────────────────────────────────────────────
      // Rich green grass — base for the estate interior
      float grassFBM  = fbm2(wx * 0.018);
      float grassVar  = fbm2(wx * 0.055 + 12.3);
      // Two-tone grass for the perimeter lawn (outside polo field, inside estate)
      vec3 grassA = vec3(0.22, 0.44, 0.15);  // rich tropical green
      vec3 grassB = vec3(0.30, 0.52, 0.18);  // lighter sun-hit patch
      vec3 grassCol = mix(grassA, grassB, grassFBM * grassVar);
      // Subtle harmattan dust in dry season: slight ochre tint on the inner grass
      float dustFBM = fbm2(wx * 0.008 + 55.7);
      grassCol = mix(grassCol, vec3(0.38, 0.36, 0.22) * 0.8, dustFBM * 0.18);

      // ── 3. OUTER LATERITE ZONE ─────────────────────────────────────────
      // Lagos red laterite — compacted iron-rich soil, varies from ochre to deep red
      float latFBM  = fbm2(wx * 0.022 + 33.1);
      float latFBM2 = fbm2(wx * 0.065 + 71.4);
      vec3 latA = vec3(0.58, 0.32, 0.16);  // deep laterite red
      vec3 latB = vec3(0.72, 0.45, 0.22);  // ochre-orange patches
      vec3 latC = vec3(0.48, 0.28, 0.12);  // very dark laterite shadow
      vec3 latCol = mix(mix(latA, latB, latFBM), latC, latFBM2 * 0.35);
      // Rock scatter: darker speckles at coarse scale
      float rockN = noise2(wx * 0.25);
      latCol = mix(latCol, vec3(0.30, 0.22, 0.14), step(0.82, rockN) * 0.55);

      // ── 4. TRANSITION BLEND ────────────────────────────────────────────
      // Soft gradient between inner grass and outer laterite
      // Also add a transitional dry-grass band at the boundary
      float transT = smoothstep(0.72, 0.95, outerR);  // dry grass transition
      vec3 dryGrass = vec3(0.52, 0.48, 0.22);         // harmattan-bleached grass
      vec3 innerCol  = mix(grassCol, dryGrass, transT * transT);
      vec3 finalAlbedo = mix(innerCol, latCol, zoneT);

      // ── 5. PBR LIGHTING ────────────────────────────────────────────────
      vec3 N = normalize(vNormal);
      // Fake micro-normal from FBM for surface roughness variation
      float microN = fbm2(wx * 0.4 + uTime * 0.005);
      N = normalize(N + vec3((microN-0.5)*0.06, 0.0, (noise2(wx*0.4+5.1)-0.5)*0.06));

      vec3 L   = normalize(uSunDir);
      float NdL = max(dot(N, L), 0.0);
      // Ground roughness: laterite is very rough (0.96), grass slightly less (0.88)
      float rough = mix(0.88, 0.97, zoneT);
      // Strong ambient — ground receives lots of sky fill in tropics
      vec3 amb = finalAlbedo * vec3(0.30, 0.36, 0.34);
      vec3 color = finalAlbedo * uSunColor * NdL * 0.85 + amb;

      // ── 6. CONTACT DARKENING near building footprints ──────────────────
      // Approximate AO: very subtle darkening near estate centre
      // (proper AO from GTAO handles the rest)
      float centreAO = smoothstep(80.0, 0.0, length(wx)) * 0.08;
      color *= 1.0 - centreAO;

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  _groundMat = new THREE.ShaderMaterial({
    vertexShader: groundVert,
    fragmentShader: groundFrag,
    uniforms: {
      uTime:    { value: 0.0 },
      uSunDir:  { value: new THREE.Vector3(0.48, 0.88, 0.40).normalize() },
      uSunColor:{ value: new THREE.Color(0xfff4e0) },
    },
  });
  window._xixGroundMat = _groundMat;
  return _groundMat;
}

// Legacy getDirtMaterial: returns the new procedural ground for compatibility
function getDirtMaterial() { return buildGroundMaterial(); }

const MATS = {
  villaRoof:  () => PBR.tileRoof(),
  loftBody:   () => PBR.concrete(),
  loftRoof:   () => PBR.timber(),
  flatGrey:   () => PBR.concrete(),
  stableRoof: () => PBR.timber(),
  roadAsph:   () => PBR.asphalt(),
  safetyBrown:() => getDirtMaterial(), 
  grassGreen: () => PBR.grass(),
  lawnGreen:  () => PBR.grass(),
  hedgeGreen: () => new THREE.MeshStandardMaterial({color:0x2a5a20,roughness:.95}), 
  cobble:     () => PBR.stone(),
  concrete:   () => PBR.concrete(),
  railWhite:  () => new THREE.MeshStandardMaterial({color:0xfcfaf8,roughness:.5}),
  plotAvail:  () => new THREE.MeshStandardMaterial({color:0x00ff88,transparent:true,opacity:0,depthWrite:false}),
  plotReserved:()=> new THREE.MeshStandardMaterial({color:0xff4444,transparent:true,opacity:0,depthWrite:false}),
};

function addGround() {
  const groundMat = buildGroundMaterial();

  // Single large ground plane — the GLSL shader handles all zone transitions internally.
  // 900×700m covers the full estate footprint plus surroundings.
  const gp = new THREE.Mesh(new THREE.PlaneGeometry(900, 700, 8, 8), groundMat);
  gp.rotation.x = -Math.PI / 2;
  gp.position.set(0, 0, 30);
  gp.receiveShadow = true;
  scene.add(gp);
  _terrainMeshes.push(gp);

  // Clubhouse forecourt: concrete apron (unchanged — a real surface material)
  s(plane(180, 80, MATS.concrete(), [0, .02, 122]));
  // Stables cobblestone yard
  s(plane(90, 70, MATS.cobble(), [-355, .02, 90]));
  // West compound: additional lawn (slightly above ground to prevent z-fighting)
  // West compound lawn handled by ground GLSL shader
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

function addGrassRing() {
  // ══════════════════════════════════════════════════════════════════════════
  //  PERMANENTLY DISABLED — DO NOT RE-ENABLE
  // ══════════════════════════════════════════════════════════════════════════
  //  addGrassField() creates flat PlaneGeometry billboard cards that only look
  //  like grass when tickGrass() rotates them to face the camera every frame.
  //  tickGrass() is a bare return (bypassed for performance, graphics.js), so the
  //  cards sit at fixed random rotations and render as large flat green
  //  rectangles standing in the scene — visible behind the villas and across
  //  the estate perimeter.
  //
  //  This has now been reintroduced and removed twice. It stays removed.
  //  Ground cover is handled entirely by the GLSL shaders:
  //    • polo field  → addPoloField()        (blade displacement + chevron mow)
  //    • estate floor→ buildGroundMaterial() (laterite / grass / dry transition)
  //
  //  If billboard grass is ever wanted again, tickGrass() must be un-bypassed
  //  AND profiled on mobile FIRST. Do not call addGrassField() before that.
  // ══════════════════════════════════════════════════════════════════════════
  return;
}

function addPoloField() {
  // ─── Vertex shader — blade geometry displacement ───────────────────────
  const vertexShader = /* glsl */`
    uniform float uTime;
    uniform float uBladeStr;
    varying vec2  vUv;
    varying vec3  vWorldPos;
    varying vec3  vNormal;
    varying float vBladeTop;

    float hashv(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }

    void main(){
      vUv = uv;
      vec3 pos = position;

      // World cell: one unique blade per ~1.25m²
      vec2 cell  = floor(pos.xy / 1.25);
      float seed = hashv(cell);
      float seed2= hashv(cell + vec2(3.7, 8.1));

      // Blade tip weight: in PlaneGeometry pos.y goes -0.5→+0.5 per segment
      // We remap so the "top" of each local quad = 1.0
      float stripV   = fract(pos.y / 1.25 + 0.5);  // 0=base 1=tip within each blade strip
      vBladeTop = stripV * stripV;                   // quadratic — sharper at tip

      if(uBladeStr > 0.05){
        float bladeH   = (seed  * 0.10 + 0.04) * uBladeStr;  // 4–14cm height
        float leanAng  = seed2 * 6.2831;
        float leanAmt  = (seed2 * 0.4 + 0.2) * 0.06 * uBladeStr;

        // Vertical displacement (Z because plane is XY before rotation)
        pos.z += bladeH * stripV;

        // Lean: tips shift in a unique XY direction
        pos.x += cos(leanAng) * leanAmt * stripV;
        pos.y += sin(leanAng) * leanAmt * stripV;

        // Wind: tips sway with time + per-blade phase
        float wind = sin(uTime * 1.15 + seed * 6.28 + pos.x * 0.25) * 0.018
                   + sin(uTime * 0.72 + seed2 * 3.14) * 0.009;
        pos.x += wind * stripV;

        // Tilted normal follows lean direction
        vec3 N = normalize(vec3(-cos(leanAng)*leanAmt*3.0,
                                -sin(leanAng)*leanAmt*3.0,
                                 1.0));
        vNormal = normalize(normalMatrix * N);
      } else {
        vNormal = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
      }

      vWorldPos   = (modelMatrix * vec4(pos, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  // ─── Fragment shader — FBM turf, chevron mow, yard lines, sheen ─────────
  const fragmentShader = /* glsl */`
    precision highp float;

    uniform float uTime;
    uniform vec3  uSunDir;
    uniform vec3  uSunColor;
    uniform float uWetness;   // 0 = dry, 1 = wet (rain weather)
    uniform float uSheen;     // 0 = fast (off), 1 = balanced/rich
    uniform sampler2D uGrassCol;
    uniform sampler2D uGrassNrm;
    uniform sampler2D uGrassRgh;
    uniform sampler2D uGrassAO;
    uniform float uHasTex;    // 1.0 when colour + normal are loaded

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    varying float vBladeTop;

    // ── Noise helpers (from realism-upgrade.js — 5-octave FBM) ───────────
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                 mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
      return v;
    }

    // ── Smooth line helper ────────────────────────────────────────────────
    float sdLine(float pos, float halfW) {
      return smoothstep(halfW + 0.15, halfW - 0.05, abs(pos));
    }

    void main() {
      float wx = vWorldPos.x;   // −137 → +137 (long axis)
      float wz = vWorldPos.z;   // −73  → +73  (short axis)

      // ── 1. CHEVRON MOW PATTERN (45° diagonal, 10m bands) ─────────────
      float chevronAxis = (wx + wz) * 0.7071;
      float band        = floor(chevronAxis / 10.0);
      float isEven      = mod(band, 2.0);

      // ── 2. FBM TURF DETAIL (3 scales — blade / patch / macro) ────────
      float micro = fbm(vUv * 800.0 + uTime * 0.018);  // blade clumping
      float meso  = fbm(vUv * 120.0);                   // patch variation
      float macro = fbm(vUv *  20.0);                   // colour drift

      // ── 3. GRASS BASE COLOUR — dry vs wet ────────────────────────────
      // Lagos polo pitch: bright saturated turf — think Guards Polo Club, not a football pitch
      // Light band: #5DA83C (the well-lit mow pass), Dark band: #3A7028 (the shadow-lean pass)
      // ~30% luminance difference matches real turf photography from elevation
      vec3 dryLight  = vec3(0.357, 0.659, 0.271);
      vec3 dryDark   = vec3(0.259, 0.478, 0.188);
      vec3 wetLight  = vec3(0.188, 0.400, 0.141);
      vec3 wetDark   = vec3(0.122, 0.282, 0.094);
      vec3 colLight  = mix(dryLight, wetLight, uWetness);
      vec3 colDark   = mix(dryDark,  wetDark,  uWetness);
      float fbmBlend = mix(micro * 0.6 + 0.4, macro, 0.80);
      float shade    = mix(0.94, 1.0, fbmBlend);
      vec3 albedo    = mix(colDark, colLight, isEven) * shade;
      // Retroreflection: grass brightens at grazing angles — far field stays visible
      vec3 V_dir = normalize(cameraPosition - vWorldPos);
      float grazingFactor = 1.0 - max(dot(V_dir, vec3(0.0, 1.0, 0.0)), 0.0);
      albedo = albedo * (1.0 + grazingFactor * 0.28);
      float roughness = mix(0.92, 0.42, uWetness);
      roughness      *= mix(0.94, 1.0, meso);

      // ── 5. YARD LINES IN SHADER (world-space SDF) ─────────────────────
      // Centre line
      float centreLine = sdLine(wx, 0.22);
      // Yard lines: 27.4m, 36.6m, 54.9m from each goal line (x = ±137)
      float yl1 = sdLine(abs(wx) - (137.0 - 27.4), 0.22);
      float yl2 = sdLine(abs(wx) - (137.0 - 36.6), 0.22);
      float yl3 = sdLine(abs(wx) - (137.0 - 54.9), 0.22);
      // Goal lines
      float gl  = sdLine(abs(wx) - 137.0, 0.30);
      // Side board lines
      float sl  = sdLine(abs(wz) - 73.0,  0.22);

      float allLines = max(max(max(max(centreLine, yl1), max(yl2, yl3)), gl), sl);
      vec3  lineCol  = vec3(0.952, 0.945, 0.890) * (0.92 + 0.08 * micro);
      albedo = mix(albedo, lineCol, allLines * 0.94);

      // ── 6. GOAL MOUTH PENALTY ARCS (FIP standard, r ≈ 36m) ───────────
      // Arc centres are at the goal lines (x = ±137), centred on z = 0
      float arcDist1 = length(vec2(wx - 137.0, wz)) - 36.0;
      float arcDist2 = length(vec2(wx + 137.0, wz)) - 36.0;
      float arcLine  = max(sdLine(arcDist1, 0.22), sdLine(arcDist2, 0.22));
      // Only draw arc where it falls inside the field bounds
      float insideField = step(abs(wx), 137.0) * step(abs(wz), 73.0);
      albedo = mix(albedo, lineCol, arcLine * 0.90 * insideField);

      // ── 7. BLADE DETAIL ───────────────────────────────────────────────
      // (a) PHOTOGRAPHIC TURF — ambientCG Grass004
      //     Sampled at two scales with an offset so the 3.9m tile never reads
      //     as a repeating grid. We keep OUR chevron mow colour and take the
      //     photo's *detail* (luminance + normal), which is what sells blades.
      vec3  turfN = vec3(0.0, 0.0, 1.0);
      float turfAO = 1.0;
      if (uHasTex > 0.5) {
        vec2 uvA = vUv;
        vec2 uvB = vUv * 2.63 + vec2(0.41, 0.17);

        vec3 cA = texture2D(uGrassCol, uvA).rgb;
        vec3 cB = texture2D(uGrassCol, uvB).rgb;
        vec3 turfCol = mix(cA, cB, 0.38);

        // Luminance detail modulates our mow-stripe albedo
        float lum = dot(turfCol, vec3(0.299, 0.587, 0.114));
        albedo *= (0.58 + lum * 0.92);
        // Then blend a little of the real hue back in for authenticity
        albedo = mix(albedo, albedo * turfCol * 2.25, 0.34);

        // Normal map — this is what makes individual blades catch light
        vec3 nA = texture2D(uGrassNrm, uvA).rgb * 2.0 - 1.0;
        vec3 nB = texture2D(uGrassNrm, uvB).rgb * 2.0 - 1.0;
        turfN = normalize(mix(nA, nB, 0.38));

        // Roughness map — wet blades vs dry blades vary across the surface
        float rTex = texture2D(uGrassRgh, uvA).r;
        roughness = mix(roughness, roughness * (0.72 + rTex * 0.56), 0.65);

        // AO map — darkens the gaps between blade clumps
        turfAO = mix(1.0, texture2D(uGrassAO, uvA).r, 0.55);
        albedo *= turfAO;
      }

      // (b) Procedural blade streaks — carry the look when no texture is present,
      //     and add sub-texel variation on top of it when there is one.
      float bladeNoise  = noise(vec2(wx * 7.5, wz * 7.5));
      float bladeStreak = noise(vec2(wx * 26.0 + wz * 4.0, wz * 3.0));
      float bladeDetail = (bladeNoise * 0.55 + bladeStreak * 0.45);
      albedo *= mix(0.80 + bladeDetail * 0.40, 0.92 + bladeDetail * 0.16, uHasTex);

      // (c) Tip brightening from the vertex blade displacement
      float tipBright = vBladeTop * vBladeTop * 0.30;
      albedo *= (1.0 + tipBright * (0.55 + isEven * 0.20));

      // Combine the geometric blade normal with the photographic turf normal.
      // Tangent space here is effectively world XZ since the pitch is flat.
      vec3 N = vNormal;
      if (uHasTex > 0.5) {
        N = normalize(vNormal + vec3(turfN.x, 0.0, turfN.y) * 0.85);
      }

      // ── 8. PBR LIGHTING (Lambert + specular) ──────────────────────────
      vec3 L   = normalize(uSunDir);
      float NdL = max(dot(N, L), 0.0);
      vec3  V   = normalize(cameraPosition - vWorldPos);
      vec3  H   = normalize(L + V);
      float NdH = max(dot(N, H), 0.0);

      // Specular — only on low-roughness (wet) turf
      float specStr = pow(NdH, 32.0) * (1.0 - roughness) * 0.25;

      // Anisotropic chevron sheen — only Balanced/Rich (uSheen)
      float sheen = 0.0;
      if (uSheen > 0.5) {
        vec3  mowDir = normalize(vec3(0.7071, 0.0, 0.7071));
        float vDotM  = max(dot(V, mowDir), 0.0);
        sheen = pow(vDotM, 14.0) * 0.16 * (1.0 - isEven * 0.5);
      }

      // Sky ambient: Lagos blue sky contributes significant fill from overhead
      // Strong ambient prevents the field looking black when sun angle is low
      vec3 skyAmb = albedo * vec3(0.32, 0.38, 0.36);
      float directStr = NdL * 1.18;
      float tipHighlight = pow(max(dot(normalize(uSunDir + V_dir), vNormal), 0.0), 48.0) * (0.12 + isEven * 0.08);
      vec3 color = albedo * uSunColor * directStr
                 + vec3(specStr + sheen + tipHighlight) * uSunColor
                 + skyAmb;
      float lum = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(color, albedo * 0.42, max(0.0, 0.28 - lum));

      // ── 9. EDGE AO (slight darkening near boundary) ───────────────────
      float edgeAO = smoothstep(0.0, 7.0,
        min(min(137.0 - abs(wx), 73.0 - abs(wz)), 7.0));
      color *= mix(0.87, 1.0, edgeAO);

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const fieldMat = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uTime:     { value: 0.0 },
      uSunDir:   { value: new THREE.Vector3(120, 220, 100).normalize() },
      uSunColor: { value: new THREE.Color(0xfff4e0) },
      uWetness:  { value: 0.0 },
      uSheen:    { value: PERF_MODE === 'fast' ? 0.0 : 1.0 },
      uBladeStr: { value: PERF_MODE === 'fast' ? 0.0 : 1.0 },
      uGrassCol:  { value: null },  // ambientCG Grass004 — colour
      uGrassNrm:  { value: null },  // normal (GL convention)
      uGrassRgh:  { value: null },  // roughness
      uGrassAO:   { value: null },  // ambient occlusion
      uHasTex:    { value: 0.0 },   // 1.0 once colour + normal have loaded
    },
  });

  // Expose for tickScene() uniform updates and weather system
  window._xixFieldMat = fieldMat;

  // ── REAL TURF TEXTURES (ambientCG Grass004, web-optimised) ───────────────
  //  assets/textures/grass-color.jpg      1024²  ~284KB
  //  assets/textures/grass-normal.jpg     1024²  ~293KB   ← blade relief
  //  assets/textures/grass-roughness.jpg   512²   ~56KB
  //  assets/textures/grass-ao.jpg          512²   ~64KB
  //
  //  Tiled 70×38 across the 274×146m pitch ≈ one 3.9m tile — the scale real
  //  mown turf reads at from standing height. Colour and normal are required
  //  for uHasTex to flip on; roughness and AO are progressive enhancements.
  //  Everything degrades to the procedural shader if the files are absent.
  (function loadTurf() {
    const L = new THREE.TextureLoader();
    const REPEAT_X = 70, REPEAT_Y = 38;
    const setup = (t, srgb) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(REPEAT_X, REPEAT_Y);
      t.anisotropy = PERF_MODE === 'rich' ? 16 : PERF_MODE === 'balanced' ? 8 : 4;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      return t;
    };
    let got = 0;
    const flag = () => { if (++got >= 2) fieldMat.uniforms.uHasTex.value = 1.0; };

    L.load('assets/textures/grass-color.jpg',
      t => { fieldMat.uniforms.uGrassCol.value = setup(t, true);  flag();
             console.log('[XIX] turf colour map loaded'); },
      undefined,
      () => console.log('[XIX] no grass-color.jpg — procedural turf only'));

    L.load('assets/textures/grass-normal.jpg',
      t => { fieldMat.uniforms.uGrassNrm.value = setup(t, false); flag();
             console.log('[XIX] turf normal map loaded'); },
      undefined, () => {});

    L.load('assets/textures/grass-roughness.jpg',
      t => { fieldMat.uniforms.uGrassRgh.value = setup(t, false); },
      undefined, () => {});

    L.load('assets/textures/grass-ao.jpg',
      t => { fieldMat.uniforms.uGrassAO.value = setup(t, false); },
      undefined, () => {});
  })();

  const segsX = PERF_MODE === 'fast' ? 64  : PERF_MODE === 'balanced' ? 128 : 182;
  const segsZ = PERF_MODE === 'fast' ? 34  : PERF_MODE === 'balanced' ?  68 :  97;
  const fieldGeo  = new THREE.PlaneGeometry(274, 146, segsX, segsZ);
  const fieldMesh = new THREE.Mesh(fieldGeo, fieldMat);
  fieldMesh.rotation.x = -Math.PI / 2;
  fieldMesh.position.set(0, 0.12, 0);
  fieldMesh.receiveShadow = true;
  fieldMesh.name = 'poloField';
  scene.add(fieldMesh);
  _terrainMeshes.push(fieldMesh);
  // Note: yard line boxes removed — rendered in shader above (−8 draw calls)
}

function addSafetyZone() {
  // Lagos laterite: ochre-terracotta compacted earth
  const safetyMat = new THREE.MeshStandardMaterial({
    color: 0xC4724A, roughness: 0.96, metalness: 0.0, envMapIntensity: 0.05
  });
  s(plane(298, 25, safetyMat, [0, .11, -85.5]));
  s(plane(298, 25, safetyMat, [0, .11,  85.5]));
  s(plane(11,  146, safetyMat, [-142.5, .11, 0]));
  s(plane(11,  146, safetyMat, [ 142.5, .11, 0]));
}

function addYardMarkings() {
  // Yard lines and goal lines are now rendered inside the polo field fragment shader.
  // Only the physical goal posts remain as geometry (6 posts, 1 instanced draw call).
  const postPositions = [];
  for (const gx of [-137, 137]) {
    for (const pz of [0, -7.3, 7.3]) {
      postPositions.push([gx, 1.5, pz]);
    }
  }
  buildInstancedFencePosts(postPositions);
}

function addRoads() {
  const tl = new THREE.TextureLoader();
  const aCol = tl.load('assets/textures/asphalt-color.png'); aCol.colorSpace = THREE.SRGBColorSpace;
  const aNrm = tl.load('assets/textures/asphalt-normal.png');
  const aRgh = tl.load('assets/textures/asphalt-roughness.png');
  
  [aCol, aNrm, aRgh].forEach(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(120, 120); 
  });

  const am = new THREE.MeshStandardMaterial({
    map: aCol,
    normalMap: aNrm,
    roughnessMap: aRgh,
    roughness: 0.92,      // Dry asphalt: very rough
    metalness: 0.0,
    envMapIntensity: 0.1, // Near-zero dry reflection
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  // Tag for weather system: rain reduces roughness → roads get specular puddle sheen
  am.userData.isRoadSurface = true;
  window._xixRoadMat = am;
  const Y = 0.13;
  
  s(plane(700, 30, am, [0, Y, 215])); 
  s(plane(700, 4, MATS.grassGreen(), [0, Y + 0.01, 215])); 
  
  s(plane(8, 220, am, [-155, Y, 0])); 
  s(plane(8, 220, am, [ 155, Y, 0])); 
  s(plane(320, 8, am, [0, Y, 104]));  
  s(plane(240, 8, am, [0, Y, -104])); 
  
  s(plane(8, 220, am, [-177, Y, -5])); 
  s(plane(8, 220, am, [ 177, Y, -5])); 
  
  s(plane(8, 280, am, [-270, Y, 20])); 
  s(plane(8, 200, am, [-230, Y, 10]));
  s(plane(150, 8, am, [-310, Y, 145]));
  
  s(plane(8, 250, am, [ 200, Y, 10]));
  s(plane(55, 8, am, [ 215, Y, 120]));
  
  s(plane(400, 8, am, [0, Y, 128])); 
  s(plane(130, 35, am, [0, Y, 148]));

  const cShape = new THREE.Shape();
  cShape.moveTo(-160, -104); 
  cShape.lineTo(-120, -104);
  cShape.quadraticCurveTo(0, -155, 120, -104);
  cShape.lineTo(160, -104);
  cShape.lineTo(160, -112);
  cShape.quadraticCurveTo(0, -163, -120, -112);
  cShape.lineTo(-160, -112);
  cShape.lineTo(-160, -104);

  const cGeo = new THREE.ShapeGeometry(cShape, 64);
  const cMesh = new THREE.Mesh(cGeo, am);
  cMesh.rotation.x = -Math.PI / 2; 
  cMesh.position.set(0, Y, 0);
  cMesh.receiveShadow = true;
  scene.add(cMesh);
}

function addLake() {
  // ── Crescent lake — GLSL wave shader with sky colour injection ───────────
  // Three.js Water (planar reflection) + stone-normal.png had wrong wave frequency.
  // This replaces it with a ShaderMaterial whose wave normals are correct for
  // a calm tropical lagoon: long, low-frequency swells with small wind chop.
  // Sky colour is injected via uniform so the lake changes with time of day.

  const shape = new THREE.Shape();
  shape.moveTo(-75, 92);
  shape.lineTo(75, 92);
  shape.quadraticCurveTo(85, 92, 80, 102);
  shape.quadraticCurveTo(0, 135, -80, 102);
  shape.quadraticCurveTo(-85, 92, -75, 92);
  const waterGeo = new THREE.ShapeGeometry(shape, 80);

  const lakeVert = /* glsl */`
    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vNormal;
    uniform float uTime;
    uniform float uPerfMode; // 0=fast, 1=balanced/rich

    float waveH(vec2 p, float t) {
      // Two overlapping swell frequencies — Lagos lagoon, not ocean
      float w1 = sin(p.x * 0.045 + p.y * 0.028 + t * 0.38) * 0.12;
      float w2 = sin(p.x * 0.018 - p.y * 0.052 + t * 0.55) * 0.06;
      float chop = (uPerfMode > 0.5) ? sin(p.x * 0.18 + p.y * 0.24 + t * 1.1) * 0.02 : 0.0;
      return w1 + w2 + chop;
    }

    void main() {
      vUv = uv;
      vec3 pos = position;
      // Displace Y by wave function (only in balanced/rich — fast uses flat)
      if (uPerfMode > 0.5) pos.y += waveH(vec2(pos.x, pos.z), uTime);
      vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
      // Analytical normal from finite differences
      float eps = 0.8;
      float hL = waveH(vec2(pos.x - eps, pos.z), uTime);
      float hR = waveH(vec2(pos.x + eps, pos.z), uTime);
      float hD = waveH(vec2(pos.x, pos.z - eps), uTime);
      float hU = waveH(vec2(pos.x, pos.z + eps), uTime);
      vNormal = normalize(vec3(hL - hR, 2.0 * eps, hD - hU));
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;

  const lakeFrag = /* glsl */`
    precision highp float;
    uniform float uTime;
    uniform vec3  uSkyColor;    // Injected from current sky (changes with time)
    uniform vec3  uSunDir;      // For specular highlight on water
    uniform vec3  uSunColor;
    uniform float uWetness;     // Weather: rain makes water darker and choppier

    varying vec2 vUv;
    varying vec3 vWorldPos;
    varying vec3 vNormal;

    void main() {
      vec3 V = normalize(cameraPosition - vWorldPos);
      vec3 N = normalize(vNormal);
      vec3 L = normalize(uSunDir);

      // Fresnel: water is more reflective at grazing angles (Schlick approx)
      float fresnel = pow(1.0 - max(dot(V, N), 0.0), 4.0);
      fresnel = mix(0.04, 1.0, fresnel);

      // Deep water colour: Lagos lagoon — deep blue-green teal
      vec3 deepColor  = vec3(0.055, 0.200, 0.290); // deep blue-green
      vec3 shallowColor = vec3(0.110, 0.350, 0.420); // lighter at edges

      // Mix deep + shallow based on fake depth (UV distance from centre)
      float edgeDist = length(vUv - 0.5) * 2.0;
      vec3 waterColor = mix(deepColor, shallowColor, edgeDist * 0.6);

      // Sky reflection: inject actual sky colour into the surface
      // At grazing angles the water becomes a mirror of the sky
      vec3 reflected = reflect(-V, N);
      float skyMix = fresnel * 0.72;
      vec3 finalColor = mix(waterColor, uSkyColor * 0.75, skyMix);

      // ── Sun specular — CLAMPED ────────────────────────────────────────
      // Previously pow(dot, 220.0) * 2.5 produced values far above 1.0 across
      // a wide band of the surface. Bloom then picked that up and smeared it
      // into a harsh white glare over the whole scene. Now: tighter exponent,
      // much lower gain, and a hard clamp so it can never exceed the bloom
      // threshold by more than a hair.
      // NOTE: never use backticks in GLSL comments — this source lives inside a
      // JS template literal and a stray backtick terminates the shader string.
      float specRaw  = pow(max(dot(reflected, L), 0.0), 420.0);
      float sunSpec  = min(specRaw * 0.55, 0.85);
      // Fade the highlight out at grazing angles where it would streak
      sunSpec *= smoothstep(0.0, 0.35, max(dot(V, N), 0.0));
      finalColor += uSunColor * sunSpec;

      // Fine ripple shimmer — subtle, never additive enough to bloom
      float shimmer = sin(vWorldPos.x * 0.8 + uTime * 2.2) *
                      sin(vWorldPos.z * 0.6 + uTime * 1.8) * 0.012;
      finalColor += vec3(shimmer * fresnel * 0.5);

      // Final safety clamp — water can never blow out the frame
      finalColor = min(finalColor, vec3(1.15));

      // Rain darkens the water surface
      finalColor *= mix(1.0, 0.72, uWetness);

      // Soft edge fade at shore boundary
      float alpha = mix(0.88, 0.97, fresnel);

      gl_FragColor = vec4(finalColor, alpha);
    }
  `;

  const lakeMat = new THREE.ShaderMaterial({
    vertexShader: lakeVert,
    fragmentShader: lakeFrag,
    uniforms: {
      uTime:      { value: 0.0 },
      uSkyColor:  { value: new THREE.Color(0x7aaac8) },  // Lagos afternoon sky
      uSunDir:    { value: new THREE.Vector3(0.48, 0.88, 0.40).normalize() },
      uSunColor:  { value: new THREE.Color(0xfff4e0) },
      uWetness:   { value: 0.0 },
      uPerfMode:  { value: PERF_MODE === 'fast' ? 0.0 : 1.0 },
    },
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false,
  });

  const lakeMesh = new THREE.Mesh(waterGeo, lakeMat);
  lakeMesh.rotation.x = -Math.PI / 2;
  lakeMesh.position.set(0, 0.34, 0);
  lakeMesh.receiveShadow = false; // Water doesn't receive shadows — looks wrong
  lakeMesh.name = 'crescentLake';
  lakeMesh.userData.isLakeGLSL = true;
  scene.add(lakeMesh);
  waterMeshes.push(lakeMesh);

  // Expose mat so tickScene and weather system can update uniforms
  window._xixLakeMat = lakeMat;
}

function addEastLake(){
  // East lake removed — was positioned in the paddock zone causing visual bleed
  // into villa hedge plots. The crescent lake to the north is the primary water feature.
}

function addClubhouse(){
  s(plane(55,28,MATS.roadAsph(),[-65,.13,128]));
  s(plane(55,28,MATS.roadAsph(),[65,.13,128]));
}

// ─── GLB LOADERS ──────────────────────────────────────────────────────────────

// INDEPENDENT LOADERS FIX: We removed the Singleton _sharedGLTFLoader pattern 
// so every model spawns its own Draco decoding connection. This stops the queue deadlock!
function makeDracoLoader() {
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/libs/draco/");
  const loader = new GLTFLoader(); 
  loader.setDRACOLoader(draco); 
  return loader;
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
    // Wire through the full PBR material pipeline
    // This gives villas: concrete normal maps, glass reflections, metal frame sheen
    applyPS4Materials(gltf.scene);
    gltf.scene.traverse(c => {
      if(c.isMesh){ 
        c.castShadow = false; // Villas: receive only — casting causes shadow acne at scale
        c.receiveShadow = true;
        c.frustumCulled = true;
      }
    });
    const bbox = new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y = bbox.min.y < 0 ? -bbox.min.y : 0;
    const wrapper = new THREE.Group(); 
    wrapper.add(gltf.scene); 
    villaGLBScene = wrapper;

    // Cache glass meshes for fast night-glow updates
    gltf.scene.traverse(c => {
      if (c.isMesh && c.userData.isGlassPanel) registerGlassMesh(c);
    });

    // Swap placeholders for real houses
    const queue = [...pendingVillas];
    pendingVillas = [];
    queue.forEach((data) => {
      if (data.placeholder) scene.remove(data.placeholder); // Remove the dummy box
      placeVillaGLBWithLOD(data.x, data.z, data.ry, data.plotKey); // Insert real GLB
    });

  }, null, err => {
    console.warn('[XIX] villa-mesh.glb failed, using fallbacks:', err);
    pendingVillas.forEach((data) => {
      if (data.placeholder) scene.remove(data.placeholder); // Clean up dummy
      const v = _createVillaFallback();
      v.position.set(data.x, 0, data.z);
      v.rotation.y = data.ry;
      scene.add(v);
    });
    pendingVillas = [];
  });
}

function loadApartmentGLB(){
  makeDracoLoader().load("assets/apartment-mesh.glb",gltf=>{
    gltf.scene.scale.setScalar(APT_SCALE);
    applyPS4Materials(gltf.scene);
    gltf.scene.traverse(c => { if(c.isMesh) c.frustumCulled = true; });
    const bbox=new THREE.Box3().setFromObject(gltf.scene);
    gltf.scene.position.y=bbox.min.y<0?-bbox.min.y:0;
    const wrapper=new THREE.Group(); wrapper.add(gltf.scene); aptGLBScene=wrapper;
    const q=[...pendingApts]; pendingApts=[];
    q.forEach(({x,z,ry})=>placeAptGLB(x,z,ry));
  },null,err=>{
    console.warn('[XIX] apartment-mesh.glb failed:', err);
    const q=[...pendingApts]; pendingApts=[];
    q.forEach(({x,z})=>scene.add(_createFlatBlock(x,z)));
  });
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
  if (plotKey) addPlotOverlay(x, z, ry, plotKey, clone); 
}

// ─── PLOT OVERLAY ─────────────────────────────────────────────────────────────
function addPlotOverlay(x,z,ry,plotKey,villaClone){
  const mat=MATS.plotAvail();
  const overlay=new THREE.Mesh(new THREE.PlaneGeometry(20,18),mat);
  overlay.rotation.x=-Math.PI/2; overlay.position.set(x,.25,z);
  overlay.userData.plotKey=plotKey; overlay.userData.isPlotOverlay=true; overlay.userData.villaClone=villaClone;
  scene.add(overlay);
  
  const existingData = plotRegistry.get(plotKey) || {};
  plotRegistry.set(plotKey, { ...existingData, status: "available", overlay, villaClone, x, z, ry });
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
    if (plot.overlay) {
      plot.overlay.material.opacity = 0.01;
      targets.push(plot.overlay);
    }
    if (plot.villaClone && plot.villaClone.visible) {
      plot.villaClone.traverse(c => {
        if (c.isMesh) {
          c.userData.plotKey = key;
          targets.push(c);
        }
      });
    }
  });
  
  const hits = raycaster.intersectObjects(targets, false);
  
  plotRegistry.forEach(plot => {
    if (plot.overlay && plot.status !== 'reserved') plot.overlay.material.opacity = 0;
  });
  
  if (hits.length > 0) return hits[0].object.userData.plotKey;
  return null;
}
// ─── VILLA RING ───────────────────────────────────────────────────────────────
const villaFootprints=[];
window._nextUnitId = 1; 

const NO_BUILD_ZONES=[[0,128,75,55],[-375,90,55,45],[-248,-25,50,22],[-248,55,50,22],
  [-390,0,65,100],[270,65,28,18],[218,0,28,28],[218,52,30,26],[0,0,140,76],[30,-115,105,18]];

function registerVillaFootprint(x, z, customId, type = "3 BED VILLA") {
  villaFootprints.push({cx:x, cz:z, r:12});
  if (customId) {
    plotRegistry.set(String(customId), { x, z, status: 'available', type: type });
  }
}

function isInNoBuildZone(x,z){
  for(const [cx,cz,hw,hd] of NO_BUILD_ZONES) if(Math.abs(x-cx)<=hw&&Math.abs(z-cz)<=hd) return true;
  for(const {cx,cz,r} of villaFootprints) if((x-cx)*(x-cx)+(z-cz)*(z-cz)<=r*r) return true;
  return false;
}

function addVillaRing(){
  const PLOT=28;
  const cypressPositions=[];
  
  function placeV(x,z,ry){
    const plotKey = String(window._nextUnitId++); 
    registerVillaFootprint(x, z, plotKey, "3 BED VILLA");
    placeVillaGLBWithLOD(x, z, ry, plotKey);
    addVillaContactShadow(x,z); 
    collectVillaHedge(x,z,ry); 
    const fx=Math.sin(ry)*(-9),fz=Math.cos(ry)*(-9),rx=Math.cos(ry)*8,rz=-Math.sin(ry)*8;
    if(!isInNoBuildZone(x+rx+fx,z+rz+fz)) cypressPositions.push([x+rx+fx,z+rz+fz]);
    if(!isInNoBuildZone(x-rx+fx,z-rz+fz)) cypressPositions.push([x-rx+fx,z-rz+fz]);
  }
  
  // South row: west and east sides — straight villas facing north
  [-86, -108, -130, -152].forEach(x => { placeV(x, -120, 0); });
  [86, 108, 130, 152].forEach(x => { placeV(x, -120, 0); });

  for (let i = 0; i < 11; i++) {
    const t = 0.05 + (i / 10) * 0.90; 
    const x = -70 + (t * 140); 
    const z = -120 - Math.sin(t * Math.PI) * 18; 
    const rotY = Math.atan2(0 - x, -60 - z); 
    placeV(x, z, rotY);
  }

  [-75, -47, -19].forEach(z => placeV(-162, z, Math.PI / 2));
  [19, 47, 75].forEach(z => placeV(-162, z, Math.PI / 2));
  placeV(-148, 105, 3 * Math.PI / 4);

  [-75, -47, -19].forEach(z => placeV(162, z, -Math.PI / 2));
  [19, 47, 75].forEach(z => placeV(162, z, -Math.PI / 2));
  placeV(148, 105, -3 * Math.PI / 4);

  for(const side of [-1, 1]) {
    [65, 93, 121, 149].forEach(xa => {
      placeV(side * xa, 105 + xa * 0.04, 0);
    });
  }

  buildInstancedCypress(cypressPositions);
  buildAllVillaHedges();
}

function addLoftTerraces(){
  function placeLoftBlock(x, z, ry) {
    placeLoftGLB(x, z, ry, null); 
    const offsets = [-13.5, -4.5, 4.5, 13.5]; 
    const cosR = Math.cos(ry), sinR = Math.sin(ry);

    offsets.forEach(offsetX => {
      const unitX = x + offsetX * cosR;
      const unitZ = z - offsetX * sinR; 
      const key = String(window._nextUnitId++); 
      
      const hitbox = new THREE.Mesh(
        new THREE.BoxGeometry(9, 10, 16),
        new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0, depthWrite: false })
      );
      hitbox.position.set(unitX, 5, unitZ); 
      hitbox.rotation.y = ry;
      hitbox.userData = { isPlotOverlay: true, plotKey: key };
      hitbox.visible = false; // Invisible — only used for raycasting, never rendered
      scene.add(hitbox);
      
      plotRegistry.set(key, { x: unitX, z: unitZ, status: 'available', overlay: hitbox, type: "2 BED LOFT TERRACE", ry: ry });
    });
  }

  for(let x=-310; x<=-110; x+=36){ 
    placeLoftBlock(x, -162-Math.abs(x)*.05, Math.PI); 
  }
  for(let x=95; x<=310; x+=36){ 
    placeLoftBlock(x, -162-Math.abs(x)*.05, Math.PI); 
  }
  
  [-75, -45, -15].forEach(z => { placeLoftBlock(-200, z, 0); });
  [15, 45, 75, 105].forEach(z => { placeLoftBlock(-200, z, 0); });

  [-45, -15, 15, 45, 75].forEach(z => { placeLoftBlock(260, z, Math.PI); });
}

function addWestCompound() {
  s(plane(120, 185, MATS.safetyBrown(), [-320, .06, 0])); 
  // West compound grass — ground shader handles laterite/grass boundary
  
  placeAptGLB(-245, -45, Math.PI / 2); 
  placeAptGLB(-245, 45, Math.PI / 2);

  for (let i = 0; i < 24; i++) {
    const key = String(window._nextUnitId++);
    plotRegistry.set(key, { status: 'available', type: '1 BED MAISONETTE', x: -245, z: 0, isApt: true });
  }
  
  for (let i = 0; i < 48; i++) {
    const key = String(window._nextUnitId++);
    plotRegistry.set(key, { status: 'available', type: '2 BED FLAT', x: -245, z: 0, isApt: true });
  }
  
  for (let i = 0; i < 12; i++) {
    const key = String(window._nextUnitId++);
    plotRegistry.set(key, { status: 'available', type: 'STUDIO', x: -245, z: 0, isApt: true });
  }
}

function addPaddock() {
  // Paddock grass — match ground shader inner zone colour
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
  // Game park grass — ground shader handles this zone
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
  // Explicit colours — no texture dependency, no blue fallback
  const stoneBase = new THREE.MeshStandardMaterial({color:0x9a8a78,roughness:.92,metalness:0});
  const renderBody = new THREE.MeshStandardMaterial({color:0xE8E0D0,roughness:.85,metalness:0});
  const timberRoof = new THREE.MeshStandardMaterial({color:0x7a6848,roughness:.70,metalness:0});
  g.add(box(TW,3.2,11,stoneBase,[0,1.6,0]));
  g.add(box(TW,3.2,11,renderBody,[0,4.85,0]));
  g.add(box(TW+.4,.4,11.4,timberRoof,[0,6.65,0],0,false)); return g;
}

function _createFlatBlock(x,z){
  const g=new THREE.Group(); g.position.set(x,0,z);
  g.add(box(80,20,28,MATS.flatGrey(),[0,10,0])); scene.add(g); return g;
}

// ─── TICK ─────────────────────────────────────────────────────────────────────
let _tickFrame=0;
let _prevElapsed=0;

export function tickScene(elapsed, camera) {
  _tickFrame++;

  // ── a. GLASS SUN GLINT — update emissiveIntensity on glass panels ──────────
  // Every 20 frames — cheap traverse, avoids full scene walk every frame
  if (_tickFrame % 20 === 0 && scene && window._xixSunGlintIntensity !== undefined) {
    const targetGlint = window._xixSunGlintIntensity;
    scene.traverse(obj => {
      if (!obj.isMesh || !obj.userData.isGlassPanel) return;
      const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      if (mat && mat.emissiveIntensity !== undefined) {
        // Smooth lerp toward target — no harsh snap when time changes
        mat.emissiveIntensity += (targetGlint - mat.emissiveIntensity) * 0.05;
        mat.needsUpdate = false; // emissiveIntensity is a uniform, no rebuild needed
      }
    });
  }

  // ── b. POLO FIELD SHADER UNIFORMS ────────────────────────────────────────
  if (window._xixFieldMat) {
    const u = window._xixFieldMat.uniforms;
    u.uTime.value  = elapsed;
    u.uSheen.value    = (PERF_MODE === 'fast') ? 0.0 : 1.0;
    u.uBladeStr.value = (PERF_MODE === 'fast') ? 0.0 : 1.0;
    // Sync sun direction and colour from the live sun light
    if (sunLight) {
      u.uSunColor.value.copy(sunLight.color);
      u.uSunDir.value.copy(sunLight.position).normalize();
    }
    // Wetness from weather state (set by app.js via window._xixWetness)
    if (window._xixWetness !== undefined) {
      u.uWetness.value += (window._xixWetness - u.uWetness.value) * 0.04;
    }
  }

  // ── b. CAMERA-FOLLOWING SHADOW FRUSTUM (Balanced/Rich, every 30 frames) ──
  // Keeps shadows sharp around the player instead of across the whole 760m estate.
  // Uses lerp to avoid any visible shadow pop between updates.
  if (sunLight && sunLight.castShadow && camera && _tickFrame % 30 === 0) {
    const cam  = sunLight.shadow.camera;
    const px   = camera.position.x;
    const pz   = camera.position.z;
    const half = PERF_MODE === 'rich' ? 120 : 100;
    const L = 0.06; // lerp factor — smooth drift, no snap
    cam.left   += (px - half - cam.left)   * L;
    cam.right  += (px + half - cam.right)  * L;
    cam.bottom += (pz - half - cam.bottom) * L;
    cam.top    += (pz + half - cam.top)    * L;
    cam.updateProjectionMatrix();
  }

  // ── c. WET ROAD SPECULAR (every 12 frames) ──────────────────────────────
  if (window._xixRoadMat && _tickFrame % 12 === 0 && window._xixWetness !== undefined) {
    const wetness = window._xixWetness ?? 0;
    const rm = window._xixRoadMat;
    // Wet roads: roughness drops from 0.92 (dry) to 0.18 (soaked) — mirror-like puddles
    rm.roughness       = 0.92 - wetness * 0.74;
    rm.metalness       = wetness * 0.12;     // slight metallic sheen when wet
    rm.envMapIntensity = wetness * 1.8;      // strong sky reflection in puddles
    rm.needsUpdate     = false;              // uniforms only, no shader rebuild
  }

  // ── d. GROUND UNIFORMS ───────────────────────────────────────────────────
  if (window._xixGroundMat && _tickFrame % 4 === 0) {
    const gu = window._xixGroundMat.uniforms;
    gu.uTime.value = elapsed;
    if (sunLight) {
      gu.uSunDir.value.copy(sunLight.position).normalize();
      gu.uSunColor.value.copy(sunLight.color);
    }
  }

  // ── d. WATER UNIFORMS ────────────────────────────────────────────────────
  if (window._xixLakeMat) {
    const lu = window._xixLakeMat.uniforms;
    lu.uTime.value = elapsed;
    lu.uPerfMode.value = PERF_MODE === 'fast' ? 0.0 : 1.0;
    // Sync wetness from weather system
    if (window._xixWetness !== undefined) {
      lu.uWetness.value += (window._xixWetness - lu.uWetness.value) * 0.03;
    }
    // Sync sun direction and colour from live sun light
    if (sunLight) {
      lu.uSunDir.value.copy(sunLight.position).normalize();
      lu.uSunColor.value.copy(sunLight.color);
    }
    // Sync sky colour from current fog colour (proxy for sky horizon colour)
    if (scene && scene.fog) {
      lu.uSkyColor.value.copy(scene.fog.color);
    }
  }

  // Existing Three.js Water tick (for east lake — uses createWaterMat)
  tickWater(waterMeshes.filter(m => !m.userData.isLakeGLSL), elapsed);

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
  
  if (window._xixHoverState) {
    const old = plotRegistry.get(window._xixHoverState);
    if (old && old.villaClone && old.status !== 'reserved') {
      old.villaClone.traverse(c => {
        if (c.isMesh && c.userData.origMat) {
          c.material = c.userData.origMat; 
          c.userData.origMat = null;
        }
      });
    }
  }
  
  window._xixHoverState = plotKey;
  
  if (window._xixHoverState) {
    const cur = plotRegistry.get(window._xixHoverState);
    if (cur && cur.villaClone && cur.status !== 'reserved') {
      cur.villaClone.traverse(c => {
        if (c.isMesh) {
          if (!c.userData.origMat) c.userData.origMat = c.material;
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
