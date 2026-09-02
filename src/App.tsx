import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GridCanvas } from './components/GridCanvas';
import { SensorGraphs } from './components/SensorGraphs';
import { TelemetryBar } from './components/TelemetryBar';
import { ControlBar } from './components/ControlBar';
import { gridEngine } from './services/gridOdometryEngine';
import { aiInertialEngine } from './services/aiInertialEngine';
import type { GridTrackerState } from './services/gridOdometryEngine';
import type { AIInferenceMetrics, SensorStatus, ModelMode } from './types';
import { Grid, Footprints, Activity, Sparkles, Gauge } from 'lucide-react';

export const App: React.FC = () => {
  const [gridState, setGridState] = useState<GridTrackerState>(() => gridEngine.getState());
  const [aiMetrics, setAiMetrics] = useState<AIInferenceMetrics>(() => aiInertialEngine.getMetrics());
  const [modelMode, setModelMode] = useState<ModelMode>('SIH'); // Default is SIH

  const [sensorStatus, setSensorStatus] = useState<SensorStatus>({
    gyroAvailable: false,
    accelAvailable: false,
    hasHardwareMotion: false,
    motionEventCount: 0,
    permissionGranted: false,
    isSimulating: false,
  });

  const simIntervalRef = useRef<number | null>(null);
  const simPhaseRef = useRef<number>(0);
  const motionCountRef = useRef<number>(0);
  const hasHardwareMotionRef = useRef<boolean>(false);
  const lastStatusUpdateRef = useRef<number>(0);
  const hasAbsoluteOrientationRef = useRef<boolean>(false);

  // Subscribe to Engine State updates (throttled by gridEngine)
  useEffect(() => {
    const unsubGrid = gridEngine.subscribe((state) => {
      setGridState(state);
    });

    const unsubAi = aiInertialEngine.subscribe((metrics) => {
      setAiMetrics(metrics);
    });

    // Initialize SIH Base MLP and SIH-Rect Residual Transformer
    const timer = setTimeout(() => {
      aiInertialEngine.initializeModel(
        '/models/inertial_mlp.onnx',
        '/models/sih_rect_transformer.onnx',
        '/models/rect_scaler.json'
      );
    }, 100);

    return () => {
      clearTimeout(timer);
      unsubGrid();
      unsubAi();
    };
  }, []);

  // Request Mobile Sensor Permissions (iOS 13+ & Android Chrome)
  const requestSensorPermissions = useCallback(async (): Promise<boolean> => {
    try {
      let granted = true;

      if (
        typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
          .requestPermission === 'function'
      ) {
        const response = await (
          DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }
        ).requestPermission();
        granted = granted && response === 'granted';
      }

      if (
        typeof (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> })
          .requestPermission === 'function'
      ) {
        const motionResponse = await (
          DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }
        ).requestPermission();
        granted = granted && motionResponse === 'granted';
      }

      setSensorStatus((prev) => ({
        ...prev,
        permissionGranted: granted,
        gyroAvailable: granted,
        accelAvailable: granted,
      }));

      return granted;
    } catch {
      setSensorStatus((prev) => ({
        ...prev,
        permissionGranted: true,
      }));
      return true;
    }
  }, []);

  // Mobile Hardware Sensor Event Listeners
  // Optimized: does NOT call setState on every 60-100Hz packet
  useEffect(() => {
    const handleDeviceMotion = (event: DeviceMotionEvent) => {
      let ax = 0;
      let ay = 0;
      let az = 0;

      if (
        event.accelerationIncludingGravity &&
        event.accelerationIncludingGravity.x !== null &&
        event.accelerationIncludingGravity.y !== null &&
        event.accelerationIncludingGravity.z !== null
      ) {
        ax = event.accelerationIncludingGravity.x;
        ay = event.accelerationIncludingGravity.y;
        az = event.accelerationIncludingGravity.z;
      } else if (
        event.acceleration &&
        event.acceleration.x !== null &&
        event.acceleration.y !== null &&
        event.acceleration.z !== null
      ) {
        ax = event.acceleration.x;
        ay = event.acceleration.y;
        az = event.acceleration.z + 9.81;
      } else {
        return;
      }

      motionCountRef.current += 1;

      const rot = event.rotationRate;
      const gx = rot?.beta ?? 0;
      const gy = rot?.gamma ?? 0;
      const gz = rot?.alpha ?? 0;

      // Throttle sensor status updates to max 2Hz to completely stop React re-render thrashing
      const now = performance.now();
      if (!hasHardwareMotionRef.current || now - lastStatusUpdateRef.current > 500) {
        lastStatusUpdateRef.current = now;
        hasHardwareMotionRef.current = true;
        const hasGyro = rot !== null && (rot.alpha !== null || rot.beta !== null || rot.gamma !== null);

        setSensorStatus((prev) => ({
          ...prev,
          accelAvailable: true,
          gyroAvailable: hasGyro || prev.gyroAvailable,
          hasHardwareMotion: true,
          motionEventCount: motionCountRef.current,
        }));
      }

      // Forward directly to high-performance engine buffer
      gridEngine.processDeviceMotion(ax, ay, az, gx, gy, gz, Date.now());
    };

    const handleAbsoluteOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha === null) return;
      hasAbsoluteOrientationRef.current = true;
      gridEngine.updateOrientation(event.alpha, event.beta, event.gamma, undefined, true);
    };

    const handleStandardOrientation = (event: DeviceOrientationEvent) => {
      const webkitHeading = (event as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
      if (webkitHeading !== undefined && !isNaN(webkitHeading)) {
        gridEngine.updateOrientation(event.alpha, event.beta, event.gamma, webkitHeading, true);
        return;
      }

      if (!hasAbsoluteOrientationRef.current && event.alpha !== null) {
        gridEngine.updateOrientation(event.alpha, event.beta, event.gamma, undefined, false);
      }
    };

    window.addEventListener('devicemotion', handleDeviceMotion, { passive: true });
    window.addEventListener('deviceorientationabsolute', handleAbsoluteOrientation as EventListener, {
      passive: true,
    });
    window.addEventListener('deviceorientation', handleStandardOrientation, { passive: true });

    return () => {
      window.removeEventListener('devicemotion', handleDeviceMotion);
      window.removeEventListener('deviceorientationabsolute', handleAbsoluteOrientation as EventListener);
      window.removeEventListener('deviceorientation', handleStandardOrientation);
    };
  }, []);

  // Keyboard Shortcuts (W: Inject Step, Space: Toggle Stream, A/D: Turn Left/Right)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.code === 'KeyW' || e.code === 'ArrowUp') {
        gridEngine.processDeviceMotion(0.6, 2.2, 9.81, 0, 0, 0, Date.now());
      } else if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
        const next = (gridState.headingData.heading - 15 + 360) % 360;
        gridEngine.setManualHeading(next);
      } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
        const next = (gridState.headingData.heading + 15) % 360;
        gridEngine.setManualHeading(next);
      } else if (e.code === 'Space') {
        e.preventDefault();
        toggleSimulator();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gridState.headingData.heading]);

  // Motion Simulator Ticker
  const toggleSimulator = useCallback(() => {
    if (simIntervalRef.current !== null) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
      setSensorStatus((prev) => ({ ...prev, isSimulating: false }));
    } else {
      setSensorStatus((prev) => ({ ...prev, isSimulating: true }));
      simIntervalRef.current = window.setInterval(() => {
        simPhaseRef.current += 0.25;
        const phase = simPhaseRef.current;

        const cadence = Math.sin(phase * 2.8);
        const lateral = Math.cos(phase * 1.4);

        const ax = lateral * 0.8;
        const ay = 1.6 + cadence * 1.8;
        const az = 9.81 + Math.sin(phase * 2.8) * 1.5;

        const gx = cadence * 12.0;
        const gy = lateral * 8.0;
        const gz = lateral * 4.0;

        gridEngine.processDeviceMotion(ax, ay, az, gx, gy, gz, Date.now());
      }, 50);
    }
  }, []);

  const handleInjectSample = useCallback((ax: number = 0.6, ay: number = 2.2, az: number = 9.81) => {
    gridEngine.processDeviceMotion(ax, ay, az, 0, 0, 0, Date.now());
  }, []);

  return (
    <div className="flex flex-col w-full h-screen bg-slate-950 text-slate-100 overflow-hidden font-mono select-none">
      {/* Top Header */}
      <header className="flex items-center justify-between px-4 py-2.5 bg-slate-900 border-b border-slate-800 shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-indigo-600/20 border border-indigo-500/40 rounded-lg text-indigo-400">
            <Grid className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-white flex items-center gap-2">
              <span>IMU GRID TRACKER</span>
              <span className={`text-[10px] px-2 py-0.5 rounded border font-bold flex items-center gap-1 ${
                modelMode === 'STEP'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : modelMode === 'SIH-Rect-scaled'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : modelMode === 'SIH-Rect'
                  ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                  : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
              }`}>
                {modelMode === 'STEP' && <Footprints className="w-2.5 h-2.5" />}
                {modelMode === 'SIH-Rect-scaled' && <Gauge className="w-2.5 h-2.5" />}
                {modelMode === 'SIH-Rect' && <Sparkles className="w-2.5 h-2.5" />}
                <span>{modelMode}</span>
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded border ${
                aiMetrics.isLoaded
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
              }`}>
                {aiMetrics.isLoaded ? `ONNX ${aiMetrics.executionProvider.toUpperCase()}` : 'Loading Model...'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400">
              {modelMode === 'STEP'
                ? 'STEP PDR: 0.65m Discrete Footstep Stride &bull; Pocket ZUPT Anti-Spiral Gate'
                : modelMode === 'SIH-Rect-scaled'
                ? 'SIH-Rectified (40x Scaled Velocity & High-Threshold Anti-Drift Rest Gate)'
                : modelMode === 'SIH-Rect'
                ? 'SIH Multi-Head MLP + Transformer 1.0s Residual Drift Rectification'
                : 'Pure 2D Cartesian Dead-Reckoning &bull; Gaussian Filter &bull; ZUPT Gate'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 bg-slate-950 border border-slate-800 rounded-lg text-slate-400">
            <Activity className="w-3.5 h-3.5 text-indigo-400" />
            <span>Shortcuts: W (Step) &bull; Space (Auto) &bull; A/D (Turn)</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Left: 2D Grid Canvas */}
        <div className="flex-1 h-[50vh] lg:h-full relative">
          <GridCanvas
            currentX={gridState.currentX}
            currentY={gridState.currentY}
            isStationary={aiMetrics.isStationary}
            onReset={() => gridEngine.resetGrid()}
          />
        </div>

        {/* Right Sidebar: Telemetry, Waveforms & Controls */}
        <div className="w-full lg:w-96 lg:max-w-md h-[50vh] lg:h-full bg-slate-950 border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col gap-2.5 p-2.5 overflow-y-auto z-10">
          <TelemetryBar
            metrics={gridState.navigationMetrics}
            aiMetrics={aiMetrics}
            headingData={gridState.headingData}
          />

          <SensorGraphs
            pitch={gridState.headingData.pitch}
            roll={gridState.headingData.roll}
            heading={gridState.headingData.heading}
            motionEventCount={sensorStatus.motionEventCount}
            hasHardwareMotion={sensorStatus.hasHardwareMotion}
          />

          <ControlBar
            isSimulating={sensorStatus.isSimulating}
            permissionGranted={sensorStatus.permissionGranted}
            currentHeading={gridState.headingData.heading}
            activeModelMode={modelMode}
            onSelectModelMode={(m) => {
              setModelMode(m);
              aiInertialEngine.setModelMode(m);
            }}
            isTiltCompensationEnabled={aiMetrics.isTiltCompensationEnabled}
            onToggleTiltCompensation={() =>
              aiInertialEngine.setTiltCompensation(!aiMetrics.isTiltCompensationEnabled)
            }
            restThreshold={aiMetrics.restThreshold}
            onSetRestThreshold={(val) => aiInertialEngine.setRestThreshold(val)}
            onInjectSample={handleInjectSample}
            onToggleSimulator={toggleSimulator}
            onRequestPermissions={requestSensorPermissions}
            onSetHeading={(h) => gridEngine.setManualHeading(h)}
            onResetGrid={() => gridEngine.resetGrid()}
          />
        </div>
      </div>
    </div>
  );
};

export default App;
