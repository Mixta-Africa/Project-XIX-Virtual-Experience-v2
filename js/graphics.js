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

  // ─── GTAO: DISCRETE GPUs ONLY ──────────────────────────────────────────────
  // GTAO (ground-truth ambient occlusion) is the most expensive pass in this
  // chain by a wide margin — roughly 8ms/frame at 1080p on Intel integrated
  // graphics, which is about half of the entire 16.7ms budget for 60fps.
  // It is also the least perceptible effect at estate viewing distance: it adds
  // soft contact shadow in creases and corners, which barely reads when the
  // camera is 100m up or walking a wide boulevard.
  // On integrated GPUs we skip creating it altogether — that avoids both the
  // per-frame cost AND the depth/normal render targets it would allocate in
  // shared system memory, which is itself scarce on these machines.
  // window._xixGPUTier is set by detectGPUTier() in scene.js before this runs.
  const _gpuTier = (typeof window !== 'undefined' && window._xixGPUTier) || 'integrated';
  const _allowGTAO = (_gpuTier === 'discrete');

  if (!_allowGTAO) {
    gtaoPass = null;
    console.log(`[XIX] GTAO disabled (GPU tier: ${_gpuTier}) — reclaims ~8ms/frame`);
  } else try {
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
    lutPass.enabled = false;   // stays off until the .cube actually decodes
    composer.addPass(lutPass);

    // FGCineWarm.cube — warm cinematic grade. This is the film-emulation step
    // that was missing: previously the pass existed but no LUT was ever loaded,
    // so the render only ever got raw ACES tonemapping, which is neutral and
    // reads as untreated CG. `intensity` is deliberately below 1 so the grade
    // shapes the image without stamping a heavy look over the brand colours.
    new LUTCubeLoader().load(
      'assets/luts/FGCineWarm.cube',
      (result) => {
        lutPass.lut = result.texture3D || result.texture;
        lutPass.intensity = 0.72;
        lutPass.enabled = true;
        console.log('[XIX] LUT: FGCineWarm applied (intensity 0.72)');
      },
      undefined,
      (err) => {
        // Missing or malformed — leave the pass disabled and carry on ungraded
        // rather than failing the whole composer chain.
        lutPass.enabled = false;
        console.log('[XIX] LUT: FGCineWarm.cube not loaded — rendering ungraded');
      }
    );
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
    //  DISTANT BUILDINGS LOOKING PIXELATED
    //  The villa LOD only swaps at 400 m, so this was never a geometry or
    //  texture problem — it was render resolution. Fast pinned the pixel ratio
    //  to 1.0, which on a 3x-DPR phone renders at a third of native and then
    //  upscales, and Fast also bypasses the composer so there is no
    //  antialiasing to hide the stair-stepping. A distant roofline is a
    //  near-horizontal high-contrast edge, which is the worst case for both.
    //  Raised across every tier, still clamped to the device so nothing
    //  supersamples beyond what the panel can show.
    const pixelRatioMap = {
      fast:     Math.min(dpr, 1.5),   // unchanged — mobile survival
      balanced: Math.min(dpr, 2.0),   // unchanged
      rich:     Math.min(dpr, 3.0),   // native DPR on any current display
    };
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
      // New villa mesh is 157k tris vs 1.47M — GTAO costs less per pixel,
      // so we can push radius and sample count without a frame-rate cliff.
      gtaoPass.updateGtaoMaterial({ radius: 3.4, distanceExponent: 1.65, thickness: 2.0, scale: 1.15 });
      gtaoPass.blendIntensity = 0.85;
      if (gtaoPass.updatePdMaterial) gtaoPass.updatePdMaterial({ lumaPhi: 15, depthPhi: 3, normalPhi: 5, radius: 6, rings: 3, samples: 18 });
    } else if (mode === 'balanced') {
      gtaoPass.updateGtaoMaterial({ radius: 2.5, distanceExponent: 1.5, thickness: 1.8, scale: 1.05 });
      gtaoPass.blendIntensity = 0.70;
      if (gtaoPass.updatePdMaterial) gtaoPass.updatePdMaterial({ lumaPhi: 12, depthPhi: 2.5, normalPhi: 4, radius: 5, rings: 3, samples: 12 });
    }
  }

  if (smaaPass)  smaaPass.enabled  = (mode !== 'fast');
  if (bokehPass) bokehPass.enabled = false;

  // ── Vignette + chromatic aberration ─────────────────────────────────────
  if (vignettePass) {
    vignettePass.enabled = (mode !== 'fast');
    if (vignettePass.uniforms) {
      // Vignette draws the eye to the centre; CA adds filmic micro-fringing.
      // Both are zero on Fast, subtle on Balanced, deliberate on Rich.
      vignettePass.uniforms.uVignette.value   = mode === 'rich' ? 0.52 : mode === 'balanced' ? 0.26 : 0.0;
      //  CHROMATIC ABERRATION REMOVED. This was reported as "an empty
      //  duplicate that cross-cuts the original" on every AVAILABLE banner
      //  and building edge — that description is exactly what CA produces:
      //  it splits the R and B channels apart from the UV centre, and on
      //  a small high-contrast UI element like a text badge, that split
      //  reads as a visible ghost outline rather than a subtle filmic
      //  touch. On a client-facing sales tool where legibility of the
      //  AVAILABLE/RESERVED badges is the entire point, that trade is not
      //  worth it at any strength. Set to zero on every tier.
      vignettePass.uniforms.uCAStrength.value = 0.0;
    }
  }

  // ── Renderer-level quality: this is where Rich earns its name ───────────
  if (_renderer) {
    if (mode === 'rich') {
      _renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
      _renderer.toneMappingExposure = 0.72;   // lifted — new mesh is better lit
    } else if (mode === 'balanced') {
      _renderer.shadowMap.type      = THREE.PCFSoftShadowMap; // affordable now
      _renderer.toneMappingExposure = 0.66;
    } else {
      _renderer.shadowMap.type      = THREE.PCFShadowMap;
      _renderer.toneMappingExposure = 0.60;
    }
  }

  // ── IBL strength: Rich gets fuller environment lighting ─────────────────
  if (_scene && _scene.environmentIntensity !== undefined) {
    const base = _scene.environmentIntensity || 1.0;
    // The new PBR mesh carries a proper metallic-roughness map, so IBL
    // variations actually read as material differences now rather than as
    // uniform brightening. Push the ceiling up.
    _scene.environmentIntensity = mode === 'rich'     ? Math.min(base * 1.35, 2.0)
                                : mode === 'balanced' ? Math.min(base * 1.10, 1.4)
                                : base * 0.85;
  }

  // Retunes uniforms in place on already-compiled programs. Only the
  // triplanar toggle changes the cache key, so fast <-> balanced is the sole
  // transition that recompiles.
  refreshArchDetail();

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
  // The palm-wind block that used to live here was copy-pasted from
  // setPerfModeGraphics and read `mode`, which is not in scope in this
  // function. It threw ReferenceError on every single weather change and
  // aborted whatever the caller was doing next. Wind is a quality-tier
  // concern, not a weather concern, so it belongs only in the other function.
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

