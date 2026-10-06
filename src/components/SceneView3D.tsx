import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF, useTexture } from "@react-three/drei";
import * as THREE from "three";
import { heightAt, type TerrainData } from "../sim/terrain";
import { useMissionStore } from "../store/useMissionStore";
import { GRID_SIZE, METRES_PER_SAMPLE, SPAN_METRES, gridToLocalWorld } from "../utils/coords";

const TERRAIN_SEGMENTS = 512;
const WHEEL_NAMES = ["Wheel_FL", "Wheel_FR", "Wheel_ML", "Wheel_MR", "Wheel_RL", "Wheel_RR"] as const;
const AXLE_HALF_WIDTH = 1.98;
const AXLE_HALF_LENGTH = 2.89;
const MODEL_SCALE = 0.015;
const WHEEL_RADIUS = 0.5;
const CHASE_DISTANCE = 30;
const CHASE_HEIGHT = 5;
const MODEL_PATH = "/models/rover.glb";

type RoverRefs = {
  wheels: THREE.Object3D[];
  chassis: THREE.Object3D | null;
  drill: THREE.Object3D | null;
};

const targetPosition = new THREE.Vector3();
const desiredCamera = new THREE.Vector3();
const desiredLook = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const targetQuaternion = new THREE.Quaternion();
const forwardVector = new THREE.Vector3();
const cameraForward = new THREE.Vector3();
const targetEuler = new THREE.Euler(0, 0, 0, "YXZ");

function terrainHeight(terrain: TerrainData, col: number, row: number, originHeight: number) {
  return heightAt(terrain, col, row) - originHeight;
}

function TerrainMesh({ terrain, originHeight }: { terrain: TerrainData; originHeight: number }) {
  const texture = useTexture("/texture.jpg");
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(SPAN_METRES, SPAN_METRES, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    const positions = geo.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const col = ((positions.getX(i) + SPAN_METRES / 2) / SPAN_METRES) * (GRID_SIZE - 1);
      const row = ((SPAN_METRES / 2 - positions.getY(i)) / SPAN_METRES) * (GRID_SIZE - 1);
      positions.setZ(i, terrainHeight(terrain, col, row, originHeight));
    }
    positions.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }, [terrain, originHeight]);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0 }),
    [texture],
  );

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return () => {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    };
  }, [geometry, material, texture]);

  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow geometry={geometry} material={material} />
  );
}

