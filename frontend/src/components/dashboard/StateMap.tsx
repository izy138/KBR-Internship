import { type MouseEvent, useCallback, useLayoutEffect, useRef, useState } from "react";
import { scaleThreshold } from "d3-scale";
import {
  ComposableMap,
  Geographies,
  Geography,
} from "react-simple-maps";
import type { Geography as GeographyType } from "react-simple-maps";
import type { StateDataPoint } from "../../api";
import { formatDollarsCompact } from "../../utils/format";
import { cn } from "../../utils/cn";
import { CHART_TOOLTIP_ROUNDED_STYLE, CLS_CHART_CURSOR_TOOLTIP, CLS_DASHBOARD_PANEL_HEADER, CLS_DASHBOARD_PANEL_SHELL } from "../../utils/chartStyles";
import { clampTooltipToContainer } from "../../utils/tooltipPosition";

/** TopoJSON source — US states at 1:10m resolution */
const GEO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json";

/** TopoJSON source — US outer boundary for the full-map silhouette */
const NATION_GEO_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/nation-10m.json";

/** GeoJSON source — Puerto Rico (not included in us-atlas states) */
const PR_GEO_URL =
  "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json";

/** Project-count thresholds for choropleth buckets */
const COUNT_THRESHOLDS = [1000, 5000, 10000, 20000, 30000, 40000, 50000] as const;

/** Fill for states with zero projects (or no data in the filtered set). */
const ZERO_COUNT_FILL = "#e8ffea";

/** Eight-step choropleth — mint → navy (non-zero counts only) */
const MAP_COLOR_STOPS = [
  "#c0f0c4", // 1–1k
  "#9ce6a7", // 1k–5k — medium green
  "#72d497", // 5k–10k — clear teal shift #3A9EAA
  "#3eb896", //10k–20k
  "#18888c", //20k–30k
  "#1c708f", //30k–40k
  "#195182", //40k–50k
  "#0d3763", // 50k+
] as const;
const HOVER_FILL = "#ffe259";
const HOVER_STROKE = "#f97316";
/** Outline for the active state filter (map click or dropdown). */
const SELECTED_STROKE = "#1a56db";
const HOVER_STROKE_WIDTH = 3;
const SELECTED_STROKE_WIDTH = 2;
/** Subtle outline for small/inset territories so they read against the map background */
const INSET_STATE_STROKE = "#2f6b52";
const MAP_OUTLINE_STROKE = INSET_STATE_STROKE;
const INSET_STATE_NAMES = new Set(["Alaska", "Hawaii", "Puerto Rico"]);

/**
 * Maps 2-letter USPS abbreviations to the full state name used in
 * the us-atlas TopoJSON `properties.name` field.
 */
const STATE_ABBREV_TO_NAME: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
  PR: "Puerto Rico",
};

/** Full TopoJSON name → USPS abbrev (matches `ORG_STATE` / filter values). */
const STATE_NAME_TO_ABBREV: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_ABBREV_TO_NAME).map(([abbrev, name]) => [name, abbrev]),
);

interface TooltipState {
  stateName: string;
  count: number;
  totalFunding: number;
}

type PointerPosition = { x: number; y: number };

interface StateMapProps {
  data: StateDataPoint[];
  /** Active state filter (USPS abbrev); highlights matching state on the map. */
  selectedStateAbbrev?: string;
  /** When set, clicking a state applies that USPS abbrev; click again to clear (passes ""). */
  onStateSelect?: (stateAbbrev: string) => void;
}

/**
 * US choropleth map shaded by NIH project count per state.
 * Uses react-simple-maps + d3-scale for the color scale.
 */
