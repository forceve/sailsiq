import { useCallback, useRef, type PointerEvent } from 'react';
import { useTheme } from '@/theme/ThemeContext';

function clampDeg(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(360, Math.round(n)));
}

function degFromClient(clientX: number, clientY: number, rect: DOMRect): number {
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = clientX - cx;
  const dy = clientY - cy;
  let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return clampDeg(deg);
}

export interface WindDirectionDialProps {
  value: number;
  onChange: (deg: number) => void;
  size?: number;
  className?: string;
}

/**
 * Meteorological wind direction: 0° = from North, clockwise (TWD).
 * Drag the handle or click on the ring to set direction; pairs with a numeric field.
 */
export function WindDirectionDial({ value, onChange, size = 132, className = '' }: WindDirectionDialProps) {
  const { s } = useTheme();
  const svgRef = useRef<SVGSVGElement>(null);
  const draggingRef = useRef(false);

  const applyPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = svgRef.current;
      if (!el) return;
      onChange(degFromClient(clientX, clientY, el.getBoundingClientRect()));
    },
    [onChange],
  );

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    applyPointer(e.clientX, e.clientY);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!draggingRef.current) return;
    applyPointer(e.clientX, e.clientY);
  };

  const onPointerUp = (e: PointerEvent<SVGSVGElement>) => {
    draggingRef.current = false;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* noop */
    }
  };

  const vb = 100;
  const c = vb / 2;
  const rOuter = 42;
  const rTick = 38;
  const rLabel = 48;

  const ticks = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    const x1 = c + Math.cos(rad) * (rTick - 4);
    const y1 = c + Math.sin(rad) * (rTick - 4);
    const x2 = c + Math.cos(rad) * rTick;
    const y2 = c + Math.sin(rad) * rTick;
    return (
      <line
        key={deg}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="currentColor"
        strokeWidth={deg % 90 === 0 ? 2 : 1}
        opacity={deg % 90 === 0 ? 0.55 : 0.35}
      />
    );
  });

  const cardinals = [
    { label: 'N', deg: 0 },
    { label: 'E', deg: 90 },
    { label: 'S', deg: 180 },
    { label: 'W', deg: 270 },
  ].map(({ label, deg }) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    const x = c + Math.cos(rad) * rLabel;
    const y = c + Math.sin(rad) * rLabel;
    return (
      <text
        key={label}
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="central"
        className={`text-[11px] font-semibold ${s.textSecondary}`}
        fill="currentColor"
      >
        {label}
      </text>
    );
  });

  const safe = clampDeg(value);

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={`0 0 ${vb} ${vb}`}
      className={`touch-none select-none cursor-grab active:cursor-grabbing ${className}`}
      style={{ color: 'inherit' }}
      role="slider"
      aria-label="Wind direction"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={safe}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <circle
        cx={c}
        cy={c}
        r={rOuter}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className={s.textSecondary}
        opacity={0.45}
      />
      {ticks}
      {cardinals}
      <g transform={`rotate(${safe} ${c} ${c})`}>
        <line
          x1={c}
          y1={c}
          x2={c}
          y2={c - rTick + 2}
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          className={s.accent}
        />
        <circle cx={c} cy={c - rTick + 2} r={5} fill="currentColor" className={s.accent} />
      </g>
      <circle cx={c} cy={c} r={4} fill="currentColor" className={s.textPrimary} opacity={0.85} />
    </svg>
  );
}
