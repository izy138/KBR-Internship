import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "../../utils/cn";
import {
  CHART_TOOLTIP_ROUNDED_STYLE,
  CLS_CHART_CURSOR_TOOLTIP,
  CLS_DASHBOARD_PANEL_HEADER,
  CLS_DASHBOARD_PANEL_SHELL,
  CLS_RECHARTS_FOCUS_RESET,
  RECHARTS_TOOLTIP_CONTENT_STYLE,
  RECHARTS_TOOLTIP_ESCAPE_VIEWBOX,
  RECHARTS_TOOLTIP_WRAPPER_STYLE,
} from "../../utils/chartStyles";
import type { TooltipContentProps } from "recharts/types/component/Tooltip";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { YearDataPoint } from "../../api";
import { buildNumericAxisDomain } from "../../utils/chartAxis";
import { formatDollarsCompact } from "../../utils/format";

type LineDotProps = {
  cx?: number;
  cy?: number;
  payload?: YearDataPoint;
};

type ValueAxisTickProps = {
  x?: number | string;
  y?: number | string;
  payload?: { value?: number };
  textAnchor?: "start" | "end" | "middle" | "inherit";
};

const MIN_Y_AXIS_TICK_DY = -10;

function isDomainMinTick(tickValue: number, domainMin: number): boolean {
  if (!Number.isFinite(tickValue) || !Number.isFinite(domainMin)) {
    return false;
  }
  const tolerance = Math.max(Math.abs(domainMin) * 1e-9, 0.5);
  return Math.abs(tickValue - domainMin) <= tolerance;
}

function createValueAxisTick(
  domainMin: number,
  fontSize: number,
  format: (value: number) => string,
  textAnchor: "start" | "end" | "middle",
) {
  return function ValueAxisTick(tickProps: ValueAxisTickProps) {
    const value = Number(tickProps.payload?.value);
    const label = Number.isFinite(value) ? format(value) : "";
    const resolvedAnchor =
      tickProps.textAnchor === "inherit" ? textAnchor : (tickProps.textAnchor ?? textAnchor);
    return (
      <text
        x={tickProps.x}
        y={tickProps.y}
        dy={isDomainMinTick(value, domainMin) ? MIN_Y_AXIS_TICK_DY : 0}
        textAnchor={resolvedAnchor}
        fill="var(--text-secondary)"
        fontSize={fontSize}
      >
        {label}
      </text>
    );
  };
}

interface LineChartPanelProps {
  title: string;
  data: YearDataPoint[];
  /** Optional formatter for the funding axis/tooltip values */
  formatter?: (value: number) => string;
  height?: number;
  /** When true, chart height follows the panel's flex area (ResizeObserver). */
  fillHeight?: boolean;
  /** Narrower Y axes and legend for tight columns (e.g. IC + activity dashboard row). */
  compactWidth?: boolean;
  /** Extra class on the outer panel wrapper for chart-specific layout/CSS */
  panelClassName?: string;
  chartMargin?: { top?: number; right?: number; bottom?: number; left?: number };
  /** Fired when a fiscal-year point is clicked (navigate to search, etc.). */
  onYearClick?: (point: YearDataPoint) => void;
}

/**
 * Dual-axis line chart showing project count (left axis) and
 * total funding (right axis) over fiscal years.
 */
function makeYearDot(fill: string, onYearClick?: (point: YearDataPoint) => void) {
  if (!onYearClick) {
    return { r: 3, fill, strokeWidth: 0 };
  }
  return ({ cx, cy, payload }: LineDotProps) => {
    if (cx == null || cy == null || payload == null) {
      return null;
    }
    return (
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill={fill}
        strokeWidth={0}
        style={{ cursor: "pointer" }}
        onClick={(event) => {
          event.stopPropagation();
          onYearClick(payload);
        }}
      />
    );
  };
}

