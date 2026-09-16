import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function buildLatheGeometry(profile: { points: [number, number][]; segments?: number }): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(points, profile.segments ?? 24);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const [red, green, blue] = hexToRgb(source);
  return new THREE.Color(red / 255, green / 255, blue / 255);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  const textures = makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Jade and Gold Ornamental Key
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createJadeAndGoldOrnamentalKeyModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Jade and Gold Ornamental Key";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "projection": "orthographic", "fovDegrees": 28, "aspect": 0.55, "orientation": {"yaw": 0, "pitch": 0, "roll": 0}, "positionHint": [0, 0, 4.6], "note": "Front crop is presentation-style with minimal perspective; use orthographic review framing. Side crop independently constrains depth."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["jade"] = createSculptMaterial(
    "jade",
    {"id": "jade", "name": "Polished pale jade", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#dedfc9", "color": "#dedfc9", "albedo": {"dominant": "#BBB597", "secondary": ["#BEB89A", "#C0BB9E", "#B8B294"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/jade/jade_albedo.png", "url": "jade_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#BBB597", "#BEB89A", "#C0BB9E", "#B8B294", "#C4BEA3"], "pattern": "reference-derived pixel palette", "amplitude": 0.08, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "generated-object-space", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Stable world-scale detail."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.308, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14, "amplitude": 0.272, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72, "amplitude": 0.125, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.26, "variation": 0.06, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/jade/jade_roughness.png", "url": "/models/jade-key/materials/jade_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "localResponse": "Polished rim drops toward 0.12 while cloudy inclusions rise toward 0.32; extracted 0.709 scalar is not used because the crop lacks the broad rim highlight."}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "independent reference-derived cloud height field", "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/jade/jade_normal.png", "url": "/models/jade-key/materials/jade_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "strength": 0.1, "scale": 9, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.013, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/jade/jade_height.png", "url": "jade_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/jade/jade_ao.png", "url": "jade_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#4a3d2a"}, "localOverrides": [{"id": "jade.cloud-inclusions", "region": "broad irregular patches across both jade faces", "baseColor": "#c6ccb0", "roughness": 0.3, "strength": 0.12, "evidenceRefs": ["front-head", "right-head"]}, {"id": "jade.polished-rim", "region": "upper-left curved rim under reference key light", "roughness": 0.12, "clearcoat": 0.58, "clearcoatRoughness": 0.08, "evidenceRefs": ["front-head"]}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Albedo, roughness, height/normal and AO are independent deterministic fields.", "No scratches, patina or damage are introduced because the reference shows a pristine presentation finish.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "transmission": {"base": 0.38, "variation": 0.05}, "thickness": {"base": 0.18, "variation": 0.03}, "ior": {"base": 1.52, "value": 1.52}, "clearcoat": {"base": 0.45, "variation": 0.08}, "clearcoatRoughness": {"base": 0.11, "variation": 0.03}, "transparent": true, "opacity": 0.94, "finishClass": "polished-gemstone", "texturePalette": ["#C4BFA4", "#C1BCA0", "#BDB79A", "#BAB496", "#BAB394"], "proceduralTexture": "flat-clearcoat", "envMapIntensity": 1, "referencePbr": {"version": "1.0", "sourceImage": "/Users/openclaw/Documents/Product/.img2threejs/material-crops/jade.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.8, "estimatedFidelity": 0.8, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/jade/jade_albedo.png", "url": "/models/jade-key/materials/jade_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/jade/jade_roughness.png", "url": "/models/jade-key/materials/jade_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/jade/jade_height.png", "url": "/models/jade-key/materials/jade_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/jade/jade_normal.png", "url": "/models/jade-key/materials/jade_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/jade/jade_ao.png", "url": "/models/jade-key/materials/jade_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 108, "sourceHeight": 52, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 108, "height": 52}, "mask": {"backgroundColor": "#BFBA9A", "backgroundNoise": 15.843, "transparentPixelFraction": 0, "foregroundCoverage": 0.8803}, "mapStats": {"valueRange": 0.08, "heightP90Gradient": 0.029, "roughnessBase": 0.709, "roughnessVariation": 0.052, "normalStrength": 0.19, "blurRadius": 21}, "palette": ["#BBB597", "#BEB89A", "#C0BB9E", "#B8B294", "#C4BEA3"]}, "warnings": ["low value range weakens height/roughness inference"]}},
    options
  );
  materialMap["gold"] = createSculptMaterial(
    "gold",
    {"id": "gold", "name": "Warm polished gold", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#d39d36", "color": "#d39d36", "albedo": {"dominant": "#E4C68E", "secondary": ["#A07C41", "#71511D", "#CFAD72"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/gold/gold_albedo.png", "url": "gold_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#E4C68E", "#A07C41", "#71511D", "#CFAD72", "#F4E1BA"], "pattern": "reference-derived pixel palette", "amplitude": 0.266, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "generated-object-space", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Stable world-scale detail."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.502, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14, "amplitude": 0.302, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.18, "variation": 0.07, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/gold/gold_roughness.png", "url": "/models/jade-key/materials/gold_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "localResponse": "Exposed highlight crests approach 0.09 while protected seams approach 0.26; source luminance was not treated as direct scalar roughness."}, "metalness": {"base": 1, "variation": 0}, "normal": {"pattern": "independent subtle axial polish field", "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/gold/gold_normal.png", "url": "/models/jade-key/materials/gold_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "strength": 0.035, "scale": 56, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.016, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/gold/gold_height.png", "url": "gold_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/gold/gold_ao.png", "url": "gold_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#4a3d2a"}, "localOverrides": [{"id": "gold.polished-collar-crests", "region": "neck cup and torus collar crests", "roughness": 0.09, "strength": 0.9, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft"]}, {"id": "gold.shaft-axial-highlight", "region": "camera-left longitudinal shaft band", "roughness": 0.1, "strength": 0.7, "evidenceRefs": ["front-neck-shaft"]}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Albedo, roughness, height/normal and AO are independent deterministic fields.", "No scratches, patina or damage are introduced because the reference shows a pristine presentation finish.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "clearcoat": {"base": 0.12, "variation": 0.02}, "clearcoatRoughness": {"base": 0.1, "variation": 0.02}, "envMapIntensity": 1.3, "finishClass": "polished-gold-metal", "texturePalette": ["#F5EDE2", "#B38D51", "#E6C791", "#7E5C26", "#D7CAB6"], "proceduralTexture": "gradient-smoke", "transmission": {"base": 0, "variation": 0}, "ior": {"base": 1.5, "value": 1.5}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/openclaw/Documents/Product/.img2threejs/material-crops/gold.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.909, "estimatedFidelity": 0.909, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/gold/gold_albedo.png", "url": "/models/jade-key/materials/gold_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/gold/gold_roughness.png", "url": "/models/jade-key/materials/gold_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/gold/gold_height.png", "url": "/models/jade-key/materials/gold_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/gold/gold_normal.png", "url": "/models/jade-key/materials/gold_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/gold/gold_ao.png", "url": "/models/jade-key/materials/gold_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 48, "sourceHeight": 310, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 48, "height": 310}, "mask": {"backgroundColor": "#DFD2C0", "backgroundNoise": 114.127, "transparentPixelFraction": 0, "foregroundCoverage": 0.7612}, "mapStats": {"valueRange": 0.6334, "heightP90Gradient": 0.0361, "roughnessBase": 0.701, "roughnessVariation": 0.067, "normalStrength": 0.199, "blurRadius": 21}, "palette": ["#E4C68E", "#A07C41", "#71511D", "#CFAD72", "#F4E1BA"]}, "warnings": []}},
    options
  );
  materialMap["recess"] = createSculptMaterial(
    "recess",
    {"id": "recess", "name": "Warm neutral aperture recess", "type": "standard", "shaderModel": "MeshStandardMaterial", "baseColor": "#5b4b2f", "color": "#5b4b2f", "albedo": {"dominant": "#C8B79A", "secondary": ["#C2B092", "#CEBEA4", "#D6C8B1"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/recess/recess_albedo.png", "url": "recess_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#C8B79A", "#C2B092", "#CEBEA4", "#D6C8B1", "#A17833"], "pattern": "reference-derived pixel palette", "amplitude": 0.126, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "generated-object-space", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Stable world-scale detail."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.385, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14, "amplitude": 0.212, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72, "amplitude": 0.09, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.52, "variation": 0.08, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/recess/recess_roughness.png", "url": "/models/jade-key/materials/recess_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "localResponse": "Inner walls remain rougher than the frame so the square negative space stays readable."}, "metalness": {"base": 0.08, "variation": 0.03}, "normal": {"pattern": "independent fine matte field", "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/recess/recess_normal.png", "url": "/models/jade-key/materials/recess_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "strength": 0.08, "scale": 32, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.01, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/recess/recess_height.png", "url": "recess_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/recess/recess_ao.png", "url": "recess_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#4a3d2a"}, "localOverrides": [{"id": "recess.inner-wall-ao", "region": "square cavity inner walls", "roughness": 0.58, "strength": 0.8, "evidenceRefs": ["front-head", "right-head"]}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Albedo, roughness, height/normal and AO are independent deterministic fields.", "No scratches, patina or damage are introduced because the reference shows a pristine presentation finish.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "envMapIntensity": 1, "finishClass": "warm-neutral-cavity-backing", "texturePalette": ["#A37730", "#C6B496", "#CEBFA5", "#DBCEB9", "#E2D7C4"], "proceduralTexture": "flat-clearcoat", "clearcoat": {"base": 0.04, "variation": 0.01}, "clearcoatRoughness": {"base": 0.45, "variation": 0.05}, "transmission": {"base": 0, "variation": 0}, "ior": {"base": 1.5, "value": 1.5}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/openclaw/Documents/Product/.img2threejs/material-crops/recess.png", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.826, "estimatedFidelity": 0.826, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/recess/recess_albedo.png", "url": "/models/jade-key/materials/recess_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/recess/recess_roughness.png", "url": "/models/jade-key/materials/recess_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/recess/recess_height.png", "url": "/models/jade-key/materials/recess_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/recess/recess_normal.png", "url": "/models/jade-key/materials/recess_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/openclaw/Documents/Product/.img2threejs/material-evidence/recess/recess_ao.png", "url": "/models/jade-key/materials/recess_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 88, "sourceHeight": 86, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 88, "height": 86}, "mask": {"backgroundColor": "#C3B499", "backgroundNoise": 123.847, "transparentPixelFraction": 0, "foregroundCoverage": 0.7147}, "mapStats": {"valueRange": 0.2989, "heightP90Gradient": 0.01467, "roughnessBase": 0.688, "roughnessVariation": 0.05, "normalStrength": 0.173, "blurRadius": 21}, "palette": ["#C8B79A", "#C2B092", "#CEBEA4", "#D6C8B1", "#A17833"]}, "warnings": ["single-image inverse rendering cannot prove true physical PBR; confidence is capped"]}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const attachment_root_0 = null;
  const endpoint_root_0 = makeAttachmentEndpoint(attachment_root_0);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "Jade key assembly root__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Jade key assembly root", "level": "macro", "role": "root", "importance": 1, "confidence": 1, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A transform container represented by a negligible rigid proxy while named child solids carry the visible silhouette.", "geometryDescriptor": {"topologyIntent": "A transform container represented by a negligible rigid proxy while named child solids carry the visible silhouette.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "head-socket", "localPosition": [0, 0.76, 0], "localRotation": [0, 0, 0]}, {"id": "neck-socket", "localPosition": [0, 0.28, 0], "localRotation": [0, 0, 0]}, {"id": "shaft-socket", "localPosition": [0, -0.42, 0], "localRotation": [0, 0, 0]}, {"id": "bit-socket", "localPosition": [0.12, -0.95, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "root.uniform-scale", "type": "socket", "description": "Nominal 2.4-unit total length remains uniformly scalable.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "stable root pivot", "confidence": 0.86, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["full-object"]}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "head-socket", "localPosition": [0, 0.76, 0], "localRotation": [0, 0, 0]}, {"id": "neck-socket", "localPosition": [0, 0.28, 0], "localRotation": [0, 0, 0]}, {"id": "shaft-socket", "localPosition": [0, -0.42, 0], "localRotation": [0, 0, 0]}, {"id": "bit-socket", "localPosition": [0.12, -0.95, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "gold"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "Jade key assembly root";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Jade key assembly root", "level": "macro", "role": "root", "importance": 1, "confidence": 1, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A transform container represented by a negligible rigid proxy while named child solids carry the visible silhouette.", "geometryDescriptor": {"topologyIntent": "A transform container represented by a negligible rigid proxy while named child solids carry the visible silhouette.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "head-socket", "localPosition": [0, 0.76, 0], "localRotation": [0, 0, 0]}, {"id": "neck-socket", "localPosition": [0, 0.28, 0], "localRotation": [0, 0, 0]}, {"id": "shaft-socket", "localPosition": [0, -0.42, 0], "localRotation": [0, 0, 0]}, {"id": "bit-socket", "localPosition": [0.12, -0.95, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "root.uniform-scale", "type": "socket", "description": "Nominal 2.4-unit total length remains uniformly scalable.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "stable root pivot", "confidence": 0.86, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["full-object"]}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["shaft-assembly"] ??= [];
  destructionGroups["shaft-assembly"].push(node_root_0);
  const socket_root_head_socket_0 = new THREE.Object3D();
  socket_root_head_socket_0.name = "head-socket";
  socket_root_head_socket_0.position.set(0.0, 0.76, 0.0);
  socket_root_head_socket_0.rotation.set(0.0, 0.0, 0.0);
  socket_root_head_socket_0.userData.socket = {"id": "head-socket", "localPosition": [0, 0.76, 0], "localRotation": [0, 0, 0]};
  node_root_0.add(socket_root_head_socket_0);
  sockets["root:head-socket"] = socket_root_head_socket_0;
  const socket_root_neck_socket_1 = new THREE.Object3D();
  socket_root_neck_socket_1.name = "neck-socket";
  socket_root_neck_socket_1.position.set(0.0, 0.28, 0.0);
  socket_root_neck_socket_1.rotation.set(0.0, 0.0, 0.0);
  socket_root_neck_socket_1.userData.socket = {"id": "neck-socket", "localPosition": [0, 0.28, 0], "localRotation": [0, 0, 0]};
  node_root_0.add(socket_root_neck_socket_1);
  sockets["root:neck-socket"] = socket_root_neck_socket_1;
  const socket_root_shaft_socket_2 = new THREE.Object3D();
  socket_root_shaft_socket_2.name = "shaft-socket";
  socket_root_shaft_socket_2.position.set(0.0, -0.42, 0.0);
  socket_root_shaft_socket_2.rotation.set(0.0, 0.0, 0.0);
  socket_root_shaft_socket_2.userData.socket = {"id": "shaft-socket", "localPosition": [0, -0.42, 0], "localRotation": [0, 0, 0]};
  node_root_0.add(socket_root_shaft_socket_2);
  sockets["root:shaft-socket"] = socket_root_shaft_socket_2;
  const socket_root_bit_socket_3 = new THREE.Object3D();
  socket_root_bit_socket_3.name = "bit-socket";
  socket_root_bit_socket_3.position.set(0.12, -0.95, 0.0);
  socket_root_bit_socket_3.rotation.set(0.0, 0.0, 0.0);
  socket_root_bit_socket_3.userData.socket = {"id": "bit-socket", "localPosition": [0.12, -0.95, 0], "localRotation": [0, 0, 0]};
  node_root_0.add(socket_root_bit_socket_3);
  sockets["root:bit-socket"] = socket_root_bit_socket_3;

  const attachment_jade_disc_1 = {"parentId": "root", "parentSocket": "head-socket", "localStart": [0, -0.42, 0], "localEnd": [0, -0.39, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-head", "right-head"]};
  const endpoint_jade_disc_1 = makeAttachmentEndpoint(attachment_jade_disc_1);
  const node_jade_disc_1 = new THREE.Group();
  node_jade_disc_1.name = "Convex jade disc__pivot";
  node_jade_disc_1.scale.set(1, 1, 1);
  if (endpoint_jade_disc_1) {
    node_jade_disc_1.position.copy(endpoint_jade_disc_1.start);
    node_jade_disc_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_jade_disc_1.position.set(0.0, 0.76, 0.0);
    node_jade_disc_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_jade_disc_1.userData.sculptComponent = {"id": "jade-disc", "name": "Convex jade disc", "level": "macro", "role": "static-part", "importance": 0.8, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "The head is one smoothly varying oblate convex volume with no internal panel seams.", "geometryDescriptor": {"topologyIntent": "The head is one smoothly varying oblate convex volume with no internal panel seams.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "head-socket", "localStart": [0, -0.42, 0], "localEnd": [0, -0.39, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-head", "right-head"]}, "dimensions": {"width": 0.84, "height": 0.84, "depth": 0.145, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.76, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "front-frame-socket", "localPosition": [0, 0, 0.078], "localRotation": [0, 0, 0]}, {"id": "rear-band-socket", "localPosition": [0, 0, -0.075], "localRotation": [0, 0, 0]}], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.84, 0.84, 0.145], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "head-assembly", "seamRefs": [], "detachableFragments": ["jade-disc"], "breakImpulse": 1, "debrisMaterial": "jade"}}, "material": "jade", "materialLayers": ["jade"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "jade-disc.convex-dome", "type": "contour", "description": "Oblate dome produces broad highlight rolloff in front and side views.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "non-planar ellipsoid depth", "confidence": 0.86, "evidenceRefs": ["front-head", "right-head"]}, {"id": "jade-disc.edge-softness", "type": "bevel", "description": "Rounded rim transitions continuously into both broad faces.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "continuous curved edge", "confidence": 0.86, "evidenceRefs": ["front-head", "right-head"]}], "surfaceDetail": {"macroRoughness": 0.08, "microRoughness": 0.1, "bumpAmplitude": 0.008, "normalPattern": "independent low-amplitude cloudy field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["front-head", "right-head"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(222, 224, 202, 1)", "secondaryAlbedo": "rgba(196, 202, 176, 1)", "materialClass": "stone", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(222, 224, 202, 1)"}, {"position": 1, "color": "rgba(196, 202, 176, 1)"}]}, "evidenceRefs": ["front-head", "right-head"]}};
  node_jade_disc_1.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "front-frame-socket", "localPosition": [0, 0, 0.078], "localRotation": [0, 0, 0]}, {"id": "rear-band-socket", "localPosition": [0, 0, -0.075], "localRotation": [0, 0, 0]}], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.84, 0.84, 0.145], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "head-assembly", "seamRefs": [], "detachableFragments": ["jade-disc"], "breakImpulse": 1, "debrisMaterial": "jade"}};
  (nodes["root"] ?? root).add(node_jade_disc_1);
  nodes["jade-disc"] = node_jade_disc_1;
  const mesh_jade_disc_1Geometry = endpoint_jade_disc_1
    ? new THREE.CylinderGeometry(endpoint_jade_disc_1.endRadius, endpoint_jade_disc_1.baseRadius, endpoint_jade_disc_1.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_jade_disc_1) {
    mesh_jade_disc_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_jade_disc_1 = new THREE.Mesh(
    mesh_jade_disc_1Geometry,
    materialMap["jade"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_jade_disc_1.name = "Convex jade disc";
  if (endpoint_jade_disc_1) {
    mesh_jade_disc_1.position.copy(endpoint_jade_disc_1.midpoint);
    mesh_jade_disc_1.quaternion.copy(endpoint_jade_disc_1.quaternion);
  }
  mesh_jade_disc_1.castShadow = options.castShadow ?? true;
  mesh_jade_disc_1.receiveShadow = options.receiveShadow ?? true;
  mesh_jade_disc_1.userData.sculptComponent = {"id": "jade-disc", "name": "Convex jade disc", "level": "macro", "role": "static-part", "importance": 0.8, "confidence": 0.9, "primitive": "ellipsoid", "topologyClass": "continuous-sculpt", "topologyRationale": "The head is one smoothly varying oblate convex volume with no internal panel seams.", "geometryDescriptor": {"topologyIntent": "The head is one smoothly varying oblate convex volume with no internal panel seams.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "head-socket", "localStart": [0, -0.42, 0], "localEnd": [0, -0.39, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-head", "right-head"]}, "dimensions": {"width": 0.84, "height": 0.84, "depth": 0.145, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.76, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "front-frame-socket", "localPosition": [0, 0, 0.078], "localRotation": [0, 0, 0]}, {"id": "rear-band-socket", "localPosition": [0, 0, -0.075], "localRotation": [0, 0, 0]}], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.84, 0.84, 0.145], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "head-assembly", "seamRefs": [], "detachableFragments": ["jade-disc"], "breakImpulse": 1, "debrisMaterial": "jade"}}, "material": "jade", "materialLayers": ["jade"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "jade-disc.convex-dome", "type": "contour", "description": "Oblate dome produces broad highlight rolloff in front and side views.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "non-planar ellipsoid depth", "confidence": 0.86, "evidenceRefs": ["front-head", "right-head"]}, {"id": "jade-disc.edge-softness", "type": "bevel", "description": "Rounded rim transitions continuously into both broad faces.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "continuous curved edge", "confidence": 0.86, "evidenceRefs": ["front-head", "right-head"]}], "surfaceDetail": {"macroRoughness": 0.08, "microRoughness": 0.1, "bumpAmplitude": 0.008, "normalPattern": "independent low-amplitude cloudy field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["front-head", "right-head"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(222, 224, 202, 1)", "secondaryAlbedo": "rgba(196, 202, 176, 1)", "materialClass": "stone", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(222, 224, 202, 1)"}, {"position": 1, "color": "rgba(196, 202, 176, 1)"}]}, "evidenceRefs": ["front-head", "right-head"]}};
  node_jade_disc_1.add(mesh_jade_disc_1);
  meshes["jade-disc"] = mesh_jade_disc_1;
  colliders["jade-disc"] = {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.84, 0.84, 0.145], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["head-assembly"] ??= [];
  destructionGroups["head-assembly"].push(node_jade_disc_1);
  const socket_jade_disc_front_frame_socket_0 = new THREE.Object3D();
  socket_jade_disc_front_frame_socket_0.name = "front-frame-socket";
  socket_jade_disc_front_frame_socket_0.position.set(0.0, 0.0, 0.078);
  socket_jade_disc_front_frame_socket_0.rotation.set(0.0, 0.0, 0.0);
  socket_jade_disc_front_frame_socket_0.userData.socket = {"id": "front-frame-socket", "localPosition": [0, 0, 0.078], "localRotation": [0, 0, 0]};
  node_jade_disc_1.add(socket_jade_disc_front_frame_socket_0);
  sockets["jade-disc:front-frame-socket"] = socket_jade_disc_front_frame_socket_0;
  const socket_jade_disc_rear_band_socket_1 = new THREE.Object3D();
  socket_jade_disc_rear_band_socket_1.name = "rear-band-socket";
  socket_jade_disc_rear_band_socket_1.position.set(0.0, 0.0, -0.075);
  socket_jade_disc_rear_band_socket_1.rotation.set(0.0, 0.0, 0.0);
  socket_jade_disc_rear_band_socket_1.userData.socket = {"id": "rear-band-socket", "localPosition": [0, 0, -0.075], "localRotation": [0, 0, 0]};
  node_jade_disc_1.add(socket_jade_disc_rear_band_socket_1);
  sockets["jade-disc:rear-band-socket"] = socket_jade_disc_rear_band_socket_1;

  const attachment_neck_assembly_2 = {"parentId": "root", "parentSocket": "neck-socket", "localStart": [0, 0.11, 0], "localEnd": [0, 0.16, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft"]};
  const endpoint_neck_assembly_2 = makeAttachmentEndpoint(attachment_neck_assembly_2);
  const node_neck_assembly_2 = new THREE.Group();
  node_neck_assembly_2.name = "Three-stage turned neck__pivot";
  node_neck_assembly_2.scale.set(1, 1, 1);
  if (endpoint_neck_assembly_2) {
    node_neck_assembly_2.position.copy(endpoint_neck_assembly_2.start);
    node_neck_assembly_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_neck_assembly_2.position.set(0.0, 0.25, 0.0);
    node_neck_assembly_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_neck_assembly_2.userData.sculptComponent = {"id": "neck-assembly", "name": "Three-stage turned neck", "level": "meso", "role": "static-part", "importance": 0.8, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Cup, pinched spindle and lower collar form one continuously revolved metal profile around the shaft axis.", "geometryDescriptor": {"topologyIntent": "Cup, pinched spindle and lower collar form one continuously revolved metal profile around the shaft axis.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation", "latheProfile": {"points": [[0.055, -0.12], [0.09, -0.1], [0.115, -0.075], [0.105, -0.045], [0.07, -0.025], [0.065, 0.02], [0.09, 0.05], [0.135, 0.075], [0.15, 0.105], [0.13, 0.125]], "segments": 48}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "neck-socket", "localStart": [0, 0.11, 0], "localEnd": [0, 0.16, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft"]}, "dimensions": {"width": 0.3, "height": 0.25, "depth": 0.3, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.25, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "shaft-top-socket", "localPosition": [0, -0.12, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.25, 0.3], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["neck-assembly"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "neck-assembly.three-stage-lathe-profile", "type": "contour", "description": "Cup, spindle waist and torus-like collar remain three readable radial stages.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "continuous lathe profile", "confidence": 0.86, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft"]}};
  node_neck_assembly_2.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "shaft-top-socket", "localPosition": [0, -0.12, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.25, 0.3], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["neck-assembly"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["root"] ?? root).add(node_neck_assembly_2);
  nodes["neck-assembly"] = node_neck_assembly_2;
  const mesh_neck_assembly_2Geometry = endpoint_neck_assembly_2
    ? new THREE.CylinderGeometry(endpoint_neck_assembly_2.endRadius, endpoint_neck_assembly_2.baseRadius, endpoint_neck_assembly_2.length, 16, 6)
    : buildLatheGeometry({"points": [[0.055, -0.12], [0.09, -0.1], [0.115, -0.075], [0.105, -0.045], [0.07, -0.025], [0.065, 0.02], [0.09, 0.05], [0.135, 0.075], [0.15, 0.105], [0.13, 0.125]], "segments": 48});
  if (!endpoint_neck_assembly_2) {
    mesh_neck_assembly_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_neck_assembly_2 = new THREE.Mesh(
    mesh_neck_assembly_2Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_neck_assembly_2.name = "Three-stage turned neck";
  if (endpoint_neck_assembly_2) {
    mesh_neck_assembly_2.position.copy(endpoint_neck_assembly_2.midpoint);
    mesh_neck_assembly_2.quaternion.copy(endpoint_neck_assembly_2.quaternion);
  }
  mesh_neck_assembly_2.castShadow = options.castShadow ?? true;
  mesh_neck_assembly_2.receiveShadow = options.receiveShadow ?? true;
  mesh_neck_assembly_2.userData.sculptComponent = {"id": "neck-assembly", "name": "Three-stage turned neck", "level": "meso", "role": "static-part", "importance": 0.8, "confidence": 0.9, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "Cup, pinched spindle and lower collar form one continuously revolved metal profile around the shaft axis.", "geometryDescriptor": {"topologyIntent": "Cup, pinched spindle and lower collar form one continuously revolved metal profile around the shaft axis.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation", "latheProfile": {"points": [[0.055, -0.12], [0.09, -0.1], [0.115, -0.075], [0.105, -0.045], [0.07, -0.025], [0.065, 0.02], [0.09, 0.05], [0.135, 0.075], [0.15, 0.105], [0.13, 0.125]], "segments": 48}}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "neck-socket", "localStart": [0, 0.11, 0], "localEnd": [0, 0.16, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft"]}, "dimensions": {"width": 0.3, "height": 0.25, "depth": 0.3, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, 0.25, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "shaft-top-socket", "localPosition": [0, -0.12, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.25, 0.3], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["neck-assembly"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "neck-assembly.three-stage-lathe-profile", "type": "contour", "description": "Cup, spindle waist and torus-like collar remain three readable radial stages.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "continuous lathe profile", "confidence": 0.86, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft"]}};
  node_neck_assembly_2.add(mesh_neck_assembly_2);
  meshes["neck-assembly"] = mesh_neck_assembly_2;
  colliders["neck-assembly"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.3, 0.25, 0.3], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["shaft-assembly"] ??= [];
  destructionGroups["shaft-assembly"].push(node_neck_assembly_2);
  const socket_neck_assembly_shaft_top_socket_0 = new THREE.Object3D();
  socket_neck_assembly_shaft_top_socket_0.name = "shaft-top-socket";
  socket_neck_assembly_shaft_top_socket_0.position.set(0.0, -0.12, 0.0);
  socket_neck_assembly_shaft_top_socket_0.rotation.set(0.0, 0.0, 0.0);
  socket_neck_assembly_shaft_top_socket_0.userData.socket = {"id": "shaft-top-socket", "localPosition": [0, -0.12, 0], "localRotation": [0, 0, 0]};
  node_neck_assembly_2.add(socket_neck_assembly_shaft_top_socket_0);
  sockets["neck-assembly:shaft-top-socket"] = socket_neck_assembly_shaft_top_socket_0;

  const attachment_shaft_core_3 = {"parentId": "root", "parentSocket": "shaft-socket", "localStart": [0, 0.64, 0], "localEnd": [0, 0.69, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft"]};
  const endpoint_shaft_core_3 = makeAttachmentEndpoint(attachment_shaft_core_3);
  const node_shaft_core_3 = new THREE.Group();
  node_shaft_core_3.name = "Polished cylindrical shaft__pivot";
  node_shaft_core_3.scale.set(1, 1, 1);
  if (endpoint_shaft_core_3) {
    node_shaft_core_3.position.copy(endpoint_shaft_core_3.start);
    node_shaft_core_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shaft_core_3.position.set(0.0, -0.47, 0.0);
    node_shaft_core_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_shaft_core_3.userData.sculptComponent = {"id": "shaft-core", "name": "Polished cylindrical shaft", "level": "macro", "role": "static-part", "importance": 0.8, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The long handle is a straight rigid cylinder with a constant circular cross-section and capped distal end.", "geometryDescriptor": {"topologyIntent": "The long handle is a straight rigid cylinder with a constant circular cross-section and capped distal end.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "shaft-socket", "localStart": [0, 0.64, 0], "localEnd": [0, 0.69, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft"]}, "dimensions": {"width": 0.085, "height": 1.35, "depth": 0.085, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, -0.47, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "upper-bit-socket", "localPosition": [0.04, -0.43, 0], "localRotation": [0, 0, 0]}, {"id": "lower-bit-socket", "localPosition": [0.04, -0.64, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.085, 1.35, 0.085], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["shaft-core"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shaft-core.rounded-distal-cap", "type": "bevel", "description": "The shaft terminates with a narrow rounded cap below the lower bit.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "rounded cylinder cap", "confidence": 0.86, "evidenceRefs": ["front-bit", "right-bit"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft", "front-bit"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft", "front-bit"]}};
  node_shaft_core_3.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "upper-bit-socket", "localPosition": [0.04, -0.43, 0], "localRotation": [0, 0, 0]}, {"id": "lower-bit-socket", "localPosition": [0.04, -0.64, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.085, 1.35, 0.085], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["shaft-core"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["root"] ?? root).add(node_shaft_core_3);
  nodes["shaft-core"] = node_shaft_core_3;
  const mesh_shaft_core_3Geometry = endpoint_shaft_core_3
    ? new THREE.CylinderGeometry(endpoint_shaft_core_3.endRadius, endpoint_shaft_core_3.baseRadius, endpoint_shaft_core_3.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_shaft_core_3) {
    mesh_shaft_core_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_shaft_core_3 = new THREE.Mesh(
    mesh_shaft_core_3Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shaft_core_3.name = "Polished cylindrical shaft";
  if (endpoint_shaft_core_3) {
    mesh_shaft_core_3.position.copy(endpoint_shaft_core_3.midpoint);
    mesh_shaft_core_3.quaternion.copy(endpoint_shaft_core_3.quaternion);
  }
  mesh_shaft_core_3.castShadow = options.castShadow ?? true;
  mesh_shaft_core_3.receiveShadow = options.receiveShadow ?? true;
  mesh_shaft_core_3.userData.sculptComponent = {"id": "shaft-core", "name": "Polished cylindrical shaft", "level": "macro", "role": "static-part", "importance": 0.8, "confidence": 0.9, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "The long handle is a straight rigid cylinder with a constant circular cross-section and capped distal end.", "geometryDescriptor": {"topologyIntent": "The long handle is a straight rigid cylinder with a constant circular cross-section and capped distal end.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "shaft-socket", "localStart": [0, 0.64, 0], "localEnd": [0, 0.69, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft"]}, "dimensions": {"width": 0.085, "height": 1.35, "depth": 0.085, "units": "relative", "confidence": 0.9}, "transform": {"position": [0, -0.47, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "upper-bit-socket", "localPosition": [0.04, -0.43, 0], "localRotation": [0, 0, 0]}, {"id": "lower-bit-socket", "localPosition": [0.04, -0.64, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.085, 1.35, 0.085], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["shaft-core"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shaft-core.rounded-distal-cap", "type": "bevel", "description": "The shaft terminates with a narrow rounded cap below the lower bit.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "rounded cylinder cap", "confidence": 0.86, "evidenceRefs": ["front-bit", "right-bit"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft", "front-bit"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["front-neck-shaft", "right-neck-shaft", "front-bit"]}};
  node_shaft_core_3.add(mesh_shaft_core_3);
  meshes["shaft-core"] = mesh_shaft_core_3;
  colliders["shaft-core"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.085, 1.35, 0.085], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["shaft-assembly"] ??= [];
  destructionGroups["shaft-assembly"].push(node_shaft_core_3);
  const socket_shaft_core_upper_bit_socket_0 = new THREE.Object3D();
  socket_shaft_core_upper_bit_socket_0.name = "upper-bit-socket";
  socket_shaft_core_upper_bit_socket_0.position.set(0.04, -0.43, 0.0);
  socket_shaft_core_upper_bit_socket_0.rotation.set(0.0, 0.0, 0.0);
  socket_shaft_core_upper_bit_socket_0.userData.socket = {"id": "upper-bit-socket", "localPosition": [0.04, -0.43, 0], "localRotation": [0, 0, 0]};
  node_shaft_core_3.add(socket_shaft_core_upper_bit_socket_0);
  sockets["shaft-core:upper-bit-socket"] = socket_shaft_core_upper_bit_socket_0;
  const socket_shaft_core_lower_bit_socket_1 = new THREE.Object3D();
  socket_shaft_core_lower_bit_socket_1.name = "lower-bit-socket";
  socket_shaft_core_lower_bit_socket_1.position.set(0.04, -0.64, 0.0);
  socket_shaft_core_lower_bit_socket_1.rotation.set(0.0, 0.0, 0.0);
  socket_shaft_core_lower_bit_socket_1.userData.socket = {"id": "lower-bit-socket", "localPosition": [0.04, -0.64, 0], "localRotation": [0, 0, 0]};
  node_shaft_core_3.add(socket_shaft_core_lower_bit_socket_1);
  sockets["shaft-core:lower-bit-socket"] = socket_shaft_core_lower_bit_socket_1;

  const attachment_upper_bit_bridge_4 = {"parentId": "shaft-core", "parentSocket": "upper-bit-socket", "localStart": [0, 0, 0], "localEnd": [0.13, 0, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]};
  const endpoint_upper_bit_bridge_4 = makeAttachmentEndpoint(attachment_upper_bit_bridge_4);
  const node_upper_bit_bridge_4 = new THREE.Group();
  node_upper_bit_bridge_4.name = "Upper bit bridge__pivot";
  node_upper_bit_bridge_4.scale.set(1, 1, 1);
  if (endpoint_upper_bit_bridge_4) {
    node_upper_bit_bridge_4.position.copy(endpoint_upper_bit_bridge_4.start);
    node_upper_bit_bridge_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_upper_bit_bridge_4.position.set(0.065, -0.42, 0.0);
    node_upper_bit_bridge_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_upper_bit_bridge_4.userData.sculptComponent = {"id": "upper-bit-bridge", "name": "Upper bit bridge", "level": "meso", "role": "static-part", "importance": 0.8, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A short rigid rectangular connector overlaps the cylindrical shaft and upper plate.", "geometryDescriptor": {"topologyIntent": "A short rigid rectangular connector overlaps the cylindrical shaft and upper plate.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "shaft-core", "attachment": {"parentId": "shaft-core", "parentSocket": "upper-bit-socket", "localStart": [0, 0, 0], "localEnd": [0.13, 0, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]}, "dimensions": {"width": 0.13, "height": 0.045, "depth": 0.07, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.065, -0.42, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.13, 0.045, 0.07], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["upper-bit-bridge"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bit-bridges.shaft-overlap-seams", "type": "seam", "description": "Bridge overlaps the shaft to prevent a floating bit plate.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "physical overlap and contact seam", "confidence": 0.86, "evidenceRefs": ["front-bit", "right-bit"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["front-bit", "right-bit"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["front-bit", "right-bit"]}};
  node_upper_bit_bridge_4.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.13, 0.045, 0.07], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["upper-bit-bridge"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["shaft-core"] ?? root).add(node_upper_bit_bridge_4);
  nodes["upper-bit-bridge"] = node_upper_bit_bridge_4;
  const mesh_upper_bit_bridge_4Geometry = endpoint_upper_bit_bridge_4
    ? new THREE.CylinderGeometry(endpoint_upper_bit_bridge_4.endRadius, endpoint_upper_bit_bridge_4.baseRadius, endpoint_upper_bit_bridge_4.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_upper_bit_bridge_4) {
    mesh_upper_bit_bridge_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_upper_bit_bridge_4 = new THREE.Mesh(
    mesh_upper_bit_bridge_4Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_bit_bridge_4.name = "Upper bit bridge";
  if (endpoint_upper_bit_bridge_4) {
    mesh_upper_bit_bridge_4.position.copy(endpoint_upper_bit_bridge_4.midpoint);
    mesh_upper_bit_bridge_4.quaternion.copy(endpoint_upper_bit_bridge_4.quaternion);
  }
  mesh_upper_bit_bridge_4.castShadow = options.castShadow ?? true;
  mesh_upper_bit_bridge_4.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_bit_bridge_4.userData.sculptComponent = {"id": "upper-bit-bridge", "name": "Upper bit bridge", "level": "meso", "role": "static-part", "importance": 0.8, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A short rigid rectangular connector overlaps the cylindrical shaft and upper plate.", "geometryDescriptor": {"topologyIntent": "A short rigid rectangular connector overlaps the cylindrical shaft and upper plate.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "shaft-core", "attachment": {"parentId": "shaft-core", "parentSocket": "upper-bit-socket", "localStart": [0, 0, 0], "localEnd": [0.13, 0, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]}, "dimensions": {"width": 0.13, "height": 0.045, "depth": 0.07, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.065, -0.42, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.13, 0.045, 0.07], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["upper-bit-bridge"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bit-bridges.shaft-overlap-seams", "type": "seam", "description": "Bridge overlaps the shaft to prevent a floating bit plate.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "physical overlap and contact seam", "confidence": 0.86, "evidenceRefs": ["front-bit", "right-bit"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["front-bit", "right-bit"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["front-bit", "right-bit"]}};
  node_upper_bit_bridge_4.add(mesh_upper_bit_bridge_4);
  meshes["upper-bit-bridge"] = mesh_upper_bit_bridge_4;
  colliders["upper-bit-bridge"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.13, 0.045, 0.07], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["bit-assembly"] ??= [];
  destructionGroups["bit-assembly"].push(node_upper_bit_bridge_4);

  const attachment_upper_bit_plate_5 = {"parentId": "upper-bit-bridge", "parentSocket": "upper-bit-bridge-surface", "localStart": [-0.13, 0, 0], "localEnd": [-0.08, 0, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]};
  const endpoint_upper_bit_plate_5 = makeAttachmentEndpoint(attachment_upper_bit_plate_5);
  const node_upper_bit_plate_5 = new THREE.Group();
  node_upper_bit_plate_5.name = "Upper rectangular bit plate__pivot";
  node_upper_bit_plate_5.scale.set(1, 1, 1);
  if (endpoint_upper_bit_plate_5) {
    node_upper_bit_plate_5.position.copy(endpoint_upper_bit_plate_5.start);
    node_upper_bit_plate_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_upper_bit_plate_5.position.set(0.12, -0.035, -0.0325);
    node_upper_bit_plate_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_upper_bit_plate_5.userData.sculptComponent = {"id": "upper-bit-plate", "name": "Upper rectangular bit plate", "level": "meso", "role": "static-part", "importance": 0.8, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A discrete rigid plate with countable planar faces and a narrow real bevel supports the raised meander relief.", "geometryDescriptor": {"topologyIntent": "A discrete rigid plate with countable planar faces and a narrow real bevel supports the raised meander relief.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation", "profile2D": {"points": [[-0.115, -0.11], [0.115, -0.11], [0.115, 0.11], [-0.115, 0.11]], "depth": 0.065}}, "parent": "upper-bit-bridge", "attachment": {"parentId": "upper-bit-bridge", "parentSocket": "upper-bit-bridge-surface", "localStart": [-0.13, 0, 0], "localEnd": [-0.08, 0, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]}, "dimensions": {"width": 0.23, "height": 0.22, "depth": 0.065, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.12, -0.035, -0.0325], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.23, 0.22, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["upper-bit-plate"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bit-plates.rounded-bevels", "type": "bevel", "description": "Plate perimeter carries a narrow rounded highlight and darker inset field.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "real edge bevel", "confidence": 0.86, "evidenceRefs": ["front-bit", "right-bit"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["front-bit", "right-bit"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["front-bit", "right-bit"]}};
  node_upper_bit_plate_5.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.23, 0.22, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["upper-bit-plate"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["upper-bit-bridge"] ?? root).add(node_upper_bit_plate_5);
  nodes["upper-bit-plate"] = node_upper_bit_plate_5;
  const mesh_upper_bit_plate_5Geometry = endpoint_upper_bit_plate_5
    ? new THREE.CylinderGeometry(endpoint_upper_bit_plate_5.endRadius, endpoint_upper_bit_plate_5.baseRadius, endpoint_upper_bit_plate_5.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.115, -0.11], [0.115, -0.11], [0.115, 0.11], [-0.115, 0.11]], "depth": 0.065});
  if (!endpoint_upper_bit_plate_5) {
    mesh_upper_bit_plate_5Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_upper_bit_plate_5 = new THREE.Mesh(
    mesh_upper_bit_plate_5Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_bit_plate_5.name = "Upper rectangular bit plate";
  if (endpoint_upper_bit_plate_5) {
    mesh_upper_bit_plate_5.position.copy(endpoint_upper_bit_plate_5.midpoint);
    mesh_upper_bit_plate_5.quaternion.copy(endpoint_upper_bit_plate_5.quaternion);
  }
  mesh_upper_bit_plate_5.castShadow = options.castShadow ?? true;
  mesh_upper_bit_plate_5.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_bit_plate_5.userData.sculptComponent = {"id": "upper-bit-plate", "name": "Upper rectangular bit plate", "level": "meso", "role": "static-part", "importance": 0.8, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A discrete rigid plate with countable planar faces and a narrow real bevel supports the raised meander relief.", "geometryDescriptor": {"topologyIntent": "A discrete rigid plate with countable planar faces and a narrow real bevel supports the raised meander relief.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation", "profile2D": {"points": [[-0.115, -0.11], [0.115, -0.11], [0.115, 0.11], [-0.115, 0.11]], "depth": 0.065}}, "parent": "upper-bit-bridge", "attachment": {"parentId": "upper-bit-bridge", "parentSocket": "upper-bit-bridge-surface", "localStart": [-0.13, 0, 0], "localEnd": [-0.08, 0, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]}, "dimensions": {"width": 0.23, "height": 0.22, "depth": 0.065, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.12, -0.035, -0.0325], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.23, 0.22, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["upper-bit-plate"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bit-plates.rounded-bevels", "type": "bevel", "description": "Plate perimeter carries a narrow rounded highlight and darker inset field.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "real edge bevel", "confidence": 0.86, "evidenceRefs": ["front-bit", "right-bit"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["front-bit", "right-bit"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["front-bit", "right-bit"]}};
  node_upper_bit_plate_5.add(mesh_upper_bit_plate_5);
  meshes["upper-bit-plate"] = mesh_upper_bit_plate_5;
  colliders["upper-bit-plate"] = {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.23, 0.22, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["bit-assembly"] ??= [];
  destructionGroups["bit-assembly"].push(node_upper_bit_plate_5);

  const attachment_lower_bit_bridge_6 = {"parentId": "shaft-core", "parentSocket": "lower-bit-socket", "localStart": [0, 0, 0], "localEnd": [0.13, 0, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]};
  const endpoint_lower_bit_bridge_6 = makeAttachmentEndpoint(attachment_lower_bit_bridge_6);
  const node_lower_bit_bridge_6 = new THREE.Group();
  node_lower_bit_bridge_6.name = "Lower bit bridge__pivot";
  node_lower_bit_bridge_6.scale.set(1, 1, 1);
  if (endpoint_lower_bit_bridge_6) {
    node_lower_bit_bridge_6.position.copy(endpoint_lower_bit_bridge_6.start);
    node_lower_bit_bridge_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lower_bit_bridge_6.position.set(0.065, -0.63, 0.0);
    node_lower_bit_bridge_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_lower_bit_bridge_6.userData.sculptComponent = {"id": "lower-bit-bridge", "name": "Lower bit bridge", "level": "meso", "role": "static-part", "importance": 0.8, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A second short rigid connector overlaps the shaft and lower plate.", "geometryDescriptor": {"topologyIntent": "A second short rigid connector overlaps the shaft and lower plate.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "shaft-core", "attachment": {"parentId": "shaft-core", "parentSocket": "lower-bit-socket", "localStart": [0, 0, 0], "localEnd": [0.13, 0, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]}, "dimensions": {"width": 0.13, "height": 0.045, "depth": 0.07, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.065, -0.63, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.13, 0.045, 0.07], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["lower-bit-bridge"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lower-bit-bridge.contact-seam", "type": "seam", "description": "Lower bridge repeats the visible shaft-to-plate connection.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "physical overlap and contact seam", "confidence": 0.86, "evidenceRefs": ["front-bit", "right-bit"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["front-bit", "right-bit"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["front-bit", "right-bit"]}};
  node_lower_bit_bridge_6.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.13, 0.045, 0.07], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["lower-bit-bridge"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["shaft-core"] ?? root).add(node_lower_bit_bridge_6);
  nodes["lower-bit-bridge"] = node_lower_bit_bridge_6;
  const mesh_lower_bit_bridge_6Geometry = endpoint_lower_bit_bridge_6
    ? new THREE.CylinderGeometry(endpoint_lower_bit_bridge_6.endRadius, endpoint_lower_bit_bridge_6.baseRadius, endpoint_lower_bit_bridge_6.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_lower_bit_bridge_6) {
    mesh_lower_bit_bridge_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lower_bit_bridge_6 = new THREE.Mesh(
    mesh_lower_bit_bridge_6Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lower_bit_bridge_6.name = "Lower bit bridge";
  if (endpoint_lower_bit_bridge_6) {
    mesh_lower_bit_bridge_6.position.copy(endpoint_lower_bit_bridge_6.midpoint);
    mesh_lower_bit_bridge_6.quaternion.copy(endpoint_lower_bit_bridge_6.quaternion);
  }
  mesh_lower_bit_bridge_6.castShadow = options.castShadow ?? true;
  mesh_lower_bit_bridge_6.receiveShadow = options.receiveShadow ?? true;
  mesh_lower_bit_bridge_6.userData.sculptComponent = {"id": "lower-bit-bridge", "name": "Lower bit bridge", "level": "meso", "role": "static-part", "importance": 0.8, "confidence": 0.9, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A second short rigid connector overlaps the shaft and lower plate.", "geometryDescriptor": {"topologyIntent": "A second short rigid connector overlaps the shaft and lower plate.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "shaft-core", "attachment": {"parentId": "shaft-core", "parentSocket": "lower-bit-socket", "localStart": [0, 0, 0], "localEnd": [0.13, 0, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]}, "dimensions": {"width": 0.13, "height": 0.045, "depth": 0.07, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.065, -0.63, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.13, 0.045, 0.07], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["lower-bit-bridge"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lower-bit-bridge.contact-seam", "type": "seam", "description": "Lower bridge repeats the visible shaft-to-plate connection.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "physical overlap and contact seam", "confidence": 0.86, "evidenceRefs": ["front-bit", "right-bit"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["front-bit", "right-bit"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["front-bit", "right-bit"]}};
  node_lower_bit_bridge_6.add(mesh_lower_bit_bridge_6);
  meshes["lower-bit-bridge"] = mesh_lower_bit_bridge_6;
  colliders["lower-bit-bridge"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.13, 0.045, 0.07], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["bit-assembly"] ??= [];
  destructionGroups["bit-assembly"].push(node_lower_bit_bridge_6);

  const attachment_lower_bit_plate_7 = {"parentId": "lower-bit-bridge", "parentSocket": "lower-bit-bridge-surface", "localStart": [-0.13, 0, 0], "localEnd": [-0.08, 0, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]};
  const endpoint_lower_bit_plate_7 = makeAttachmentEndpoint(attachment_lower_bit_plate_7);
  const node_lower_bit_plate_7 = new THREE.Group();
  node_lower_bit_plate_7.name = "Lower rectangular bit plate__pivot";
  node_lower_bit_plate_7.scale.set(1, 1, 1);
  if (endpoint_lower_bit_plate_7) {
    node_lower_bit_plate_7.position.copy(endpoint_lower_bit_plate_7.start);
    node_lower_bit_plate_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lower_bit_plate_7.position.set(0.12, 0.035, -0.0325);
    node_lower_bit_plate_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_lower_bit_plate_7.userData.sculptComponent = {"id": "lower-bit-plate", "name": "Lower rectangular bit plate", "level": "meso", "role": "static-part", "importance": 0.8, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A discrete rigid plate with countable planar faces and a narrow real bevel supports the raised meander relief.", "geometryDescriptor": {"topologyIntent": "A discrete rigid plate with countable planar faces and a narrow real bevel supports the raised meander relief.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation", "profile2D": {"points": [[-0.115, -0.11], [0.115, -0.11], [0.115, 0.11], [-0.115, 0.11]], "depth": 0.065}}, "parent": "lower-bit-bridge", "attachment": {"parentId": "lower-bit-bridge", "parentSocket": "lower-bit-bridge-surface", "localStart": [-0.13, 0, 0], "localEnd": [-0.08, 0, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]}, "dimensions": {"width": 0.23, "height": 0.22, "depth": 0.065, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.12, 0.035, -0.0325], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.23, 0.22, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["lower-bit-plate"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bit-plates.rounded-bevels", "type": "bevel", "description": "Plate perimeter carries a narrow rounded highlight and darker inset field.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "real edge bevel", "confidence": 0.86, "evidenceRefs": ["front-bit", "right-bit"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["front-bit", "right-bit"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["front-bit", "right-bit"]}};
  node_lower_bit_plate_7.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.23, 0.22, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["lower-bit-plate"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["lower-bit-bridge"] ?? root).add(node_lower_bit_plate_7);
  nodes["lower-bit-plate"] = node_lower_bit_plate_7;
  const mesh_lower_bit_plate_7Geometry = endpoint_lower_bit_plate_7
    ? new THREE.CylinderGeometry(endpoint_lower_bit_plate_7.endRadius, endpoint_lower_bit_plate_7.baseRadius, endpoint_lower_bit_plate_7.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.115, -0.11], [0.115, -0.11], [0.115, 0.11], [-0.115, 0.11]], "depth": 0.065});
  if (!endpoint_lower_bit_plate_7) {
    mesh_lower_bit_plate_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lower_bit_plate_7 = new THREE.Mesh(
    mesh_lower_bit_plate_7Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lower_bit_plate_7.name = "Lower rectangular bit plate";
  if (endpoint_lower_bit_plate_7) {
    mesh_lower_bit_plate_7.position.copy(endpoint_lower_bit_plate_7.midpoint);
    mesh_lower_bit_plate_7.quaternion.copy(endpoint_lower_bit_plate_7.quaternion);
  }
  mesh_lower_bit_plate_7.castShadow = options.castShadow ?? true;
  mesh_lower_bit_plate_7.receiveShadow = options.receiveShadow ?? true;
  mesh_lower_bit_plate_7.userData.sculptComponent = {"id": "lower-bit-plate", "name": "Lower rectangular bit plate", "level": "meso", "role": "static-part", "importance": 0.8, "confidence": 0.9, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A discrete rigid plate with countable planar faces and a narrow real bevel supports the raised meander relief.", "geometryDescriptor": {"topologyIntent": "A discrete rigid plate with countable planar faces and a narrow real bevel supports the raised meander relief.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation", "profile2D": {"points": [[-0.115, -0.11], [0.115, -0.11], [0.115, 0.11], [-0.115, 0.11]], "depth": 0.065}}, "parent": "lower-bit-bridge", "attachment": {"parentId": "lower-bit-bridge", "parentSocket": "lower-bit-bridge-surface", "localStart": [-0.13, 0, 0], "localEnd": [-0.08, 0, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]}, "dimensions": {"width": 0.23, "height": 0.22, "depth": 0.065, "units": "relative", "confidence": 0.9}, "transform": {"position": [0.12, 0.035, -0.0325], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.23, 0.22, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["lower-bit-plate"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bit-plates.rounded-bevels", "type": "bevel", "description": "Plate perimeter carries a narrow rounded highlight and darker inset field.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in detail inventory", "orientation": "aligned to the component surface", "materialEffect": "contact AO and highlight separation", "geometryEffect": "real edge bevel", "confidence": 0.86, "evidenceRefs": ["front-bit", "right-bit"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["front-bit", "right-bit"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["front-bit", "right-bit"]}};
  node_lower_bit_plate_7.add(mesh_lower_bit_plate_7);
  meshes["lower-bit-plate"] = mesh_lower_bit_plate_7;
  colliders["lower-bit-plate"] = {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.23, 0.22, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["bit-assembly"] ??= [];
  destructionGroups["bit-assembly"].push(node_lower_bit_plate_7);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createJadeAndGoldOrnamentalKeyLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Jade and Gold Ornamental Key look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = ["Warm large key light from camera upper-left, elevation about 40 degrees, producing long soft shadows to lower-right.", "Neutral warm fill near camera axis lifts the jade and gold shadow values without flattening the recess.", "Cool-neutral rear rim separates the pale jade edge from the cream background.", "ACESFilmic tone mapping, exposure near 1.05, cream background, soft contact shadow beneath/behind the vertical prop."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createJadeAndGoldOrnamentalKeyEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameJadeAndGoldOrnamentalKeyCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createJadeAndGoldOrnamentalKeyPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureJadeAndGoldOrnamentalKeyRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createJadeAndGoldOrnamentalKeyInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
