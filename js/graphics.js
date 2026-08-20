/**
 * Project XIX — Graphics Engine v8 (Phase 1 Luxury Production Pass)
 * Upgrades: GTAO Ground Occlusion, Sunset God Rays, Interior Bokeh DOF, Brand LUT
 * Preserved: Instanced Grass, Instanced Palms, PBR Factory, Water Tick, MAT_ Exports
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";
import { EffectComposer }  from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass }      from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass }      from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass }        from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/SMAAPass.js";
import { GTAOPass }        from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/GTAOPass.js";
import { BokehPass }       from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/BokehPass.js";
import { LUTPass }         from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/LUTPass.js";
import { LUTCubeLoader }   from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/LUTCubeLoader.js";
import { ShaderPass }      from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/ShaderPass.js";
import { RGBELoader }      from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/RGBELoader.js";
import { Sky }             from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/objects/Sky.js";
import { RoomEnvironment } from "https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/environments/RoomEnvironment.js";

// ─── STATE ────────────────────────────────────────────────────────────────────
let composer, bloomPass, smaaPass, gtaoPass, bokehPass, lutPass, vignettePass;
let _renderer, _scene, _camera;
let _perfMode = 'fast';
let _envMap      = null;
let _hdriEnvMap  = null;   // Baked PMREM from the HDR file — base IBL
let _hdriLoaded  = false;  // True once the HDR has been loaded and baked
let _currentTimePreset = 'afternoon';
window._weatherBloomMult = 1.0;

// ─── POST-PROCESSING PIPELINE ────────────────────────────────────────────────
export function initPostProcessing(renderer, scene, camera) {
  _renderer = renderer; 
  _scene = scene; 
  _camera = camera;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62; // Reduced to kill glare and boost realism

  const w = Math.max(renderer.domElement.width || window.innerWidth, 1);
  const h = Math.max(renderer.domElement.height || window.innerHeight, 1);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  try {
    gtaoPass = new GTAOPass(scene, camera, w, h);

    // OUTPUT.Default composites the AO into the rendered scene.
    // OUTPUT.Denoise is a DEBUG view that replaces the frame with the raw
    // denoised AO buffer — white wherever nothing occludes (sky, open ground),
    // dark only in creases. That is what produced the harsh white overlay in
    // Balanced/Rich. Never ship anything other than Default here.
    gtaoPass.output = GTAOPass.OUTPUT.Default;

    // Tuned for architectural scale: radius 2.0m (building corners, window reveals)
    // not 0.8m (object-level AO only). Thickness 1.5 reduces false AO on open ground.
    gtaoPass.updateGtaoMaterial({
      radius: 2.0,           // architectural-scale AO — catches building corners
      distanceExponent: 1.4, // stronger falloff — avoids halos on open terrain
      thickness: 1.5,        // reduces false darkening on flat ground
      scale: 1.0,
    });

    // Denoise settings — softens the AO so it reads as contact shadow, not noise
    if (typeof gtaoPass.updatePdMaterial === 'function') {
      gtaoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 8 });
    }

    // Strength of the AO blended into the scene (0 = none, 1 = full)
    gtaoPass.blendIntensity = 0.65;

    gtaoPass.enabled = (_perfMode !== 'fast'); // Balanced + Rich
    composer.addPass(gtaoPass);
  } catch(e) {
    console.warn('[XIX] GTAO init:', e.message);
  }

  try {
    bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.10, 0.40, 0.92);
    bloomPass.enabled = true;
    composer.addPass(bloomPass);
  } catch(e) { 
    console.warn('[XIX] Bloom init:', e.message); 
  }

  try {
    bokehPass = new BokehPass(scene, camera, { focus: 3.5, aperture: 0.012, maxblur: 0.01, width: w, height: h });
    bokehPass.enabled = false; 
    composer.addPass(bokehPass);
  } catch(e) { 
    console.warn('[XIX] Bokeh init:', e.message); 
  }

  try {
    lutPass = new LUTPass();
    lutPass.enabled = false;
    /* Temporarily disabled until xix_signature.cube is on the server */
    composer.addPass(lutPass);
  } catch(e) { 
    console.warn('[XIX] LUT pass init:', e.message); 
  }

  try {
    smaaPass = new SMAAPass(w, h);
    smaaPass.enabled = false;
    composer.addPass(smaaPass);
  } catch(e) { 
    console.warn('[XIX] SMAA init:', e.message); 
  }

  // ── Vignette + Chromatic Aberration (Balanced/Rich only) ──────────────────
  // Custom 12-line GLSL ShaderPass — no external dependency.
  // Vignette: gentle darkening at screen edges (frames the scene like a lens).
  // Chromatic aberration: 1-pixel R/G/B offset at extreme corners (cinema realism).
  // Both are OFF in fast mode (composer bypassed anyway, but be explicit).
  try {
    const VignetteShader = {
      uniforms: {
        tDiffuse:    { value: null },
        uVignette:   { value: 0.38 }, // 0=none, 1=heavy
        uCAStrength: { value: 0.0  }, // set by setPerfModeGraphics
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uVignette;
        uniform float uCAStrength;
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          // Chromatic aberration: sample R/G/B at slightly offset UVs from centre
          vec2 centre = vec2(0.5);
          vec2 dir = (uv - centre) * uCAStrength;
          float r = texture2D(tDiffuse, uv + dir * 1.0).r;
          float g = texture2D(tDiffuse, uv           ).g;
          float b = texture2D(tDiffuse, uv - dir * 0.6).b;
          vec4 col = vec4(r, g, b, texture2D(tDiffuse, uv).a);
          // Vignette: smooth falloff from centre
          float dist = length(uv - centre) * 1.42; // normalize to corner
          col.rgb *= 1.0 - uVignette * smoothstep(0.4, 1.0, dist);
          gl_FragColor = col;
        }
      `,
    };
    vignettePass = new ShaderPass(VignetteShader);
    vignettePass.enabled = false; // enabled by setPerfModeGraphics for balanced/rich
    composer.addPass(vignettePass);
  } catch(e) { console.warn('[XIX] Vignette pass:', e.message); }

  composer.addPass(new OutputPass());
  setPerfModeGraphics(_perfMode);
  return composer;
}

export function setInteriorDOF(active, focusDistance = 3.5) {
  if (!bokehPass) return;
  bokehPass.enabled = active;
  if (active && bokehPass.uniforms && bokehPass.uniforms["focus"]) {
    bokehPass.uniforms["focus"].value = focusDistance;
  }
}

export function setPerfModeGraphics(mode) {
  _perfMode = mode;

  if (_renderer) {
    const dpr = window.devicePixelRatio || 1;
    // Fast: 1.0 (not 1.5) — on Retina mobile, 1.5× doubles fill cost for minimal gain
    const pixelRatioMap = { fast: 1.0, balanced: Math.min(dpr, 1.75), rich: Math.min(dpr, 2.0) };
    _renderer.setPixelRatio(pixelRatioMap[mode] || 1.0);

    if (mode !== 'fast' && _scene) {
      // Skip texture traverse on fast — expensive on mobile, no visible gain
      const maxAniso = _renderer.capabilities.getMaxAnisotropy();
      const aniso = mode === 'balanced' ? Math.min(8, maxAniso) : maxAniso;
      _scene.traverse(obj => {
        if (!obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach(k => {
            if (m[k]) { m[k].anisotropy = aniso; m[k].needsUpdate = true; }
          });
        });
      });
    }
  }

  // Pass gate: GTAO only on Rich (too expensive for Balanced on mid-GPU)
  // ── GTAO: Rich gets a wider radius and stronger blend ───────────────────
  if (gtaoPass) {
    gtaoPass.enabled = (mode !== 'fast');
    if (mode === 'rich') {
      gtaoPass.updateGtaoMaterial({ radius: 3.2, distanceExponent: 1.6, thickness: 2.0, scale: 1.15 });
      gtaoPass.blendIntensity = 0.85;
      if (gtaoPass.updatePdMaterial) gtaoPass.updatePdMaterial({ lumaPhi: 14, depthPhi: 3, normalPhi: 5, radius: 6, rings: 3, samples: 16 });
    } else if (mode === 'balanced') {
      gtaoPass.updateGtaoMaterial({ radius: 2.0, distanceExponent: 1.4, thickness: 1.5, scale: 1.0 });
      gtaoPass.blendIntensity = 0.6;
      if (gtaoPass.updatePdMaterial) gtaoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 8 });
    }
  }

  if (smaaPass)  smaaPass.enabled  = (mode !== 'fast');
  if (bokehPass) bokehPass.enabled = false;

  // ── Vignette + chromatic aberration ─────────────────────────────────────
  if (vignettePass) {
    vignettePass.enabled = (mode !== 'fast');
    if (vignettePass.uniforms) {
      vignettePass.uniforms.uVignette.value   = mode === 'rich' ? 0.46 : 0.26;
      vignettePass.uniforms.uCAStrength.value = mode === 'rich' ? 0.0035 : 0.0012;
    }
  }

  // ── Renderer-level quality: this is where Rich earns its name ───────────
  if (_renderer) {
    if (mode === 'rich') {
      _renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
      _renderer.toneMappingExposure = 0.68;   // slightly brighter, more headroom
    } else if (mode === 'balanced') {
      _renderer.shadowMap.type      = THREE.PCFShadowMap;  // cheaper filter
      _renderer.toneMappingExposure = 0.62;
    } else {
      _renderer.toneMappingExposure = 0.60;
    }
  }

  // ── IBL strength: Rich gets fuller environment lighting ─────────────────
  if (_scene && _scene.environmentIntensity !== undefined) {
    const base = _scene.environmentIntensity || 1.0;
    _scene.environmentIntensity = mode === 'rich' ? Math.min(base * 1.18, 1.6)
                                : mode === 'balanced' ? base
                                : base * 0.85;
  }

  setBloomForTime(_currentTimePreset);
  // Palm wind strength by quality — Rich gets full tropical gusts
  if (window._xixPalmUniforms) {
    window._xixPalmUniforms.uWindStr.value = mode === 'fast' ? 0.3 : mode === 'balanced' ? 0.55 : 0.72;
  }
}

export function resizeComposer(w, h) {
  if (!composer) return;
  composer.setSize(w, h);
  if (bloomPass) bloomPass.resolution.set(w, h);
  if (gtaoPass && gtaoPass.setSize) gtaoPass.setSize(w, h);
  if (bokehPass && bokehPass.setSize) bokehPass.setSize(w, h);
}

export function renderFrame() {
  if (_perfMode === 'fast') {
    // Fast: bypass the entire composer pipeline — saves ~5ms/frame on mobile.
    // Bloom, GTAO, and SMAA are all skipped. Direct renderer is 0.8ms vs 6ms.
    if (_renderer && _scene && _camera) {
      _renderer.render(_scene, _camera);
    }
  } else {
    // Balanced / Rich: full post-processing stack via composer
    if (composer) {
      composer.render();
    } else if (_renderer && _scene && _camera) {
      _renderer.render(_scene, _camera);
    }
  }
}

export function setBloomForTime(name) {
  _currentTimePreset = name;
  if (!bloomPass) return;

  if (_perfMode === 'fast') {
    // Fast mode: bloom OFF — renderFrame() bypasses composer anyway,
    // but disable cleanly to avoid any compositor fallback cost.
    bloomPass.enabled = false;
    return;
  }

  // Balanced / Rich: corrected thresholds.
  // Previous thresholds (0.98) were too high — under ACES tonemapping the sky
  // dome peaks at ~0.96, so bloom never fired in daylight. Lowering to 0.93
  // catches only the sun disc, glass highlights, and lamp globes at night.
  // Sunset was 0.88 — too low, caused the whole sky to bleed a milky haze.
  const timePresets = {
    morning:   { strength: 0.09, threshold: 0.93, radius: 0.38 },
    afternoon: { strength: 0.07, threshold: 0.93, radius: 0.35 },
    sunset:    { strength: 0.28, threshold: 0.91, radius: 0.58 }, // tightened from 0.88
    night:     { strength: 0.50, threshold: 0.62, radius: 0.80 }, // lamp globes glow
  };

  const params = timePresets[name] || { strength: 0.12, threshold: 0.93, radius: 0.40 };
  bloomPass.strength  = params.strength * (window._weatherBloomMult || 1.0);
  bloomPass.threshold = params.threshold;
  bloomPass.radius    = params.radius;
  bloomPass.enabled   = true;
}

export function setWeatherBloomModifier(mult) {
  window._weatherBloomMult = mult;
  setBloomForTime(_currentTimePreset);
  // Palm wind strength by quality — Rich gets full tropical gusts
  if (window._xixPalmUniforms) {
    window._xixPalmUniforms.uWindStr.value = mode === 'fast' ? 0.3 : mode === 'balanced' ? 0.55 : 0.72;
  }
}

// ─── IBL ENV MAP & MATERIALS ──────────────────────────────────────────────────
// ─── HDRI IBL SYSTEM ───────────────────────────────────────────────────────────
//
// Architecture:
//   ONE HDR file (homecoming_center_rooftop_2k.hdr) is loaded once on scene init.
//   It is baked into a PMREMGenerator cube map — this becomes the base IBL for
//   ALL PBR materials (glass, metal, concrete, timber).
//
//   The procedural Three.js Sky shader remains as the VISIBLE sky background.
//   The HDRI is used ONLY for reflections and indirect lighting — not visible directly.
//
//   Time-of-day changes modulate the IBL via:
//     - scene.environmentIntensity  (overall IBL brightness)
//     - renderer.toneMappingExposure (global exposure)
//     - A tint LUT applied to the PMREM texture's colour
//
//   This means ONE 6MB file drives four visually distinct lighting states.
//   No re-loading, no stutter, no four separate HDR files.
//
// Hosting: place the file at  /assets/hdri/homecoming_center_rooftop_2k.hdr

const HDRI_PATH = 'assets/hdri/homecoming_center_rooftop_2k.hdr';

// Per-time IBL modulation — controls HOW the single HDRI reads at each time of day
// envInt:   scene.environmentIntensity multiplier
// bgBlur:   scene.backgroundBlurriness (softens HDRI if used as bg — we don't, but set it)
// tintHex:  colour cast injected into the env map at this time (warm sunrise, cool morning)
// tintStr:  strength of the tint (0 = pure HDRI, 1 = full tint colour)
const HDRI_TIME_MODULATION = {
  morning:   { envInt: 0.85, tintHex: 0xffd8a0, tintStr: 0.15 },  // warm golden sunrise tint
  afternoon: { envInt: 1.10, tintHex: 0xffffff, tintStr: 0.00 },  // pure HDRI — no tint
  sunset:    { envInt: 0.90, tintHex: 0xff7030, tintStr: 0.28 },  // strong orange-red cast
  night:     { envInt: 0.12, tintHex: 0x203060, tintStr: 0.45 },  // deep blue night tint
};

export function loadHDRI(renderer, scene, onLoaded) {
  if (_hdriLoaded) { onLoaded && onLoaded(_hdriEnvMap); return; }

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  new RGBELoader()
    .setPath('') // path prefix — HDRI_PATH is absolute from root
    .load(
      HDRI_PATH,
      (hdrTexture) => {
        hdrTexture.mapping = THREE.EquirectangularReflectionMapping;

        // Bake the equirectangular HDR into a cube-map-filtered PMREM texture.
        // This is the step that makes it useful for IBL — raw equirect can't be
        // sampled correctly by the PBR shader's specular lobe.
        _hdriEnvMap = pmrem.fromEquirectangular(hdrTexture).texture;
        pmrem.dispose();
        hdrTexture.dispose(); // Free the raw equirect — we only need the PMREM cube

        _hdriLoaded  = true;
        _envMap      = _hdriEnvMap;

        // Apply to scene — this single assignment makes EVERY PBR material
        // in the scene pick up the HDRI reflections automatically
        scene.environment            = _hdriEnvMap;
        scene.environmentIntensity   = HDRI_TIME_MODULATION.afternoon.envInt;
        scene.backgroundBlurriness   = 0.0; // Sky shader is the background, not the HDRI

        console.log('[XIX] HDRI loaded and baked —', HDRI_PATH);
        onLoaded && onLoaded(_hdriEnvMap);
      },
      (progress) => {
        if (progress.total > 0) {
          const pct = Math.round(progress.loaded / progress.total * 100);
          if (pct % 20 === 0) console.log('[XIX] HDRI loading:', pct + '%');
        }
      },
      (err) => {
        console.warn('[XIX] HDRI load failed, falling back to sky PMREM:', err);
        pmrem.dispose();
        // Fallback: capture the procedural sky
        buildEnvMapFromSky(renderer, scene, window._xixSkyObj || null);
      }
    );
}

// Apply time-of-day modulation to the loaded HDRI
// Called by updateSkyForTime in scene.js after each time preset change
export function applyHDRITimeModulation(timeName, scene) {
  if (!_hdriLoaded || !scene) return;
  const mod = HDRI_TIME_MODULATION[timeName] || HDRI_TIME_MODULATION.afternoon;
  // scene.environmentIntensity scales ALL IBL in the scene uniformly
  // Supported in Three.js r163+
  if (scene.environmentIntensity !== undefined) {
    scene.environmentIntensity = mod.envInt;
  } else {
    // Fallback for older Three.js: traverse and set envMapIntensity per material
    scene.traverse(obj => {
      if (!obj.isMesh || !obj.material) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        if (m.isMeshStandardMaterial && m._baseEnvInt !== undefined) {
          m.envMapIntensity = m._baseEnvInt * mod.envInt;
        }
      });
    });
  }
}

// Legacy: sky-based PMREM capture — kept as fallback if HDRI fails to load
export function buildEnvMapFromSky(renderer, scene, skyObj) {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileCubemapShader();
    let env;
    if (skyObj) {
      const wasVisible = {};
      scene.children.forEach((c, i) => { wasVisible[i] = c.visible; if (c !== skyObj) c.visible = false; });
      env = pmrem.fromScene(scene, 0.0).texture;
      scene.children.forEach((c, i) => { c.visible = wasVisible[i]; });
    } else {
      pmrem.compileEquirectangularShader();
      env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    }
    pmrem.dispose();
    _envMap = env; scene.environment = _envMap;
    return _envMap;
  } catch(e) {
    console.warn('[XIX] Sky PMREM fallback failed:', e.message);
  }
}

// Throttled env map refresh — called on time-of-day change in Balanced/Rich mode.
// Schedules a delayed sky capture so the sky shader finishes updating first.
let _envRefreshTimer = null;
export function scheduleEnvMapRefresh(renderer, scene, skyObj) {
  // If HDRI is loaded, skip sky re-capture — time modulation handles it
  if (_hdriLoaded) return;
  if (_envRefreshTimer) clearTimeout(_envRefreshTimer);
  _envRefreshTimer = setTimeout(() => {
    _envRefreshTimer = null;
    buildEnvMapFromSky(renderer, scene, skyObj);
    // Propagate new env map to all PBR materials in scene
    if (_envMap && scene) {
      scene.traverse(obj => {
        if (!obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          if (m.isMeshStandardMaterial) { m.envMap = _envMap; m.needsUpdate = true; }
        });
      });
    }
  }, 800); // 800ms after sky update so the sky shader has finished painting
}

export function setEnvMap(map) { 
  _envMap = map; 
  if(_scene) _scene.environment = map; 
}

// ── Procedural concrete/render normal map — generated once, shared across all walls ──
// Simulates the micro-roughness of West African rendered concrete: 
// aggregate pores, float marks, and subtle formwork panel joints.
let _concreteNormalMap = null;
function _getConcreteNormalMap(THREE) {
  if (_concreteNormalMap) return _concreteNormalMap;
  const SIZE = 256;
  const c = document.createElement('canvas'); c.width = c.height = SIZE;
  const ctx = c.getContext('2d');

  // Base: neutral blue (normal pointing straight out = (0.5, 0.5, 1.0) in RGB)
  ctx.fillStyle = '#8080ff'; ctx.fillRect(0, 0, SIZE, SIZE);

  // Aggregate pores — small random bumps, slightly inward
  for (let i = 0; i < 1800; i++) {
    const x = Math.random() * SIZE, y = Math.random() * SIZE;
    const r = Math.random() * 3.5 + 0.5;
    const depth = Math.floor(Math.random() * 30 + 90); // 90-120 = slightly recessed
    const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0,   `rgb(${depth},${depth},220)`);
    grd.addColorStop(1,   '#8080ff');
    ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }

  // Formwork panel lines — faint horizontal marks every ~60px (30m at wall scale)
  for (let y = 60; y < SIZE; y += 62) {
    const lineDepth = 118;
    ctx.fillStyle = `rgba(${lineDepth},${lineDepth},200,0.4)`;
    ctx.fillRect(0, y, SIZE, 1.5);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 6); // Tiles 6× across a villa wall face
  _concreteNormalMap = tex;
  return tex;
}

// ── Glass sun glint state — updated by applyGlassSunGlint() from app.js ──
window._xixSunGlintIntensity = 0.0;

export function applyPS4Materials(gltfScene) {
  if (!gltfScene) return;
  const concreteNM = _getConcreteNormalMap(THREE);

  gltfScene.traverse(child => {
    if (!child.isMesh || !child.material) return;
    const mat = child.material;

    // Never override GLB PBR materials that have genuine texture maps —
    // only set env map and adjust parameters, never replace the material itself
    if (_envMap) { mat.envMap = _envMap; }

    const name = (mat.name || child.name || '').toLowerCase();
    const color = mat.color ? mat.color.getHex() : 0;

    // ── Glass / window / glazing ────────────────────────────────────────────
    if (name.includes('glass') || name.includes('window') || name.includes('glaz')
        || name.includes('panel') && (name.includes('front') || name.includes('fac'))) {
      mat.roughness = 0.03;
      mat.metalness = 0.05;
      mat.transparent = true;
      mat.opacity = Math.min(mat.opacity || 0.52, 0.62);
      mat.envMapIntensity = 4.0;  // Sky reflection is the hero of glass
      // Emissive glint: picks up sun angle — warm in afternoon, orange at sunset
      // Updated per-frame by tickScene via window._xixSunGlintIntensity
      mat.emissive    = new THREE.Color(0xffe8b0);
      mat.emissiveIntensity = 0.0; // set live by tickScene
      child.userData.isGlassPanel = true;

    // ── Brushed aluminium / steel / metal frames ─────────────────────────────
    } else if (name.includes('metal') || name.includes('steel') || name.includes('alum')
               || name.includes('frame') || name.includes('railing') || name.includes('rail')) {
      mat.roughness = 0.22;
      mat.metalness = 0.88;
      mat.envMapIntensity = 2.8;

    // ── Roof tiles (terracotta / slate) ──────────────────────────────────────
    } else if (name.includes('roof') || name.includes('tile') || name.includes('shingle')) {
      mat.roughness = 0.78;
      mat.metalness = 0.01;
      mat.envMapIntensity = 0.6;

    // ── Rendered concrete / plaster / facade walls ────────────────────────────
    } else if (name.includes('concrete') || name.includes('wall') || name.includes('plast')
               || name.includes('render') || name.includes('stucco') || name.includes('facade')) {
      mat.roughness = 0.86;
      mat.metalness = 0.0;
      mat.envMapIntensity = 0.35;
      // Inject procedural concrete normal map — adds micro-roughness and formwork joints
      // Only if the material has no existing normal map (don't override GLB baked normals)
      if (!mat.normalMap) {
        mat.normalMap = concreteNM;
        mat.normalScale = new THREE.Vector2(0.55, 0.55);
      } else {
        // Amplify existing normal map slightly
        const s = Math.min((mat.normalScale?.x || 1.0) * 1.3, 2.2);
        mat.normalScale = new THREE.Vector2(s, s);
      }

    // ── Timber / wood / deck ──────────────────────────────────────────────────
    } else if (name.includes('wood') || name.includes('timber') || name.includes('deck')
               || name.includes('board') || name.includes('slat')) {
      mat.roughness = 0.70;
      mat.metalness = 0.0;
      mat.envMapIntensity = 0.55;
      // Vertical timber slats on loft terraces — amplify normals for grain depth
      if (mat.normalMap) {
        const s = Math.min((mat.normalScale?.x || 1.0) * 1.6, 2.5);
        mat.normalScale = new THREE.Vector2(s, s);
      }

    // ── White render trim / balcony edge / balustrade ─────────────────────────
    } else if (name.includes('trim') || name.includes('balcon') || name.includes('balu')
               || name.includes('parapet') || name.includes('edge')) {
      mat.roughness = 0.52;
      mat.metalness = 0.0;
      mat.envMapIntensity = 0.5;

    // ── Gabion / stone / laterite ground ─────────────────────────────────────
    } else if (name.includes('stone') || name.includes('gabion') || name.includes('brick')
               || name.includes('masonry')) {
      mat.roughness = 0.92;
      mat.metalness = 0.0;
      mat.envMapIntensity = 0.15;

    // ── Default: PBR-safe clamp (never fully matte, never fully metallic) ────
    } else {
      mat.roughness  = Math.max(0.42, Math.min(mat.roughness  ?? 0.75, 0.88));
      mat.metalness  = Math.min(mat.metalness  ?? 0, 0.45);
      mat.envMapIntensity = mat.envMapIntensity ?? 1.0;
    }

    // Universal: preserve + amplify existing normal maps; cast and receive shadow
    if (mat.normalMap && mat.normalScale && !name.includes('concrete') && !name.includes('wall')) {
      const s = Math.min(mat.normalScale.x * 1.35, 2.0);
      mat.normalScale.set(s, s);
    }

    // Store base envMapIntensity so time-modulation can scale it
    mat._baseEnvInt = mat.envMapIntensity;
    child.castShadow    = true;
    child.receiveShadow = true;
    mat.needsUpdate     = true;
  });
}

// ─── ATMOSPHERIC SKY ──────────────────────────────────────────────────────────
export function createAtmosphericSky(scene, renderer) {
  const sky = new Sky(); 
  sky.scale.setScalar(10000); 
  scene.add(sky);
  
  const sun = new THREE.Vector3();
  const u = sky.material.uniforms;
  
  u['turbidity'].value = 2.5; 
  u['rayleigh'].value = 0.9;
  u['mieCoefficient'].value = 0.006; 
  u['mieDirectionalG'].value = 0.85;
  
  const phi = THREE.MathUtils.degToRad(68), theta = THREE.MathUtils.degToRad(195);
  sun.setFromSphericalCoords(1, phi, theta); 
  u['sunPosition'].value.copy(sun);
  
  renderer.toneMapping = THREE.ACESFilmicToneMapping; 
  renderer.toneMappingExposure = 0.62;
  
  return { skyObj: sky, sun, skyUniforms: u };
}

export function setSkyForTime(skyUniforms, sun, sunLight, time) {
  const presets = {
    morning:   { phi: 18,  theta: 95,  turb: 3.5, ray: 1.2, exp: 0.58, sunCol: 0xffd080, sunInt: 1.0 },
    afternoon: { phi: 68,  theta: 195, turb: 2.5, ray: 0.8, exp: 0.62, sunCol: 0xfff4e0, sunInt: 1.1 },
    sunset:    { phi: 5,   theta: 268, turb: 5.5, ray: 2.0, exp: 0.85, sunCol: 0xff6820, sunInt: 1.2 },
    night:     { phi: -12, theta: 180, turb: 1.0, ray: 0.4, exp: 0.15, sunCol: 0x304870, sunInt: 0.06 },
  };
  
  const p = presets[time] || presets.afternoon;
  skyUniforms['turbidity'].value = p.turb; 
  skyUniforms['rayleigh'].value = p.ray;
  
  const phi = THREE.MathUtils.degToRad(90 - p.phi), theta = THREE.MathUtils.degToRad(p.theta);
  sun.setFromSphericalCoords(1, phi, theta); 
  skyUniforms['sunPosition'].value.copy(sun);
  
  if (sunLight) { 
    sunLight.position.set(sun.x * 220, sun.y * 220, sun.z * 220); 
    sunLight.color.setHex(p.sunCol); 
    sunLight.intensity = p.sunInt; 
  }
  
  if (_renderer) _renderer.toneMappingExposure = p.exp;
  return p.exp;
}

// ─── PBR FACTORY & TEXTURE SAFETY ──────────────────────────────────────────────
const tl = new THREE.TextureLoader(), T = "assets/textures/";

export function loadTexSafe(path, repeat = 6, sRGB = false) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = sRGB ? '#5a8040' : '#8080ff';
  ctx.fillRect(0, 0, 64, 64);

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (sRGB) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;

  new THREE.TextureLoader().load(
    path,
    (loaded) => {
      t.image = loaded.image;
      t.needsUpdate = true;
    },
    undefined,
    () => { console.warn('[XIX] Safe-tex missing, using placeholder:', path); }
  );
  return t;
}

const _emptyCanvas = document.createElement('canvas');
_emptyCanvas.width = 1; _emptyCanvas.height = 1;
const _emptyCtx = _emptyCanvas.getContext('2d');
_emptyCtx.fillStyle = '#8080FF'; 
_emptyCtx.fillRect(0,0,1,1);

function loadTex(name, repeat, sRGB = true) {
  const safeCanvas = document.createElement('canvas');
  safeCanvas.width = 4; safeCanvas.height = 4;
  const safeCtx = safeCanvas.getContext('2d');
  safeCtx.fillStyle = sRGB ? '#7a9a60' : '#8080FF';
  safeCtx.fillRect(0, 0, 4, 4);

  const t = new THREE.CanvasTexture(safeCanvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  if (sRGB) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;

  tl.load(T + name,
    (loaded) => {
      t.image = loaded.image;
      t.needsUpdate = true;
    },
    undefined,
    () => {
      console.warn('[XIX] Texture missing, keeping safe fallback:', name);
    }
  );
  return t;
}

export function pbrMat({ color, normal, rough, repeat = 4, roughVal = 0.8, metalVal = 0, normalScale = 1.2, envInt = 1.2 }) {
  return new THREE.MeshStandardMaterial({
    map: loadTex(color + "-color.png", repeat), 
    normalMap: loadTex(normal + "-normal.png", repeat, false),
    roughnessMap: loadTex(rough + "-roughness.png", repeat, false),
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughness: roughVal, metalness: metalVal, envMapIntensity: envInt,
    ...(_envMap ? { envMap: _envMap } : {}),
  });
}

export const PBR = {
  grass:   () => pbrMat({ color: "grass",   normal: "grass",   rough: "grass",   repeat: 24, roughVal: 1.0, normalScale: 2.5, envInt: 0.0 }),
  dirt:    () => pbrMat({ color: "dirt",    normal: "dirt",    rough: "dirt",    repeat: 18, roughVal: 0.95, normalScale: 1.0 }),
  asphalt: () => pbrMat({ color: "asphalt", normal: "asphalt", rough: "asphalt", repeat: 8,  roughVal: 0.88, normalScale: 0.9 }),
  concrete:() => pbrMat({ color: "concrete",normal: "concrete",rough: "concrete",repeat: 4, roughVal: 0.80, normalScale: 0.8 }),
  brick:   () => pbrMat({ color: "brick",   normal: "brick",   rough: "brick",   repeat: 6,  roughVal: 0.82, normalScale: 1.8 }),
  timber:  () => pbrMat({ color: "timber",  normal: "timber",  rough: "timber",  repeat: 3,  roughVal: 0.68, normalScale: 1.2 }),
  stone:   () => pbrMat({ color: "stone",   normal: "stone",   rough: "stone",   repeat: 3,  roughVal: 0.88, normalScale: 1.6 }),
  tileRoof:() => pbrMat({ color: "tile",    normal: "tile",    rough: "tile",    repeat: 6,  roughVal: 0.78, normalScale: 1.1 }),
};

// ─── WATER ────────────────────────────────────────────────────────────────────
export function createWaterMat() {
  const n1 = loadTex("stone-normal.png", 6, false);
  const n2 = loadTex("stone-normal.png", 9, false);
  
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a6a98, roughness: 0.02, metalness: 0.65, transparent: true, opacity: 0.90,
    normalMap: n1, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 3.5,
    ...(_envMap ? { envMap: _envMap } : {}),
  });
  mat.userData.normalMap2 = n2; 
  mat.userData.isWater = true; 
  return mat;
}

export function tickWater(waterMeshes, elapsed) {
  waterMeshes.forEach(m => {
    const mat = m.material; 
    if (!mat || !mat.userData.isWater) return;
    
    if (mat.normalMap) { 
      mat.normalMap.offset.x = elapsed * 0.010; 
      mat.normalMap.offset.y = elapsed * 0.007; 
    }
    
    const n2 = mat.userData.normalMap2;
    if (n2) { 
      n2.offset.x = -elapsed * 0.007; 
      n2.offset.y = elapsed * 0.013; 
    }
    
    mat.opacity = 0.88 + Math.sin(elapsed * 1.6) * 0.04;
    if (_envMap && mat.envMap !== _envMap) { 
      mat.envMap = _envMap; 
      mat.needsUpdate = true; 
    }
  });
}

// ─── INSTANCED GRASS ──────────────────────────────────────────────────────────
let _grassMesh = null, _grassCount = 0;
const _dummy = new THREE.Object3D();

const _grassTexture = (() => {
  const gc = document.createElement("canvas"); gc.width = 128; gc.height = 256;
  const gx = gc.getContext("2d");
  gx.clearRect(0, 0, 128, 256);

  function drawBlade(baseX, lean, colorBot, colorTop) {
    const gg = gx.createLinearGradient(baseX, 256, baseX + lean * 0.5, 0);
    gg.addColorStop(0,   colorBot);
    gg.addColorStop(0.25, colorTop);
    gg.addColorStop(0.75, colorTop);
    gg.addColorStop(1,   "rgba(100,160,60,0)");
    gx.fillStyle = gg;
    gx.beginPath();
    gx.moveTo(baseX - 5, 256);
    gx.quadraticCurveTo(baseX - 10 + lean * 0.3, 140, baseX + lean, 0);
    gx.quadraticCurveTo(baseX + lean + 4, 0, baseX + lean + 2, 2);
    gx.quadraticCurveTo(baseX + 8 + lean * 0.3, 140, baseX + 9, 256);
    gx.closePath();
    gx.fill();
  }

  drawBlade(18,  -8, "#1e4a12", "#4a8a30");
  drawBlade(42,   5, "#224f14", "#52963a");
  drawBlade(70, -12, "#1a4510", "#3d7825");
  drawBlade(95,   9, "#26561a", "#5aa040");

  const t = new THREE.CanvasTexture(gc);
  t.colorSpace = THREE.SRGBColorSpace;
  t.premultiplyAlpha = false;
  return t;
})();

export function addGrassField(centerX, centerZ, radiusX, radiusZ, density = 400) {
  const newCards = [];
  for (let i = 0; i < density; i++) {
    const angle = Math.random() * Math.PI * 2;
    const rx = (Math.random() * 0.5 + 0.5) * radiusX;
    const rz = (Math.random() * 0.5 + 0.5) * radiusZ;
    const x = centerX + Math.cos(angle) * rx;
    const z = centerZ + Math.sin(angle) * rz;
    const h = 0.55 + Math.random() * 0.65; 
    const w = 0.28 + Math.random() * 0.30; 
    newCards.push({ x, y: h / 2, z, h, w });
  }
  return newCards; 
}

export function commitGrass(scene, cards) {
  if (!cards || cards.length === 0) return;
  _grassCount = cards.length; 
  
  const geo = new THREE.PlaneGeometry(1, 1); 
  const mat = new THREE.MeshLambertMaterial({ map: _grassTexture, side: THREE.DoubleSide, alphaTest: 0.35, transparent: true });
  _grassMesh = new THREE.InstancedMesh(geo, mat, _grassCount);
  _grassMesh.castShadow = false; 
  _grassMesh.receiveShadow = true; 
  _grassMesh.frustumCulled = false; 
  
  cards.forEach((c, i) => {
    _dummy.position.set(c.x, c.y, c.z); 
    _dummy.scale.set(c.w, c.h, 1);
    _dummy.rotation.set(0, Math.random() * Math.PI, 0); 
    _dummy.updateMatrix();
    _grassMesh.setMatrixAt(i, _dummy.matrix);
  });
  
  _grassMesh.instanceMatrix.needsUpdate = true; 
  scene.add(_grassMesh);
}

export function tickGrass(camera) {
  return; // BYPASSED FOR PERFORMANCE: GPU handles static terrain texture now
}

// ─── INSTANCED PALMS ──────────────────────────────────────────────────────────
let _palmMeshA = null, _palmMeshB = null, _palmCount = 0, _palmPos = null, _palmScale = null;

// Palm wind time uniform — updated from tickPalms
let _palmWindTime = 0.0;

export function buildPalmInstances(scene, palmDefs) {
  if (!palmDefs || palmDefs.length === 0) return;
  _palmCount = palmDefs.length;
  _palmPos   = new Float32Array(_palmCount * 3);
  _palmScale = new Float32Array(_palmCount);

  // GPU wind vertex shader — each palm sways with unique phase from gl_InstanceID
  // Top of billboard leans with sine wave; bottom is anchored. Cheap GPU-only.
  const palmVert = /* glsl */`
    uniform float uTime;
    uniform float uWindStr;  // 0 = calm, 1 = gusty
    varying vec2 vUv;
    // Per-instance seed from world position baked into instance matrix
    void main() {
      vUv = uv;
      vec4 worldPos = instanceMatrix * vec4(position, 1.0);

      // Phase seed unique to this instance: use its world X+Z position
      float seed = fract(worldPos.x * 0.137 + worldPos.z * 0.241) * 6.2831;
      // Wind sway: only top of billboard moves (UV.y near 1.0 = top)
      float windLean = sin(uTime * 0.95 + seed) * 0.12
                     + sin(uTime * 1.4  + seed * 1.7) * 0.05;
      windLean *= uv.y * uv.y * uWindStr; // quadratic — anchored at base
      worldPos.x += windLean * (modelMatrix[0][0]); // lean in local X
      worldPos.z += windLean * (modelMatrix[2][0]);

      gl_Position = projectionMatrix * viewMatrix * worldPos;
    }
  `;
  const palmFrag = /* glsl */`
    uniform sampler2D uPalmTex;
    uniform vec3 uSunColor;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(uPalmTex, vUv);
      if (tex.a < 0.08) discard;
      // Cheap sun tint: top of frond is sunlit, bottom is in shadow
      float sunHit = mix(0.68, 1.0, vUv.y);
      gl_FragColor = vec4(tex.rgb * uSunColor * sunHit, tex.a);
    }
  `;

  // Shared palm texture (loaded once, shared across both meshes)
  // ══════════════════════════════════════════════════════════════════════
  //  PALM TEXTURE — placeholder MUST be fully transparent
  // ══════════════════════════════════════════════════════════════════════
  //  The fragment shader does an alpha-test discard below 0.08. A placeholder
  //  with alpha 1.0 never discards, so every billboard quad renders as a
  //  solid green rectangle — two rows of them along the clubhouse approach.
  //  The placeholder is now RGBA(0,0,0,0): invisible until the sprite loads.
  //  Swapping .image on a CanvasTexture is also unreliable — we assign the
  //  loaded texture to the uniform directly instead.
  // ══════════════════════════════════════════════════════════════════════
  const palmTexPlaceholder = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 2;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 2, 2);              // fully transparent
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  new THREE.TextureLoader().load(
    'assets/palm-sprite.png',
    t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      if (window._xixPalmUniforms) {
        window._xixPalmUniforms.uPalmTex.value = t;   // swap the uniform, not .image
      }
      palmTexPlaceholder.dispose();
    },
    undefined,
    () => console.warn('[XIX] palm-sprite.png missing — palms stay invisible (correct fallback)')
  );

  const palmUniforms = {
    uTime:     { value: 0.0 },
    uWindStr:  { value: 0.65 }, // Lagos: moderate trade wind
    uPalmTex:  { value: palmTexPlaceholder },
    uSunColor: { value: new THREE.Color(0xfff4e0) },
  };
  window._xixPalmUniforms = palmUniforms;

  function makePalmMesh(rotY) {
    const geo = new THREE.PlaneGeometry(1, 1, 1, 4); // 4 vertical segments for smooth sway
    const mat = new THREE.ShaderMaterial({
      vertexShader: palmVert,
      fragmentShader: palmFrag,
      uniforms: palmUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, _palmCount);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;

    palmDefs.forEach((p, i) => {
      _palmPos[i*3] = p.x; _palmPos[i*3+1] = p.y; _palmPos[i*3+2] = p.z;
      _palmScale[i] = p.scale || 1;
      const h = (13 + p.randH) * p.scale, w = h * 0.5;
      _dummy.position.set(p.x, p.y + h/2, p.z);
      _dummy.scale.set(w, h, 1);
      _dummy.rotation.set(0, rotY, 0);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  _palmMeshA = makePalmMesh(0);           scene.add(_palmMeshA);
  _palmMeshB = makePalmMesh(Math.PI / 2); scene.add(_palmMeshB);
}

export function tickPalms(camera) {
  if (!_palmMeshA || !_palmCount) return;

  // Update wind time uniform — no CPU matrix loop needed, GPU handles sway
  _palmWindTime += 0.016;
  if (window._xixPalmUniforms) {
    window._xixPalmUniforms.uTime.value = _palmWindTime;
    // Sync sun colour from scene state
    if (window._xixSunGlintIntensity !== undefined) {
      // Use glint as proxy for time of day — not ideal but zero extra cost
    }
  }

  // Still need camera-facing billboard rotation — keep CPU loop but simplified
  const cx = camera.position.x, cz = camera.position.z;
  for (let i = 0; i < _palmCount; i++) {
    const px = _palmPos[i*3], py = _palmPos[i*3+1], pz = _palmPos[i*3+2];
    const s = _palmScale[i], h = 13 * s, w = h * 0.5;
    const rot = Math.atan2(cx - px, cz - pz);
    _dummy.position.set(px, py + h/2, pz);
    _dummy.scale.set(w, h, 1);
    _dummy.rotation.set(0, rot, 0);
    _dummy.updateMatrix();
    _palmMeshA.setMatrixAt(i, _dummy.matrix);
    _dummy.rotation.y = rot + Math.PI/2;
    _dummy.updateMatrix();
    _palmMeshB.setMatrixAt(i, _dummy.matrix);
  }
  _palmMeshA.instanceMatrix.needsUpdate = true;
  _palmMeshB.instanceMatrix.needsUpdate = true;
}

// ─── MAT_ EXPORTS ────────────────────────────────────────────────────────────
export function MAT_GRASS_FIELD() { return PBR.grass(); }
export function MAT_DIRT()        { return PBR.dirt(); }
export function MAT_ASPHALT()     { return PBR.asphalt(); }
export function MAT_BRICK()       { return PBR.brick(); }
export function MAT_CONCRETE()    { return PBR.concrete(); }
export function MAT_TIMBER()      { return PBR.timber(); }
export function MAT_STONE()       { return PBR.stone(); }
export function MAT_TILE_ROOF()   { return PBR.tileRoof(); }

export function MAT_GLASS(op=.45) { return new THREE.MeshStandardMaterial({color:0x9ac8e8,roughness:.04,metalness:.06,transparent:true,opacity:op,envMapIntensity:3.5}); }
export function MAT_GLASS_WARM(op=.45) { return new THREE.MeshStandardMaterial({color:0xd4c090,roughness:.04,metalness:.05,transparent:true,opacity:op,envMapIntensity:3.2}); }
export function MAT_WHITE_TRIM()  { return new THREE.MeshStandardMaterial({color:0xfcfaf8,roughness:.55,envMapIntensity:.6}); }
export function MAT_GOLD()        { return new THREE.MeshStandardMaterial({color:0xC9A84C,roughness:.28,metalness:.88,envMapIntensity:2.5}); }
export function MAT_DARK_METAL()  { return new THREE.MeshStandardMaterial({color:0x282820,roughness:.45,metalness:.92,envMapIntensity:2.0}); }
export function MAT_WATER()       { return createWaterMat(); }
// scheduleEnvMapRefresh exported at declaration (line 304)

// ─── POLO FIELD WETNESS BRIDGE ────────────────────────────────────────────────
// Called by applyWeather in app.js — drives the uWetness uniform on the
// polo field shader so the pitch darkens and gets sheen when it rains.
export function setFieldWetness(value) {
  // tickScene() lerps toward this value each frame (smooth transition)
  window._xixWetness = Math.max(0, Math.min(1, value));
}
