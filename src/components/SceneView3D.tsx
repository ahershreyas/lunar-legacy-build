import {
  Component,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ElementRef,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Line, Html, useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { useMissionStore } from "../store/useMissionStore";
import { heightAt, slopeAt, illuminationAt, type TerrainData } from "../sim/terrain";
import { gridToScene, sceneToGrid, SPAN_METRES, gridDistanceM } from "../utils/coords";
import { pivotSteeringAngle, wheelRollRadians } from "../utils/roverMotion";
import { MapView2D } from "./MapView2D";

/** Height of the same 1024-segment triangles used by the visible terrain. */
export function surfaceHeight(t: TerrainData, col: number, row: number) {
  const c = Math.max(0, Math.min(1024, col)),
    r = Math.max(0, Math.min(1024, row));
  const c0 = Math.min(1023, Math.floor(c)),
    r0 = Math.min(1023, Math.floor(r));
  const u = c - c0,
    v = r - r0;
  const a = heightAt(t, c0, r0),
    b = heightAt(t, c0, r0 + 1);
  const d = heightAt(t, c0 + 1, r0),
    e = heightAt(t, c0 + 1, r0 + 1);
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
  // Cosmetic centimetre-scale regolith. Does not displace geometry or feed sensors.
  const regolith = useMemo(() => {
    const size = 128,
      pixels = new Uint8Array(size * size * 4);
    let seed = 731;
    for (let i = 0; i < size * size; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const v = 70 + Math.floor((seed / 4294967296) * 170);
      pixels.set([v, v, v, 255], i * 4);
    }
    const map = new THREE.DataTexture(pixels, size, size);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(SPAN_METRES / 16, SPAN_METRES / 16);
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true;
    map.anisotropy = 8;
    map.needsUpdate = true;
    return map;
  }, []);
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(SPAN_METRES, SPAN_METRES, 1024, 1024);
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
      regolith.dispose();
    },
    [geometry, texture, regolith],
  );
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        map={texture}
        roughness={0.98}
        bumpMap={regolith}
        bumpScale={0.24}
        onBeforeCompile={(shader) => {
          shader.fragmentShader = shader.fragmentShader.replace(
            "#include <map_fragment>",
            `#include <map_fragment>
             #ifdef USE_BUMPMAP
               float grain = texture2D(bumpMap, vBumpMapUv).r;
               diffuseColor.rgb *= mix(0.48, 1.04, grain);
             #endif`,
          );
        }}
      />
    </mesh>
  );
}

function Rover({ data }: { data: TerrainData }) {
  const loaded = useGLTF("/models/rover.glb");
  const root = useRef<THREE.Group>(null);
  const prev = useRef<{ col: number; row: number } | null>(null);
  const previousHeading = useRef<number | null>(null);
  const pose = useRef<{ col: number; row: number } | null>(null);
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
    // Twelve tread ribs make rolling visible even on a symmetric wheel texture.
    for (const name of ["FL", "FR", "ML", "MR", "RL", "RR"]) {
      const wheel = m.getObjectByName(`Wheel_${name}`);
      if (!wheel) continue;
      const pivot = new THREE.Group();
      pivot.name = `Steering_${name}`;
      pivot.position.copy(wheel.position);
      wheel.parent!.add(pivot);
      pivot.add(wheel);
      wheel.position.set(0, 0, 0);
      for (let i = 0; i < 12; i++) {
        const angle = (i * Math.PI) / 6;
        const rib = new THREE.Mesh(
          new THREE.BoxGeometry(0.62, 0.055, 0.09),
          new THREE.MeshStandardMaterial({
            color: i === 0 ? "#d0d5dc" : "#727981",
            roughness: 0.9,
          }),
        );
        rib.position.set(0, Math.cos(angle) * 0.53, Math.sin(angle) * 0.53);
        rib.rotation.x = angle;
        wheel.add(rib);
      }
    }
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
    const turnDelta =
      previousHeading.current === null
        ? 0
        : ((s.heading - previousHeading.current + 540) % 360) - 180;
    for (const wheel of wheels)
      if (wheel) {
        const pivot = wheel.parent!;
        const angle = pivotSteeringAngle(pivot.position.x, pivot.position.z) * s.steeringAmount;
        pivot.rotation.y = angle;
        wheel.rotation.x += wheelRollRadians(
          speed * delta,
          s.status === "TURNING" ? turnDelta : 0,
          pivot.position.x,
          0.53,
          pivot.position.z,
          angle,
        );
      }
    previousHeading.current = s.heading;
    if (drill) drill.rotation.x += ((s.status === "DRILLING" ? 0.65 : 0) - drill.rotation.x) * k;
    prev.current = { ...p };
  });
  return (
    <group ref={root}>
      <primitive object={model} dispose={null} />
      <RoverTelemetry data={data} />
    </group>
  );
}

