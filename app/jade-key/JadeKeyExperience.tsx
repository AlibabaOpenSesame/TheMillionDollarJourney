"use client";

import { Environment, Lightformer, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { createJadeKeyModel } from "./model/createJadeKeyModel";
import styles from "./jade-key.module.css";

type ReviewView = "hero" | "front" | "right" | "rear" | "left" | "grazing" | "bit";
type LightingMode = "reference" | "neutral" | "grazing";

const partNames: Record<string, string> = {
  "jade-cloud-core": "祥云玉芯",
  "gold-cloud-bezel": "祥云金边",
  "left-scroll": "左如意卷草",
  "right-scroll": "右如意卷草",
  "neck-assembly": "车削颈座",
  "neck-top-ring": "上颈环",
  "neck-lower-ring": "下颈环",
  "shaft-core": "长轴",
  "bit-bridge": "钥齿承接桥",
  "meander-bit": "回纹钥匙齿",
  "terminal-assembly": "尾部基座",
  "terminal-upper-ring": "尾部上环",
  "terminal-lower-ring": "尾部下环",
  "terminal-bead": "尾珠",
};

const cameraPositions: Record<ReviewView, [number, number, number]> = {
  hero: [0, 0, 4.8],
  front: [0, 0, 4.1],
  right: [4.1, 0, 0],
  rear: [0, 0, -4.1],
  left: [-4.1, 0, 0],
  grazing: [3.2, 1.1, 3.2],
  bit: [2.8, -0.7, 3.5],
};

function JadeKeyModel({
  view,
  mapStripped,
  selectedPart,
  exploded,
  onSelect,
  onReady,
}: {
  view: ReviewView;
  mapStripped: boolean;
  selectedPart: string | null;
  exploded: boolean;
  onSelect: (partId: string | null) => void;
  onReady: (model: THREE.Group) => void;
}) {
  const model = useMemo(() => {
    return createJadeKeyModel("optimization", mapStripped);
  }, [mapStripped]);

  useEffect(() => {
    onReady(model);
  }, [model, onReady]);

  useEffect(() => {
    if (view === "hero") {
      model.rotation.set(0.08, -0.13, Math.PI / 2);
    } else {
      model.rotation.set(0, 0, 0);
    }
  }, [model, view]);

  useEffect(() => {
    const runtime = model.userData.sculptRuntime as { nodes: Record<string, THREE.Object3D> };
    for (const node of Object.values(runtime.nodes)) {
      const home = node.userData.homePosition as number[];
      const vector = node.userData.explodeVector as number[];
      node.position.set(
        home[0] + (exploded ? vector[0] : 0),
        home[1] + (exploded ? vector[1] : 0),
        home[2] + (exploded ? vector[2] : 0),
      );
    }
  }, [exploded, model]);

  useEffect(() => {
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (!object.userData.baseMaterial) object.userData.baseMaterial = object.material;
      const base = object.userData.baseMaterial as THREE.Material;
      if (object.material !== base) object.material.dispose();
      object.material = base;
      if (selectedPart && object.userData.partId === selectedPart) {
        const highlight = base.clone();
        if ("emissive" in highlight) {
          const material = highlight as THREE.MeshStandardMaterial;
          material.emissive.set("#ffd878");
          material.emissiveIntensity = 0.7;
        }
        object.material = highlight;
      }
    });
  }, [model, selectedPart]);

  useEffect(() => () => {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const meshMaterials = Array.isArray(object.material) ? object.material : [object.material];
      meshMaterials.forEach((material) => materials.add(material));
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) textures.add(value);
      });
      material.dispose();
    });
    textures.forEach((texture) => texture.dispose());
  }, [model]);

  return (
    <primitive
      object={model}
      onPointerDown={(event: { stopPropagation: () => void; object: THREE.Object3D }) => {
        event.stopPropagation();
        onSelect((event.object.userData.partId as string | undefined) ?? null);
      }}
    />
  );
}

