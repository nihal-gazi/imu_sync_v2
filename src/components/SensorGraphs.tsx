import React, { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { gridEngine } from '../services/gridOdometryEngine';

interface SensorGraphsProps {
  pitch: number;
  roll: number;
  heading: number;
  motionEventCount: number;
  hasHardwareMotion: boolean;
}

export const SensorGraphs: React.FC<SensorGraphsProps> = ({
  pitch,
  roll,
  heading,
  motionEventCount,
  hasHardwareMotion,
}) => {
  const accelCanvasRef = useRef<HTMLCanvasElement>(null);
  const gyroCanvasRef = useRef<HTMLCanvasElement>(null);
  const [activeTab, setActiveTab] = useState<'BOTH' | 'ACCEL' | 'GYRO'>('BOTH');
  const activeTabRef = useRef<'BOTH' | 'ACCEL' | 'GYRO'>('BOTH');
  activeTabRef.current = activeTab;

  const [displayAccelMag, setDisplayAccelMag] = useState<number>(9.81);
  const [displayGyroYaw, setDisplayGyroYaw] = useState<number>(0);
  const lastValueUpdateRef = useRef<number>(0);

  // 60FPS Dedicated RequestAnimationFrame Render Loop
  // Reads directly from gridEngine buffers without triggering React state updates
  useEffect(() => {
    let animId: number;

    const render = () => {
      const motion = gridEngine.getRecentMotion();
      const tab = activeTabRef.current;
      const n = motion.length;

      // Update text HUD numbers at ~10Hz
      const now = performance.now();
      if (now - lastValueUpdateRef.current > 100 && n > 0) {
        lastValueUpdateRef.current = now;
        const last = motion[n - 1];
        setDisplayAccelMag(last.filteredMagnitude);
        setDisplayGyroYaw(last.gz);
      }

      // 1. Render Accelerometer Canvas
      const aCanvas = accelCanvasRef.current;
      if (aCanvas && (tab === 'BOTH' || tab === 'ACCEL')) {
        const ctx = aCanvas.getContext('2d');
        if (ctx) {
          const w = aCanvas.width;
          const h = aCanvas.height;

          ctx.fillStyle = '#080c14';
          ctx.fillRect(0, 0, w, h);

          // Grid lines
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 1;
          for (let y = 0; y < h; y += 20) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }

          // Scale 0 to 18 m/s^2
          const maxVal = 18.0;
          const getY = (val: number) => h - (Math.max(0, Math.min(maxVal, val)) / maxVal) * (h - 14) - 7;

          // 1G baseline
          const gY = getY(9.81);
          ctx.strokeStyle = 'rgba(71, 85, 105, 0.6)';
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(0, gY);
          ctx.lineTo(w, gY);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#64748b';
          ctx.font = '9px monospace';
          ctx.fillText('1G (9.81 m/s²)', 6, gY - 3);

          if (n > 1) {
            const stepX = w / Math.max(n - 1, 1);

            // Raw Accel
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.3)';
            ctx.lineWidth = 1;
            for (let i = 0; i < n; i++) {
              const x = i * stepX;
              const y = getY(motion[i].rawMagnitude);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Filtered Accel
            ctx.beginPath();
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            for (let i = 0; i < n; i++) {
              const x = i * stepX;
              const y = getY(motion[i].filteredMagnitude);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
        }
      }

      // 2. Render Gyroscope Canvas
      const gCanvas = gyroCanvasRef.current;
      if (gCanvas && (tab === 'BOTH' || tab === 'GYRO')) {
        const ctx = gCanvas.getContext('2d');
        if (ctx) {
          const w = gCanvas.width;
          const h = gCanvas.height;

          ctx.fillStyle = '#080c14';
          ctx.fillRect(0, 0, w, h);

          const midY = h / 2;
          ctx.strokeStyle = '#1e293b';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, midY);
          ctx.lineTo(w, midY);
          ctx.stroke();

          const maxDegS = 60.0;
          const getGyroY = (degS: number) => midY - (Math.max(-maxDegS, Math.min(maxDegS, degS)) / maxDegS) * (midY - 6);

          ctx.fillStyle = '#64748b';
          ctx.font = '8px monospace';
          ctx.fillText('+60°/s', 4, 10);
          ctx.fillText('0°/s', 4, midY - 2);
          ctx.fillText('-60°/s', 4, h - 4);

          if (n > 1) {
            const stepX = w / Math.max(n - 1, 1);

            // Gyro Z (Yaw)
            ctx.beginPath();
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1.8;
            for (let i = 0; i < n; i++) {
              const x = i * stepX;
              const y = getGyroY(motion[i].gz);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Gyro X (Pitch)
            ctx.beginPath();
            ctx.strokeStyle = '#f43f5e';
            ctx.lineWidth = 1.2;
            for (let i = 0; i < n; i++) {
              const x = i * stepX;
              const y = getGyroY(motion[i].gx);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Gyro Y (Roll)
            ctx.beginPath();
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1.2;
            for (let i = 0; i < n; i++) {
              const x = i * stepX;
              const y = getGyroY(motion[i].gy);
              if (i === 0) ctx.moveTo(x, y);
              else ctx.lineTo(x, y);
            }
            ctx.stroke();
          }
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="flex flex-col gap-2 p-3 bg-slate-900 border border-slate-800 rounded-xl shadow-xl">
      {/* Header with View Tabs */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-mono font-bold uppercase text-slate-200">
            6-DOF Sensor Waveforms
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('BOTH')}
            className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
              activeTab === 'BOTH'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            DUAL
          </button>
          <button
            onClick={() => setActiveTab('ACCEL')}
            className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
              activeTab === 'ACCEL'
                ? 'bg-amber-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            ACCEL
          </button>
          <button
            onClick={() => setActiveTab('GYRO')}
            className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
              activeTab === 'GYRO'
                ? 'bg-sky-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            GYRO
          </button>
        </div>
      </div>

      {/* Live Value Tags */}
      <div className="grid grid-cols-4 gap-1.5 text-[11px] font-mono">
        <div className="p-1.5 bg-slate-950/70 border border-slate-800 rounded">
          <div className="text-slate-500 text-[10px]">ACCEL MAG</div>
          <div className="text-amber-400 font-bold">
            {displayAccelMag.toFixed(2)} <span className="text-[9px] font-normal text-slate-400">m/s²</span>
          </div>
        </div>
        <div className="p-1.5 bg-slate-950/70 border border-slate-800 rounded">
          <div className="text-slate-500 text-[10px]">GYRO YAW (Z)</div>
          <div className="text-sky-400 font-bold">
            {displayGyroYaw.toFixed(1)} <span className="text-[9px] font-normal text-slate-400">°/s</span>
          </div>
        </div>
        <div className="p-1.5 bg-slate-950/70 border border-slate-800 rounded">
          <div className="text-slate-500 text-[10px]">ATTITUDE</div>
          <div className="text-slate-300 font-medium truncate">
            P:{pitch.toFixed(0)}° R:{roll.toFixed(0)}°
          </div>
        </div>
        <div className="p-1.5 bg-slate-950/70 border border-slate-800 rounded">
          <div className="text-slate-500 text-[10px]">HEADING</div>
          <div className="text-indigo-400 font-bold">
            {Math.round(heading)}°
          </div>
        </div>
      </div>

      {/* Accelerometer Waveform Canvas */}
      {(activeTab === 'BOTH' || activeTab === 'ACCEL') && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
            <span className="flex items-center gap-1 text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>
              <span>ACCELERATION MAGNITUDE (GAUSSIAN FILTERED)</span>
            </span>
            <span className="text-slate-500">{hasHardwareMotion ? 'HARDWARE IMU' : 'SIMULATED'}</span>
          </div>
          <div className="w-full h-20 bg-slate-950 rounded-lg overflow-hidden border border-slate-800">
            <canvas ref={accelCanvasRef} width={600} height={160} className="w-full h-full block" />
          </div>
        </div>
      )}

      {/* Gyroscope Waveform Canvas */}
      {(activeTab === 'BOTH' || activeTab === 'GYRO') && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-sky-400">
                <span className="w-2 h-2 rounded-full bg-sky-400 inline-block"></span>
                <span>YAW (Z)</span>
              </span>
              <span className="flex items-center gap-1 text-rose-400">
                <span className="w-2 h-2 rounded-full bg-rose-400 inline-block"></span>
                <span>PITCH (X)</span>
              </span>
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
                <span>ROLL (Y)</span>
              </span>
            </div>
            <span className="text-slate-500">{motionEventCount} EVTS</span>
          </div>
          <div className="w-full h-20 bg-slate-950 rounded-lg overflow-hidden border border-slate-800">
            <canvas ref={gyroCanvasRef} width={600} height={160} className="w-full h-full block" />
          </div>
        </div>
      )}
    </div>
  );
};
