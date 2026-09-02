/**
 * STEP Model: Pedestrian Dead Reckoning (PDR) Step Detector with Pocket ZUPT.
 * 
 * Rules:
 * 1. Step Detection:
 *    - Monitors Z-axis acceleration at ~60Hz.
 *    - Simple moving average (window size 5) to smooth out hand jitter.
 *    - Triggers a step when Z-axis crosses dynamic threshold (local max - local min > 1.5 m/s²).
 * 2. Discrete Updates:
 *    - Stops adding velocity every frame.
 *    - Only updates (X, Y) when a step is detected with fixed stride length of 0.65m:
 *        x_new = x_old + 0.65 * sin(current_heading)
 *        y_new = y_old + 0.65 * cos(current_heading)
 * 3. Pocket ZUPT:
 *    - If 3-axis accelerometer variance drops below 0.2 m/s² for > 0.5s:
 *      zeroes out velocity and freezes heading angle to stop the spiral effect.
 * 4. Normal gyro & magnetometer are used for heading.
 */

export interface StepEvent {
  stepCount: number;
  strideLength: number; // 0.65m
  instantaneousSpeedMps: number;
  timestamp: number;
}

export class StepDetector {
  private readonly strideLength: number = 0.65; // Fixed 0.65m per step
  private stepCount: number = 0;
  private lastStepTime: number = 0;
  private readonly minStepIntervalMs: number = 260; // Max ~3.8 steps/sec human limit
  private lastStepIntervalMs: number = 0;

  // 5-sample Moving Average Buffer for Z-axis acceleration
  private readonly maWindowSize: number = 5;
  private zBuffer: number[] = [];

  // Peak/Valley sliding window (approx 15 samples = 250ms at 60Hz)
  private readonly windowSize: number = 15;
  private smoothedZHistory: number[] = [];
  private readonly dynamicThreshold: number = 1.5; // (local max - local min) > 1.5 m/s²

  // Pocket ZUPT State
  // 3-axis accel variance over 0.5 seconds (30 samples @ 60Hz)
  private readonly pocketZuptWindowSize: number = 30;
  private accelNormHistory: number[] = [];
  private quietDurationMs: number = 0;
  private lastSampleTime: number = 0;
  private isPocketZupt: boolean = false;
  private frozenHeading: number | null = null;

  public reset() {
    this.stepCount = 0;
    this.lastStepTime = 0;
    this.lastStepIntervalMs = 0;
    this.zBuffer = [];
    this.smoothedZHistory = [];
    this.accelNormHistory = [];
    this.quietDurationMs = 0;
    this.lastSampleTime = 0;
    this.isPocketZupt = false;
    this.frozenHeading = null;
  }

  /**
   * Processes a 60Hz IMU sample.
   * Returns a StepEvent if a valid footstep occurred on this tick, otherwise null.
   */
  public processSample(
    ax: number,
    ay: number,
    az: number,
    currentHeadingDeg: number,
    timestamp: number = Date.now()
  ): { isStep: boolean; strideMeters: number; isPocketZupt: boolean; effectiveHeadingDeg: number; currentVariance: number } {
    const dt = this.lastSampleTime > 0 ? Math.min(100, timestamp - this.lastSampleTime) : 16.6;
    this.lastSampleTime = timestamp;

    // --- 1. Pocket ZUPT Check ---
    const accelNorm = Math.sqrt(ax * ax + ay * ay + az * az);
    this.accelNormHistory.push(accelNorm);
    if (this.accelNormHistory.length > this.pocketZuptWindowSize) {
      this.accelNormHistory.shift();
    }

    let variance = 0;
    if (this.accelNormHistory.length >= 10) {
      const n = this.accelNormHistory.length;
      let sum = 0;
      let sumSq = 0;
      for (let i = 0; i < n; i++) {
        const v = this.accelNormHistory[i];
        sum += v;
        sumSq += v * v;
      }
      const mean = sum / n;
      variance = Math.max(0, sumSq / n - mean * mean);
    }

    // If 3-axis accelerometer variance drops below 0.2 m/s² for > 0.5s (500ms)
    if (variance < 0.20 && this.accelNormHistory.length >= 15) {
      this.quietDurationMs += dt;
      if (this.quietDurationMs >= 500) {
        if (!this.isPocketZupt) {
          this.isPocketZupt = true;
          // Freeze heading angle to physically stop spiral effect
          this.frozenHeading = currentHeadingDeg;
        }
      }
    } else {
      this.quietDurationMs = 0;
      this.isPocketZupt = false;
      this.frozenHeading = null;
    }

    // Effective heading: if Pocket ZUPT is active, freeze heading angle
    const effectiveHeading = this.isPocketZupt && this.frozenHeading !== null
      ? this.frozenHeading
      : currentHeadingDeg;

    // If Pocket ZUPT is active, user is stationary, no step can occur
    if (this.isPocketZupt) {
      return {
        isStep: false,
        strideMeters: 0,
        isPocketZupt: true,
        effectiveHeadingDeg: effectiveHeading,
        currentVariance: variance,
      };
    }

    // --- 2. Moving Average Filter on Z-axis (window size 5) ---
    this.zBuffer.push(az);
    if (this.zBuffer.length > this.maWindowSize) {
      this.zBuffer.shift();
    }
    const smoothedZ = this.zBuffer.reduce((a, b) => a + b, 0) / this.zBuffer.length;

    this.smoothedZHistory.push(smoothedZ);
    if (this.smoothedZHistory.length > this.windowSize) {
      this.smoothedZHistory.shift();
    }

    // Need enough history to compute local peak-to-peak swing
    if (this.smoothedZHistory.length < 8) {
      return {
        isStep: false,
        strideMeters: 0,
        isPocketZupt: false,
        effectiveHeadingDeg: effectiveHeading,
        currentVariance: variance,
      };
    }

    // --- 3. Dynamic Threshold Step Detection ---
    let localMin = Infinity;
    let localMax = -Infinity;
    const len = this.smoothedZHistory.length;

    for (let i = 0; i < len; i++) {
      const val = this.smoothedZHistory[i];
      if (val < localMin) localMin = val;
      if (val > localMax) localMax = val;
    }

    const swing = localMax - localMin;
    const timeSinceLastStep = timestamp - this.lastStepTime;

    // Peak detection: check if the value 2 samples ago was a local peak
    // (i.e. was rising and now falling)
    const midIdx = len - 2;
    const isPeak =
      midIdx > 0 &&
      this.smoothedZHistory[midIdx] >= this.smoothedZHistory[midIdx - 1] &&
      this.smoothedZHistory[midIdx] > this.smoothedZHistory[midIdx + 1];

    let isStep = false;
    if (isPeak && swing > this.dynamicThreshold && timeSinceLastStep > this.minStepIntervalMs) {
      this.stepCount++;
      this.lastStepIntervalMs = timeSinceLastStep;
      this.lastStepTime = timestamp;
      isStep = true;
    }

    return {
      isStep,
      strideMeters: isStep ? this.strideLength : 0,
      isPocketZupt: false,
      effectiveHeadingDeg: effectiveHeading,
      currentVariance: variance,
    };
  }

  public getStepCount(): number {
    return this.stepCount;
  }

  public getStrideLength(): number {
    return this.strideLength;
  }

  public getIsPocketZupt(): boolean {
    return this.isPocketZupt;
  }

  public getLastStepIntervalMs(): number {
    return this.lastStepIntervalMs;
  }
}

export const stepDetector = new StepDetector();
