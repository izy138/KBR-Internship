import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type TransitionEvent,
} from "react";
import type { ProjectTermThemeCloudResponse, TermNode } from "../../api";
import HelpTooltip from "../shared/HelpTooltip";
import { cn } from "../../utils/cn";
import { CLS_DASHBOARD_PANEL_HEADER, CLS_DASHBOARD_PANEL_SHELL } from "../../utils/chartStyles";
import { HELP_DASHBOARD_TERM_THEMES } from "../../utils/helpContent";

type Props = {
  payload: ProjectTermThemeCloudResponse;
  onSearch?: (terms: string[]) => void;
};

const HUES = [210, 160, 280, 25, 130, 340, 55, 190];
const MAX_SELECTION = 20;

const VIEWBOX_PAD_X = 12;
const VIEWBOX_PAD_Y = 16;
const SUB_TRUNK_LENGTH = 50;
const SUB_BRANCH_LENGTH = 120;
const SUB_GAP_Y = 60;
const LIST_ITEM_HEIGHT = 52;
const LIST_ITEM_GAP = 20;
const LIST_ITEM_STEP = LIST_ITEM_HEIGHT + LIST_ITEM_GAP;
const LIST_HUB_GAP_PX = 54;
const EXPAND_MIN_W = 320;
const TERMS_PANEL_WIDTH = "28rem";
const LIST_WIDTH_CLASS = "w-[13.5rem]";

function expansionContentWidthPx(hubWidthPx: number): number {
  const maxSubHalfW = SUB_NODE_HALF_W + 2;
  const childColumnX = spineXFromHub(LIST_HUB_GAP_PX, hubWidthPx) + SUB_BRANCH_LENGTH;
  return Math.max(EXPAND_MIN_W, Math.ceil(childColumnX + maxSubHalfW + VIEWBOX_PAD_X));
}
const FLYOUT_MS = 480;
const FLYOUT_SWITCH_RETURN_MS = 260;
const FLYOUT_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

function flyoutTransition(ms: number): string {
  return `transform ${ms}ms ${FLYOUT_EASE}, background-color ${ms}ms ${FLYOUT_EASE}, border-color ${ms}ms ${FLYOUT_EASE}, color ${ms}ms ${FLYOUT_EASE}, box-shadow ${ms}ms ${FLYOUT_EASE}`;
}
const PANEL_MS = 400;
const SUB_OPEN_MS = 150;
const SUB_STAGGER_MS = 28;
const SUB_REVEAL_BASE_MS = 48;
const SUB_OPEN_EASE = "cubic-bezier(0.33, 1, 0.68, 1)";
const SUB_TRUNK_DRAW_MS = 160;
const SUB_SPINE_DRAW_MS = 100;
const SUB_BRANCH_DRAW_MS = 160;
const SUB_BRANCH_DRAW_STAGGER_MS = 32;
const SUB_NODE_SCALE_HIDDEN = 0.96;
function pillCornerRadius(box: NodeBox): number {
  return Math.min(box.halfW, box.halfH);
}
const CHAR_WIDTH_RATIO = 0.55;
const CAT_LABEL_MAX_CHARS = 24;
const CAT_MIN_HALF_W = 58;
const CAT_MIN_HALF_H = 24;
const CAT_WIDTH_TO_HEIGHT = 1.55;
const CAT_FONT_PX = 14;
const SUB_FONT_PX = 14;
const SUB_NODE_HALF_W = 82;
const SUB_NODE_HALF_H = 22;
const SUB_LABEL_MAX_CHARS = 18;
const CAT_FONT_CLASS = "text-[14px]";
const CAT_BUTTON_LAYOUT =
  "flex items-center justify-center text-center px-3 py-2.5 leading-snug";

const TERM_CHIP_BASE =
  "inline-flex items-center justify-center h-7 max-w-full px-[0.55rem] rounded-full border text-[0.82rem] leading-none font-[inherit] whitespace-nowrap cursor-pointer transition-[background,border-color,color] duration-[120ms] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2";

const TERM_CHIP_IDLE =
  "border-border bg-bg text-text-secondary hover:border-text-muted hover:text-text-primary";

const TERM_CHIP_SELECTED = "border-accent bg-accent-light text-accent-text font-medium";

const DEFAULT_THEME_CAT_LABEL = "Engineering";
const DEFAULT_THEME_SUB_LABEL = "Biomedical Engineering";

function resolveDefaultThemeOpen(tree: TermNode[]): { catId: string; subId: string } | null {
  const categories = tree.filter((node) => node.label !== "Low confidence");
  const category = categories.find((node) => node.label === DEFAULT_THEME_CAT_LABEL);
  const subcategory = category?.children?.find((node) => node.label === DEFAULT_THEME_SUB_LABEL);
  if (!category?.id || !subcategory?.id) {
    return null;
  }
  return { catId: category.id, subId: subcategory.id };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** SVG fontSize is in viewBox units; convert desired CSS px to match on-screen size. */
function svgFontSizeInUserUnits(cssPx: number, viewBoxWidth: number, displayWidthPx: number): number {
  if (displayWidthPx <= 0 || viewBoxWidth <= 0) return cssPx;
  return cssPx * (viewBoxWidth / displayWidthPx);
}

function splitLabel(label: string, maxCharsPerLine = 14): string[] {
  if (label.includes(" & ")) {
    return label.split(" & ");
  }
  if (label.length <= maxCharsPerLine) {
    return [label];
  }
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxCharsPerLine) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word.length > maxCharsPerLine ? word.slice(0, maxCharsPerLine) : word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [label];
}