export default function LineChartPanel({
  title,
  data,
  formatter,
  height = 300,
  fillHeight = false,
  compactWidth = false,
  panelClassName,
  chartMargin = { top: 12, right: 16, bottom: 4, left: 8 },
  onYearClick,
}: LineChartPanelProps) {
  const chartBodyRef = useRef<HTMLDivElement>(null);
  const [measuredChartHeight, setMeasuredChartHeight] = useState(0);
  const fundingFmt = formatter ?? formatDollarsCompact;

  useEffect(() => {
    if (!fillHeight) {
      setMeasuredChartHeight(0);
      return;
    }
    const chartBody = chartBodyRef.current;
    if (!chartBody) return;

    let rafId = 0;
    let lastHeight = -1;

    const updateHeight = (entries?: ResizeObserverEntry[]): void => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const nextHeight =
          entries?.[0]?.contentRect.height ?? chartBody.getBoundingClientRect().height;
        const rounded = Math.max(Math.round(nextHeight), 0);
        if (Math.abs(rounded - lastHeight) < 1) return;
        lastHeight = rounded;
        setMeasuredChartHeight(rounded);
      });
    };

    updateHeight();
    const observer = new ResizeObserver((entries) => updateHeight(entries));
    observer.observe(chartBody);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [fillHeight, data.length]);

  const { countAxisDomain, fundingAxisDomain } = useMemo(() => {
    let minCount = Number.POSITIVE_INFINITY;
    let maxCount = Number.NEGATIVE_INFINITY;
    let minFunding = Number.POSITIVE_INFINITY;
    let maxFunding = Number.NEGATIVE_INFINITY;

    for (const point of data) {
      minCount = Math.min(minCount, point.count);
      maxCount = Math.max(maxCount, point.count);
      minFunding = Math.min(minFunding, point.total_funding);
      maxFunding = Math.max(maxFunding, point.total_funding);
    }

    if (data.length === 0) {
      return {
        countAxisDomain: [0, 1] as [number, number],
        fundingAxisDomain: [0, 1] as [number, number],
      };
    }

    return {
      countAxisDomain: buildNumericAxisDomain(minCount, maxCount),
      fundingAxisDomain: buildNumericAxisDomain(minFunding, maxFunding),
    };
  }, [data]);

  const renderTooltip = (props: TooltipContentProps<ValueType, NameType>) => {
    if (!props.active || !props.payload?.length) return null;

    return (
      <div className={cn(CLS_CHART_CURSOR_TOOLTIP, "z-10")} style={CHART_TOOLTIP_ROUNDED_STYLE}>
        <div className="text-text-primary font-semibold mb-1 text-[0.82rem]">FY {props.label}</div>
        {props.payload.map((entry) => {
          const rawValue = entry.value;
          const numericValue = typeof rawValue === "number" ? rawValue : Number(rawValue);
          const displayValue =
            entry.dataKey === "total_funding"
              ? fundingFmt(numericValue)
              : numericValue.toLocaleString();

          return (
            <div key={entry.dataKey as string} className="text-text-secondary" style={{ color: entry.color }}>
              {entry.name}: {displayValue}
            </div>
          );
        })}
      </div>
    );
  };

  const chartHeight = fillHeight ? Math.max(measuredChartHeight, 1) : height;
  const yAxisFontSize = compactWidth ? 11 : 13;
  const leftAxisTick = createValueAxisTick(
    countAxisDomain[0],
    yAxisFontSize,
    (value) => value.toLocaleString(),
    "end",
  );
  const rightAxisTick = createValueAxisTick(
    fundingAxisDomain[0],
    yAxisFontSize,
    fundingFmt,
    "start",
  );

  const panelClass = cn(
    CLS_DASHBOARD_PANEL_SHELL,
    "min-h-[310px]",
    fillHeight ? "flex h-full min-h-0 flex-col overflow-visible pb-0" : "pb-[0.9rem]",
    CLS_RECHARTS_FOCUS_RESET,
    panelClassName,
  );

  const lineChart = (
    <LineChart data={data} margin={chartMargin}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="year"
              tick={{ fontSize: 13, fill: "var(--text-secondary)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="left"
              width={compactWidth ? 44 : undefined}
              domain={countAxisDomain}
              allowDataOverflow
              tick={leftAxisTick}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              width={compactWidth ? 54 : undefined}
              domain={fundingAxisDomain}
              allowDataOverflow
              tick={rightAxisTick}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={renderTooltip}
              contentStyle={RECHARTS_TOOLTIP_CONTENT_STYLE}
              wrapperStyle={RECHARTS_TOOLTIP_WRAPPER_STYLE}
              allowEscapeViewBox={RECHARTS_TOOLTIP_ESCAPE_VIEWBOX}
            />
            <Legend
              wrapperStyle={{
                fontSize: compactWidth ? 11 : 13,
                color: "var(--text-secondary)",
                paddingTop: compactWidth ? 0 : undefined,
              }}
            />
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="count"
              name="Projects"
              stroke="#1a56db"
              strokeWidth={2}
              dot={makeYearDot("#1a56db", onYearClick)}
              activeDot={onYearClick ? false : { r: 5, strokeWidth: 0 }}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="total_funding"
              name="Total Funding"
              stroke="#0e9f6e"
              strokeWidth={2}
              dot={makeYearDot("#0e9f6e", onYearClick)}
              activeDot={onYearClick ? false : { r: 5, strokeWidth: 0 }}
            />
          </LineChart>
  );

  return (
    <div className={panelClass}>
      <div className={CLS_DASHBOARD_PANEL_HEADER}>{title}</div>
      <div
        ref={chartBodyRef}
        className={cn(
          "w-full",
          CLS_RECHARTS_FOCUS_RESET,
          onYearClick && "[&_.recharts-layer]:cursor-pointer",
          fillHeight && "relative min-h-0 flex-1 overflow-visible",
        )}
      >
        {(!fillHeight || chartHeight > 0) &&
          (fillHeight ? (
            <div className="absolute inset-0 min-h-0 overflow-visible">
              <ResponsiveContainer width="100%" height="100%">
                {lineChart}
              </ResponsiveContainer>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={chartHeight}>
              {lineChart}
            </ResponsiveContainer>
          ))}
      </div>
    </div>
  );
}
