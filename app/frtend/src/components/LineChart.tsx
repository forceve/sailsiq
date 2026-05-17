import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, X } from 'lucide-react';
import * as echarts from 'echarts/core';
import { LineChart as EChartsLineChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ECharts, EChartsCoreOption } from 'echarts/core';
import { useTheme } from '@/theme/ThemeContext';
import { clamp, formatTimestamp } from '@/utils/formatters';

echarts.use([
  CanvasRenderer,
  DataZoomComponent,
  EChartsLineChart,
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
]);

interface LineChartProps {
  data: number[];
  label: string;
  unit: string;
  color?: string;
  smoothing?: 'none' | 'auto' | number;
  totalLengthSeconds?: number;
  playheadRatio?: number;
  onSeek?: (ratio: number) => void;
  onRangeSelect?: (range: { startRatio: number; endRatio: number } | null) => void;
  selectedRange?: { startRatio: number; endRatio: number } | null;
  height?: number;
  /** Click chart title to open a large analysis view (grid, legend, zoom, raw samples). */
  detailAnalysis?: boolean;
}

interface TelemetryChartProps {
  data: number[];
  label: string;
  unit: string;
  strokeColor: string;
  smoothing: 'none' | 'auto' | number;
  totalLengthSeconds?: number;
  playheadRatio: number;
  onSeek?: (ratio: number) => void;
  onRangeSelect?: (range: { startRatio: number; endRatio: number } | null) => void;
  selectedRange?: { startRatio: number; endRatio: number } | null;
  height: number | string;
  mode: 'inline' | 'detail';
  detailSmoothingOn?: boolean;
  onHoverRatio?: (ratio: number | null) => void;
  textColor: string;
  mutedColor: string;
  gridColor: string;
}

function resolveWindowSize(
  data: number[],
  smoothing: 'none' | 'auto' | number,
  totalLengthSeconds?: number,
): number {
  if (data.length < 3 || smoothing === 'none') return 1;
  if (typeof smoothing === 'number') return Math.max(1, Math.floor(smoothing));

  if (totalLengthSeconds != null && totalLengthSeconds > 0 && data.length > 1) {
    const secondsPerSample = totalLengthSeconds / (data.length - 1);
    const targetWindowSeconds = Math.max(5, Math.min(120, totalLengthSeconds * 0.015));
    const sampleWindow = Math.max(1, Math.round(targetWindowSeconds / secondsPerSample));
    return sampleWindow % 2 === 0 ? sampleWindow + 1 : sampleWindow;
  }

  return Math.min(21, Math.max(1, Math.floor(data.length / 120)) * 2 + 1);
}

function smoothSeries(
  data: number[],
  smoothing: 'none' | 'auto' | number,
  totalLengthSeconds?: number,
): number[] {
  if (data.length < 3 || smoothing === 'none') return data;
  const windowSize = resolveWindowSize(data, smoothing, totalLengthSeconds);
  if (windowSize <= 1) return data;

  const radius = Math.floor(windowSize / 2);
  return data.map((_, index) => {
    let sum = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset++) {
      const value = data[index + offset];
      if (value == null || Number.isNaN(value)) continue;
      sum += value;
      count += 1;
    }
    return count > 0 ? sum / count : data[index] ?? 0;
  });
}

function getTimeMax(dataLength: number, totalLengthSeconds?: number): number {
  if (totalLengthSeconds != null && totalLengthSeconds > 0) return totalLengthSeconds;
  return Math.max(1, dataLength - 1);
}

function ratioToX(ratio: number, xMax: number): number {
  return clamp(ratio, 0, 1) * xMax;
}

function xToRatio(x: number, xMax: number): number {
  if (xMax <= 0) return 0;
  return clamp(x / xMax, 0, 1);
}

function valueAtRatio(data: number[], ratio: number): number {
  if (data.length === 0) return 0;
  return data[Math.round(clamp(ratio, 0, 1) * (data.length - 1))] ?? 0;
}

