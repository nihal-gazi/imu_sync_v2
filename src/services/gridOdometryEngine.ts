/**
 * Pure 2D Cartesian Grid Odometry Engine.
 * Accumulates dead-reckoning displacement [X, Y] in meters on an infinite 2D grid.
 * Throttled state notifications prevent React re-render thrashing at 60-100Hz.
 */

import type {
  GridPoint,
  HeadingData,
  MotionSample,
  NavigationMetrics,
} from '../types';
import { computeRobustCompassHeading, normalizeDegrees } from '../utils/orientation';
import { aiInertialEngine } from './aiInertialEngine';

export interface GridTrackerState {
  currentX: number;
  currentY: number;
  headingData: HeadingData;
  navigationMetrics: NavigationMetrics;
  recentMotion: MotionSample[];
  pathHistory: GridPoint[];
}

export type GridTrackerListener = (state: GridTrackerState) => void;

export class GridOdometryEngine {
  private currentX: number = 0;
  private currentY: number = 0;

  private headingData: HeadingData = {
    heading: 0,
    rawHeading: 0,
    source: 'fallback',
    pitch: 0,
    roll: 0,
    calibrated: false,
  };

  private navigationMetrics: NavigationMetrics = {
    totalDistanceMeters: 0,
    currentSpeedMps: 0,
    currentSpeedKmh: 0,
    lastDisplacementMeters: 0,
    totalInferenceUpdates: 0,
    lastUpdateTimestamp: 0,
    currentX: 0,
    currentY: 0,
  };

  private recentMotion: MotionSample[] = [];
  private readonly maxMotionSamples = 60;
  private pathHistory: GridPoint[] = [];
  private readonly maxPathPoints = 1200;

  private listeners: Set<GridTrackerListener> = new Set();
  private lastNotifyTime: number = 0;
  private readonly notifyThrottleMs: number = 80; // ~12.5Hz max for React text updates

  constructor() {
    this.pathHistory.push({
      x: 0,
      y: 0,
      timestamp: Date.now(),
      speedMps: 0,
      heading: 0,
      displacement: 0,
    });
  }

