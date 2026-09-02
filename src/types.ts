export interface GridPoint {
  x: number; // local Cartesian X in meters (East)
  y: number; // local Cartesian Y in meters (North)
  timestamp: number;
  speedMps: number;
  heading: number; // degrees (0 = North, 90 = East, 180 = South, 270 = West)
  displacement: number; // meters from previous point
}

export interface HeadingData {
  heading: number; // 0 - 360 degrees
  rawHeading: number;
  source: 'webkit' | 'absolute' | 'rotation-matrix' | 'alpha' | 'simulated' | 'fallback';
  pitch: number;
  roll: number;
  calibrated: boolean;
}

export interface MotionSample {
  timestamp: number;
  // Raw 6-DOF IMU
  rawAx: number;
  rawAy: number;
  rawAz: number;
  rawGx: number;
  rawGy: number;
  rawGz: number;
  // Gaussian Smoothed 6-DOF IMU
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  rawMagnitude: number;
  filteredMagnitude: number;
  gyroMagnitude: number;
}

export interface NavigationMetrics {
  totalDistanceMeters: number;
  currentSpeedMps: number;
  currentSpeedKmh: number;
  lastDisplacementMeters: number;
  totalInferenceUpdates: number;
  lastUpdateTimestamp: number;
  currentX: number; // meters
  currentY: number; // meters
}

export interface AIInferenceMetrics {
  isLoaded: boolean;
  isLoading: boolean;
  executionProvider: 'webgpu' | 'wasm' | 'cpu' | 'initializing' | 'failed';
  lastLatencyMs: number;
  avgLatencyMs: number;
  totalInferences: number;
  lastDisplacement: { dx: number; dy: number; magnitude: number };
  instantaneousSpeedMps: number;
  instantaneousSpeedKmh: number;
  instantaneousTurnDeltaDeg: number;
  isStationary: boolean;
  motionVariance: number;
  modelName: string;
  activeMode: 'SIH' | 'SIH-Rect' | 'SIH-Rect-scaled' | 'TCN';
  residualCorrectionMeters: number;
  residualSpeedMps: number;
  tcnForwardSpeedMps: number;
  tcnZuptProbability: number;
  esEkfAccelBias: [number, number, number];
  esEkfGyroBias: [number, number, number];
  isTiltCompensationEnabled: boolean;
  restThreshold: number;
  pitchDeg: number;
  rollDeg: number;
  errorMessage?: string;
}

export type ModelMode = 'SIH' | 'SIH-Rect' | 'SIH-Rect-scaled' | 'TCN';

export interface SensorStatus {
  gyroAvailable: boolean;
  accelAvailable: boolean;
  hasHardwareMotion: boolean;
  motionEventCount: number;
  permissionGranted: boolean;
  isSimulating: boolean;
}
