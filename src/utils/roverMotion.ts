/** GLB forward is local +Z and axle is local X: positive X roll cancels
 * forward translation at the bottom contact point (no-slip rolling). */
export function wheelRollRadians(
  distanceM: number,
  headingDeltaDeg = 0,
  axleX = 0,
  radiusM = 0.53,
): number {
  return (distanceM + ((headingDeltaDeg * Math.PI) / 180) * axleX) / radiusM;
}