type NodeBox = {
  halfW: number;
  halfH: number;
};

function boxForInsideText(
  lines: string[],
  fontSize: number,
  minHalfW: number,
  maxHalfW: number,
  minHalfH: number,
  maxHalfH: number,
  padX = 10,
  padY = 8,
): NodeBox {
  const lineHeight = fontSize * 1.25;
  const maxChars = Math.max(...lines.map((l) => l.length), 1);
  const halfW = clamp(maxChars * fontSize * CHAR_WIDTH_RATIO * 0.5 + padX, minHalfW, maxHalfW);
  const halfH = clamp((lines.length * lineHeight) / 2 + padY, minHalfH, maxHalfH);
  return { halfW, halfH };
}

function uniformCatNodeBox(categories: TermNode[], fontSize: number): NodeBox {
  let halfW = CAT_MIN_HALF_W;
  let halfH = CAT_MIN_HALF_H;
  for (const cat of categories) {
    const lines = splitLabel(cat.label, CAT_LABEL_MAX_CHARS);
    const needed = boxForInsideText(lines, fontSize, 0, Infinity, 0, Infinity, 16, 12);
    halfW = Math.max(halfW, needed.halfW);
    halfH = Math.max(halfH, needed.halfH);
  }
  if (halfW < halfH * CAT_WIDTH_TO_HEIGHT) {
    halfW = halfH * CAT_WIDTH_TO_HEIGHT;
  }
  return { halfW, halfH };
}

function rectEdgePoint(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  towardX: number,
  towardY: number,
): [number, number] {
  const dx = towardX - cx;
  const dy = towardY - cy;
  if (dx === 0 && dy === 0) {
    return [cx, cy];
  }
  const scale = 1 / Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH, 1e-6);
  return [cx + dx * scale, cy + dy * scale];
}

function hubExitX(hubGapPx: number, hubWidthPx: number): number {
  return hubGapPx + hubWidthPx;
}

function spineXFromHub(hubGapPx: number, hubWidthPx: number): number {
  return hubExitX(hubGapPx, hubWidthPx) + SUB_TRUNK_LENGTH;
}

type BusSegment = {
  d: string;
  delayMs: number;
  drawMs: number;
};

function subcatBusSegments(
  hubGapPx: number,
  hubWidthPx: number,
  hubY: number,
  subPositions: [number, number][],
  subBoxes: NodeBox[],
): BusSegment[] {
  if (subPositions.length === 0) return [];
  const exitX = hubExitX(hubGapPx, hubWidthPx);
  const spineX = spineXFromHub(hubGapPx, hubWidthPx);
  const segments: BusSegment[] = [
    {
      d: `M ${exitX} ${hubY} L ${spineX} ${hubY}`,
      delayMs: 0,
      drawMs: SUB_TRUNK_DRAW_MS,
    },
  ];

  if (subPositions.length === 1) {
    const [sx, sy] = subPositions[0];
    const box = subBoxes[0];
    const [childX] = rectEdgePoint(sx, sy, box.halfW, box.halfH, spineX, sy);
    segments.push({
      d: `M ${spineX} ${sy} L ${childX} ${sy}`,
      delayMs: Math.round(SUB_TRUNK_DRAW_MS * 0.72),
      drawMs: SUB_BRANCH_DRAW_MS,
    });
    return segments;
  }

  const childYs = subPositions.map(([, sy]) => sy);
  const spineTop = Math.min(...childYs);
  const spineBottom = Math.max(...childYs);
  segments.push({
    d: `M ${spineX} ${spineTop} L ${spineX} ${spineBottom}`,
    delayMs: Math.round(SUB_TRUNK_DRAW_MS * 0.68),
    drawMs: SUB_SPINE_DRAW_MS,
  });

  const branchBaseDelay = Math.round(SUB_TRUNK_DRAW_MS * 0.55 + SUB_SPINE_DRAW_MS * 0.55);
  subPositions.forEach(([sx, sy], i) => {
    const box = subBoxes[i];
    const [childX] = rectEdgePoint(sx, sy, box.halfW, box.halfH, spineX, sy);
    segments.push({
      d: `M ${spineX} ${sy} L ${childX} ${sy}`,
      delayMs: branchBaseDelay + i * SUB_BRANCH_DRAW_STAGGER_MS,
      drawMs: SUB_BRANCH_DRAW_MS,
    });
  });

  return segments;
}

function subNodeRevealDelayMs(branchDelayMs: number): number {
  return branchDelayMs + Math.round(SUB_BRANCH_DRAW_MS * 0.55);
}

const KEYWORDS_REVEAL_GAP_MS = 120;