// ── GLASS SPLIT ────────────────────────────────────────────────────────────
//  Meshy exports arrive as ONE mesh with ONE opaque material and no alpha
//  channel, so the glazing is just dark pixels painted into the base colour.
//  Nothing you set on that material can make the windows transparent without
//  making the walls transparent too — this is the same single-material wall
//  the name-based classifier hit, and the answer is the same: stop trying to
//  configure one material and split the geometry instead.
//
//  Each triangle is classified by sampling the base colour atlas at its UV
//  centroid. Glass is smooth, desaturated, mid-to-dark and cool — the local
//  variance test is what stops shadowed render and dark soffits being caught
//  with it. Triangles that pass move to a second BufferGeometry which gets a
//  real MeshPhysicalMaterial with transmission; the rest keep the original.
//
//  Runs once at load. Costs a few hundred ms on a 200k-tri mesh, which is
//  cheaper than shipping two GLBs and cannot fall out of sync with the asset.
function _atlasSampler(tex) {
  const img = tex && (tex.image || tex.source?.data);
  if (!img || !img.width) return null;
  const W = Math.min(img.width, 512), H = Math.min(img.height, 512);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  try { ctx.drawImage(img, 0, 0, W, H); } catch (e) { return null; }
  const d = ctx.getImageData(0, 0, W, H).data;
  return { W, H, d,
    at(u, v) {
      const x = Math.min(W - 1, Math.max(0, Math.round(u * W) % W));
      const y = Math.min(H - 1, Math.max(0, Math.round((1 - v) * H) % H));
      const o = (y * W + x) * 4;
      return [d[o] / 255, d[o + 1] / 255, d[o + 2] / 255];
    },
    // Mean absolute deviation over a small neighbourhood: flat glazing is
    // smooth, timber grain and foliage are not.
    varAt(u, v) {
      const x0 = Math.round(u * W), y0 = Math.round((1 - v) * H);
      let mn = 2, mx = -1;
      for (let dy = -2; dy <= 2; dy += 2) for (let dx = -2; dx <= 2; dx += 2) {
        const x = ((x0 + dx) % W + W) % W, y = ((y0 + dy) % H + H) % H;
        const o = (y * W + x) * 4;
        const l = (d[o] * 0.2126 + d[o + 1] * 0.7152 + d[o + 2] * 0.0722) / 255;
        if (l < mn) mn = l; if (l > mx) mx = l;
      }
      return mx - mn;
    } };
}

