/**
 * Edge AI Inertial Odometry Engine.
 * Supports:
 * 1. "SIH" (Default): Monolithic ONNX MLP via WebGPU / WASM with ZUPT anti-drift gate.
 * 2. "SIH-Rect": Transformer 1.0s Residual Drift Rectification on 60Hz IMU stream.
 * 3. "SIH-Rect-scaled": 40x Scaled Velocity + High-Threshold ZUPT Rest Gate.
 * 4. "STEP": PDR Footstep Detector (0.65m Discrete Stride + Pocket ZUPT + Gyro/Mag Heading).
 */

import * as ort from 'onnxruntime-web';
import { GaussianIMUFilter6D } from '../utils/filter';
import { orientationAligner } from './orientationAligner';
import { stepDetector } from './stepDetector';
import type { AIInferenceMetrics, ModelMode } from '../types';

export type AIStateListener = (metrics: AIInferenceMetrics) => void;

interface ScalerParams {
  mean: number[];
  std: number[];
  seq_len: number;
}

export class AIInertialEngine {
  private sessionSih: ort.InferenceSession | null = null;
  private sessionTransformer: ort.InferenceSession | null = null;

  private isInitializing: boolean = false;
  private isInferring: boolean = false;
  
  private activeMode: ModelMode = 'SIH'; // Default is SIH
  private restThreshold: number = 0.15; // User-configurable global REST threshold slider

  private readonly seqLenSih: number = 20;
  private readonly seqLenTrans: number = 60; // 1.0s @ 60Hz
  private readonly inFeatures: number = 6;
  
  // 6-DOF Gaussian filter instance (Kernel Size: 7, Sigma: 1.2)
  private gaussianFilter = new GaussianIMUFilter6D(7, 1.2);
  
  // Rolling IMU buffers
  private imuBuffer: number[][] = []; // 20 samples for SIH
  private rawImuBuffer60: number[][] = []; // 60 samples for Transformer
  
  private lastInferenceTime: number = 0;
  private readonly inferenceIntervalMs: number = 200; // 5Hz inference rate
  
  // Pre-allocated static tensor buffers
  private readonly flatDataSih = new Float32Array(20 * 6);
  private readonly flatDataTrans = new Float32Array(60 * 6);
  
  private scaler: ScalerParams = {
    mean: [0, 0, 9.81, 0, 0, 0],
    std: [1, 1, 1, 0.1, 0.1, 0.1],
    seq_len: 60,
  };

  private metrics: AIInferenceMetrics = {
    isLoaded: false,
    isLoading: false,
    executionProvider: 'initializing',
    lastLatencyMs: 0,
    avgLatencyMs: 0,
    totalInferences: 0,
    lastDisplacement: { dx: 0, dy: 0, magnitude: 0 },
    instantaneousSpeedMps: 0,
    instantaneousSpeedKmh: 0,
    instantaneousTurnDeltaDeg: 0,
    isStationary: true,
    motionVariance: 0,
    modelName: 'SIH MLP (Monolithic Base)',
    activeMode: 'SIH',
    residualCorrectionMeters: 0,
    residualSpeedMps: 0,
    stepCount: 0,
    isPocketZupt: false,
    lastStepIntervalMs: 0,
    isTiltCompensationEnabled: true,
    restThreshold: 0.15,
    pitchDeg: 0,
    rollDeg: 0,
  };

  private latencies: number[] = [];
  private listeners: Set<AIStateListener> = new Set();

  constructor() {
    try {
      if (typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated) {
        ort.env.wasm.numThreads = Math.min(2, navigator.hardwareConcurrency || 1);
      } else {
        ort.env.wasm.numThreads = 1;
      }
      ort.env.wasm.simd = true;
    } catch {}
  }

