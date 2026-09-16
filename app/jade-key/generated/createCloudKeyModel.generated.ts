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

// THREE.CapsuleGeometry duplicates every UV-seam vertex (measured: 194 boundary
// edges on the default radius/segments below) -- same benign pattern as box/
// cylinder/sphere/torus, all of which weld cleanly to 0 given a CORRECT weld.
// (A naive vertex-only mergeVertices() reports 64 'non-manifold' edges here, but
// that is a counting artifact, not a real defect: it double-counts a handful of
// near-pole triangles that become degenerate once two of their three corners
// coincide -- confirmed by replicating subdivideCatmullClark's own degenerate-
// triangle-aware vertex identity, which finds a perfectly ordinary 2-manifold.)
// A capsule is the primary shape for skinned limbs/torso (PLAN_1.5), and skinning
// weight computation is O(vertices x bones), so fewer, guaranteed-simple vertices
// is worth having regardless -- authored as a deterministic, closed-by-
// construction mesh instead: shared pole vertices, and
// the radial index taken `% radialSegments` so the seam is never a duplicate
// vertex in the first place, rather than something to weld away afterward.
// Adapted from forge/stage5_rig/emit_rig.py's buildWatertightCapsule (verified
// there: 0 boundary edges, 0 non-manifold edges, deterministic across repeated
// runs) -- ported here rather than imported because this factory and the rig
// emitter are separate generated-output surfaces with no shared runtime module;
// see forge/tests/test_primitive_watertightness.py for the measured proof, and
// coordinate with the rig owner before changing either copy independently.
function buildWatertightCapsule(
  radius: number,
  cylLength: number,
  capSegments: number,
  radialSegments: number,
  heightSegments: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  const halfCyl = cylLength / 2;
  const totalSpan = 2 * (Math.PI / 2 * radius) + Math.max(0, cylLength);
  const vOf = (fromBottom: number) => (totalSpan > 0 ? fromBottom / totalSpan : 0);

  const bottomPoleIndex = positions.length / 3;
  positions.push(0, -halfCyl - radius, 0);
  uvs.push(0.5, vOf(0));

  const ringStarts: number[] = [];
  const ringV: number[] = [];
  for (let ring = 1; ring <= capSegments; ring += 1) {
    const phi = (Math.PI / 2) * (ring / capSegments);
    const y = -halfCyl - radius * Math.cos(phi);
    const r = radius * Math.sin(phi);
    const start = positions.length / 3;
    ringStarts.push(start);
    ringV.push(vOf(radius * phi));
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const theta = (radial / radialSegments) * Math.PI * 2;
      positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
      uvs.push(radial / radialSegments, vOf(radius * phi));
    }
  }

  const cylinderRingStarts: number[] = [];
  if (cylLength > 0) {
    for (let step = 1; step <= heightSegments; step += 1) {
      const y = -halfCyl + (cylLength * step) / heightSegments;
      const start = positions.length / 3;
      cylinderRingStarts.push(start);
      const v = vOf(radius * (Math.PI / 2) + halfCyl + y);
      for (let radial = 0; radial < radialSegments; radial += 1) {
        const theta = (radial / radialSegments) * Math.PI * 2;
        positions.push(radius * Math.cos(theta), y, radius * Math.sin(theta));
        uvs.push(radial / radialSegments, v);
      }
    }
  }

  const topRingStarts: number[] = [];
  for (let ring = capSegments - 1; ring >= 1; ring -= 1) {
    const phi = (Math.PI / 2) * (ring / capSegments);
    const y = halfCyl + radius * Math.cos(phi);
    const r = radius * Math.sin(phi);
    const start = positions.length / 3;
    topRingStarts.push(start);
    const v = vOf(radius * (Math.PI / 2) + Math.max(0, cylLength) + radius * (Math.PI / 2 - phi));
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const theta = (radial / radialSegments) * Math.PI * 2;
      positions.push(r * Math.cos(theta), y, r * Math.sin(theta));
      uvs.push(radial / radialSegments, v);
    }
  }

  const topPoleIndex = positions.length / 3;
  positions.push(0, halfCyl + radius, 0);
  uvs.push(0.5, vOf(totalSpan));

  const firstBottomRing = ringStarts[0];
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(bottomPoleIndex, firstBottomRing + radial, firstBottomRing + next);
  }

  const allRings = [...ringStarts, ...cylinderRingStarts, ...topRingStarts];
  for (let i = 0; i < allRings.length - 1; i += 1) {
    const a = allRings[i];
    const b = allRings[i + 1];
    for (let radial = 0; radial < radialSegments; radial += 1) {
      const next = (radial + 1) % radialSegments;
      indices.push(a + radial, a + next, b + next);
      indices.push(a + radial, b + next, b + radial);
    }
  }

  const lastRing = allRings[allRings.length - 1];
  for (let radial = 0; radial < radialSegments; radial += 1) {
    const next = (radial + 1) % radialSegments;
    indices.push(topPoleIndex, lastRing + next, lastRing + radial);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

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

function buildTubeGeometry(
  path: { points: [number, number, number][]; radius?: number; radialSegments?: number; closed?: boolean },
): THREE.TubeGeometry {
  const vectors = path.points.map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(vectors, path.closed ?? false);
  const tubularSegments = Math.max(8, path.points.length * 6);
  return new THREE.TubeGeometry(curve, tubularSegments, path.radius ?? 0.05, path.radialSegments ?? 8, path.closed ?? false);
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

// Generated from ObjectSculptSpec target: 祥云玉石钥匙
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createObjectModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "\u7965\u4e91\u7389\u77f3\u94a5\u5319";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": true, "fovDegrees": 24, "aspect": 0.5555555555555556, "orientation": {"yaw": 0, "pitch": 0, "roll": 0}, "positionHint": [0, 0, 4.2], "note": "Orthographic-like front crop; review camera aligns upright source coordinates. Production hero rotates the root +90 degrees about Z."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["jade"] = createSculptMaterial(
    "jade",
    {"id": "jade", "name": "Milky pale cloud jade", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#eeeeda", "color": "#eeeeda", "albedo": {"dominant": "#D8CFAD", "secondary": ["#DAD3B5", "#D4C69D", "#B19760"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/jade/jade_albedo.png", "url": "/models/cloud-key/materials/jade_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#D8CFAD", "#DAD3B5", "#D4C69D", "#B19760", "#F7E5B9"], "pattern": "reference-derived pixel palette", "amplitude": 0.082, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "generated-object-space", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Stable world-scale detail."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.348, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14, "amplitude": 0.166, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72, "amplitude": 0.064, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.24, "variation": 0.07, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/jade/jade_roughness.png", "url": "/models/cloud-key/materials/jade_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "localResponse": "Polished perimeter approaches 0.12; cloudy inclusions rise toward 0.31."}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.161, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/jade/jade_normal.png", "url": "/models/cloud-key/materials/jade_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "heightSource": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/jade/jade_height.png", "url": "/models/cloud-key/materials/jade_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.01, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/jade/jade_height.png", "url": "/models/cloud-key/materials/jade_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/jade/jade_ao.png", "url": "/models/cloud-key/materials/jade_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#4a3d2a"}, "localOverrides": [{"id": "jade.cloud-inclusions", "region": "broad irregular patches across both jade faces", "baseColor": "#c6ccb0", "roughness": 0.3, "strength": 0.12, "evidenceRefs": ["front-head", "right-head"]}, {"id": "jade.polished-rim", "region": "upper-left curved rim under reference key light", "roughness": 0.12, "clearcoat": 0.58, "clearcoatRoughness": 0.08, "evidenceRefs": ["front-head"]}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Albedo, roughness, height/normal and AO are independent deterministic fields.", "No scratches, patina or damage are introduced because the reference shows a pristine presentation finish.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "transmission": {"base": 0.12, "variation": 0.025}, "thickness": {"base": 0.18, "variation": 0.03}, "ior": {"base": 1.48, "value": 1.48}, "clearcoat": {"base": 0.46, "variation": 0.08}, "clearcoatRoughness": {"base": 0.1, "variation": 0.04}, "transparent": true, "opacity": 0.94, "finishClass": "brushed-steel", "texturePalette": ["#ECE7D7", "#E9E7DC", "#E2DFCF", "#DDD8C0", "#DAD2B3"], "proceduralTexture": "brushed", "envMapIntensity": 1, "referencePbr": {"version": "1.0", "sourceImage": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-crops/jade.jpg", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.734, "estimatedFidelity": 0.734, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/jade/jade_albedo.png", "url": "/models/cloud-key/materials/jade_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/jade/jade_roughness.png", "url": "/models/cloud-key/materials/jade_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/jade/jade_height.png", "url": "/models/cloud-key/materials/jade_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/jade/jade_normal.png", "url": "/models/cloud-key/materials/jade_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/jade/jade_ao.png", "url": "/models/cloud-key/materials/jade_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 220, "sourceHeight": 150, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 220, "height": 150}, "mask": {"backgroundColor": "#E6DDBF", "backgroundNoise": 57.359, "transparentPixelFraction": 0, "foregroundCoverage": 0.1903}, "mapStats": {"valueRange": 0.1942, "heightP90Gradient": 0.00391, "roughnessBase": 0.68, "roughnessVariation": 0.05, "normalStrength": 0.161, "blurRadius": 21}, "palette": ["#D8CFAD", "#DAD3B5", "#D4C69D", "#B19760", "#F7E5B9"]}, "warnings": ["low value range weakens height/roughness inference", "low high-frequency detail weakens normal/roughness inference"]}, "anisotropy": {"base": 1}},
    options
  );
  materialMap["gold"] = createSculptMaterial(
    "gold",
    {"id": "gold", "name": "Warm polished gold", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#d8a643", "color": "#d8a643", "albedo": {"dominant": "#8A6C36", "secondary": ["#C1A46A", "#DDC489", "#FBE9BD"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/gold/gold_albedo.png", "url": "/models/cloud-key/materials/gold_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#8A6C36", "#C1A46A", "#DDC489", "#FBE9BD", "#EED8A4"], "pattern": "reference-derived pixel palette", "amplitude": 0.257, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "generated-object-space", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Stable world-scale detail."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.494, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14, "amplitude": 0.274, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72, "amplitude": 0.126, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.22, "variation": 0.08, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/gold/gold_roughness.png", "url": "/models/cloud-key/materials/gold_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "localResponse": "Exposed bevel crests approach 0.10; grooves and protected contacts rise toward 0.34."}, "metalness": {"base": 0.92, "variation": 0.03}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.191, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/gold/gold_normal.png", "url": "/models/cloud-key/materials/gold_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "heightSource": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/gold/gold_height.png", "url": "/models/cloud-key/materials/gold_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.013, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/gold/gold_height.png", "url": "/models/cloud-key/materials/gold_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/gold/gold_ao.png", "url": "/models/cloud-key/materials/gold_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#4a3d2a"}, "localOverrides": [{"id": "gold.polished-collar-crests", "region": "neck cup and torus collar crests", "roughness": 0.09, "strength": 0.9, "evidenceRefs": ["front-neck", "right-neck"]}, {"id": "gold.shaft-axial-highlight", "region": "camera-left longitudinal shaft band", "roughness": 0.1, "strength": 0.7, "evidenceRefs": ["front-shaft", "right-shaft"]}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["full-object"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Albedo, roughness, height/normal and AO are independent deterministic fields.", "No scratches, patina or damage are introduced because the reference shows a pristine presentation finish.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "clearcoat": {"base": 0.24, "variation": 0.06}, "clearcoatRoughness": {"base": 0.09, "variation": 0.03}, "envMapIntensity": 1.3, "finishClass": "gem-metal", "texturePalette": ["#FBF8EF", "#EED59F", "#93773B", "#FAE6B5", "#F0EADC"], "proceduralTexture": "gradient-smoke", "transmission": {"base": 0, "variation": 0}, "ior": {"base": 1.5, "value": 1.5}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-crops/gold.jpg", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.909, "estimatedFidelity": 0.909, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/gold/gold_albedo.png", "url": "/models/cloud-key/materials/gold_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/gold/gold_roughness.png", "url": "/models/cloud-key/materials/gold_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/gold/gold_height.png", "url": "/models/cloud-key/materials/gold_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/gold/gold_normal.png", "url": "/models/cloud-key/materials/gold_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/gold/gold_ao.png", "url": "/models/cloud-key/materials/gold_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 72, "sourceHeight": 390, "mapSize": 1024, "cropBBoxPixels": {"x": 20, "y": 0, "width": 52, "height": 390}, "mask": {"backgroundColor": "#FAF6F1", "backgroundNoise": 187.216, "transparentPixelFraction": 0, "foregroundCoverage": 0.5076}, "mapStats": {"valueRange": 0.6108, "heightP90Gradient": 0.02961, "roughnessBase": 0.7, "roughnessVariation": 0.053, "normalStrength": 0.191, "blurRadius": 21}, "palette": ["#8A6C36", "#C1A46A", "#DDC489", "#FBE9BD", "#EED8A4"]}, "warnings": []}},
    options
  );
  materialMap["recess"] = createSculptMaterial(
    "recess",
    {"id": "recess", "name": "Warm gold groove shadow", "type": "physical", "shaderModel": "MeshPhysicalMaterial", "baseColor": "#8c6a2a", "color": "#8c6a2a", "albedo": {"dominant": "#D4C192", "secondary": ["#C9AF78", "#AC9157", "#F4DFAD"], "samplingNotes": "Reference-derived from foreground pixels; de-lit to reduce baked shadows/highlights.", "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/recess/recess_albedo.png", "url": "/models/cloud-key/materials/recess_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}}, "colorVariation": {"palette": ["#D4C192", "#C9AF78", "#AC9157", "#F4DFAD", "#816227"], "pattern": "reference-derived pixel palette", "amplitude": 0.205, "heightCorrelation": 0.42}, "textureResolution": 1024, "textureProjection": {"mode": "generated-object-space", "repeat": [1, 1], "anisotropy": 8, "texelDensityIntent": "Stable world-scale detail."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.451, "role": "reference-derived broad albedo and height breakup"}, {"id": "meso", "frequency": 14, "amplitude": 0.35, "role": "reference-derived cracks, ridges, pores, grain, or leaf clusters"}, {"id": "micro", "frequency": 72, "amplitude": 0.14, "role": "reference-derived micro highlight breakup under grazing light"}], "roughness": {"base": 0.34, "variation": 0.12, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/recess/recess_roughness.png", "url": "/models/cloud-key/materials/recess_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "localResponse": "Scroll grooves and bit cutout walls remain rougher and darker than exposed gold crests."}, "metalness": {"base": 0.88, "variation": 0.04}, "normal": {"pattern": "reference-derived height-gradient normal map", "strength": 0.254, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/recess/recess_normal.png", "url": "/models/cloud-key/materials/recess_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "heightSource": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/recess/recess_height.png", "url": "/models/cloud-key/materials/recess_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "space": "tangent"}, "bump": {"pattern": "reference-derived height field", "amplitude": 0.037, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/recess/recess_height.png", "url": "/models/cloud-key/materials/recess_height.png", "channel": "height", "source": "reference-pixel-extraction"}}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.38, "contactShadowBias": 0.35, "map": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/recess/recess_ao.png", "url": "/models/cloud-key/materials/recess_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}, "notes": "Reference-derived cavity estimate from local height minima; verify against grazing-light screenshot."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#4a3d2a"}, "localOverrides": [{"id": "recess.inner-wall-ao", "region": "square cavity inner walls", "roughness": 0.58, "strength": 0.8, "evidenceRefs": ["front-scrolls", "front-bit"]}, {"id": "reference-pbr-pixel-evidence", "type": "material-map-evidence", "evidenceRefs": ["front-scrolls", "front-bit"], "channels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "notes": "Use generated maps as material evidence, then refine after browser screenshot comparison."}], "shaderNotes": ["Albedo, roughness, height/normal and AO are independent deterministic fields.", "No scratches, patina or damage are introduced because the reference shows a pristine presentation finish.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps.", "Reference-derived maps are estimates from image pixels; verify with neutral, grazing, and reference-matched renders.", "Do not treat baked image shadows as final albedo; rerun extraction with a tighter material crop if highlights/shadows pollute the maps."], "envMapIntensity": 1.3, "finishClass": "gem-metal", "texturePalette": ["#EDE6D3", "#DFCFA8", "#C5AD76", "#B29961", "#E9DEC6"], "proceduralTexture": "gradient-smoke", "clearcoat": {"base": 0.1, "variation": 0.03}, "clearcoatRoughness": {"base": 0.2, "variation": 0.05}, "transmission": {"base": 0, "variation": 0}, "ior": {"base": 1.5, "value": 1.5}, "referencePbr": {"version": "1.0", "sourceImage": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-crops/recess.jpg", "extractor": "stage1_intake/extract_pbr_evidence.py", "method": "single-image pixel evidence with de-lighting estimate; not photogrammetry", "usable": true, "verdict": "pass", "confidence": 0.909, "estimatedFidelity": 0.909, "targetThreshold": 0.7, "hardLimit": "A single image cannot uniquely recover true albedo/roughness/normal/AO; maps are reference-derived estimates.", "maps": {"albedo": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/recess/recess_albedo.png", "url": "/models/cloud-key/materials/recess_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/recess/recess_roughness.png", "url": "/models/cloud-key/materials/recess_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/recess/recess_height.png", "url": "/models/cloud-key/materials/recess_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/recess/recess_normal.png", "url": "/models/cloud-key/materials/recess_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "/Users/openclaw/Documents/Product/.img2threejs/cloud-key/material-evidence/recess/recess_ao.png", "url": "/models/cloud-key/materials/recess_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "diagnostics": {"sourceWidth": 150, "sourceHeight": 85, "mapSize": 1024, "cropBBoxPixels": {"x": 0, "y": 0, "width": 150, "height": 85}, "mask": {"backgroundColor": "#FBF6F1", "backgroundNoise": 76.381, "transparentPixelFraction": 0, "foregroundCoverage": 0.7445}, "mapStats": {"valueRange": 0.4892, "heightP90Gradient": 0.08306, "roughnessBase": 0.708, "roughnessVariation": 0.164, "normalStrength": 0.254, "blurRadius": 21}, "palette": ["#D4C192", "#C9AF78", "#AC9157", "#F4DFAD", "#816227"]}, "warnings": []}},
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
  node_root_0.name = "Cloud jade key assembly root__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "Cloud jade key assembly root", "level": "macro", "role": "root", "importance": 1, "confidence": 1, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A transform container represented by a negligible rigid proxy while named child solids carry the visible silhouette.", "geometryDescriptor": {"topologyIntent": "A transform container represented by a negligible rigid proxy while named child solids carry the visible silhouette.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "head-socket", "localPosition": [0, 0.84, 0], "localRotation": [0, 0, 0]}, {"id": "left-scroll-socket", "localPosition": [-0.16, 0.48, 0], "localRotation": [0, 0, 0]}, {"id": "right-scroll-socket", "localPosition": [0.16, 0.48, 0], "localRotation": [0, 0, 0]}, {"id": "neck-socket", "localPosition": [0, 0.34, 0], "localRotation": [0, 0, 0]}, {"id": "shaft-socket", "localPosition": [0, -0.38, 0], "localRotation": [0, 0, 0]}, {"id": "terminal-socket", "localPosition": [0, -1.12, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "root.horizontal-presentation", "type": "socket", "description": "Source model remains upright; presentation wrapper rotates +90 degrees around Z so the head is left and shaft extends right.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "stable root pivot", "confidence": 0.9, "evidenceRefs": ["front-full"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["full-object"]}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "head-socket", "localPosition": [0, 0.84, 0], "localRotation": [0, 0, 0]}, {"id": "left-scroll-socket", "localPosition": [-0.16, 0.48, 0], "localRotation": [0, 0, 0]}, {"id": "right-scroll-socket", "localPosition": [0.16, 0.48, 0], "localRotation": [0, 0, 0]}, {"id": "neck-socket", "localPosition": [0, 0.34, 0], "localRotation": [0, 0, 0]}, {"id": "shaft-socket", "localPosition": [0, -0.38, 0], "localRotation": [0, 0, 0]}, {"id": "terminal-socket", "localPosition": [0, -1.12, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "gold"}};
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
  mesh_root_0.name = "Cloud jade key assembly root";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "Cloud jade key assembly root", "level": "macro", "role": "root", "importance": 1, "confidence": 1, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A transform container represented by a negligible rigid proxy while named child solids carry the visible silhouette.", "geometryDescriptor": {"topologyIntent": "A transform container represented by a negligible rigid proxy while named child solids carry the visible silhouette.", "edgeTreatment": {"type": "chamfer", "bevelRadius": 0.012, "segments": 3}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": null, "attachment": null, "dimensions": {"width": 0.001, "height": 0.001, "depth": 0.001, "units": "relative", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "head-socket", "localPosition": [0, 0.84, 0], "localRotation": [0, 0, 0]}, {"id": "left-scroll-socket", "localPosition": [-0.16, 0.48, 0], "localRotation": [0, 0, 0]}, {"id": "right-scroll-socket", "localPosition": [0.16, 0.48, 0], "localRotation": [0, 0, 0]}, {"id": "neck-socket", "localPosition": [0, 0.34, 0], "localRotation": [0, 0, 0]}, {"id": "shaft-socket", "localPosition": [0, -0.38, 0], "localRotation": [0, 0, 0]}, {"id": "terminal-socket", "localPosition": [0, -1.12, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "root.horizontal-presentation", "type": "socket", "description": "Source model remains upright; presentation wrapper rotates +90 degrees around Z so the head is left and shaft extends right.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "stable root pivot", "confidence": 0.9, "evidenceRefs": ["front-full"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle polish field", "displacementPattern": "none", "occlusionPattern": "contact seams only", "edgeWearPattern": "none observed", "notes": "Surface bands are specified in the referenced material and remain independent from albedo."}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.92, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(211, 157, 54, 1)"}, {"position": 1, "color": "rgba(255, 224, 142, 1)"}]}, "evidenceRefs": ["full-object"]}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.001, 0.001, 0.001], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["shaft-assembly"] ??= [];
  destructionGroups["shaft-assembly"].push(node_root_0);
  const socket_root_head_socket_0 = new THREE.Object3D();
  socket_root_head_socket_0.name = "head-socket";
  socket_root_head_socket_0.position.set(0.0, 0.84, 0.0);
  socket_root_head_socket_0.rotation.set(0.0, 0.0, 0.0);
  socket_root_head_socket_0.userData.socket = {"id": "head-socket", "localPosition": [0, 0.84, 0], "localRotation": [0, 0, 0]};
  node_root_0.add(socket_root_head_socket_0);
  sockets["root:head-socket"] = socket_root_head_socket_0;
  const socket_root_left_scroll_socket_1 = new THREE.Object3D();
  socket_root_left_scroll_socket_1.name = "left-scroll-socket";
  socket_root_left_scroll_socket_1.position.set(-0.16, 0.48, 0.0);
  socket_root_left_scroll_socket_1.rotation.set(0.0, 0.0, 0.0);
  socket_root_left_scroll_socket_1.userData.socket = {"id": "left-scroll-socket", "localPosition": [-0.16, 0.48, 0], "localRotation": [0, 0, 0]};
  node_root_0.add(socket_root_left_scroll_socket_1);
  sockets["root:left-scroll-socket"] = socket_root_left_scroll_socket_1;
  const socket_root_right_scroll_socket_2 = new THREE.Object3D();
  socket_root_right_scroll_socket_2.name = "right-scroll-socket";
  socket_root_right_scroll_socket_2.position.set(0.16, 0.48, 0.0);
  socket_root_right_scroll_socket_2.rotation.set(0.0, 0.0, 0.0);
  socket_root_right_scroll_socket_2.userData.socket = {"id": "right-scroll-socket", "localPosition": [0.16, 0.48, 0], "localRotation": [0, 0, 0]};
  node_root_0.add(socket_root_right_scroll_socket_2);
  sockets["root:right-scroll-socket"] = socket_root_right_scroll_socket_2;
  const socket_root_neck_socket_3 = new THREE.Object3D();
  socket_root_neck_socket_3.name = "neck-socket";
  socket_root_neck_socket_3.position.set(0.0, 0.34, 0.0);
  socket_root_neck_socket_3.rotation.set(0.0, 0.0, 0.0);
  socket_root_neck_socket_3.userData.socket = {"id": "neck-socket", "localPosition": [0, 0.34, 0], "localRotation": [0, 0, 0]};
  node_root_0.add(socket_root_neck_socket_3);
  sockets["root:neck-socket"] = socket_root_neck_socket_3;
  const socket_root_shaft_socket_4 = new THREE.Object3D();
  socket_root_shaft_socket_4.name = "shaft-socket";
  socket_root_shaft_socket_4.position.set(0.0, -0.38, 0.0);
  socket_root_shaft_socket_4.rotation.set(0.0, 0.0, 0.0);
  socket_root_shaft_socket_4.userData.socket = {"id": "shaft-socket", "localPosition": [0, -0.38, 0], "localRotation": [0, 0, 0]};
  node_root_0.add(socket_root_shaft_socket_4);
  sockets["root:shaft-socket"] = socket_root_shaft_socket_4;
  const socket_root_terminal_socket_5 = new THREE.Object3D();
  socket_root_terminal_socket_5.name = "terminal-socket";
  socket_root_terminal_socket_5.position.set(0.0, -1.12, 0.0);
  socket_root_terminal_socket_5.rotation.set(0.0, 0.0, 0.0);
  socket_root_terminal_socket_5.userData.socket = {"id": "terminal-socket", "localPosition": [0, -1.12, 0], "localRotation": [0, 0, 0]};
  node_root_0.add(socket_root_terminal_socket_5);
  sockets["root:terminal-socket"] = socket_root_terminal_socket_5;

  const attachment_jade_cloud_core_1 = {"parentId": "root", "parentSocket": "head-socket", "localStart": [0, -0.32, 0], "localEnd": [0, -0.295, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-head", "right-head"]};
  const endpoint_jade_cloud_core_1 = makeAttachmentEndpoint(attachment_jade_cloud_core_1);
  const node_jade_cloud_core_1 = new THREE.Group();
  node_jade_cloud_core_1.name = "Double-convex cloud jade core__pivot";
  node_jade_cloud_core_1.scale.set(1, 1, 1);
  if (endpoint_jade_cloud_core_1) {
    node_jade_cloud_core_1.position.copy(endpoint_jade_cloud_core_1.start);
    node_jade_cloud_core_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_jade_cloud_core_1.position.set(0.0, 0.84, 0.0);
    node_jade_cloud_core_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_jade_cloud_core_1.userData.sculptComponent = {"id": "jade-cloud-core", "name": "Double-convex cloud jade core", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.88, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "A continuous trilobed organic outline lofted through multiple Z rings to create front and rear convexity.", "geometryDescriptor": {"topologyIntent": "A continuous trilobed organic outline lofted through multiple Z rings to create front and rear convexity.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "head-socket", "localStart": [0, -0.32, 0], "localEnd": [0, -0.295, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-head", "right-head"]}, "dimensions": {"width": 0.84, "height": 0.64, "depth": 0.15, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.84, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "bezel-socket", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.84, 0.64, 0.15], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "head-assembly", "seamRefs": [], "detachableFragments": ["jade-cloud-core"], "breakImpulse": 1, "debrisMaterial": "jade"}}, "material": "jade", "materialLayers": ["jade"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "jade-cloud-core.trilobe-contour", "type": "contour", "description": "One centered upper lobe and two lower side lobes joined through concave lower shoulders.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "sampled cubic-Bezier cloud contour", "confidence": 0.9, "evidenceRefs": ["front-head"]}, {"id": "jade-cloud-core.double-convex-loft", "type": "contour", "description": "Five depth rings scale toward the edge to form broad convex faces instead of a flat extrusion.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "custom loft with bevel-support rings", "confidence": 0.9, "evidenceRefs": ["front-head", "right-head"]}], "surfaceDetail": {"macroRoughness": 0.08, "microRoughness": 0.1, "bumpAmplitude": 0.008, "normalPattern": "independent low-amplitude cloudy field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-head", "right-head"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 237, 216, 1)", "secondaryAlbedo": "rgba(205, 214, 183, 1)", "materialClass": "stone", "materialClassConfidence": 0.92, "colorGradient": {"type": "radial", "stops": [{"position": 0, "color": "rgba(247, 245, 226, 1)"}, {"position": 0.72, "color": "rgba(219, 223, 196, 1)"}, {"position": 1, "color": "rgba(230, 214, 157, 1)"}]}, "evidenceRefs": ["front-head", "right-head"]}};
  node_jade_cloud_core_1.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "bezel-socket", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.84, 0.64, 0.15], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "head-assembly", "seamRefs": [], "detachableFragments": ["jade-cloud-core"], "breakImpulse": 1, "debrisMaterial": "jade"}};
  (nodes["root"] ?? root).add(node_jade_cloud_core_1);
  nodes["jade-cloud-core"] = node_jade_cloud_core_1;
  const mesh_jade_cloud_core_1Geometry = endpoint_jade_cloud_core_1
    ? new THREE.CylinderGeometry(endpoint_jade_cloud_core_1.endRadius, endpoint_jade_cloud_core_1.baseRadius, endpoint_jade_cloud_core_1.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
  if (!endpoint_jade_cloud_core_1) {
    mesh_jade_cloud_core_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_jade_cloud_core_1 = new THREE.Mesh(
    mesh_jade_cloud_core_1Geometry,
    materialMap["jade"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_jade_cloud_core_1.name = "Double-convex cloud jade core";
  if (endpoint_jade_cloud_core_1) {
    mesh_jade_cloud_core_1.position.copy(endpoint_jade_cloud_core_1.midpoint);
    mesh_jade_cloud_core_1.quaternion.copy(endpoint_jade_cloud_core_1.quaternion);
  }
  mesh_jade_cloud_core_1.castShadow = options.castShadow ?? true;
  mesh_jade_cloud_core_1.receiveShadow = options.receiveShadow ?? true;
  mesh_jade_cloud_core_1.userData.sculptComponent = {"id": "jade-cloud-core", "name": "Double-convex cloud jade core", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.88, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "A continuous trilobed organic outline lofted through multiple Z rings to create front and rear convexity.", "geometryDescriptor": {"topologyIntent": "A continuous trilobed organic outline lofted through multiple Z rings to create front and rear convexity.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "head-socket", "localStart": [0, -0.32, 0], "localEnd": [0, -0.295, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-head", "right-head"]}, "dimensions": {"width": 0.84, "height": 0.64, "depth": 0.15, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.84, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "bezel-socket", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.84, 0.64, 0.15], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "head-assembly", "seamRefs": [], "detachableFragments": ["jade-cloud-core"], "breakImpulse": 1, "debrisMaterial": "jade"}}, "material": "jade", "materialLayers": ["jade"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "jade-cloud-core.trilobe-contour", "type": "contour", "description": "One centered upper lobe and two lower side lobes joined through concave lower shoulders.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "sampled cubic-Bezier cloud contour", "confidence": 0.9, "evidenceRefs": ["front-head"]}, {"id": "jade-cloud-core.double-convex-loft", "type": "contour", "description": "Five depth rings scale toward the edge to form broad convex faces instead of a flat extrusion.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "custom loft with bevel-support rings", "confidence": 0.9, "evidenceRefs": ["front-head", "right-head"]}], "surfaceDetail": {"macroRoughness": 0.08, "microRoughness": 0.1, "bumpAmplitude": 0.008, "normalPattern": "independent low-amplitude cloudy field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-head", "right-head"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(238, 237, 216, 1)", "secondaryAlbedo": "rgba(205, 214, 183, 1)", "materialClass": "stone", "materialClassConfidence": 0.92, "colorGradient": {"type": "radial", "stops": [{"position": 0, "color": "rgba(247, 245, 226, 1)"}, {"position": 0.72, "color": "rgba(219, 223, 196, 1)"}, {"position": 1, "color": "rgba(230, 214, 157, 1)"}]}, "evidenceRefs": ["front-head", "right-head"]}};
  node_jade_cloud_core_1.add(mesh_jade_cloud_core_1);
  meshes["jade-cloud-core"] = mesh_jade_cloud_core_1;
  colliders["jade-cloud-core"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.84, 0.64, 0.15], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["head-assembly"] ??= [];
  destructionGroups["head-assembly"].push(node_jade_cloud_core_1);
  const socket_jade_cloud_core_bezel_socket_0 = new THREE.Object3D();
  socket_jade_cloud_core_bezel_socket_0.name = "bezel-socket";
  socket_jade_cloud_core_bezel_socket_0.position.set(0.0, 0.0, 0.0);
  socket_jade_cloud_core_bezel_socket_0.rotation.set(0.0, 0.0, 0.0);
  socket_jade_cloud_core_bezel_socket_0.userData.socket = {"id": "bezel-socket", "localPosition": [0, 0, 0], "localRotation": [0, 0, 0]};
  node_jade_cloud_core_1.add(socket_jade_cloud_core_bezel_socket_0);
  sockets["jade-cloud-core:bezel-socket"] = socket_jade_cloud_core_bezel_socket_0;

  const attachment_gold_cloud_bezel_2 = {"parentId": "jade-cloud-core", "parentSocket": "bezel-socket", "localStart": [0, -0.34, 0], "localEnd": [0, -0.315, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-head", "right-head"]};
  const endpoint_gold_cloud_bezel_2 = makeAttachmentEndpoint(attachment_gold_cloud_bezel_2);
  const node_gold_cloud_bezel_2 = new THREE.Group();
  node_gold_cloud_bezel_2.name = "Continuous gold cloud bezel__pivot";
  node_gold_cloud_bezel_2.scale.set(1, 1, 1);
  if (endpoint_gold_cloud_bezel_2) {
    node_gold_cloud_bezel_2.position.copy(endpoint_gold_cloud_bezel_2.start);
    node_gold_cloud_bezel_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_gold_cloud_bezel_2.position.set(0.0, 0.0, 0.0);
    node_gold_cloud_bezel_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_gold_cloud_bezel_2.userData.sculptComponent = {"id": "gold-cloud-bezel", "name": "Continuous gold cloud bezel", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "A thin continuous gold ring conforms to the jade cloud perimeter with independent inner and outer rounded edges.", "geometryDescriptor": {"topologyIntent": "A thin continuous gold ring conforms to the jade cloud perimeter with independent inner and outer rounded edges.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "jade-cloud-core", "attachment": {"parentId": "jade-cloud-core", "parentSocket": "bezel-socket", "localStart": [0, -0.34, 0], "localEnd": [0, -0.315, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-head", "right-head"]}, "dimensions": {"width": 0.88, "height": 0.68, "depth": 0.095, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.88, 0.68, 0.095], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "head-assembly", "seamRefs": [], "detachableFragments": ["gold-cloud-bezel"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gold-cloud-bezel.continuous-rounded-ring", "type": "bevel", "description": "Gold band follows the full cloud perimeter and retains finite side depth.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "outer cloud extrusion with inner cloud hole and rounded bevel", "confidence": 0.9, "evidenceRefs": ["front-head", "right-head"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-head", "right-head"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-head", "right-head"]}};
  node_gold_cloud_bezel_2.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.88, 0.68, 0.095], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "head-assembly", "seamRefs": [], "detachableFragments": ["gold-cloud-bezel"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["jade-cloud-core"] ?? root).add(node_gold_cloud_bezel_2);
  nodes["gold-cloud-bezel"] = node_gold_cloud_bezel_2;
  const mesh_gold_cloud_bezel_2Geometry = endpoint_gold_cloud_bezel_2
    ? new THREE.CylinderGeometry(endpoint_gold_cloud_bezel_2.endRadius, endpoint_gold_cloud_bezel_2.baseRadius, endpoint_gold_cloud_bezel_2.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
  if (!endpoint_gold_cloud_bezel_2) {
    mesh_gold_cloud_bezel_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_gold_cloud_bezel_2 = new THREE.Mesh(
    mesh_gold_cloud_bezel_2Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gold_cloud_bezel_2.name = "Continuous gold cloud bezel";
  if (endpoint_gold_cloud_bezel_2) {
    mesh_gold_cloud_bezel_2.position.copy(endpoint_gold_cloud_bezel_2.midpoint);
    mesh_gold_cloud_bezel_2.quaternion.copy(endpoint_gold_cloud_bezel_2.quaternion);
  }
  mesh_gold_cloud_bezel_2.castShadow = options.castShadow ?? true;
  mesh_gold_cloud_bezel_2.receiveShadow = options.receiveShadow ?? true;
  mesh_gold_cloud_bezel_2.userData.sculptComponent = {"id": "gold-cloud-bezel", "name": "Continuous gold cloud bezel", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "extrude", "topologyClass": "conforming-shell", "topologyRationale": "A thin continuous gold ring conforms to the jade cloud perimeter with independent inner and outer rounded edges.", "geometryDescriptor": {"topologyIntent": "A thin continuous gold ring conforms to the jade cloud perimeter with independent inner and outer rounded edges.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "jade-cloud-core", "attachment": {"parentId": "jade-cloud-core", "parentSocket": "bezel-socket", "localStart": [0, -0.34, 0], "localEnd": [0, -0.315, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-head", "right-head"]}, "dimensions": {"width": 0.88, "height": 0.68, "depth": 0.095, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.88, 0.68, 0.095], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "head-assembly", "seamRefs": [], "detachableFragments": ["gold-cloud-bezel"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "gold-cloud-bezel.continuous-rounded-ring", "type": "bevel", "description": "Gold band follows the full cloud perimeter and retains finite side depth.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "outer cloud extrusion with inner cloud hole and rounded bevel", "confidence": 0.9, "evidenceRefs": ["front-head", "right-head"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-head", "right-head"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-head", "right-head"]}};
  node_gold_cloud_bezel_2.add(mesh_gold_cloud_bezel_2);
  meshes["gold-cloud-bezel"] = mesh_gold_cloud_bezel_2;
  colliders["gold-cloud-bezel"] = {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.88, 0.68, 0.095], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["head-assembly"] ??= [];
  destructionGroups["head-assembly"].push(node_gold_cloud_bezel_2);

  const attachment_left_scroll_3 = {"parentId": "root", "parentSocket": "left-scroll-socket", "localStart": [0, -0.115, 0], "localEnd": [0, -0.09, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-scrolls"]};
  const endpoint_left_scroll_3 = makeAttachmentEndpoint(attachment_left_scroll_3);
  const node_left_scroll_3 = new THREE.Group();
  node_left_scroll_3.name = "Left inward ruyi scroll__pivot";
  node_left_scroll_3.scale.set(1, 1, 1);
  if (endpoint_left_scroll_3) {
    node_left_scroll_3.position.copy(endpoint_left_scroll_3.start);
    node_left_scroll_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_left_scroll_3.position.set(-0.145, 0.49, 0.0);
    node_left_scroll_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_left_scroll_3.userData.sculptComponent = {"id": "left-scroll", "name": "Left inward ruyi scroll", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "tube", "topologyClass": "fiber-strand", "topologyRationale": "A continuous gold tube follows an inward planar spiral and joins the lower cloud shoulder to the neck.", "geometryDescriptor": {"topologyIntent": "A continuous gold tube follows an inward planar spiral and joins the lower cloud shoulder to the neck.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "left-scroll-socket", "localStart": [0, -0.115, 0], "localEnd": [0, -0.09, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-scrolls"]}, "dimensions": {"width": 0.25, "height": 0.23, "depth": 0.065, "units": "relative", "confidence": 0.88}, "transform": {"position": [-0.145, 0.49, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.25, 0.23, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "head-assembly", "seamRefs": [], "detachableFragments": ["left-scroll"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "ruyi-scrolls.paired-inward-spirals", "type": "ridge", "description": "Mirrored inward scroll paths preserve the reference negative spaces.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "Catmull-Rom tube sweep with tangent shoulder connection", "confidence": 0.9, "evidenceRefs": ["front-scrolls"]}, {"id": "ruyi-scrolls.center-groove", "type": "groove", "description": "A darker recessed center line follows the visible scroll path.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "secondary thinner recessed tube riding the scroll center", "confidence": 0.9, "evidenceRefs": ["front-scrolls"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-scrolls"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-scrolls"]}};
  node_left_scroll_3.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.25, 0.23, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "head-assembly", "seamRefs": [], "detachableFragments": ["left-scroll"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["root"] ?? root).add(node_left_scroll_3);
  nodes["left-scroll"] = node_left_scroll_3;
  const mesh_left_scroll_3Geometry = endpoint_left_scroll_3
    ? new THREE.CylinderGeometry(endpoint_left_scroll_3.endRadius, endpoint_left_scroll_3.baseRadius, endpoint_left_scroll_3.length, 16, 6)
    : buildTubeGeometry({"points": [[0.0, -0.5, 0.0], [0.0, 0.5, 0.0]], "radius": 0.05, "closed": false});
  if (!endpoint_left_scroll_3) {
    mesh_left_scroll_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_left_scroll_3 = new THREE.Mesh(
    mesh_left_scroll_3Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_left_scroll_3.name = "Left inward ruyi scroll";
  if (endpoint_left_scroll_3) {
    mesh_left_scroll_3.position.copy(endpoint_left_scroll_3.midpoint);
    mesh_left_scroll_3.quaternion.copy(endpoint_left_scroll_3.quaternion);
  }
  mesh_left_scroll_3.castShadow = options.castShadow ?? true;
  mesh_left_scroll_3.receiveShadow = options.receiveShadow ?? true;
  mesh_left_scroll_3.userData.sculptComponent = {"id": "left-scroll", "name": "Left inward ruyi scroll", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "tube", "topologyClass": "fiber-strand", "topologyRationale": "A continuous gold tube follows an inward planar spiral and joins the lower cloud shoulder to the neck.", "geometryDescriptor": {"topologyIntent": "A continuous gold tube follows an inward planar spiral and joins the lower cloud shoulder to the neck.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "left-scroll-socket", "localStart": [0, -0.115, 0], "localEnd": [0, -0.09, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-scrolls"]}, "dimensions": {"width": 0.25, "height": 0.23, "depth": 0.065, "units": "relative", "confidence": 0.88}, "transform": {"position": [-0.145, 0.49, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.25, 0.23, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "head-assembly", "seamRefs": [], "detachableFragments": ["left-scroll"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "ruyi-scrolls.paired-inward-spirals", "type": "ridge", "description": "Mirrored inward scroll paths preserve the reference negative spaces.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "Catmull-Rom tube sweep with tangent shoulder connection", "confidence": 0.9, "evidenceRefs": ["front-scrolls"]}, {"id": "ruyi-scrolls.center-groove", "type": "groove", "description": "A darker recessed center line follows the visible scroll path.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "secondary thinner recessed tube riding the scroll center", "confidence": 0.9, "evidenceRefs": ["front-scrolls"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-scrolls"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-scrolls"]}};
  node_left_scroll_3.add(mesh_left_scroll_3);
  meshes["left-scroll"] = mesh_left_scroll_3;
  colliders["left-scroll"] = {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.25, 0.23, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["head-assembly"] ??= [];
  destructionGroups["head-assembly"].push(node_left_scroll_3);

  const attachment_right_scroll_4 = {"parentId": "root", "parentSocket": "right-scroll-socket", "localStart": [0, -0.115, 0], "localEnd": [0, -0.09, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-scrolls"]};
  const endpoint_right_scroll_4 = makeAttachmentEndpoint(attachment_right_scroll_4);
  const node_right_scroll_4 = new THREE.Group();
  node_right_scroll_4.name = "Right inward ruyi scroll__pivot";
  node_right_scroll_4.scale.set(1, 1, 1);
  if (endpoint_right_scroll_4) {
    node_right_scroll_4.position.copy(endpoint_right_scroll_4.start);
    node_right_scroll_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_right_scroll_4.position.set(0.145, 0.49, 0.0);
    node_right_scroll_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_right_scroll_4.userData.sculptComponent = {"id": "right-scroll", "name": "Right inward ruyi scroll", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "tube", "topologyClass": "fiber-strand", "topologyRationale": "A mirrored continuous gold tube follows the right inward spiral and joins the neck.", "geometryDescriptor": {"topologyIntent": "A mirrored continuous gold tube follows the right inward spiral and joins the neck.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "right-scroll-socket", "localStart": [0, -0.115, 0], "localEnd": [0, -0.09, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-scrolls"]}, "dimensions": {"width": 0.25, "height": 0.23, "depth": 0.065, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.145, 0.49, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.25, 0.23, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "head-assembly", "seamRefs": [], "detachableFragments": ["right-scroll"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "right-scroll.mirrored-path", "type": "ridge", "description": "Right scroll mirrors the left while retaining its own selectable part node.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "mirrored Catmull-Rom tube sweep", "confidence": 0.9, "evidenceRefs": ["front-scrolls"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-scrolls"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-scrolls"]}};
  node_right_scroll_4.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.25, 0.23, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "head-assembly", "seamRefs": [], "detachableFragments": ["right-scroll"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["root"] ?? root).add(node_right_scroll_4);
  nodes["right-scroll"] = node_right_scroll_4;
  const mesh_right_scroll_4Geometry = endpoint_right_scroll_4
    ? new THREE.CylinderGeometry(endpoint_right_scroll_4.endRadius, endpoint_right_scroll_4.baseRadius, endpoint_right_scroll_4.length, 16, 6)
    : buildTubeGeometry({"points": [[0.0, -0.5, 0.0], [0.0, 0.5, 0.0]], "radius": 0.05, "closed": false});
  if (!endpoint_right_scroll_4) {
    mesh_right_scroll_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_right_scroll_4 = new THREE.Mesh(
    mesh_right_scroll_4Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_right_scroll_4.name = "Right inward ruyi scroll";
  if (endpoint_right_scroll_4) {
    mesh_right_scroll_4.position.copy(endpoint_right_scroll_4.midpoint);
    mesh_right_scroll_4.quaternion.copy(endpoint_right_scroll_4.quaternion);
  }
  mesh_right_scroll_4.castShadow = options.castShadow ?? true;
  mesh_right_scroll_4.receiveShadow = options.receiveShadow ?? true;
  mesh_right_scroll_4.userData.sculptComponent = {"id": "right-scroll", "name": "Right inward ruyi scroll", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "tube", "topologyClass": "fiber-strand", "topologyRationale": "A mirrored continuous gold tube follows the right inward spiral and joins the neck.", "geometryDescriptor": {"topologyIntent": "A mirrored continuous gold tube follows the right inward spiral and joins the neck.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "right-scroll-socket", "localStart": [0, -0.115, 0], "localEnd": [0, -0.09, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-scrolls"]}, "dimensions": {"width": 0.25, "height": 0.23, "depth": 0.065, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.145, 0.49, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.25, 0.23, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "head-assembly", "seamRefs": [], "detachableFragments": ["right-scroll"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "right-scroll.mirrored-path", "type": "ridge", "description": "Right scroll mirrors the left while retaining its own selectable part node.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "mirrored Catmull-Rom tube sweep", "confidence": 0.9, "evidenceRefs": ["front-scrolls"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-scrolls"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-scrolls"]}};
  node_right_scroll_4.add(mesh_right_scroll_4);
  meshes["right-scroll"] = mesh_right_scroll_4;
  colliders["right-scroll"] = {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.25, 0.23, 0.065], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["head-assembly"] ??= [];
  destructionGroups["head-assembly"].push(node_right_scroll_4);

  const attachment_neck_assembly_5 = {"parentId": "root", "parentSocket": "neck-socket", "localStart": [0, -0.1, 0], "localEnd": [0, -0.07500000000000001, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-neck", "right-neck"]};
  const endpoint_neck_assembly_5 = makeAttachmentEndpoint(attachment_neck_assembly_5);
  const node_neck_assembly_5 = new THREE.Group();
  node_neck_assembly_5.name = "Turned neck assembly__pivot";
  node_neck_assembly_5.scale.set(1, 1, 1);
  if (endpoint_neck_assembly_5) {
    node_neck_assembly_5.position.copy(endpoint_neck_assembly_5.start);
    node_neck_assembly_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_neck_assembly_5.position.set(0.0, 0.34, 0.0);
    node_neck_assembly_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_neck_assembly_5.userData.sculptComponent = {"id": "neck-assembly", "name": "Turned neck assembly", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.88, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A rotationally symmetric turned gold profile transitions from scrolls to the shaft.", "geometryDescriptor": {"topologyIntent": "A rotationally symmetric turned gold profile transitions from scrolls to the shaft.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "neck-socket", "localStart": [0, -0.1, 0], "localEnd": [0, -0.07500000000000001, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-neck", "right-neck"]}, "dimensions": {"width": 0.19, "height": 0.2, "depth": 0.19, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.34, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "neck-top-ring-socket", "localPosition": [0, 0.075, 0], "localRotation": [0, 0, 0]}, {"id": "neck-lower-ring-socket", "localPosition": [0, -0.07, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.19, 0.2, 0.19], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["neck-assembly"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "neck-assembly.three-stage-lathe", "type": "contour", "description": "Flattened upper collar, pinched waist and lower torus ring reproduce the reference transition.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "continuous lathe profile", "confidence": 0.9, "evidenceRefs": ["front-neck", "right-neck"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-neck", "right-neck"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-neck", "right-neck"]}};
  node_neck_assembly_5.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "neck-top-ring-socket", "localPosition": [0, 0.075, 0], "localRotation": [0, 0, 0]}, {"id": "neck-lower-ring-socket", "localPosition": [0, -0.07, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.19, 0.2, 0.19], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["neck-assembly"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["root"] ?? root).add(node_neck_assembly_5);
  nodes["neck-assembly"] = node_neck_assembly_5;
  const mesh_neck_assembly_5Geometry = endpoint_neck_assembly_5
    ? new THREE.CylinderGeometry(endpoint_neck_assembly_5.endRadius, endpoint_neck_assembly_5.baseRadius, endpoint_neck_assembly_5.length, 16, 6)
    : buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
  if (!endpoint_neck_assembly_5) {
    mesh_neck_assembly_5Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_neck_assembly_5 = new THREE.Mesh(
    mesh_neck_assembly_5Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_neck_assembly_5.name = "Turned neck assembly";
  if (endpoint_neck_assembly_5) {
    mesh_neck_assembly_5.position.copy(endpoint_neck_assembly_5.midpoint);
    mesh_neck_assembly_5.quaternion.copy(endpoint_neck_assembly_5.quaternion);
  }
  mesh_neck_assembly_5.castShadow = options.castShadow ?? true;
  mesh_neck_assembly_5.receiveShadow = options.receiveShadow ?? true;
  mesh_neck_assembly_5.userData.sculptComponent = {"id": "neck-assembly", "name": "Turned neck assembly", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.88, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A rotationally symmetric turned gold profile transitions from scrolls to the shaft.", "geometryDescriptor": {"topologyIntent": "A rotationally symmetric turned gold profile transitions from scrolls to the shaft.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "neck-socket", "localStart": [0, -0.1, 0], "localEnd": [0, -0.07500000000000001, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-neck", "right-neck"]}, "dimensions": {"width": 0.19, "height": 0.2, "depth": 0.19, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.34, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "neck-top-ring-socket", "localPosition": [0, 0.075, 0], "localRotation": [0, 0, 0]}, {"id": "neck-lower-ring-socket", "localPosition": [0, -0.07, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.19, 0.2, 0.19], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["neck-assembly"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "neck-assembly.three-stage-lathe", "type": "contour", "description": "Flattened upper collar, pinched waist and lower torus ring reproduce the reference transition.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "continuous lathe profile", "confidence": 0.9, "evidenceRefs": ["front-neck", "right-neck"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-neck", "right-neck"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-neck", "right-neck"]}};
  node_neck_assembly_5.add(mesh_neck_assembly_5);
  meshes["neck-assembly"] = mesh_neck_assembly_5;
  colliders["neck-assembly"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.19, 0.2, 0.19], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["shaft-assembly"] ??= [];
  destructionGroups["shaft-assembly"].push(node_neck_assembly_5);
  const socket_neck_assembly_neck_top_ring_socket_0 = new THREE.Object3D();
  socket_neck_assembly_neck_top_ring_socket_0.name = "neck-top-ring-socket";
  socket_neck_assembly_neck_top_ring_socket_0.position.set(0.0, 0.075, 0.0);
  socket_neck_assembly_neck_top_ring_socket_0.rotation.set(0.0, 0.0, 0.0);
  socket_neck_assembly_neck_top_ring_socket_0.userData.socket = {"id": "neck-top-ring-socket", "localPosition": [0, 0.075, 0], "localRotation": [0, 0, 0]};
  node_neck_assembly_5.add(socket_neck_assembly_neck_top_ring_socket_0);
  sockets["neck-assembly:neck-top-ring-socket"] = socket_neck_assembly_neck_top_ring_socket_0;
  const socket_neck_assembly_neck_lower_ring_socket_1 = new THREE.Object3D();
  socket_neck_assembly_neck_lower_ring_socket_1.name = "neck-lower-ring-socket";
  socket_neck_assembly_neck_lower_ring_socket_1.position.set(0.0, -0.07, 0.0);
  socket_neck_assembly_neck_lower_ring_socket_1.rotation.set(0.0, 0.0, 0.0);
  socket_neck_assembly_neck_lower_ring_socket_1.userData.socket = {"id": "neck-lower-ring-socket", "localPosition": [0, -0.07, 0], "localRotation": [0, 0, 0]};
  node_neck_assembly_5.add(socket_neck_assembly_neck_lower_ring_socket_1);
  sockets["neck-assembly:neck-lower-ring-socket"] = socket_neck_assembly_neck_lower_ring_socket_1;

  const attachment_neck_top_ring_6 = {"parentId": "neck-assembly", "parentSocket": "neck-top-ring-socket", "localStart": [0, -0.0175, 0], "localEnd": [0, 0.0075, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-neck"]};
  const endpoint_neck_top_ring_6 = makeAttachmentEndpoint(attachment_neck_top_ring_6);
  const node_neck_top_ring_6 = new THREE.Group();
  node_neck_top_ring_6.name = "Upper neck highlight ring__pivot";
  node_neck_top_ring_6.scale.set(1, 1, 1);
  if (endpoint_neck_top_ring_6) {
    node_neck_top_ring_6.position.copy(endpoint_neck_top_ring_6.start);
    node_neck_top_ring_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_neck_top_ring_6.position.set(0.0, 0.075, 0.0);
    node_neck_top_ring_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_neck_top_ring_6.userData.sculptComponent = {"id": "neck-top-ring", "name": "Upper neck highlight ring", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "A discrete toroidal turned ring creates the upper neck highlight crest.", "geometryDescriptor": {"topologyIntent": "A discrete toroidal turned ring creates the upper neck highlight crest.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "neck-assembly", "attachment": {"parentId": "neck-assembly", "parentSocket": "neck-top-ring-socket", "localStart": [0, -0.0175, 0], "localEnd": [0, 0.0075, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-neck"]}, "dimensions": {"width": 0.18, "height": 0.035, "depth": 0.18, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.075, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.18, 0.035, 0.18], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["neck-top-ring"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "neck-top-ring.rounded-crest", "type": "bevel", "description": "Rounded ring catches a continuous polished highlight.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "torus-like lathe ring", "confidence": 0.9, "evidenceRefs": ["front-neck"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-neck"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-neck"]}};
  node_neck_top_ring_6.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.18, 0.035, 0.18], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["neck-top-ring"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["neck-assembly"] ?? root).add(node_neck_top_ring_6);
  nodes["neck-top-ring"] = node_neck_top_ring_6;
  const mesh_neck_top_ring_6Geometry = endpoint_neck_top_ring_6
    ? new THREE.CylinderGeometry(endpoint_neck_top_ring_6.endRadius, endpoint_neck_top_ring_6.baseRadius, endpoint_neck_top_ring_6.length, 16, 6)
    : buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
  if (!endpoint_neck_top_ring_6) {
    mesh_neck_top_ring_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_neck_top_ring_6 = new THREE.Mesh(
    mesh_neck_top_ring_6Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_neck_top_ring_6.name = "Upper neck highlight ring";
  if (endpoint_neck_top_ring_6) {
    mesh_neck_top_ring_6.position.copy(endpoint_neck_top_ring_6.midpoint);
    mesh_neck_top_ring_6.quaternion.copy(endpoint_neck_top_ring_6.quaternion);
  }
  mesh_neck_top_ring_6.castShadow = options.castShadow ?? true;
  mesh_neck_top_ring_6.receiveShadow = options.receiveShadow ?? true;
  mesh_neck_top_ring_6.userData.sculptComponent = {"id": "neck-top-ring", "name": "Upper neck highlight ring", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "A discrete toroidal turned ring creates the upper neck highlight crest.", "geometryDescriptor": {"topologyIntent": "A discrete toroidal turned ring creates the upper neck highlight crest.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "neck-assembly", "attachment": {"parentId": "neck-assembly", "parentSocket": "neck-top-ring-socket", "localStart": [0, -0.0175, 0], "localEnd": [0, 0.0075, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-neck"]}, "dimensions": {"width": 0.18, "height": 0.035, "depth": 0.18, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.075, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.18, 0.035, 0.18], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["neck-top-ring"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "neck-top-ring.rounded-crest", "type": "bevel", "description": "Rounded ring catches a continuous polished highlight.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "torus-like lathe ring", "confidence": 0.9, "evidenceRefs": ["front-neck"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-neck"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-neck"]}};
  node_neck_top_ring_6.add(mesh_neck_top_ring_6);
  meshes["neck-top-ring"] = mesh_neck_top_ring_6;
  colliders["neck-top-ring"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.18, 0.035, 0.18], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["shaft-assembly"] ??= [];
  destructionGroups["shaft-assembly"].push(node_neck_top_ring_6);

  const attachment_neck_lower_ring_7 = {"parentId": "neck-assembly", "parentSocket": "neck-lower-ring-socket", "localStart": [0, -0.016, 0], "localEnd": [0, 0.009000000000000001, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-neck", "right-neck"]};
  const endpoint_neck_lower_ring_7 = makeAttachmentEndpoint(attachment_neck_lower_ring_7);
  const node_neck_lower_ring_7 = new THREE.Group();
  node_neck_lower_ring_7.name = "Lower neck collar ring__pivot";
  node_neck_lower_ring_7.scale.set(1, 1, 1);
  if (endpoint_neck_lower_ring_7) {
    node_neck_lower_ring_7.position.copy(endpoint_neck_lower_ring_7.start);
    node_neck_lower_ring_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_neck_lower_ring_7.position.set(0.0, -0.07, 0.0);
    node_neck_lower_ring_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_neck_lower_ring_7.userData.sculptComponent = {"id": "neck-lower-ring", "name": "Lower neck collar ring", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "A narrow lower collar overlaps the shaft root.", "geometryDescriptor": {"topologyIntent": "A narrow lower collar overlaps the shaft root.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "neck-assembly", "attachment": {"parentId": "neck-assembly", "parentSocket": "neck-lower-ring-socket", "localStart": [0, -0.016, 0], "localEnd": [0, 0.009000000000000001, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-neck", "right-neck"]}, "dimensions": {"width": 0.13, "height": 0.032, "depth": 0.13, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, -0.07, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.13, 0.032, 0.13], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["neck-lower-ring"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "neck-lower-ring.shaft-overlap", "type": "seam", "description": "The lower collar overlaps the shaft by 0.025 world units.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "lathe ring with attachment overlap", "confidence": 0.9, "evidenceRefs": ["front-neck", "right-neck"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-neck", "right-neck"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-neck", "right-neck"]}};
  node_neck_lower_ring_7.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.13, 0.032, 0.13], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["neck-lower-ring"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["neck-assembly"] ?? root).add(node_neck_lower_ring_7);
  nodes["neck-lower-ring"] = node_neck_lower_ring_7;
  const mesh_neck_lower_ring_7Geometry = endpoint_neck_lower_ring_7
    ? new THREE.CylinderGeometry(endpoint_neck_lower_ring_7.endRadius, endpoint_neck_lower_ring_7.baseRadius, endpoint_neck_lower_ring_7.length, 16, 6)
    : buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
  if (!endpoint_neck_lower_ring_7) {
    mesh_neck_lower_ring_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_neck_lower_ring_7 = new THREE.Mesh(
    mesh_neck_lower_ring_7Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_neck_lower_ring_7.name = "Lower neck collar ring";
  if (endpoint_neck_lower_ring_7) {
    mesh_neck_lower_ring_7.position.copy(endpoint_neck_lower_ring_7.midpoint);
    mesh_neck_lower_ring_7.quaternion.copy(endpoint_neck_lower_ring_7.quaternion);
  }
  mesh_neck_lower_ring_7.castShadow = options.castShadow ?? true;
  mesh_neck_lower_ring_7.receiveShadow = options.receiveShadow ?? true;
  mesh_neck_lower_ring_7.userData.sculptComponent = {"id": "neck-lower-ring", "name": "Lower neck collar ring", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "A narrow lower collar overlaps the shaft root.", "geometryDescriptor": {"topologyIntent": "A narrow lower collar overlaps the shaft root.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "neck-assembly", "attachment": {"parentId": "neck-assembly", "parentSocket": "neck-lower-ring-socket", "localStart": [0, -0.016, 0], "localEnd": [0, 0.009000000000000001, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-neck", "right-neck"]}, "dimensions": {"width": 0.13, "height": 0.032, "depth": 0.13, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, -0.07, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.13, 0.032, 0.13], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["neck-lower-ring"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "neck-lower-ring.shaft-overlap", "type": "seam", "description": "The lower collar overlaps the shaft by 0.025 world units.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "lathe ring with attachment overlap", "confidence": 0.9, "evidenceRefs": ["front-neck", "right-neck"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-neck", "right-neck"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-neck", "right-neck"]}};
  node_neck_lower_ring_7.add(mesh_neck_lower_ring_7);
  meshes["neck-lower-ring"] = mesh_neck_lower_ring_7;
  colliders["neck-lower-ring"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.13, 0.032, 0.13], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["shaft-assembly"] ??= [];
  destructionGroups["shaft-assembly"].push(node_neck_lower_ring_7);

  const attachment_shaft_core_8 = {"parentId": "root", "parentSocket": "shaft-socket", "localStart": [0, -0.69, 0], "localEnd": [0, -0.6649999999999999, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-shaft", "right-shaft"]};
  const endpoint_shaft_core_8 = makeAttachmentEndpoint(attachment_shaft_core_8);
  const node_shaft_core_8 = new THREE.Group();
  node_shaft_core_8.name = "Polished cylindrical shaft__pivot";
  node_shaft_core_8.scale.set(1, 1, 1);
  if (endpoint_shaft_core_8) {
    node_shaft_core_8.position.copy(endpoint_shaft_core_8.start);
    node_shaft_core_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shaft_core_8.position.set(0.0, -0.38, 0.0);
    node_shaft_core_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_shaft_core_8.userData.sculptComponent = {"id": "shaft-core", "name": "Polished cylindrical shaft", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.88, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "The long key stem is a straight circular cylinder with softly rounded longitudinal highlight response.", "geometryDescriptor": {"topologyIntent": "The long key stem is a straight circular cylinder with softly rounded longitudinal highlight response.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "shaft-socket", "localStart": [0, -0.69, 0], "localEnd": [0, -0.6649999999999999, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-shaft", "right-shaft"]}, "dimensions": {"width": 0.068, "height": 1.38, "depth": 0.068, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, -0.38, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "bit-bridge-socket", "localPosition": [0.055, -0.43, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.068, 1.38, 0.068], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["shaft-core"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shaft-core.cylindrical-profile", "type": "contour", "description": "Circular cross-section remains legible from the right-side view.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "high-segment capsule/cylinder", "confidence": 0.9, "evidenceRefs": ["front-shaft", "right-shaft"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-shaft", "right-shaft"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-shaft", "right-shaft"]}};
  node_shaft_core_8.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "bit-bridge-socket", "localPosition": [0.055, -0.43, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.068, 1.38, 0.068], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["shaft-core"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["root"] ?? root).add(node_shaft_core_8);
  nodes["shaft-core"] = node_shaft_core_8;
  const mesh_shaft_core_8Geometry = endpoint_shaft_core_8
    ? new THREE.CylinderGeometry(endpoint_shaft_core_8.endRadius, endpoint_shaft_core_8.baseRadius, endpoint_shaft_core_8.length, 16, 6)
    : buildWatertightCapsule(0.35, 0.7, 8, 16, 1);
  if (!endpoint_shaft_core_8) {
    mesh_shaft_core_8Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_shaft_core_8 = new THREE.Mesh(
    mesh_shaft_core_8Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shaft_core_8.name = "Polished cylindrical shaft";
  if (endpoint_shaft_core_8) {
    mesh_shaft_core_8.position.copy(endpoint_shaft_core_8.midpoint);
    mesh_shaft_core_8.quaternion.copy(endpoint_shaft_core_8.quaternion);
  }
  mesh_shaft_core_8.castShadow = options.castShadow ?? true;
  mesh_shaft_core_8.receiveShadow = options.receiveShadow ?? true;
  mesh_shaft_core_8.userData.sculptComponent = {"id": "shaft-core", "name": "Polished cylindrical shaft", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.88, "primitive": "capsule", "topologyClass": "assembled-solid", "topologyRationale": "The long key stem is a straight circular cylinder with softly rounded longitudinal highlight response.", "geometryDescriptor": {"topologyIntent": "The long key stem is a straight circular cylinder with softly rounded longitudinal highlight response.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "shaft-socket", "localStart": [0, -0.69, 0], "localEnd": [0, -0.6649999999999999, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-shaft", "right-shaft"]}, "dimensions": {"width": 0.068, "height": 1.38, "depth": 0.068, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, -0.38, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "bit-bridge-socket", "localPosition": [0.055, -0.43, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.068, 1.38, 0.068], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "shaft-assembly", "seamRefs": [], "detachableFragments": ["shaft-core"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "shaft-core.cylindrical-profile", "type": "contour", "description": "Circular cross-section remains legible from the right-side view.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "high-segment capsule/cylinder", "confidence": 0.9, "evidenceRefs": ["front-shaft", "right-shaft"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-shaft", "right-shaft"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-shaft", "right-shaft"]}};
  node_shaft_core_8.add(mesh_shaft_core_8);
  meshes["shaft-core"] = mesh_shaft_core_8;
  colliders["shaft-core"] = {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.068, 1.38, 0.068], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["shaft-assembly"] ??= [];
  destructionGroups["shaft-assembly"].push(node_shaft_core_8);
  const socket_shaft_core_bit_bridge_socket_0 = new THREE.Object3D();
  socket_shaft_core_bit_bridge_socket_0.name = "bit-bridge-socket";
  socket_shaft_core_bit_bridge_socket_0.position.set(0.055, -0.43, 0.0);
  socket_shaft_core_bit_bridge_socket_0.rotation.set(0.0, 0.0, 0.0);
  socket_shaft_core_bit_bridge_socket_0.userData.socket = {"id": "bit-bridge-socket", "localPosition": [0.055, -0.43, 0], "localRotation": [0, 0, 0]};
  node_shaft_core_8.add(socket_shaft_core_bit_bridge_socket_0);
  sockets["shaft-core:bit-bridge-socket"] = socket_shaft_core_bit_bridge_socket_0;

  const attachment_bit_bridge_9 = {"parentId": "shaft-core", "parentSocket": "bit-bridge-socket", "localStart": [0, -0.0325, 0], "localEnd": [0, -0.0075, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]};
  const endpoint_bit_bridge_9 = makeAttachmentEndpoint(attachment_bit_bridge_9);
  const node_bit_bridge_9 = new THREE.Group();
  node_bit_bridge_9.name = "Bit-to-shaft bridge__pivot";
  node_bit_bridge_9.scale.set(1, 1, 1);
  if (endpoint_bit_bridge_9) {
    node_bit_bridge_9.position.copy(endpoint_bit_bridge_9.start);
    node_bit_bridge_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_bit_bridge_9.position.set(0.055, -0.43, 0.0);
    node_bit_bridge_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_bit_bridge_9.userData.sculptComponent = {"id": "bit-bridge", "name": "Bit-to-shaft bridge", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A short rigid bridge overlaps the shaft and carries the meander bit plate.", "geometryDescriptor": {"topologyIntent": "A short rigid bridge overlaps the shaft and carries the meander bit plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "shaft-core", "attachment": {"parentId": "shaft-core", "parentSocket": "bit-bridge-socket", "localStart": [0, -0.0325, 0], "localEnd": [0, -0.0075, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]}, "dimensions": {"width": 0.12, "height": 0.065, "depth": 0.06, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.055, -0.43, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "meander-bit-socket", "localPosition": [0.095, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.12, 0.065, 0.06], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["bit-bridge"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bit-bridge.shaft-overlap", "type": "seam", "description": "Bridge penetrates the shaft silhouette slightly to avoid a floating connection.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "rounded extruded connector", "confidence": 0.9, "evidenceRefs": ["front-bit", "right-bit"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-bit", "right-bit"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-bit", "right-bit"]}};
  node_bit_bridge_9.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "meander-bit-socket", "localPosition": [0.095, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.12, 0.065, 0.06], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["bit-bridge"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["shaft-core"] ?? root).add(node_bit_bridge_9);
  nodes["bit-bridge"] = node_bit_bridge_9;
  const mesh_bit_bridge_9Geometry = endpoint_bit_bridge_9
    ? new THREE.CylinderGeometry(endpoint_bit_bridge_9.endRadius, endpoint_bit_bridge_9.baseRadius, endpoint_bit_bridge_9.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
  if (!endpoint_bit_bridge_9) {
    mesh_bit_bridge_9Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_bit_bridge_9 = new THREE.Mesh(
    mesh_bit_bridge_9Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_bit_bridge_9.name = "Bit-to-shaft bridge";
  if (endpoint_bit_bridge_9) {
    mesh_bit_bridge_9.position.copy(endpoint_bit_bridge_9.midpoint);
    mesh_bit_bridge_9.quaternion.copy(endpoint_bit_bridge_9.quaternion);
  }
  mesh_bit_bridge_9.castShadow = options.castShadow ?? true;
  mesh_bit_bridge_9.receiveShadow = options.receiveShadow ?? true;
  mesh_bit_bridge_9.userData.sculptComponent = {"id": "bit-bridge", "name": "Bit-to-shaft bridge", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A short rigid bridge overlaps the shaft and carries the meander bit plate.", "geometryDescriptor": {"topologyIntent": "A short rigid bridge overlaps the shaft and carries the meander bit plate.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "shaft-core", "attachment": {"parentId": "shaft-core", "parentSocket": "bit-bridge-socket", "localStart": [0, -0.0325, 0], "localEnd": [0, -0.0075, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]}, "dimensions": {"width": 0.12, "height": 0.065, "depth": 0.06, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.055, -0.43, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "meander-bit-socket", "localPosition": [0.095, 0, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.12, 0.065, 0.06], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["bit-bridge"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "bit-bridge.shaft-overlap", "type": "seam", "description": "Bridge penetrates the shaft silhouette slightly to avoid a floating connection.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "rounded extruded connector", "confidence": 0.9, "evidenceRefs": ["front-bit", "right-bit"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-bit", "right-bit"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-bit", "right-bit"]}};
  node_bit_bridge_9.add(mesh_bit_bridge_9);
  meshes["bit-bridge"] = mesh_bit_bridge_9;
  colliders["bit-bridge"] = {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.12, 0.065, 0.06], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["bit-assembly"] ??= [];
  destructionGroups["bit-assembly"].push(node_bit_bridge_9);
  const socket_bit_bridge_meander_bit_socket_0 = new THREE.Object3D();
  socket_bit_bridge_meander_bit_socket_0.name = "meander-bit-socket";
  socket_bit_bridge_meander_bit_socket_0.position.set(0.095, 0.0, 0.0);
  socket_bit_bridge_meander_bit_socket_0.rotation.set(0.0, 0.0, 0.0);
  socket_bit_bridge_meander_bit_socket_0.userData.socket = {"id": "meander-bit-socket", "localPosition": [0.095, 0, 0], "localRotation": [0, 0, 0]};
  node_bit_bridge_9.add(socket_bit_bridge_meander_bit_socket_0);
  sockets["bit-bridge:meander-bit-socket"] = socket_bit_bridge_meander_bit_socket_0;

  const attachment_meander_bit_10 = {"parentId": "bit-bridge", "parentSocket": "meander-bit-socket", "localStart": [0, -0.12, 0], "localEnd": [0, -0.095, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]};
  const endpoint_meander_bit_10 = makeAttachmentEndpoint(attachment_meander_bit_10);
  const node_meander_bit_10 = new THREE.Group();
  node_meander_bit_10.name = "Single right-facing meander bit__pivot";
  node_meander_bit_10.scale.set(1, 1, 1);
  if (endpoint_meander_bit_10) {
    node_meander_bit_10.position.copy(endpoint_meander_bit_10.start);
    node_meander_bit_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_meander_bit_10.position.set(0.14, -0.84, 0.0);
    node_meander_bit_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_meander_bit_10.userData.sculptComponent = {"id": "meander-bit", "name": "Single right-facing meander bit", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.88, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A discrete beveled gold plate uses a true G-shaped inner cutout and lower return tooth.", "geometryDescriptor": {"topologyIntent": "A discrete beveled gold plate uses a true G-shaped inner cutout and lower return tooth.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "bit-bridge", "attachment": {"parentId": "bit-bridge", "parentSocket": "meander-bit-socket", "localStart": [0, -0.12, 0], "localEnd": [0, -0.095, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]}, "dimensions": {"width": 0.27, "height": 0.24, "depth": 0.06, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.14, -0.84, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.27, 0.24, 0.06], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["meander-bit"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "meander-bit.g-shaped-cutout", "type": "hole", "description": "The inner square meander is a real opening rather than a dark decal.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "custom extruded Shape with negative-space hole", "confidence": 0.9, "evidenceRefs": ["front-bit"]}, {"id": "meander-bit.rounded-bevel", "type": "bevel", "description": "Front, rear and cutout edges carry rounded bevels.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "four-segment bevel", "confidence": 0.9, "evidenceRefs": ["front-bit", "right-bit"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-bit", "right-bit"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-bit", "right-bit"]}};
  node_meander_bit_10.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.27, 0.24, 0.06], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["meander-bit"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["bit-bridge"] ?? root).add(node_meander_bit_10);
  nodes["meander-bit"] = node_meander_bit_10;
  const mesh_meander_bit_10Geometry = endpoint_meander_bit_10
    ? new THREE.CylinderGeometry(endpoint_meander_bit_10.endRadius, endpoint_meander_bit_10.baseRadius, endpoint_meander_bit_10.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
  if (!endpoint_meander_bit_10) {
    mesh_meander_bit_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_meander_bit_10 = new THREE.Mesh(
    mesh_meander_bit_10Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_meander_bit_10.name = "Single right-facing meander bit";
  if (endpoint_meander_bit_10) {
    mesh_meander_bit_10.position.copy(endpoint_meander_bit_10.midpoint);
    mesh_meander_bit_10.quaternion.copy(endpoint_meander_bit_10.quaternion);
  }
  mesh_meander_bit_10.castShadow = options.castShadow ?? true;
  mesh_meander_bit_10.receiveShadow = options.receiveShadow ?? true;
  mesh_meander_bit_10.userData.sculptComponent = {"id": "meander-bit", "name": "Single right-facing meander bit", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.88, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A discrete beveled gold plate uses a true G-shaped inner cutout and lower return tooth.", "geometryDescriptor": {"topologyIntent": "A discrete beveled gold plate uses a true G-shaped inner cutout and lower return tooth.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "bit-bridge", "attachment": {"parentId": "bit-bridge", "parentSocket": "meander-bit-socket", "localStart": [0, -0.12, 0], "localEnd": [0, -0.095, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-bit", "right-bit"]}, "dimensions": {"width": 0.27, "height": 0.24, "depth": 0.06, "units": "relative", "confidence": 0.88}, "transform": {"position": [0.14, -0.84, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.27, 0.24, 0.06], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "bit-assembly", "seamRefs": [], "detachableFragments": ["meander-bit"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "meander-bit.g-shaped-cutout", "type": "hole", "description": "The inner square meander is a real opening rather than a dark decal.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "custom extruded Shape with negative-space hole", "confidence": 0.9, "evidenceRefs": ["front-bit"]}, {"id": "meander-bit.rounded-bevel", "type": "bevel", "description": "Front, rear and cutout edges carry rounded bevels.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "four-segment bevel", "confidence": 0.9, "evidenceRefs": ["front-bit", "right-bit"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-bit", "right-bit"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-bit", "right-bit"]}};
  node_meander_bit_10.add(mesh_meander_bit_10);
  meshes["meander-bit"] = mesh_meander_bit_10;
  colliders["meander-bit"] = {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.27, 0.24, 0.06], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["bit-assembly"] ??= [];
  destructionGroups["bit-assembly"].push(node_meander_bit_10);

  const attachment_terminal_assembly_11 = {"parentId": "root", "parentSocket": "terminal-socket", "localStart": [0, -0.095, 0], "localEnd": [0, -0.07, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-terminal", "right-terminal"]};
  const endpoint_terminal_assembly_11 = makeAttachmentEndpoint(attachment_terminal_assembly_11);
  const node_terminal_assembly_11 = new THREE.Group();
  node_terminal_assembly_11.name = "Turned terminal assembly__pivot";
  node_terminal_assembly_11.scale.set(1, 1, 1);
  if (endpoint_terminal_assembly_11) {
    node_terminal_assembly_11.position.copy(endpoint_terminal_assembly_11.start);
    node_terminal_assembly_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_terminal_assembly_11.position.set(0.0, -1.1, 0.0);
    node_terminal_assembly_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_terminal_assembly_11.userData.sculptComponent = {"id": "terminal-assembly", "name": "Turned terminal assembly", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.88, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A rotationally symmetric terminal profile carries two rings and the final bead.", "geometryDescriptor": {"topologyIntent": "A rotationally symmetric terminal profile carries two rings and the final bead.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "terminal-socket", "localStart": [0, -0.095, 0], "localEnd": [0, -0.07, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-terminal", "right-terminal"]}, "dimensions": {"width": 0.12, "height": 0.19, "depth": 0.12, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, -1.1, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "terminal-upper-ring-socket", "localPosition": [0, 0.045, 0], "localRotation": [0, 0, 0]}, {"id": "terminal-lower-ring-socket", "localPosition": [0, 0.012, 0], "localRotation": [0, 0, 0]}, {"id": "terminal-bead-socket", "localPosition": [0, -0.065, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.12, 0.19, 0.12], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terminal-assembly", "seamRefs": [], "detachableFragments": ["terminal-assembly"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "terminal-assembly.rings-and-bead", "type": "contour", "description": "Two narrow rings terminate in a small rounded bead.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "continuous turned profile plus bead", "confidence": 0.9, "evidenceRefs": ["front-terminal", "right-terminal"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-terminal", "right-terminal"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-terminal", "right-terminal"]}};
  node_terminal_assembly_11.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "terminal-upper-ring-socket", "localPosition": [0, 0.045, 0], "localRotation": [0, 0, 0]}, {"id": "terminal-lower-ring-socket", "localPosition": [0, 0.012, 0], "localRotation": [0, 0, 0]}, {"id": "terminal-bead-socket", "localPosition": [0, -0.065, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.12, 0.19, 0.12], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terminal-assembly", "seamRefs": [], "detachableFragments": ["terminal-assembly"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["root"] ?? root).add(node_terminal_assembly_11);
  nodes["terminal-assembly"] = node_terminal_assembly_11;
  const mesh_terminal_assembly_11Geometry = endpoint_terminal_assembly_11
    ? new THREE.CylinderGeometry(endpoint_terminal_assembly_11.endRadius, endpoint_terminal_assembly_11.baseRadius, endpoint_terminal_assembly_11.length, 16, 6)
    : buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
  if (!endpoint_terminal_assembly_11) {
    mesh_terminal_assembly_11Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_terminal_assembly_11 = new THREE.Mesh(
    mesh_terminal_assembly_11Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_terminal_assembly_11.name = "Turned terminal assembly";
  if (endpoint_terminal_assembly_11) {
    mesh_terminal_assembly_11.position.copy(endpoint_terminal_assembly_11.midpoint);
    mesh_terminal_assembly_11.quaternion.copy(endpoint_terminal_assembly_11.quaternion);
  }
  mesh_terminal_assembly_11.castShadow = options.castShadow ?? true;
  mesh_terminal_assembly_11.receiveShadow = options.receiveShadow ?? true;
  mesh_terminal_assembly_11.userData.sculptComponent = {"id": "terminal-assembly", "name": "Turned terminal assembly", "level": "macro", "role": "static-part", "importance": 0.95, "confidence": 0.88, "primitive": "lathe", "topologyClass": "continuous-sculpt", "topologyRationale": "A rotationally symmetric terminal profile carries two rings and the final bead.", "geometryDescriptor": {"topologyIntent": "A rotationally symmetric terminal profile carries two rings and the final bead.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "root", "attachment": {"parentId": "root", "parentSocket": "terminal-socket", "localStart": [0, -0.095, 0], "localEnd": [0, -0.07, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-terminal", "right-terminal"]}, "dimensions": {"width": 0.12, "height": 0.19, "depth": 0.12, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, -1.1, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [{"id": "terminal-upper-ring-socket", "localPosition": [0, 0.045, 0], "localRotation": [0, 0, 0]}, {"id": "terminal-lower-ring-socket", "localPosition": [0, 0.012, 0], "localRotation": [0, 0, 0]}, {"id": "terminal-bead-socket", "localPosition": [0, -0.065, 0], "localRotation": [0, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.12, 0.19, 0.12], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terminal-assembly", "seamRefs": [], "detachableFragments": ["terminal-assembly"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "terminal-assembly.rings-and-bead", "type": "contour", "description": "Two narrow rings terminate in a small rounded bead.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "continuous turned profile plus bead", "confidence": 0.9, "evidenceRefs": ["front-terminal", "right-terminal"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-terminal", "right-terminal"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-terminal", "right-terminal"]}};
  node_terminal_assembly_11.add(mesh_terminal_assembly_11);
  meshes["terminal-assembly"] = mesh_terminal_assembly_11;
  colliders["terminal-assembly"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.12, 0.19, 0.12], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["terminal-assembly"] ??= [];
  destructionGroups["terminal-assembly"].push(node_terminal_assembly_11);
  const socket_terminal_assembly_terminal_upper_ring_socket_0 = new THREE.Object3D();
  socket_terminal_assembly_terminal_upper_ring_socket_0.name = "terminal-upper-ring-socket";
  socket_terminal_assembly_terminal_upper_ring_socket_0.position.set(0.0, 0.045, 0.0);
  socket_terminal_assembly_terminal_upper_ring_socket_0.rotation.set(0.0, 0.0, 0.0);
  socket_terminal_assembly_terminal_upper_ring_socket_0.userData.socket = {"id": "terminal-upper-ring-socket", "localPosition": [0, 0.045, 0], "localRotation": [0, 0, 0]};
  node_terminal_assembly_11.add(socket_terminal_assembly_terminal_upper_ring_socket_0);
  sockets["terminal-assembly:terminal-upper-ring-socket"] = socket_terminal_assembly_terminal_upper_ring_socket_0;
  const socket_terminal_assembly_terminal_lower_ring_socket_1 = new THREE.Object3D();
  socket_terminal_assembly_terminal_lower_ring_socket_1.name = "terminal-lower-ring-socket";
  socket_terminal_assembly_terminal_lower_ring_socket_1.position.set(0.0, 0.012, 0.0);
  socket_terminal_assembly_terminal_lower_ring_socket_1.rotation.set(0.0, 0.0, 0.0);
  socket_terminal_assembly_terminal_lower_ring_socket_1.userData.socket = {"id": "terminal-lower-ring-socket", "localPosition": [0, 0.012, 0], "localRotation": [0, 0, 0]};
  node_terminal_assembly_11.add(socket_terminal_assembly_terminal_lower_ring_socket_1);
  sockets["terminal-assembly:terminal-lower-ring-socket"] = socket_terminal_assembly_terminal_lower_ring_socket_1;
  const socket_terminal_assembly_terminal_bead_socket_2 = new THREE.Object3D();
  socket_terminal_assembly_terminal_bead_socket_2.name = "terminal-bead-socket";
  socket_terminal_assembly_terminal_bead_socket_2.position.set(0.0, -0.065, 0.0);
  socket_terminal_assembly_terminal_bead_socket_2.rotation.set(0.0, 0.0, 0.0);
  socket_terminal_assembly_terminal_bead_socket_2.userData.socket = {"id": "terminal-bead-socket", "localPosition": [0, -0.065, 0], "localRotation": [0, 0, 0]};
  node_terminal_assembly_11.add(socket_terminal_assembly_terminal_bead_socket_2);
  sockets["terminal-assembly:terminal-bead-socket"] = socket_terminal_assembly_terminal_bead_socket_2;

  const attachment_terminal_upper_ring_12 = {"parentId": "terminal-assembly", "parentSocket": "terminal-upper-ring-socket", "localStart": [0, -0.0125, 0], "localEnd": [0, 0.0125, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-terminal"]};
  const endpoint_terminal_upper_ring_12 = makeAttachmentEndpoint(attachment_terminal_upper_ring_12);
  const node_terminal_upper_ring_12 = new THREE.Group();
  node_terminal_upper_ring_12.name = "Upper terminal ring__pivot";
  node_terminal_upper_ring_12.scale.set(1, 1, 1);
  if (endpoint_terminal_upper_ring_12) {
    node_terminal_upper_ring_12.position.copy(endpoint_terminal_upper_ring_12.start);
    node_terminal_upper_ring_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_terminal_upper_ring_12.position.set(0.0, 0.045, 0.0);
    node_terminal_upper_ring_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_terminal_upper_ring_12.userData.sculptComponent = {"id": "terminal-upper-ring", "name": "Upper terminal ring", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "First narrow toroidal terminal ring.", "geometryDescriptor": {"topologyIntent": "First narrow toroidal terminal ring.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "terminal-assembly", "attachment": {"parentId": "terminal-assembly", "parentSocket": "terminal-upper-ring-socket", "localStart": [0, -0.0125, 0], "localEnd": [0, 0.0125, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-terminal"]}, "dimensions": {"width": 0.105, "height": 0.025, "depth": 0.105, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.045, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.025, 0.105], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terminal-assembly", "seamRefs": [], "detachableFragments": ["terminal-upper-ring"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "terminal-upper-ring.crest", "type": "bevel", "description": "Rounded gold crest provides a narrow highlight.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "torus-like lathe ring", "confidence": 0.9, "evidenceRefs": ["front-terminal"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-terminal"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-terminal"]}};
  node_terminal_upper_ring_12.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.025, 0.105], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terminal-assembly", "seamRefs": [], "detachableFragments": ["terminal-upper-ring"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["terminal-assembly"] ?? root).add(node_terminal_upper_ring_12);
  nodes["terminal-upper-ring"] = node_terminal_upper_ring_12;
  const mesh_terminal_upper_ring_12Geometry = endpoint_terminal_upper_ring_12
    ? new THREE.CylinderGeometry(endpoint_terminal_upper_ring_12.endRadius, endpoint_terminal_upper_ring_12.baseRadius, endpoint_terminal_upper_ring_12.length, 16, 6)
    : buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
  if (!endpoint_terminal_upper_ring_12) {
    mesh_terminal_upper_ring_12Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_terminal_upper_ring_12 = new THREE.Mesh(
    mesh_terminal_upper_ring_12Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_terminal_upper_ring_12.name = "Upper terminal ring";
  if (endpoint_terminal_upper_ring_12) {
    mesh_terminal_upper_ring_12.position.copy(endpoint_terminal_upper_ring_12.midpoint);
    mesh_terminal_upper_ring_12.quaternion.copy(endpoint_terminal_upper_ring_12.quaternion);
  }
  mesh_terminal_upper_ring_12.castShadow = options.castShadow ?? true;
  mesh_terminal_upper_ring_12.receiveShadow = options.receiveShadow ?? true;
  mesh_terminal_upper_ring_12.userData.sculptComponent = {"id": "terminal-upper-ring", "name": "Upper terminal ring", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "First narrow toroidal terminal ring.", "geometryDescriptor": {"topologyIntent": "First narrow toroidal terminal ring.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "terminal-assembly", "attachment": {"parentId": "terminal-assembly", "parentSocket": "terminal-upper-ring-socket", "localStart": [0, -0.0125, 0], "localEnd": [0, 0.0125, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-terminal"]}, "dimensions": {"width": 0.105, "height": 0.025, "depth": 0.105, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.045, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.025, 0.105], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terminal-assembly", "seamRefs": [], "detachableFragments": ["terminal-upper-ring"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "terminal-upper-ring.crest", "type": "bevel", "description": "Rounded gold crest provides a narrow highlight.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "torus-like lathe ring", "confidence": 0.9, "evidenceRefs": ["front-terminal"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-terminal"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-terminal"]}};
  node_terminal_upper_ring_12.add(mesh_terminal_upper_ring_12);
  meshes["terminal-upper-ring"] = mesh_terminal_upper_ring_12;
  colliders["terminal-upper-ring"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.025, 0.105], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["terminal-assembly"] ??= [];
  destructionGroups["terminal-assembly"].push(node_terminal_upper_ring_12);

  const attachment_terminal_lower_ring_13 = {"parentId": "terminal-assembly", "parentSocket": "terminal-lower-ring-socket", "localStart": [0, -0.0115, 0], "localEnd": [0, 0.013500000000000002, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-terminal"]};
  const endpoint_terminal_lower_ring_13 = makeAttachmentEndpoint(attachment_terminal_lower_ring_13);
  const node_terminal_lower_ring_13 = new THREE.Group();
  node_terminal_lower_ring_13.name = "Lower terminal ring__pivot";
  node_terminal_lower_ring_13.scale.set(1, 1, 1);
  if (endpoint_terminal_lower_ring_13) {
    node_terminal_lower_ring_13.position.copy(endpoint_terminal_lower_ring_13.start);
    node_terminal_lower_ring_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_terminal_lower_ring_13.position.set(0.0, 0.012, 0.0);
    node_terminal_lower_ring_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_terminal_lower_ring_13.userData.sculptComponent = {"id": "terminal-lower-ring", "name": "Lower terminal ring", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Second narrow terminal ring above the bead.", "geometryDescriptor": {"topologyIntent": "Second narrow terminal ring above the bead.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "terminal-assembly", "attachment": {"parentId": "terminal-assembly", "parentSocket": "terminal-lower-ring-socket", "localStart": [0, -0.0115, 0], "localEnd": [0, 0.013500000000000002, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-terminal"]}, "dimensions": {"width": 0.095, "height": 0.023, "depth": 0.095, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.012, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.095, 0.023, 0.095], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terminal-assembly", "seamRefs": [], "detachableFragments": ["terminal-lower-ring"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "terminal-lower-ring.crest", "type": "bevel", "description": "Rounded gold crest separates the bead from the shaft.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "torus-like lathe ring", "confidence": 0.9, "evidenceRefs": ["front-terminal"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-terminal"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-terminal"]}};
  node_terminal_lower_ring_13.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.095, 0.023, 0.095], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terminal-assembly", "seamRefs": [], "detachableFragments": ["terminal-lower-ring"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["terminal-assembly"] ?? root).add(node_terminal_lower_ring_13);
  nodes["terminal-lower-ring"] = node_terminal_lower_ring_13;
  const mesh_terminal_lower_ring_13Geometry = endpoint_terminal_lower_ring_13
    ? new THREE.CylinderGeometry(endpoint_terminal_lower_ring_13.endRadius, endpoint_terminal_lower_ring_13.baseRadius, endpoint_terminal_lower_ring_13.length, 16, 6)
    : buildLatheGeometry({"points": [[0.3, -0.5], [0.15, 0.0], [0.3, 0.5]], "segments": 24});
  if (!endpoint_terminal_lower_ring_13) {
    mesh_terminal_lower_ring_13Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_terminal_lower_ring_13 = new THREE.Mesh(
    mesh_terminal_lower_ring_13Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_terminal_lower_ring_13.name = "Lower terminal ring";
  if (endpoint_terminal_lower_ring_13) {
    mesh_terminal_lower_ring_13.position.copy(endpoint_terminal_lower_ring_13.midpoint);
    mesh_terminal_lower_ring_13.quaternion.copy(endpoint_terminal_lower_ring_13.quaternion);
  }
  mesh_terminal_lower_ring_13.castShadow = options.castShadow ?? true;
  mesh_terminal_lower_ring_13.receiveShadow = options.receiveShadow ?? true;
  mesh_terminal_lower_ring_13.userData.sculptComponent = {"id": "terminal-lower-ring", "name": "Lower terminal ring", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Second narrow terminal ring above the bead.", "geometryDescriptor": {"topologyIntent": "Second narrow terminal ring above the bead.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "terminal-assembly", "attachment": {"parentId": "terminal-assembly", "parentSocket": "terminal-lower-ring-socket", "localStart": [0, -0.0115, 0], "localEnd": [0, 0.013500000000000002, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-terminal"]}, "dimensions": {"width": 0.095, "height": 0.023, "depth": 0.095, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, 0.012, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.095, 0.023, 0.095], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terminal-assembly", "seamRefs": [], "detachableFragments": ["terminal-lower-ring"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "terminal-lower-ring.crest", "type": "bevel", "description": "Rounded gold crest separates the bead from the shaft.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "torus-like lathe ring", "confidence": 0.9, "evidenceRefs": ["front-terminal"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-terminal"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-terminal"]}};
  node_terminal_lower_ring_13.add(mesh_terminal_lower_ring_13);
  meshes["terminal-lower-ring"] = mesh_terminal_lower_ring_13;
  colliders["terminal-lower-ring"] = {"type": "thin-box", "offset": [0, 0, 0], "scale": [0.095, 0.023, 0.095], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["terminal-assembly"] ??= [];
  destructionGroups["terminal-assembly"].push(node_terminal_lower_ring_13);

  const attachment_terminal_bead_14 = {"parentId": "terminal-assembly", "parentSocket": "terminal-bead-socket", "localStart": [0, -0.0575, 0], "localEnd": [0, -0.0325, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-terminal", "right-terminal"]};
  const endpoint_terminal_bead_14 = makeAttachmentEndpoint(attachment_terminal_bead_14);
  const node_terminal_bead_14 = new THREE.Group();
  node_terminal_bead_14.name = "Rounded terminal bead__pivot";
  node_terminal_bead_14.scale.set(1, 1, 1);
  if (endpoint_terminal_bead_14) {
    node_terminal_bead_14.position.copy(endpoint_terminal_bead_14.start);
    node_terminal_bead_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_terminal_bead_14.position.set(0.0, -0.065, 0.0);
    node_terminal_bead_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_terminal_bead_14.userData.sculptComponent = {"id": "terminal-bead", "name": "Rounded terminal bead", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "A subtly vertically stretched rounded bead closes the key axis.", "geometryDescriptor": {"topologyIntent": "A subtly vertically stretched rounded bead closes the key axis.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "terminal-assembly", "attachment": {"parentId": "terminal-assembly", "parentSocket": "terminal-bead-socket", "localStart": [0, -0.0575, 0], "localEnd": [0, -0.0325, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-terminal", "right-terminal"]}, "dimensions": {"width": 0.105, "height": 0.115, "depth": 0.105, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, -0.065, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.115, 0.105], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terminal-assembly", "seamRefs": [], "detachableFragments": ["terminal-bead"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "terminal-bead.soft-pole", "type": "contour", "description": "Spherical bead has softly flattened top contact and rounded lower pole.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "scaled UV sphere", "confidence": 0.9, "evidenceRefs": ["front-terminal", "right-terminal"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-terminal", "right-terminal"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-terminal", "right-terminal"]}};
  node_terminal_bead_14.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.115, 0.105], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terminal-assembly", "seamRefs": [], "detachableFragments": ["terminal-bead"], "breakImpulse": 1, "debrisMaterial": "gold"}};
  (nodes["terminal-assembly"] ?? root).add(node_terminal_bead_14);
  nodes["terminal-bead"] = node_terminal_bead_14;
  const mesh_terminal_bead_14Geometry = endpoint_terminal_bead_14
    ? new THREE.CylinderGeometry(endpoint_terminal_bead_14.endRadius, endpoint_terminal_bead_14.baseRadius, endpoint_terminal_bead_14.length, 16, 6)
    : new THREE.SphereGeometry(0.5, 32, 20);
  if (!endpoint_terminal_bead_14) {
    mesh_terminal_bead_14Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_terminal_bead_14 = new THREE.Mesh(
    mesh_terminal_bead_14Geometry,
    materialMap["gold"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_terminal_bead_14.name = "Rounded terminal bead";
  if (endpoint_terminal_bead_14) {
    mesh_terminal_bead_14.position.copy(endpoint_terminal_bead_14.midpoint);
    mesh_terminal_bead_14.quaternion.copy(endpoint_terminal_bead_14.quaternion);
  }
  mesh_terminal_bead_14.castShadow = options.castShadow ?? true;
  mesh_terminal_bead_14.receiveShadow = options.receiveShadow ?? true;
  mesh_terminal_bead_14.userData.sculptComponent = {"id": "terminal-bead", "name": "Rounded terminal bead", "level": "meso", "role": "static-part", "importance": 0.78, "confidence": 0.88, "primitive": "sphere", "topologyClass": "continuous-sculpt", "topologyRationale": "A subtly vertically stretched rounded bead closes the key axis.", "geometryDescriptor": {"topologyIntent": "A subtly vertically stretched rounded bead closes the key axis.", "edgeTreatment": {"type": "bevel", "bevelRadius": 0.012, "segments": 4}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "analytic primitive normals with bevel-aware recomputation"}, "parent": "terminal-assembly", "attachment": {"parentId": "terminal-assembly", "parentSocket": "terminal-bead-socket", "localStart": [0, -0.0575, 0], "localEnd": [0, -0.0325, 0], "contactType": "overlap", "contactNormal": [0, 1, 0], "overlap": 0.025, "gapTolerance": 0.008, "evidenceRefs": ["front-terminal", "right-terminal"]}, "dimensions": {"width": 0.105, "height": 0.115, "depth": 0.105, "units": "relative", "confidence": 0.88}, "transform": {"position": [0, -0.065, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "component-center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.9}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": true, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.115, 0.105], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."}, "constraints": [], "destruction": {"breakable": true, "fractureGroup": "terminal-assembly", "seamRefs": [], "detachableFragments": ["terminal-bead"], "breakImpulse": 1, "debrisMaterial": "gold"}}, "material": "gold", "materialLayers": ["gold"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "terminal-bead.soft-pole", "type": "contour", "description": "Spherical bead has softly flattened top contact and rounded lower pole.", "placement": "reference-observed component-local region", "size": "object-relative measurement recorded in cloud-key detail inventory", "orientation": "aligned to the component surface and source-key axis", "materialEffect": "contact AO and physically-lit highlight separation", "geometryEffect": "scaled UV sphere", "confidence": 0.9, "evidenceRefs": ["front-terminal", "right-terminal"]}], "surfaceDetail": {"macroRoughness": 0.04, "microRoughness": 0.06, "bumpAmplitude": 0.002, "normalPattern": "subtle directional polish field", "displacementPattern": "none", "occlusionPattern": "contact seams and scroll grooves", "edgeWearPattern": "none observed", "notes": "Independent PBR channels; no albedo aliasing."}, "evidenceRefs": ["front-terminal", "right-terminal"], "details": [], "fidelityTier": "structural", "colorMaterialRecipe": {"dominantAlbedo": "rgba(211, 157, 54, 1)", "secondaryAlbedo": "rgba(255, 224, 142, 1)", "materialClass": "metal", "materialClassConfidence": 0.95, "colorGradient": {"type": "linear", "stops": [{"position": 0, "color": "rgba(164, 112, 27, 1)"}, {"position": 0.55, "color": "rgba(226, 177, 74, 1)"}, {"position": 1, "color": "rgba(255, 232, 164, 1)"}]}, "evidenceRefs": ["front-terminal", "right-terminal"]}};
  node_terminal_bead_14.add(mesh_terminal_bead_14);
  meshes["terminal-bead"] = mesh_terminal_bead_14;
  colliders["terminal-bead"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.105, 0.115, 0.105], "isTrigger": false, "notes": "Simplified selection and physics proxy; visual geometry remains independent."};
  destructionGroups["terminal-assembly"] ??= [];
  destructionGroups["terminal-assembly"].push(node_terminal_bead_14);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createObjectLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "\u7965\u4e91\u7389\u77f3\u94a5\u5319 look-dev lights";
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
  lights.userData.lightingFromPhoto = ["Warm large key light from camera upper-left at about 42 degrees creates broad gold and jade highlights.", "Soft warm front fill lifts the jade interior without flattening scroll grooves.", "Cool-neutral rear rim separates the pale jade bezel from the ivory background.", "ACESFilmic tone mapping near exposure 1.05, warm ivory background and soft contact shadow."];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createObjectEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameObjectCamera(
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
export function createObjectPresentationComposer(
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

export function configureObjectRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createObjectInspectControls(
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
