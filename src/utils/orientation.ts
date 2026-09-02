/**
 * Device orientation parsing and robust compass heading calculation.
 */

export function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function radiansToDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

export function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function angularDifference(targetDeg: number, sourceDeg: number): number {
  return ((targetDeg - sourceDeg + 540) % 360) - 180;
}

/**
 * Computes robust compass heading from W3C Euler angles (alpha, beta, gamma).
 */
export function computeRobustCompassHeading(
  alpha: number,
  beta: number,
  gamma: number
): number {
  const a = degreesToRadians(alpha);
  const b = degreesToRadians(beta);
  const g = degreesToRadians(gamma);

  const sA = Math.sin(a);
  const cA = Math.cos(a);
  const sB = Math.sin(b);
  const sG = Math.sin(g);
  const cG = Math.cos(g);

  // W3C Standard horizontal projection:
  const x = -sA * cG - cA * sB * sG;
  const y = cA * cG - sA * sB * sG;

  let heading = radiansToDegrees(Math.atan2(x, y));
  if (heading < 0) {
    heading += 360;
  }

  return normalizeDegrees(heading);
}
