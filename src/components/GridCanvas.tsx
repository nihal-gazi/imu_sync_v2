import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Crosshair, Plus, Minus, RotateCcw } from 'lucide-react';
import { gridEngine } from '../services/gridOdometryEngine';

interface GridCanvasProps {
  currentX: number;
  currentY: number;
  isStationary: boolean;
  onReset: () => void;
}

export const GridCanvas: React.FC<GridCanvasProps> = ({
  currentX,
  currentY,
  isStationary,
  onReset,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [scale, setScale] = useState<number>(25); // 25 px = 1 meter
  const [autoFollow, setAutoFollow] = useState<boolean>(true);
  const autoFollowRef = useRef<boolean>(true);
  autoFollowRef.current = autoFollow;

  const isStationaryRef = useRef<boolean>(isStationary);
  isStationaryRef.current = isStationary;

  const scaleRef = useRef<number>(25);
  scaleRef.current = scale;

  const offsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // 60FPS Dedicated Grid Render Loop via requestAnimationFrame
  useEffect(() => {
    let animId: number;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animId = requestAnimationFrame(render);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        animId = requestAnimationFrame(render);
        return;
      }

      const pos = gridEngine.getCurrentPosition();
      const heading = gridEngine.getHeading();
      const path = gridEngine.getPathHistory();
      const curScale = scaleRef.current;

      const width = canvas.width;
      const height = canvas.height;
      const dpr = window.devicePixelRatio || 1;

      // Update auto-follow offset smoothly
      if (autoFollowRef.current) {
        const targetX = -pos.x * curScale;
        const targetY = pos.y * curScale;
        offsetRef.current.x += (targetX - offsetRef.current.x) * 0.15;
        offsetRef.current.y += (targetY - offsetRef.current.y) * 0.15;
      }

      const centerX = width / 2 + offsetRef.current.x;
      const centerY = height / 2 + offsetRef.current.y;

      // Clear background
      ctx.fillStyle = '#030712';
      ctx.fillRect(0, 0, width, height);

      // Grid spacing logic
      let meterStep = 1;
      if (curScale < 10) meterStep = 10;
      else if (curScale < 20) meterStep = 5;
      else if (curScale < 40) meterStep = 2;
      else meterStep = 1;

      const pxStep = meterStep * curScale;

      // Minor Grid Lines
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1;

      const startX = centerX % pxStep;
      for (let x = startX; x < width; x += pxStep) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      const startY = centerY % pxStep;
      for (let y = startY; y < height; y += pxStep) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Major Axes (X and Y passing through origin (0, 0))
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;

      // Y-Axis
      ctx.beginPath();
      ctx.moveTo(centerX, 0);
      ctx.lineTo(centerX, height);
      ctx.stroke();

      // X-Axis
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      // Axis Labels
      ctx.fillStyle = '#475569';
      ctx.font = `${Math.round(10 * dpr)}px monospace`;

      const visibleRangeX = Math.ceil(width / (2 * pxStep)) + 2;
      for (let i = -visibleRangeX; i <= visibleRangeX; i++) {
        if (i === 0) continue;
        const x = centerX + i * pxStep;
        const meterVal = i * meterStep;
        ctx.fillText(`${meterVal > 0 ? '+' : ''}${meterVal}m`, x - 12, centerY + 14);
      }

      const visibleRangeY = Math.ceil(height / (2 * pxStep)) + 2;
      for (let i = -visibleRangeY; i <= visibleRangeY; i++) {
        if (i === 0) continue;
        const y = centerY - i * pxStep;
        const meterVal = i * meterStep;
        ctx.fillText(`${meterVal > 0 ? '+' : ''}${meterVal}m`, centerX + 6, y + 4);
      }

      // Origin Marker (0, 0)
      ctx.fillStyle = '#64748b';
      ctx.beginPath();
      ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText('(0, 0)', centerX + 8, centerY - 8);

      // Trajectory Path Trail (single continuous stroke)
      const pathLen = path.length;
      if (pathLen > 1) {
        ctx.beginPath();
        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        for (let i = 0; i < pathLen; i++) {
          const pt = path[i];
          const px = centerX + pt.x * curScale;
          const py = centerY - pt.y * curScale;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      // Current Position Cursor
      const curPx = centerX + pos.x * curScale;
      const curPy = centerY - pos.y * curScale;

      // Heading Pointer Arrow
      const headingRad = (heading * Math.PI) / 180;
      const pointerLen = 20;
      const tipX = curPx + Math.sin(headingRad) * pointerLen;
      const tipY = curPy - Math.cos(headingRad) * pointerLen;

      const wingAngle1 = headingRad + (145 * Math.PI) / 180;
      const wingAngle2 = headingRad - (145 * Math.PI) / 180;
      const wingLen = 13;

      const wing1X = curPx + Math.sin(wingAngle1) * wingLen;
      const wing1Y = curPy - Math.cos(wingAngle1) * wingLen;
      const wing2X = curPx + Math.sin(wingAngle2) * wingLen;
      const wing2Y = curPy - Math.cos(wingAngle2) * wingLen;

      ctx.fillStyle = isStationaryRef.current ? '#38bdf8' : '#818cf8';
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(wing1X, wing1Y);
      ctx.lineTo(curPx, curPy);
      ctx.lineTo(wing2X, wing2Y);
      ctx.closePath();
      ctx.fill();

      // Pulse Ring
      ctx.strokeStyle = isStationaryRef.current ? 'rgba(56, 189, 248, 0.4)' : 'rgba(129, 140, 248, 0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(curPx, curPy, 9, 0, Math.PI * 2);
      ctx.stroke();

      // Center dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(curPx, curPy, 3, 0, Math.PI * 2);
      ctx.fill();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Handle Resize
  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = parent.clientWidth * dpr;
    canvas.height = parent.clientHeight * dpr;
  }, []);

  useEffect(() => {
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [handleResize]);

  // Mouse / Touch Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    setAutoFollow(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    dragStartRef.current = { x: e.clientX, y: e.clientY };

    offsetRef.current.x += dx;
    offsetRef.current.y += dy;
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    setScale((prev) => Math.max(5, Math.min(150, prev * zoomFactor)));
  };

  const handleCenter = () => {
    setAutoFollow(true);
    const pos = gridEngine.getCurrentPosition();
    offsetRef.current.x = -pos.x * scaleRef.current;
    offsetRef.current.y = pos.y * scaleRef.current;
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-950">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing block"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />

      {/* Top Left Coordinate HUD */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-1 p-2.5 bg-slate-900/90 border border-slate-800 rounded-lg text-xs font-mono shadow-xl backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">POS X:</span>
          <span className="text-indigo-300 font-bold">{currentX >= 0 ? `+${currentX.toFixed(2)}` : currentX.toFixed(2)} m</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-400">POS Y:</span>
          <span className="text-indigo-300 font-bold">{currentY >= 0 ? `+${currentY.toFixed(2)}` : currentY.toFixed(2)} m</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-slate-500 pt-1 border-t border-slate-800">
          <span>SCALE:</span>
          <span>{scale.toFixed(0)} px/m</span>
        </div>
      </div>

      {/* Floating Controls */}
      <div className="absolute top-3 right-3 z-10 flex flex-col gap-2">
        <button
          onClick={handleCenter}
          className={`p-2.5 rounded-lg border shadow-xl backdrop-blur transition-colors ${
            autoFollow
              ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300'
              : 'bg-slate-900/90 border-slate-700 text-slate-300 hover:bg-slate-800'
          }`}
          title="Auto-Follow Center"
        >
          <Crosshair className="w-4 h-4" />
        </button>

        <button
          onClick={() => setScale((s) => Math.min(150, s * 1.25))}
          className="p-2.5 bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-lg shadow-xl backdrop-blur transition-colors"
          title="Zoom In"
        >
          <Plus className="w-4 h-4" />
        </button>

        <button
          onClick={() => setScale((s) => Math.max(5, s * 0.8))}
          className="p-2.5 bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700 rounded-lg shadow-xl backdrop-blur transition-colors"
          title="Zoom Out"
        >
          <Minus className="w-4 h-4" />
        </button>

        <button
          onClick={onReset}
          className="p-2.5 bg-slate-900/90 hover:bg-rose-950 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-700 rounded-lg shadow-xl backdrop-blur transition-colors"
          title="Reset Grid & Path"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom Status Legend */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-3 px-3 py-1.5 bg-slate-900/90 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-400 shadow-xl backdrop-blur">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-indigo-500 rounded-full inline-block"></span>
          <span>Inertial Trajectory</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-slate-600 rounded-full inline-block"></span>
          <span>Origin (0,0)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${isStationary ? 'bg-sky-400' : 'bg-emerald-400'}`}></span>
          <span>{isStationary ? 'ZUPT Locked' : 'Moving'}</span>
        </div>
      </div>
    </div>
  );
};
