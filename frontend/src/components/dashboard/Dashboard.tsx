import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useFilterCatalog } from "../../hooks/useFilterCatalog";
import {
  getActivityData,
  getActivityFundingPie,
  getAvgGrantByIc,
  getDashboardSummary,
  getIcData,
  getProjectTermThemeCloud,
  getStateData,
  getTopFundedProjects,
  getTopOrgs,
  getYearData,
} from "../../api";
import type {
  ActivityDataPoint,
  ActivityFundingPieResponse,
  AvgGrantDataPoint,
  DashboardSummary,
  IcDataPoint,
  OrgDataPoint,
  ProjectTermThemeCloudResponse,
  StateDataPoint,
  TopFundedProject,
  YearDataPoint,
} from "../../api";
import ActivityFundingPiePanel from "../charts/ActivityFundingPiePanel";
import BarChartPanel from "../charts/BarChartPanel";
import Filters from "../search/Filters";
import type { FilterValues } from "../../types/filters";
import type { FilterBreadcrumbKey } from "../../utils/filterBreadcrumbOrder";
import { filtersKeepingBreadcrumbThroughIndex } from "../../utils/filterBreadcrumbOrder";
import { toAnalyticsFilterOptions } from "../../utils/analyticsFilters";
import LineChartPanel from "../charts/LineChartPanel";
import ProjectTermsThemeCloud from "./ProjectTermsThemeCloud";
import FilterBreadcrumb from "./FilterBreadcrumb";
import StateMap from "./StateMap";
import TopFundedProjectsPanel from "./TopFundedProjectsPanel";
import { buildIcProjectsHybridAxisScale, buildIcProjectsLinearAxisScale, buildLinearBarAxisScale } from "../../utils/chartAxis";
import { formatDollarsCompact } from "../../utils/format";
import { cn } from "../../utils/cn";
import HelpTooltip from "../shared/HelpTooltip";
import {
  HELP_DASHBOARD,
  HELP_DASHBOARD_FILTER_ACTIVITY,
  HELP_DASHBOARD_FILTER_FY,
  HELP_DASHBOARD_FILTER_IC,
  HELP_DASHBOARD_FILTER_ORG,
  HELP_DASHBOARD_FILTER_PI,
  HELP_DASHBOARD_FILTER_STATE,
} from "../../utils/helpContent";

// ─── Formatting helpers ───────────────────────────────────────────────────────

/**
 * Formats a count with locale-aware separators.
 */
function formatCount(n: number): string {
  return n.toLocaleString();
}

/**
 * Formats count ticks for compact chart axes (e.g., 1k, 3k, 6k, 12k).
 */
function formatHybridCountTick(n: number): string {
  if (n >= 1e3) {
    return `${Math.round(n / 1e3)}k`;
  }
  return n.toLocaleString();
}

/** Log below 20k; linear from 20k to axis max on the IC projects chart. */
const IC_HYBRID_LINEAR_MIN = 20_000;
const IC_HYBRID_LINEAR_MAX_ALL = 80_000;
const IC_HYBRID_LOG_MIN = 10;
const IC_HYBRID_LOG_RATIO = 0.38;
/** Minimum plot height for counts below the log floor (10) so tiny bars stay visible. */
const IC_HYBRID_MIN_PLOT = 0.035;

function icProjectsLogSectionToPlot(
  logValue: number,
  logMin: number,
  logMax: number,
  plotMax: number,
): number {
  const t = (Math.log10(logValue) - logMin) / (logMax - logMin);
  return IC_HYBRID_MIN_PLOT + t * (plotMax - IC_HYBRID_MIN_PLOT);
}

function icProjectsLogSectionToValue(
  plot: number,
  logMin: number,
  logMax: number,
  plotMax: number,
): number {
  if (plot <= IC_HYBRID_MIN_PLOT) {
    return IC_HYBRID_LOG_MIN;
  }
  const t = (plot - IC_HYBRID_MIN_PLOT) / (plotMax - IC_HYBRID_MIN_PLOT);
  return 10 ** (logMin + t * (logMax - logMin));
}

