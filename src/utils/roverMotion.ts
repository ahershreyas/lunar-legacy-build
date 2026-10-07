/** Four corner wheels steer tangent to their turning circles; middle wheels stay straight. */
export function pivotSteeringAngle(x: number, z: number): number {
  let angle = Math.atan2(-z, x);
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle < -Math.PI / 2) angle += Math.PI;
  return angle;
}
/** Local +Z is forward. Project each contact velocity onto its steered rolling direction. */
export function wheelRollRadians(
  distanceM: number,
  headingDeltaDeg = 0,
  axleX = 0,
  radiusM = 0.53,
  axleZ = 0,
  steeringAngle = 0,
): number {
  const turn = (headingDeltaDeg * Math.PI) / 180;
  return (
    (distanceM * Math.cos(steeringAngle) +
      turn * (-axleZ * Math.sin(steeringAngle) + axleX * Math.cos(steeringAngle))) /
    radiusM
  );
}
