import React, { useEffect, useRef, useState } from 'react';
import type { MotionSample } from '../types';
import { Activity } from 'lucide-react';

interface SensorGraphsProps {
  recentMotion: MotionSample[];
  pitch: number;
  roll: number;
  heading: number;
  motionEventCount: number;
  hasHardwareMotion: boolean;
}

export const SensorGraphs: React.FC<SensorGraphsProps> = ({
  recentMotion,
  pitch,
  roll,
  heading,
  motionEventCount,
  hasHardwareMotion,
}) => {
  const accelCanvasRef = useRef<HTMLCanvasElement>(null);
  const gyroCanvasRef = useRef<HTMLCanvasElement>(null);
  const [activeTab, setActiveTab] = useState<'BOTH' | 'ACCEL' | 'GYRO'>('BOTH');

  // Draw Accelerometer Waveform
  useEffect(() => {
    const canvas = accelCanvasRef.current;
    if (!canvas || activeTab === 'GYRO') return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear
    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let y = 0; y < height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Scale: 0 to 18 m/s^2 (covering 1G resting ~9.81 m/s^2)
    const maxVal = 18.0;
    const getY = (val: number) => {
      const clamped = Math.max(0, Math.min(maxVal, val));
      return height - (clamped / maxVal) * (height - 14) - 7;
    };

    // 1G Gravity Baseline (9.81 m/s^2)
    const gY = getY(9.81);
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.6)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, gY);
    ctx.lineTo(width, gY);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#64748b';
    ctx.font = '9px monospace';
    ctx.fillText('1G (9.81 m/s²)', 6, gY - 3);

    if (recentMotion.length < 2) return;

    const stepX = width / Math.max(recentMotion.length - 1, 1);

    // 1. Raw Acceleration (Faint Amber)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
    ctx.lineWidth = 1;
    recentMotion.forEach((sample, i) => {
      const x = i * stepX;
      const y = getY(sample.rawMagnitude);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 2. Gaussian Smoothed Acceleration (Vibrant Amber)
    ctx.beginPath();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    recentMotion.forEach((sample, i) => {
      const x = i * stepX;
      const y = getY(sample.filteredMagnitude);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [recentMotion, activeTab]);

  // Draw Gyroscope 3-Axis Waveform
  useEffect(() => {
    const canvas = gyroCanvasRef.current;
    if (!canvas || activeTab === 'ACCEL') return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear
    ctx.fillStyle = '#080c14';
    ctx.fillRect(0, 0, width, height);

    // Center Zero Line
    const midY = height / 2;
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    const maxDegS = 60.0;
    const getGyroY = (degS: number) => {
      const clamped = Math.max(-maxDegS, Math.min(maxDegS, degS));
      return midY - (clamped / maxDegS) * (midY - 6);
    };

    ctx.fillStyle = '#64748b';
    ctx.font = '8px monospace';
    ctx.fillText('+60°/s', 4, 10);
    ctx.fillText('0°/s', 4, midY - 2);
    ctx.fillText('-60°/s', 4, height - 4);

    if (recentMotion.length < 2) return;

    const stepX = width / Math.max(recentMotion.length - 1, 1);

    // Draw Gyro Z (Yaw - Cyan)
    ctx.beginPath();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.8;
    recentMotion.forEach((sample, i) => {
      const x = i * stepX;
      const y = getGyroY(sample.gz);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw Gyro X (Pitch - Rose)
    ctx.beginPath();
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 1.2;
    recentMotion.forEach((sample, i) => {
      const x = i * stepX;
      const y = getGyroY(sample.gx);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw Gyro Y (Roll - Emerald)
    ctx.beginPath();
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1.2;
    recentMotion.forEach((sample, i) => {
      const x = i * stepX;
      const y = getGyroY(sample.gy);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [recentMotion, activeTab]);

  const latestSample = recentMotion[recentMotion.length - 1];

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
            {latestSample ? latestSample.filteredMagnitude.toFixed(2) : '0.00'} <span className="text-[9px] font-normal text-slate-400">m/s²</span>
          </div>
        </div>
        <div className="p-1.5 bg-slate-950/70 border border-slate-800 rounded">
          <div className="text-slate-500 text-[10px]">GYRO YAW (Z)</div>
          <div className="text-sky-400 font-bold">
            {latestSample ? latestSample.gz.toFixed(1) : '0.0'} <span className="text-[9px] font-normal text-slate-400">°/s</span>
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