export function splitGlassPanels(root, opts = {}) {
  const o = { transmission: 0.55, roughness: 0.08, tint: 0x2a3a46, ior: 1.5, ...opts };
  const out = [];

  root.traverse(obj => {
    if (!obj.isMesh || obj.userData._glassSplit) return;
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (!mat || !mat.map) return;
    const g = obj.geometry;
    const pos = g.attributes.position, uv = g.attributes.uv;
    if (!pos || !uv) return;
    const S = _atlasSampler(mat.map);
    if (!S) { console.warn('[XIX] glass split: atlas unreadable, left opaque'); return; }

    const idx = g.index ? g.index.array : null;
    const triCount = (idx ? idx.length : pos.count) / 3;
    const glassTris = [], solidTris = [];

    for (let t = 0; t < triCount; t++) {
      const a = idx ? idx[t*3] : t*3, b = idx ? idx[t*3+1] : t*3+1, c = idx ? idx[t*3+2] : t*3+2;
      const u = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3;
      const v = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
      const [r, gg, bb] = S.at(u, v);
      const mx = Math.max(r, gg, bb), mn = Math.min(r, gg, bb);
      const sat = mx > 1e-4 ? (mx - mn) / mx : 0;
      const isGlass = S.varAt(u, v) < 0.16 && sat < 0.30 && mx > 0.08 && mx < 0.62 && bb >= r * 0.96;
      (isGlass ? glassTris : solidTris).push(a, b, c);
    }

    if (!glassTris.length || !solidTris.length) {
      console.log(`[XIX] glass split: no clean separation on ${obj.name || 'mesh'}, left as-is`);
      return;
    }

    const sub = (list) => {
      const ng = g.clone();
      ng.setIndex(list);
      ng.clearGroups();
      return ng;
    };

    obj.geometry = sub(solidTris);
    obj.userData._glassSplit = true;

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(o.tint),
      metalness: 0.0,
      roughness: o.roughness,
      transmission: o.transmission,   // real refraction, not just opacity
      thickness: 0.02,
      ior: o.ior,
      transparent: true,
      opacity: 1.0,
      // Single-sided: doubleSided glazing draws the far pane through the near
      // one and sorts wrong, which is most of what makes CG glass look solid.
      side: THREE.FrontSide,
      depthWrite: false,
      envMapIntensity: 1.4,
    });
    if (mat.envMap) glassMat.envMap = mat.envMap;
    if (mat.normalMap) { glassMat.normalMap = mat.normalMap; glassMat.normalScale = new THREE.Vector2(0.25, 0.25); }

    const glass = new THREE.Mesh(sub(glassTris), glassMat);
    glass.name = (obj.name || 'mesh') + '_glass';
    glass.userData._glassSplit = true;
    glass.castShadow = false;          // glazing should not cast a solid shadow
    glass.receiveShadow = false;
    glass.renderOrder = 2;             // after the opaque shell
    obj.add(glass);                    // child, so it inherits every transform
    glass.position.set(0, 0, 0);
    glass.rotation.set(0, 0, 0);
    glass.scale.set(1, 1, 1);

    out.push(`${obj.name || 'mesh'}: ${glassTris.length/3} glass / ${solidTris.length/3} solid tris`);
  });

  if (out.length) console.log('[XIX] glass split -> ' + out.join('; '));
  return out;
}

// ── World-metre micro-detail for baked photogrammetry assets ──────────────
//  The turf reads as real because it samples by world metres (vWorldPos.xz /
//  uTexMeters), so its detail frequency is locked to the ground rather than to
//  a UV chart. villa-mesh.glb is a 1024 atlas stretched over a ~14m building —
//  roughly 0.7 texels per centimetre. Walk up to a wall and you are looking at
//  mush, and no amount of atlas baking fixes that; upscaling the atlas to 2048
//  only doubles the bytes.
//
//  So the villa gets the same treatment as the grass: a small seamless detail
//  map tiled by world metres, triplanar-projected so it lands correctly on
//  walls, soffits and decks alike, driving both the shading normal and a
//  roughness break-up, and faded with distance so it never aliases.
//
//  Zero external assets — generated on a canvas, same as _getConcreteNormalMap.