function icProjectsValueToPlot(value: number, linearMax: number): number {
  if (value > 0 && value < IC_HYBRID_LOG_MIN) {
    return IC_HYBRID_MIN_PLOT;
  }
  const v = Math.max(value, IC_HYBRID_LOG_MIN);
  const cappedMax = Math.max(linearMax, IC_HYBRID_LOG_MIN);

  if (cappedMax <= IC_HYBRID_LINEAR_MIN) {
    const logMin = Math.log10(IC_HYBRID_LOG_MIN);
    const logMax = Math.log10(cappedMax);
    return icProjectsLogSectionToPlot(Math.min(v, cappedMax), logMin, logMax, 1);
  }

  if (v >= IC_HYBRID_LINEAR_MIN) {
    return (
      IC_HYBRID_LOG_RATIO +
      (1 - IC_HYBRID_LOG_RATIO) *
        (Math.min(v, cappedMax) - IC_HYBRID_LINEAR_MIN) /
        (cappedMax - IC_HYBRID_LINEAR_MIN)
    );
  }
  const logMin = Math.log10(IC_HYBRID_LOG_MIN);
  const logMax = Math.log10(IC_HYBRID_LINEAR_MIN);
  return icProjectsLogSectionToPlot(v, logMin, logMax, IC_HYBRID_LOG_RATIO);
}

function icProjectsPlotToValue(plot: number, linearMax: number): number {
  const cappedMax = Math.max(linearMax, IC_HYBRID_LOG_MIN);

  if (cappedMax <= IC_HYBRID_LINEAR_MIN) {
    const logMin = Math.log10(IC_HYBRID_LOG_MIN);
    const logMax = Math.log10(cappedMax);
    return icProjectsLogSectionToValue(plot, logMin, logMax, 1);
  }

  if (plot >= IC_HYBRID_LOG_RATIO) {
    return (
      IC_HYBRID_LINEAR_MIN +
      ((plot - IC_HYBRID_LOG_RATIO) / (1 - IC_HYBRID_LOG_RATIO)) *
        (cappedMax - IC_HYBRID_LINEAR_MIN)
    );
  }
  const logMin = Math.log10(IC_HYBRID_LOG_MIN);
  const logMax = Math.log10(IC_HYBRID_LINEAR_MIN);
  return icProjectsLogSectionToValue(plot, logMin, logMax, IC_HYBRID_LOG_RATIO);
}

const IC_HYBRID_TICK_VALUES_ALL = [
  100, 500, 1000, 5000, 10000, 20000, 30000, 40000, 50000, 80000,
] as const;

/** Recharts box height for the activity funding pie (larger to fit scaled ring radii). */
const ACTIVITY_PIE_CHART_HEIGHT = 360;
/** Maximum top organizations shown in the Top Orgs chart. */
const TOP_ORGS_LIMIT = 30;

/** Grid cell — stretches to match sibling in the map + main-chart row. */
const MAP_CHART_ROW_CELL_CLASS = "flex h-full min-h-[310px] min-w-0 flex-col";

/** Shared layout for the map-adjacent main chart slot (IC projects + top orgs when IC filtered). */
const MAIN_CHART_SLOT_PANEL_CLASS =
  "flex h-full min-h-0 w-full max-w-full flex-1 flex-col px-4 pt-[0.9rem] pb-0 [&_.recharts-responsive-container]:-ml-3 [&_.recharts-responsive-container]:!w-[calc(100%+12px)]";

const MAIN_CHART_SLOT_BAR_PROPS = {
  layout: "horizontal" as const,
  fillHeight: true,
  xAxisHeight: 46,
  xAxisAngle: -45,
  xAxisFontSize: 12,
  xAxisTickDx: 10,
  yAxisFontSize: 12,
  yAxisWidth: 60,
  yAxisTickMargin: 10,
  yAxisTickDx: 6,
  chartMargin: { top: 4, right: 4, bottom: 4, left: 6 },
  barCategoryGap: "10%",
  maxBarSize: 30,
};

/** IC projects chart: minimal bottom padding; plot fills panel via fillHeight. */
const IC_PROJECTS_PANEL_CLASS = cn(
  MAIN_CHART_SLOT_PANEL_CLASS,
  "pb-0 [&_.recharts-responsive-container]:!mb-0",
);
const IC_PROJECTS_CHART_MARGIN = { top: 4, right: 4, bottom: 0, left: 6 };
const IC_PROJECTS_BAR_OVERRIDES = {
  xAxisHeight: 68,
  xAxisTickDy: -4,
};

