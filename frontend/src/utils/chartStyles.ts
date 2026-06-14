import type { CSSProperties } from "react";
import { cn } from "./cn";

/** Inline radius so chart tooltips stay rounded inside Recharts portals. */
export const CHART_TOOLTIP_ROUNDED_STYLE: CSSProperties = {
  borderRadius: "var(--radius-md)",
};

/** Shared hover card for chart/map cursor tooltips (matches Projects & Funding by Year). */
export const CLS_CHART_HOVER_TOOLTIP =
  "bg-surface border border-border rounded-md overflow-hidden shadow-md text-[0.8125rem] pointer-events-none";

/** Cursor-following chart tooltip with standard padding and min width. */
export const CLS_CHART_CURSOR_TOOLTIP = cn(
  CLS_CHART_HOVER_TOOLTIP,
  "px-[0.875rem] py-[0.625rem] min-w-[160px]",
);

/** Strip Recharts' default square tooltip chrome so custom content can be rounded. */
export const RECHARTS_TOOLTIP_CONTENT_STYLE = {
  background: "transparent",
  border: "none",
  padding: 0,
  margin: 0,
  boxShadow: "none",
} as const;

export const RECHARTS_TOOLTIP_WRAPPER_STYLE = {
  outline: "none",
  zIndex: 1000,
  background: "transparent",
  border: "none",
  padding: 0,
  margin: 0,
  boxShadow: "none",
  maxWidth: "calc(100vw - 1.5rem)",
} as const;

/** Keep Recharts cursor tooltips inside the chart area instead of overflowing the page. */
export const RECHARTS_TOOLTIP_ESCAPE_VIEWBOX = { x: false, y: false } as const;

/** Dashboard panel shell — single top inset for all chart/map cards. */
export const CLS_DASHBOARD_PANEL_SHELL =
  "bg-surface border border-border rounded-[--radius-lg] w-full px-4 pt-[0.9rem]";

/** Dashboard panel title — shared size, weight, and spacing below the header row. */
export const CLS_DASHBOARD_PANEL_HEADER =
  "shrink-0 text-text-primary text-[0.9rem] font-semibold mb-[0.65rem]";

/** Scroll containers that can move a chart under a stationary pointer (e.g. app `<main>`). */
export function getScrollableAncestors(node: HTMLElement): HTMLElement[] {
  const scrollables: HTMLElement[] = [];
  let parent: HTMLElement | null = node.parentElement;
  while (parent != null) {
    const style = getComputedStyle(parent);
    const { overflow, overflowY, overflowX } = style;
    const scrollsY =
      overflowY === "auto" ||
      overflowY === "scroll" ||
      overflowY === "overlay" ||
      overflow === "auto" ||
      overflow === "scroll" ||
      overflow === "overlay";
    const scrollsX =
      overflowX === "auto" ||
      overflowX === "scroll" ||
      overflowX === "overlay";
    if (scrollsY || scrollsX) {
      scrollables.push(parent);
    }
    parent = parent.parentElement;
  }
  return scrollables;
}

/** Suppress browser/Recharts focus rings on chart SVG internals (click/hover must still work). */
export const CLS_RECHARTS_FOCUS_RESET =
  "[&_.recharts-wrapper_*:focus]:outline-none [&_.recharts-wrapper_*:focus-visible]:outline-none [&_.recharts-wrapper_*:focus]:ring-0 [&_.recharts-wrapper_*:focus-visible]:ring-0 [&_.recharts-wrapper:focus]:outline-none [&_.recharts-wrapper:focus-visible]:outline-none [&_.recharts-wrapper_svg:focus]:outline-none [&_.recharts-wrapper_svg:focus-visible]:outline-none [&_.recharts-responsive-container:focus]:outline-none [&_.recharts-responsive-container:focus-visible]:outline-none [&_.recharts-surface:focus]:outline-none [&_.recharts-surface:focus-visible]:outline-none [&_.recharts-sector:focus]:outline-none [&_.recharts-sector:focus-visible]:outline-none [&_.recharts-pie-sector:focus]:outline-none [&_.recharts-pie-sector:focus-visible]:outline-none [&_.recharts-bar-rectangle:focus]:outline-none [&_.recharts-bar-rectangle:focus-visible]:outline-none [&_.recharts-rectangle:focus]:outline-none [&_.recharts-rectangle:focus-visible]:outline-none [&_.recharts-active-bar:focus]:outline-none [&_.recharts-active-bar:focus-visible]:outline-none [&_.recharts-layer_path:focus]:outline-none [&_.recharts-layer_path:focus-visible]:outline-none [&_.recharts-line-curve:focus]:outline-none [&_.recharts-line-curve:focus-visible]:outline-none [&_.recharts-dot:focus]:outline-none [&_.recharts-dot:focus-visible]:outline-none [&_.recharts-active-dot:focus]:outline-none [&_.recharts-active-dot:focus-visible]:outline-none [&_.recharts-wrapper_rect:focus]:outline-none [&_.recharts-wrapper_rect:focus-visible]:outline-none [&_.recharts-tooltip-wrapper]:!bg-transparent [&_.recharts-tooltip-wrapper]:!border-0 [&_.recharts-tooltip-wrapper]:!p-0 [&_.recharts-tooltip-wrapper]:!shadow-none [&_.recharts-default-tooltip]:!m-0 [&_.recharts-default-tooltip]:!rounded-md [&_.recharts-default-tooltip]:!border-0 [&_.recharts-default-tooltip]:!bg-transparent [&_.recharts-default-tooltip]:!p-0 [&_.recharts-default-tooltip]:!shadow-none";
