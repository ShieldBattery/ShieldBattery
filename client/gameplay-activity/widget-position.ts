/**
 * Where the gameplay activity widget sits in its positioning area, on one axis. The offset is
 * measured from the nearer edge, so a widget parked against the far edge stays there when the
 * area grows or shrinks.
 */
export interface AxisPosition {
  edge: 'start' | 'end'
  offset: number
}

export interface WidgetPosition {
  x: AxisPosition
  y: AxisPosition
}

export const DEFAULT_WIDGET_POSITION: WidgetPosition = {
  x: { edge: 'start', offset: 0 },
  y: { edge: 'start', offset: 0 },
}

function parseAxis(value: unknown): AxisPosition | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const { edge, offset } = value as Partial<Record<keyof AxisPosition, unknown>>
  if ((edge !== 'start' && edge !== 'end') || typeof offset !== 'number' || !isFinite(offset)) {
    return undefined
  }
  return { edge, offset: Math.max(0, offset) }
}

/** Reads a stored position, falling back to the default for anything of the wrong shape. */
export function parseWidgetPosition(value: unknown): WidgetPosition {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_WIDGET_POSITION
  }
  const x = parseAxis((value as Partial<Record<keyof WidgetPosition, unknown>>).x)
  const y = parseAxis((value as Partial<Record<keyof WidgetPosition, unknown>>).y)
  return x && y ? { x, y } : DEFAULT_WIDGET_POSITION
}

interface Size {
  width: number
  height: number
}

function anchorAxis(start: number, areaLength: number, widgetLength: number): AxisPosition {
  const maxStart = Math.max(0, areaLength - widgetLength)
  if (maxStart === 0) {
    // Nothing to anchor against: the widget fills or overflows the area
    return { edge: 'start', offset: 0 }
  }
  const clamped = Math.min(Math.max(start, 0), maxStart)
  return clamped + widgetLength / 2 > areaLength / 2
    ? { edge: 'end', offset: maxStart - clamped }
    : { edge: 'start', offset: clamped }
}

/**
 * Turns the widget's top-left corner, relative to the area's, into a position. The corner is
 * clamped so the widget lies fully inside the area, which is where it renders.
 */
export function anchorWidgetPosition(
  corner: { left: number; top: number },
  area: Size,
  widget: Size,
): WidgetPosition {
  return {
    x: anchorAxis(corner.left, area.width, widget.width),
    y: anchorAxis(corner.top, area.height, widget.height),
  }
}