function formatXLabel(x: number, totalLengthSeconds?: number): string {
  if (totalLengthSeconds != null && totalLengthSeconds > 0) {
    return formatTimestamp(x * 1000);
  }
  return `${Math.round(x)}`;
}

function shouldUseInlinePlayheadWindow(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return normalized === 'speed' || normalized === 'sog' || normalized === 'turn rate';
}

function resolveInlineWindow(
  label: string,
  mode: 'inline' | 'detail',
  playheadRatio: number,
  xMax: number,
): { min: number; max: number } {
  if (mode !== 'inline' || !shouldUseInlinePlayheadWindow(label) || xMax <= 20) {
    return { min: 0, max: xMax };
  }

  const center = ratioToX(playheadRatio, xMax);
  return { min: center - 60, max: center + 60 };
}

function valuesInVisibleWindow(
  chartData: Array<[number, number]>,
  visibleWindow: { min: number; max: number },
): number[] {
  const values = chartData
    .filter(([x]) => x >= visibleWindow.min && x <= visibleWindow.max)
    .map(([, value]) => value)
    .filter((value) => Number.isFinite(value));

  return values.length > 0 ? values : chartData.map(([, value]) => value);
}

function getThemeChartColors(themeId: string) {
  if (themeId === 'vintage') {
    return {
      text: '#2c2416',
      muted: '#6b5a45',
      grid: 'rgba(107,90,69,0.24)',
      tooltipBg: 'rgba(244,238,220,0.96)',
      tooltipBorder: 'rgba(139,115,85,0.35)',
    };
  }
  if (themeId === 'nordic' || themeId === 'frost' || themeId === 'neumorph') {
    return {
      text: '#1f2937',
      muted: '#64748b',
      grid: 'rgba(100,116,139,0.24)',
      tooltipBg: 'rgba(255,255,255,0.96)',
      tooltipBorder: 'rgba(148,163,184,0.35)',
    };
  }
  if (themeId === 'cyber') {
    return {
      text: '#4ade80',
      muted: '#15803d',
      grid: 'rgba(34,197,94,0.22)',
      tooltipBg: 'rgba(0,0,0,0.92)',
      tooltipBorder: 'rgba(34,197,94,0.45)',
    };
  }
  return {
    text: '#e0f2fe',
    muted: '#67e8f9',
    grid: 'rgba(148,163,184,0.22)',
    tooltipBg: 'rgba(15,23,42,0.94)',
    tooltipBorder: 'rgba(255,255,255,0.14)',
  };
}

function getPointRatioFromEvent(chart: ECharts, event: { offsetX: number; offsetY: number }, xMax: number): number {
  const converted = chart.convertFromPixel({ gridIndex: 0 }, [event.offsetX, event.offsetY]);
  if (!Array.isArray(converted)) return 0;
  const x = Number(converted[0]);
  if (!Number.isFinite(x)) return 0;
  return xToRatio(x, xMax);
}

