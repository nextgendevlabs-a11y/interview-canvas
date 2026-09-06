import { describe, it, expect } from 'vitest';
import {
  getItemBounds,
  pointInBounds,
  boundsIntersect,
  hitTest,
  hitTestRect,
  computeBounds,
  getShapeCenter,
  getConnectorAnchorPoint,
} from '@/canvas/geometry';
import { createShape, createConnector, createFreehandStroke, createSticky } from '@/canvas/reducer';
import type { ShapeElement } from '@/services/types';
import { PALETTE, getPaletteComponent, PARTICIPANT_COLORS } from '@/canvas/palette';

describe('geometry - getItemBounds', () => {
  it('returns bounds for a shape', () => {
    const shape = createShape('service', 100, 200, 160, 80, 'API', '#3b82f6');
    const bounds = getItemBounds(shape);
    expect(bounds).toEqual({ x: 100, y: 200, width: 160, height: 80 });
  });

  it('returns bounds for a sticky note', () => {
    const sticky = createSticky(50, 60, 'Note');
    const bounds = getItemBounds(sticky);
    expect(bounds).toEqual({ x: 50, y: 60, width: 140, height: 120 });
  });

  it('returns bounds for a freehand stroke', () => {
    const stroke = createFreehandStroke([{ x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 10 }], '#f00', 3);
    const bounds = getItemBounds(stroke);
    expect(bounds.x).toBe(10);
    expect(bounds.y).toBe(10);
    expect(bounds.width).toBe(40);
    expect(bounds.height).toBe(30);
  });
});

describe('geometry - pointInBounds', () => {
  it('detects point inside bounds', () => {
    expect(pointInBounds({ x: 50, y: 50 }, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
  expect(pointInBounds({ x: 150, y: 50 }, { x: 0, y: 0, width: 100, height: 100 })).toBe(false);
  expect(pointInBounds({ x: 0, y: 0 }, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
    expect(pointInBounds({ x: 100, y: 100 }, { x: 0, y: 0, width: 100, height: 100 })).toBe(true);
  });
});

describe('geometry - boundsIntersect', () => {
  it('detects overlapping bounds', () => {
    expect(boundsIntersect({ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 50, width: 100, height: 100 })).toBe(true);
    expect(boundsIntersect({ x: 0, y: 0, width: 100, height: 100 }, { x: 200, y: 200, width: 50, height: 50 })).toBe(false);
  });
});

describe('geometry - hitTest', () => {
  it('hits a shape at its center', () => {
    const shape = createShape('service', 100, 100, 160, 80, 'API', '#3b82f6');
    const items = { [shape.id]: shape };
    const order = [shape.id];
    expect(hitTest(items, order, { x: 180, y: 140 })).toBe(shape.id);
    expect(hitTest(items, order, { x: 50, y: 50 })).toBeNull();
  });

  it('hits a freehand stroke near its points', () => {
    const stroke = createFreehandStroke([{ x: 0, y: 0 }, { x: 100, y: 0 }], '#f00', 3);
    const items = { [stroke.id]: stroke };
    const order = [stroke.id];
    expect(hitTest(items, order, { x: 50, y: 0 })).toBe(stroke.id);
    expect(hitTest(items, order, { x: 50, y: 50 })).toBeNull();
  });

  it('hits a connector attached to shapes', () => {
    const shape1 = createShape('service', 0, 0, 100, 80, 'A', '#3b82f6');
    const shape2 = createShape('service', 300, 0, 100, 80, 'B', '#3b82f6');
    const connector = createConnector(shape1.id, shape2.id, null, null);
    const items = { [shape1.id]: shape1, [shape2.id]: shape2, [connector.id]: connector };
    const order = [shape1.id, shape2.id, connector.id];

    expect(hitTest(items, order, { x: 200, y: 40 })).toBe(connector.id);
  });
});

describe('geometry - hitTestRect', () => {
  it('selects shapes intersecting a rectangle', () => {
    const s1 = createShape('service', 0, 0, 100, 100, 'A', '#3b82f6');
    const s2 = createShape('service', 200, 200, 100, 100, 'B', '#3b82f6');
    const items = { [s1.id]: s1, [s2.id]: s2 };
    const order = [s1.id, s2.id];
    const result = hitTestRect(items, order, { x: -10, y: -10, width: 120, height: 120 });
    expect(result).toContain(s1.id);
    expect(result).not.toContain(s2.id);
  });
});

describe('geometry - computeBounds', () => {
  it('computes combined bounds of multiple items', () => {
    const s1 = createShape('service', 0, 0, 100, 100, 'A', '#3b82f6');
    const s2 = createShape('service', 200, 200, 100, 100, 'B', '#3b82f6');
    const items = { [s1.id]: s1, [s2.id]: s2 };
    const bounds = computeBounds([s1.id, s2.id], items);
    expect(bounds).toEqual({ x: 0, y: 0, width: 300, height: 300 });
  });

  it('returns null for empty selection', () => {
    expect(computeBounds([], {})).toBeNull();
  });
});

describe('geometry - connector anchors', () => {
  it('computes shape center', () => {
    const shape = createShape('service', 100, 100, 160, 80, 'A', '#3b82f6') as ShapeElement;
    expect(getShapeCenter(shape)).toEqual({ x: 180, y: 140 });
  });

  it('computes anchor point toward a target', () => {
    const shape = createShape('service', 100, 100, 160, 80, 'A', '#3b82f6') as ShapeElement;
    const anchor = getConnectorAnchorPoint(shape, { x: 500, y: 140 });
    expect(anchor.x).toBe(260);
    expect(anchor.y).toBe(140);
  });
});

describe('palette', () => {
  it('has all 6 categories', () => {
    const categories = new Set(PALETTE.map((c) => c.category));
    expect(categories.has('General')).toBe(true);
    expect(categories.has('Data')).toBe(true);
    expect(categories.has('Messaging')).toBe(true);
    expect(categories.has('Network')).toBe(true);
    expect(categories.has('Compute')).toBe(true);
    expect(categories.has('AI')).toBe(true);
  });

  it('looks up a component by type', () => {
    const comp = getPaletteComponent('rds');
    expect(comp).toBeDefined();
    expect(comp!.label).toBe('Relational DB');
  });

  it('returns undefined for unknown type', () => {
    expect(getPaletteComponent('nonexistent')).toBeUndefined();
  });

  it('has 10 participant colors', () => {
    expect(PARTICIPANT_COLORS).toHaveLength(10);
  });
});