  public subscribe(listener: GridTrackerListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(force: boolean = false) {
    const now = performance.now();
    if (!force && now - this.lastNotifyTime < this.notifyThrottleMs) {
      return;
    }
    this.lastNotifyTime = now;
    const state = this.getState();
    this.listeners.forEach((listener) => listener(state));
  }

  public getState(): GridTrackerState {
    return {
      currentX: this.currentX,
      currentY: this.currentY,
      headingData: { ...this.headingData },
      navigationMetrics: { ...this.navigationMetrics },
      recentMotion: this.recentMotion,
      pathHistory: this.pathHistory,
    };
  }

  // Direct zero-copy getters for 60fps canvas render loops
  public getRecentMotion(): readonly MotionSample[] {
    return this.recentMotion;
  }

  public getPathHistory(): readonly GridPoint[] {
    return this.pathHistory;
  }

  public getCurrentPosition(): { x: number; y: number } {
    return { x: this.currentX, y: this.currentY };
  }

  public getHeading(): number {
    return this.headingData.heading;
  }

  public updateOrientation(
    alpha: number | null,
    beta: number | null,
    gamma: number | null,
    webkitCompassHeading?: number,
    absolute: boolean = false
  ) {
    let rawHeading = this.headingData.rawHeading;
    let source: HeadingData['source'] = 'fallback';

    if (webkitCompassHeading !== undefined && !isNaN(webkitCompassHeading)) {
      rawHeading = normalizeDegrees(webkitCompassHeading);
      source = 'webkit';
    } else if (alpha !== null && beta !== null && gamma !== null) {
      rawHeading = computeRobustCompassHeading(alpha, beta, gamma);
      source = absolute ? 'absolute' : 'rotation-matrix';
    } else if (alpha !== null && !isNaN(alpha)) {
      rawHeading = normalizeDegrees(360 - alpha);
      source = 'alpha';
    }

    this.headingData = {
      heading: Number(rawHeading.toFixed(1)),
      rawHeading: Number(rawHeading.toFixed(1)),
      source,
      pitch: Number((beta ?? 0).toFixed(1)),
      roll: Number((gamma ?? 0).toFixed(1)),
      calibrated: true,
    };

    this.notify(false);
  }

  public processDeviceMotion(
    ax: number,
    ay: number,
    az: number,
    gx: number = 0,
    gy: number = 0,
    gz: number = 0,
    timestamp: number = Date.now()
  ) {
    const rawMag = Math.sqrt(ax * ax + ay * ay + az * az);

    const smoothed = aiInertialEngine.processSensorSample(
      ax,
      ay,
      az,
      gx,
      gy,
      gz,
      timestamp,
      (displacementMeters, speedMps, _headingDeltaDeg) => {
        this.handleOdometryStep(displacementMeters, speedMps, timestamp);
      }
    );

    const sample: MotionSample = {
      timestamp,
      rawAx: Number(ax.toFixed(2)),
      rawAy: Number(ay.toFixed(2)),
      rawAz: Number(az.toFixed(2)),
      rawGx: Number(gx.toFixed(1)),
      rawGy: Number(gy.toFixed(1)),
      rawGz: Number(gz.toFixed(1)),
      ax: Number(smoothed.ax.toFixed(2)),
      ay: Number(smoothed.ay.toFixed(2)),
      az: Number(smoothed.az.toFixed(2)),
      gx: Number(smoothed.gx.toFixed(1)),
      gy: Number(smoothed.gy.toFixed(1)),
      gz: Number(smoothed.gz.toFixed(1)),
      rawMagnitude: Number(rawMag.toFixed(2)),
      filteredMagnitude: Number(smoothed.accelMagnitude.toFixed(2)),
      gyroMagnitude: Number(smoothed.gyroMagnitude.toFixed(1)),
    };

    this.recentMotion.push(sample);
    if (this.recentMotion.length > this.maxMotionSamples) {
      this.recentMotion.shift();
    }

    this.notify(false);
  }

  private handleOdometryStep(displacementMeters: number, speedMps: number, timestamp: number) {
    if (displacementMeters <= 0.001) {
      this.navigationMetrics.currentSpeedMps = 0;
      this.navigationMetrics.currentSpeedKmh = 0;
      this.navigationMetrics.lastDisplacementMeters = 0;
      this.notify(true);
      return;
    }

    const thetaRad = (this.headingData.heading * Math.PI) / 180;
    const dx = displacementMeters * Math.sin(thetaRad);
    const dy = displacementMeters * Math.cos(thetaRad);

    this.currentX += dx;
    this.currentY += dy;

    this.navigationMetrics.currentX = Number(this.currentX.toFixed(2));
    this.navigationMetrics.currentY = Number(this.currentY.toFixed(2));
    this.navigationMetrics.lastDisplacementMeters = Number(displacementMeters.toFixed(3));
    this.navigationMetrics.totalDistanceMeters += displacementMeters;
    this.navigationMetrics.currentSpeedMps = speedMps;
    this.navigationMetrics.currentSpeedKmh = Number((speedMps * 3.6).toFixed(1));
    this.navigationMetrics.totalInferenceUpdates += 1;
    this.navigationMetrics.lastUpdateTimestamp = timestamp;

    this.pathHistory.push({
      x: Number(this.currentX.toFixed(3)),
      y: Number(this.currentY.toFixed(3)),
      timestamp,
      speedMps,
      heading: this.headingData.heading,
      displacement: displacementMeters,
    });

    if (this.pathHistory.length > this.maxPathPoints) {
      this.pathHistory.shift();
    }

    this.notify(true);
  }

  public setManualHeading(heading: number) {
    const norm = normalizeDegrees(heading);
    this.headingData = {
      ...this.headingData,
      heading: norm,
      rawHeading: norm,
      source: 'simulated',
    };
    this.notify(true);
  }

  public resetGrid() {
    this.currentX = 0;
    this.currentY = 0;
    this.navigationMetrics = {
      totalDistanceMeters: 0,
      currentSpeedMps: 0,
      currentSpeedKmh: 0,
      lastDisplacementMeters: 0,
      totalInferenceUpdates: 0,
      lastUpdateTimestamp: 0,
      currentX: 0,
      currentY: 0,
    };
    this.pathHistory = [
      {
        x: 0,
        y: 0,
        timestamp: Date.now(),
        speedMps: 0,
        heading: this.headingData.heading,
        displacement: 0,
      },
    ];
    aiInertialEngine.reset();
    this.notify(true);
  }
}

export const gridEngine = new GridOdometryEngine();