function buildChartOption({
  data,
  label,
  unit,
  strokeColor,
  smoothing,
  totalLengthSeconds,
  playheadRatio,
  selectedRange,
  mode,
  detailSmoothingOn,
  textColor,
  mutedColor,
  gridColor,
}: Omit<TelemetryChartProps, 'height' | 'onSeek' | 'onRangeSelect' | 'onHoverRatio'>): EChartsCoreOption {
  const useSmoothedData = mode === 'inline' || detailSmoothingOn;
  const displayData = useSmoothedData ? smoothSeries(data, smoothing, totalLengthSeconds) : data;
  const xMax = getTimeMax(displayData.length, totalLengthSeconds);
  const chartData: Array<[number, number]> = displayData.map((value, index) => {
    const x = displayData.length > 1 ? (index / (displayData.length - 1)) * xMax : 0;
    return [x, value];
  });
  const visibleWindow = resolveInlineWindow(label, mode, playheadRatio, xMax);
  const values =
    displayData.length > 0 ? valuesInVisibleWindow(chartData, visibleWindow) : [0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const range = max - min || 1;
  const yMin = min - range * 0.08;
  const yMax = max + range * 0.08;
  const activeRange = selectedRange
    ? [
        [
          { xAxis: ratioToX(selectedRange.startRatio, xMax) },
          { xAxis: ratioToX(selectedRange.endRatio, xMax) },
        ],
      ]
    : [];

  const commonSeries = {
    type: 'line',
    name: label,
    data: chartData,
    smooth: 0.18,
    sampling: undefined,
    showSymbol: false,
    symbol: 'circle',
    symbolSize: 5,
    lineStyle: {
      color: strokeColor,
      width: mode === 'detail' ? 2.25 : 2,
      shadowBlur: mode === 'detail' ? 0 : 8,
      shadowColor: `${strokeColor}66`,
    },
    emphasis: {
      focus: 'series',
      lineStyle: { width: mode === 'detail' ? 3 : 2.5 },
    },
    markArea: activeRange.length
      ? {
          silent: true,
          itemStyle: {
            color: strokeColor,
            opacity: mode === 'detail' ? 0.11 : 0.14,
          },
          data: activeRange,
        }
      : undefined,
    markLine: {
      silent: true,
      symbol: 'none',
      animation: false,
      label: { show: false },
      data:
        mode === 'detail'
          ? [
              {
                xAxis: ratioToX(playheadRatio, xMax),
                lineStyle: {
                  color: strokeColor,
                  width: 1.25,
                  type: 'dashed',
                  opacity: 0.88,
                },
              },
              {
                yAxis: mean,
                lineStyle: {
                  color: strokeColor,
                  width: 1,
                  type: 'dashed',
                  opacity: 0.45,
                },
              },
            ]
          : [
              {
                xAxis: ratioToX(playheadRatio, xMax),
                lineStyle: {
                  color: strokeColor,
                  width: 1,
                  type: 'dashed',
                  opacity: 0.72,
                },
              },
            ],
    },
  };

  return {
    animation: false,
    backgroundColor: 'transparent',
    grid:
      mode === 'detail'
        ? { left: 56, right: 24, top: 28, bottom: 56, containLabel: false }
        : { left: 0, right: 0, top: 4, bottom: 2, containLabel: false },
    xAxis: {
      type: 'value',
      min: visibleWindow.min,
      max: visibleWindow.max,
      boundaryGap: false,
      axisLine: { show: mode === 'detail', lineStyle: { color: gridColor } },
      axisTick: { show: mode === 'detail', lineStyle: { color: gridColor } },
      axisLabel: {
        show: mode === 'detail',
        color: mutedColor,
        formatter: (value: number) => formatXLabel(value, totalLengthSeconds),
      },
      splitLine: {
        show: mode === 'detail',
        lineStyle: { color: gridColor, type: 'dashed' },
      },
    },
    yAxis: {
      type: 'value',
      min: yMin,
      max: yMax,
      scale: true,
      axisLine: { show: mode === 'detail', lineStyle: { color: gridColor } },
      axisTick: { show: mode === 'detail', lineStyle: { color: gridColor } },
      axisLabel: {
        show: mode === 'detail',
        color: mutedColor,
        formatter: (value: number) => value.toFixed(Math.abs(value) < 10 ? 1 : 0),
      },
      splitLine: {
        show: mode === 'detail',
        lineStyle: { color: gridColor },
      },
    },
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: mode === 'detail' ? 'rgba(15,23,42,0.94)' : 'rgba(0,0,0,0.82)',
      borderColor: 'rgba(255,255,255,0.12)',
      textStyle: { color: '#fff', fontSize: 12 },
      axisPointer: {
        type: 'line',
        lineStyle: { color: strokeColor, type: 'dashed', opacity: 0.55 },
      },
      formatter: (params: unknown) => {
        const rows = Array.isArray(params) ? params : [params];
        const first = rows[0] as { value?: [number, number] } | undefined;
        const value = first?.value;
        if (!Array.isArray(value)) return '';
        return [
          `<div style="font-weight:600;margin-bottom:2px">${label}</div>`,
          `<div>${formatXLabel(value[0], totalLengthSeconds)}</div>`,
          `<div>${Number(value[1]).toFixed(2)} ${unit}</div>`,
        ].join('');
      },
    },
    dataZoom:
      mode === 'detail'
        ? [
            {
              type: 'inside',
              xAxisIndex: 0,
              filterMode: 'none',
              zoomOnMouseWheel: true,
              moveOnMouseMove: false,
              moveOnMouseWheel: true,
              preventDefaultMouseMove: false,
            },
            {
              type: 'slider',
              xAxisIndex: 0,
              filterMode: 'none',
              bottom: 14,
              height: 18,
              borderColor: gridColor,
              fillerColor: `${strokeColor}24`,
              handleStyle: { color: strokeColor },
              moveHandleStyle: { color: strokeColor },
              dataBackground: {
                lineStyle: { color: strokeColor },
                areaStyle: { color: `${strokeColor}1f` },
              },
              textStyle: { color: mutedColor },
            },
          ]
        : undefined,
    series: [commonSeries],
    aria: {
      enabled: true,
      decal: { show: false },
      label: {
        description: `${label} telemetry line chart in ${unit}`,
      },
    },
    textStyle: {
      color: textColor,
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    },
  };
}

