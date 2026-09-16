import * as THREE from "three";

type RoundedRectOptions = {
  width: number;
  height: number;
  radius: number;
};

function extrudeShape(shape: THREE.Shape, depth: number, bevelSize: number, bevelSegments = 4) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    curveSegments: 24,
    bevelEnabled: bevelSize > 0,
    bevelSegments,
    bevelSize,
    bevelThickness: Math.min(depth * 0.22, bevelSize * 0.9),
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function cloudPath(width: number, height: number) {
  const x = width;
  const y = height;
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.5 * y);
  shape.bezierCurveTo(-0.075 * x, -0.5 * y, -0.11 * x, -0.405 * y, -0.19 * x, -0.39 * y);
  shape.bezierCurveTo(-0.31 * x, -0.405 * y, -0.45 * x, -0.315 * y, -0.485 * x, -0.155 * y);
  shape.bezierCurveTo(-0.525 * x, 0.04 * y, -0.44 * x, 0.225 * y, -0.29 * x, 0.255 * y);
  shape.bezierCurveTo(-0.265 * x, 0.43 * y, -0.15 * x, 0.505 * y, 0, 0.505 * y);
  shape.bezierCurveTo(0.15 * x, 0.505 * y, 0.265 * x, 0.43 * y, 0.29 * x, 0.255 * y);
  shape.bezierCurveTo(0.44 * x, 0.225 * y, 0.525 * x, 0.04 * y, 0.485 * x, -0.155 * y);
  shape.bezierCurveTo(0.45 * x, -0.315 * y, 0.31 * x, -0.405 * y, 0.19 * x, -0.39 * y);
  shape.bezierCurveTo(0.11 * x, -0.405 * y, 0.075 * x, -0.5 * y, 0, -0.5 * y);
  shape.closePath();
  return shape;
}

function sampleCloudContour(width: number, height: number, divisions = 192) {
  const points = cloudPath(width, height).getSpacedPoints(divisions);
  if (points.length > 1 && points[0].distanceTo(points.at(-1) as THREE.Vector2) < 1e-6) points.pop();
  return points;
}

