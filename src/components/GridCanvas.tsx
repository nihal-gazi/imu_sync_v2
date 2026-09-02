import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { GridPoint } from '../types';
import { Crosshair, Plus, Minus, RotateCcw } from 'lucide-react';

interface GridCanvasProps {
  currentX: number;
  currentY: number;
  heading: number;
  path: GridPoint[];
  isStationary: boolean;
  onReset: () => void;
}

export const GridCanvas: React.FC<GridCanvasProps> = ({
  currentX,
  currentY,
  heading,
  path,
  isStationary,
  onReset,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Viewport transform: pixels per meter & center offset
  const [scale, setScale] = useState<number>(25); // 25 px = 1 meter
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [autoFollow, setAutoFollow] = useState<boolean>(true);

  const isDraggingRef = useRef<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const offsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const scaleRef = useRef<number>(25);

  scaleRef.current = scale;
  offsetRef.current = offset;

  // Auto-follow current position
  useEffect(() => {
    if (autoFollow) {
      setOffset({
        x: -currentX * scale,
        y: currentY * scale, // In canvas, +Y is down, so +North (+Y meters) is -Y in pixels
      });
    }
  }, [currentX, currentY, scale, autoFollow]);

  // Main Render Loop
  const renderGrid = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const dpr = window.devicePixelRatio || 1;

    // Clear background
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, width, height);

    const centerX = width / 2 + offset.x;
    const centerY = height / 2 + offset.y;

    // Grid spacing logic in meters based on zoom scale
    let meterStep = 1;
    if (scale < 10) meterStep = 10;
    else if (scale < 20) meterStep = 5;
    else if (scale < 40) meterStep = 2;
    else meterStep = 1;

    const pxStep = meterStep * scale;

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

    // Y-Axis (North-South line)
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, height);
    ctx.stroke();

    // X-Axis (East-West line)
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // Axis Labels & Coordinate Ticks
    ctx.fillStyle = '#475569';
    ctx.font = `${Math.round(10 * dpr)}px monospace`;

    // Draw meter numbers along axes
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

    // Continuous Trajectory Path Trail
    if (path.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = '#6366f1';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      path.forEach((pt, idx) => {
        const px = centerX + pt.x * scale;
        const py = centerY - pt.y * scale;
        if (idx === 0) {
          ctx.moveTo(px, py);
        } else {
          ctx.lineTo(px, py);
        }
      });
      ctx.stroke();

      // Draw subtle glow
      ctx.strokeStyle = 'rgba(99, 102, 241, 0.25)';
      ctx.lineWidth = 8;
      ctx.stroke();
    }

    // Current Position Cursor & Heading Arrow
    const curPx = centerX + currentX * scale;
    const curPy = centerY - currentY * scale;

    // Heading cone / pointer
    const headingRad = (heading * Math.PI) / 180;
    const pointerLen = 22;
    const tipX = curPx + Math.sin(headingRad) * pointerLen;
    const tipY = curPy - Math.cos(headingRad) * pointerLen;

    const wingAngle1 = headingRad + (145 * Math.PI) / 180;
    const wingAngle2 = headingRad - (145 * Math.PI) / 180;
    const wingLen = 14;

    const wing1X = curPx + Math.sin(wingAngle1) * wingLen;
    const wing1Y = curPy - Math.cos(wingAngle1) * wingLen;
    const wing2X = curPx + Math.sin(wingAngle2) * wingLen;
    const wing2Y = curPy - Math.cos(wingAngle2) * wingLen;

    // Heading Arrow polygon
    ctx.fillStyle = isStationary ? '#38bdf8' : '#818cf8';
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(wing1X, wing1Y);
    ctx.lineTo(curPx, curPy);
    ctx.lineTo(wing2X, wing2Y);
    ctx.closePath();
    ctx.fill();

    // Pulse Ring around current position
    ctx.strokeStyle = isStationary ? 'rgba(56, 189, 248, 0.4)' : 'rgba(129, 140, 248, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(curPx, curPy, 10, 0, Math.PI * 2);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(curPx, curPy, 3, 0, Math.PI * 2);
    ctx.fill();
  }, [currentX, currentY, heading, path, isStationary, offset, scale]);

  // Handle Canvas Resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = parent.clientWidth * dpr;
      canvas.height = parent.clientHeight * dpr;
      renderGrid();
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [renderGrid]);

  useEffect(() => {
    renderGrid();
  }, [renderGrid]);

  // Mouse / Touch Pan & Zoom Handlers
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

    setOffset((prev) => ({
      x: prev.x + dx,
      y: prev.y + dy,
    }));
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
    setOffset({
      x: -currentX * scale,
      y: currentY * scale,
    });
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
          <span>|</span>
          <span>PTS: {path.length}</span>
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
