import { describe, it, expect, beforeEach } from 'vitest';
import { resetMockService, getMockService } from '@/services/mockInterviewService';
import { createEmptySnapshot, applyOperation, createShape, createConnector, createFreehandStroke, createText, createSticky, createHistory, pushHistory, undo, redo } from '@/canvas/reducer';
import type { ShapeElement, FreehandStroke, TextLabelElement, StickyNoteElement, ConnectorElement } from '@/services/types';

describe('canvas reducer', () => {
  it('creates an empty snapshot', () => {
    const snap = createEmptySnapshot();
    expect(snap.items).toEqual({});
    expect(snap.item_order).toEqual([]);
    expect(snap.schema_version).toBe(1);
  });

  it('adds a shape', () => {
    const snap = createEmptySnapshot();
    const shape = createShape('service', 100, 200, 160, 80, 'API', '#3b82f6');
    const next = applyOperation(snap, { op: 'add', item: shape });
    expect(next.items[shape.id]).toBeDefined();
    expect(next.item_order).toContain(shape.id);
  });

  it('updates a shape', () => {
    const snap = createEmptySnapshot();
    const shape = createShape('service', 100, 200, 160, 80, 'API', '#3b82f6');
    let next = applyOperation(snap, { op: 'add', item: shape });
    const updated = { ...shape, label: 'Updated API' };
    next = applyOperation(next, { op: 'update', item: updated });
    expect(next.items[shape.id].kind === 'shape' && (next.items[shape.id] as ShapeElement).label).toBe('Updated API');
  });

  it('deletes a shape and cleans up connectors', () => {
    const snap = createEmptySnapshot();
    const shape1 = createShape('service', 0, 0, 160, 80, 'A', '#3b82f6');
    const shape2 = createShape('service', 300, 0, 160, 80, 'B', '#3b82f6');
    const conn = createConnector(shape1.id, shape2.id, null, null);
    let next = applyOperation(snap, { op: 'add', item: shape1 });
    next = applyOperation(next, { op: 'add', item: shape2 });
    next = applyOperation(next, { op: 'add', item: conn });
    next = applyOperation(next, { op: 'delete', id: shape1.id });
    expect(next.items[shape1.id]).toBeUndefined();
    const remainingConn = next.items[conn.id];
    expect(remainingConn).toBeDefined();
    expect(remainingConn!.kind === 'connector' && remainingConn.from_id).toBeNull();
  });

  it('moves shapes', () => {
    const snap = createEmptySnapshot();
    const shape = createShape('service', 100, 100, 160, 80, 'A', '#3b82f6');
    let next = applyOperation(snap, { op: 'add', item: shape });
    next = applyOperation(next, { op: 'move', ids: [shape.id], dx: 50, dy: -30 });
    expect(next.items[shape.id]!.kind === 'shape' && (next.items[shape.id]! as ShapeElement).x).toBe(150);
    expect(next.items[shape.id]!.kind === 'shape' && (next.items[shape.id]! as ShapeElement).y).toBe(70);
  });

  it('moves freehand strokes', () => {
    const snap = createEmptySnapshot();
    const stroke = createFreehandStroke([{ x: 0, y: 0 }, { x: 10, y: 10 }], '#ff0000', 3);
    let next = applyOperation(snap, { op: 'add', item: stroke });
    next = applyOperation(next, { op: 'move', ids: [stroke.id], dx: 100, dy: 50 });
    expect(next.items[stroke.id]!.kind === 'freehand' && (next.items[stroke.id]! as FreehandStroke).points[0]).toEqual({ x: 100, y: 50 });
  });

  it('resizes a shape', () => {
    const snap = createEmptySnapshot();
    const shape = createShape('service', 0, 0, 160, 80, 'A', '#3b82f6');
    let next = applyOperation(snap, { op: 'add', item: shape });
    next = applyOperation(next, { op: 'resize', id: shape.id, width: 300, height: 150 });
    expect(next.items[shape.id]!.kind === 'shape' && (next.items[shape.id]! as ShapeElement).width).toBe(300);
    expect(next.items[shape.id]!.kind === 'shape' && (next.items[shape.id]! as ShapeElement).height).toBe(150);
  });

  it('relabels shapes, text, and sticky notes', () => {
    const snap = createEmptySnapshot();
    const shape = createShape('service', 0, 0, 160, 80, 'Old', '#3b82f6');
    const text = createText(0, 0, 'Old Text');
    const sticky = createSticky(0, 0, 'Old Sticky');
    let next = applyOperation(snap, { op: 'add', item: shape });
    next = applyOperation(next, { op: 'add', item: text });
    next = applyOperation(next, { op: 'add', item: sticky });
    next = applyOperation(next, { op: 'relabel', id: shape.id, label: 'New' });
    next = applyOperation(next, { op: 'relabel', id: text.id, label: 'New Text' });
    next = applyOperation(next, { op: 'relabel', id: sticky.id, label: 'New Sticky' });
    expect(next.items[shape.id]!.kind === 'shape' && (next.items[shape.id]! as ShapeElement).label).toBe('New');
    expect(next.items[text.id]!.kind === 'text' && (next.items[text.id]! as TextLabelElement).text).toBe('New Text');
    expect(next.items[sticky.id]!.kind === 'sticky' && (next.items[sticky.id]! as StickyNoteElement).text).toBe('New Sticky');
  });

  it('updates connector styling fields', () => {
    const snap = createEmptySnapshot();
    const shape1 = createShape('service', 0, 0, 160, 80, 'A', '#3b82f6');
    const shape2 = createShape('service', 300, 0, 160, 80, 'B', '#3b82f6');
    const conn = createConnector(shape1.id, shape2.id, null, null) as ConnectorElement;
    let next = applyOperation(snap, { op: 'add', item: shape1 });
    next = applyOperation(next, { op: 'add', item: shape2 });
    next = applyOperation(next, { op: 'add', item: conn });

    const updated: ConnectorElement = {
      ...conn,
      label: 'reads',
      style: 'elbow',
      arrow_start: true,
      dashed: true,
      color: '#2563eb',
    };
    next = applyOperation(next, { op: 'update', item: updated });

    expect(next.items[conn.id]).toMatchObject({
      label: 'reads',
      style: 'elbow',
      arrow_start: true,
      dashed: true,
      color: '#2563eb',
    });
  });

  it('clears the canvas', () => {
    const snap = createEmptySnapshot();
    const shape = createShape('service', 0, 0, 160, 80, 'A', '#3b82f6');
    let next = applyOperation(snap, { op: 'add', item: shape });
    next = applyOperation(next, { op: 'clear' });
    expect(Object.keys(next.items)).toHaveLength(0);
    expect(next.item_order).toHaveLength(0);
  });

  it('does nothing when updating or deleting non-existent items', () => {
    const snap = createEmptySnapshot();
    const shape = createShape('service', 0, 0, 160, 80, 'A', '#3b82f6');
    const next = applyOperation(snap, { op: 'update', item: shape });
    expect(Object.keys(next.items)).toHaveLength(0);
    const next2 = applyOperation(snap, { op: 'delete', id: 'nonexistent' });
    expect(Object.keys(next2.items)).toHaveLength(0);
  });
});