let _archDetailMap = null;
function _getArchDetailMap(THREE) {
  if (_archDetailMap) return _archDetailMap;
  const SIZE = 512;

  // Deterministic PRNG so the map is identical across reloads and devices.
  let seed = 19 >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  // Wrapped-lattice value noise. Because every lattice lookup is taken modulo
  // the grid size, the result tiles EXACTLY at any repeat count — no seam.
  const lattice = g => { const a = new Float32Array(g * g); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
  const fade = t => t * t * (3 - 2 * t);
  const samp = (a, g, x, y) => {
    const fx = x * g, fy = y * g;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fade(fx - x0), ty = fade(fy - y0);
    const i0 = ((x0 % g) + g) % g, j0 = ((y0 % g) + g) % g;
    const i1 = (i0 + 1) % g, j1 = (j0 + 1) % g;
    const v00 = a[j0 * g + i0], v10 = a[j0 * g + i1];
    const v01 = a[j1 * g + i0], v11 = a[j1 * g + i1];
    return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  };

  // Coarse trowel drift through to fine aggregate grain.
  const OCT = [{ g: 8, w: 0.42 }, { g: 19, w: 0.28 }, { g: 43, w: 0.19 }, { g: 97, w: 0.11 }]
    .map(o => ({ ...o, a: lattice(o.g) }));

  const h = new Float32Array(SIZE * SIZE);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    let n = 0;
    for (const o of OCT) n += o.w * samp(o.a, o.g, x / SIZE, y / SIZE);
    h[y * SIZE + x] = n;
    if (n < lo) lo = n;
    if (n > hi) hi = n;
  }
  const inv = 1 / Math.max(hi - lo, 1e-6);
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) * inv;

  const cv = document.createElement('canvas'); cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(SIZE, SIZE);
  const at = (x, y) => h[(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)];
  const AMP = 2.6;   // height-to-slope gain, kept deliberately low

  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * AMP;
    const dy = (at(x, y + 1) - at(x, y - 1)) * AMP;
    let nx = -dx, ny = dy, nz = 1.0;
    const len = Math.hypot(nx, ny, nz);
    nx /= len; ny /= len; nz /= len;
    const o = (y * SIZE + x) * 4;
    img.data[o]     = (nx * 0.5 + 0.5) * 255;
    img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
    img.data[o + 2] = (nz * 0.5 + 0.5) * 255;
    img.data[o + 3] = at(x, y) * 255;          // alpha = roughness break-up
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;         // data map — never sRGB
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  _archDetailMap = tex;
  return tex;
}

// ── Tiling PBR sets ───────────────────────────────────────────────────────
//  Two source materials packed as two 512 cells in one 1024x512 sheet:
//     cell 0  u[0.0,0.5)  Wood088 plywood   -> mask R  (louvre screens, doors)
//     cell 1  u[0.5,1.0)  beige_wall_002    -> mask G  (walls) and B (soffit)
//  detail-col : mean-normalised COLOUR MODULATION, 0.5 = neutral
//  detail-nrs : R,G = normal XY   B = roughness   A = AO
//
//  Colour is a modulation rather than a colour because the atlas already owns
//  the palette. A tiling map carrying real colour would show its tile as
//  repetition across a flat wall, which is the loudest tell of a tiled texture.
//  A ratio map about 1.0 adds grain, streaks and knots and repeats invisibly.
//
//  Walls and soffit share cell 1 and one tile scale on purpose: giving them
//  separate scales would cost two more texture fetches per pixel to express a
//  difference that reads just as well as a roughness and normal-strength offset.
const DETAIL_COL_URL = 'assets/detail-col.webp';
const DETAIL_NRS_URL = 'assets/detail-nrs.webp';

let _detCol = null, _detNRS = null;
function _getDetailSheets() {
  if (_detCol) return [_detCol, _detNRS];
  const L = new THREE.TextureLoader();
  const cfg = (t, srgb) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    return t;
  };
  _detCol = cfg(L.load(DETAIL_COL_URL, t => { t.needsUpdate = true; },
    undefined, () => console.warn('[XIX] detail-col.webp missing - detail layer inert')), false);
  _detNRS = cfg(L.load(DETAIL_NRS_URL, t => { t.needsUpdate = true; },
    undefined, () => console.warn('[XIX] detail-nrs.webp missing - detail layer inert')), false);
  return [_detCol, _detNRS];
}