function TelemetryEChart({
  data,
  label,
  unit,
  strokeColor,
  smoothing,
  totalLengthSeconds,
  playheadRatio,
  onSeek,
  onRangeSelect,
  selectedRange,
  height,
  mode,
  detailSmoothingOn,
  onHoverRatio,
  textColor,
  mutedColor,
  gridColor,
}: TelemetryChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ECharts | null>(null);
  const dragStartRef = useRef<number | null>(null);
  const dragCurrentRef = useRef<number | null>(null);
  const [draftRange, setDraftRange] = useState<{ startRatio: number; endRatio: number } | null>(null);
  const xMax = getTimeMax(data.length, totalLengthSeconds);

  const effectiveRange = draftRange ?? selectedRange ?? null;

  const option = useMemo(
    () =>
      buildChartOption({
        data,
        label,
        unit,
        strokeColor,
        smoothing,
        totalLengthSeconds,
        playheadRatio,
        selectedRange: effectiveRange,
        mode,
        detailSmoothingOn,
        textColor,
        mutedColor,
        gridColor,
      }),
    [
      data,
      detailSmoothingOn,
      effectiveRange,
      gridColor,
      label,
      mode,
      mutedColor,
      playheadRatio,
      smoothing,
      strokeColor,
      textColor,
      totalLengthSeconds,
      unit,
    ],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = echarts.init(el, undefined, { renderer: 'canvas' });
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const zr = chart.getZr();

    const handleMouseMove = (event: { offsetX: number; offsetY: number }) => {
      const ratio = getPointRatioFromEvent(chart, event, xMax);
      onHoverRatio?.(ratio);
      if (dragStartRef.current != null && onRangeSelect) {
        dragCurrentRef.current = ratio;
        setDraftRange({
          startRatio: Math.min(dragStartRef.current, ratio),
          endRatio: Math.max(dragStartRef.current, ratio),
        });
      }
    };

    const handleMouseOut = () => {
      onHoverRatio?.(null);
    };

    const handleMouseDown = (event: { offsetX: number; offsetY: number }) => {
      if (!onRangeSelect) return;
      const ratio = getPointRatioFromEvent(chart, event, xMax);
      dragStartRef.current = ratio;
      dragCurrentRef.current = ratio;
      setDraftRange({ startRatio: ratio, endRatio: ratio });
    };

    const handleMouseUp = (event: { offsetX: number; offsetY: number }) => {
      const ratio = getPointRatioFromEvent(chart, event, xMax);
      if (dragStartRef.current != null && onRangeSelect) {
        const startRatio = Math.min(dragStartRef.current, ratio);
        const endRatio = Math.max(dragStartRef.current, ratio);
        const minRange = mode === 'detail' ? 0.008 : 0.03;
        setDraftRange(null);
        dragStartRef.current = null;
        dragCurrentRef.current = null;
        if (Math.abs(endRatio - startRatio) > minRange) {
          onRangeSelect({ startRatio, endRatio });
        } else {
          onSeek?.(ratio);
        }
        return;
      }
      onSeek?.(ratio);
    };

    const handleDoubleClick = () => {
      onRangeSelect?.(null);
      setDraftRange(null);
    };

    zr.on('mousemove', handleMouseMove);
    zr.on('mouseout', handleMouseOut);
    zr.on('mousedown', handleMouseDown);
    zr.on('mouseup', handleMouseUp);
    zr.on('dblclick', handleDoubleClick);

    return () => {
      zr.off('mousemove', handleMouseMove);
      zr.off('mouseout', handleMouseOut);
      zr.off('mousedown', handleMouseDown);
      zr.off('mouseup', handleMouseUp);
      zr.off('dblclick', handleDoubleClick);
    };
  }, [mode, onHoverRatio, onRangeSelect, onSeek, xMax]);

  return <div ref={containerRef} className="w-full min-w-0" style={{ height }} />;
}