function firstSubAutoSelectDelayMs(subCount: number): number {
  if (subCount <= 0) return 0;
  const branchDelayMs =
    subCount === 1
      ? Math.round(SUB_TRUNK_DRAW_MS * 0.72)
      : Math.round(SUB_TRUNK_DRAW_MS * 0.55 + SUB_SPINE_DRAW_MS * 0.55);
  return subNodeRevealDelayMs(branchDelayMs) + SUB_OPEN_MS;
}

function listSlotTop(index: number): number {
  return index * LIST_ITEM_STEP;
}

function listCenterY(count: number): number {
  if (count <= 0) return LIST_ITEM_HEIGHT / 2;
  const totalH = count * LIST_ITEM_HEIGHT + (count - 1) * LIST_ITEM_GAP;
  return totalH / 2;
}

function subcatListPositions(
  hubGapPx: number,
  hubWidthPx: number,
  hubY: number,
  count: number,
): [number, number][] {
  if (count === 0) return [];
  const subX = spineXFromHub(hubGapPx, hubWidthPx) + SUB_BRANCH_LENGTH;
  const totalSpan = (count - 1) * SUB_GAP_Y;
  const startY = hubY - totalSpan / 2;
  return Array.from({ length: count }, (_, i) => [subX, startY + i * SUB_GAP_Y]);
}

function expandLayoutMetrics(
  hubHalfH: number,
  hubWidthPx: number,
  subCount: number,
  maxSubHalfW: number,
  listCount: number,
): { hubY: number; svgW: number; svgH: number; viewBoxWidth: number; viewBox: string } {
  const listHeight = listCount * LIST_ITEM_HEIGHT + Math.max(0, listCount - 1) * LIST_ITEM_GAP;
  const listHubY = listCenterY(listCount);
  const subSpan = subCount > 0 ? (subCount - 1) * SUB_GAP_Y : 0;
  const childColumnX = spineXFromHub(LIST_HUB_GAP_PX, hubWidthPx) + SUB_BRANCH_LENGTH;
  const contentRight = childColumnX + maxSubHalfW + VIEWBOX_PAD_X;
  const contentBottom = Math.max(
    listHeight + VIEWBOX_PAD_Y,
    listHubY + hubHalfH + VIEWBOX_PAD_Y,
    listHubY + subSpan / 2 + hubHalfH + VIEWBOX_PAD_Y,
  );
  const svgW = Math.max(EXPAND_MIN_W, contentRight);
  const svgH = Math.max(listHeight, contentBottom);
  const hubY = svgH / 2;
  const viewBoxWidth = svgW + VIEWBOX_PAD_X * 2;
  const viewBox = `${-VIEWBOX_PAD_X} ${-VIEWBOX_PAD_Y} ${viewBoxWidth} ${svgH + VIEWBOX_PAD_Y * 2}`;
  return { hubY, svgW, svgH, viewBoxWidth, viewBox };
}

function subOpenDelay(index: number): string {
  return `${SUB_REVEAL_BASE_MS + index * SUB_STAGGER_MS}ms`;
}

type CatNodeLayout = {
  cat: TermNode;
  hue: number;
  box: NodeBox;
  lines: string[];
};

function subNodeBox(selected: boolean): NodeBox {
  return selected
    ? { halfW: SUB_NODE_HALF_W + 2, halfH: SUB_NODE_HALF_H + 2 }
    : { halfW: SUB_NODE_HALF_W, halfH: SUB_NODE_HALF_H };
}

function expandBox(box: NodeBox, extra: number): NodeBox {
  return { halfW: box.halfW + extra, halfH: box.halfH + extra };
}

type InsideLabelProps = {
  x: number;
  y: number;
  lines: string[];
  fontSize: number;
  fill: string;
  fontWeight?: number;
  visible?: boolean;
};

type ThemeRectProps = {
  cx: number;
  cy: number;
  box: NodeBox;
  cornerRx: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  onClick?: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  ariaLabel: string;
  tabIndex?: number;
};

function ThemeRect({
  cx,
  cy,
  box,
  cornerRx,
  fill,
  stroke,
  strokeWidth,
  onClick,
  onKeyDown,
  ariaLabel,
  tabIndex = 0,
}: ThemeRectProps): ReactElement {
  const { halfW, halfH } = box;
  return (
    <rect
      x={cx - halfW}
      y={cy - halfH}
      width={halfW * 2}
      height={halfH * 2}
      rx={cornerRx}
      ry={cornerRx}
      style={{
        fill,
        stroke,
        strokeWidth,
        cursor: onClick ? "pointer" : "default",
        transition: `x ${SUB_OPEN_MS * 0.4}ms ${SUB_OPEN_EASE}, y ${SUB_OPEN_MS * 0.4}ms ${SUB_OPEN_EASE}, width ${SUB_OPEN_MS * 0.4}ms ${SUB_OPEN_EASE}, height ${SUB_OPEN_MS * 0.4}ms ${SUB_OPEN_EASE}, fill ${SUB_OPEN_MS * 0.4}ms ${SUB_OPEN_EASE}, stroke ${SUB_OPEN_MS * 0.4}ms ${SUB_OPEN_EASE}`,
      }}
      onClick={onClick}
      aria-label={ariaLabel}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? tabIndex : undefined}
      onKeyDown={onKeyDown}
    />
  );
}