/** Pie/year-trend row — same chart styling as main slot, sized to match LineChartPanel. */
const SECONDARY_CHART_ROW_PANEL_CLASS = cn(
  MAIN_CHART_SLOT_PANEL_CLASS,
  "flex-1 min-h-[330px]",
);

/** Top orgs + avg grant footer row — equal columns, charts fill cell height. */
const BOTTOM_BAR_ROW_CELL_CLASS = "flex h-full min-h-[420px] min-w-0 flex-col";
const BOTTOM_BAR_ROW_PANEL_CLASS = cn(
  MAIN_CHART_SLOT_PANEL_CLASS,
  "h-full flex-1 min-h-[420px]",
);

/** Grid cell for Projects & Funding by Year (matches pie/bar row height). */
const YEAR_CHART_ROW_CELL_CLASS = "flex h-full min-h-[330px] min-w-0 flex-col";

/** Projects & Funding by Year — fills cell width and height like bar charts. */
const YEAR_CHART_PANEL_CLASS = cn(MAIN_CHART_SLOT_PANEL_CLASS, "h-full flex-1 min-h-0 pb-0");

/** IC + activity: tighter horizontal padding; extra width bleed in narrow column. */
const YEAR_CHART_IC_ACTIVITY_PANEL_CLASS = cn(
  YEAR_CHART_PANEL_CLASS,
  "!px-2",
  "[&_.recharts-responsive-container]:-ml-2 [&_.recharts-responsive-container]:!w-[calc(100%+16px)]",
);

/**
 * Shortens long institute or organization names for chart axes; pair with
 * `full_label` on the same row for tooltips.
 */
function abbreviateChartCategoryLabel(label: string): string {
  const trimmed = label.trim();
  const parenMatch = trimmed.match(/\(([^)]+)\)\s*$/);
  if (parenMatch && parenMatch[1]) {
    return parenMatch[1].trim();
  }

  const words = trimmed
    .replace(/[^A-Za-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const filtered = words.filter((word) => !["of", "and", "the", "for"].includes(word.toLowerCase()));

  if (filtered.length >= 2) {
    return filtered.map((word) => word[0]?.toUpperCase() ?? "").join("").slice(0, 8);
  }

  if (trimmed.length <= 12) {
    return trimmed;
  }

  return `${trimmed.slice(0, 10)}…`;
}

// ─── Types for combined dashboard state ──────────────────────────────────────

interface DashboardData {
  summary: DashboardSummary;
  stateData: StateDataPoint[];
  icData: IcDataPoint[];
  activityData: ActivityDataPoint[];
  activityPie: ActivityFundingPieResponse;
  yearData: YearDataPoint[];
  topOrgs: OrgDataPoint[];
  avgGrant: AvgGrantDataPoint[];
  topFundedProjects: TopFundedProject[];
}

type DashboardProps = {
  searchQuery: string;
  semanticMode?: boolean;
  onSemanticModeChange?: (enabled: boolean) => void;
  onUpdateDashboard: (query: string) => void;
  onSearchNavigate: (query: string, filters?: FilterValues) => void;
  appliedFilters: FilterValues;
  filterBreadcrumbOrder: FilterBreadcrumbKey[];
  onApplyFilters: (filters: FilterValues) => void;
  onClearFilters: () => void;
  onTermSearchNavigate: (terms: string[]) => void;
  onViewAllProjects: () => void;
  onYearSearchNavigate: (year: number) => void;
  onOpenProject?: (projectId: string) => void;
};

// ─── KPI card subcomponent ────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  onClick?: () => void;
}

function KpiCard({ label, value, onClick }: KpiCardProps) {
  const content = (
    <>
      <div className="text-accent text-[0.95rem] min-[901px]:text-[1.45rem] font-bold leading-[1.2] font-mono truncate">
        {value}
      </div>
      <div className="text-text-secondary text-[0.625rem] min-[901px]:text-[0.8125rem] mt-1 min-[901px]:mt-[0.375rem] leading-tight">
        {label}
      </div>
    </>
  );
  const className = cn(
    "bg-surface border border-border rounded-lg px-2 py-2 min-[901px]:px-4 min-[901px]:py-[0.9rem] text-center w-full min-w-0",
    onClick
      && "cursor-pointer transition-[border-color,background,box-shadow] duration-150 hover:border-accent hover:bg-surface-hover hover:shadow-sm focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        onClick={onClick}
        aria-label={`${label}: ${value}. View matching projects in search`}
      >
        {content}
      </button>
    );
  }

  return <div className={className}>{content}</div>;
}