interface LineChartDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: number[];
  label: string;
  unit: string;
  strokeColor: string;
  totalLengthSeconds?: number;
  playheadRatio: number;
  onSeek?: (ratio: number) => void;
  onRangeSelect?: (range: { startRatio: number; endRatio: number } | null) => void;
  selectedRange?: { startRatio: number; endRatio: number } | null;
  textMuted: string;
  textPrimary: string;
  panelClass: string;
  smoothing: 'none' | 'auto' | number;
  textColor: string;
  mutedColor: string;
  gridColor: string;
}

function LineChartDetailModal({
  isOpen,
  onClose,
  data,
  label,
  unit,
  strokeColor,
  totalLengthSeconds,
  playheadRatio,
  onSeek,
  onRangeSelect,
  selectedRange,
  textMuted,
  textPrimary,
  panelClass,
  smoothing,
  textColor,
  mutedColor,
  gridColor,
}: LineChartDetailModalProps) {
  const [detailSmoothingOn, setDetailSmoothingOn] = useState(true);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [chartResetKey, setChartResetKey] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    setDetailSmoothingOn(smoothing !== 'none');
    setHoverRatio(null);
  }, [isOpen, smoothing]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const plotData =
    detailSmoothingOn && smoothing !== 'none'
      ? smoothSeries(data, smoothing, totalLengthSeconds)
      : data;
  const values = plotData.length > 0 ? plotData : [0];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const cursorRatio = hoverRatio ?? playheadRatio;
  const cursorValue = valueAtRatio(plotData, cursorRatio);
  const totalSec = totalLengthSeconds ?? 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={`${panelClass} flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden shadow-2xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            <div className={`mb-1 text-[10px] uppercase tracking-[0.2em] ${textMuted}`}>
              Telemetry detail
            </div>
            <h3 className={`text-lg font-semibold ${textPrimary}`}>
              {label}
              <span className={`ml-2 text-sm font-normal ${textMuted}`}>({unit})</span>
            </h3>
            <p className={`mt-1 text-xs ${textMuted}`}>
              Wheel zooms, slider controls the visible window, drag selects a range, double-click clears range.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-xs ${
                smoothing === 'none' ? 'cursor-not-allowed opacity-50' : 'hover:bg-white/10'
              }`}
            >
              <input
                type="checkbox"
                className="h-3.5 w-3.5 rounded border-white/25 bg-transparent accent-cyan-500"
                checked={detailSmoothingOn && smoothing !== 'none'}
                disabled={smoothing === 'none'}
                onChange={(event) => setDetailSmoothingOn(event.target.checked)}
              />
              <span className={textPrimary}>Smoothing</span>
            </label>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/10"
              onClick={() => {
                setChartResetKey((key) => key + 1);
                setHoverRatio(null);
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset zoom
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-white/10 p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-white/10 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-6 rounded-full" style={{ background: strokeColor }} />
            <span className={`text-sm ${textPrimary}`}>
              {label}{' '}
              <span className={textMuted}>
                ({detailSmoothingOn && smoothing !== 'none' ? 'smoothed' : 'raw'})
              </span>
            </span>
          </div>
          <div className={`text-sm ${textMuted}`}>
            Avg {mean.toFixed(2)} {unit}
          </div>
          <div className={`text-sm ${textMuted}`}>
            Window min {min.toFixed(2)} / max {max.toFixed(2)} {unit}
          </div>
        </div>

        <div className="min-h-0 flex-1 px-3 py-4">
          <TelemetryEChart
            key={chartResetKey}
            data={data}
            label={label}
            unit={unit}
            strokeColor={strokeColor}
            smoothing={smoothing}
            totalLengthSeconds={totalLengthSeconds}
            playheadRatio={playheadRatio}
            onSeek={onSeek}
            onRangeSelect={onRangeSelect}
            selectedRange={selectedRange}
            height="min(58vh, 440px)"
            mode="detail"
            detailSmoothingOn={detailSmoothingOn && smoothing !== 'none'}
            onHoverRatio={setHoverRatio}
            textColor={textColor}
            mutedColor={mutedColor}
            gridColor={gridColor}
          />

          <div className={`mt-2 flex justify-between px-1 text-xs font-mono ${textMuted}`}>
            <span>
              Cursor: {cursorValue.toFixed(3)} {unit}
              {totalSec > 0 ? ` at ${formatTimestamp(cursorRatio * totalSec * 1000)}` : null}
            </span>
            <span>ECharts analysis view</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function LineChart({
  data,
  label,
  unit,
  color,
  smoothing = 'none',
  totalLengthSeconds,
  playheadRatio = 0,
  onSeek,
  onRangeSelect,
  selectedRange,
  height = 80,
  detailAnalysis = false,
}: LineChartProps) {
  const { s, themeId } = useTheme();
  const strokeColor = color || s.chartLineColor;
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const chartColors = useMemo(() => getThemeChartColors(themeId), [themeId]);
  const displayData = useMemo(
    () => smoothSeries(data, smoothing, totalLengthSeconds),
    [data, smoothing, totalLengthSeconds],
  );
  const activeRatio = hoverRatio ?? playheadRatio;
  const activeValue = valueAtRatio(hoverRatio != null ? data : displayData, activeRatio);

  const handleOpenDetail = useCallback(() => {
    setDetailOpen(true);
  }, []);

  return (
    <div className="relative flex min-w-0 flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        {detailAnalysis ? (
          <button
            type="button"
            onClick={handleOpenDetail}
            className={`cursor-pointer text-left text-[10px] ${s.textSecondary} underline-offset-2 hover:underline decoration-dotted`}
            title="Open detail analysis"
          >
            {label}
          </button>
        ) : (
          <span className={`text-[10px] ${s.textSecondary}`}>{label}</span>
        )}
        <span className={`font-mono text-xs ${s.textPrimary}`}>
          {activeValue.toFixed(1)} {unit}
        </span>
      </div>

      <TelemetryEChart
        data={data}
        label={label}
        unit={unit}
        strokeColor={strokeColor}
        smoothing={smoothing}
        totalLengthSeconds={totalLengthSeconds}
        playheadRatio={playheadRatio}
        onSeek={onSeek}
        onRangeSelect={onRangeSelect}
        selectedRange={selectedRange}
        height={height}
        mode="inline"
        onHoverRatio={setHoverRatio}
        textColor={chartColors.text}
        mutedColor={chartColors.muted}
        gridColor={chartColors.grid}
      />

      {detailAnalysis ? (
        <LineChartDetailModal
          isOpen={detailOpen}
          onClose={() => setDetailOpen(false)}
          data={data}
          label={label}
          unit={unit}
          strokeColor={strokeColor}
          totalLengthSeconds={totalLengthSeconds}
          playheadRatio={playheadRatio}
          onSeek={onSeek}
          onRangeSelect={onRangeSelect}
          selectedRange={selectedRange}
          textMuted={s.textSecondary}
          textPrimary={s.textPrimary}
          panelClass={s.panel}
          smoothing={smoothing}
          textColor={chartColors.text}
          mutedColor={chartColors.muted}
          gridColor={chartColors.grid}
        />
      ) : null}
    </div>
  );
}
