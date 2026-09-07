import type { CanvasItem, CanvasOperation, CanvasSnapshotData } from '@/services/types';
import { generateId } from './geometry';

export function createEmptySnapshot(): CanvasSnapshotData {
  return { items: {}, item_order: [], schema_version: 1 };
}

export function applyOperation(snapshot: CanvasSnapshotData, op: CanvasOperation): CanvasSnapshotData {
  switch (op.op) {
    case 'add': {
      const items = { ...snapshot.items, [op.item.id]: op.item };
      const item_order = snapshot.item_order.includes(op.item.id)
        ? snapshot.item_order
        : [...snapshot.item_order, op.item.id];
      return { ...snapshot, items, item_order };
    }
    case 'update': {
      if (!snapshot.items[op.item.id]) return snapshot;
      return { ...snapshot, items: { ...snapshot.items, [op.item.id]: op.item } };
    }
    case 'delete': {
      if (!snapshot.items[op.id]) return snapshot;
      const items = { ...snapshot.items };
      delete items[op.id];
      const item_order = snapshot.item_order.filter((id) => id !== op.id);
      const cleaned: Record<string, CanvasItem> = {};
      for (const [id, item] of Object.entries(items)) {
        if (item.kind === 'connector') {
          if (item.from_id === op.id || item.to_id === op.id) {
            const from_id = item.from_id === op.id ? null : item.from_id;
            const to_id = item.to_id === op.id ? null : item.to_id;
            cleaned[id] = { ...item, from_id, to_id, from_point: from_id ? null : item.from_point, to_point: to_id ? null : item.to_point };
          } else {
            cleaned[id] = item;
          }
        } else {
          cleaned[id] = item;
        }
      }
      return { ...snapshot, items: cleaned, item_order };
    }
    case 'move': {
      const items = { ...snapshot.items };
      for (const id of op.ids) {
        const item = items[id];
        if (!item) continue;
        items[id] = moveItem(item, op.dx, op.dy);
      }
      // Also move attached connectors
      for (const [id, item] of Object.entries(items)) {
        if (item.kind === 'connector') {
          const fromMoved = item.from_id && op.ids.includes(item.from_id);
          const toMoved = item.to_id && op.ids.includes(item.to_id);
          if (fromMoved || toMoved) {
            items[id] = { ...item };
          }
        }
      }
      return { ...snapshot, items };
    }
    case 'resize': {
      const item = snapshot.items[op.id];
      if (!item) return snapshot;
      if (item.kind === 'shape' || item.kind === 'sticky' || item.kind === 'text') {
        return { ...snapshot, items: { ...snapshot.items, [op.id]: { ...item, width: op.width, height: op.height } } };
      }
      return snapshot;
    }
    case 'relabel': {
      const item = snapshot.items[op.id];
      if (!item) return snapshot;
      if (item.kind === 'shape' || item.kind === 'connector') {
        return { ...snapshot, items: { ...snapshot.items, [op.id]: { ...item, label: op.label } } };
      }
      if (item.kind === 'text' || item.kind === 'sticky') {
        return { ...snapshot, items: { ...snapshot.items, [op.id]: { ...item, text: op.label } } };
      }
      return snapshot;
    }
    case 'clear': {
      return createEmptySnapshot();
    }
  }
}

