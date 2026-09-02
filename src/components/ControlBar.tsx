import {
  Activity,
  Play,
  Square,
  RotateCw,
  RotateCcw,
  Trash2,
  Compass,
  ShieldAlert,
  ShieldCheck,
  Cpu,
  Sparkles,
  Gauge,
  SlidersHorizontal,
  Layers,
} from 'lucide-react';
import type { ModelMode } from '../types';

interface ControlBarProps {
  isSimulating: boolean;
  permissionGranted: boolean;
  currentHeading: number;
  activeModelMode: ModelMode;
  onSelectModelMode: (mode: ModelMode) => void;
  isTiltCompensationEnabled: boolean;
  onToggleTiltCompensation: () => void;
  restThreshold: number;
  onSetRestThreshold: (val: number) => void;
  onInjectSample: (ax?: number, ay?: number, az?: number) => void;
  onToggleSimulator: () => void;
  onRequestPermissions: () => void;
  onSetHeading: (heading: number) => void;
  onResetGrid: () => void;
}

export const ControlBar: React.FC<ControlBarProps> = ({
  isSimulating,
  permissionGranted,
  currentHeading,
  activeModelMode,
  onSelectModelMode,
  isTiltCompensationEnabled,
  onToggleTiltCompensation,
  restThreshold,
  onSetRestThreshold,
  onInjectSample,
  onToggleSimulator,
  onRequestPermissions,
  onSetHeading,
  onResetGrid,
}) => {
  const handleTurn = (delta: number) => {
    const next = (currentHeading + delta + 360) % 360;
    onSetHeading(next);
  };

  return (
    <div className="flex flex-col gap-2.5 p-3 bg-slate-900 border border-slate-800 rounded-xl shadow-xl font-mono text-xs">
      {/* Model Selection Bar */}
      <div className="flex items-center justify-between p-1.5 bg-slate-950 border border-slate-800 rounded-lg">
        <div className="flex items-center gap-1.5 text-slate-400 font-semibold px-1">
          <Cpu className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[11px]">AI ENGINE:</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onSelectModelMode('SIH')}
            className={`px-2 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1 ${
              activeModelMode === 'SIH'
                ? 'bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="SIH Multi-Head Inertial MLP (Monolithic Base)"
          >
            <span>SIH</span>
          </button>
          <button
            onClick={() => onSelectModelMode('SIH-Rect')}
            className={`px-2 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1 ${
              activeModelMode === 'SIH-Rect'
                ? 'bg-indigo-500 text-white shadow-md shadow-indigo-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="SIH-Rect: Transformer 1.0s Residual Drift Rectification"
          >
            <Sparkles className="w-3 h-3" />
            <span>SIH-Rect</span>
          </button>
          <button
            onClick={() => onSelectModelMode('SIH-Rect-scaled')}
            className={`px-2 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1 ${
              activeModelMode === 'SIH-Rect-scaled'
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
            title="SIH-Rect-scaled: 40x Scaled Velocity + High-Threshold ZUPT Rest Gate"
          >
            <Gauge className="w-3 h-3" />
            <span>SIH-Rect-scaled</span>
          </button>
        </div>
      </div>

      {/* Global Controls: 3D Tilt Compensation & Manual REST Threshold Slider */}
      <div className="p-2 bg-slate-950/80 border border-slate-800 rounded-lg flex flex-col gap-2">
        {/* Tilt Compensation Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-slate-300">
            <Layers className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-[11px] font-semibold">GLOBAL 3D TILT COMP:</span>
          </div>
          <button
            onClick={onToggleTiltCompensation}
            className={`px-2.5 py-0.5 rounded text-[10px] font-bold border transition-all ${
              isTiltCompensationEnabled
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 shadow-sm shadow-sky-500/20'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
            title="Dynamically align 3D Gravity to +Z for all models via Rodrigues Rotation"
          >
            {isTiltCompensationEnabled ? 'ACTIVE (RODRIGUES)' : 'DISABLED (RAW)'}
          </button>
        </div>

        {/* Manual REST Threshold Slider */}
        <div className="flex flex-col gap-1 pt-1 border-t border-slate-800/70">
          <div className="flex items-center justify-between text-[11px]">
            <div className="flex items-center gap-1.5 text-slate-300">
              <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-semibold">REST THRESHOLD (ZUPT):</span>
            </div>
            <span className="text-amber-400 font-bold bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/30">
              {restThreshold.toFixed(2)} m²/s⁴
            </span>
          </div>
          
          <input
            type="range"
            min="0.02"
            max="0.50"
            step="0.01"
            value={restThreshold}
            onChange={(e) => onSetRestThreshold(parseFloat(e.target.value))}
            className="w-full accent-amber-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
            title="Adjust physical resting sensitivity threshold"
          />

          <div className="flex items-center justify-between gap-1 text-[9px] text-slate-400 pt-0.5">
            <button
              onClick={() => onSetRestThreshold(0.05)}
              className={`px-1.5 py-0.5 rounded border ${restThreshold <= 0.08 ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'border-slate-800 hover:bg-slate-800'}`}
            >
              Sensitive (0.05)
            </button>
            <button
              onClick={() => onSetRestThreshold(0.15)}
              className={`px-1.5 py-0.5 rounded border ${restThreshold > 0.08 && restThreshold <= 0.22 ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'border-slate-800 hover:bg-slate-800'}`}
            >
              Balanced (0.15)
            </button>
            <button
              onClick={() => onSetRestThreshold(0.30)}
              className={`px-1.5 py-0.5 rounded border ${restThreshold > 0.22 ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'border-slate-800 hover:bg-slate-800'}`}
            >
              Firm (0.30)
            </button>
          </div>
        </div>
      </div>
      {/* Action Buttons Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <button
          onClick={onRequestPermissions}
          className={`px-3 py-2 rounded-lg border font-medium flex items-center justify-center gap-1.5 transition-colors ${
            permissionGranted
              ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300'
              : 'bg-amber-600/20 border-amber-500/40 text-amber-300 hover:bg-amber-600/30'
          }`}
          title="Initialize Mobile IMU Sensors"
        >
          {permissionGranted ? (
            <>
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>SENSORS READY</span>
            </>
          ) : (
            <>
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>INIT SENSORS</span>
            </>
          )}
        </button>

        <button
          onClick={() => onInjectSample(0.6, 2.2, 9.81)}
          className="px-3 py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors"
          title="Inject Single Forward Step"
        >
          <Activity className="w-3.5 h-3.5" />
          <span>INJECT STEP</span>
        </button>

        <button
          onClick={onToggleSimulator}
          className={`px-3 py-2 rounded-lg border font-medium flex items-center justify-center gap-1.5 transition-colors ${
            isSimulating
              ? 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border-rose-500/40'
              : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border-emerald-500/40'
          }`}
          title="Toggle Continuous Motion Stream"
        >
          {isSimulating ? (
            <>
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>STOP STREAM</span>
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>AUTO STREAM</span>
            </>
          )}
        </button>

        <button
          onClick={onResetGrid}
          className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-rose-400 border border-slate-700 rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors"
          title="Reset Grid & Path History"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>RESET PATH</span>
        </button>
      </div>

      {/* Heading / Bearing Controls */}
      <div className="flex flex-col gap-1.5 pt-2 border-t border-slate-800">
        <div className="flex items-center justify-between text-slate-400">
          <div className="flex items-center gap-1">
            <Compass className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-semibold text-slate-300">BEARING ORIENTATION:</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleTurn(-15)}
              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-[10px] flex items-center gap-0.5"
              title="Turn 15° Left"
            >
              <RotateCcw className="w-3 h-3" />
              <span>-15°</span>
            </button>
            <span className="text-indigo-400 font-bold">{Math.round(currentHeading)}°</span>
            <button
              onClick={() => handleTurn(15)}
              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-[10px] flex items-center gap-0.5"
              title="Turn 15° Right"
            >
              <RotateCw className="w-3 h-3" />
              <span>+15°</span>
            </button>
          </div>
        </div>

        <input
          type="range"
          min="0"
          max="359"
          value={Math.round(currentHeading)}
          onChange={(e) => onSetHeading(Number(e.target.value))}
          className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
        />

        <div className="grid grid-cols-4 gap-1 pt-1">
          <button
            onClick={() => onSetHeading(0)}
            className={`py-1 rounded text-[10px] border transition-colors ${
              Math.round(currentHeading) === 0
                ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            NORTH (0°)
          </button>
          <button
            onClick={() => onSetHeading(90)}
            className={`py-1 rounded text-[10px] border transition-colors ${
              Math.round(currentHeading) === 90
                ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            EAST (90°)
          </button>
          <button
            onClick={() => onSetHeading(180)}
            className={`py-1 rounded text-[10px] border transition-colors ${
              Math.round(currentHeading) === 180
                ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            SOUTH (180°)
          </button>
          <button
            onClick={() => onSetHeading(270)}
            className={`py-1 rounded text-[10px] border transition-colors ${
              Math.round(currentHeading) === 270
                ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
            }`}
          >
            WEST (270°)
          </button>
        </div>
      </div>
    </div>
  );
};