  public subscribe(listener: AIStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getMetrics());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const state = this.getMetrics();
    this.listeners.forEach((listener) => listener(state));
  }

  public getMetrics(): AIInferenceMetrics {
    return { ...this.metrics };
  }

  public setModelMode(mode: ModelMode) {
    this.activeMode = mode;
    this.metrics.activeMode = mode;
    if (mode === 'STEP') {
      this.metrics.modelName = 'STEP PDR (0.65m Discrete Stride + Pocket ZUPT)';
    } else if (mode === 'SIH-Rect-scaled') {
      this.metrics.modelName = 'SIH-Rect-scaled (40x Scaled + Elevated Rest Gate)';
    } else if (mode === 'SIH-Rect') {
      this.metrics.modelName = 'SIH-Rect (Transformer Residual Drift Corrected)';
    } else {
      this.metrics.modelName = 'SIH MLP (Monolithic Base)';
    }
    console.log(`[AI Engine] Active Model switched to: ${mode}`);
    this.notify();
  }

  public getModelMode(): ModelMode {
    return this.activeMode;
  }

  public setRestThreshold(val: number) {
    this.restThreshold = Math.max(0.01, Math.min(1.0, val));
    this.metrics.restThreshold = Number(this.restThreshold.toFixed(3));
    this.notify();
  }

  public getRestThreshold(): number {
    return this.restThreshold;
  }

  public setTiltCompensation(enabled: boolean) {
    orientationAligner.enabled = enabled;
    this.metrics.isTiltCompensationEnabled = enabled;
    this.notify();
  }

  public isTiltCompensationEnabled(): boolean {
    return orientationAligner.enabled;
  }

  /**
   * Initializes AI neural network models (SIH MLP and Transformer).
   */
  public async initializeModel(
    sihUrl: string = '/models/inertial_mlp.onnx',
    transformerUrl: string = '/models/sih_rect_transformer.onnx',
    scalerUrl: string = '/models/rect_scaler.json'
  ): Promise<boolean> {
    if (this.sessionSih) return true;
    if (this.isInitializing) return false;

    this.isInitializing = true;
    this.metrics.isLoading = true;
    this.notify();

    await new Promise((resolve) => setTimeout(resolve, 60));

    try {
      // 1. Load Scalers
      try {
        const scalerRes = await fetch(scalerUrl);
        if (scalerRes.ok) this.scaler = await scalerRes.json();
      } catch {}

      // 2. Load Base SIH MLP
      const sihRes = await fetch(sihUrl);
      if (!sihRes.ok) throw new Error(`HTTP ${sihRes.status} fetching ${sihUrl}`);
      const sihBytes = new Uint8Array(await sihRes.arrayBuffer());

      let usedProvider: 'webgpu' | 'wasm' = 'wasm';
      try {
        if ('gpu' in navigator) {
          this.sessionSih = await ort.InferenceSession.create(sihBytes, {
            executionProviders: ['webgpu'],
            graphOptimizationLevel: 'all',
          });
          usedProvider = 'webgpu';
        } else {
          throw new Error('WebGPU unavailable');
        }
      } catch {
        this.sessionSih = await ort.InferenceSession.create(sihBytes, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
        usedProvider = 'wasm';
      }

      // 3. Load Residual Drift Transformer
      try {
        const transRes = await fetch(transformerUrl);
        if (transRes.ok) {
          const transBytes = new Uint8Array(await transRes.arrayBuffer());
          this.sessionTransformer = await ort.InferenceSession.create(transBytes, {
            executionProviders: [usedProvider, 'wasm'],
            graphOptimizationLevel: 'all',
          });
        }
      } catch (transErr) {
        console.warn('[AI Engine] Transformer notice:', transErr);
      }

      this.metrics.isLoaded = !!this.sessionSih;
      this.metrics.isLoading = false;
      this.metrics.executionProvider = usedProvider;
      this.metrics.errorMessage = undefined;
      this.isInitializing = false;
      this.notify();
      return true;
    } catch (err: any) {
      this.metrics.isLoaded = false;
      this.metrics.isLoading = false;
      this.metrics.executionProvider = 'failed';
      this.metrics.errorMessage = err?.message || 'Model initialization failed';
      this.isInitializing = false;
      this.notify();
      return false;
    }
  }

  /**
   * Processes incoming 6-DOF IMU sample.
   * Dispatches either to STEP PDR detector or to Neural MLP/Transformer.
   */
  public processSensorSample(
    rawAx: number,
    rawAy: number,
    rawAz: number,
    rawGxDeg: number,
    rawGyDeg: number,
    rawGzDeg: number,
    currentHeadingDeg: number = 0,
    timestamp: number = Date.now(),
    onInferenceOutput?: (displacementMeters: number, instantaneousSpeedMps: number, instantaneousHeadingDeltaDeg: number) => void
  ) {
    // 1. Dynamic 3D Gravity Tilt Alignment
    const aligned = orientationAligner.alignIMU(
      rawAx,
      rawAy,
      rawAz,
      rawGxDeg,
      rawGyDeg,
      rawGzDeg
    );

    this.metrics.pitchDeg = Number(aligned.pitchDeg.toFixed(1));
    this.metrics.rollDeg = Number(aligned.rollDeg.toFixed(1));

    const degToRad = Math.PI / 180;

    // --- STEP PDR MODEL PIPELINE ---
    if (this.activeMode === 'STEP') {
      const stepRes = stepDetector.processSample(
        aligned.ax,
        aligned.ay,
        aligned.az,
        currentHeadingDeg,
        timestamp
      );

      this.metrics.stepCount = stepDetector.getStepCount();
      this.metrics.isPocketZupt = stepRes.isPocketZupt;
      this.metrics.lastStepIntervalMs = stepDetector.getLastStepIntervalMs();
      this.metrics.motionVariance = Number(stepRes.currentVariance.toFixed(4));

      if (stepRes.isPocketZupt) {
        this.metrics.isStationary = true;
        this.metrics.instantaneousSpeedMps = 0;
        this.metrics.instantaneousSpeedKmh = 0;
        this.metrics.lastDisplacement = { dx: 0, dy: 0, magnitude: 0 };
        this.notify();
        if (onInferenceOutput) {
          onInferenceOutput(0, 0, 0);
        }
        return {
          ax: aligned.ax,
          ay: aligned.ay,
          az: aligned.az,
          gx: aligned.gx,
          gy: aligned.gy,
          gz: aligned.gz,
          accelMagnitude: Math.hypot(aligned.ax, aligned.ay, aligned.az),
          gyroMagnitude: Math.hypot(aligned.gx, aligned.gy, aligned.gz),
        };
      }

      if (stepRes.isStep) {
        const stride = stepRes.strideMeters; // 0.65m
        const stepDtSec = Math.max(0.25, (stepDetector.getLastStepIntervalMs() || 500) / 1000.0);
        const instSpeedMps = stride / stepDtSec;

        const thetaRad = (stepRes.effectiveHeadingDeg * Math.PI) / 180;
        const dx = stride * Math.sin(thetaRad);
        const dy = stride * Math.cos(thetaRad);

        this.metrics.lastDisplacement = {
          dx: Number(dx.toFixed(3)),
          dy: Number(dy.toFixed(3)),
          magnitude: stride,
        };
        this.metrics.instantaneousSpeedMps = Number(instSpeedMps.toFixed(2));
        this.metrics.instantaneousSpeedKmh = Number((instSpeedMps * 3.6).toFixed(1));
        this.metrics.isStationary = false;
        this.metrics.totalInferences += 1;
        this.notify();

        if (onInferenceOutput) {
          onInferenceOutput(stride, instSpeedMps, 0);
        }
      }

      return {
        ax: aligned.ax,
        ay: aligned.ay,
        az: aligned.az,
        gx: aligned.gx,
        gy: aligned.gy,
        gz: aligned.gz,
        accelMagnitude: Math.hypot(aligned.ax, aligned.ay, aligned.az),
        gyroMagnitude: Math.hypot(aligned.gx, aligned.gy, aligned.gz),
      };
    }

    // --- NEURAL NETWORK PIPELINES (SIH / SIH-Rect / SIH-Rect-scaled) ---
    const smoothed = this.gaussianFilter.process(
      aligned.ax,
      aligned.ay,
      aligned.az,
      aligned.gx,
      aligned.gy,
      aligned.gz
    );
    
    const sihSample = [
      smoothed.ax,
      smoothed.ay,
      smoothed.az,
      smoothed.gz * degToRad,
      smoothed.gx * degToRad,
      smoothed.gy * degToRad,
    ];

    this.imuBuffer.push(sihSample);
    if (this.imuBuffer.length > this.seqLenSih) {
      this.imuBuffer.shift();
    }

    const rawSample = [aligned.ax, aligned.ay, aligned.az, aligned.gx * degToRad, aligned.gy * degToRad, aligned.gz * degToRad];
    this.rawImuBuffer60.push(rawSample);
    if (this.rawImuBuffer60.length > this.seqLenTrans) {
      this.rawImuBuffer60.shift();
    }

    // Trigger inference at 5Hz (200ms)
    if (this.sessionSih && !this.isInferring && this.imuBuffer.length >= this.seqLenSih) {
      if (timestamp - this.lastInferenceTime >= this.inferenceIntervalMs) {
        this.lastInferenceTime = timestamp;
        this.runInference(onInferenceOutput);
      }
    }

    return smoothed;
  }

  private async runInference(
    onInferenceOutput?: (displacementMeters: number, instantaneousSpeedMps: number, instantaneousHeadingDeltaDeg: number) => void
  ) {
    if (!this.sessionSih || this.isInferring || this.imuBuffer.length < this.seqLenSih) return;
    this.isInferring = true;

    try {
      // Step 1: Physical Zero-Velocity Detection (Configured via Global REST Slider)
      let sumNorm = 0;
      let sumSqNorm = 0;
      let sumGyro = 0;
      const n = this.imuBuffer.length;

      for (let i = 0; i < n; i++) {
        const [ax, ay, az, gz, gx, gy] = this.imuBuffer[i];
        const norm = Math.sqrt(ax * ax + ay * ay + az * az);
        const gyroNormDeg = Math.sqrt(gx * gx + gy * gy + gz * gz) * (180 / Math.PI);
        sumNorm += norm;
        sumSqNorm += norm * norm;
        sumGyro += gyroNormDeg;
      }

      const meanNorm = sumNorm / n;
      const accelVariance = Math.max(0, (sumSqNorm / n) - (meanNorm * meanNorm));
      const avgGyroDeg = sumGyro / n;

      // Global Rest Sensitivity
      const effectiveAccelThresh = this.activeMode === 'SIH-Rect-scaled'
        ? this.restThreshold * 1.5
        : this.restThreshold;
      const effectiveGyroThresh = Math.max(1.8, effectiveAccelThresh * 22.0);

      const isStationary = accelVariance < effectiveAccelThresh && avgGyroDeg < effectiveGyroThresh;
      this.metrics.isStationary = isStationary;
      this.metrics.motionVariance = Number(accelVariance.toFixed(4));

      if (isStationary) {
        this.metrics.lastDisplacement = { dx: 0, dy: 0, magnitude: 0 };
        this.metrics.instantaneousSpeedMps = 0;
        this.metrics.instantaneousSpeedKmh = 0;
        this.metrics.instantaneousTurnDeltaDeg = 0;
        this.metrics.residualCorrectionMeters = 0;
        this.metrics.residualSpeedMps = 0;
        this.notify();

        if (onInferenceOutput) {
          onInferenceOutput(0, 0, 0);
        }
        return;
      }

      const t0 = performance.now();

      for (let i = 0; i < this.seqLenSih; i++) {
        const s = this.imuBuffer[i];
        const offset = i * this.inFeatures;
        this.flatDataSih[offset] = s[0];
        this.flatDataSih[offset + 1] = s[1];
        this.flatDataSih[offset + 2] = s[2];
        this.flatDataSih[offset + 3] = s[3];
        this.flatDataSih[offset + 4] = s[4];
        this.flatDataSih[offset + 5] = s[5];
      }

      const sihTensor = new ort.Tensor('float32', this.flatDataSih, [1, this.seqLenSih, this.inFeatures]);
      let sihResults: ort.InferenceSession.ReturnType | null = null;
      try {
        sihResults = await this.sessionSih.run({ imu_sequence: sihTensor });
      } finally {
        sihTensor.dispose();
      }

      const sihOutTensor = sihResults.odometry_output || Object.values(sihResults)[0];
      const sihOutData = sihOutTensor.data as Float32Array;

      let dx = sihOutData[0] || 0;
      let dy = sihOutData[1] || 0;
      let instSpeedMps = Math.max(0, sihOutData[2] || 0);
      const instDeltaThetaDeg = (sihOutData[3] || 0) * (180 / Math.PI);
      let magnitude = Math.sqrt(dx * dx + dy * dy);

      for (const key in sihResults) {
        sihResults[key]?.dispose?.();
      }

      // Transformer Residual Correction
      let deltaResidualDisp = 0;
      let deltaResidualSpeed = 0;
      const isRectMode = this.activeMode === 'SIH-Rect' || this.activeMode === 'SIH-Rect-scaled';

      if (isRectMode && this.sessionTransformer && this.rawImuBuffer60.length >= this.seqLenTrans) {
        const mean = this.scaler.mean;
        const std = this.scaler.std;

        for (let i = 0; i < this.seqLenTrans; i++) {
          const s = this.rawImuBuffer60[i];
          const offset = i * this.inFeatures;
          for (let c = 0; c < 6; c++) {
            this.flatDataTrans[offset + c] = (s[c] - (mean[c] || 0)) / (std[c] || 1.0);
          }
        }

        const transTensor = new ort.Tensor('float32', this.flatDataTrans, [1, this.seqLenTrans, this.inFeatures]);
        let transResults: ort.InferenceSession.ReturnType | null = null;
        try {
          transResults = await this.sessionTransformer.run({ imu_window_60hz: transTensor });
        } finally {
          transTensor.dispose();
        }

        const transOutTensor = transResults.residual_corrections || Object.values(transResults)[0];
        const transData = transOutTensor.data as Float32Array;
        
        deltaResidualDisp = (transData[0] || 0) * (0.2 / 0.5);
        deltaResidualSpeed = (transData[1] || 0);

        for (const key in transResults) {
          transResults[key]?.dispose?.();
        }

        magnitude = Math.max(0.0, magnitude + deltaResidualDisp);
        instSpeedMps = Math.max(0.0, instSpeedMps + deltaResidualSpeed);
      }

      // 40x Scale-down for SIH-Rect-scaled
      if (this.activeMode === 'SIH-Rect-scaled') {
        const scaleFactor = 1.0 / 40.0;
        magnitude *= scaleFactor;
        instSpeedMps *= scaleFactor;
        dx *= scaleFactor;
        dy *= scaleFactor;
        deltaResidualDisp *= scaleFactor;
        deltaResidualSpeed *= scaleFactor;
      }

      const latency = performance.now() - t0;
      const instSpeedKmh = instSpeedMps * 3.6;

      this.latencies.push(latency);
      if (this.latencies.length > 20) this.latencies.shift();
      const avgLatency = this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;

      this.metrics.lastLatencyMs = Number(latency.toFixed(1));
      this.metrics.avgLatencyMs = Number(avgLatency.toFixed(1));
      this.metrics.totalInferences += 1;
      this.metrics.lastDisplacement = {
        dx: Number(dx.toFixed(3)),
        dy: Number(dy.toFixed(3)),
        magnitude: Number(magnitude.toFixed(3)),
      };
      this.metrics.instantaneousSpeedMps = Number(instSpeedMps.toFixed(2));
      this.metrics.instantaneousSpeedKmh = Number(instSpeedKmh.toFixed(1));
      this.metrics.instantaneousTurnDeltaDeg = Number(instDeltaThetaDeg.toFixed(2));
      this.metrics.residualCorrectionMeters = Number(deltaResidualDisp.toFixed(3));
      this.metrics.residualSpeedMps = Number(deltaResidualSpeed.toFixed(2));

      this.notify();

      if (onInferenceOutput) {
        onInferenceOutput(magnitude, instSpeedMps, instDeltaThetaDeg);
      }
    } catch (inferErr) {
      console.warn('[AI Engine] Inference notice:', inferErr);
    } finally {
      this.isInferring = false;
    }
  }

  public reset() {
    this.gaussianFilter.reset();
    stepDetector.reset();
    this.imuBuffer = [];
    this.rawImuBuffer60 = [];
    this.lastInferenceTime = 0;
    this.isInferring = false;
    this.latencies = [];
    this.metrics.lastDisplacement = { dx: 0, dy: 0, magnitude: 0 };
    this.metrics.instantaneousSpeedMps = 0;
    this.metrics.instantaneousSpeedKmh = 0;
    this.metrics.instantaneousTurnDeltaDeg = 0;
    this.metrics.isStationary = true;
    this.metrics.motionVariance = 0;
    this.metrics.totalInferences = 0;
    this.metrics.residualCorrectionMeters = 0;
    this.metrics.residualSpeedMps = 0;
    this.metrics.stepCount = 0;
    this.metrics.isPocketZupt = false;
    this.metrics.lastStepIntervalMs = 0;
    this.notify();
  }
}

export const aiInertialEngine = new AIInertialEngine();