// tileT / tileB are metres per tile.  nrm / rgh / col are per-mask-channel
// strengths in the order  [ timber, wall, soffit ].
export const ARCH_DETAIL_TIERS = {
  fast:     { tileT: 0.55, tileB: 0.90, nrm: [0.55, 0.35, 0.40], rgh: 0.45, col: [0.55, 0.22, 0.30], ao: 0.35, fadeNear: 10, fadeFar: 26 },
  balanced: { tileT: 0.55, tileB: 0.90, nrm: [0.80, 0.50, 0.58], rgh: 0.65, col: [0.75, 0.30, 0.40], ao: 0.50, fadeNear: 20, fadeFar: 52 },
  rich:     { tileT: 0.50, tileB: 0.85, nrm: [0.95, 0.60, 0.70], rgh: 0.75, col: [0.80, 0.32, 0.44], ao: 0.60, fadeNear: 28, fadeFar: 76 },
};

// Every material we have patched, so setPerfModeGraphics can retune uniforms
// in place rather than forcing a shader recompile on every quality change.
const _archDetailMats = new Set();

function _applyArchDetail(mat) {
  if (!mat || !mat.isMeshStandardMaterial) return;
  const t = ARCH_DETAIL_TIERS[_perfMode] || ARCH_DETAIL_TIERS.balanced;

  // The mask rides in the emissiveTexture slot. No mask means no material
  // classification for this asset, so there is nothing to drive the sets with.
  if (!mat.emissiveMap) return;
  mat.emissive = new THREE.Color(0x000000);   // mask must never light anything
  mat.emissiveIntensity = 0.0;

  if (mat.userData._archDetail) {             // already patched - retune only
    const u = mat.userData._archDetail;
    u.uTileT.value = t.tileT;  u.uTileB.value = t.tileB;
    u.uNrmStr.value.fromArray(t.nrm);
    u.uColStr.value.fromArray(t.col);
    u.uRghMix.value = t.rgh;   u.uAoStr.value = t.ao;
    u.uFadeNear.value = t.fadeNear;  u.uFadeFar.value = t.fadeFar;
    return;
  }

  const [dc, dn] = _getDetailSheets();
  const U = {
    uDetCol:   { value: dc },
    uDetNRS:   { value: dn },
    uTileT:    { value: t.tileT },
    uTileB:    { value: t.tileB },
    uNrmStr:   { value: new THREE.Vector3().fromArray(t.nrm) },
    uColStr:   { value: new THREE.Vector3().fromArray(t.col) },
    uRghMix:   { value: t.rgh },
    uAoStr:    { value: t.ao },
    uFadeNear: { value: t.fadeNear },
    uFadeFar:  { value: t.fadeFar },
  };
  mat.userData._archDetail = U;
  _archDetailMats.add(mat);

  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, U);

    // objectNormal comes from <beginnormal_vertex> and transformed from
    // <begin_vertex>; both run before <project_vertex>, so both are in scope.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nvarying vec3 vArchWPos;\nvarying vec3 vArchWNrm;')
      .replace('#include <project_vertex>',
        '#include <project_vertex>\n' +
        'vArchWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n' +
        'vArchWNrm = normalize( mat3( modelMatrix ) * objectNormal );');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', [
        '#include <common>',
        'varying vec3 vArchWPos;',
        'varying vec3 vArchWNrm;',
        'uniform sampler2D uDetCol;',
        'uniform sampler2D uDetNRS;',
        'uniform float uTileT;',
        'uniform float uTileB;',
        'uniform vec3  uNrmStr;',
        'uniform vec3  uColStr;',
        'uniform float uRghMix;',
        'uniform float uAoStr;',
        'uniform float uFadeNear;',
        'uniform float uFadeFar;',
        // Dominant-axis projection. Full triplanar would triple the fetch count
        // to express a difference that only shows on curved surfaces; this
        // building is box-like and the detail fades out before the 45deg seam
        // is ever legible.
        'vec2 archPlane( vec3 p, vec3 n, float m ) {',
        '  vec3 an = abs( n );',
        '  vec2 w = ( an.y > max( an.x, an.z ) ) ? p.xz',
        '         : ( an.x > an.z ) ? p.zy : p.xy;',
        '  return w / m;',
        '}',
        // Half-texel inset stops bilinear filtering bleeding one 512 cell into
        // its neighbour across the u=0.5 join.
        'vec2 archCell( vec2 w, float cell ) {',
        '  vec2 f = clamp( fract( w ), 0.0015, 0.9985 );',
        '  return vec2( ( f.x + cell ) * 0.5, f.y );',
        '}',
      ].join('\n'))

      // <map_fragment> is the FIRST of the three chunks we touch, so the sample
      // happens here and the results stay in main scope for the roughness and
      // normal blocks further down.
      .replace('#include <map_fragment>', [
        '#include <map_fragment>',
        'float archFade = 1.0 - smoothstep( uFadeNear, uFadeFar, length( vViewPosition ) );',
        'vec3  archN    = normalize( vArchWNrm );',
        'vec3  archM    = texture2D( emissiveMap, vEmissiveMapUv ).rgb;',
        'float archWT   = archM.r;',
        'float archWB   = archM.g + archM.b;',
        'float archCov  = clamp( archWT + archWB, 0.0, 1.0 ) * archFade;',
        // .yx swaps the plane axes for the timber cell only. Wood088's grain runs
        // horizontally in the source, so on a vertical louvre it would band across
        // the slats instead of running down them. Swapping maps world height onto
        // the texture's U axis, which stands the grain upright.
        'vec2  archUvT  = archCell( archPlane( vArchWPos, archN, uTileT ).yx, 0.0 );',
        'vec2  archUvB  = archCell( archPlane( vArchWPos, archN, uTileB ), 1.0 );',
        'float archTot  = max( archWT + archWB, 1e-4 );',
        'vec3  archCol  = ( texture2D( uDetCol, archUvT ).rgb * archWT',
        '                 + texture2D( uDetCol, archUvB ).rgb * archWB ) / archTot;',
        'vec4  archNRS  = ( texture2D( uDetNRS, archUvT ) * archWT',
        '                 + texture2D( uDetNRS, archUvB ) * archWB ) / archTot;',
        'float archCS   = dot( uColStr, archM ) / archTot;',
        'float archNS   = dot( uNrmStr, archM ) / archTot;',
        // 0.5 is neutral in the modulation map, hence the x2.
        'diffuseColor.rgb *= mix( vec3( 1.0 ), archCol * 2.0, archCov * archCS );',
        'diffuseColor.rgb *= mix( 1.0, archNRS.a, archCov * uAoStr );',
      ].join('\n'))

      .replace('#include <roughnessmap_fragment>', [
        '#include <roughnessmap_fragment>',
        // Soffit reads slightly rougher than wall off the same source cell.
        'float archRgh = archNRS.b + archM.b * 0.06;',
        'roughnessFactor = clamp( mix( roughnessFactor, archRgh, uRghMix * archCov ), 0.04, 1.0 );',
      ].join('\n'))

      // Difference blend: add only the detail normal's deviation from flat, so
      // the baked normal map underneath survives instead of being replaced.
      .replace('#include <normal_fragment_maps>', [
        '#include <normal_fragment_maps>',
        '{',
        '  vec3 aDN  = vec3( archNRS.rg * 2.0 - 1.0, 0.0 );',
        '  aDN.z     = sqrt( max( 1.0 - dot( aDN.xy, aDN.xy ), 1e-4 ) );',
        '  vec3 aDPX = dFdx( vArchWPos );',
        '  vec3 aT   = aDPX - archN * dot( archN, aDPX );',
        '  if ( length( aT ) > 1e-5 ) {',
        '    aT = normalize( aT );',
        '    vec3 aB = normalize( cross( archN, aT ) );',
        '    vec3 aW = normalize( aT * aDN.x + aB * aDN.y + archN * aDN.z );',
        '    vec3 aV = normalize( ( viewMatrix * vec4( aW,    0.0 ) ).xyz );',
        '    vec3 aF = normalize( ( viewMatrix * vec4( archN, 0.0 ) ).xyz );',
        '    normal = normalize( normal + ( aV - aF ) * archNS * archCov );',
        '  }',
        '}',
      ].join('\n'));
  };

  mat.needsUpdate = true;
}

