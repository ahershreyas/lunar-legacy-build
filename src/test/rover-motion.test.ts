import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { wheelRollRadians } from "../utils/roverMotion";

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
