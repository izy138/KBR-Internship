import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
} from "recharts";
import type { TooltipContentProps } from "recharts/types/component/Tooltip";
import type { NameType, ValueType } from "recharts/types/component/DefaultTooltipContent";
import type { ActivityFundingPieResponse, ActivityPieSlice } from "../../api";
import { cn } from "../../utils/cn";
import { getActivityCodeTitle } from "../../utils/activityCodeTitles";
import {
  CHART_TOOLTIP_ROUNDED_STYLE,
  CLS_CHART_HOVER_TOOLTIP,
  CLS_DASHBOARD_PANEL_HEADER,
  CLS_DASHBOARD_PANEL_SHELL,
  CLS_RECHARTS_FOCUS_RESET,
  RECHARTS_TOOLTIP_CONTENT_STYLE,
  RECHARTS_TOOLTIP_ESCAPE_VIEWBOX,
  RECHARTS_TOOLTIP_WRAPPER_STYLE,
} from "../../utils/chartStyles";

const DEFAULT_CHART_HEIGHT_PX = 360;

/** Inner ring = largest activity codes; outer = remaining named codes (through ZIF when many codes). */
const INNER_SLICE_MAX_COUNT = 5;
/** Smallest inner wedge must be at least this share of inner-ring funding (else → outer). */
const MIN_INNER_SLICE_SHARE_OF_RING = 0.06;
/** Stop adding inner slices once this share of named funding is covered (after min count). */
const INNER_RING_CUMULATIVE_SHARE_TARGET = 0.88;
const INNER_SLICE_MIN_COUNT = 2;
/** Last activity code shown as its own slice; everything after rolls into Other. */
const LAST_INDIVIDUAL_ACTIVITY_CODE = "ZIF";
/** Max named activity wedges on the outer ring; additional codes go to the tail list. */
const OUTER_SLICE_MAX_COUNT = 7;
/** Below this count, all activity codes stay on the pie (skip post-ZIF tail-only split). */
const MAX_ACTIVITY_CODES_ALL_ON_PIE = INNER_SLICE_MAX_COUNT + OUTER_SLICE_MAX_COUNT;
/** Min share of outer-ring funding for a wedge to remain on the pie (readable label). */
const MIN_OUTER_SLICE_SHARE_OF_RING = 0.045;
/** Min share of indexed funding — matches outer `renderSliceLabel` minPct (1.2%). */
const OUTER_SLICE_MIN_LABEL_PCT_OF_INDEXED = 0.012;
/** Min share of indexed funding — matches inner `renderSliceLabel` minPct (0.8%). */
const INNER_SLICE_MIN_LABEL_PCT_OF_INDEXED = 0.008;
/** Min outer-ring angular size for tiny named codes (chartValue only; label uses true %). */
const MIN_OUTER_NAMED_SLICE_CHART_SHARE = 0.06;
const OTHER_SLICE_COLOR = "#64748b";
/** Cap Other wedge size vs. named slices on the same ring (chart angles only). */
const OTHER_SLICE_MAX_VS_RING = 0.07;
/** Other sits inset in the outer ring so it reads smaller. */
const OTHER_RADIAL_INSET_PX = 13;
/** Inner-disk labels: large slices pull inward; small slices stay toward the outer wedge. */
const INNER_SLICE_LABEL_RADIAL_FACTOR_MAX = 0.75;
const INNER_SLICE_LABEL_RADIAL_FACTOR_MIN = 0.48;
const INNER_SLICE_LABEL_OUTER_PAD_PX = 25;
const INNER_SLICE_LABEL_INNER_PAD_PX = 28;
/** Outer-band labels stay centered in the ring with padding on both edges. */
const OUTER_SLICE_LABEL_RADIAL_FACTOR = 0.5;
const OUTER_SLICE_LABEL_EDGE_PAD_PX = 10;
const INNER_SLICE_LABEL_CODE_FONT_PX = 14;
const INNER_SLICE_LABEL_PCT_FONT_PX = 12;

/**
 * Two stacked `<Pie>` rings — inner (top codes) is a filled disk; outer band holds up to seven
 * named codes plus an optional Other wedge; overflow is in the tail list.
 * Inner ring area > outer ring area so the center reads as the main chart.
 */
const INNER_PIE_INNER_RADIUS_PX = 0;
const INNER_PIE_OUTER_RADIUS_PX = 120;
const OUTER_PIE_INNER_RADIUS_PX = 130;
/** Outer band thickness = 50% more than the previous 34px band (34 × 1.5 ≈ 51). */
const OUTER_PIE_OUTER_RADIUS_PX = 175;

const PIE_HOVER_OUTER_EXPAND_PX = 5;
const PIE_HOVER_STROKE_WIDTH = 2;
const PIE_SLICE_HOVER_TRANSITION = "fill 0.15s ease, stroke 0.15s ease, opacity 0.15s ease";

const PIE_COLORS = [
  "#1a56db",
  "#0e9f6e",
  "#7c3aed",
  "#ea580c",
  "#0891b2",
  "#be123c",
  "#a16207",
  "#4f46e5",
  "#0f766e",
  "#c026d3",
  "#b45309",
  "#0369a1",
];

