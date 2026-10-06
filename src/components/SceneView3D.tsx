import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { useMissionStore } from "../store/useMissionStore";
import { heightAt, type TerrainData } from "../sim/terrain";
import { gridToScene, sceneToGrid, SPAN_METRES, gridDistanceM } from "../utils/coords";
import { MapView2D } from "./MapView2D";

/** Height of the same 512-segment triangles used by the visible terrain. */
export function surfaceHeight(t: TerrainData, col: number, row: number) {
  const c = Math.max(0, Math.min(1024, col)),
    r = Math.max(0, Math.min(1024, row));
  const c0 = Math.min(1022, Math.floor(c / 2) * 2),
    r0 = Math.min(1022, Math.floor(r / 2) * 2);
  const u = (c - c0) / 2,
    v = (r - r0) / 2;
  const a = heightAt(t, c0, r0),
    b = heightAt(t, c0, r0 + 2);
  const d = heightAt(t, c0 + 2, r0),
    e = heightAt(t, c0 + 2, r0 + 2);
  return u + v <= 1 ? a + (d - a) * u + (b - a) * v : e + (b - e) * (1 - u) + (d - e) * (1 - v);
}

function Terrain({ data }: { data: TerrainData }) {
  const source = useTexture("/texture.jpg");
  const texture = useMemo(() => {
    const map = source.clone();
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    map.needsUpdate = true;
    return map;
  }, [source]);
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(SPAN_METRES, SPAN_METRES, 512, 512);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes["position"]!;
    for (let i = 0; i < p.count; i++) {
      const { col, row } = sceneToGrid(p.getX(i), p.getZ(i));
      p.setY(i, heightAt(data, col, row));
    }
    p.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }, [data]);
  useEffect(
    () => () => {
      geometry.dispose();
      texture.dispose();
    },
    [geometry, texture],
  );
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial map={texture} roughness={0.95} />
    </mesh>
  );
}

function Rover({ data }: { data: TerrainData }) {
  const loaded = useGLTF("/models/rover.glb");
  const root = useRef<THREE.Group>(null);
  const cameraReady = useRef(false);
  const prev = useRef<{ col: number; row: number } | null>(null);
  const pose = useRef<{ col: number; row: number } | null>(null);
  const { camera } = useThree();
  const model = useMemo(() => {
    const m = loaded.scene.clone(true);
    m.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry = obj.geometry.clone();
        obj.material = Array.isArray(obj.material)
          ? obj.material.map((v) => v.clone())
          : obj.material.clone();
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    // Supplied GLB has metre-sized wheel/axle positions. 0.015 would hide it.
    const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
    const scale = size.z > 100 ? 0.015 : 1;
    m.scale.setScalar(scale);
    return m;
  }, [loaded.scene]);
  const wheels = useMemo(
    () => ["FL", "FR", "ML", "MR", "RL", "RR"].map((n) => model.getObjectByName(`Wheel_${n}`)),
    [model],
  );
  const drill = useMemo(() => model.getObjectByName("DrillArm"), [model]);
  const math = useMemo(
    () => ({
      right: new THREE.Vector3(),
      back: new THREE.Vector3(),
      up: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      basis: new THREE.Matrix4(),
      q: new THREE.Quaternion(),
      cam: new THREE.Vector3(),
      look: new THREE.Vector3(),
    }),
    [],
  );
  useEffect(
    () => () =>
      model.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) m.dispose();
        }
      }),
    [model],
  );
  useFrame((_, dt) => {
    if (!root.current) return;
    const s = useMissionStore.getState(),
      delta = Math.min(dt, 0.1),
      k = 1 - Math.exp(-12 * delta);
    pose.current ??= { col: s.col, row: s.row };
    const p = pose.current;
    // Freeze immediately on a hold; otherwise smooth the 4 Hz simulation updates.
    const moving = s.status === "DRIVING" || s.status === "RETURNING";
    p.col += (s.col - p.col) * (moving ? k : 1);
    p.row += (s.row - p.row) * (moving ? k : 1);
    const { x, z } = gridToScene(p.col, p.row),
      b = (s.heading * Math.PI) / 180;
    const sample = (side: number, axle: number) => {
      const g = sceneToGrid(
        x + side * Math.cos(b) + axle * Math.sin(b),
        z + side * Math.sin(b) - axle * Math.cos(b),
      );
      return surfaceHeight(data, g.col, g.row);
    };
    const fl = sample(-1.98, 2.89),
      fr = sample(1.98, 2.89),
      rl = sample(-1.98, -2.89),
      rr = sample(1.98, -2.89);
    math.right.set(Math.cos(b), (fr + rr - (fl + rl)) / 7.92, Math.sin(b)).normalize();
    math.forward.set(Math.sin(b), (fl + fr - (rl + rr)) / 11.56, -Math.cos(b)).normalize();
    math.up.crossVectors(math.right, math.forward).normalize();
    math.back.crossVectors(math.right, math.up).normalize();
    // GLB local +Z is front, so negate both horizontal axes for its orientation.
    math.basis.makeBasis(math.right.negate(), math.up, math.back.negate());
    math.q.setFromRotationMatrix(math.basis);
    const y = (fl + fr + rl + rr) / 4 - 0.02;
    root.current.position.set(x, y, z);
    root.current.quaternion.slerp(math.q, k);
    const speed =
      prev.current && delta > 0 && moving
        ? gridDistanceM(prev.current.col, prev.current.row, p.col, p.row) / delta
        : 0;
    for (const wheel of wheels) if (wheel) wheel.rotation.x += (speed * delta) / 0.5;
    if (drill) drill.rotation.x += ((s.status === "DRILLING" ? 0.65 : 0) - drill.rotation.x) * k;
    prev.current = { ...p };
    const cx = x - Math.sin(b) * 35 + Math.cos(b) * 12,
      cz = z + Math.cos(b) * 35 + Math.sin(b) * 12;
    const cg = sceneToGrid(cx, cz);
    math.cam.set(cx, Math.max(y + 16, surfaceHeight(data, cg.col, cg.row) + 8), cz);
    if (!cameraReady.current) {
      camera.position.copy(math.cam);
      cameraReady.current = true;
    } else camera.position.lerp(math.cam, 1 - Math.exp(-4 * delta));
    math.look.set(x, y + 1.8, z);
    camera.lookAt(math.look);
  });
  return (
    <group ref={root}>
      <primitive object={model} dispose={null} />
    </group>
  );
}

