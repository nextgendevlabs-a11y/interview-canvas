import type { CanvasItem, ShapeElement, ConnectorElement } from '@/services/types';

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function getItemBounds(item: CanvasItem): Bounds {
  switch (item.kind) {
    case 'shape':
    case 'sticky':
      return { x: item.x, y: item.y, width: item.width, height: item.height };
    case 'text':
      return { x: item.x, y: item.y, width: item.width, height: item.height };
    case 'connector': {
      const from = getConnectorStart(item);
      const to = getConnectorEnd(item);
      const minX = Math.min(from.x, to.x);
      const minY = Math.min(from.y, to.y);
      return { x: minX, y: minY, width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) };
    }
    case 'freehand': {
      if (item.points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
      const xs = item.points.map((p) => p.x);
      const ys = item.points.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
    }
  }
}

export function getConnectorStart(c: ConnectorElement): { x: number; y: number } {
  if (c.from_point) return c.from_point;
  return { x: 0, y: 0 };
}

export function getConnectorEnd(c: ConnectorElement): { x: number; y: number } {
  if (c.to_point) return c.to_point;
  return { x: 0, y: 0 };
}

export function getShapeCenter(shape: ShapeElement): { x: number; y: number } {
  return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
}

export function getConnectorAnchorPoint(shape: ShapeElement, target: { x: number; y: number }): { x: number; y: number } {
  const center = getShapeCenter(shape);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const halfW = shape.width / 2;
  const halfH = shape.height / 2;
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const scale = absDx / halfW > absDy / halfH ? halfW / absDx : halfH / absDy;
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

export function pointInBounds(point: { x: number; y: number }, bounds: Bounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

export function distanceToStroke(
  point: { x: number; y: number },
  strokePoints: { x: number; y: number }[],
  threshold: number,
): boolean {
  for (let i = 0; i < strokePoints.length - 1; i++) {
    const p1 = strokePoints[i];
    const p2 = strokePoints[i + 1];
    const dist = pointToSegmentDistance(point, p1, p2);
    if (dist <= threshold) return true;
  }
  return false;
}

function pointToSegmentDistance(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function hitTest(
  items: Record<string, CanvasItem>,
  order: string[],
  point: { x: number; y: number },
): string | null {
  for (let i = order.length - 1; i >= 0; i--) {
    const item = items[order[i]];
    if (!item) continue;
    const bounds = getItemBounds(item);
    if (item.kind === 'freehand') {
      if (distanceToStroke(point, item.points, 8)) return item.id;
    } else if (item.kind === 'connector') {
      let from = item.from_point;
      let to = item.to_point;
      if (item.from_id && items[item.from_id]?.kind === 'shape') {
        const fromShape = items[item.from_id] as ShapeElement;
        const target = to ?? getShapeCenter(fromShape);
        from = getConnectorAnchorPoint(fromShape, target);
      }
      if (item.to_id && items[item.to_id]?.kind === 'shape') {
        const toShape = items[item.to_id] as ShapeElement;
        const source = from ?? getShapeCenter(toShape);
        to = getConnectorAnchorPoint(toShape, source);
      }
      if (!from || !to) continue;
      if (distanceToStroke(point, [from, to], 8)) return item.id;
    } else if (item.kind === 'text') {
      if (pointInBounds(point, bounds)) return item.id;
    } else {
      if (pointInBounds(point, bounds)) return item.id;
    }
  }
  return null;
}

export function hitTestRect(
  items: Record<string, CanvasItem>,
  order: string[],
  rect: Bounds,
): string[] {
  const result: string[] = [];
  for (const id of order) {
    const item = items[id];
    if (!item) continue;
    const bounds = getItemBounds(item);
    if (item.kind === 'text') {
      if (boundsIntersect(bounds, rect)) result.push(id);
    } else {
      if (boundsIntersect(bounds, rect)) result.push(id);
    }
  }
  return result;
}

export function computeBounds(ids: string[], items: Record<string, CanvasItem>): Bounds | null {
  if (ids.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const item = items[id];
    if (!item) continue;
    const b = getItemBounds(item);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