function InsideLabel({
  x,
  y,
  lines,
  fontSize,
  fill,
  fontWeight = 500,
  visible = true,
}: InsideLabelProps): ReactElement {
  const lineHeight = fontSize * 1.2;
  const startDy = -((lines.length - 1) * lineHeight) / 2;

  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      dominantBaseline="middle"
      fontSize={fontSize}
      fontFamily="DM Sans, sans-serif"
      fill={fill}
      fontWeight={fontWeight}
      style={{
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.25s",
      }}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? startDy : lineHeight}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

type CategoryListButtonProps = {
  label: string;
  hue: number;
  onClick: () => void;
  hidden?: boolean;
  isHub?: boolean;
};

function CategoryListButton({
  label,
  hue,
  onClick,
  hidden = false,
  isHub = false,
}: CategoryListButtonProps): ReactElement {
  return (
    <button
      type="button"
      className={cn(
        "box-border w-full min-h-[3.25rem] rounded-full border-[1.5px] font-semibold cursor-pointer transition-[background,border-color,box-shadow,opacity] duration-150 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        CAT_BUTTON_LAYOUT,
        CAT_FONT_CLASS,
        hidden && "invisible pointer-events-none",
        isHub && "shadow-sm",
      )}
      style={{
        backgroundColor: `hsl(${hue} 42% ${isHub ? 82 : 90}%)`,
        borderColor: `hsl(${hue} ${isHub ? 55 : 30}% ${isHub ? 45 : 72}%)`,
        color: `hsl(${hue} 48% ${isHub ? 22 : 28}%)`,
      }}
      onClick={onClick}
      aria-label={isHub ? `Close ${label}` : `Open ${label} theme`}
    >
      {label}
    </button>
  );
}

type CategoryFlyoutProps = {
  label: string;
  hue: number;
  listIndex: number;
  listCount: number;
  atHub: boolean;
  listWidthPx: number;
  snapPosition: boolean;
  moveMs: number;
  onClose: () => void;
  onTransitionEnd: () => void;
};

const CategoryFlyout = forwardRef<HTMLButtonElement, CategoryFlyoutProps>(function CategoryFlyout(
  { label, hue, listIndex, listCount, atHub, listWidthPx, snapPosition, moveMs, onClose, onTransitionEnd },
  ref,
): ReactElement {
  const hubLeft = listWidthPx + LIST_HUB_GAP_PX;
  const centerY = listCenterY(listCount);
  const translateX = atHub ? hubLeft : 0;
  const translateY = atHub ? centerY - LIST_ITEM_HEIGHT / 2 : listSlotTop(listIndex);

  const handleTransitionEnd = (event: TransitionEvent<HTMLButtonElement>): void => {
    if (event.propertyName === "transform") {
      onTransitionEnd();
    }
  };

  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        "box-border absolute top-0 left-0 z-20 min-h-[3.25rem] rounded-full border-[1px] font-semibold cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        CAT_BUTTON_LAYOUT,
        CAT_FONT_CLASS,
        atHub && "shadow-sm",
      )}
      style={{
        width: listWidthPx,
        backgroundColor: `hsl(${hue} 42% ${atHub ? 82 : 90}%)`,
        borderColor: `hsl(${hue} ${atHub ? 55 : 30}% ${atHub ? 45 : 72}%)`,
        color: `hsl(${hue} 48% ${atHub ? 22 : 28}%)`,
        transform: `translate3d(${translateX}px, ${translateY}px, 0)`,
        transition: snapPosition ? "none" : flyoutTransition(moveMs),
      }}
      onClick={onClose}
      onTransitionEnd={handleTransitionEnd}
      aria-label={`Close ${label}`}
    >
      {label}
    </button>
  );
});

