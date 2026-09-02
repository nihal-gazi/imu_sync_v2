import React from 'react';
import type { NavigationMetrics, AIInferenceMetrics, HeadingData } from '../types';
import { Gauge, MapPin, Compass, Cpu } from 'lucide-react';

interface TelemetryBarProps {
  metrics: NavigationMetrics;
  aiMetrics: AIInferenceMetrics;
  headingData: HeadingData;
}

export const TelemetryBar: React.FC<TelemetryBarProps> = ({
  metrics,
  aiMetrics,
  headingData,
}) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 p-3 bg-slate-900 border border-slate-800 rounded-xl shadow-xl font-mono text-slate-100">
      {/* Metric 1: 2D Grid Position (X, Y) */}
      <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-lg flex flex-col justify-between">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <MapPin className="w-3.5 h-3.5 text-sky-400" />
          <span className="uppercase font-semibold">2D Position (X, Y)</span>
        </div>
        <div className="text-base font-bold text-slate-100 truncate mt-1">
          X: <span className="text-sky-400">{metrics.currentX >= 0 ? `+${metrics.currentX.toFixed(2)}` : metrics.currentX.toFixed(2)}m</span>
        </div>
        <div className="text-xs text-slate-300 truncate">
          Y: <span className="text-sky-400">{metrics.currentY >= 0 ? `+${metrics.currentY.toFixed(2)}` : metrics.currentY.toFixed(2)}m</span>
        </div>
      </div>

      {/* Metric 2: Heading & Compass */}
      <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-lg flex flex-col justify-between">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Compass className="w-3.5 h-3.5 text-indigo-400" />
          <span className="uppercase font-semibold">Heading Angle</span>
        </div>
        <div className="flex items-baseline gap-2 mt-1">
          <span className="text-lg font-bold text-indigo-300">{Math.round(headingData.heading)}°</span>
          <span className="text-[10px] text-slate-500 uppercase truncate">SRC: {headingData.source}</span>
        </div>
        <div className="text-[10px] text-slate-400 truncate flex items-center justify-between">
          <span>Pitch: {headingData.pitch.toFixed(0)}° | Roll: {headingData.roll.toFixed(0)}°</span>
          <span className={`text-[9px] px-1 rounded font-bold ${
            aiMetrics.isTiltCompensationEnabled ? 'text-sky-400 bg-sky-950/60 border border-sky-800/60' : 'text-slate-500'
          }`}>
            TILT {aiMetrics.isTiltCompensationEnabled ? 'ON' : 'OFF'}
          </span>
        </div>
      </div>

      {/* Metric 3: Speed & Total Distance */}
      <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-lg flex flex-col justify-between">
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Gauge className="w-3.5 h-3.5 text-emerald-400" />
          <span className="uppercase font-semibold">Speed & Distance</span>
        </div>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="text-lg font-bold text-emerald-400">{metrics.currentSpeedKmh.toFixed(1)}</span>
          <span className="text-xs text-slate-400">km/h</span>
        </div>
        <div className="text-[11px] text-slate-300 truncate">
          Dist: <span className="text-emerald-300 font-bold">{metrics.totalDistanceMeters.toFixed(1)} m</span>
        </div>
      </div>

      {/* Metric 4: Neural Engine Status & Latency */}
      <div className="p-2.5 bg-slate-950/70 border border-slate-800 rounded-lg flex flex-col justify-between">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Cpu className="w-3.5 h-3.5 text-amber-400" />
            <span className="uppercase font-semibold">Edge AI (ONNX)</span>
          </div>
          <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold ${
            aiMetrics.isStationary
              ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
              : 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
          }`}>
            {aiMetrics.isStationary ? 'ZUPT LOCK' : 'MOVING'}
          </span>
        </div>
        <div className="flex items-baseline justify-between mt-1">
          <span className="text-xs text-slate-300 uppercase font-semibold text-amber-400">
            {aiMetrics.activeMode} ({aiMetrics.executionProvider})
          </span>
          <span className="text-[10px] text-slate-400">
            {aiMetrics.lastLatencyMs.toFixed(1)} ms
          </span>
        </div>
        <div className="text-[10px] text-slate-500 truncate flex items-center justify-between">
          <span>Var: <strong className="text-slate-300">{aiMetrics.motionVariance.toFixed(3)}</strong> / {aiMetrics.restThreshold.toFixed(2)}</span>
          {aiMetrics.activeMode === 'TCN' ? (
            <span className="text-fuchsia-400 font-semibold">
              TCN: {aiMetrics.tcnForwardSpeedMps.toFixed(1)}m/s (Z:{(aiMetrics.tcnZuptProbability * 100).toFixed(0)}%)
            </span>
          ) : aiMetrics.activeMode === 'SIH-Rect' ? (
            <span className="text-indigo-400 font-semibold">
              Drift: {aiMetrics.residualCorrectionMeters >= 0 ? `+${aiMetrics.residualCorrectionMeters.toFixed(2)}` : aiMetrics.residualCorrectionMeters.toFixed(2)}m
            </span>
          ) : aiMetrics.activeMode === 'SIH-Rect-scaled' ? (
            <span className="text-emerald-400 font-semibold">
              Scaled 1/40x
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
};
