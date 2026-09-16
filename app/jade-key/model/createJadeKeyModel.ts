import * as THREE from "three";
import {
  createCloudBezelGeometry,
  createCloudJadeGeometry,
  createMeanderBitGeometry,
  createRoundedRectPlateGeometry,
  createRuyiScrollGeometry,
  createTurnedGeometry,
} from "./geometry";
import { createJadeKeyMaterials, type JadeKeyMaterialSet } from "./materials";

export type JadeKeyBuildStage =
  | "blockout"
  | "structural"
  | "form"
  | "material"
  | "surface"
  | "lighting"
  | "interaction"
  | "optimization";

type PartOptions = {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  explode?: [number, number, number];
  material?: THREE.Material;
};

type SculptRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Vector3>;
  colliders: Record<string, { type: "box-proxy"; partId: string }>;
  destructionGroups: Record<string, string[]>;
  performance: ReturnType<typeof measureRuntime>;
};

function createPartNode(root: THREE.Group, id: string, options: PartOptions = {}) {
  const node = new THREE.Group();
  node.name = `${id}-node`;
  node.position.set(...(options.position ?? [0, 0, 0]));
  node.rotation.set(...(options.rotation ?? [0, 0, 0]));
  node.scale.set(...(options.scale ?? [1, 1, 1]));
  node.userData.partId = id;
  node.userData.homePosition = node.position.toArray();
  node.userData.explodeVector = options.explode ?? [0, 0, 0.2];
  root.add(node);
  return node;
}

function addPartMesh(
  node: THREE.Group,
  id: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number] = [0, 0, 0],
  meshName = id,
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = meshName;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.partId = id;
  mesh.userData.baseMaterial = material;
  if (meshName !== id) mesh.userData.explodeWithParent = true;
  node.add(mesh);
  return mesh;
}

function createPart(
  root: THREE.Group,
  id: string,
  geometry: THREE.BufferGeometry,
  materials: JadeKeyMaterialSet,
  options: PartOptions = {},
) {
  const node = createPartNode(root, id, options);
  addPartMesh(node, id, geometry, options.material ?? materials.gold);
  return node;
}

function createScroll(root: THREE.Group, materials: JadeKeyMaterialSet, side: -1 | 1) {
  const id = side < 0 ? "left-scroll" : "right-scroll";
  const centerX = side * 0.145;
  const centerY = 0.49;
  const body = createRuyiScrollGeometry(side, 0.024, 12);
  const groove = createRuyiScrollGeometry(side, 0.0065, 8);
  body.translate(-centerX, -centerY, 0);
  groove.translate(-centerX, -centerY, 0.021);
  const node = createPartNode(root, id, {
    position: [centerX, centerY, 0],
    explode: [side * 0.22, -0.02, 0.18],
  });
  addPartMesh(node, id, body, materials.polishedGold);
  addPartMesh(node, id, groove, materials.recess, [0, 0, 0], `${id}-groove`);
  return node;
}

function createNeck(root: THREE.Group, materials: JadeKeyMaterialSet) {
  createPart(
    root,
    "neck-assembly",
    createTurnedGeometry([
      [0, -0.092], [0.042, -0.089], [0.05, -0.074], [0.047, -0.052],
      [0.04, -0.026], [0.045, 0.002], [0.063, 0.026], [0.07, 0.048],
      [0.063, 0.068], [0.048, 0.083], [0, 0.087],
    ], 56),
    materials,
    { position: [0, 0.34, 0], explode: [0, -0.08, 0.08], material: materials.gold },
  );
  createPart(
    root,
    "neck-top-ring",
    createTurnedGeometry([
      [0, -0.014], [0.05, -0.014], [0.066, -0.008], [0.071, 0],
      [0.066, 0.008], [0.05, 0.014], [0, 0.014],
    ], 56),
    materials,
    { position: [0, 0.415, 0], explode: [0, 0.12, 0.13], material: materials.polishedGold },
  );
  createPart(
    root,
    "neck-lower-ring",
    createTurnedGeometry([
      [0, -0.012], [0.044, -0.012], [0.057, -0.006], [0.061, 0],
      [0.057, 0.006], [0.044, 0.012], [0, 0.012],
    ], 52),
    materials,
    { position: [0, 0.272, 0], explode: [0, -0.12, 0.08], material: materials.polishedGold },
  );
}

