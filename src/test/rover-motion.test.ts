import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { pivotSteeringAngle, wheelRollRadians } from "../utils/roverMotion";

describe("GLB wheel kinematics", () => {
  it("cancels forward displacement at the bottom contact rather than spinning backward", () => {
    const travel = 1.06,
      radius = 0.53;
    const rotation = wheelRollRadians(travel);
    const contactMotion = new Vector3(rotation, 0, 0).cross(new Vector3(0, -radius, 0));
    contactMotion.add(new Vector3(0, 0, travel));
    expect(contactMotion.length()).toBeCloseTo(0);
    expect(rotation).toBeGreaterThan(0);
  });
  it("counter-rolls opposite axles for a clockwise pivot and stops with zero motion", () => {
    expect(wheelRollRadians(0, 10, -1.98)).toBeLessThan(0);
    expect(wheelRollRadians(0, 10, 1.98)).toBeGreaterThan(0);
    expect(wheelRollRadians(0)).toBe(0);
  });
});

describe("steered pivot contact kinematics", () => {
  it("aligns corner wheels and rolls tangent to the chassis turning circle", () => {
    for (const x of [-1.98, 1.98])
      for (const z of [-2.89, 0, 2.89]) {
        const angle = pivotSteeringAngle(x, z);
        expect(Math.abs(angle)).toBeLessThan(Math.PI / 2);
        const delta = 0.1;
        const roll = wheelRollRadians(0, (delta * 180) / Math.PI, x, 0.53, z, angle);
        const rolling = new Vector3(Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(
          roll * 0.53,
        );
        const body = new Vector3(-delta * z, 0, delta * x);
        expect(rolling.distanceTo(body)).toBeLessThan(1e-12);
      }
  });
});
