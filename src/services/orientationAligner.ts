/**
 * 3D Gravity Orientation Aligner Service
 * Rotates raw phone IMU signals into the canonical SCREEN-FACING-UP Reference Frame:
 * - Gravity is strictly aligned along +Z (+9.81 m/s²)
 * - Longitudinal acceleration is along +Y
 * - Lateral cornering acceleration is along +X
 * - Turning yaw rate is along Gz
 * Uses Rodrigues rotation formula to dynamically project 3D gravity vector.
 */

export class OrientationAligner {
  public enabled: boolean = true;
  private gravityEstimate: [number, number, number] = [0.0, 0.0, 9.81];
  private readonly alpha: number = 0.05; // Low-pass filter smoothing factor (~0.5Hz cut-off)

  public reset() {
    this.gravityEstimate = [0.0, 0.0, 9.81];
  }

  /**
   * Estimates 3D Gravity Vector using a low-pass filter
   */
  public updateGravity(rawAcc: [number, number, number]) {
    const [ax, ay, az] = rawAcc;
    this.gravityEstimate[0] = this.alpha * ax + (1.0 - this.alpha) * this.gravityEstimate[0];
    this.gravityEstimate[1] = this.alpha * ay + (1.0 - this.alpha) * this.gravityEstimate[1];
    this.gravityEstimate[2] = this.alpha * az + (1.0 - this.alpha) * this.gravityEstimate[2];
  }

  /**
   * Computes 3D Rodrigues rotation matrix R_up that aligns measured gravity with [0, 0, 1]^T
   */
  public computeAlignmentMatrix(): number[][] {
    const gx = this.gravityEstimate[0];
    const gy = this.gravityEstimate[1];
    const gz = this.gravityEstimate[2];
    const norm = Math.hypot(gx, gy, gz);

    if (norm < 1e-4) {
      return [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
    }

    const v_src = [gx / norm, gy / norm, gz / norm];
    const v_dst = [0.0, 0.0, 1.0]; // Canonical Screen-Facing-Up Z-axis

    // Cross product: v = v_src x v_dst
    const v = [
      v_src[1] * v_dst[2] - v_src[2] * v_dst[1],
      v_src[2] * v_dst[0] - v_src[0] * v_dst[2],
      v_src[0] * v_dst[1] - v_src[1] * v_dst[0],
    ];

    const s = Math.hypot(v[0], v[1], v[2]);
    const c = v_src[0] * v_dst[0] + v_src[1] * v_dst[1] + v_src[2] * v_dst[2];

    if (s < 1e-6) {
      if (c > 0) {
        return [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ];
      } else {
        return [
          [1, 0, 0],
          [0, -1, 0],
          [0, 0, -1],
        ];
      }
    }

    const vx = [
      [0, -v[2], v[1]],
      [v[2], 0, -v[0]],
      [-v[1], v[0], 0],
    ];

    const factor = (1.0 - c) / (s * s);

    // R = I + vx + vx^2 * factor
    const R = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];

    for (let r = 0; r < 3; r++) {
      for (let col = 0; col < 3; col++) {
        let vx2_rc = 0.0;
        for (let k = 0; k < 3; k++) {
          vx2_rc += vx[r][k] * vx[k][col];
        }
        R[r][col] += vx[r][col] + vx2_rc * factor;
      }
    }

    return R;
  }

  /**
   * Aligns 6-axis IMU readings [ax, ay, az, gx, gy, gz] into the Screen-Facing-Up canonical frame
   */
  public alignIMU(
    ax: number,
    ay: number,
    az: number,
    gx: number,
    gy: number,
    gz: number
  ): {
    ax: number;
    ay: number;
    az: number;
    gx: number;
    gy: number;
    gz: number;
    pitchDeg: number;
    rollDeg: number;
  } {
    const rawAcc: [number, number, number] = [ax, ay, az];
    this.updateGravity(rawAcc);

    const gx_g = this.gravityEstimate[0];
    const gy_g = this.gravityEstimate[1];
    const gz_g = this.gravityEstimate[2];
    const pitchDeg = (Math.atan2(-gy_g, Math.hypot(gx_g, gz_g)) * 180.0) / Math.PI;
    const rollDeg = (Math.atan2(gx_g, gz_g) * 180.0) / Math.PI;

    if (!this.enabled) {
      return { ax, ay, az, gx, gy, gz, pitchDeg, rollDeg };
    }

    const R = this.computeAlignmentMatrix();

    // Rotate Accel Vector
    const alignedAx = R[0][0] * ax + R[0][1] * ay + R[0][2] * az;
    const alignedAy = R[1][0] * ax + R[1][1] * ay + R[1][2] * az;
    const alignedAz = R[2][0] * ax + R[2][1] * ay + R[2][2] * az;

    // Rotate Gyro Vector
    const alignedGx = R[0][0] * gx + R[0][1] * gy + R[0][2] * gz;
    const alignedGy = R[1][0] * gx + R[1][1] * gy + R[1][2] * gz;
    const alignedGz = R[2][0] * gx + R[2][1] * gy + R[2][2] * gz;

    return {
      ax: alignedAx,
      ay: alignedAy,
      az: alignedAz,
      gx: alignedGx,
      gy: alignedGy,
      gz: alignedGz,
      pitchDeg,
      rollDeg,
    };
  }
}

export const orientationAligner = new OrientationAligner();