export default function ProjectTermsThemeCloud({ payload, onSearch }: Props): ReactElement {
  const rawTree: TermNode[] = (payload.tree ?? []).filter((n) => n.label !== "Low confidence");
  const defaultOpen = useMemo(() => resolveDefaultThemeOpen(rawTree), [rawTree]);
  const opensByDefault = defaultOpen !== null;

  const [activeId, setActiveId] = useState<string | null>(defaultOpen?.catId ?? null);
  const [flyoutId, setFlyoutId] = useState<string | null>(defaultOpen?.catId ?? null);
  const [flyoutAtHub, setFlyoutAtHub] = useState(opensByDefault);
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);
  const [snapFlyoutPosition, setSnapFlyoutPosition] = useState(opensByDefault);
  const [flyoutMoveMs, setFlyoutMoveMs] = useState(FLYOUT_MS);
  const [subsMounted, setSubsMounted] = useState(opensByDefault);
  const [subsAnimatedIn, setSubsAnimatedIn] = useState(opensByDefault);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(defaultOpen?.subId ?? null);
  const [keywordsRevealed, setKeywordsRevealed] = useState(
    opensByDefault && defaultOpen?.subId != null,
  );
  const [selectedTerms, setSelectedTerms] = useState<Set<string>>(new Set());
  const [showMaxWarning, setShowMaxWarning] = useState(false);
  const listRef = useRef<HTMLElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLButtonElement>(null);
  const needsFlyToHubRef = useRef(false);
  const pendingAutoSelectCatIdRef = useRef<string | null>(null);
  const autoSelectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keywordsRevealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [listWidthPx, setListWidthPx] = useState(216);
  const [isMobileLayout, setIsMobileLayout] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches,
  );
  const buckets = (payload.buckets ?? []).filter((b) => b.label !== "Low confidence");

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const syncLayout = (): void => setIsMobileLayout(mq.matches);
    syncLayout();
    mq.addEventListener("change", syncLayout);
    return () => mq.removeEventListener("change", syncLayout);
  }, []);

  const catFontSize = CAT_FONT_PX;
  const catBox = uniformCatNodeBox(rawTree, catFontSize);

  const catNodes: CatNodeLayout[] = rawTree.map((cat, i) => {
    const hue = HUES[i % HUES.length];
    const lines = splitLabel(cat.label, CAT_LABEL_MAX_CHARS);
    return { cat, hue, box: catBox, lines };
  });

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const updateWidth = (): void => setListWidthPx(el.offsetWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(el);
    return () => observer.disconnect();
  }, [catNodes.length]);

  const clearAutoSelectTimers = useCallback((): void => {
    if (autoSelectTimeoutRef.current !== null) {
      clearTimeout(autoSelectTimeoutRef.current);
      autoSelectTimeoutRef.current = null;
    }
    if (keywordsRevealTimeoutRef.current !== null) {
      clearTimeout(keywordsRevealTimeoutRef.current);
      keywordsRevealTimeoutRef.current = null;
    }
  }, []);

  const resetSubsAnimation = useCallback((): void => {
    clearAutoSelectTimers();
    setSubsMounted(false);
    setSubsAnimatedIn(false);
    setKeywordsRevealed(false);
  }, [clearAutoSelectTimers]);

  const revealSubsAnimation = useCallback((): void => {
    setSubsMounted(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setSubsAnimatedIn(true));
    });
  }, []);

  const scheduleFlyToHub = useCallback((targetId: string): void => {
    requestAnimationFrame(() => {
      const el = flyoutRef.current;
      if (el) {
        void el.offsetWidth;
      }
      requestAnimationFrame(() => {
        setSnapFlyoutPosition(false);
        setFlyoutMoveMs(FLYOUT_MS);
        setFlyoutAtHub(true);
        setActiveId(targetId);
      });
    });
  }, []);

  useLayoutEffect(() => {
    if (!needsFlyToHubRef.current || flyoutId === null || listWidthPx <= 0) {
      return;
    }
    needsFlyToHubRef.current = false;
    setSnapFlyoutPosition(true);
    scheduleFlyToHub(flyoutId);
  }, [flyoutId, listWidthPx, scheduleFlyToHub]);

  const activeCatNode = catNodes.find((node) => node.cat.id === activeId) ?? null;
  const flyoutNode = catNodes.find((node) => node.cat.id === flyoutId) ?? null;
  const flyoutIndex = flyoutId !== null ? catNodes.findIndex((node) => node.cat.id === flyoutId) : -1;
  const listHeightPx =
    catNodes.length * LIST_ITEM_HEIGHT + Math.max(0, catNodes.length - 1) * LIST_ITEM_GAP;
  const expansionSlotWidthPx = useMemo(
    () => expansionContentWidthPx(listWidthPx > 0 ? listWidthPx : 216),
    [listWidthPx],
  );
  const selectedSub =
    activeCatNode?.cat.children?.find((sub) => sub.id === selectedSubId) ?? null;
  const expansionOpen = flyoutId !== null;
  const panelOpen = selectedSub !== null && keywordsRevealed;
  const clusterGridTemplate = useMemo(() => {
    if (!isMobileLayout) {
      return `13.5rem ${expansionSlotWidthPx}px ${TERMS_PANEL_WIDTH}`;
    }
    const expansionCol = expansionOpen ? `${expansionSlotWidthPx}px` : "0px";
    const termsCol = panelOpen ? TERMS_PANEL_WIDTH : "0px";
    return `13.5rem ${expansionCol} ${termsCol}`;
  }, [isMobileLayout, expansionOpen, expansionSlotWidthPx, panelOpen]);
  const leafTerms: TermNode[] = selectedSub?.children ?? [];
  const selectedCount = selectedTerms.size;
  const showSubs = subsMounted && activeId !== null;

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el || !isMobileLayout) return;
    el.scrollLeft = 0;
  }, [isMobileLayout, expansionOpen, panelOpen, flyoutId]);

  useEffect(() => {
    return () => clearAutoSelectTimers();
  }, [clearAutoSelectTimers]);

  useEffect(() => {
    if (!subsAnimatedIn || activeId === null) return;
    if (pendingAutoSelectCatIdRef.current !== activeId) return;

    const children = activeCatNode?.cat.children ?? [];
    const firstSubId = children[0]?.id;
    if (!firstSubId) {
      pendingAutoSelectCatIdRef.current = null;
      return;
    }

    const selectDelayMs = firstSubAutoSelectDelayMs(children.length);
    clearAutoSelectTimers();
    pendingAutoSelectCatIdRef.current = null;

    autoSelectTimeoutRef.current = setTimeout(() => {
      autoSelectTimeoutRef.current = null;
      setSelectedSubId(firstSubId);
      setSelectedTerms(new Set());
      setShowMaxWarning(false);
      keywordsRevealTimeoutRef.current = setTimeout(() => {
        keywordsRevealTimeoutRef.current = null;
        setKeywordsRevealed(true);
      }, KEYWORDS_REVEAL_GAP_MS);
    }, selectDelayMs);
  }, [subsAnimatedIn, activeId, activeCatNode, clearAutoSelectTimers]);

  const handleFlyoutTransitionEnd = useCallback((): void => {
    if (pendingSelectId !== null && !flyoutAtHub) {
      const nextId = pendingSelectId;
      setPendingSelectId(null);
      resetSubsAnimation();
      setFlyoutId(nextId);
      setSnapFlyoutPosition(true);
      setFlyoutAtHub(false);
      needsFlyToHubRef.current = true;
      return;
    }
    if (flyoutAtHub && activeId !== null && pendingSelectId === null) {
      revealSubsAnimation();
      return;
    }
    if (!flyoutAtHub && flyoutId !== null && activeId === null && pendingSelectId === null) {
      resetSubsAnimation();
      setFlyoutId(null);
    }
  }, [activeId, flyoutAtHub, flyoutId, pendingSelectId, resetSubsAnimation, revealSubsAnimation]);

  const handleCategoryClick = (catId: string): void => {
    clearAutoSelectTimers();
    setSelectedSubId(null);
    setKeywordsRevealed(false);
    setSelectedTerms(new Set());
    setShowMaxWarning(false);

    if (activeId === catId && flyoutAtHub) {
      pendingAutoSelectCatIdRef.current = null;
      setPendingSelectId(null);
      resetSubsAnimation();
      setSnapFlyoutPosition(false);
      setFlyoutAtHub(false);
      setActiveId(null);
      return;
    }

    if (flyoutId === null) {
      pendingAutoSelectCatIdRef.current = catId;
      setPendingSelectId(null);
      resetSubsAnimation();
      setActiveId(catId);
      setFlyoutId(catId);
      setFlyoutAtHub(false);
      needsFlyToHubRef.current = true;
      return;
    }

    if (activeId !== catId) {
      pendingAutoSelectCatIdRef.current = catId;
      setPendingSelectId(catId);
      resetSubsAnimation();
      setFlyoutMoveMs(FLYOUT_SWITCH_RETURN_MS);
      setSnapFlyoutPosition(false);
      setFlyoutAtHub(false);
      setActiveId(null);
    }
  };

  const handleFlyoutClose = (): void => {
    pendingAutoSelectCatIdRef.current = null;
    clearAutoSelectTimers();
    setPendingSelectId(null);
    resetSubsAnimation();
    setSnapFlyoutPosition(false);
    setFlyoutAtHub(false);
    setActiveId(null);
    setSelectedSubId(null);
    setKeywordsRevealed(false);
    setSelectedTerms(new Set());
    setShowMaxWarning(false);
  };

  const handleSubClick = (subId: string): void => {
    clearAutoSelectTimers();
    pendingAutoSelectCatIdRef.current = null;
    setSelectedSubId((prev) => {
      const next = prev === subId ? null : subId;
      setKeywordsRevealed(next !== null);
      return next;
    });
    setSelectedTerms(new Set());
    setShowMaxWarning(false);
  };

  const handleToggleLeaf = (label: string): void => {
    if (!selectedTerms.has(label) && selectedTerms.size >= MAX_SELECTION) {
      setShowMaxWarning(true);
      return;
    }
    setShowMaxWarning(false);
    setSelectedTerms((prev) => {
      const next = new Set(prev);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  };

  const handleSearch = (): void => {
    if (onSearch && selectedCount > 0) {
      onSearch([...selectedTerms]);
      setSelectedTerms(new Set());
      setShowMaxWarning(false);
    }
  };

  const handleClearAll = (): void => {
    setSelectedTerms(new Set());
    setShowMaxWarning(false);
  };

  return (
    <div className={cn(CLS_DASHBOARD_PANEL_SHELL, "pb-[0.9rem] min-h-0")}>
      <div className="flex items-center gap-2 flex-wrap mb-[0.65rem]">
        <div className={cn(CLS_DASHBOARD_PANEL_HEADER, "mb-0")}>Project Term Themes</div>
        <HelpTooltip label={HELP_DASHBOARD_TERM_THEMES.label}>
          {HELP_DASHBOARD_TERM_THEMES.body}
        </HelpTooltip>
      </div>

      {buckets.length === 0 ? (
        <p className="text-text-muted text-[0.875rem] mt-2 m-0">
          {payload.message ??
            "No theme data yet. Run: docker compose exec backend python indexer/build_project_term_theme_counts.py"}
        </p>
      ) : (
        <div
          ref={scrollContainerRef}
          className="flex w-full min-h-[24rem] lg:min-h-[28rem] min-[901px]:justify-center min-[901px]:overflow-visible max-[900px]:justify-start max-[900px]:overflow-x-auto max-[900px]:overflow-y-hidden max-[900px]:overscroll-x-contain max-[900px]:touch-pan-x max-[900px]:[-webkit-overflow-scrolling:touch]"
        >
          <div
            className={cn(
              "grid shrink-0 items-start gap-3",
              isMobileLayout && !expansionOpen && !panelOpen && "gap-0",
            )}
            style={{
              gridTemplateColumns: clusterGridTemplate,
              minHeight: listHeightPx,
            }}
          >
            <div className="relative min-w-0" style={{ minHeight: listHeightPx }}>
            <nav
              ref={listRef}
              className={cn("flex flex-col gap-5 min-w-0", LIST_WIDTH_CLASS)}
              aria-label="Theme categories"
            >
              {catNodes.map(({ cat, hue }) => (
                <CategoryListButton
                  key={cat.id}
                  label={cat.label}
                  hue={hue}
                  hidden={flyoutId === cat.id}
                  onClick={() => handleCategoryClick(cat.id)}
                />
              ))}
            </nav>

            {flyoutNode && flyoutIndex >= 0 && listWidthPx > 0 && (
              <CategoryFlyout
                key={flyoutId}
                ref={flyoutRef}
                label={flyoutNode.cat.label}
                hue={flyoutNode.hue}
                listIndex={flyoutIndex}
                listCount={catNodes.length}
                atHub={flyoutAtHub}
                listWidthPx={listWidthPx}
                snapPosition={snapFlyoutPosition}
                moveMs={flyoutMoveMs}
                onClose={handleFlyoutClose}
                onTransitionEnd={handleFlyoutTransitionEnd}
              />
            )}
            </div>

            <div
              className={cn(
                "flex flex-col items-start justify-start overflow-hidden min-w-0 transition-opacity ease-in-out",
                expansionOpen ? "opacity-100" : "opacity-0 pointer-events-none",
              )}
              style={{ transitionDuration: `${PANEL_MS}ms`, height: listHeightPx }}
              aria-hidden={!expansionOpen}
            >
              {showSubs && activeCatNode && (
                <div className="flex h-full max-h-[32rem] w-full items-start justify-start">
                  {(() => {
                    const { cat, hue, box } = activeCatNode;
                    const displayBox = expandBox(box, 4);
                    const subs: TermNode[] = cat.children ?? [];
                    const maxSubHalfW = SUB_NODE_HALF_W + 2;
                    const layout = expandLayoutMetrics(
                      displayBox.halfH,
                      listWidthPx,
                      subs.length,
                      maxSubHalfW,
                      catNodes.length,
                    );
                    const subPositions = subcatListPositions(
                      LIST_HUB_GAP_PX,
                      listWidthPx,
                      layout.hubY,
                      subs.length,
                    );
                    const subLabelFontSize = svgFontSizeInUserUnits(
                      SUB_FONT_PX,
                      layout.viewBoxWidth,
                      layout.svgW,
                    );
                    const subBoxes = subs.map((sub) => subNodeBox(selectedSubId === sub.id));
                    const busSegments =
                      subPositions.length > 0
                        ? subcatBusSegments(
                            LIST_HUB_GAP_PX,
                            listWidthPx,
                            layout.hubY,
                            subPositions,
                            subBoxes,
                          )
                        : [];

                    return (
                      <svg
                        viewBox={layout.viewBox}
                        preserveAspectRatio="xMinYMin meet"
                        className="block h-full max-w-full"
                        style={{ width: layout.svgW, minWidth: layout.svgW, maxWidth: expansionSlotWidthPx }}
                        aria-label={`${cat.label} subcategories`}
                      >
                        <g>
                        {busSegments.map((segment, segIndex) => (
                          <path
                            key={segIndex}
                            d={segment.d}
                            fill="none"
                            pathLength={1}
                            stroke={`hsl(${hue} 38% 62%)`}
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            style={{
                              strokeDasharray: 1,
                              strokeDashoffset: subsAnimatedIn ? 0 : 1,
                              opacity: subsAnimatedIn ? 0.9 : 0,
                              transition: subsAnimatedIn
                                ? `stroke-dashoffset ${segment.drawMs}ms ${SUB_OPEN_EASE} ${segment.delayMs}ms, opacity ${segment.drawMs * 0.4}ms ease ${segment.delayMs}ms`
                                : "none",
                              pointerEvents: "none",
                            }}
                          />
                        ))}

                        {subs.map((sub, si) => {
                          const [sx, sy] = subPositions[si];
                          const subLines = splitLabel(sub.label, SUB_LABEL_MAX_CHARS);
                          const isSubSelected = selectedSubId === sub.id;
                          const subBox = subNodeBox(isSubSelected);
                          const branchSegmentIndex = subs.length === 1 ? 1 : 2 + si;
                          const branchDelayMs =
                            busSegments[branchSegmentIndex]?.delayMs ??
                            SUB_REVEAL_BASE_MS + si * SUB_STAGGER_MS;
                          const animDelay = `${subNodeRevealDelayMs(branchDelayMs)}ms`;

                          return (
                            <g
                              key={sub.id}
                              style={{
                                cursor: "pointer",
                                opacity: subsAnimatedIn ? 1 : 0,
                                transform: subsAnimatedIn
                                  ? "scale(1)"
                                  : `scale(${SUB_NODE_SCALE_HIDDEN})`,
                                transformOrigin: `${sx}px ${sy}px`,
                                transformBox: "fill-box",
                                transition: subsAnimatedIn
                                  ? `opacity ${SUB_OPEN_MS * 0.5}ms ease ${animDelay}, transform ${SUB_OPEN_MS}ms ${SUB_OPEN_EASE} ${animDelay}`
                                  : "none",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSubClick(sub.id);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  handleSubClick(sub.id);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                              aria-label={`${sub.label} subcategory`}
                              aria-pressed={isSubSelected}
                            >
                              <ThemeRect
                                cx={sx}
                                cy={sy}
                                box={subBox}
                                cornerRx={pillCornerRadius(subBox)}
                                fill={`hsl(${hue} ${isSubSelected ? 35 : 28}% ${isSubSelected ? 82 : 88}%)`}
                                stroke={
                                  isSubSelected
                                    ? `hsl(${hue} 55% 42%)`
                                    : `hsl(${hue} 35% 68%)`
                                }
                                strokeWidth={isSubSelected ? 2 : 1.2}
                                ariaLabel={sub.label}
                                tabIndex={-1}
                              />
                              <InsideLabel
                                x={sx}
                                y={sy}
                                lines={subLines}
                                fontSize={subLabelFontSize}
                                fontWeight={700}
                                fill={`hsl(${hue} 40% 24%)`}
                              />
                            </g>
                          );
                        })}
                        </g>
                      </svg>
                    );
                  })()}
                </div>
              )}
            </div>

            <div
              className={cn(
                "flex min-w-0 flex-col overflow-hidden transition-opacity ease-in-out",
                panelOpen ? "opacity-100" : "opacity-0 pointer-events-none",
              )}
              style={{ transitionDuration: `${PANEL_MS}ms`, minHeight: listHeightPx }}
              aria-hidden={!panelOpen}
            >
            {selectedSub && activeCatNode ? (
              <div
                className="flex w-full flex-col gap-2 transition-opacity ease-out"
                style={{
                  transitionDuration: `${PANEL_MS}ms`,
                  opacity: panelOpen ? 1 : 0,
                }}
              >
                <div className="min-w-0">
                  <p className="text-[0.65rem] uppercase tracking-wide text-text-muted m-0 font-semibold">
                    {activeCatNode.cat.label}
                  </p>
                  <h4 className="text-text-primary text-[0.85rem] font-semibold m-0 leading-snug">
                    {selectedSub.label}
                  </h4>
                </div>

                {leafTerms.length === 0 ? (
                  <p className="text-text-muted text-[0.8rem] m-0">No terms in this subcategory.</p>
                ) : (
                  <div
                    className="flex flex-wrap gap-[0.4rem] w-full"
                    role="group"
                    aria-label={`Terms in ${selectedSub.label}`}
                  >
                    {leafTerms.map((leaf) => {
                      const isSelected = selectedTerms.has(leaf.label);
                      return (
                        <button
                          key={leaf.id}
                          type="button"
                          className={cn(
                            TERM_CHIP_BASE,
                            isSelected ? TERM_CHIP_SELECTED : TERM_CHIP_IDLE,
                          )}
                          onClick={() => handleToggleLeaf(leaf.label)}
                          aria-pressed={isSelected}
                          title={
                            leaf.weight != null
                              ? `${leaf.weight.toLocaleString()} corpus hits`
                              : undefined
                          }
                        >
                          {leaf.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {showMaxWarning && (
                  <p className="text-[0.75rem] text-text-muted m-0">
                    Maximum {MAX_SELECTION} terms
                  </p>
                )}
                {selectedCount > 0 && onSearch ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="bg-accent text-white border-none rounded-sm px-3 py-[0.38rem] font-sans text-[13px] font-medium cursor-pointer transition-[background] duration-150 hover:bg-accent-hover"
                      onClick={handleSearch}
                    >
                      Search {selectedCount} term{selectedCount > 1 ? "s" : ""}
                    </button>
                    <button
                      type="button"
                      className="bg-transparent border-none text-accent-text cursor-pointer text-[0.8rem] underline py-0 hover:text-text-primary"
                      onClick={handleClearAll}
                    >
                      Clear all
                    </button>
                  </div>
                ) : (
                  <p className="text-[0.72rem] text-text-muted m-0">
                    Select terms to search
                  </p>
                )}
              </div>
            ) : (
              <div className="min-h-px" aria-hidden />
            )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
