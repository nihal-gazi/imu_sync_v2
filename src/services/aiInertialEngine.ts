/**
 * Edge AI Inertial Odometry Engine.
 * Runs monolithic ONNX MLP via WebGPU / WASM with ZUPT anti-drift gate.
 * Optimized for zero-garbage collection, non-blocking mobile load, and leak-free inference.
 */

import * as ort from 'onnxruntime-web';
import { GaussianIMUFilter6D } from '../utils/filter';
import type { AIInferenceMetrics } from '../types';

export type AIStateListener = (metrics: AIInferenceMetrics) => void;

export class AIInertialEngine {
  private session: ort.InferenceSession | null = null;
  private isInitializing: boolean = false;
  private isInferring: boolean = false;
  private readonly seqLen: number = 20;
  private readonly inFeatures: number = 6;
  
  // 6-DOF Gaussian filter instance (Kernel Size: 7, Sigma: 1.2)
  private gaussianFilter = new GaussianIMUFilter6D(7, 1.2);
  
  // Rolling IMU buffer of Gaussian-smoothed features: [ax, ay, az, gz_rad, gx_rad, gy_rad]
  private imuBuffer: number[][] = [];
  private lastInferenceTime: number = 0;
  private readonly inferenceIntervalMs: number = 200; // 5Hz inference rate
  
  // Pre-allocated static tensor buffer (avoids GC thrashing)
  private readonly flatData = new Float32Array(20 * 6);
  
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
    modelName: 'Inertial MLP (WebGPU Edge)',
  };

  private latencies: number[] = [];
  private listeners: Set<AIStateListener> = new Set();

  constructor() {
    try {
      // Configure threads safely without crashing mobile workers
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

  /**
   * Initializes the ONNX MLP session from a monolithic binary buffer.
   * Yields to the event loop so mobile browser renders smoothly on load.
   */
  public async initializeModel(modelUrl: string = '/models/inertial_mlp.onnx'): Promise<boolean> {
    if (this.session) return true;
    if (this.isInitializing) return false;

    this.isInitializing = true;
    this.metrics.isLoading = true;
    this.notify();

    // Small delay to allow the browser to complete initial paint
    await new Promise((resolve) => setTimeout(resolve, 80));

    try {
      const response = await fetch(modelUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching model: ${response.statusText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const modelBytes = new Uint8Array(arrayBuffer);

      let session: ort.InferenceSession | null = null;
      let usedProvider: 'webgpu' | 'wasm' = 'webgpu';

      try {
        if ('gpu' in navigator) {
          session = await ort.InferenceSession.create(modelBytes, {
            executionProviders: ['webgpu'],
            graphOptimizationLevel: 'all',
          });
          usedProvider = 'webgpu';
        } else {
          throw new Error('WebGPU not supported.');
        }
      } catch {
        session = await ort.InferenceSession.create(modelBytes, {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all',
        });
        usedProvider = 'wasm';
      }

      this.session = session;
      this.metrics.isLoaded = true;
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
   * Processes an incoming 6-DOF IMU sample.
   * 1. Gaussian smooths the sample.
   * 2. Pushes to rolling window.
   * 3. Triggers inference at 5Hz without blocking high-frequency sampling.
   */
  public processSensorSample(
    rawAx: number,
    rawAy: number,
    rawAz: number,
    rawGxDeg: number,
    rawGyDeg: number,
    rawGzDeg: number,
    timestamp: number = Date.now(),
    onInferenceOutput?: (displacementMeters: number, instantaneousSpeedMps: number, instantaneousHeadingDeltaDeg: number) => void
  ) {
    const smoothed = this.gaussianFilter.process(
      rawAx,
      rawAy,
      rawAz,
      rawGxDeg,
      rawGyDeg,
      rawGzDeg
    );

    const degToRad = Math.PI / 180;
    const sample = [
      smoothed.ax,
      smoothed.ay,
      smoothed.az,
      smoothed.gz * degToRad,
      smoothed.gx * degToRad,
      smoothed.gy * degToRad,
    ];

    this.imuBuffer.push(sample);
    if (this.imuBuffer.length > this.seqLen) {
      this.imuBuffer.shift();
    }

    // Trigger inference if session is ready, buffer is full, and not currently running an inference
    if (this.session && !this.isInferring && this.imuBuffer.length >= this.seqLen) {
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
    if (!this.session || this.isInferring || this.imuBuffer.length < this.seqLen) return;
    this.isInferring = true;

    try {
      // Physical Zero-Velocity Detection (ZUPT Anti-Drift Gate)
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

      const isStationary = accelVariance < 0.05 && avgGyroDeg < 1.8;
      this.metrics.isStationary = isStationary;
      this.metrics.motionVariance = Number(accelVariance.toFixed(4));

      if (isStationary) {
        this.metrics.lastDisplacement = { dx: 0, dy: 0, magnitude: 0 };
        this.metrics.instantaneousSpeedMps = 0;
        this.metrics.instantaneousSpeedKmh = 0;
        this.metrics.instantaneousTurnDeltaDeg = 0;
        this.notify();

        if (onInferenceOutput) {
          onInferenceOutput(0, 0, 0);
        }
        return;
      }

      const t0 = performance.now();

      // Populate pre-allocated flatData buffer
      for (let i = 0; i < this.seqLen; i++) {
        const s = this.imuBuffer[i];
        const offset = i * this.inFeatures;
        this.flatData[offset] = s[0];
        this.flatData[offset + 1] = s[1];
        this.flatData[offset + 2] = s[2];
        this.flatData[offset + 3] = s[3];
        this.flatData[offset + 4] = s[4];
        this.flatData[offset + 5] = s[5];
      }

      const inputTensor = new ort.Tensor('float32', this.flatData, [1, this.seqLen, this.inFeatures]);
      const feeds: Record<string, ort.Tensor> = { imu_sequence: inputTensor };

      let results: ort.InferenceSession.ReturnType | null = null;
      try {
        results = await this.session.run(feeds);
      } finally {
        // Always dispose input tensor to prevent WebGPU/WASM memory leak
        inputTensor.dispose();
      }

      const latency = performance.now() - t0;

      const outputTensor = results.odometry_output || Object.values(results)[0];
      const outData = outputTensor.data as Float32Array;

      const dx = outData[0] || 0;
      const dy = outData[1] || 0;
      const instSpeedMps = Math.max(0, outData[2] || 0);
      const instSpeedKmh = instSpeedMps * 3.6;
      const instDeltaThetaDeg = (outData[3] || 0) * (180 / Math.PI);
      const magnitude = Math.sqrt(dx * dx + dy * dy);

      // Dispose output tensors
      for (const key in results) {
        results[key]?.dispose?.();
      }

      // Latency tracking without unbounded array growth
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
    this.imuBuffer = [];
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
    this.notify();
  }
}

export const aiInertialEngine = new AIInertialEngine();
