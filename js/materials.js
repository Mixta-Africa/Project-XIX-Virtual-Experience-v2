/**
 * Project XIX     PBR Materials Library
 * Loads all 24 texture maps, builds MeshStandardMaterial for every surface.
 * Stone/Timber are 1024  512     UV repeat set accordingly.
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js";

const T = "assets/textures/";
const loader = new THREE.TextureLoader();

//           TEXTURE LOADER HELPER                                                                                                                                                          

function tex(name, repeatX = 4, repeatY = 4, encoding = true) {
  const t = loader.load(T + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  if (encoding) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function nrm(name, repeatX = 4, repeatY = 4) {
  const t = loader.load(T + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  return t;
}

function rgh(name, repeatX = 4, repeatY = 4) {
  const t = loader.load(T + name);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  return t;
}

//           PBR MATERIAL FACTORY                                                                                                                                                             

function pbr({ color, normal, roughness, rx = 4, ry = 4,
               roughVal = 0.8, metalVal = 0, color2 = null,
               transparent = false, opacity = 1.0,
               normalScale = 1.2, side = THREE.FrontSide } = {}) {
  return new THREE.MeshStandardMaterial({
    map:          tex(color, rx, ry),
    normalMap:    nrm(normal, rx, ry),
    roughnessMap: rgh(roughness, rx, ry),
    normalScale:  new THREE.Vector2(normalScale, normalScale),
    roughness:    roughVal,
    metalness:    metalVal,
    transparent,
    opacity,
    side,
  });
}

//           EXPORTED MATERIAL SETS                                                                                                                                                       

// Ground surfaces
export const MAT_GRASS_FIELD = () => pbr({
  color: "grass-color.png", normal: "grass-normal.png",
  roughness: "grass-roughness.png",
  rx: 28, ry: 14, roughVal: 0.92, normalScale: 0.8,
});

export const MAT_DIRT = () => pbr({
  color: "dirt-color.png", normal: "dirt-normal.png",
  roughness: "dirt-roughness.png",
  rx: 20, ry: 20, roughVal: 0.95, normalScale: 1.0,
});

export const MAT_ASPHALT = () => pbr({
  color: "asphalt-color.png", normal: "asphalt-normal.png",
  roughness: "asphalt-roughness.png",
  rx: 8, ry: 8, roughVal: 0.88, normalScale: 0.9,
});

// Building skins
export const MAT_BRICK = () => pbr({
  color: "brick-color.png", normal: "brick-normal.png",
  roughness: "brick-roughness.png",
  rx: 6, ry: 3, roughVal: 0.85, normalScale: 1.6,
});

export const MAT_CONCRETE = () => pbr({
  color: "concrete-color.png", normal: "concrete-normal.png",
  roughness: "concrete-roughness.png",
  rx: 4, ry: 2, roughVal: 0.75, normalScale: 0.7,
});

export const MAT_TIMBER = () => pbr({
  color: "timber-color.png", normal: "timber-normal.png",
  roughness: "timber-roughness.png",
  rx: 3, ry: 3, roughVal: 0.65, normalScale: 1.2,
});

export const MAT_STONE = () => pbr({
  color: "stone-color.png", normal: "stone-normal.png",
  roughness: "stone-roughness.png",
  rx: 3, ry: 3, roughVal: 0.90, normalScale: 1.5,
});

export const MAT_TILE_ROOF = () => pbr({
  color: "tile-color.png", normal: "tile-normal.png",
  roughness: "tile-roughness.png",
  rx: 8, ry: 4, roughVal: 0.82, normalScale: 1.1,
});

// Specials     procedural (no texture file needed)
export function MAT_GLASS(opacity = 0.46) {
  return new THREE.MeshStandardMaterial({
    color: 0x8fcce0, roughness: 0.04, metalness: 0.08,
    transparent: true, opacity,
    envMapIntensity: 1.4,
  });
}

export function MAT_GLASS_WARM(opacity = 0.55) {
  return new THREE.MeshStandardMaterial({
    color: 0xd4a84a, roughness: 0.05, metalness: 0.1,
    transparent: true, opacity,
    envMapIntensity: 1.2,
    emissive: new THREE.Color(0xb87820),
    emissiveIntensity: 0.35,
  });
}

export function MAT_WHITE_TRIM() {
  return new THREE.MeshStandardMaterial({
    color: 0xfcfaf6, roughness: 0.4, metalness: 0.06,
  });
}

export function MAT_GOLD() {
  return new THREE.MeshStandardMaterial({
    color: 0xc9a84c, roughness: 0.3, metalness: 0.55,
  });
}

export function MAT_DARK_METAL() {
  return new THREE.MeshStandardMaterial({
    color: 0x1e2422, roughness: 0.5, metalness: 0.7,
  });
}

export function MAT_WATER() {
  // Water uses scrolling normal maps     animated in scene.js tick
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a7fa8, roughness: 0.06, metalness: 0.45,
    transparent: true, opacity: 0.88,
    normalMap: nrm("stone-normal.png", 6, 6), // repurposed for ripple
    normalScale: new THREE.Vector2(0.35, 0.35),
    envMapIntensity: 1.6,
  });
  mat.userData.isWater = true;
  return mat;
}