function moveItem(item: CanvasItem, dx: number, dy: number): CanvasItem {
  switch (item.kind) {
    case 'shape':
    case 'sticky':
    case 'text':
      return { ...item, x: item.x + dx, y: item.y + dy };
    case 'connector':
      return {
        ...item,
        from_point: item.from_point ? { x: item.from_point.x + dx, y: item.from_point.y + dy } : item.from_point,
        to_point: item.to_point ? { x: item.to_point.x + dx, y: item.to_point.y + dy } : item.to_point,
      };
    case 'freehand':
      return { ...item, points: item.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
}

export interface UndoEntry {
  operation: CanvasOperation;
  inverse: CanvasOperation;
}

export function inverseOf(snapshot: CanvasSnapshotData, op: CanvasOperation): CanvasOperation {
  switch (op.op) {
    case 'add': {
      return { op: 'delete', id: op.item.id };
    }
    case 'delete': {
      // For undo of delete, we need to re-add. But we don't have the item here.
      // This is handled by the undo stack which stores the pre-delete snapshot.
      return { op: 'clear' };
    }
    case 'move': {
      return { op: 'move', ids: op.ids, dx: -op.dx, dy: -op.dy };
    }
    case 'resize': {
      const item = snapshot.items[op.id];
      if (item && (item.kind === 'shape' || item.kind === 'sticky')) {
        return { op: 'resize', id: op.id, width: item.width, height: item.height };
      }
      return op;
    }
    case 'relabel': {
      const item = snapshot.items[op.id];
      if (item && (item.kind === 'shape' || item.kind === 'connector')) {
        return { op: 'relabel', id: op.id, label: item.label };
      }
      if (item && (item.kind === 'text' || item.kind === 'sticky')) {
        return { op: 'relabel', id: op.id, label: item.text };
      }
      return op;
    }
    case 'clear': {
      return { op: 'clear' };
    }
  }
  return op;
}

export interface CanvasHistory {
  past: { snapshot: CanvasSnapshotData; label: string }[];
  future: { snapshot: CanvasSnapshotData; label: string }[];
}

export function createHistory(): CanvasHistory {
  return { past: [], future: [] };
}

export function pushHistory(history: CanvasHistory, snapshot: CanvasSnapshotData, label: string): CanvasHistory {
  return {
    past: [...history.past.slice(-49), { snapshot, label }],
    future: [],
  };
}

export function undo(history: CanvasHistory, current: CanvasSnapshotData): { history: CanvasHistory; snapshot: CanvasSnapshotData } {
  if (history.past.length === 0) return { history, snapshot: current };
  const prev = history.past[history.past.length - 1];
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [{ snapshot: current, label: 'redo' }, ...history.future],
    },
    snapshot: prev.snapshot,
  };
}

export function redo(history: CanvasHistory, current: CanvasSnapshotData): { history: CanvasHistory; snapshot: CanvasSnapshotData } {
  if (history.future.length === 0) return { history, snapshot: current };
  const next = history.future[0];
  return {
    history: {
      past: [...history.past, { snapshot: current, label: 'redo' }],
      future: history.future.slice(1),
    },
    snapshot: next.snapshot,
  };
}

export function createShape(
  shape_type: string,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  color: string,
): CanvasItem {
  return {
    id: generateId(),
    kind: 'shape',
    shape_type,
    x,
    y,
    width,
    height,
    label,
    description: '',
    color,
    z: Date.now(),
  };
}

export function createConnector(
  from_id: string | null,
  to_id: string | null,
  from_point: { x: number; y: number } | null,
  to_point: { x: number; y: number } | null,
): CanvasItem {
  return {
    id: generateId(),
    kind: 'connector',
    from_id,
    to_id,
    from_point,
    to_point,
    label: '',
    style: 'curved',
    arrow_start: false,
    arrow_end: true,
    dashed: false,
    color: '#475569',
    z: Date.now(),
  };
}

export function createFreehandStroke(
  points: { x: number; y: number }[],
  color: string,
  width: number,
  opacity = 1,
): CanvasItem {
  return {
    id: generateId(),
    kind: 'freehand',
    points,
    color,
    width,
    opacity,
    z: Date.now(),
  };
}

export function createText(
  x: number,
  y: number,
  text: string,
  color = '#1e293b',
  font_size = 16,
): CanvasItem {
  return {
    id: generateId(),
    kind: 'text',
    x,
    y,
    width: 260,
    height: 48,
    text,
    font_size,
    color,
    z: Date.now(),
  };
}

export function createSticky(
  x: number,
  y: number,
  text: string,
  color = '#fbbf24',
): CanvasItem {
  return {
    id: generateId(),
    kind: 'sticky',
    x,
    y,
    width: 140,
    height: 120,
    text,
    color,
    z: Date.now(),
  };
}