function createTerminal(root: THREE.Group, materials: JadeKeyMaterialSet) {
  createPart(
    root,
    "terminal-assembly",
    createTurnedGeometry([
      [0, -0.04], [0.035, -0.04], [0.043, -0.027], [0.04, -0.01],
      [0.036, 0.01], [0.043, 0.028], [0.034, 0.04], [0, 0.042],
    ], 52),
    materials,
    { position: [0, -1.075, 0], explode: [0, -0.12, 0.05] },
  );
  createPart(
    root,
    "terminal-upper-ring",
    createTurnedGeometry([[0, -0.011], [0.05, -0.011], [0.061, 0], [0.05, 0.011], [0, 0.011]], 48),
    materials,
    { position: [0, -1.045, 0], explode: [0, 0.08, 0.12], material: materials.polishedGold },
  );
  createPart(
    root,
    "terminal-lower-ring",
    createTurnedGeometry([[0, -0.01], [0.044, -0.01], [0.054, 0], [0.044, 0.01], [0, 0.01]], 48),
    materials,
    { position: [0, -1.09, 0], explode: [0, -0.06, 0.1], material: materials.polishedGold },
  );
  createPart(
    root,
    "terminal-bead",
    new THREE.SphereGeometry(0.055, 40, 24),
    materials,
    { position: [0, -1.165, 0], scale: [1, 1.08, 1], explode: [0, -0.14, 0.18], material: materials.polishedGold },
  );
}

function collectRuntime(root: THREE.Group) {
  const nodes: Record<string, THREE.Object3D> = {};
  const meshes: Record<string, THREE.Mesh> = {};
  root.traverse((object) => {
    const partId = object.userData.partId as string | undefined;
    if (!partId) return;
    if (object.name.endsWith("-node")) nodes[partId] = object;
    if (object instanceof THREE.Mesh && !meshes[partId]) meshes[partId] = object;
  });
  return { nodes, meshes };
}

function measureRuntime(root: THREE.Group) {
  let triangles = 0;
  let drawCalls = 0;
  const geometries = new Set<string>();
  const materials = new Set<string>();
  const partTriangles = new Map<string, number>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    drawCalls += 1;
    geometries.add(object.geometry.uuid);
    const positionCount = object.geometry.getAttribute("position")?.count ?? 0;
    const meshTriangles = object.geometry.index ? object.geometry.index.count / 3 : positionCount / 3;
    triangles += meshTriangles;
    const id = (object.userData.partId as string | undefined) ?? "unnamed";
    partTriangles.set(id, (partTriangles.get(id) ?? 0) + meshTriangles);
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
    meshMaterials.forEach((material) => materials.add(material.uuid));
  });
  return {
    triangles: Math.round(triangles),
    drawCalls,
    uniqueGeometries: geometries.size,
    uniqueMaterials: materials.size,
    targetTriangles: 60000,
    maxDrawCalls: 30,
    fpsTarget: 60,
    parts: [
      { name: "root", kind: "group", module: "root", triangles: 0 },
      ...[...partTriangles].map(([name, count]) => ({ name, kind: "part", module: name, triangles: Math.round(count) })),
    ],
  };
}

