/**
 * 15-State Error-State Kalman Filter (ES-EKF) for Neuro-Kinematic Dead Reckoning.
 * Tracks:
 *   - Position (3): [px, py, pz] in meters
 *   - Velocity (3): [vx, vy, vz] in m/s
 *   - Attitude (3/4): Quaternion [qw, qx, qy, qz]
 *   - Accel Bias (3): [bax, bay, baz] in m/s²
 *   - Gyro Bias (3):  [bgx, bgy, bgz] in rad/s
 * Updates via:
 *   - High-rate IMU Newtonian integration (Predict Step)
 *   - TCN Virtual Sensor Speed + Non-Holonomic Constraints (NHC: vy=v_fwd, vx=0, vz=0)
 *   - ZUPT Zero-Velocity Update (when stationary)
 */

export interface ESEKFState {
  position: [number, number, number];
  velocity: [number, number, number];
  quaternion: [number, number, number, number]; // [qw, qx, qy, qz]
  accelBias: [number, number, number];
  gyroBias: [number, number, number];
  speedKmh: number;
  headingDeg: number;
}

// 3x3 Matrix Inversion (Analytic Cramer's Rule for speed and zero heap allocations)
function invert3x3(A: number[][]): number[][] {
  const a00 = A[0][0], a01 = A[0][1], a02 = A[0][2];
  const a10 = A[1][0], a11 = A[1][1], a12 = A[1][2];
  const a20 = A[2][0], a21 = A[2][1], a22 = A[2][2];

  const c00 = a11 * a22 - a12 * a21;
  const c01 = -(a10 * a22 - a12 * a20);
  const c02 = a10 * a21 - a11 * a20;

  const det = a00 * c00 + a01 * c01 + a02 * c02;
  if (Math.abs(det) < 1e-9) {
    // Fallback pseudo-inverse diagonal
    return [
      [1 / (A[0][0] || 1), 0, 0],
      [0, 1 / (A[1][1] || 1), 0],
      [0, 0, 1 / (A[2][2] || 1)],
    ];
  }

  const invDet = 1.0 / det;
  const c10 = -(a01 * a22 - a02 * a21);
  const c11 = a00 * a22 - a02 * a20;
  const c12 = -(a00 * a21 - a01 * a20);

  const c20 = a01 * a12 - a02 * a11;
  const c21 = -(a00 * a12 - a02 * a10);
  const c22 = a00 * a11 - a01 * a10;

  return [
    [c00 * invDet, c10 * invDet, c20 * invDet],
    [c01 * invDet, c11 * invDet, c21 * invDet],
    [c02 * invDet, c12 * invDet, c22 * invDet],
  ];
}

export class ESEKFEngine {
  // Nominal states
  private p: [number, number, number] = [0, 0, 0];
  private v: [number, number, number] = [0, 0, 0];
  private q: [number, number, number, number] = [1, 0, 0, 0]; // [qw, qx, qy, qz]
  private ba: [number, number, number] = [0, 0, 0];
  private bg: [number, number, number] = [0, 0, 0];

  // 15x15 Covariance matrix P
  private P: number[][];

  // Process Noise Parameters
  private readonly qAcc = 0.08;      // Continuous accel noise (m/s²/sqrt(s))
  private readonly qGyr = 0.005;     // Continuous gyro noise (rad/s/sqrt(s))
  private readonly qAccBias = 0.0001; // Accel bias random walk
  private readonly qGyrBias = 0.00001;// Gyro bias random walk

  // Gravity in navigation frame (pointing downward along -Z)
  private readonly gNav: [number, number, number] = [0, 0, -9.81];

  constructor() {
    this.P = this.initCovariance();
  }

  private initCovariance(): number[][] {
    const P = Array.from({ length: 15 }, () => new Array(15).fill(0));
    // Pos uncertainty
    P[0][0] = P[1][1] = P[2][2] = 1e-3;
    // Vel uncertainty
    P[3][3] = P[4][4] = P[5][5] = 1e-2;
    // Attitude uncertainty
    P[6][6] = P[7][7] = P[8][8] = 1e-3;
    // Accel bias uncertainty
    P[9][9] = P[10][10] = P[11][11] = 1e-4;
    // Gyro bias uncertainty
    P[12][12] = P[13][13] = P[14][14] = 1e-5;
    return P;
  }

  public reset() {
    this.p = [0, 0, 0];
    this.v = [0, 0, 0];
    this.q = [1, 0, 0, 0];
    this.ba = [0, 0, 0];
    this.bg = [0, 0, 0];
    this.P = this.initCovariance();
  }