/** A two-sided shallow jade loft: broad convex faces over a full-thickness rim. */
export function createCloudJadeGeometry(width = 0.82, height = 0.62, thickness = 0.15) {
  const contour = sampleCloudContour(width, height, 176);
  const half = thickness / 2;
  const radialScales = [0.16, 0.34, 0.52, 0.7, 0.86, 1];
  const bevelDepth = thickness * 0.14;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const count = contour.length;

  const addRing = (scale: number, z: number) => {
    const offset = positions.length / 3;
    for (const point of contour) {
      positions.push(point.x * scale, point.y * scale, z);
      uvs.push(point.x / width + 0.5, point.y / height + 0.5);
    }
    return offset;
  };

  const backPole = positions.length / 3;
  positions.push(0, 0, -half);
  uvs.push(0.5, 0.5);
  const backRings = radialScales.map((scale) => addRing(scale, -half + bevelDepth * Math.pow(scale, 1.7)));
  const frontPole = positions.length / 3;
  positions.push(0, 0, half);
  uvs.push(0.5, 0.5);
  const frontRings = radialScales.map((scale) => addRing(scale, half - bevelDepth * Math.pow(scale, 1.7)));

  for (let index = 0; index < count; index += 1) {
    const following = (index + 1) % count;
    indices.push(backPole, backRings[0] + index, backRings[0] + following);
    indices.push(frontPole, frontRings[0] + following, frontRings[0] + index);
  }

  const connectRings = (rings: number[], reverse: boolean) => {
    for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
      const current = rings[ringIndex];
      const next = rings[ringIndex + 1];
      for (let index = 0; index < count; index += 1) {
        const following = (index + 1) % count;
        if (reverse) {
          indices.push(current + index, next + following, next + index);
          indices.push(current + index, current + following, next + following);
        } else {
          indices.push(current + index, next + index, next + following);
          indices.push(current + index, next + following, current + following);
        }
      }
    }
  };
  connectRings(backRings, false);
  connectRings(frontRings, true);

  const backOuter = backRings.at(-1) as number;
  const frontOuter = frontRings.at(-1) as number;
  for (let index = 0; index < count; index += 1) {
    const following = (index + 1) % count;
    indices.push(backOuter + index, frontOuter + index, frontOuter + following);
    indices.push(backOuter + index, frontOuter + following, backOuter + following);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createCloudBezelGeometry(
  outerWidth = 0.88,
  outerHeight = 0.67,
  innerWidth = 0.82,
  innerHeight = 0.61,
  depth = 0.066,
) {
  const outer = sampleCloudContour(outerWidth, outerHeight, 144);
  const inner = sampleCloudContour(innerWidth, innerHeight, 144).reverse();
  const shape = new THREE.Shape(outer);
  shape.closePath();
  const hole = new THREE.Path(inner);
  hole.closePath();
  shape.holes.push(hole);
  return extrudeShape(shape, depth, 0.009, 4);
}

export function createTurnedGeometry(knots: Array<[number, number]>, radialSegments = 80) {
  const curve = new THREE.CatmullRomCurve3(
    knots.map(([radius, y]) => new THREE.Vector3(radius, y, 0)),
    false,
    "centripetal",
    0.35,
  );
  const points = curve.getPoints(Math.max(28, knots.length * 4)).map((point) => (
    new THREE.Vector2(Math.max(0.0015, point.x), point.y)
  ));
  const geometry = new THREE.LatheGeometry(points, radialSegments);
  geometry.computeVertexNormals();
  return geometry;
}

export function createRuyiScrollCurve(side: -1 | 1) {
  const points: THREE.Vector3[] = [
    new THREE.Vector3(side * 0.285, 0.575, 0),
    new THREE.Vector3(side * 0.27, 0.525, 0),
    new THREE.Vector3(side * 0.245, 0.475, 0),
  ];
  const centerX = 0.155;
  const centerY = 0.435;
  const turns = Math.PI * 2.25;
  for (let index = 0; index <= 36; index += 1) {
    const t = index / 36;
    const angle = t * turns;
    const radius = THREE.MathUtils.lerp(0.095, 0.012, t);
    points.push(new THREE.Vector3(
      side * (centerX + Math.cos(angle) * radius),
      centerY + Math.sin(angle) * radius,
      0,
    ));
  }
  return new THREE.CatmullRomCurve3(points, false, "centripetal", 0.32);
}

export function createRuyiScrollGeometry(side: -1 | 1, radius = 0.024, radialSegments = 12) {
  return new THREE.TubeGeometry(createRuyiScrollCurve(side), 76, radius, radialSegments, false);
}

export function createMeanderBitGeometry(depth = 0.058) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.02, 0.125);
  shape.lineTo(0.245, 0.125);
  shape.lineTo(0.245, -0.03);
  shape.lineTo(0.105, -0.03);
  shape.lineTo(0.105, 0.045);
  shape.lineTo(0.045, 0.045);
  shape.lineTo(0.045, -0.09);
  shape.lineTo(0.17, -0.09);
  shape.lineTo(0.17, -0.155);
  shape.lineTo(-0.02, -0.155);
  shape.closePath();
  return extrudeShape(shape, depth, 0.006, 4);
}

export function createRoundedRectPlateGeometry(options: RoundedRectOptions & { depth: number; bevelSize: number }) {
  const { width, height, radius } = options;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const r = Math.min(radius, halfWidth, halfHeight);
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + r, -halfHeight);
  shape.lineTo(halfWidth - r, -halfHeight);
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + r);
  shape.lineTo(halfWidth, halfHeight - r);
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - r, halfHeight);
  shape.lineTo(-halfWidth + r, halfHeight);
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - r);
  shape.lineTo(-halfWidth, -halfHeight + r);
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + r, -halfHeight);
  shape.closePath();
  return extrudeShape(shape, options.depth, options.bevelSize, 4);
}