export function refreshArchDetail() {
  _archDetailMats.forEach(_applyArchDetail);
}

// ── Glass sun glint state — updated by applyGlassSunGlint() from app.js ──
window._xixSunGlintIntensity = 0.0;

export function applyPS4Materials(gltfScene) {
  if (!gltfScene) return;
  const concreteNM = _getConcreteNormalMap(THREE);

  gltfScene.traverse(child => {
    if (!child.isMesh || !child.material) return;
    const mats = Array.isArray(child.material) ? child.material : [child.material];

    mats.forEach(mat => {
      if (_envMap) mat.envMap = _envMap;
      const name = ((mat.name || '') + ' ' + (child.name || '')).toLowerCase();

      // ══════════════════════════════════════════════════════════════════
      //  BAKED-ASSET GUARD
      // ══════════════════════════════════════════════════════════════════
      //  villa-mesh.glb and tree-mesh.glb are photogrammetry assets with a
      //  SINGLE material ("pbr_material") covering render, timber, glazing and
      //  soffits alike. Name matching cannot classify them — every branch below
      //  would miss and they would fall through to the default, which is why
      //  no amount of material work has changed how the villas look.
      //
      //  They now ship with purpose-baked albedo / normal / metallicRoughness
      //  maps derived from their own atlas. Where those exist we must NOT
      //  substitute procedural values — we only tune env response and shadows.
      // ══════════════════════════════════════════════════════════════════
      if (mat.normalMap && mat.roughnessMap && mat.map) {
        //  These three numbers were calibrated against the FIRST bake, whose
        //  normal map was a Sobel edge-detect of the albedo — it traced every
        //  colour boundary and embossed a ridge/valley pair around every window
        //  frame, so it needed 1.35 IBL and 1.5x normal scale to read as
        //  anything but noise. The current bake is an honest band-pass micro-
        //  relief map with glass masked to zero, so those multipliers now just
        //  amplify grain and blow the highlights. Dial them back to neutral.
        //  envMapIntensity was cut to 1.05 in the previous pass at the same time
        //  as an AO map was added for the first time. On a facade lit mainly by
        //  IBL those two dimmers multiply, and GTAO multiplies again on top —
        //  the villa lost roughly a third of its light in one step. The AO map
        //  is now shallow (0.78–1.0) so env intensity goes back up.
        mat.envMapIntensity = 1.30;
        mat.normalScale     = new THREE.Vector2(1.15, 1.15);  // timber grain is the relief now
        mat.aoMapIntensity  = 0.90;                 // GTAO already handles the macro occlusion
        if (mat.map) mat.map.anisotropy = _renderer ? _renderer.capabilities.getMaxAnisotropy() : 8;
        if (mat.normalMap)    mat.normalMap.anisotropy    = mat.map.anisotropy;
        if (mat.roughnessMap) mat.roughnessMap.anisotropy = mat.map.anisotropy;
        if (mat.aoMap)        mat.aoMap.anisotropy        = mat.map.anisotropy;
        mat._baseEnvInt = mat.envMapIntensity;

        //  The atlas runs out of resolution long before the camera does.
        //  Everything below ~2cm comes from the world-metre detail layer.
        _applyArchDetail(mat);

        mat.needsUpdate = true;
        child.castShadow = true; child.receiveShadow = true;
        return;   // leave the baked maps alone
      }
      const hex  = mat.color ? mat.color.getHex() : 0xffffff;
      const c    = mat.color ? mat.color : new THREE.Color(0xffffff);
      const lum  = 0.299*c.r + 0.587*c.g + 0.114*c.b;

      // ── GLASS ───────────────────────────────────────────────────────────
      // Architectural glazing is not a grey panel. It is near-black in the
      // diffuse channel with almost all of its appearance coming from
      // reflection, plus a slight green-blue tint from the float-glass edge.
      if (/glass|window|glaz|pane|curtain.?wall/.test(name)) {
        mat.color.setHex(0x0b1416);
        mat.roughness        = 0.02;
        mat.metalness        = 0.0;
        mat.transparent      = true;
        mat.opacity          = 0.42;
        mat.envMapIntensity  = 5.2;      // reflection is the whole material
        mat.emissive         = new THREE.Color(0xffe4a0);
        mat.emissiveIntensity= 0.0;      // driven per time-of-day
        mat.depthWrite       = false;    // stops glazing z-fighting balustrades
        mat.side             = THREE.DoubleSide;
        if (mat.iridescence !== undefined) {
          mat.iridescence          = 0.22;  // faint coating shimmer at grazing angles
          mat.iridescenceIOR       = 1.32;
          mat.iridescenceThicknessRange = [110, 420];
        }
        if (mat.clearcoat !== undefined) { mat.clearcoat = 1.0; mat.clearcoatRoughness = 0.02; }
        child.userData.isGlassPanel = true;
        child.castShadow = false;        // glass casting opaque shadow looks wrong

      // ── POLISHED / ANODISED METAL ───────────────────────────────────────
      } else if (/metal|steel|alum|frame|mullion|railing|rail|balustrade.?post|handrail/.test(name)) {
        mat.roughness       = 0.16;
        mat.metalness       = 0.94;
        mat.envMapIntensity = 3.4;
        if (lum > 0.75) mat.color.setHex(0xd8dade);   // brushed silver
        if (mat.clearcoat !== undefined) { mat.clearcoat = 0.5; mat.clearcoatRoughness = 0.18; }
        child.castShadow = true;

      // ── ROOF ────────────────────────────────────────────────────────────
      } else if (/roof|tile|shingle|parapet.?cap|coping/.test(name)) {
        mat.roughness       = 0.72;
        mat.metalness       = 0.04;
        mat.envMapIntensity = 0.85;
        if (!mat.normalMap) { mat.normalMap = concreteNM; mat.normalScale = new THREE.Vector2(0.4, 0.4); }

      // ── RENDERED / PAINTED WALL ─────────────────────────────────────────
      // The dominant surface on every building, and previously the flattest.
      // Real painted render has: a faint sheen (paint is not chalk), micro
      // relief from the float coat, and a very slight warm bias where sun has
      // aged it. Clearcoat at low strength is what makes paint read as paint.
      } else if (/concrete|wall|plast|render|stucco|facade|paint|panel|body|cladding/.test(name)) {
        mat.roughness       = 0.62;      // was 0.86 — too chalky, killed all light response
        mat.metalness       = 0.0;
        mat.envMapIntensity = 0.95;      // was 0.35 — walls now pick up sky bounce
        if (mat.clearcoat !== undefined) { mat.clearcoat = 0.28; mat.clearcoatRoughness = 0.55; }
        if (mat.sheen !== undefined)     { mat.sheen = 0.10; mat.sheenRoughness = 0.75; }
        if (!mat.normalMap) {
          mat.normalMap   = concreteNM;
          mat.normalScale = new THREE.Vector2(0.85, 0.85);   // was 0.55
        } else {
          const sN = Math.min((mat.normalScale?.x || 1) * 1.45, 2.4);
          mat.normalScale = new THREE.Vector2(sN, sN);
        }
        // Keep bright white render from clipping under the tropical sun
        if (lum > 0.86) mat.color.multiplyScalar(0.93);

      // ── TIMBER ──────────────────────────────────────────────────────────
      // The vertical timber screens are a signature of these elevations, so
      // they get anisotropic-feeling treatment: low-ish roughness with strong
      // normal relief so each slat edge catches light separately.
      } else if (/wood|timber|deck|board|slat|louvre|louver|batten|screen/.test(name)) {
        mat.roughness       = 0.48;
        mat.metalness       = 0.0;
        mat.envMapIntensity = 0.9;
        if (mat.clearcoat !== undefined) { mat.clearcoat = 0.45; mat.clearcoatRoughness = 0.32; }
        if (mat.normalMap) {
          const sN = Math.min((mat.normalScale?.x || 1) * 2.0, 3.0);
          mat.normalScale = new THREE.Vector2(sN, sN);
        }

      // ── SOFFIT / CEILING — always in shadow, must not go pure black ──────
      } else if (/soffit|ceiling|underside|overhang/.test(name)) {
        mat.roughness       = 0.70;
        mat.metalness       = 0.0;
        mat.envMapIntensity = 1.15;      // lifted by bounce light
        mat.color.lerp(new THREE.Color(0xfff2dc), 0.10);

      // ── STONE / MASONRY ─────────────────────────────────────────────────
      } else if (/stone|gabion|brick|masonry|granite|travertine/.test(name)) {
        mat.roughness       = 0.82;
        mat.metalness       = 0.0;
        mat.envMapIntensity = 0.40;
        if (!mat.normalMap) { mat.normalMap = concreteNM; mat.normalScale = new THREE.Vector2(1.3, 1.3); }

      // ── PLANTING IN PLANTERS ────────────────────────────────────────────
      } else if (/plant|foliage|leaf|hedge|shrub|green/.test(name)) {
        mat.roughness       = 0.88;
        mat.metalness       = 0.0;
        mat.envMapIntensity = 0.5;
        if (mat.sheen !== undefined) { mat.sheen = 0.4; mat.sheenColor = new THREE.Color(0x9fd070); }

      // ── DEFAULT ─────────────────────────────────────────────────────────
      } else {
        mat.roughness       = Math.max(0.34, Math.min(mat.roughness ?? 0.68, 0.82));
        mat.metalness       = Math.min(mat.metalness ?? 0, 0.4);
        mat.envMapIntensity = Math.max(mat.envMapIntensity ?? 1.0, 0.85);
        if (!mat.normalMap) { mat.normalMap = concreteNM; mat.normalScale = new THREE.Vector2(0.5, 0.5); }
      }

      // Universal upgrades
      if (mat.map) {
        mat.map.anisotropy = _renderer ? _renderer.capabilities.getMaxAnisotropy() : 8;
        // Slight contrast lift stops photogrammetry albedo looking washed out
        if (mat.color && !/glass|window/.test(name)) mat.color.convertSRGBToLinear?.();
      }
      if (mat.aoMap)  mat.aoMapIntensity = 1.15;
      mat._baseEnvInt = mat.envMapIntensity;
      mat.needsUpdate = true;
    });

    child.castShadow    = child.castShadow !== false;
    child.receiveShadow = true;
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
