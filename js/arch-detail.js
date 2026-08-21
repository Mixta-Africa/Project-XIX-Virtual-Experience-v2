// arch-detail.js — Project XIX
// World-metre micro-detail for architectural GLBs.
//
// WHY THIS EXISTS
// The turf reads as real because it samples by world metres (vWorldPos.xz / 2.0),
// so its detail frequency is fixed to the ground, not to a UV chart. The villa
// atlas is 1024px stretched over a ~14m building — roughly 0.7 texels per cm.
// Walk up to a wall and you are looking at mush. No amount of atlas baking fixes
// that; upscaling the atlas to 2048 only doubles the bytes.
//
// The fix is the same one the grass already uses: a small seamless detail map
// tiled by world metres, triplanar-projected so it lands correctly on walls,
// soffits and decks alike, and faded out with distance so it never aliases.
//
// Zero external assets — the detail map is generated procedurally on a canvas,
// consistent with canvasTex().

import * as THREE from 'three';

/* ------------------------------------------------------------------ *
 * Seamless detail map.
 * RGB = tangent-space normal, A = roughness break-up.
 * Wrapped-lattice value noise, so it tiles exactly at any repeat count.
 * ------------------------------------------------------------------ */
export function makeDetailMap(size = 512, seed = 19) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);

  const lattice = (g) => {
    const a = new Float32Array(g * g);
    for (let i = 0; i < a.length; i++) a[i] = rnd();
    return a;
  };
  const fade = (t) => t * t * (3 - 2 * t);
  const sample = (a, g, x, y) => {
    const fx = x * g, fy = y * g;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fade(fx - x0), ty = fade(fy - y0);
    const i0 = ((x0 % g) + g) % g, j0 = ((y0 % g) + g) % g;
    const i1 = (i0 + 1) % g, j1 = (j0 + 1) % g;
    const v00 = a[j0 * g + i0], v10 = a[j0 * g + i1];
    const v01 = a[j1 * g + i0], v11 = a[j1 * g + i1];
    return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
  };

  // Octaves: coarse trowel drift -> fine aggregate grain.
  const octaves = [
    { g: 8,  w: 0.42 },
    { g: 19, w: 0.28 },
    { g: 43, w: 0.19 },
    { g: 97, w: 0.11 },
  ].map(o => ({ ...o, a: lattice(o.g) }));

  const h = new Float32Array(size * size);
  let lo = Infinity, hi = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let n = 0;
      for (const o of octaves) n += o.w * sample(o.a, o.g, u, v);
      h[y * size + x] = n;
      if (n < lo) lo = n;
      if (n > hi) hi = n;
    }
  }
  const inv = 1 / Math.max(hi - lo, 1e-6);
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - lo) * inv;

  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => h[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const AMP = 2.6; // height-to-slope gain; kept low on purpose

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * AMP;
      const dy = (at(x, y + 1) - at(x, y - 1)) * AMP;
      let nx = -dx, ny = dy, nz = 1.0;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const o = (y * size + x) * 4;
      img.data[o]     = (nx * 0.5 + 0.5) * 255;
      img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[o + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[o + 3] = at(x, y) * 255;      // break-up channel
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;       // data map, never sRGB
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

let _shared = null;
const detailMap = () => (_shared ||= makeDetailMap());

/* ------------------------------------------------------------------ *
 * Per-tier presets. Detail costs one extra texture fetch x3 (triplanar),
 * so Fast gets a cheaper single-plane path and a tighter fade.
 * ------------------------------------------------------------------ */
export const DETAIL_TIERS = {
  fast:     { meters: 0.85, normalStr: 0.30, roughStr: 0.10, fadeNear: 10, fadeFar: 26, triplanar: false },
  balanced: { meters: 0.85, normalStr: 0.45, roughStr: 0.15, fadeNear: 18, fadeFar: 48, triplanar: true  },
  rich:     { meters: 0.75, normalStr: 0.55, roughStr: 0.18, fadeNear: 26, fadeFar: 70, triplanar: true  },
};

/* ------------------------------------------------------------------ *
 * applyArchDetail(root, opts)
 * Patches every MeshStandardMaterial under root. Idempotent.
 * ------------------------------------------------------------------ */
export function applyArchDetail(root, opts = {}) {
  const o = { ...DETAIL_TIERS.balanced, envIntensity: null, ...opts };
  const map = detailMap();
  const patched = [];

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];

    mats.forEach((mat) => {
      if (!mat.isMeshStandardMaterial) return;
      if (o.envIntensity != null) mat.envMapIntensity = o.envIntensity;

      if (mat.userData.__archDetail) {                 // already patched: retune only
        const u = mat.userData.__archDetail;
        u.uMeters.value    = o.meters;
        u.uNrmStr.value    = o.normalStr;
        u.uRghStr.value    = o.roughStr;
        u.uFadeNear.value  = o.fadeNear;
        u.uFadeFar.value   = o.fadeFar;
        u.uTriplanar.value = o.triplanar ? 1 : 0;
        return;
      }

      const U = {
        uDetail:    { value: map },
        uMeters:    { value: o.meters },
        uNrmStr:    { value: o.normalStr },
        uRghStr:    { value: o.roughStr },
        uFadeNear:  { value: o.fadeNear },
        uFadeFar:   { value: o.fadeFar },
        uTriplanar: { value: o.triplanar ? 1 : 0 },
      };
      mat.userData.__archDetail = U;

      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, U);

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
            'uniform sampler2D uDetail;',
            'uniform float uMeters;',
            'uniform float uNrmStr;',
            'uniform float uRghStr;',
            'uniform float uFadeNear;',
            'uniform float uFadeFar;',
            'uniform float uTriplanar;',
            // Sample by world metres so detail frequency is locked to the world,
            // exactly like the turf. Triplanar keeps it correct on every facing.
            'vec4 archDetail( vec3 p, vec3 n ) {',
            '  vec4 py = texture2D( uDetail, p.xz / uMeters );',
            '  if ( uTriplanar < 0.5 ) return py;',
            '  vec3 bw = pow( abs( n ), vec3( 6.0 ) );',
            '  bw /= max( bw.x + bw.y + bw.z, 1e-4 );',
            '  vec4 px = texture2D( uDetail, p.zy / uMeters );',
            '  vec4 pz = texture2D( uDetail, p.xy / uMeters );',
            '  return px * bw.x + py * bw.y + pz * bw.z;',
            '}',
          ].join('\n'))

          // Roughness first: break up the flat per-class values from the bake.
          // A perfectly constant roughness across a wall is the single loudest
          // tell that a surface is CG.
          .replace('#include <roughnessmap_fragment>', [
            '#include <roughnessmap_fragment>',
            'float archFade = 1.0 - smoothstep( uFadeNear, uFadeFar, length( vViewPosition ) );',
            'vec4 archD = archDetail( vArchWPos, normalize( vArchWNrm ) );',
            'roughnessFactor = clamp( roughnessFactor + ( archD.a - 0.5 ) * uRghStr * archFade, 0.04, 1.0 );',
          ].join('\n'))

          // Then perturb the shading normal. Difference blend: add only the
          // detail normal's deviation from flat, so the baked map is preserved.
          .replace('#include <normal_fragment_maps>', [
            '#include <normal_fragment_maps>',
            '{',
            '  vec3 aWN  = normalize( vArchWNrm );',
            '  vec3 aDN  = normalize( archD.rgb * 2.0 - 1.0 );',
            '  vec3 aDPX = dFdx( vArchWPos );',
            '  vec3 aT   = aDPX - aWN * dot( aWN, aDPX );',
            '  if ( length( aT ) > 1e-5 ) {',
            '    aT = normalize( aT );',
            '    vec3 aB = normalize( cross( aWN, aT ) );',
            '    vec3 aW = normalize( aT * aDN.x + aB * aDN.y + aWN * aDN.z );',
            '    vec3 aV = normalize( ( viewMatrix * vec4( aW,  0.0 ) ).xyz );',
            '    vec3 aF = normalize( ( viewMatrix * vec4( aWN, 0.0 ) ).xyz );',
            '    normal = normalize( normal + ( aV - aF ) * uNrmStr * archFade );',
            '  }',
            '}',
          ].join('\n'));
      };

      mat.customProgramCacheKey = () => 'archDetail-' + (o.triplanar ? 't' : 's');
      mat.needsUpdate = true;
      patched.push(mat.name || '(unnamed)');
    });
  });

  return patched;
}