type PieRow = {
  name: string;
  value: number;
  count: number;
  pct: number;
  /** Label % of indexed funding (recomputed so rings do not double-count). */
  labelPct?: number;
  /** True when chart wedge is enlarged for click/label; label still uses true funding %. */
  emphasizeOnChart?: boolean;
  isOther?: boolean;
  /** Angular size in the pie (may be less than `value` for the Other slice). */
  chartValue: number;
  radialInset: number;
};

interface ActivityFundingPiePanelProps {
  title: string;
  pie: ActivityFundingPieResponse;
  formatDollars: (n: number) => string;
  /** Recharts container height; should match the paired year trend chart on the dashboard. */
  chartHeight?: number;
  /** When true, dims the chart while filtered analytics are refetching. */
  loading?: boolean;
  /** Currently applied activity filter (highlights matching tail list item). */
  selectedActivity?: string;
  /** When set, tail list codes apply that activity as a dashboard filter. */
  onActivitySelect?: (activityCode: string) => void;
  /** Activity code hovered in the filter dropdown (not shown on pie slices). */
  hoveredActivityCode?: string | null;
  /** When true, other codes open in an overlay on the pie instead of a side column. */
  tailListOverlay?: boolean;
}

type ActivityCodeHoverCardProps = {
  code: string;
  formatDollars: (n: number) => string;
  funding?: number;
  projectCount?: number;
  description?: string;
  className?: string;
};

function ActivityCodeHoverCard({
  code,
  formatDollars,
  funding,
  projectCount,
  description,
  className,
}: ActivityCodeHoverCardProps) {
  return (
    <div
      className={cn(
        CLS_CHART_HOVER_TOOLTIP,
        "min-w-0 max-w-[min(20rem,calc(100vw-2rem))] px-[0.62rem] py-[0.48rem] text-[13px] leading-[1.2]",
        className,
      )}
      style={CHART_TOOLTIP_ROUNDED_STYLE}
    >
      <div className="flex flex-wrap items-baseline gap-x-[0.4rem] gap-y-[0.15rem] whitespace-nowrap">
        <span className="font-bold text-text-primary">{code}</span>
        {funding != null ? (
          <>
            <span className="text-text-muted select-none">·</span>
            <span>{formatDollars(funding)}</span>
          </>
        ) : null}
        {projectCount != null ? (
          <>
            <span className="text-text-muted select-none">·</span>
            <span className="text-text-muted">{projectCount.toLocaleString()} projects</span>
          </>
        ) : null}
      </div>
      {description ? (
        <p className="m-0 mt-[0.18rem] text-text-secondary leading-[1.3] whitespace-normal">
          {description}
        </p>
      ) : null}
    </div>
  );
}

type ActivityCodeInChartPreviewProps = {
  code: string;
  formatDollars: (n: number) => string;
  row?: PieRow;
};

type TailCodesPanelProps = {
  tailDetailRows: PieRow[];
  formatDollars: (n: number) => string;
  selectedActivity: string;
  onActivitySelect?: (activityCode: string) => void;
  onTailHoverCode: (code: string | null) => void;
  className?: string;
  id?: string;
  onClose?: () => void;
};