describe('canvas history (undo/redo)', () => {
  it('undo restores previous state', () => {
    const snap1 = createEmptySnapshot();
    const shape = createShape('service', 0, 0, 160, 80, 'A', '#3b82f6');
    const snap2 = applyOperation(snap1, { op: 'add', item: shape });
    let history = createHistory();
    history = pushHistory(history, snap1, 'before add');
    const result = undo(history, snap2);
    expect(result.snapshot).toBe(snap1);
    expect(result.history.future).toHaveLength(1);
  });

  it('redo restores undone state', () => {
    const snap1 = createEmptySnapshot();
    const shape = createShape('service', 0, 0, 160, 80, 'A', '#3b82f6');
    const snap2 = applyOperation(snap1, { op: 'add', item: shape });
    let history = createHistory();
    history = pushHistory(history, snap1, 'before add');
    const undoResult = undo(history, snap2);
    const redoResult = redo(undoResult.history, undoResult.snapshot);
    expect(redoResult.snapshot).toBe(snap2);
  });

  it('undo with empty history returns current', () => {
    const snap = createEmptySnapshot();
    const history = createHistory();
    const result = undo(history, snap);
    expect(result.snapshot).toBe(snap);
  });

  it('redo with empty future returns current', () => {
    const snap = createEmptySnapshot();
    const history = createHistory();
    const result = redo(history, snap);
    expect(result.snapshot).toBe(snap);
  });
});