export default function StateMap({
  data,
  selectedStateAbbrev = "",
  onStateSelect,
}: StateMapProps) {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [pointerPos, setPointerPos] = useState<PointerPosition | null>(null);
  const [tooltipPos, setTooltipPos] = useState<PointerPosition | null>(null);
  const [hoveredState, setHoveredState] = useState<string | null>(null);
  const mapCanvasRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const normalizedSelectedAbbrev = selectedStateAbbrev.trim().toUpperCase();

  const selectedGeoName = normalizedSelectedAbbrev
    ? (STATE_ABBREV_TO_NAME[normalizedSelectedAbbrev] ?? null)
    : null;

  const isSelectedState = (geoName: string): boolean => {
    if (!normalizedSelectedAbbrev) return false;
    const abbrev = STATE_NAME_TO_ABBREV[geoName];
    return abbrev?.toUpperCase() === normalizedSelectedAbbrev;
  };

  const clearHover = useCallback((): void => {
    setHoveredState(null);
    setTooltip(null);
    setPointerPos(null);
    setTooltipPos(null);
  }, []);

  const updatePointerFromEvent = useCallback((event: MouseEvent<SVGPathElement>): void => {
    const canvas = mapCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    setPointerPos({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  }, []);

  useLayoutEffect(() => {
    if (!tooltip || !pointerPos || !mapCanvasRef.current || !tooltipRef.current) {
      setTooltipPos(null);
      return;
    }

    const canvas = mapCanvasRef.current;
    const tip = tooltipRef.current;
    const clamped = clampTooltipToContainer(
      pointerPos,
      { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: canvas.clientWidth, height: canvas.clientHeight },
    );
    setTooltipPos(clamped);
  }, [tooltip, pointerPos]);

  const isPointerStillOverMap = (
    event: MouseEvent<SVGPathElement>,
  ): boolean => {
    const canvas = event.currentTarget.closest("[data-map-canvas]");
    if (!canvas) return false;

    const related = event.relatedTarget;
    if (related instanceof Node && canvas.contains(related)) {
      return true;
    }

    const underPointer = document.elementFromPoint(event.clientX, event.clientY);
    return underPointer instanceof Node && canvas.contains(underPointer);
  };

  // Build lookup from full state name → data point
  const stateByName = new Map<string, StateDataPoint>();
  for (const point of data) {
    const fullName = STATE_ABBREV_TO_NAME[point.state.toUpperCase()];
    if (fullName) {
      stateByName.set(fullName, point);
    }
  }

  const colorScale = scaleThreshold<number, string>()
    .domain([...COUNT_THRESHOLDS])
    .range([...MAP_COLOR_STOPS]);

  const getFill = (geoName: string): string => {
    const point = stateByName.get(geoName);
    if (!point || point.count === 0) return ZERO_COUNT_FILL;
    return colorScale(point.count);
  };

  const handleStateClick = (geoName: string): void => {
    if (!onStateSelect) return;
    const abbrev = STATE_NAME_TO_ABBREV[geoName];
    if (!abbrev) return;

    const normalized = abbrev.toUpperCase();
    if (normalized === normalizedSelectedAbbrev) {
      onStateSelect("");
      return;
    }

    onStateSelect(normalized);
  };

  const getStroke = (geoName: string, isHovered: boolean, isSelected: boolean): string => {
    if (isHovered) return HOVER_STROKE;
    if (isSelected) return SELECTED_STROKE;
    if (INSET_STATE_NAMES.has(geoName)) return INSET_STATE_STROKE;
    return "#ffffff";
  };

  const getStrokeWidth = (
    geoName: string,
    isHovered: boolean,
    isSelected: boolean,
    insetMap: boolean,
  ): number => {
    if (isHovered) return HOVER_STROKE_WIDTH;
    if (isSelected) return SELECTED_STROKE_WIDTH;
    if (insetMap || geoName === "Puerto Rico") return 0.8;
    return 1;
  };

  const renderGeography = (
    geo: GeographyType,
    hoveredLayer = false,
    insetMap = false,
  ): JSX.Element => {
    const geoName = geo.properties.name as string;
    const point = stateByName.get(geoName);
    const isHovered = hoveredLayer || hoveredState === geoName;
    const isSelected = isSelectedState(geoName);
    const isInteractive = onStateSelect != null;
    const useScreenSpaceStroke = isHovered || isSelected || insetMap;
    const strokeStyle = useScreenSpaceStroke
      ? ({ vectorEffect: "non-scaling-stroke" } as const)
      : {};

    return (
      <Geography
        key={hoveredLayer ? `${geo.rsmKey}-hover` : geo.rsmKey}
        geography={geo}
        fill={isHovered ? HOVER_FILL : getFill(geoName)}
        stroke={getStroke(geoName, isHovered, isSelected)}
        strokeWidth={getStrokeWidth(geoName, isHovered, isSelected, insetMap)}
        style={{
          default: {
            outline: "none",
            transition: "fill 0.15s ease, stroke 0.15s ease",
            strokeLinejoin: "round",
            strokeLinecap: "round",
            cursor: isInteractive ? "pointer" : "default",
            ...strokeStyle,
          },
          hover: { outline: "none", cursor: isInteractive ? "pointer" : "default", ...strokeStyle },
          pressed: { outline: "none", ...strokeStyle },
        }}
        onMouseUp={(e) => {
          e.preventDefault();
          handleStateClick(geoName);
        }}
        onMouseEnter={(event) => {
          setHoveredState(geoName);
          setTooltip({
            stateName: geoName,
            count: point?.count ?? 0,
            totalFunding: point?.total_funding ?? 0,
          });
          updatePointerFromEvent(event);
        }}
        onMouseMove={updatePointerFromEvent}
        onMouseLeave={(e) => {
          if (isPointerStillOverMap(e)) return;
          clearHover();
        }}
      />
    );
  };

  const splitGeographyLayers = (
    geographies: GeographyType[],
    insetMap = false,
  ): { baseLayer: JSX.Element[]; selectedLayer: JSX.Element[]; hoverLayer: JSX.Element[] } => {
    const geoName = (geo: GeographyType): string => geo.properties.name as string;

    const isElevated = (name: string): boolean =>
      name === hoveredState || name === selectedGeoName;

    const baseLayer = geographies
      .filter((geo) => !isElevated(geoName(geo)))
      .map((geo) => renderGeography(geo, false, insetMap));

    const selectedLayer =
      selectedGeoName && selectedGeoName !== hoveredState
        ? geographies
            .filter((geo) => geoName(geo) === selectedGeoName)
            .map((geo) => renderGeography(geo, false, insetMap))
        : [];

    const hoverLayer = hoveredState
      ? geographies
          .filter((geo) => geoName(geo) === hoveredState)
          .map((geo) => renderGeography(geo, true, insetMap))
      : [];

    return { baseLayer, selectedLayer, hoverLayer };
  };

  const renderNationOutline = (geographies: GeographyType[]): JSX.Element[] =>
    geographies.map((geo) => (
      <Geography
        key={`outline-${geo.rsmKey}`}
        geography={geo}
        fill="none"
        stroke={MAP_OUTLINE_STROKE}
        strokeWidth={1.25}
        style={{
          default: {
            outline: "none",
            pointerEvents: "none",
            strokeLinejoin: "round",
            strokeLinecap: "round",
          },
          hover: { outline: "none", pointerEvents: "none" },
          pressed: { outline: "none", pointerEvents: "none" },
        }}
      />
    ));

  return (
    <div className={cn(CLS_DASHBOARD_PANEL_SHELL, "pb-[0.9rem] relative flex h-full min-h-0 w-full flex-1 flex-col")}>
      <div className={CLS_DASHBOARD_PANEL_HEADER}>Projects by State</div>
      <div
        ref={mapCanvasRef}
        className="-mt-[0.2rem] relative min-h-0 flex-1 overflow-visible"
        data-map-canvas
        onMouseLeave={clearHover}
      >
        {tooltip != null && pointerPos != null ? (
          <div
            ref={tooltipRef}
            className={cn(CLS_CHART_CURSOR_TOOLTIP, "pointer-events-none absolute z-10")}
            style={{
              ...CHART_TOOLTIP_ROUNDED_STYLE,
              left: tooltipPos?.x ?? pointerPos.x,
              top: tooltipPos?.y ?? pointerPos.y,
              visibility: tooltipPos ? "visible" : "hidden",
            }}
          >
            <div className="text-text-primary font-semibold mb-1 text-[0.82rem]">{tooltip.stateName}</div>
            <div className="text-text-secondary">Projects: {tooltip.count.toLocaleString()}</div>
            <div className="text-text-secondary">
              Funding: {formatDollarsCompact(tooltip.totalFunding)}
            </div>
          </div>
        ) : null}
        <ComposableMap
          projection="geoAlbersUsa"
          projectionConfig={{ scale: 950 }}
          width={700}
          height={500}
          style={{ width: "100%", height: "auto" }}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }: { geographies: GeographyType[] }) => {
              const { baseLayer, selectedLayer, hoverLayer } = splitGeographyLayers(geographies);
              return (
                <>
                  {baseLayer}
                  <Geographies geography={NATION_GEO_URL}>
                    {({ geographies: nationGeographies }: { geographies: GeographyType[] }) =>
                      renderNationOutline(nationGeographies)
                    }
                  </Geographies>
                  {selectedLayer}
                  {hoverLayer}
                </>
              );
            }}
          </Geographies>
        </ComposableMap>

        <div className="absolute left-[90%] top-[90%] w-[14px] overflow-visible pointer-events-auto [&_svg]:block [&_svg]:w-full [&_svg]:h-auto [&_svg]:overflow-visible">
          <ComposableMap
            projection="geoConicEqualArea"
            projectionConfig={{
              rotate: [66, 0],
              center: [0, 18],
              parallels: [8, 18],
              scale: 1400,
            }}
            width={30}
            height={16}
            style={{ overflow: "visible" }}
          >
            <Geographies geography={PR_GEO_URL}>
              {({ geographies }: { geographies: GeographyType[] }) => {
                const { baseLayer, selectedLayer, hoverLayer } = splitGeographyLayers(
                  geographies.filter((geo) => (geo.properties.name as string) === "Puerto Rico"),
                  true,
                );
                return (
                  <>
                    {baseLayer}
                    {selectedLayer}
                    {hoverLayer}
                  </>
                );
              }}
            </Geographies>
          </ComposableMap>
        </div>
      </div>
    </div>
  );
}
