export type Size2D = { width: number; height: number };
export type Point2D = { x: number; y: number };

type ClampTooltipOptions = {
  pad?: number;
  offset?: number;
};

/**
 * Positions a tooltip near a pointer while keeping it inside a container box.
 * Coordinates are relative to the container's top-left corner.
 */
export function clampTooltipToContainer(
  pointer: Point2D,
  tooltipSize: Size2D,
  containerSize: Size2D,
  options?: ClampTooltipOptions,
): Point2D {
  const pad = options?.pad ?? 8;
  const offset = options?.offset ?? 12;
  const { width: tw, height: th } = tooltipSize;
  const { width: cw, height: ch } = containerSize;

  let left = pointer.x + offset;
  let top = pointer.y - th - offset;

  if (top < pad) {
    top = pointer.y + offset;
  }
  if (left + tw > cw - pad) {
    left = pointer.x - tw - offset;
  }
  if (left < pad) {
    left = pad;
  }
  if (top + th > ch - pad) {
    top = ch - th - pad;
  }
  if (top < pad) {
    top = pad;
  }

  return { x: left, y: top };
}

/**
 * Keeps a fixed-position panel inside the viewport (for portaled tooltips).
 */
export function clampFixedPanelToViewport(
  anchor: DOMRect,
  panelSize: Size2D,
  options?: { pad?: number; gap?: number; preferBelow?: boolean },
): Point2D {
  const pad = options?.pad ?? 12;
  const gap = options?.gap ?? 8;
  const preferBelow = options?.preferBelow ?? true;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const { width: pw, height: ph } = panelSize;

  let left = anchor.left + anchor.width / 2 - pw / 2;
  left = Math.max(pad, Math.min(left, vw - pad - pw));

  let top = preferBelow ? anchor.bottom + gap : anchor.top - gap - ph;
  if (preferBelow && top + ph > vh - pad) {
    top = anchor.top - gap - ph;
  }
  if (!preferBelow && top < pad) {
    top = anchor.bottom + gap;
  }
  top = Math.max(pad, Math.min(top, vh - pad - ph));

  return { x: left, y: top };
}