function TailCodesPanel({
  tailDetailRows,
  formatDollars,
  selectedActivity,
  onActivitySelect,
  onTailHoverCode,
  className,
  id,
  onClose,
}: TailCodesPanelProps) {
  const overlayClose = onClose != null;

  return (
    <aside
      id={id}
      className={cn(
        "flex flex-col min-h-0 border border-border-strong rounded-[--radius-md] bg-bg shadow-md",
        overlayClose ? "p-3" : "pl-[0.9rem] pr-1 py-[0.85rem]",
        className,
      )}
      aria-label="Other Activity Codes"
    >
      {overlayClose ? (
        <button
          type="button"
          className="absolute top-3 right-3 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm border-none bg-transparent p-0 text-[22px] leading-none text-text-muted hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          aria-label="Close other activity codes"
          onClick={onClose}
        >
          ×
        </button>
      ) : null}
      <div className={cn("mb-1 shrink-0", overlayClose && "pr-8")}>
        <h4 className="m-0 font-bold leading-[1.25]">Other Activity Codes</h4>
      </div>
      <p className="m-0 mb-[0.35rem] leading-[1] text-text-muted">
        {tailDetailRows.length} codes ·{" "}
        {formatDollars(tailDetailRows.reduce((acc, r) => acc + r.value, 0))}
      </p>
      <ul className="flex-1 min-h-0 m-0 p-0 pr-6 -mr-1 list-none overflow-y-auto [scrollbar-width:thin]">
        {tailDetailRows.map((row) => {
          const isSelected = selectedActivity === row.name;
          const rowInnerClass =
            "flex w-full flex-col gap-0 rounded-md py-1 px-1.5 text-[0.8125rem] leading-[1.05]";
          const rowBody = (
            <>
              <div className="flex items-baseline justify-between gap-[0.35rem] min-w-0">
                <span className="font-bold tracking-[0.02em] shrink-0">{row.name}</span>
                <span className="text-text-secondary text-right whitespace-nowrap">
                  {formatDollars(row.value)}
                </span>
              </div>
              <span className="text-text-muted">{row.count.toLocaleString()} projects</span>
            </>
          );

          const tailHoverHandlers = {
            onMouseEnter: () => onTailHoverCode(row.name),
            onMouseLeave: () => onTailHoverCode(null),
          };

          if (onActivitySelect == null) {
            return (
              <li
                key={row.name}
                className="border-b-2 border-border-strong px-1.5 py-1 last:border-b-0"
                {...tailHoverHandlers}
              >
                <div className={rowInnerClass}>{rowBody}</div>
              </li>
            );
          }

          return (
            <li
              key={row.name}
              className="border-b-2 border-border-strong px-1.5 py-1 last:border-b-0"
              {...tailHoverHandlers}
            >
              <button
                type="button"
                className={cn(
                  rowInnerClass,
                  "appearance-none cursor-pointer border-none bg-transparent text-left font-[inherit] transition-[background,color] duration-150 hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1",
                  isSelected && "bg-accent-light text-accent-text hover:bg-accent-light",
                )}
                aria-pressed={isSelected}
                aria-label={`Filter dashboard by activity code ${row.name}`}
                onClick={() => onActivitySelect(row.name)}
              >
                {rowBody}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function ActivityCodeInChartPreview({ code, formatDollars, row }: ActivityCodeInChartPreviewProps) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-4 pointer-events-none">
      <ActivityCodeHoverCard
        code={code}
        formatDollars={formatDollars}
        funding={row?.value}
        projectCount={row?.count}
        description={getActivityCodeTitle(code)}
        className="max-w-[min(18rem,90%)] text-center bg-surface/95 backdrop-blur-[2px] [&_p]:text-center"
      />
    </div>
  );
}

function rowFromSlice(s: ActivityPieSlice): PieRow {
  return {
    name: s.label,
    value: s.total_funding,
    count: s.count,
    pct: s.percent_of_funding,
    chartValue: s.total_funding,
    radialInset: 0,
  };
}

function buildOtherAggregateRow(tail: PieRow[], totalIndexed: number): PieRow {
  const value = tail.reduce((acc, r) => acc + r.value, 0);
  const count = tail.reduce((acc, r) => acc + r.count, 0);
  const denom = totalIndexed > 0 ? totalIndexed : value || 1;
  return {
    name: `Other (${tail.length} codes)`,
    value,
    count,
    pct: value / denom,
    isOther: true,
    chartValue: value,
    radialInset: OTHER_RADIAL_INSET_PX,
  };
}

function prepareRingRows(rows: PieRow[], ring: "inner" | "outer"): PieRow[] {
  const individuals = rows.filter((r) => !r.isOther);
  const otherIdx = rows.findIndex((r) => r.isOther);
  const individualsTotal = individuals.reduce((acc, row) => acc + row.value, 0);
  const minNamedChartValue =
    ring === "outer" && individuals.length > 0
      ? individualsTotal * MIN_OUTER_NAMED_SLICE_CHART_SHARE
      : 0;

  let chartValueByOther = 0;
  if (otherIdx >= 0 && individuals.length > 0) {
    const largest = Math.max(...individuals.map((r) => r.value));
    const cap = Math.max(
      individualsTotal * OTHER_SLICE_MAX_VS_RING,
      largest * 0.35,
    );
    chartValueByOther = Math.min(rows[otherIdx].value, cap);
  }

  return rows.map((row) => {
    if (row.isOther) {
      return {
        ...row,
        chartValue: otherIdx >= 0 ? chartValueByOther : row.value,
        radialInset: OTHER_RADIAL_INSET_PX,
      };
    }
    const needsEmphasis =
      ring === "outer"
      && minNamedChartValue > 0
      && (row.emphasizeOnChart || row.value < minNamedChartValue);
    const chartValue = needsEmphasis
      ? Math.max(row.value, minNamedChartValue)
      : row.value;
    return {
      ...row,
      chartValue,
      emphasizeOnChart: needsEmphasis || row.emphasizeOnChart,
      radialInset: 0,
    };
  });
}

function sortPieRowsByFunding(rows: PieRow[]): PieRow[] {
  return [...rows].sort((a, b) => {
    const diff = b.value - a.value;
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
}

/**
 * Picks inner-ring slices by funding rank. Small wedges are deferred to the outer ring so
 * labels do not cluster in the center disk.
 */
function pickInnerRingSlices(named: PieRow[]): PieRow[] {
  const sorted = sortPieRowsByFunding(named);
  if (sorted.length === 0) {
    return [];
  }
  if (sorted.length <= INNER_SLICE_MAX_COUNT) {
    return sorted;
  }

  const total = sorted.reduce((acc, r) => acc + r.value, 0);
  const inner: PieRow[] = [];
  let sum = 0;

  for (const row of sorted) {
    if (inner.length >= INNER_SLICE_MAX_COUNT) {
      break;
    }
    if (inner.length >= INNER_SLICE_MIN_COUNT && total > 0) {
      if (sum / total >= INNER_RING_CUMULATIVE_SHARE_TARGET) {
        break;
      }
      const nextSum = sum + row.value;
      if (nextSum > 0 && row.value / nextSum < MIN_INNER_SLICE_SHARE_OF_RING) {
        break;
      }
    }
    inner.push(row);
    sum += row.value;
  }

  return inner;
}

/** Slices too small for ring share or indexed % move to the tail list (labels would not render). */
function deferUndisplayableRingSlices(
  rows: PieRow[],
  minShareOfRing: number,
  minPctOfIndexed: number,
): { kept: PieRow[]; deferred: PieRow[] } {
  if (rows.length === 0) {
    return { kept: [], deferred: [] };
  }
  const ringTotal = rows.reduce((acc, row) => acc + row.value, 0);
  const kept: PieRow[] = [];
  const deferred: PieRow[] = [];
  for (const row of rows) {
    const ringShare = ringTotal > 0 ? row.value / ringTotal : 0;
    if (ringShare < minShareOfRing || row.pct < minPctOfIndexed) {
      deferred.push(row);
    } else {
      kept.push(row);
    }
  }
  return { kept, deferred };
}

function mergeTailDetailRows(outerNamed: PieRow[], ...sources: PieRow[][]): PieRow[] {
  const onPie = new Set(outerNamed.map((row) => row.name));
  const seen = new Set<string>();
  const merged: PieRow[] = [];
  for (const row of sortPieRowsByFunding(sources.flat())) {
    if (onPie.has(row.name) || seen.has(row.name)) {
      continue;
    }
    seen.add(row.name);
    merged.push(row);
  }
  return merged;
}

function rowsWithLabelPct(rows: PieRow[], totalFundingIndexed: number): PieRow[] {
  const denom =
    totalFundingIndexed > 0
      ? totalFundingIndexed
      : rows.reduce((acc, row) => acc + row.value, 0) || 1;
  return rows.map((row) => ({
    ...row,
    labelPct: row.value / denom,
  }));
}

function buildOuterRingAndTail(
  outerCandidates: PieRow[],
  tailDetailRows: PieRow[],
  totalFundingIndexed: number,
): { outerChartData: PieRow[]; tailDetailRows: PieRow[] } {
  const capped = outerCandidates.slice(0, OUTER_SLICE_MAX_COUNT);
  const { kept: outerNamed, deferred: tooSmallForOuter } = deferUndisplayableRingSlices(
    capped,
    MIN_OUTER_SLICE_SHARE_OF_RING,
    OUTER_SLICE_MIN_LABEL_PCT_OF_INDEXED,
  );
  const outerOverflow = [
    ...outerCandidates.slice(OUTER_SLICE_MAX_COUNT),
    ...tooSmallForOuter,
  ];
  const mergedTail = mergeTailDetailRows(outerNamed, outerOverflow, tailDetailRows);

  if (mergedTail.length === 1) {
    const promoted = { ...mergedTail[0], emphasizeOnChart: true };
    return {
      outerChartData: sortPieRowsByFunding([...outerNamed, promoted]),
      tailDetailRows: [],
    };
  }

  const outerChartData =
    mergedTail.length > 0
      ? [...outerNamed, buildOtherAggregateRow(mergedTail, totalFundingIndexed)]
      : outerNamed;
  return { outerChartData, tailDetailRows: mergedTail };
}

type SplitPieRowsResult = {
  innerChartData: PieRow[];
  outerChartData: PieRow[];
  tailDetailRows: PieRow[];
  usesZifCutoff: boolean;
};

function isActivityCodeAfterZif(code: string): boolean {
  return code.localeCompare(LAST_INDIVIDUAL_ACTIVITY_CODE) > 0;
}

function distributeAllActivityCodes(
  ordered: PieRow[],
  totalFundingIndexed: number,
): SplitPieRowsResult {
  const innerPicked = pickInnerRingSlices(ordered);
  const { kept: innerChartData } = deferUndisplayableRingSlices(
    innerPicked,
    MIN_INNER_SLICE_SHARE_OF_RING,
    INNER_SLICE_MIN_LABEL_PCT_OF_INDEXED,
  );
  const keptInnerNames = new Set(innerChartData.map((r) => r.name));
  const outerPool = sortPieRowsByFunding(
    ordered.filter((r) => !keptInnerNames.has(r.name)),
  );
  const { outerChartData, tailDetailRows } = buildOuterRingAndTail(
    outerPool,
    [],
    totalFundingIndexed,
  );
  return { innerChartData, outerChartData, tailDetailRows, usesZifCutoff: false };
}

function splitPieRows(pie: ActivityFundingPieResponse): SplitPieRowsResult {
  const ordered = sortPieRowsByFunding([
    ...pie.slices.map(rowFromSlice),
    ...(pie.tail_slices ?? []).map(rowFromSlice),
  ]);
  const hasZif = ordered.some((r) => r.name === LAST_INDIVIDUAL_ACTIVITY_CODE);

  if (!hasZif || ordered.length <= MAX_ACTIVITY_CODES_ALL_ON_PIE) {
    return distributeAllActivityCodes(ordered, pie.total_funding_indexed);
  }

  const named = ordered.filter((r) => !isActivityCodeAfterZif(r.name));
  const postZifTail = ordered.filter((r) => isActivityCodeAfterZif(r.name));
  const innerPicked = pickInnerRingSlices(named);
  const { kept: innerChartData } = deferUndisplayableRingSlices(
    innerPicked,
    MIN_INNER_SLICE_SHARE_OF_RING,
    INNER_SLICE_MIN_LABEL_PCT_OF_INDEXED,
  );
  const keptInnerNames = new Set(innerChartData.map((r) => r.name));
  const outerCandidates = sortPieRowsByFunding(
    named.filter((r) => !keptInnerNames.has(r.name)),
  );
  const { outerChartData, tailDetailRows } = buildOuterRingAndTail(
    outerCandidates,
    postZifTail,
    pie.total_funding_indexed,
  );

  return { innerChartData, outerChartData, tailDetailRows, usesZifCutoff: true };
}

type PieSectorShapeProps = {
  cx?: number;
  cy?: number;
  innerRadius?: number;
  outerRadius?: number;
  startAngle?: number;
  endAngle?: number;
  fill?: string;
  isActive?: boolean;
  isOther?: boolean;
  radialInset?: number;
  payload?: PieRow;
  onClick?: (event: MouseEvent<SVGPathElement>) => void;
  sliceClickable?: boolean;
  isSelectedSlice?: boolean;
};

function lightenHexColor(hex: string, amount = 0.16): string {
  const normalized = hex.replace("#", "").trim();
  if (normalized.length !== 3 && normalized.length !== 6) {
    return hex;
  }
  const full =
    normalized.length === 3
      ? normalized.split("").map((char) => char + char).join("")
      : normalized;
  const mix = (channel: number) =>
    Math.min(255, Math.round(channel + (255 - channel) * amount));
  const r = mix(parseInt(full.slice(0, 2), 16));
  const g = mix(parseInt(full.slice(2, 4), 16));
  const b = mix(parseInt(full.slice(4, 6), 16));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Hover: lighter fill, slice-color outline, outer edge expands slightly. */
function HighlightedPieSector(props: PieSectorShapeProps) {
  const cx = Number(props.cx ?? 0);
  const cy = Number(props.cy ?? 0);
  const innerRadius = Number(props.innerRadius ?? 0);
  const outerRadius = Number(props.outerRadius ?? 0);
  const startAngle = Number(props.startAngle ?? 0);
  const endAngle = Number(props.endAngle ?? 0);
  const fill = props.fill ?? "#8884d8";
  const isActive = Boolean(props.isActive);
  const isOther = Boolean(props.isOther ?? props.payload?.isOther);
  const isSelectedSlice = Boolean(props.isSelectedSlice);
  const sliceClickable = Boolean(props.sliceClickable) && !isOther;
  const inset = Number(props.radialInset ?? 0);
  const drawInner = innerRadius + inset * 0.35;
  const drawOuter = outerRadius - inset;
  const hoverExpand = isOther ? PIE_HOVER_OUTER_EXPAND_PX * 0.6 : PIE_HOVER_OUTER_EXPAND_PX;
  const activeOuter = isActive ? drawOuter + hoverExpand : drawOuter;
  const sectorFill = isActive ? lightenHexColor(fill, isOther ? 0.12 : 0.18) : fill;
  const showStroke = isActive || isSelectedSlice;
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={drawInner}
      outerRadius={activeOuter}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={sectorFill}
      stroke={showStroke ? fill : "none"}
      strokeWidth={showStroke ? PIE_HOVER_STROKE_WIDTH : 0}
      onClick={props.onClick}
      style={{
        transition: PIE_SLICE_HOVER_TRANSITION,
        opacity: isOther && !isActive ? 0.88 : 1,
        outline: "none",
        cursor: sliceClickable ? "pointer" : undefined,
      }}
    />
  );
}

type SliceLabelProps = {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  /** Recharts slice share of this ring (0–1, or 0–100 in some versions). */
  percent?: number;
  payload?: {
    name: string;
    pct: number;
    labelPct?: number;
    emphasizeOnChart?: boolean;
    isOther?: boolean;
  };
  minPct?: number;
  compact?: boolean;
  ring?: "inner" | "outer";
};

function normalizeSlicePercent(percent: number | undefined): number | undefined {
  if (percent == null || !Number.isFinite(percent)) {
    return undefined;
  }
  return percent > 1 ? percent / 100 : percent;
}

function innerSliceLabelRadialFactor(slicePercent: number | undefined): number {
  const share = normalizeSlicePercent(slicePercent);
  if (share == null || share <= 0) {
    return INNER_SLICE_LABEL_RADIAL_FACTOR_MAX;
  }
  const span = INNER_SLICE_LABEL_RADIAL_FACTOR_MAX - INNER_SLICE_LABEL_RADIAL_FACTOR_MIN;
  return INNER_SLICE_LABEL_RADIAL_FACTOR_MAX - share * span;
}

function sliceLabelRadius(
  innerRadius: number,
  outerRadius: number,
  ring: "inner" | "outer",
  isOther: boolean,
  slicePercent?: number,
): number {
  const span = outerRadius - innerRadius;
  if (ring === "inner") {
    const factor = innerSliceLabelRadialFactor(slicePercent);
    const target = innerRadius + span * factor;
    const minR = innerRadius + INNER_SLICE_LABEL_INNER_PAD_PX;
    const maxR = outerRadius - INNER_SLICE_LABEL_OUTER_PAD_PX;
    return Math.min(Math.max(target, minR), maxR);
  }
  const drawOuter = isOther ? outerRadius - OTHER_RADIAL_INSET_PX : outerRadius;
  const target = innerRadius + span * OUTER_SLICE_LABEL_RADIAL_FACTOR;
  const minR = innerRadius + OUTER_SLICE_LABEL_EDGE_PAD_PX;
  const maxR = drawOuter - OUTER_SLICE_LABEL_EDGE_PAD_PX;
  return Math.min(Math.max(target, minR), maxR);
}

/** Activity code + % of all indexed funding on each slice. */
function renderSliceLabel({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
  payload,
  minPct = 2.5,
  compact = false,
  ring = compact ? "inner" : "outer",
}: SliceLabelProps) {
  const row = payload;
  if (
    row == null ||
    cx == null ||
    cy == null ||
    midAngle == null ||
    innerRadius == null ||
    outerRadius == null
  ) {
    return null;
  }
  const pctAll = (row.labelPct ?? row.pct) * 100;
  if (pctAll < minPct && !row.emphasizeOnChart) {
    return null;
  }
  const RADIAN = Math.PI / 180;
  const radius = sliceLabelRadius(
    innerRadius,
    outerRadius,
    ring,
    Boolean(row.isOther),
    ring === "inner" ? percent : undefined,
  );
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  const codeStrokeWidth = compact ? "1.5px" : "2px";
  const pctStrokeWidth = compact ? "1.25px" : "2px";
  return (
    <text
      x={x}
      y={y}
      fill="#fff"
      textAnchor="middle"
      dominantBaseline="middle"
      style={{ pointerEvents: "none" }}
    >
      <tspan
        x={x}
        dy={compact ? "-0.4em" : "-0.55em"}
        style={{
          fill: "#fff",
          fontSize: compact ? INNER_SLICE_LABEL_CODE_FONT_PX : undefined,
          fontWeight: 700,
          paintOrder: "stroke fill",
          stroke: "rgba(15,23,42,0.5)",
          strokeWidth: codeStrokeWidth,
        }}
      >
        {row.isOther ? "Other" : row.name}
      </tspan>
      <tspan
        x={x}
        dy={compact ? "0.85em" : "1.05em"}
        style={{
          fill: "#fff",
          fontSize: compact ? INNER_SLICE_LABEL_PCT_FONT_PX : undefined,
          fontWeight: 600,
          paintOrder: "stroke fill",
          stroke: "rgba(15,23,42,0.45)",
          strokeWidth: pctStrokeWidth,
        }}
      >
        {`${pctAll.toFixed(1)}%`}
      </tspan>
    </text>
  );
}

function sliceColor(index: number): string {
  return PIE_COLORS[index % PIE_COLORS.length];
}

function isPieRow(entry: PieRow | { payload?: PieRow }): entry is PieRow {
  return "name" in entry && typeof entry.name === "string";
}

function pieRowFromClickEntry(entry: PieRow | { payload?: PieRow }): PieRow | undefined {
  if (isPieRow(entry)) {
    return entry;
  }
  return entry.payload;
}

/**
 * Two-layer pie: inner ring = top 5 activity codes; outer ring = ranks 6–20.
 * Recharts stacks two `<Pie>` components in one `<PieChart>`.
 */
export default function ActivityFundingPiePanel({
  title,
  pie,
  formatDollars,
  chartHeight = DEFAULT_CHART_HEIGHT_PX,
  loading = false,
  selectedActivity = "",
  onActivitySelect,
  hoveredActivityCode = null,
  tailListOverlay = false,
}: ActivityFundingPiePanelProps) {
  const [tailHoverCode, setTailHoverCode] = useState<string | null>(null);
  const [tailListOpen, setTailListOpen] = useState(false);

  const { innerChartData, outerChartData, tailDetailRows } = useMemo(() => {
    const split = splitPieRows(pie);
    const totalIndexed = pie.total_funding_indexed;
    return {
      ...split,
      innerChartData: rowsWithLabelPct(
        prepareRingRows(split.innerChartData, "inner"),
        totalIndexed,
      ),
      outerChartData: rowsWithLabelPct(
        prepareRingRows(split.outerChartData, "outer"),
        totalIndexed,
      ),
    };
  }, [pie]);

  const chartData = useMemo(
    () => [...innerChartData, ...outerChartData],
    [innerChartData, outerChartData],
  );

  const pieSliceCodes = useMemo(
    () =>
      new Set(
        [...innerChartData, ...outerChartData]
          .filter((r) => !r.isOther)
          .map((r) => r.name),
      ),
    [innerChartData, outerChartData],
  );

  const tailRowByCode = useMemo(
    () => new Map(tailDetailRows.map((r) => [r.name, r])),
    [tailDetailRows],
  );

  const previewCode = tailHoverCode ?? hoveredActivityCode ?? null;
  const showChartPreview =
    previewCode != null && previewCode.length > 0 && !pieSliceCodes.has(previewCode);
  const previewRow = previewCode ? tailRowByCode.get(previewCode) : undefined;

  const showTailPanel = tailDetailRows.length > 0;

  const pieRingCount =
    (innerChartData.length > 0 ? 1 : 0) + (outerChartData.length > 0 ? 1 : 0);
  const [pieAnimationActive, setPieAnimationActive] = useState(true);
  const pieAnimationEndsRef = useRef(0);

  useEffect(() => {
    setPieAnimationActive(true);
    pieAnimationEndsRef.current = 0;
  }, [pie, innerChartData, outerChartData]);

  useEffect(() => {
    if (!tailListOverlay) {
      setTailListOpen(false);
    }
  }, [tailListOverlay]);

  useEffect(() => {
    if (!pieAnimationActive || pieRingCount === 0) return;
    const timeoutId = window.setTimeout(() => {
      setPieAnimationActive(false);
    }, 900);
    return () => window.clearTimeout(timeoutId);
  }, [pieAnimationActive, pieRingCount, pie]);

  const handlePieAnimationEnd = useCallback(() => {
    pieAnimationEndsRef.current += 1;
    if (pieAnimationEndsRef.current >= pieRingCount) {
      setPieAnimationActive(false);
    }
  }, [pieRingCount]);

  const handlePieSliceClick = useCallback(
    (entry: PieRow | { payload?: PieRow }) => {
      const row = pieRowFromClickEntry(entry);
      if (row == null || row.isOther || onActivitySelect == null || !row.name) {
        return;
      }
      onActivitySelect(row.name);
    },
    [onActivitySelect],
  );

  const renderPieSector = useCallback(
    (props: PieSectorShapeProps) => {
      const row = props.payload;
      const isSelectedSlice = row != null && row.name === selectedActivity;
      const sliceClickable = onActivitySelect != null && row != null && !row.isOther;
      return (
        <HighlightedPieSector
          {...props}
          isSelectedSlice={isSelectedSlice}
          sliceClickable={sliceClickable}
        />
      );
    },
    [onActivitySelect, selectedActivity],
  );

  const renderTooltip = (props: TooltipContentProps<ValueType, NameType>) => {
    if (!props.active || !props.payload?.length) {
      return null;
    }
    const row = props.payload[0]?.payload as PieRow | undefined;
    if (!row) {
      return null;
    }
    const codeLabel = row.isOther ? "Other" : row.name;
    const codeMeaning = row.isOther ? undefined : getActivityCodeTitle(row.name);
    return (
      <ActivityCodeHoverCard
        key={codeLabel}
        code={codeLabel}
        formatDollars={formatDollars}
        funding={row.value}
        projectCount={row.count}
        description={codeMeaning}
        className="pointer-events-none z-10"
      />
    );
  };

  if (chartData.length === 0) {
    return (
      <div
      className={cn(
        CLS_DASHBOARD_PANEL_SHELL,
        "pb-[0.9rem] text-[14px] min-h-0 transition-opacity duration-200",
        loading && "opacity-50 pointer-events-none",
      )}
    >
        <div className={CLS_DASHBOARD_PANEL_HEADER}>{title}</div>
        <p className="text-text-muted text-[0.875rem] mt-2 m-0">No activity funding data.</p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        CLS_DASHBOARD_PANEL_SHELL,
        "pb-[0.9rem] text-[14px] min-h-0 transition-opacity duration-200",
        tailListOverlay && "overflow-visible",
        loading && "opacity-50 pointer-events-none",
      )}
    >
      <div className={CLS_DASHBOARD_PANEL_HEADER}>{title}</div>

      {pie.more_activities_than_buckets ? (
        <p className="text-text-secondary text-[0.75rem] leading-[1.45] m-0 mb-2 font-[inherit]">
          OpenSearch returned the top {pie.activity_buckets_fetched} activity buckets by funding;
          {pie.sum_other_doc_count.toLocaleString()} additional project rows sit outside those
          buckets. Increase the API <code className="bg-tag-bg rounded-[4px] font-mono text-[0.72rem] px-[0.3rem] py-[0.1rem]">limit</code> query param for
          fuller coverage.
        </p>
      ) : null}
      <div
        className={cn(
          "min-h-[360px] min-w-0 px-1 pb-1",
          tailListOverlay && "overflow-visible",
          showTailPanel && !tailListOverlay
            && "grid gap-3 items-stretch max-[768px]:grid-cols-1 min-[769px]:grid-cols-[minmax(0,1fr)_minmax(11rem,14rem)]",
        )}
      >
        <div
          className={cn(
            "relative isolate z-0 w-full min-w-0 overflow-visible [&_svg]:overflow-visible [&_svg]:text-[inherit]",
            CLS_RECHARTS_FOCUS_RESET,
            showChartPreview && "[&_svg]:opacity-35",
          )}
          style={{ height: chartHeight, minHeight: chartHeight }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 8, right: 4, bottom: 8, left: 4 }}>
              {innerChartData.length > 0 ? (
                <Pie
                  data={innerChartData}
                  dataKey="chartValue"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={INNER_PIE_INNER_RADIUS_PX}
                  outerRadius={INNER_PIE_OUTER_RADIUS_PX}
                  paddingAngle={0}
                  stroke="none"
                  shape={renderPieSector}
                  animationDuration={700}
                  animationEasing="ease-out"
                  isAnimationActive={pieAnimationActive}
                  onAnimationEnd={handlePieAnimationEnd}
                  legendType="none"
                  labelLine={false}
                  label={(props) =>
                    renderSliceLabel({ ...props, minPct: 0.8, compact: true, ring: "inner" })
                  }
                  onClick={onActivitySelect ? handlePieSliceClick : undefined}
                >
                  {innerChartData.map((_, index) => (
                    <Cell key={`inner-cell-${index}`} fill={sliceColor(index)} />
                  ))}
                </Pie>
              ) : null}
              {outerChartData.length > 0 ? (
                <Pie
                  data={outerChartData}
                  dataKey="chartValue"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={OUTER_PIE_INNER_RADIUS_PX}
                  outerRadius={OUTER_PIE_OUTER_RADIUS_PX}
                  paddingAngle={0}
                  stroke="none"
                  shape={renderPieSector}
                  animationDuration={700}
                  animationEasing="ease-out"
                  isAnimationActive={pieAnimationActive}
                  onAnimationEnd={handlePieAnimationEnd}
                  legendType="none"
                  labelLine={false}
                  label={(props) =>
                    renderSliceLabel({
                      ...props,
                      minPct: props.payload?.isOther ? 0 : 1.2,
                      ring: "outer",
                    })
                  }
                  onClick={onActivitySelect ? handlePieSliceClick : undefined}
                >
                  {outerChartData.map((row, index) => (
                    <Cell
                      key={`outer-cell-${index}`}
                      fill={row.isOther ? OTHER_SLICE_COLOR : sliceColor(INNER_SLICE_MAX_COUNT + index)}
                    />
                  ))}
                </Pie>
              ) : null}
              <Tooltip
                content={renderTooltip}
                contentStyle={RECHARTS_TOOLTIP_CONTENT_STYLE}
                wrapperStyle={{ ...RECHARTS_TOOLTIP_WRAPPER_STYLE, transition: "none" }}
                allowEscapeViewBox={RECHARTS_TOOLTIP_ESCAPE_VIEWBOX}
                isAnimationActive={false}
                animationDuration={0}
              />
            </PieChart>
          </ResponsiveContainer>
          {showChartPreview && previewCode ? (
            <ActivityCodeInChartPreview
              code={previewCode}
              formatDollars={formatDollars}
              row={previewRow}
            />
          ) : null}
          {tailListOverlay && showTailPanel ? (
            <>
              <button
                type="button"
                className={cn(
                  "absolute top-2 right-2 z-10 max-w-[calc(100%-1rem)] cursor-pointer rounded-[--radius-sm] border border-border bg-surface px-[0.55rem] py-[0.35rem] font-sans text-[0.75rem] font-semibold text-text-secondary shadow-sm transition-[background,color,border-color] duration-150",
                  "hover:border-border-strong hover:bg-surface-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
                  tailListOpen && "border-accent bg-accent-light text-accent-text",
                )}
                aria-expanded={tailListOpen}
                aria-controls="activity-pie-tail-overlay"
                onClick={() => setTailListOpen((open) => !open)}
              >
                Other codes ({tailDetailRows.length})
              </button>
              {tailListOpen ? (
                <>
                  <button
                    type="button"
                    className="absolute inset-0 z-20 cursor-default border-none bg-black/25 p-0"
                    aria-label="Close other activity codes"
                    onClick={() => setTailListOpen(false)}
                  />
                  <TailCodesPanel
                    id="activity-pie-tail-overlay"
                    tailDetailRows={tailDetailRows}
                    formatDollars={formatDollars}
                    selectedActivity={selectedActivity}
                    onActivitySelect={onActivitySelect}
                    onTailHoverCode={setTailHoverCode}
                    onClose={() => setTailListOpen(false)}
                    className="absolute top-[2.35rem] right-2 z-30 w-[min(14rem,calc(100%-1rem))] max-h-[min(18rem,calc(100%-2.75rem))]"
                  />
                </>
              ) : null}
            </>
          ) : null}
        </div>
        {showTailPanel && !tailListOverlay ? (
          <TailCodesPanel
            tailDetailRows={tailDetailRows}
            formatDollars={formatDollars}
            selectedActivity={selectedActivity}
            onActivitySelect={onActivitySelect}
            onTailHoverCode={setTailHoverCode}
            className="max-h-[360px]"
          />
        ) : null}
      </div>
    </div>
  );
}