function Rover({ terrain, originCol, originRow, originHeight }: {
  terrain: TerrainData;
  originCol: number;
  originRow: number;
  originHeight: number;
}) {
  const root = useRef<THREE.Group>(null);
  const refs = useRef<RoverRefs>({ wheels: [], chassis: null, drill: null });
  const previous = useRef({ col: originCol, row: originRow, time: 0, speed: 0 });
  const lastStoreSync = useRef(0);
  const { scene } = useGLTF(MODEL_PATH);
  const clone = useMemo(() => {
    const object = scene.clone(true);
    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry = child.geometry.clone();
      child.material = Array.isArray(child.material)
        ? child.material.map((material) => material.clone())
        : child.material.clone();
    });
    return object;
  }, [scene]);

  useLayoutEffect(() => {
    const wheels: THREE.Object3D[] = [];
    for (const name of WHEEL_NAMES) {
      const wheel = clone.getObjectByName(name);
      if (wheel) wheels.push(wheel);
    }
    refs.current = {
      wheels,
      chassis: clone.getObjectByName("Chassis") ?? null,
      drill: clone.getObjectByName("DrillArm") ?? null,
    };
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return () => {
      refs.current = { wheels: [], chassis: null, drill: null };
    };
  }, [clone]);

  useEffect(() => () => {
    clone.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
  }, [clone]);

  useFrame(({ camera, clock }, rawDelta) => {
    const rover = root.current;
    if (!rover) return;
    const delta = Math.min(rawDelta, 0.05);
    const now = clock.elapsedTime;
    const state = useMissionStore.getState();
    const local = gridToLocalWorld(state.col, state.row, originCol, originRow);
    const elapsed = Math.max(0.001, now - previous.current.time);
    const distance = Math.hypot(state.col - previous.current.col, state.row - previous.current.row) * METRES_PER_SAMPLE;
    if (distance > 0.001) {
      previous.current.speed = distance / elapsed;
      previous.current.col = state.col;
      previous.current.row = state.row;
      previous.current.time = now;
      lastStoreSync.current = now;
    } else if (now - lastStoreSync.current > 0.25) {
      previous.current.speed *= Math.exp(-8 * delta);
    }

    const yaw = THREE.MathUtils.degToRad(state.heading);
    forwardVector.set(Math.sin(yaw), 0, -Math.cos(yaw));
    const rightX = Math.cos(yaw);
    const rightZ = Math.sin(yaw);
    const sampleAxle = (forwardOffset: number, rightOffset: number) => heightAt(
      terrain,
      state.col + (forwardVector.x * forwardOffset + rightX * rightOffset) / METRES_PER_SAMPLE,
      state.row + (forwardVector.z * forwardOffset + rightZ * rightOffset) / METRES_PER_SAMPLE,
    );
    const frontLeft = sampleAxle(AXLE_HALF_LENGTH, -AXLE_HALF_WIDTH);
    const frontRight = sampleAxle(AXLE_HALF_LENGTH, AXLE_HALF_WIDTH);
    const rearLeft = sampleAxle(-AXLE_HALF_LENGTH, -AXLE_HALF_WIDTH);
    const rearRight = sampleAxle(-AXLE_HALF_LENGTH, AXLE_HALF_WIDTH);
    const frontHeight = (frontLeft + frontRight) * 0.5;
    const rearHeight = (rearLeft + rearRight) * 0.5;
    const leftHeight = (frontLeft + rearLeft) * 0.5;
    const rightHeight = (frontRight + rearRight) * 0.5;
    const averageHeight = (frontLeft + frontRight + rearLeft + rearRight) * 0.25 - originHeight - 0.02;
    const rise = frontHeight - rearHeight;
    const pitch = -Math.atan2(rise, AXLE_HALF_LENGTH * 2);
    const roll = Math.atan2(rightHeight - leftHeight, AXLE_HALF_WIDTH * 2);
    targetEuler.set(pitch, yaw + Math.PI, roll);
    targetQuaternion.setFromEuler(targetEuler);

    targetPosition.set(local.x, averageHeight, local.z);
    rover.position.lerp(targetPosition, 1 - Math.exp(-18 * delta));
    rover.quaternion.slerp(targetQuaternion, 1 - Math.exp(-12 * delta));

    for (const wheel of refs.current.wheels) {
      wheel.rotation.x += (previous.current.speed * delta) / WHEEL_RADIUS;
    }
    const drill = refs.current.drill;
    if (drill) {
      const drillTarget = state.status === "DRILLING" ? 0.65 : 0;
      drill.rotation.x += (drillTarget - drill.rotation.x) * (1 - Math.exp(-8 * delta));
    }

    cameraForward.set(0, 0, 1).applyQuaternion(rover.quaternion);
    desiredCamera.copy(rover.position).addScaledVector(cameraForward, -CHASE_DISTANCE);
    desiredCamera.y += CHASE_HEIGHT;
    desiredLook.copy(rover.position).addScaledVector(cameraForward, 8);
    desiredLook.y += 0.15;
    camera.position.lerp(desiredCamera, 1 - Math.exp(-4 * delta));
    lookTarget.lerp(desiredLook, 1 - Math.exp(-6 * delta));
    camera.lookAt(lookTarget);
  });

  return (
    <group ref={root} scale={MODEL_SCALE}>
      <primitive object={clone} />
    </group>
  );
}

function Scene({ terrain }: { terrain: TerrainData }) {
  const originCol = useMissionStore.getState().col;
  const originRow = useMissionStore.getState().row;
  const originHeight = heightAt(terrain, originCol, originRow);

  return (
    <>
      <ambientLight intensity={0.04} />
      <directionalLight
        position={[196, 35, 17]}
        intensity={4.5}
        castShadow
        shadow-bias={-0.0005}
        shadow-normalBias={0.05}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
        shadow-camera-near={0.1}
        shadow-camera-far={400}
      />
      <Suspense fallback={null}>
        <TerrainMesh terrain={terrain} originHeight={originHeight} />
      </Suspense>
      <Suspense fallback={null}>
        <Rover terrain={terrain} originCol={originCol} originRow={originRow} originHeight={originHeight} />
      </Suspense>
    </>
  );
}

export function SceneView3D() {
  const terrain = useMissionStore((state) => state.terrain);
  if (!terrain) return null;
  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded-md border border-border bg-canvas">
      <Canvas
        shadows
        dpr={[1, 1.5]}
        camera={{ position: [0, 5, 30], fov: 24, near: 0.05, far: 5000 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        <Scene terrain={terrain} />
      </Canvas>
      <div className="pointer-events-none absolute left-3 top-3 font-mono text-[10px] uppercase tracking-[0.2em] text-label">
        Surface Camera — Chase 30 m
      </div>
    </div>
  );
}

useGLTF.preload(MODEL_PATH);