function RoverTelemetry({ data }: { data: TerrainData }) {
  const s = useMissionStore();
  const slope = slopeAt(data, s.col, s.row);
  const moving = s.status === "DRIVING" || s.status === "RETURNING";
  return (
    <Html position={[0, 9, 0]} center zIndexRange={[5, 0]} style={{ pointerEvents: "auto" }}>
      <details
        open
        className="w-56 rounded border border-sky-400/40 bg-black/65 px-3 py-2 font-mono text-[10px] text-sky-200 shadow-lg"
      >
        <summary className="flex cursor-pointer justify-between">
          <strong>ROVER 1 · {s.battery.toFixed(1)}%</strong>
          <span>{s.status}</span>
        </summary>
        <div className={s.battery < 20 ? "text-red-300" : "text-emerald-300"}>
          BATTERY {s.battery.toFixed(1)}% · HEADING {s.heading.toFixed(0)}°
        </div>
        <div>
          SLOPE {slope.toFixed(1)}° · LIGHT {(illuminationAt(data, s.col, s.row) * 100).toFixed(0)}%
        </div>
        <div>
          {s.status === "STEERING" || s.status === "STRAIGHTENING"
            ? `${s.status} · CORNER WHEELS`
            : s.status === "TURNING"
              ? "TURNING · WHEELS PIVOTING"
              : moving
                ? `TRAVERSING · TIME ×${s.timeCompression}`
                : "STATIONARY"}{" "}
          · CORES {s.samples.length}
        </div>
      </details>
      <div
        className="mx-auto mt-1 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-cyan-500/80 shadow-lg"
        aria-label="Rover position locator"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="black" strokeWidth="2">
          <path d="M8 4h8v16H8zM4 5v3m0 3v3m0 3v3m16-15v3m0 3v3m0 3v3M12 1v3" />
        </svg>
      </div>
    </Html>
  );
}