  public setHeading(headingDeg: number) {
    const rad = (headingDeg * Math.PI) / 180;
    const half = rad * 0.5;
    this.q = [Math.cos(half), 0, 0, Math.sin(half)];
  }

  /**
   * Rotation matrix R(q) from Body frame to Navigation frame
   */
  public getRotationMatrix(): number[][] {
    const [w, x, y, z] = this.q;
    return [
      [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ];
  }

  /**
   * High-frequency IMU Newtonian Predict Step.
   * Integrates acceleration and angular rates, propagates error covariance.
   */
  public predict(
    ax: number,
    ay: number,
    az: number,
    gx: number,
    gy: number,
    gz: number,
    dt: number
  ) {
    if (dt <= 0 || dt > 0.5) dt = 0.0166;

    // 1. Bias compensation
    const ax_c = ax - this.ba[0];
    const ay_c = ay - this.ba[1];
    const az_c = az - this.ba[2];

    const gx_c = gx - this.bg[0];
    const gy_c = gy - this.bg[1];
    const gz_c = gz - this.bg[2];

    // 2. Rotate acceleration into Navigation Frame
    const R = this.getRotationMatrix();
    const f_nav_x = R[0][0] * ax_c + R[0][1] * ay_c + R[0][2] * az_c;
    const f_nav_y = R[1][0] * ax_c + R[1][1] * ay_c + R[1][2] * az_c;
    const f_nav_z = R[2][0] * ax_c + R[2][1] * ay_c + R[2][2] * az_c;

    // Net acceleration including gravity (gravity compensation)
    const acc_net_x = f_nav_x + this.gNav[0];
    const acc_net_y = f_nav_y + this.gNav[1];
    const acc_net_z = f_nav_z + this.gNav[2];

    // 3. Integrate Position and Velocity
    this.p[0] += this.v[0] * dt + 0.5 * acc_net_x * dt * dt;
    this.p[1] += this.v[1] * dt + 0.5 * acc_net_y * dt * dt;
    this.p[2] += this.v[2] * dt + 0.5 * acc_net_z * dt * dt;

    this.v[0] += acc_net_x * dt;
    this.v[1] += acc_net_y * dt;
    this.v[2] += acc_net_z * dt;

    // 4. Integrate Attitude Quaternion
    const normOmega = Math.hypot(gx_c, gy_c, gz_c);
    const halfAngle = 0.5 * normOmega * dt;
    let dq: [number, number, number, number];

    if (normOmega > 1e-6) {
      const s = Math.sin(halfAngle) / normOmega;
      dq = [Math.cos(halfAngle), s * gx_c, s * gy_c, s * gz_c];
    } else {
      dq = [1.0, 0.5 * gx_c * dt, 0.5 * gy_c * dt, 0.5 * gz_c * dt];
    }

    // Quaternion multiplication: q_new = q * dq
    const [qw, qx, qy, qz] = this.q;
    const [rw, rx, ry, rz] = dq;
    this.q[0] = qw * rw - qx * rx - qy * ry - qz * rz;
    this.q[1] = qw * rx + qx * rw + qy * rz - qz * ry;
    this.q[2] = qw * ry - qx * rz + qy * rw + qz * rx;
    this.q[3] = qw * rz + qx * ry - qy * rx + qz * rw;

    // Normalize quaternion
    const qNorm = Math.hypot(...this.q);
    this.q[0] /= qNorm;
    this.q[1] /= qNorm;
    this.q[2] /= qNorm;
    this.q[3] /= qNorm;

    // 5. Error Covariance Propagation P = F * P * F^T + Q
    // Simplified continuous-time error propagation for efficiency:
    const dt2 = dt * dt;
    for (let i = 0; i < 3; i++) {
      this.P[i][i] += (this.P[i + 3][i + 3] * dt2) + 0.25 * this.qAcc * dt2 * dt;
      this.P[i + 3][i + 3] += this.qAcc * dt;
      this.P[i + 6][i + 6] += this.qGyr * dt;
      this.P[i + 9][i + 9] += this.qAccBias * dt;
      this.P[i + 12][i + 12] += this.qGyrBias * dt;
    }
  }

  /**
   * Measurement Update with TCN Forward Speed + Non-Holonomic Constraints (NHC).
   * In vehicle body frame:
   *   vy = vForward (forward longitudinal speed along +Y)
   *   vx = 0.0 (no lateral skid along +X)
   *   vz = 0.0 (no vertical flight along +Z)
   */
  public updateNHC(vForwardMps: number, rNoise: number = 0.15) {
    const R = this.getRotationMatrix();
    // Transpose of R transforms Navigation velocity to Body velocity: v_body = R^T * v_nav
    const v_body_x = R[0][0] * this.v[0] + R[1][0] * this.v[1] + R[2][0] * this.v[2];
    const v_body_y = R[0][1] * this.v[0] + R[1][1] * this.v[1] + R[2][1] * this.v[2];
    const v_body_z = R[0][2] * this.v[0] + R[1][2] * this.v[1] + R[2][2] * this.v[2];

    // Virtual measurement target: [0, vForward, 0]
    const res_x = 0.0 - v_body_x;
    const res_y = Math.max(0.0, vForwardMps) - v_body_y;
    const res_z = 0.0 - v_body_z;

    // Measurement Jacobian H_vel = R^T (3x3 on velocity indices 3, 4, 5)
    // Innovation S = H * P_vel * H^T + R_meas
    // Compute P_vel (3x3)
    const P_vel: number[][] = [
      [this.P[3][3], this.P[3][4], this.P[3][5]],
      [this.P[4][3], this.P[4][4], this.P[4][5]],
      [this.P[5][3], this.P[5][4], this.P[5][5]],
    ];

    // S = R^T * P_vel * R + diag(R_noise)
    const Rt_P = [
      [
        R[0][0] * P_vel[0][0] + R[1][0] * P_vel[1][0] + R[2][0] * P_vel[2][0],
        R[0][0] * P_vel[0][1] + R[1][0] * P_vel[1][1] + R[2][0] * P_vel[2][1],
        R[0][0] * P_vel[0][2] + R[1][0] * P_vel[1][2] + R[2][0] * P_vel[2][2],
      ],
      [
        R[0][1] * P_vel[0][0] + R[1][1] * P_vel[1][0] + R[2][1] * P_vel[2][0],
        R[0][1] * P_vel[0][1] + R[1][1] * P_vel[1][1] + R[2][1] * P_vel[2][1],
        R[0][1] * P_vel[0][2] + R[1][1] * P_vel[1][2] + R[2][1] * P_vel[2][2],
      ],
      [
        R[0][2] * P_vel[0][0] + R[1][2] * P_vel[1][0] + R[2][2] * P_vel[2][0],
        R[0][2] * P_vel[0][1] + R[1][2] * P_vel[1][1] + R[2][2] * P_vel[2][1],
        R[0][2] * P_vel[0][2] + R[1][2] * P_vel[1][2] + R[2][2] * P_vel[2][2],
      ],
    ];

    const S = [
      [
        Rt_P[0][0] * R[0][0] + Rt_P[0][1] * R[1][0] + Rt_P[0][2] * R[2][0] + rNoise,
        Rt_P[0][0] * R[0][1] + Rt_P[0][1] * R[1][1] + Rt_P[0][2] * R[2][1],
        Rt_P[0][0] * R[0][2] + Rt_P[0][1] * R[1][2] + Rt_P[0][2] * R[2][2],
      ],
      [
        Rt_P[1][0] * R[0][0] + Rt_P[1][1] * R[1][0] + Rt_P[1][2] * R[2][0],
        Rt_P[1][0] * R[0][1] + Rt_P[1][1] * R[1][1] + Rt_P[1][2] * R[2][1] + rNoise,
        Rt_P[1][0] * R[0][2] + Rt_P[1][1] * R[1][2] + Rt_P[1][2] * R[2][2],
      ],
      [
        Rt_P[2][0] * R[0][0] + Rt_P[2][1] * R[1][0] + Rt_P[2][2] * R[2][0],
        Rt_P[2][0] * R[0][1] + Rt_P[2][1] * R[1][1] + Rt_P[2][2] * R[2][1],
        Rt_P[2][0] * R[0][2] + Rt_P[2][1] * R[1][2] + Rt_P[2][2] * R[2][2] + rNoise,
      ],
    ];

    const invS = invert3x3(S);

    // Kalman Gain K_vel = P_vel * R * invS (3x3)
    const P_R = [
      [
        P_vel[0][0] * R[0][0] + P_vel[0][1] * R[0][1] + P_vel[0][2] * R[0][2],
        P_vel[0][0] * R[1][0] + P_vel[0][1] * R[1][1] + P_vel[0][2] * R[1][2],
        P_vel[0][0] * R[2][0] + P_vel[0][1] * R[2][1] + P_vel[0][2] * R[2][2],
      ],
      [
        P_vel[1][0] * R[0][0] + P_vel[1][1] * R[0][1] + P_vel[1][2] * R[0][2],
        P_vel[1][0] * R[1][0] + P_vel[1][1] * R[1][1] + P_vel[1][2] * R[1][2],
        P_vel[1][0] * R[2][0] + P_vel[1][1] * R[2][1] + P_vel[1][2] * R[2][2],
      ],
      [
        P_vel[2][0] * R[0][0] + P_vel[2][1] * R[0][1] + P_vel[2][2] * R[0][2],
        P_vel[2][0] * R[1][0] + P_vel[2][1] * R[1][1] + P_vel[2][2] * R[1][2],
        P_vel[2][0] * R[2][0] + P_vel[2][1] * R[2][1] + P_vel[2][2] * R[2][2],
      ],
    ];

    const K = [
      [
        P_R[0][0] * invS[0][0] + P_R[0][1] * invS[1][0] + P_R[0][2] * invS[2][0],
        P_R[0][0] * invS[0][1] + P_R[0][1] * invS[1][1] + P_R[0][2] * invS[2][1],
        P_R[0][0] * invS[0][2] + P_R[0][1] * invS[1][2] + P_R[0][2] * invS[2][2],
      ],
      [
        P_R[1][0] * invS[0][0] + P_R[1][1] * invS[1][0] + P_R[1][2] * invS[2][0],
        P_R[1][0] * invS[0][1] + P_R[1][1] * invS[1][1] + P_R[1][2] * invS[2][1],
        P_R[1][0] * invS[0][2] + P_R[1][1] * invS[1][2] + P_R[1][2] * invS[2][2],
      ],
      [
        P_R[2][0] * invS[0][0] + P_R[2][1] * invS[1][0] + P_R[2][2] * invS[2][0],
        P_R[2][0] * invS[0][1] + P_R[2][1] * invS[1][1] + P_R[2][2] * invS[2][1],
        P_R[2][0] * invS[0][2] + P_R[2][1] * invS[1][2] + P_R[2][2] * invS[2][2],
      ],
    ];

    // State correction for velocity
    const dv_x = K[0][0] * res_x + K[0][1] * res_y + K[0][2] * res_z;
    const dv_y = K[1][0] * res_x + K[1][1] * res_y + K[1][2] * res_z;
    const dv_z = K[2][0] * res_x + K[2][1] * res_y + K[2][2] * res_z;

    this.v[0] += dv_x;
    this.v[1] += dv_y;
    this.v[2] += dv_z;

    // Update covariance
    this.P[3][3] = Math.max(1e-5, this.P[3][3] * 0.9);
    this.P[4][4] = Math.max(1e-5, this.P[4][4] * 0.9);
    this.P[5][5] = Math.max(1e-5, this.P[5][5] * 0.9);
  }

  /**
   * ZUPT Direct Zero-Velocity Clamping & Online Bias Calibration
   */
  public updateZUPT(rNoise: number = 0.01) {
    // Residual = 0 - v
    const res_x = -this.v[0];
    const res_y = -this.v[1];
    const res_z = -this.v[2];

    const kGain = 0.85;
    this.v[0] += kGain * res_x;
    this.v[1] += kGain * res_y;
    this.v[2] += kGain * res_z;

    // Online Accel Bias correction
    this.ba[0] += 0.05 * res_x;
    this.ba[1] += 0.05 * res_y;
    this.ba[2] += 0.05 * res_z;

    // Suppress velocity uncertainty
    this.P[3][3] = Math.min(this.P[3][3], rNoise);
    this.P[4][4] = Math.min(this.P[4][4], rNoise);
    this.P[5][5] = Math.min(this.P[5][5], rNoise);
  }

  public getState(): ESEKFState {
    const speedMps = Math.hypot(this.v[0], this.v[1], this.v[2]);
    const speedKmh = speedMps * 3.6;

    // Yaw heading in degrees from quaternion
    const [w, x, y, z] = this.q;
    const siny_cosp = 2 * (w * z + x * y);
    const cosy_cosp = 1 - 2 * (y * y + z * z);
    const headingDeg = (Math.atan2(siny_cosp, cosy_cosp) * 180) / Math.PI;

    return {
      position: [...this.p],
      velocity: [...this.v],
      quaternion: [...this.q],
      accelBias: [...this.ba],
      gyroBias: [...this.bg],
      speedKmh: Number(speedKmh.toFixed(1)),
      headingDeg: (headingDeg + 360) % 360,
    };
  }
}

export const esEkfEngine = new ESEKFEngine();
