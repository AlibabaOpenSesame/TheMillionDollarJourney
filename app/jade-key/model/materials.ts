import * as THREE from "three";

export type JadeKeyMaterialSet = {
  clay: THREE.MeshStandardMaterial;
  jade: THREE.MeshPhysicalMaterial;
  gold: THREE.MeshPhysicalMaterial;
  polishedGold: THREE.MeshPhysicalMaterial;
  recess: THREE.MeshPhysicalMaterial;
};

function hashNoise(x: number, y: number) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function smoothNoise(x: number, y: number, scale: number) {
  const sx = x / scale;
  const sy = y / scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const tx = sx - x0;
  const ty = sy - y0;
  const ux = tx * tx * (3 - 2 * tx);
  const uy = ty * ty * (3 - 2 * ty);
  const a = hashNoise(x0, y0);
  const b = hashNoise(x0 + 1, y0);
  const c = hashNoise(x0, y0 + 1);
  const d = hashNoise(x0 + 1, y0 + 1);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, ux),
    THREE.MathUtils.lerp(c, d, ux),
    uy,
  );
}

function configureTexture(texture: THREE.Texture, color = false) {
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function fallbackTexture(color: [number, number, number, number], colorSpace = false) {
  const texture = new THREE.DataTexture(new Uint8Array(color), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  return configureTexture(texture, colorSpace);
}

function createCanvasTexture(
  size: number,
  sample: (x: number, y: number) => [number, number, number, number],
  color = false,
) {
  if (typeof document === "undefined") {
    return fallbackTexture(color ? [236, 235, 216, 255] : [128, 128, 128, 255], color);
  }
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return fallbackTexture([128, 128, 128, 255], color);
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = sample(x, y);
      const offset = (y * size + x) * 4;
      image.data[offset] = r;
      image.data[offset + 1] = g;
      image.data[offset + 2] = b;
      image.data[offset + 3] = a;
    }
  }
  context.putImageData(image, 0, 0);
  return configureTexture(new THREE.CanvasTexture(canvas), color);
}

function createJadeCloudTexture(size = 1024) {
  return createCanvasTexture(size, (x, y) => {
    const u = x / size;
    const v = y / size;
    const broad = smoothNoise(x + 31, y - 17, 190);
    const cloud = smoothNoise(x - 67, y + 43, 84);
    const veil = smoothNoise(x + 11, y + 89, 34);
    const yellowBloom = Math.exp(-(((u - 0.53) / 0.31) ** 2 + ((v - 0.76) / 0.23) ** 2));
    const greenBloom = Math.exp(-(((u - 0.59) / 0.38) ** 2 + ((v - 0.58) / 0.31) ** 2));
    const density = THREE.MathUtils.clamp(broad * 0.56 + cloud * 0.32 + veil * 0.12, 0, 1);
    return [
      Math.round(239 + density * 11 - greenBloom * 13 + yellowBloom * 3),
      Math.round(239 + density * 10 - greenBloom * 6 + yellowBloom * 4),
      Math.round(222 + density * 17 - greenBloom * 14 - yellowBloom * 23),
      255,
    ];
  }, true);
}

function createScalarTexture(base: number, variation: number, scale: number, size = 1024) {
  return createCanvasTexture(size, (x, y) => {
    const low = smoothNoise(x + 23, y - 31, scale);
    const high = smoothNoise(x - 47, y + 13, Math.max(12, scale / 3));
    const value = Math.round(THREE.MathUtils.clamp(
      base + (low - 0.5) * variation + (high - 0.5) * variation * 0.32,
      0,
      255,
    ));
    return [value, value, value, 255];
  });
}

export function createJadeKeyMaterials(mapStripped = false): JadeKeyMaterialSet {
  const clay = new THREE.MeshStandardMaterial({ color: "#352b20", roughness: 0.82, metalness: 0 });
  if (mapStripped) {
    return {
      clay,
      jade: clay as unknown as THREE.MeshPhysicalMaterial,
      gold: clay as unknown as THREE.MeshPhysicalMaterial,
      polishedGold: clay as unknown as THREE.MeshPhysicalMaterial,
      recess: clay as unknown as THREE.MeshPhysicalMaterial,
    };
  }

  const jadeCloud = createJadeCloudTexture();
  const jadeRoughness = createScalarTexture(192, 28, 146);
  const jadeHeight = createScalarTexture(128, 12, 72);
  const goldRoughness = createScalarTexture(206, 23, 126);

  const jade = new THREE.MeshPhysicalMaterial({
    color: "#f8f6e7",
    map: jadeCloud,
    roughness: 0.24,
    roughnessMap: jadeRoughness,
    bumpMap: jadeHeight,
    bumpScale: 0.0014,
    metalness: 0,
    transmission: 0.12,
    thickness: 0.16,
    attenuationColor: new THREE.Color("#dce1bd"),
    attenuationDistance: 1.8,
    ior: 1.48,
    clearcoat: 0.48,
    clearcoatRoughness: 0.095,
    envMapIntensity: 1.12,
  });

  const gold = new THREE.MeshPhysicalMaterial({
    color: "#d7a33d",
    metalness: 0.92,
    roughness: 0.24,
    roughnessMap: goldRoughness,
    clearcoat: 0.22,
    clearcoatRoughness: 0.085,
    envMapIntensity: 1.65,
  });

  const polishedGold = gold.clone();
  polishedGold.name = "polished-gold-crest";
  polishedGold.color.set("#e4b957");
  polishedGold.roughness = 0.17;
  polishedGold.envMapIntensity = 1.82;

  const recess = gold.clone();
  recess.name = "warm-gold-groove";
  recess.color.set("#8c6727");
  recess.roughness = 0.38;
  recess.clearcoat = 0.08;
  recess.envMapIntensity = 1.12;

  return { clay, jade, gold, polishedGold, recess };
}