function TraverseOverlay({ data }: { data: TerrainData }) {
  const trail = useMissionStore((s) => s.trail);
  const plan = useMissionStore((s) => s.plannedPath);
  const samples = useMissionStore((s) => s.samples);
  const points = (a: { col: number; row: number }[]) =>
    a.map((p) => {
      const g = gridToScene(p.col, p.row);
      return [g.x, surfaceHeight(data, p.col, p.row) + 0.5, g.z] as [number, number, number];
    });
  return (
    <>
      {trail.length > 1 && <Line points={points(trail)} color="#00e7b4" lineWidth={3} />}
      {plan.length > 1 && (
        <Line
          points={points(plan)}
          color="#27b9ff"
          lineWidth={1.5}
          dashed
          dashSize={5}
          gapSize={3}
        />
      )}
      {samples.map((p, i) => {
        const g = gridToScene(p.col, p.row);
        return (
          <group key={i} position={[g.x, surfaceHeight(data, p.col, p.row) + 0.12, g.z]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.8, 1.3, 32]} />
              <meshBasicMaterial color="#ffd06a" side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, 1, 0]}>
              <cylinderGeometry args={[0.06, 0.06, 2, 8]} />
              <meshBasicMaterial color="#ffd06a" />
            </mesh>
            <Html position={[0, 2.5, 0]} center distanceFactor={40}>
              <span className="whitespace-nowrap rounded bg-black/80 px-2 py-1 text-[10px] text-amber-300">
                CORE {i + 1} · H₂O {p.reading.waterIce.toFixed(1)}%
              </span>
            </Html>
          </group>
        );
      })}
    </>
  );
}
function DrillEffects({ data }: { data: TerrainData }) {
  const root = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!root.current) return;
    const s = useMissionStore.getState();
    root.current.visible = s.status === "DRILLING";
    const p = gridToScene(s.col, s.row);
    const b = (s.heading * Math.PI) / 180;
    root.current.position.set(
      p.x + Math.sin(b) * 2,
      surfaceHeight(data, s.col, s.row) + 0.15,
      p.z - Math.cos(b) * 2,
    );
    root.current.children.forEach((m, i) => {
      const t = clock.elapsedTime * 2 + i;
      m.position.set(Math.sin(t * 3 + i) * 1.5, (t % 1) * 1.3, Math.cos(t * 2 + i) * 1.5);
      m.scale.setScalar(0.1 + (1 - (t % 1)) * 0.15);
    });
  });
  return (
    <group ref={root} visible={false}>
      {Array.from({ length: 16 }, (_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[1, 6, 4]} />
          <meshBasicMaterial color="#b8b2a4" transparent opacity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

type CameraMode = "CHASE" | "ORBIT" | "SURVEY" | "RELIEF";
function CameraRig({
  data,
  mode,
  onInteract,
}: {
  data: TerrainData;
  mode: CameraMode;
  onInteract: () => void;
}) {
  const { camera } = useThree();
  const controls = useRef<ElementRef<typeof OrbitControls>>(null);
  const initialized = useRef(false);
  const previousRover = useRef<{ x: number; z: number; y: number } | null>(null);
  const vectors = useMemo(() => ({ eye: new THREE.Vector3(), target: new THREE.Vector3() }), []);
  useEffect(() => {
    const s = useMissionStore.getState(),
      p = gridToScene(s.col, s.row),
      y = surfaceHeight(data, s.col, s.row);
    if (mode === "RELIEF") {
      const centre = gridToScene(s.col, s.row + 10);
      const floor = surfaceHeight(data, s.col, s.row + 10);
      vectors.target.set(centre.x, floor, centre.z);
      camera.position.set(centre.x + 180, floor + 260, centre.z + 440);
      controls.current?.target.copy(vectors.target);
      controls.current?.update();
    } else if (mode === "SURVEY") {
      vectors.target.set(0, (data.minElev + data.maxElev) / 2, 0);
      vectors.eye.set(11000, data.maxElev + 16000, 12000);
      camera.position.copy(vectors.eye);
      controls.current?.target.copy(vectors.target);
      controls.current?.update();
    } else if (!initialized.current || mode === "CHASE") {
      vectors.target.set(p.x, y + 1.8, p.z);
      camera.position.set(p.x + 12, y + 16, p.z + 35);
      controls.current?.target.copy(vectors.target);
      controls.current?.update();
    }
    initialized.current = true;
  }, [mode, data, camera, vectors]);
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const current = useMissionStore.getState();
    const roverPosition = gridToScene(current.col, current.row);
    const roverHeight = surfaceHeight(data, current.col, current.row);
    if ((mode === "ORBIT" || mode === "RELIEF") && previousRover.current) {
      // Follow translation while retaining the viewing angle selected by dragging.
      const previous = previousRover.current;
      const dx = roverPosition.x - previous.x,
        dz = roverPosition.z - previous.z,
        dy = roverHeight - previous.y;
      camera.position.x += dx;
      camera.position.z += dz;
      camera.position.y += dy;
      c.target.x += dx;
      c.target.z += dz;
      c.target.y += dy;
      c.update();
    }
    previousRover.current = { ...roverPosition, y: roverHeight };
    if (mode === "CHASE") {
      const s = useMissionStore.getState(),
        p = gridToScene(s.col, s.row),
        b = (s.heading * Math.PI) / 180;
      const y = surfaceHeight(data, s.col, s.row);
      const x = p.x - Math.sin(b) * 35 + Math.cos(b) * 12,
        z = p.z + Math.cos(b) * 35 + Math.sin(b) * 12;
      const g = sceneToGrid(x, z);
      vectors.eye.set(x, Math.max(y + 16, surfaceHeight(data, g.col, g.row) + 8), z);
      vectors.target.set(p.x, y + 1.8, p.z);
      const k = 1 - Math.exp(-4 * Math.min(dt, 0.1));
      camera.position.lerp(vectors.eye, k);
      c.target.lerp(vectors.target, k);
      c.update();
    } else {
      const g = sceneToGrid(camera.position.x, camera.position.z);
      if (g.col >= 0 && g.col <= 1023 && g.row >= 0 && g.row <= 1023)
        camera.position.y = Math.max(camera.position.y, surfaceHeight(data, g.col, g.row) + 4);
    }
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={30}
      enablePan={false}
      maxDistance={34000}
      maxPolarAngle={Math.PI * 0.49}
      onStart={onInteract}
    />
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
        intensity={2.6}
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
  const running = useMissionStore((s) => s.running);
  const [ready, setReady] = useState(false);
  const [mapOnly, setMapOnly] = useState(false);
  const [canRender, setCanRender] = useState(true);
  const [cameraMode, setCameraMode] = useState<CameraMode>("RELIEF");
  useEffect(() => {
    if (running) setCameraMode((mode) => (mode === "SURVEY" ? "RELIEF" : mode));
  }, [running]);
  useEffect(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    setMapOnly(!gl);
    setCanRender(Boolean(gl));
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
      {mapOnly && (
        <div className="absolute inset-0">
          <MapView2D />
        </div>
      )}
      {canRender && (
        <div
          className="absolute inset-0"
          style={{
            visibility: mapOnly ? "hidden" : "visible",
            pointerEvents: mapOnly ? "none" : "auto",
          }}
        >
          <SceneBoundary fallback={fallback}>
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center font-mono text-xs text-telemetry">
                  ACQUIRING SURFACE VIEW…
                </div>
              }
            >
              <Canvas
                frameloop={mapOnly ? "never" : "always"}
                shadows
                dpr={[1, 1.5]}
                camera={{ fov: 45, near: 0.1, far: 40000 }}
                onCreated={({ gl }) => {
                  gl.setClearColor("#08090c");
                  gl.toneMappingExposure = 1.05;
                  gl.domElement.addEventListener(
                    "webglcontextlost",
                    () => {
                      setMapOnly(true);
                      setCanRender(false);
                    },
                    {
                      once: true,
                    },
                  );
                }}
              >
                {/* Presentation fill reveals the supplied lunar texture; sensor illumination remains unchanged. */}
                <ambientLight intensity={0.7} />
                <hemisphereLight args={["#e8edf4", "#5b5960", 0.8]} />
                <Sun data={data} />
                <Terrain data={data} />
                <Rover data={data} />
                <TraverseOverlay data={data} />
                <DrillEffects data={data} />
                <CameraRig
                  data={data}
                  mode={cameraMode}
                  onInteract={() => setCameraMode("ORBIT")}
                />
              </Canvas>
            </Suspense>
          </SceneBoundary>
        </div>
      )}
      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-[0.2em] text-label">
        ROVER 1 ·{" "}
        {mapOnly
          ? "SURFACE SURVEY"
          : `${cameraMode === "RELIEF" ? "CRATER RELIEF" : cameraMode === "SURVEY" ? "TERRAIN OVERVIEW" : cameraMode === "ORBIT" ? "ORBIT FOLLOW" : "CHASE 35 M"} · DEM 20 M · VISUAL REGOLITH`}
      </div>
      {!mapOnly && (
        <div className="absolute bottom-14 right-3 flex max-w-[calc(100%-1.5rem)] flex-wrap justify-end gap-2">
          <button
            onClick={() => setCameraMode("RELIEF")}
            className="rounded border border-white/20 bg-card/95 px-3 py-2 font-mono text-[10px] text-telemetry"
          >
            CRATER RELIEF
          </button>
          <button
            onClick={() => setCameraMode("SURVEY")}
            className="rounded border border-white/20 bg-card/95 px-3 py-2 font-mono text-[10px] text-telemetry"
          >
            TERRAIN OVERVIEW
          </button>
          <button
            onClick={() => setCameraMode("CHASE")}
            className="rounded border border-white/20 bg-card/95 px-3 py-2 font-mono text-[10px] text-telemetry"
          >
            FOLLOW ROVER
          </button>
        </div>
      )}
      {!mapOnly && (
        <div className="pointer-events-none absolute right-3 top-8 font-mono text-[10px] text-label">
          DRAG TO ROTATE · SCROLL TO ZOOM · GREEN: TRAVELLED · GOLD: CORE
        </div>
      )}
      <button
        onClick={() => setMapOnly((v) => !v)}
        className="absolute bottom-3 right-3 rounded border border-white/20 bg-card/95 px-3 py-2 font-mono text-[10px] text-telemetry"
      >
        {mapOnly ? "3D CAMERA" : "2D SURVEY"}
      </button>
    </div>
  );
}