function Stage({
  view,
  tier1,
  materialEvidence,
  lighting,
  capture,
  selectedPart,
  exploded,
  compact,
  reducedMotion,
  onSelect,
  onModelReady,
}: {
  view: ReviewView;
  tier1: boolean;
  materialEvidence: boolean;
  lighting: LightingMode;
  capture: boolean;
  selectedPart: string | null;
  exploded: boolean;
  compact: boolean;
  reducedMotion: boolean;
  onSelect: (partId: string | null) => void;
  onModelReady: (model: THREE.Group) => void;
}) {
  const position = cameraPositions[view];
  const target: [number, number, number] = view === "grazing"
    ? [0, 0.76, 0]
    : view === "bit"
      ? [0.12, -0.84, 0]
      : [0, 0, 0];
  const zoom = view === "hero"
    ? (compact ? 126 : 390)
    : view === "grazing"
      ? 680
      : view === "bit"
        ? 820
        : capture
          ? 475
          : tier1
            ? 380
            : compact
              ? 210
              : 235;
  const neutral = lighting === "neutral";
  const grazingLight = lighting === "grazing";
  return (
    <Canvas
      key={`${view}-${capture ? "capture" : "review"}`}
      orthographic
      camera={{ position, zoom, near: 0.1, far: 100 }}
      dpr={[1, 1.5]}
      frameloop={reducedMotion ? "demand" : "always"}
      shadows
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      fallback={<div className={styles.webglFallback}>当前设备无法显示 3D 模型</div>}
      onCreated={({ camera, gl }) => {
        camera.lookAt(...target);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.12;
        gl.outputColorSpace = THREE.SRGBColorSpace;
      }}
    >
      <color attach="background" args={["#f0eadf"]} />
      <ambientLight intensity={neutral ? 0.56 : 0.32} color={neutral ? "#ffffff" : "#fff8e9"} />
      <directionalLight
        castShadow={!tier1}
        position={grazingLight ? [5, 0.5, 3] : [-3.5, 5.2, 4.8]}
        intensity={grazingLight ? 3.1 : neutral ? 1.35 : 1.85}
        color={neutral ? "#ffffff" : "#fff0d0"}
        shadow-mapSize={[1536, 1536]}
        shadow-radius={15}
        shadow-blurSamples={32}
      />
      <directionalLight position={[4, 1, 3]} intensity={neutral ? 0.9 : 0.5} color={neutral ? "#ffffff" : "#cbdcff"} />
      <directionalLight position={[0, 4, -5]} intensity={neutral ? 0.62 : 0.72} color={neutral ? "#ffffff" : "#ffe7b4"} />
      {(!tier1 || materialEvidence) && (
        <Environment resolution={192} frames={1}>
          <Lightformer form="rect" intensity={1.75} color="#ffd98e" position={[0, 0.8, 5.5]} scale={[3.2, 6.2, 1]} />
          <Lightformer form="rect" intensity={3.4} color="#fff7df" position={[-3, 4, 5]} rotation={[0.08, 0.45, 0]} scale={[5, 2.4, 1]} />
          <Lightformer form="rect" intensity={2.3} color="#efb957" position={[3.5, 0.2, 2.5]} rotation={[0, -0.9, 0]} scale={[1.4, 5.5, 1]} />
          <Lightformer form="rect" intensity={1.35} color="#d6e4f0" position={[-3, 0.5, -3]} rotation={[0, 0.8, 0]} scale={[2, 4, 1]} />
          <Lightformer form="ring" intensity={1.5} color="#fff2c8" position={[0, 4, -4]} scale={3.6} />
          <Lightformer form="rect" intensity={1.2} color="#fff8e8" position={[0, -4, 1]} rotation={[Math.PI / 2, 0, 0]} scale={[5, 5, 1]} />
        </Environment>
      )}
      <Suspense fallback={null}>
        <JadeKeyModel
          view={view}
          mapStripped={tier1 && !materialEvidence}
          selectedPart={selectedPart}
          exploded={exploded}
          onSelect={onSelect}
          onReady={onModelReady}
        />
      </Suspense>
      {!tier1 && (
        <mesh position={[0, 0, -0.2]} receiveShadow>
          <planeGeometry args={[8, 8]} />
          <shadowMaterial transparent opacity={0.12} />
        </mesh>
      )}
      {!capture && (
        <OrbitControls
          makeDefault
          enableDamping={!reducedMotion}
          dampingFactor={0.08}
          enablePan={false}
          minZoom={compact ? 95 : 180}
          maxZoom={760}
          minPolarAngle={view === "hero" ? Math.PI / 2 - 0.34 : 0.01}
          maxPolarAngle={view === "hero" ? Math.PI / 2 + 0.34 : Math.PI - 0.01}
          minAzimuthAngle={view === "hero" ? -0.48 : -Infinity}
          maxAzimuthAngle={view === "hero" ? 0.48 : Infinity}
          target={target}
        />
      )}
    </Canvas>
  );
}