function Sun({ data }: { data: TerrainData }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  useFrame(() => {
    if (!light.current) return;
    const s = useMissionStore.getState(),
      p = gridToScene(s.col, s.row);
    const y = surfaceHeight(data, s.col, s.row);
    target.position.set(p.x, y, p.z);
    target.updateMatrixWorld();
    light.current.position.set(p.x + 1960, y + 350, p.z + 170);
  });
  return (
    <>
      <primitive object={target} />
      <directionalLight
        ref={light}
        target={target}
        intensity={4.5}
        castShadow
        shadow-bias={-0.0005}
        shadow-normalBias={0.05}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
        shadow-camera-near={1}
        shadow-camera-far={3000}
      />
    </>
  );
}

class SceneBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export function SceneView3D() {
  const data = useMissionStore((s) => s.terrain);
  const [ready, setReady] = useState(false);
  const [mapOnly, setMapOnly] = useState(false);
  useEffect(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    setMapOnly(!gl);
    setReady(true);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }, []);
  const fallback = (
    <div className="relative h-full">
      <MapView2D />
      <div className="absolute bottom-3 left-3 bg-card px-2 py-1 font-mono text-[10px] text-hazard">
        3D LINK UNAVAILABLE · SURFACE MAP ACTIVE
      </div>
    </div>
  );
  if (!ready || !data) return <div className="h-full bg-canvas" />;
  return (
    <div className="relative h-full overflow-hidden rounded-md border border-white/15 bg-canvas">
      {mapOnly ? (
        <MapView2D />
      ) : (
        <SceneBoundary fallback={fallback}>
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center font-mono text-xs text-telemetry">
                ACQUIRING SURFACE VIEW…
              </div>
            }
          >
            <Canvas
              shadows
              dpr={[1, 1.5]}
              camera={{ fov: 45, near: 0.1, far: 40000 }}
              onCreated={({ gl }) => {
                gl.setClearColor("#08090c");
                gl.domElement.addEventListener("webglcontextlost", () => setMapOnly(true), {
                  once: true,
                });
              }}
            >
              <ambientLight intensity={0.1} />
              <Sun data={data} />
              <Terrain data={data} />
              <Rover data={data} />
            </Canvas>
          </Suspense>
        </SceneBoundary>
      )}
      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-[0.2em] text-label">
        ROVER 1 · {mapOnly ? "SURFACE SURVEY" : "SURFACE CAMERA · CHASE 35 M"}
      </div>
      <button
        onClick={() => setMapOnly((v) => !v)}
        className="absolute bottom-3 right-3 rounded border border-white/20 bg-card/95 px-3 py-2 font-mono text-[10px] text-telemetry"
      >
        {mapOnly ? "3D CAMERA" : "2D SURVEY"}
      </button>
    </div>
  );
}