export function createJadeKeyModel(
  stage: JadeKeyBuildStage = "optimization",
  mapStripped = false,
) {
  const root = new THREE.Group();
  root.name = "cloud-jade-gold-ornamental-key";
  root.userData.partId = "root";
  root.userData.buildStage = stage;
  root.userData.presentationRotation = [0.08, -0.13, Math.PI / 2];
  const materials = createJadeKeyMaterials(mapStripped);

  createPart(
    root,
    "jade-cloud-core",
    createCloudJadeGeometry(0.82, 0.62, 0.15),
    materials,
    { position: [0, 0.84, 0], explode: [0, 0.08, 0.2], material: materials.jade },
  );
  const bezelNode = createPartNode(root, "gold-cloud-bezel", {
    position: [0, 0.84, 0],
    explode: [0, 0.02, -0.25],
  });
  const bezelRail = createCloudBezelGeometry(0.88, 0.67, 0.815, 0.602, 0.022);
  addPartMesh(bezelNode, "gold-cloud-bezel", bezelRail, materials.polishedGold, [0, 0, 0.064], "gold-cloud-bezel-front");
  addPartMesh(bezelNode, "gold-cloud-bezel", bezelRail, materials.polishedGold, [0, 0, -0.064], "gold-cloud-bezel-back");
  const topBridge = addPartMesh(
    bezelNode,
    "gold-cloud-bezel",
    new THREE.CapsuleGeometry(0.011, 0.108, 8, 24),
    materials.polishedGold,
    [0, 0.336, 0],
    "gold-cloud-bezel-top-bridge",
  );
  topBridge.rotation.x = Math.PI / 2;
  const bottomBridge = addPartMesh(
    bezelNode,
    "gold-cloud-bezel",
    new THREE.CapsuleGeometry(0.011, 0.108, 8, 24),
    materials.polishedGold,
    [0, -0.326, 0],
    "gold-cloud-bezel-bottom-bridge",
  );
  bottomBridge.rotation.x = Math.PI / 2;

  createScroll(root, materials, -1);
  createScroll(root, materials, 1);
  createNeck(root, materials);

  createPart(
    root,
    "shaft-core",
    new THREE.CapsuleGeometry(0.04, 1.265, 10, 48),
    materials,
    { position: [0, -0.382, 0], explode: [0, -0.28, 0] },
  );
  createPart(
    root,
    "bit-bridge",
    createRoundedRectPlateGeometry({ width: 0.115, height: 0.055, radius: 0.009, depth: 0.06, bevelSize: 0.005 }),
    materials,
    { position: [0.055, -0.84, 0], explode: [0.12, 0, 0.04] },
  );
  createPart(
    root,
    "meander-bit",
    createMeanderBitGeometry(0.058),
    materials,
    { position: [0.06, -0.84, 0], explode: [0.3, 0, 0.13], material: materials.polishedGold },
  );
  createTerminal(root, materials);

  const runtime = collectRuntime(root);
  const sculptRuntime: SculptRuntime = {
    ...runtime,
    sockets: {
      "head-socket": new THREE.Vector3(0, 0.84, 0),
      "left-scroll-socket": new THREE.Vector3(-0.145, 0.49, 0),
      "right-scroll-socket": new THREE.Vector3(0.145, 0.49, 0),
      "neck-socket": new THREE.Vector3(0, 0.34, 0),
      "shaft-socket": new THREE.Vector3(0, 0.272, 0),
      "bit-socket": new THREE.Vector3(0.055, -0.84, 0),
      "terminal-socket": new THREE.Vector3(0, -1.075, 0),
    },
    colliders: Object.fromEntries(
      Object.keys(runtime.nodes).map((id) => [id, { type: "box-proxy" as const, partId: id }]),
    ),
    destructionGroups: {
      head: ["jade-cloud-core", "gold-cloud-bezel", "left-scroll", "right-scroll"],
      stem: ["neck-assembly", "neck-top-ring", "neck-lower-ring", "shaft-core"],
      bit: ["bit-bridge", "meander-bit"],
      terminal: ["terminal-assembly", "terminal-upper-ring", "terminal-lower-ring", "terminal-bead"],
    },
    performance: measureRuntime(root),
  };
  root.userData.sculptRuntime = sculptRuntime;
  return root;
}