export default function JadeKeyExperience() {
  const [view, setView] = useState<ReviewView>("hero");
  const [capture, setCapture] = useState(false);
  const [tier1, setTier1] = useState(false);
  const [materialEvidence, setMaterialEvidence] = useState(false);
  const [lighting, setLighting] = useState<LightingMode>("reference");
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [exploded, setExploded] = useState(false);
  const [model, setModel] = useState<THREE.Group | null>(null);
  const [compact, setCompact] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const performance = model?.userData.sculptRuntime?.performance as {
    triangles: number;
    drawCalls: number;
    uniqueGeometries: number;
    uniqueMaterials: number;
    parts: Array<{ name: string; kind: string; module: string; triangles: number }>;
  } | undefined;

  useEffect(() => {
    const compactQuery = window.matchMedia("(max-width: 720px)");
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMedia = () => {
      setCompact(compactQuery.matches);
      setReducedMotion(motionQuery.matches);
    };
    syncMedia();
    compactQuery.addEventListener("change", syncMedia);
    motionQuery.addEventListener("change", syncMedia);
    return () => {
      compactQuery.removeEventListener("change", syncMedia);
      motionQuery.removeEventListener("change", syncMedia);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get("view");
    const nextView = requestedView === "hero" || requestedView === "front" || requestedView === "right" || requestedView === "rear" || requestedView === "left" || requestedView === "grazing" || requestedView === "bit"
      ? requestedView
      : "hero";
    const frame = window.requestAnimationFrame(() => {
      setView(nextView);
      setCapture(params.get("capture") === "1");
      setTier1(params.get("tier1") === "1");
      setMaterialEvidence(params.get("materialEvidence") === "1");
      const requestedLighting = params.get("lighting");
      setLighting(requestedLighting === "neutral" || requestedLighting === "grazing" ? requestedLighting : "reference");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const exportGlb = async () => {
    if (!model) return;
    const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
    const exporter = new GLTFExporter();
    const baseMaterials = new Map<string, THREE.Material>();
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const partId = object.userData.partId as string | undefined;
      const base = object.userData.baseMaterial;
      if (partId && base instanceof THREE.Material) baseMaterials.set(partId, base);
    });
    const exportRoot = model.clone(true);
    exportRoot.rotation.set(0, 0, 0);
    exportRoot.userData = { partId: "root", source: "img2threejs" };
    exportRoot.traverse((object) => {
      const home = object.userData.homePosition as number[] | undefined;
      if (home) object.position.fromArray(home);
      const partId = object.userData.partId as string | undefined;
      if (object instanceof THREE.Mesh && partId && baseMaterials.has(partId)) {
        object.material = baseMaterials.get(partId) as THREE.Material;
      }
      object.userData = object.userData.partId ? { partId: object.userData.partId } : {};
    });
    exporter.parse(
      exportRoot,
      (result) => {
        if (!(result instanceof ArrayBuffer)) return;
        const url = URL.createObjectURL(new Blob([result], { type: "model/gltf-binary" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = "cloud-jade-gold-key.glb";
        link.click();
        URL.revokeObjectURL(url);
      },
      (error) => console.error("GLB export failed", error),
      { binary: true, onlyVisible: true },
    );
  };

  return (
    <section className={`${styles.experience} ${capture ? styles.capture : ""}`}>
      <div className={styles.atmosphere} aria-hidden="true" />
      <div
        className={styles.stage}
        data-testid="jade-key-stage"
        data-triangles={performance?.triangles}
        data-draw-calls={performance?.drawCalls}
        data-unique-geometries={performance?.uniqueGeometries}
        data-unique-materials={performance?.uniqueMaterials}
        data-part-manifest={performance ? JSON.stringify({
          model: "cloud-jade-gold-key",
          parts: performance.parts,
          unnamedMeshes: 0,
          integralMeshes: performance.drawCalls,
        }) : undefined}
      >
        <Stage
          view={view}
          tier1={tier1}
          materialEvidence={materialEvidence}
          lighting={lighting}
          capture={capture}
          selectedPart={selectedPart}
          exploded={exploded}
          compact={compact}
          reducedMotion={reducedMotion}
          onSelect={setSelectedPart}
          onModelReady={setModel}
        />
        <div className={styles.axisLabel}>{view === "hero" ? "X" : "Y"} / 240 mm nominal</div>
        <div className={styles.actionPanel}>
          <span>{selectedPart ? partNames[selectedPart] ?? selectedPart : "点击模型选择部件"}</span>
          <button onClick={() => setExploded((value) => !value)}>{exploded ? "合拢" : "拆解"}</button>
          <button onClick={() => { setSelectedPart(null); setExploded(false); setView("hero"); }}>复位</button>
          <button onClick={exportGlb}>导出 GLB</button>
        </div>
        <div className={styles.viewControls} aria-label="审查视角">
          {(["hero", "front", "right", "rear", "left", "grazing", "bit"] as ReviewView[]).map((item) => (
            <button key={item} className={view === item ? styles.active : ""} onClick={() => setView(item)}>
              {item === "hero" ? "横置" : item === "front" ? "正视" : item === "right" ? "右视" : item === "rear" ? "背视" : item === "left" ? "左视" : item === "grazing" ? "材质" : "齿部"}
            </button>
          ))}
        </div>
      </div>

      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>PROCEDURAL STUDY · REVISION 03</p>
          <h1>祥云玉钥</h1>
          <p>三瓣祥云 · 玉芯金边 · 如意思成</p>
        </div>
        <div className={styles.status}>
          <span>IMG2THREEJS</span>
          <strong>高拟真程序化重建</strong>
        </div>
      </header>

      <footer className={styles.footer}>
        <span>{performance ? `${performance.triangles.toLocaleString()} TRI` : "CLOUD JADE"}</span>
        <i />
        <span>{performance ? `${performance.drawCalls} DRAWS` : "TURNED NECK"}</span>
        <i />
        <span>{performance ? `${performance.uniqueMaterials} MATERIALS` : "SINGLE MEANDER"}</span>
      </footer>
    </section>
  );
}
