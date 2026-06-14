import {
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type FocusEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../utils/cn";

const HIDE_DELAY_MS = 120;
const VIEWPORT_PAD = 12;
const PANEL_GAP = 20;
const PANEL_MAX_WIDTH_PX = 296;

const CLS_HELP_TRIGGER =
  "border border-green bg-green-light text-[0.72rem] font-semibold leading-none text-green transition-[color,border-color,background] duration-150 hover:border-green hover:bg-green hover:text-white focus-visible:outline-2 focus-visible:outline-green focus-visible:outline-offset-2";

export const CLS_HELP_TRIGGER_ON_ACCENT =
  "border-white/50 bg-white/15 text-white hover:border-white hover:bg-white hover:text-accent focus-visible:outline-white";

type HelpTooltipPlacement = "below" | "after" | "before";

type HelpTooltipProps = {
  label: string;
  children: ReactNode;
  className?: string;
  placement?: HelpTooltipPlacement;
  /** When set, used as the hover/focus trigger instead of the default “?” icon. */
  trigger?: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
  /** Renders only the “?” icon (for nesting beside a label inside a control). */
  variant?: "default" | "icon";
  triggerClassName?: string;
};

type PanelCoords = {
  top: number;
  left: number;
  maxWidth: number;
  maxHeight: number;
};

function clampPanelPosition(
  anchor: DOMRect,
  panelWidth: number,
  panelHeight: number,
  placement: HelpTooltipPlacement,
): PanelCoords {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = VIEWPORT_PAD;
  const maxWidth = Math.min(PANEL_MAX_WIDTH_PX, vw - pad * 2);
  const maxHeight = vh - pad * 2;
  const width = Math.min(panelWidth, maxWidth);
  const height = Math.min(panelHeight, maxHeight);

  if (placement === "below") {
    let left = anchor.left + (anchor.width - width) / 2;
    left = Math.max(pad, Math.min(left, vw - pad - width));

    let top = anchor.bottom + PANEL_GAP;
    if (top + height > vh - pad) {
      top = anchor.top - PANEL_GAP - height;
    }
    top = Math.max(pad, Math.min(top, vh - pad - height));

    return { top, left, maxWidth, maxHeight };
  }

  let left =
    placement === "after"
      ? anchor.right + PANEL_GAP
      : anchor.left - PANEL_GAP - width;

  if (placement === "after" && left + width > vw - pad) {
    left = anchor.left - PANEL_GAP - width;
  } else if (placement === "before" && left < pad) {
    left = anchor.right + PANEL_GAP;
  }

  left = Math.max(pad, Math.min(left, vw - pad - width));

  let top = anchor.top + (anchor.height - height) / 2;
  top = Math.max(pad, Math.min(top, vh - pad - height));

  return { top, left, maxWidth, maxHeight };
}

function mergeFocusHandlers<E extends Element>(
  ours: (() => void) | undefined,
  theirs: ((event: FocusEvent<E>) => void) | undefined,
): ((event: FocusEvent<E>) => void) | undefined {
  if (!ours) return theirs;
  if (!theirs) return () => ours();
  return (event) => {
    ours();
    theirs(event);
  };
}

export default function HelpTooltip({
  label,
  children,
  className,
  placement = "below",
  trigger,
  variant = "default",
  triggerClassName,
}: HelpTooltipProps) {
  const isIconVariant = variant === "icon";
  const tooltipId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [panelCoords, setPanelCoords] = useState<PanelCoords | null>(null);

  const show = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    setOpen(true);
  }, []);

  const scheduleHide = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = setTimeout(() => setOpen(false), HIDE_DELAY_MS);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPanelCoords(null);
      return;
    }

    const anchorEl = rootRef.current?.firstElementChild as HTMLElement | null;
    const panelEl = panelRef.current;
    if (!anchorEl || !panelEl) return;

    const updatePosition = () => {
      const anchor = anchorEl.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pad = VIEWPORT_PAD;
      const maxWidth = Math.min(PANEL_MAX_WIDTH_PX, vw - pad * 2);
      const maxHeight = vh - pad * 2;
      const effectivePlacement = vw <= 900 ? "below" : placement;

      panelEl.style.width = `${maxWidth}px`;
      panelEl.style.maxHeight = `${maxHeight}px`;

      const { width: panelWidth, height: panelHeight } = panelEl.getBoundingClientRect();
      setPanelCoords(clampPanelPosition(anchor, panelWidth, panelHeight, effectivePlacement));
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, placement, label, children]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        (rootRef.current?.firstElementChild as HTMLElement | null)?.blur();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const panel =
    open ? (
      <div
        ref={panelRef}
        id={tooltipId}
        role="tooltip"
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
        style={{
          position: "fixed",
          top: panelCoords?.top ?? 0,
          left: panelCoords?.left ?? 0,
          maxWidth: panelCoords?.maxWidth ?? PANEL_MAX_WIDTH_PX,
          maxHeight: panelCoords?.maxHeight,
          visibility: panelCoords ? "visible" : "hidden",
        }}
        className="z-[100] overflow-y-auto rounded-md border-2 border-accent-text/60 bg-accent-light px-3 py-2.5 text-left text-[0.8rem] leading-[1.45] text-text-primary shadow-md dark:bg-surface"
      >
        <p className="mb-1.5 text-[0.72rem] font-semibold uppercase tracking-[0.04em] text-text-primary">
          {label}
        </p>
        {children}
      </div>
    ) : null;

  const defaultTrigger = (
    <button
      type="button"
      className={cn(
        "inline-flex h-[1.15rem] w-[1.15rem] shrink-0 items-center justify-center rounded-full",
        CLS_HELP_TRIGGER,
        triggerClassName,
      )}
      aria-label={label}
      aria-expanded={open}
      aria-controls={tooltipId}
      onFocus={show}
      onBlur={scheduleHide}
      onMouseEnter={isIconVariant ? show : undefined}
      onMouseLeave={isIconVariant ? scheduleHide : undefined}
      onMouseDown={isIconVariant ? (event) => event.stopPropagation() : undefined}
      onClick={isIconVariant ? (event) => event.stopPropagation() : undefined}
    >
      ?
    </button>
  );

  const triggerNode =
    trigger != null && isValidElement(trigger)
      ? cloneElement<ButtonHTMLAttributes<HTMLButtonElement>>(trigger, {
          "aria-expanded": open,
          "aria-controls": tooltipId,
          onFocus: mergeFocusHandlers(show, trigger.props.onFocus),
          onBlur: mergeFocusHandlers(scheduleHide, trigger.props.onBlur),
        })
      : defaultTrigger;

  return (
    <>
      <div
        ref={rootRef}
        className={cn("relative inline-flex shrink-0", className)}
        onMouseEnter={isIconVariant ? undefined : show}
        onMouseLeave={isIconVariant ? undefined : scheduleHide}
      >
        {triggerNode}
      </div>
      {panel ? createPortal(panel, document.body) : null}
    </>
  );
}