// ─── Main Dashboard component ─────────────────────────────────────────────────

/**
 * Analytics dashboard that fetches all data in parallel on mount and
 * renders KPI cards, a choropleth map, and multiple chart panels.
 */
export default function Dashboard({
  searchQuery,
  semanticMode = false,
  onSemanticModeChange,
  onUpdateDashboard,
  onSearchNavigate,
  appliedFilters,
  filterBreadcrumbOrder,
  onApplyFilters,
  onClearFilters,
  onTermSearchNavigate,
  onViewAllProjects,
  onYearSearchNavigate,
  onOpenProject,
}: DashboardProps) {
  const hasLoadedOnceRef = useRef(false);
  const [data, setData] = useState<DashboardData | null>(null);
  const [termThemeCloud, setTermThemeCloud] = useState<ProjectTermThemeCloudResponse | null>(null);
  const filterCatalog = useFilterCatalog();
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** Filters/search reflected in chart layout and map — updated when a fetch completes. */
  const [displayedFilters, setDisplayedFilters] = useState(appliedFilters);
  const [displayedSearchQuery, setDisplayedSearchQuery] = useState(searchQuery);
  /** Log (hybrid) vs linear scale for Projects by Institute (IC); defaults to log. */
  const [icProjectsLogScale, setIcProjectsLogScale] = useState(true);
  const [filterActivityHover, setFilterActivityHover] = useState<string | null>(null);

  const appliedFiltersRef = useRef(appliedFilters);
  appliedFiltersRef.current = appliedFilters;
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  const hasIcFilter = Boolean(displayedFilters.ic.trim());
  const hasOrgFilter = displayedFilters.org.trim() !== "";
  const showTopOrgsChart = !hasOrgFilter;
  const hasIcAndOrgFilter = hasIcFilter && hasOrgFilter;
  const hasActivityFilter = Boolean(displayedFilters.activity);
  const useCompactYearChartLayout = hasIcAndOrgFilter;

  const analyticsOptions = useMemo(
    () => toAnalyticsFilterOptions(appliedFilters, searchQuery),
    [appliedFilters, searchQuery],
  );

  const hasActiveFilters = useMemo(
    () =>
      Boolean(
        searchQuery.trim()
        || appliedFilters.pi
        || appliedFilters.ic
        || appliedFilters.org
        || appliedFilters.activity
        || appliedFilters.state
        || appliedFilters.fyMin
        || appliedFilters.fyMax,
      ),
    [appliedFilters, searchQuery],
  );

  const icProjectsUseLogScale = icProjectsLogScale;

  const handleTermBrowseSearch = useCallback((terms: string[]) => {
    onTermSearchNavigate(terms);
  }, [onTermSearchNavigate]);

  const handleMapStateSelect = (stateAbbrev: string) => {
    onApplyFilters({ ...appliedFilters, state: stateAbbrev.toUpperCase() });
  };

  const handleIcBarClick = (row: Record<string, unknown>) => {
    const institute =
      (typeof row.full_label === "string" && row.full_label.trim())
      || (typeof row.label === "string" && row.label.trim())
      || "";
    if (institute) {
      onApplyFilters({ ...appliedFilters, ic: institute });
    }
  };

  const handleYearClick = useCallback(
    (point: YearDataPoint) => {
      if (point.year != null) {
        onYearSearchNavigate(point.year);
      }
    },
    [onYearSearchNavigate],
  );

  const handleTopOrgBarClick = (row: Record<string, unknown>) => {
    const org =
      (typeof row.full_label === "string" && row.full_label.trim())
      || (typeof row.label === "string" && row.label.trim())
      || "";
    if (org) {
      onApplyFilters({ ...appliedFilters, org });
    }
  };

  const handleActivitySelect = useCallback((activityCode: string) => {
    onApplyFilters({ ...appliedFilters, activity: activityCode });
  }, [appliedFilters, onApplyFilters]);

  const handleBreadcrumbSegmentClick = useCallback(
    (segmentIndex: number) => {
      const next = filtersKeepingBreadcrumbThroughIndex(
        appliedFilters,
        filterBreadcrumbOrder,
        segmentIndex,
      );
      onApplyFilters(next);
    },
    [appliedFilters, filterBreadcrumbOrder, onApplyFilters],
  );

  const icChartRows = useMemo((): Array<Record<string, unknown>> => {
    const icData = data?.icData ?? [];
    return icData
      .map((point) => ({
        ...point,
        short_label: abbreviateChartCategoryLabel(point.label),
        full_label: point.label,
      }))
      .sort((a, b) => a.full_label.localeCompare(b.full_label));
  }, [data?.icData]);

  const icChartHybridScale = useMemo(() => {
    const values = icChartRows.map((row) => Number(row.value));
    return buildIcProjectsHybridAxisScale(values, {
      hybridLinearMin: IC_HYBRID_LINEAR_MIN,
      fallbackLinearMax: IC_HYBRID_LINEAR_MAX_ALL,
      fallbackTickValues: IC_HYBRID_TICK_VALUES_ALL,
    });
  }, [icChartRows]);

  const icChartLinearAxisScale = useMemo(() => {
    const values = icChartRows.map((row) => Number(row.value));
    return buildIcProjectsLinearAxisScale(values);
  }, [icChartRows]);

  const topOrgsAxisScale = useMemo(() => {
    const values = (data?.topOrgs ?? []).map((point) => Number(point.total_funding));
    return buildLinearBarAxisScale(values);
  }, [data?.topOrgs]);

  const avgGrantAxisScale = useMemo(() => {
    const values = (data?.avgGrant ?? []).map((point) => Number(point.avg_grant));
    return buildLinearBarAxisScale(values);
  }, [data?.avgGrant]);

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      const filtersSnapshot = appliedFiltersRef.current;
      const querySnapshot = searchQueryRef.current;
      const fetchOptions = toAnalyticsFilterOptions(filtersSnapshot, querySnapshot);
      const fetchTopOrgs = filtersSnapshot.org.trim() === "";

      if (hasLoadedOnceRef.current) {
        setRefreshing(true);
      }
      try {
        const [
          summary,
          stateData,
          icData,
          activityData,
          activityPie,
          yearData,
          topOrgs,
          avgGrant,
          topFundedProjects,
        ] = await Promise.all([
          getDashboardSummary(fetchOptions, controller.signal),
          getStateData(fetchOptions, controller.signal),
          getIcData(undefined, fetchOptions, controller.signal),
          getActivityData(80, fetchOptions, controller.signal),
          getActivityFundingPie({ limit: 500, pieSlices: 20 }, fetchOptions, controller.signal),
          getYearData(fetchOptions, controller.signal),
          fetchTopOrgs
            ? getTopOrgs(TOP_ORGS_LIMIT, fetchOptions, controller.signal)
            : Promise.resolve([]),
          getAvgGrantByIc(fetchOptions, controller.signal),
          getTopFundedProjects(fetchOptions, controller.signal),
        ]);

        if (!controller.signal.aborted) {
          setData({
            summary,
            stateData,
            icData,
            activityData,
            activityPie,
            yearData,
            topOrgs,
            avgGrant,
            topFundedProjects,
          });
          setDisplayedFilters(filtersSnapshot);
          setDisplayedSearchQuery(querySnapshot);
          hasLoadedOnceRef.current = true;
          setError(null);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Failed to load dashboard data.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setRefreshing(false);
        }
      }
    };

    void load();

    return () => {
      controller.abort();
    };
  }, [analyticsOptions, hasActiveFilters]);

  useEffect(() => {
    if (!hasActiveFilters) {
      setIcProjectsLogScale(true);
    }
  }, [hasActiveFilters]);

  useEffect(() => {
    const controller = new AbortController();
    getProjectTermThemeCloud(controller.signal).then((cloud) => {
      if (!controller.signal.aborted) setTermThemeCloud(cloud);
    }).catch(() => {});
    return () => { controller.abort(); };
  }, []);

  if (error) {
    return (
      <div className="text-center py-16 text-text-muted text-sm">
        <span>Unable to load dashboard: {error}</span>
      </div>
    );
  }

  if (!data || !filterCatalog || !termThemeCloud) {
    return (
      <div className="text-center py-16 text-text-muted text-sm">
        <span>Loading analytics…</span>
      </div>
    );
  }

  const { summary, stateData, activityPie, yearData, topOrgs, avgGrant, topFundedProjects } = data;
  const { icNames, orgNames, activityCodes, states } = filterCatalog;

  const avgGrantValue =
    summary.total_documents > 0
      ? summary.total_funding / summary.total_documents
      : 0;

  const topOrgsChartData: Array<Record<string, unknown>> = topOrgs.map((point) => ({
    ...point,
    short_label: abbreviateChartCategoryLabel(point.label),
    full_label: point.label,
  }));

  const avgGrantChartData: Array<Record<string, unknown>> = avgGrant.map((point) => ({
    ...point,
    short_label: abbreviateChartCategoryLabel(point.label),
    full_label: point.label,
  }));

  const topOrgsBarChartBase = showTopOrgsChart
    ? {
        data: topOrgsChartData,
        dataKey: "total_funding",
        labelKey: "short_label",
        tooltipLabelKey: "full_label",
        formatter: formatDollarsCompact,
        valueDomain: [0, topOrgsAxisScale.axisMax] as [number, number],
        valueTicks: topOrgsAxisScale.tickValues,
        onBarClick: handleTopOrgBarClick,
        animateBars: !refreshing,
      }
    : null;

  const topOrgsPanelMainSlot = topOrgsBarChartBase ? (
    <BarChartPanel
      title="Top Organizations by Funding"
      panelClassName={MAIN_CHART_SLOT_PANEL_CLASS}
      {...topOrgsBarChartBase}
      {...MAIN_CHART_SLOT_BAR_PROPS}
    />
  ) : null;

  const topOrgsPanelSecondary = topOrgsBarChartBase ? (
    <BarChartPanel
      title="Top Organizations by Funding"
      panelClassName={SECONDARY_CHART_ROW_PANEL_CLASS}
      {...topOrgsBarChartBase}
      {...MAIN_CHART_SLOT_BAR_PROPS}
    />
  ) : null;

  const topOrgsPanelFooter = topOrgsBarChartBase ? (
    <BarChartPanel
      title="Top Organizations by Funding"
      panelClassName={BOTTOM_BAR_ROW_PANEL_CLASS}
      {...topOrgsBarChartBase}
      {...MAIN_CHART_SLOT_BAR_PROPS}
    />
  ) : null;

  const avgGrantPanel = (
    <BarChartPanel
      title="Average Grant by Institute"
      panelClassName={BOTTOM_BAR_ROW_PANEL_CLASS}
      data={avgGrantChartData}
      dataKey="avg_grant"
      labelKey="short_label"
      tooltipLabelKey="full_label"
      formatter={formatDollarsCompact}
      valueDomain={[0, avgGrantAxisScale.axisMax] as [number, number]}
      valueTicks={avgGrantAxisScale.tickValues}
      color="#7c3aed"
      animateBars={!refreshing}
      {...MAIN_CHART_SLOT_BAR_PROPS}
    />
  );

  const showBottomBarRow = !hasIcFilter;
  const showBottomTopOrgsPanel = showTopOrgsChart && !hasActivityFilter;

  const icProjectsScaleToggle = (
    <div className="inline-flex border border-border rounded-[--radius-sm] shrink-0 overflow-hidden" role="group" aria-label="Count axis scale">
      <button
        type="button"
        className={cn("bg-surface border-none text-text-secondary cursor-pointer font-[inherit] text-[0.8125rem] font-medium px-[0.65rem] py-[0.35rem] transition-[background,color] duration-150 hover:bg-surface-hover hover:text-text-primary", !icProjectsLogScale && "!bg-accent !text-white")}
        onClick={() => setIcProjectsLogScale(false)}
      >
        Linear
      </button>
      <button
        type="button"
        className={cn("bg-surface border-none text-text-secondary cursor-pointer font-[inherit] text-[0.8125rem] font-medium px-[0.65rem] py-[0.35rem] transition-[background,color] duration-150 hover:bg-surface-hover hover:text-text-primary border-l border-border", icProjectsLogScale && "!bg-accent !text-white")}
        onClick={() => setIcProjectsLogScale(true)}
      >
        Log
      </button>
    </div>
  );

  const icProjectsBarChartProps = {
    title: "Projects by Institute",
    headerEnd: icProjectsScaleToggle,
    data: icChartRows,
    dataKey: "value",
    labelKey: "short_label",
    tooltipLabelKey: "full_label",
    ...MAIN_CHART_SLOT_BAR_PROPS,
    ...IC_PROJECTS_BAR_OVERRIDES,
    chartMargin: IC_PROJECTS_CHART_MARGIN,
    onBarClick: handleIcBarClick,
    animateBars: !refreshing,
    ...(icProjectsUseLogScale
      ? {
          valueTransform: (value: number) =>
            icProjectsValueToPlot(value, icChartHybridScale.linearMax),
          plotToValue: (plot: number) =>
            icProjectsPlotToValue(plot, icChartHybridScale.linearMax),
          valueTickValues: icChartHybridScale.tickValues,
          formatter: formatHybridCountTick,
          tooltipFormatter: formatCount,
        }
      : {
          valueScale: "linear" as const,
          valueDomain: [0, icChartLinearAxisScale.axisMax] as [number, number],
          valueTicks: icChartLinearAxisScale.tickValues,
          formatter: formatCount,
          tooltipFormatter: formatCount,
        }),
  };

  const icProjectsPanel = (
    <BarChartPanel panelClassName={IC_PROJECTS_PANEL_CLASS} {...icProjectsBarChartProps} />
  );

  const activityPieFilterKey = [
    displayedSearchQuery,
    displayedFilters.pi,
    displayedFilters.ic,
    displayedFilters.org,
    displayedFilters.activity,
    displayedFilters.state,
    displayedFilters.fyMin,
    displayedFilters.fyMax,
  ].join("\0");

  const activityPiePanel = (
    <ActivityFundingPiePanel
      key={activityPieFilterKey}
      title="Funding by Activity Code"
      pie={activityPie}
      formatDollars={formatDollarsCompact}
      chartHeight={ACTIVITY_PIE_CHART_HEIGHT}
      loading={refreshing}
      selectedActivity={displayedFilters.activity}
      onActivitySelect={handleActivitySelect}
      hoveredActivityCode={filterActivityHover}
      tailListOverlay={hasIcAndOrgFilter}
    />
  );

  const yearRowSecondaryPanel =
    hasActivityFilter && showTopOrgsChart && !hasIcFilter
      ? topOrgsPanelSecondary
      : activityPiePanel;

  const projectsAndFundingByYearPanel = (
    <LineChartPanel
      title="Projects & Funding by Year"
      panelClassName={
        useCompactYearChartLayout ? YEAR_CHART_IC_ACTIVITY_PANEL_CLASS : YEAR_CHART_PANEL_CLASS
      }
      compactWidth={useCompactYearChartLayout}
      fillHeight
      data={yearData}
      formatter={formatDollarsCompact}
      onYearClick={handleYearClick}
      chartMargin={{ top: 8, right: 4, bottom: 12, left: 0 }}
    />
  );

  return (
    <div
      className={cn(
        "flex w-full flex-col px-6 py-[1.1rem] max-[900px]:px-3 max-[900px]:py-3",
        refreshing && "opacity-[0.72] transition-opacity duration-200",
      )}
    >
      <Filters
        applied={appliedFilters}
        catalog={{
          icNames,
          orgNames,
          activityCodes,
          states,
          fiscalYearOptions: filterCatalog.fiscalYearOptions,
        }}
        fieldHelp={{
          pi: HELP_DASHBOARD_FILTER_PI,
          ic: HELP_DASHBOARD_FILTER_IC,
          org: HELP_DASHBOARD_FILTER_ORG,
          activity: HELP_DASHBOARD_FILTER_ACTIVITY,
          state: HELP_DASHBOARD_FILTER_STATE,
          fy: HELP_DASHBOARD_FILTER_FY,
        }}
        searchQuery={searchQuery}
        semanticMode={semanticMode}
        onSemanticModeChange={onSemanticModeChange}
        showSemanticToggle
        onSearch={onSearchNavigate}
        onUpdateDashboard={onUpdateDashboard}
        searchSubmitOnClear
        onApply={onApplyFilters}
        onClear={onClearFilters}
        onActivityCodeHover={setFilterActivityHover}
        highlightActiveFilters
        helpTooltip={
          <HelpTooltip label={HELP_DASHBOARD.label}>{HELP_DASHBOARD.body}</HelpTooltip>
        }
      />

      <FilterBreadcrumb
        filters={appliedFilters}
        order={filterBreadcrumbOrder}
        onSegmentClick={handleBreadcrumbSegmentClick}
      />

      {/* KPI cards */}
      <div className="mt-0 mb-3 grid grid-cols-3 gap-2 min-[901px]:gap-3">
        <KpiCard label="Total Funding" value={formatDollarsCompact(summary.total_funding)} />
        <KpiCard
          label="Total Projects"
          value={formatCount(summary.total_documents)}
          onClick={onViewAllProjects}
        />
        <KpiCard label="Avg Grant" value={formatDollarsCompact(avgGrantValue)} />
      </div>

      {/* Chart grid: layout varies by IC/org/activity filter combinations */}
      {hasIcAndOrgFilter ? (
        <div className="grid grid-cols-3 items-stretch gap-3 w-full max-w-full min-w-0 max-[768px]:grid-cols-1">
          <div className={cn(MAP_CHART_ROW_CELL_CLASS, "min-w-0")}>
            <StateMap
              data={stateData}
              selectedStateAbbrev={displayedFilters.state}
              onStateSelect={handleMapStateSelect}
            />
          </div>
          <div className={cn(MAP_CHART_ROW_CELL_CLASS, "min-w-0")}>
            {projectsAndFundingByYearPanel}
          </div>
          <div className={cn(MAP_CHART_ROW_CELL_CLASS, "min-w-0")}>
            {activityPiePanel}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 items-stretch gap-3 w-full max-w-full min-w-0 max-[768px]:grid-cols-1">
          <div
            className={cn(
              MAP_CHART_ROW_CELL_CLASS,
              "col-start-1 row-start-1 max-[768px]:col-auto max-[768px]:row-auto",
            )}
          >
            <StateMap
              data={stateData}
              selectedStateAbbrev={displayedFilters.state}
              onStateSelect={handleMapStateSelect}
            />
          </div>
          <div
            className={cn(
              MAP_CHART_ROW_CELL_CLASS,
              "col-start-2 col-end-[-1] row-start-1 overflow-hidden max-[768px]:col-auto max-[768px]:row-auto",
            )}
          >
            {hasIcFilter && !hasOrgFilter ? topOrgsPanelMainSlot : icProjectsPanel}
          </div>
          <div className="col-span-full row-start-2 grid min-h-[330px] grid-cols-2 gap-3 items-stretch min-w-0 max-[768px]:grid-cols-1 max-[768px]:col-auto max-[768px]:row-auto">
            <div className={YEAR_CHART_ROW_CELL_CLASS}>{projectsAndFundingByYearPanel}</div>
            <div className={YEAR_CHART_ROW_CELL_CLASS}>{yearRowSecondaryPanel}</div>
          </div>
        </div>
      )}

      <div className="mt-[0.85rem] w-full space-y-[0.85rem]">
        <TopFundedProjectsPanel
          projects={topFundedProjects}
          loading={refreshing}
          onOpenProject={onOpenProject}
        />
        <ProjectTermsThemeCloud payload={termThemeCloud} onSearch={handleTermBrowseSearch} />
      </div>

      {!showBottomBarRow ? null : (
        <div
          className={cn(
            "mt-[0.85rem] grid w-full min-h-[420px] items-stretch gap-[0.85rem]",
            showBottomTopOrgsPanel
              ? "grid-cols-2 max-[768px]:grid-cols-1"
              : "grid-cols-1",
          )}
        >
          {showBottomTopOrgsPanel ? (
            <div className={BOTTOM_BAR_ROW_CELL_CLASS}>{topOrgsPanelFooter}</div>
          ) : null}
          <div className={BOTTOM_BAR_ROW_CELL_CLASS}>{avgGrantPanel}</div>
        </div>
      )}
    </div>
  );
}
