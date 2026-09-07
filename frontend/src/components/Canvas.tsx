import { useState, useRef, useCallback, useEffect } from 'react';
import type { CanvasSnapshotData, CanvasItem, CanvasOperation, ShapeElement, StickyNoteElement, TextLabelElement, ConnectorElement } from '@/services/types';
import { applyOperation, createShape, createConnector, createFreehandStroke, createText, createSticky, createHistory, pushHistory, undo, redo, type CanvasHistory } from '@/canvas/reducer';
import { PALETTE_CATEGORIES, PALETTE, getPaletteComponent } from '@/canvas/palette';
import { hitTest, hitTestRect, computeBounds, getItemBounds, getConnectorAnchorPoint, getShapeCenter } from '@/canvas/geometry';

export type Tool = 'select' | 'pan' | 'pen' | 'highlighter' | 'eraser' | 'text' | 'sticky' | 'connector';

interface CanvasProps {
  snapshot: CanvasSnapshotData;
  onSnapshotChange: (snapshot: CanvasSnapshotData) => void;
  participantColor: string;
  participantName: string;
  canEdit: boolean;
  onOperation: (op: CanvasOperation) => void;
}

const GRID_SIZE = 20;
const TEXT_LINE_HEIGHT = 20;

interface ConnectorDraft {
  fromId: string;
  start: { x: number; y: number };
  current: { x: number; y: number };
}

type ResizableItem = ShapeElement | StickyNoteElement | TextLabelElement;
type ConnectorEndpoint = 'from' | 'to';

function connectorPoints(item: ConnectorElement, allItems: Record<string, CanvasItem>) {
  let from = item.from_point;
  let to = item.to_point;
  if (item.from_id && allItems[item.from_id]?.kind === 'shape') {
    const shape = allItems[item.from_id] as ShapeElement;
    from = getConnectorAnchorPoint(shape, to ?? getShapeCenter(shape));
  }
  if (item.to_id && allItems[item.to_id]?.kind === 'shape') {
    const shape = allItems[item.to_id] as ShapeElement;
    to = getConnectorAnchorPoint(shape, from ?? getShapeCenter(shape));
  }
  return from && to ? { from, to } : null;
}

function snapEndpoint(point: { x: number; y: number }, allItems: Record<string, CanvasItem>, excludeId: string) {
  for (const item of Object.values(allItems)) {
    if (item.id === excludeId || item.kind !== 'shape') continue;
    if (point.x >= item.x && point.x <= item.x + item.width && point.y >= item.y && point.y <= item.y + item.height) {
      return { id: item.id, point: null as { x: number; y: number } | null, anchor: getConnectorAnchorPoint(item, point) };
    }
  }
  return { id: null, point, anchor: point };
}

export function Canvas({ snapshot, onSnapshotChange, participantColor, canEdit, onOperation }: CanvasProps) {
  const [tool, setTool] = useState<Tool>('select');
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 });
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [freehandPoints, setFreehandPoints] = useState<{ x: number; y: number }[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectRect, setSelectRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [connectorDraft, setConnectorDraft] = useState<ConnectorDraft | null>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = useState('');
  const [resizeDraft, setResizeDraft] = useState<{ id: string; startX: number; startY: number; width: number; height: number } | null>(null);
  const [resizePreview, setResizePreview] = useState<{ id: string; width: number; height: number } | null>(null);
  const [endpointDrag, setEndpointDrag] = useState<{ id: string; endpoint: ConnectorEndpoint } | null>(null);
  const [connectorPreview, setConnectorPreview] = useState<ConnectorElement | null>(null);
  const [showPalette, setShowPalette] = useState(false);
  const [history, setHistory] = useState<CanvasHistory>(createHistory());
  const svgRef = useRef<SVGSVGElement>(null);
  const screenToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom,
    };
  }, [pan, zoom]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!canEdit && tool !== 'pan') return;
    const world = screenToWorld(e.clientX, e.clientY);

    if (tool === 'pan' || e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    if (tool === 'pen' || tool === 'highlighter') {
      setIsDrawing(true);
      setFreehandPoints([world]);
      return;
    }

    if (tool === 'eraser') {
      const hitId = hitTest(snapshot.items, snapshot.item_order, world);
      if (hitId) {
        const op: CanvasOperation = { op: 'delete', id: hitId };
        applyAndBroadcast(op);
      }
      return;
    }

    if (tool === 'text') {
      const textItem = createText(world.x, world.y, 'Text');
      const op: CanvasOperation = { op: 'add', item: textItem };
      applyAndBroadcast(op);
      setEditingText(textItem.id);
      setEditingTextValue('Text');
      setTool('select');
      return;
    }

    if (tool === 'sticky') {
      const sticky = createSticky(world.x, world.y, 'Note');
      const op: CanvasOperation = { op: 'add', item: sticky };
      applyAndBroadcast(op);
      setEditingText(sticky.id);
      setEditingTextValue('Note');
      setTool('select');
      return;
    }

    if (tool === 'connector') {
      const hitId = hitTest(snapshot.items, snapshot.item_order, world);
      if (hitId && snapshot.items[hitId].kind === 'shape') {
        const shape = snapshot.items[hitId] as ShapeElement;
        const start = getConnectorAnchorPoint(shape, world);
        setConnectorDraft({ fromId: hitId, start, current: world });
      }
      return;
    }

    // Select tool
    const hitId = hitTest(snapshot.items, snapshot.item_order, world);
    if (hitId) {
      if (e.shiftKey) {
        setSelectedIds((prev) => prev.includes(hitId) ? prev.filter(id => id !== hitId) : [...prev, hitId]);
      } else {
        setSelectedIds([hitId]);
        const item = snapshot.items[hitId];
        const bounds = getItemBounds(item);
        setIsDragging(true);
        setDragOffset({ x: world.x - bounds.x, y: world.y - bounds.y });
      }
    } else {
      if (!e.shiftKey) setSelectedIds([]);
      setIsSelecting(true);
      setSelectRect({ x: world.x, y: world.y, w: 0, h: 0 });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }

    const world = screenToWorld(e.clientX, e.clientY);

    if (connectorDraft) {
      setConnectorDraft((draft) => draft ? { ...draft, current: world } : null);
      return;
    }

    if (isDrawing) {
      setFreehandPoints((prev) => [...prev, world]);
      return;
    }

    if (isSelecting && selectRect) {
      setSelectRect({
        x: Math.min(selectRect.x, world.x),
        y: Math.min(selectRect.y, world.y),
        w: Math.abs(world.x - selectRect.x),
        h: Math.abs(world.y - selectRect.y),
      });
      return;
    }

    if (resizeDraft) {
      const width = Math.max(80, resizeDraft.width + (world.x - resizeDraft.startX));
      const height = Math.max(48, resizeDraft.height + (world.y - resizeDraft.startY));
      setResizePreview({ id: resizeDraft.id, width, height });
      return;
    }

    if (endpointDrag) {
      const item = snapshot.items[endpointDrag.id];
      if (item?.kind === 'connector') {
        const snapped = snapEndpoint(world, snapshot.items, endpointDrag.id);
        setConnectorPreview({ ...item, ...(endpointDrag.endpoint === 'from'
          ? { from_id: snapped.id, from_point: snapped.point }
          : { to_id: snapped.id, to_point: snapped.point }) });
      }
      return;
    }

    if (isDragging && selectedIds.length > 0) {
      const firstItem = snapshot.items[selectedIds[0]];
      if (firstItem) {
        const bounds = getItemBounds(firstItem);
        setDragDelta({ x: world.x - dragOffset.x - bounds.x, y: world.y - dragOffset.y - bounds.y });
      }
      return;
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isPanning) {
      setIsPanning(false);
      return;
    }

    if (resizeDraft) {
      if (resizePreview) applyAndBroadcast({ op: 'resize', id: resizeDraft.id, width: resizePreview.width, height: resizePreview.height });
      setResizeDraft(null);
      setResizePreview(null);
      return;
    }

    if (endpointDrag && connectorPreview) {
      applyAndBroadcast({ op: 'update', item: connectorPreview });
      setEndpointDrag(null);
      setConnectorPreview(null);
      return;
    }

    if (connectorDraft) {
      const world = screenToWorld(e.clientX, e.clientY);
      const distance = Math.hypot(world.x - connectorDraft.start.x, world.y - connectorDraft.start.y);
      if (distance > 8) {
        const hitId = hitTest(snapshot.items, snapshot.item_order, world);
        const toId = hitId && snapshot.items[hitId]?.kind === 'shape' && hitId !== connectorDraft.fromId ? hitId : null;
        const conn = toId
          ? createConnector(connectorDraft.fromId, toId, null, null)
          : createConnector(connectorDraft.fromId, null, null, world);
        const op: CanvasOperation = { op: 'add', item: conn };
        applyAndBroadcast(op);
        setSelectedIds([conn.id]);
      }
      setConnectorDraft(null);
      return;
    }

    if (isDrawing) {
      if (freehandPoints.length > 1) {
        const color = tool === 'highlighter' ? '#fbbf24' : '#1e293b';
        const width = tool === 'highlighter' ? 12 : 2;
        const opacity = tool === 'highlighter' ? 0.4 : 1;
        const stroke = createFreehandStroke(freehandPoints, color, width, opacity);
        const op: CanvasOperation = { op: 'add', item: stroke };
        applyAndBroadcast(op);
      }
      setIsDrawing(false);
      setFreehandPoints([]);
      return;
    }

    if (isSelecting && selectRect) {
      const hits = hitTestRect(snapshot.items, snapshot.item_order, {
        x: selectRect.x,
        y: selectRect.y,
        width: selectRect.w,
        height: selectRect.h,
      });
      if (hits.length > 0) {
        setSelectedIds(hits);
      }
      setIsSelecting(false);
      setSelectRect(null);
      return;
    }

    if (isDragging && selectedIds.length > 0) {
      const world = screenToWorld(e.clientX, e.clientY);
      const newY = world.y - dragOffset.y;
      const firstItem = snapshot.items[selectedIds[0]];
      if (firstItem) {
        const bounds = getItemBounds(firstItem);
        const dx = world.x - dragOffset.x - bounds.x;
        const dy = newY - bounds.y;
        if (dx !== 0 || dy !== 0) {
          const op: CanvasOperation = { op: 'move', ids: selectedIds, dx, dy };
          applyAndBroadcast(op);
        }
      }
      setIsDragging(false);
      setDragDelta({ x: 0, y: 0 });
    }
  };

  const startResize = (e: React.MouseEvent, item: ResizableItem) => {
    e.stopPropagation();
    if (!canEdit) return;
    const world = screenToWorld(e.clientX, e.clientY);
    setResizeDraft({ id: item.id, startX: world.x, startY: world.y, width: item.width, height: item.height });
    setResizePreview({ id: item.id, width: item.width, height: item.height });
  };

  const startEndpointDrag = (e: React.MouseEvent, item: ConnectorElement, endpoint: ConnectorEndpoint) => {
    e.stopPropagation();
    if (!canEdit) return;
    setEndpointDrag({ id: item.id, endpoint });
    setConnectorPreview(item);
  };

  const applyAndBroadcast = (op: CanvasOperation) => {
    setHistory((h) => pushHistory(h, snapshot, 'before op'));
    const next = applyOperation(snapshot, op);
    onSnapshotChange(next);
    onOperation(op);
  };

  const handleDelete = () => {
    if (selectedIds.length === 0) return;
    for (const id of selectedIds) {
      const op: CanvasOperation = { op: 'delete', id };
      setHistory((h) => pushHistory(h, snapshot, 'before delete'));
      const next = applyOperation(snapshot, op);
      onSnapshotChange(next);
      onOperation(op);
    }
    setSelectedIds([]);
  };

  const handleUndo = () => {
    const result = undo(history, snapshot);
    setHistory(result.history);
    onSnapshotChange(result.snapshot);
  };

  const handleRedo = () => {
    const result = redo(history, snapshot);
    setHistory(result.history);
    onSnapshotChange(result.snapshot);
  };

  const handleZoomIn = () => setZoom((z) => Math.min(z * 1.2, 5));
  const handleZoomOut = () => setZoom((z) => Math.max(z / 1.2, 0.1));
  const handleZoomReset = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  const handleZoomToFit = () => {
    if (snapshot.item_order.length === 0) {
      handleZoomReset();
      return;
    }
    const bounds = computeBounds(snapshot.item_order, snapshot.items);
    if (!bounds) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const padding = 80;
    const scaleX = (rect.width - padding * 2) / bounds.width;
    const scaleY = (rect.height - padding * 2) / bounds.height;
    const newZoom = Math.min(scaleX, scaleY, 2);
    setZoom(newZoom);
    setPan({
      x: rect.width / 2 - (bounds.x + bounds.width / 2) * newZoom,
      y: rect.height / 2 - (bounds.y + bounds.height / 2) * newZoom,
    });
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = -e.deltaY * 0.001;
      setZoom((z) => Math.max(0.1, Math.min(5, z * (1 + delta))));
    } else {
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  };

  const addComponent = (componentType: string) => {
    const comp = getPaletteComponent(componentType);
    if (!comp) return;
    const rect = svgRef.current?.getBoundingClientRect();
    const x = rect ? (rect.width / 2 - pan.x) / zoom - comp.default_width / 2 : 0;
    const y = rect ? (rect.height / 2 - pan.y) / zoom - comp.default_height / 2 : 0;
    const shape = createShape(componentType, x, y, comp.default_width, comp.default_height, comp.label, comp.color);
    const op: CanvasOperation = { op: 'add', item: shape };
    applyAndBroadcast(op);
    setSelectedIds([shape.id]);
    setShowPalette(false);
    setTool('select');
  };

  const handleLabelEdit = (id: string, newLabel: string) => {
    if (snapshot.items[id]?.kind === 'text' && newLabel.trim() === '') {
      setEditingText(null);
      return;
    }
    const op: CanvasOperation = { op: 'relabel', id, label: newLabel };
    applyAndBroadcast(op);
    setEditingText(null);
  };

  const startEditingItem = (item: CanvasItem) => {
    if (!canEdit) return;
    setSelectedIds([item.id]);
    setEditingText(item.id);
    if (item.kind === 'shape' || item.kind === 'connector') {
      setEditingTextValue(item.label);
    } else if (item.kind === 'text' || item.kind === 'sticky') {
      setEditingTextValue(item.text);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editingText) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDelete();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      } else if (e.key === 'v') setTool('select');
      else if (e.key === 'h') setTool('pan');
      else if (e.key === 'p') setTool('pen');
      else if (e.key === 'e') setTool('eraser');
      else if (e.key === 't') setTool('text');
      else if (e.key === 'n') setTool('sticky');
      else if (e.key === 'c') setTool('connector');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedIds, snapshot, history, editingText]);

  const tools: { id: Tool; label: string; icon: string }[] = [
    { id: 'select', label: 'Select (V)', icon: 'mouse-pointer' },
    { id: 'pan', label: 'Pan (H)', icon: 'hand' },
    { id: 'pen', label: 'Pen (P)', icon: 'pen' },
    { id: 'highlighter', label: 'Highlighter', icon: 'highlighter' },
    { id: 'eraser', label: 'Eraser (E)', icon: 'eraser' },
    { id: 'text', label: 'Text (T)', icon: 'text' },
    { id: 'sticky', label: 'Sticky Note (N)', icon: 'sticky-note' },
    { id: 'connector', label: 'Connector (C)', icon: 'connector' },
  ];

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-50" style={{ cursor: tool === 'pan' ? 'grab' : tool === 'pen' ? 'crosshair' : 'default' }}>
      {/* Left toolbar */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-1 bg-white rounded-xl shadow-lg border border-slate-200 p-2">
        {tools.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            title={t.label}
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              tool === t.id ? 'bg-blue-500 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ToolIcon name={t.id} />
          </button>
        ))}
        <div className="h-px bg-slate-200 my-1" />
        <button
          onClick={() => setShowPalette(!showPalette)}
          title="Component Library"
          className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
            showPalette ? 'bg-blue-500 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ToolIcon name="palette" />
        </button>
      </div>

      {/* Component palette */}
      {showPalette && (
        <div className="absolute left-16 top-1/2 -translate-y-1/2 z-20 w-72 max-h-[70vh] overflow-y-auto bg-white rounded-xl shadow-xl border border-slate-200 p-3">
          <h3 className="text-sm font-semibold text-slate-700 mb-2">Components</h3>
          {PALETTE_CATEGORIES.map((cat) => (
            <div key={cat} className="mb-3">
              <div className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">{cat}</div>
              <div className="grid grid-cols-2 gap-1.5">
                {PALETTE.filter((c) => c.category === cat).map((comp) => (
                  <button
                    key={comp.type}
                    onClick={() => addComponent(comp.type)}
                    className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-slate-100 text-left transition-colors"
                  >
                    <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: comp.color }} />
                    <span className="text-xs text-slate-600 truncate">{comp.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        className="w-full h-full"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
            <circle cx={GRID_SIZE / 2} cy={GRID_SIZE / 2} r={0.5} fill="#cbd5e1" />
          </pattern>
          <marker id="arrowhead" markerWidth={10} markerHeight={7} refX={9} refY={3.5} orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#475569" />
          </marker>
          <marker id="arrowhead-start" markerWidth={10} markerHeight={7} refX={1} refY={3.5} orient="auto">
            <polygon points="10 0, 0 3.5, 10 7" fill="#475569" />
          </marker>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Motion trail keeps the original position visible while an object is being dragged. */}
          {isDragging && selectedIds.length > 0 && (() => {
            const first = snapshot.items[selectedIds[0]];
            if (!first || (dragDelta.x === 0 && dragDelta.y === 0)) return null;
            const bounds = getItemBounds(first);
            return (
              <g pointerEvents="none" opacity={0.45}>
                <rect x={bounds.x} y={bounds.y} width={Math.max(bounds.width, 12)} height={Math.max(bounds.height, 12)} fill="none" stroke={participantColor} strokeWidth={2} strokeDasharray="6 5" rx={6} />
                <line x1={bounds.x + bounds.width / 2} y1={bounds.y + bounds.height / 2} x2={bounds.x + bounds.width / 2 + dragDelta.x} y2={bounds.y + bounds.height / 2 + dragDelta.y} stroke={participantColor} strokeWidth={2} strokeDasharray="4 4" />
              </g>
            );
          })()}
          {/* Render items */}
          {snapshot.item_order.map((id) => {
            const item = snapshot.items[id];
            if (!item) return null;
            const compatibleItem = item.kind === 'text'
              ? { ...item, width: item.width ?? 260, height: item.height ?? 48 }
              : item;
            const isSelected = selectedIds.includes(id);
            const previewItem = connectorPreview?.id === id ? connectorPreview
              : resizePreview?.id === id && (compatibleItem.kind === 'shape' || compatibleItem.kind === 'sticky' || compatibleItem.kind === 'text')
              ? { ...compatibleItem, width: resizePreview.width, height: resizePreview.height } : compatibleItem;
            return (
              <g transform={isDragging && isSelected ? `translate(${dragDelta.x} ${dragDelta.y})` : undefined}>
              <CanvasItemRenderer
                key={id}
                item={previewItem}
                selected={isSelected}
                allItems={snapshot.items}
                editing={editingText === id}
                editingValue={editingTextValue}
                onEditingValueChange={setEditingTextValue}
                onBeginEdit={() => startEditingItem(compatibleItem)}
                onEditingBlur={() => {
                  if (editingText) handleLabelEdit(editingText, editingTextValue);
                }}
              />
              </g>
            );
          })}

          {selectedIds.length === 1 && (() => {
            const item = snapshot.items[selectedIds[0]];
            if (!item || (item.kind !== 'shape' && item.kind !== 'sticky' && item.kind !== 'text')) return null;
            const baseWidth = item.kind === 'text' ? (item.width ?? 260) : item.width;
            const baseHeight = item.kind === 'text' ? (item.height ?? 48) : item.height;
            const width = resizePreview?.id === item.id ? resizePreview.width : baseWidth;
            const height = resizePreview?.id === item.id ? resizePreview.height : baseHeight;
            return <rect x={item.x + width - 6} y={item.y + height - 6} width={12} height={12} rx={3} fill="#fff" stroke="#2563eb" strokeWidth={2} className="cursor-nwse-resize" onMouseDown={(e) => startResize(e, item)} />;
          })()}

          {selectedIds.length === 1 && (() => {
            const raw = snapshot.items[selectedIds[0]];
            if (!raw || raw.kind !== 'connector' || !canEdit) return null;
            const points = connectorPoints(connectorPreview ?? raw, snapshot.items);
            if (!points) return null;
            return <>
              <circle cx={points.from.x} cy={points.from.y} r={7} fill="#fff" stroke="#2563eb" strokeWidth={2} className="cursor-crosshair" onMouseDown={(e) => startEndpointDrag(e, raw, 'from')} />
              <circle cx={points.to.x} cy={points.to.y} r={7} fill="#fff" stroke="#2563eb" strokeWidth={2} className="cursor-crosshair" onMouseDown={(e) => startEndpointDrag(e, raw, 'to')} />
            </>;
          })()}

          {/* Render freehand in progress */}
          {isDrawing && freehandPoints.length > 0 && (
            <path
              d={freehandPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
              fill="none"
              stroke={tool === 'highlighter' ? '#fbbf24' : '#1e293b'}
              strokeWidth={tool === 'highlighter' ? 12 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={tool === 'highlighter' ? 0.4 : 1}
            />
          )}

          {/* Render selection rectangle */}
          {isSelecting && selectRect && (
            <rect
              x={selectRect.x}
              y={selectRect.y}
              width={selectRect.w}
              height={selectRect.h}
              fill="rgba(59, 130, 246, 0.1)"
              stroke="#3b82f6"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}

          {/* Render connector preview */}
          {connectorDraft && (
            <g pointerEvents="none">
              <path
                d={`M ${connectorDraft.start.x} ${connectorDraft.start.y} L ${connectorDraft.current.x} ${connectorDraft.current.y}`}
                fill="none"
                stroke={participantColor}
                strokeWidth={2}
                strokeDasharray="6 4"
                markerEnd="url(#arrowhead)"
              />
              <circle cx={connectorDraft.start.x} cy={connectorDraft.start.y} r={5} fill={participantColor} opacity={0.75} />
              <circle cx={connectorDraft.current.x} cy={connectorDraft.current.y} r={4} fill={participantColor} opacity={0.45} />
            </g>
          )}
        </g>
      </svg>

      {/* Bottom controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-white rounded-xl shadow-lg border border-slate-200 px-2 py-1.5">
        <button onClick={handleZoomOut} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors" title="Zoom out">
          <ToolIcon name="zoom-out" />
        </button>
        <span className="text-sm text-slate-600 min-w-[3rem] text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={handleZoomIn} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors" title="Zoom in">
          <ToolIcon name="zoom-in" />
        </button>
        <div className="w-px h-6 bg-slate-200 mx-1" />
        <button onClick={handleZoomToFit} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors" title="Zoom to fit">
          <ToolIcon name="zoom-fit" />
        </button>
        <button onClick={handleZoomReset} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors" title="Reset view">
          <ToolIcon name="zoom-reset" />
        </button>
        <div className="w-px h-6 bg-slate-200 mx-1" />
        <button onClick={handleUndo} disabled={history.past.length === 0} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="Undo (Ctrl+Z)">
          <ToolIcon name="undo" />
        </button>
        <button onClick={handleRedo} disabled={history.future.length === 0} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed" title="Redo (Ctrl+Y)">
          <ToolIcon name="redo" />
        </button>
      </div>

      {/* Edit lock indicator */}
      {!canEdit && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-amber-50 border border-amber-200 text-amber-700 text-sm px-4 py-1.5 rounded-lg shadow-sm">
          Editing is locked by the interviewer
        </div>
      )}
    </div>
  );
}

function CanvasItemRenderer({
  item,
  selected,
  allItems,
  editing,
  editingValue,
  onEditingValueChange,
  onBeginEdit,
  onEditingBlur,
}: {
  item: CanvasItem;
  selected: boolean;
  allItems: Record<string, CanvasItem>;
  editing: boolean;
  editingValue: string;
  onEditingValueChange: (v: string) => void;
  onBeginEdit: () => void;
  onEditingBlur: () => void;
}) {
  const strokeColor = selected ? '#3b82f6' : 'transparent';
  const strokeWidth = selected ? 2 : 0;
  const stopCanvasInput = (e: React.SyntheticEvent) => e.stopPropagation();

  if (item.kind === 'shape') {
    const isRounded = item.shape_type === 'rounded' || item.shape_type === 'function';
    return (
      <g>
        {isRounded ? (
          <rect
            x={item.x}
            y={item.y}
            width={item.width}
            height={item.height}
            rx={12}
            ry={12}
            fill={item.color}
            fillOpacity={0.12}
            stroke={item.color}
            strokeWidth={2}
          />
        ) : (
          <rect
            x={item.x}
            y={item.y}
            width={item.width}
            height={item.height}
            rx={4}
            ry={4}
            fill={item.color}
            fillOpacity={0.12}
            stroke={item.color}
            strokeWidth={2}
          />
        )}
        {selected && (
          <rect
            x={item.x - 4}
            y={item.y - 4}
            width={item.width + 8}
            height={item.height + 8}
            rx={6}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray="4 2"
          />
        )}
        {editing ? (
          <foreignObject x={item.x + 8} y={item.y + item.height / 2 - 12} width={item.width - 16} height={24}>
            <input
              autoFocus
              value={editingValue}
              onChange={(e) => onEditingValueChange(e.target.value)}
              onBlur={onEditingBlur}
              onMouseDown={stopCanvasInput}
              onPointerDown={stopCanvasInput}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') onEditingBlur();
              }}
              className="w-full text-sm text-center bg-white border border-blue-400 rounded px-1 outline-none"
              style={{ color: item.color }}
            />
          </foreignObject>
        ) : (
          <text
            x={item.x + item.width / 2}
            y={item.y + item.height / 2 + 5}
            textAnchor="middle"
            className="text-sm font-medium select-none cursor-text"
            fill={item.color}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onBeginEdit();
            }}
          >
            {item.label}
          </text>
        )}
      </g>
    );
  }

  if (item.kind === 'sticky') {
    return (
      <g>
        <rect
          x={item.x}
          y={item.y}
          width={item.width}
          height={item.height}
          rx={4}
          fill={item.color}
          fillOpacity={0.85}
          stroke={item.color}
          strokeWidth={1}
          transform={`rotate(-1, ${item.x + item.width / 2}, ${item.y + item.height / 2})`}
        />
        {selected && (
          <rect
            x={item.x - 4}
            y={item.y - 4}
            width={item.width + 8}
            height={item.height + 8}
            rx={6}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray="4 2"
          />
        )}
        {editing ? (
          <foreignObject x={item.x + 8} y={item.y + 8} width={item.width - 16} height={item.height - 16}>
            <textarea
              autoFocus
              value={editingValue}
              onChange={(e) => onEditingValueChange(e.target.value)}
              onBlur={onEditingBlur}
              onMouseDown={stopCanvasInput}
              onPointerDown={stopCanvasInput}
              onKeyDown={(e) => {
                e.stopPropagation();
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onEditingBlur();
              }}
              className="w-full h-full text-sm leading-5 bg-white/60 outline-none resize-none overflow-auto"
            />
          </foreignObject>
        ) : (
          <foreignObject x={item.x + 10} y={item.y + 10} width={item.width - 20} height={item.height - 20}>
            <div
              className="h-full overflow-hidden text-sm leading-5 text-slate-900 whitespace-pre-wrap break-words select-none cursor-text"
              onDoubleClick={(e) => {
                e.stopPropagation();
                onBeginEdit();
              }}
            >
              {item.text}
            </div>
          </foreignObject>
        )}
      </g>
    );
  }

  if (item.kind === 'text') {
    const boxWidth = item.width;
    const boxHeight = item.height;
    return (
      <g>
        {editing ? (
          <foreignObject x={item.x} y={item.y} width={boxWidth} height={boxHeight}>
            <textarea
              autoFocus
              value={editingValue}
              onChange={(e) => onEditingValueChange(e.target.value)}
              onBlur={onEditingBlur}
              onMouseDown={stopCanvasInput}
              onPointerDown={stopCanvasInput}
              onKeyDown={(e) => {
                e.stopPropagation();
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onEditingBlur();
              }}
              className="w-full h-full bg-white border border-blue-400 rounded px-2 py-1 outline-none resize-none"
              style={{ color: item.color, fontSize: item.font_size }}
            />
          </foreignObject>
        ) : (
          <foreignObject x={item.x} y={item.y} width={boxWidth} height={boxHeight}>
            <div
              className="font-medium whitespace-pre-wrap break-words select-none cursor-text"
              style={{ color: item.color, fontSize: item.font_size, lineHeight: `${TEXT_LINE_HEIGHT}px` }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onBeginEdit();
              }}
            >
              {item.text}
            </div>
          </foreignObject>
        )}
        {selected && (
          <rect
            x={item.x - 4}
            y={item.y - 4}
            width={boxWidth + 8}
            height={boxHeight + 8}
            rx={4}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray="4 2"
          />
        )}
      </g>
    );
  }

  if (item.kind === 'connector') {
    const points = connectorPoints(item, allItems);
    const from = points?.from;
    const to = points?.to;
    if (!from || !to) return null;

    let path: string;
    if (item.style === 'straight') {
      path = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    } else if (item.style === 'elbow') {
      const midX = (from.x + to.x) / 2;
      path = `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
    } else {
      const dx = to.x - from.x;
      const cx1 = from.x + dx * 0.3;
      const cy1 = from.y;
      const cx2 = to.x - dx * 0.3;
      const cy2 = to.y;
      path = `M ${from.x} ${from.y} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${to.x} ${to.y}`;
    }

    return (
      <g>
        <path
          d={path}
          fill="none"
          stroke={item.color}
          strokeWidth={2}
          strokeDasharray={item.dashed ? '6 4' : undefined}
          markerStart={item.arrow_start ? 'url(#arrowhead-start)' : undefined}
          markerEnd={item.arrow_end ? 'url(#arrowhead)' : undefined}
        />
        {editing ? (
          <foreignObject x={(from.x + to.x) / 2 - 90} y={(from.y + to.y) / 2 - 22} width={180} height={28}>
            <input
              autoFocus
              value={editingValue}
              onChange={(e) => onEditingValueChange(e.target.value)}
              onBlur={onEditingBlur}
              onMouseDown={stopCanvasInput}
              onPointerDown={stopCanvasInput}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') onEditingBlur();
              }}
              className="w-full px-2 py-1 text-xs text-center bg-white border border-blue-400 rounded outline-none"
              style={{ color: item.color }}
            />
          </foreignObject>
        ) : item.label ? (
          <text
            x={(from.x + to.x) / 2}
            y={(from.y + to.y) / 2 - 6}
            textAnchor="middle"
            className="text-xs select-none cursor-text"
            fill={item.color}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onBeginEdit();
            }}
          >
            {item.label}
          </text>
        ) : null}
        {selected && (
          <path
            d={path}
            fill="none"
            stroke={strokeColor}
            strokeWidth={4}
            strokeDasharray="4 2"
            opacity={0.5}
          />
        )}
      </g>
    );
  }

  if (item.kind === 'freehand') {
    if (item.points.length === 0) return null;
    const d = item.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    return (
      <g>
        <path
          d={d}
          fill="none"
          stroke={item.color}
          strokeWidth={item.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={item.opacity}
        />
        {selected && (
          <path
            d={d}
            fill="none"
            stroke={strokeColor}
            strokeWidth={item.width + 4}
            strokeDasharray="4 2"
            opacity={0.3}
          />
        )}
      </g>
    );
  }

  return null;
}

function ToolIcon({ name }: { name: string }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      {name === 'select' && <path d="M2 2 L8 18 L10 12 L16 10 Z" fill="currentColor" />}
      {name === 'pan' && <><path d="M9 11 V3 A2 2 0 0 1 13 3 V11" /><path d="M9 11 V9 A2 2 0 0 1 13 9 V11" /><path d="M9 11 V7 A2 2 0 0 1 13 7 V11" /><path d="M9 11 H17 A2 2 0 0 1 19 13 V11" /></>}
      {name === 'pen' && <path d="M3 17 L14 6 L18 10 L7 21 L3 21 Z" />}
      {name === 'highlighter' && <><path d="M3 18 L14 7 L17 10 L6 21 L3 21 Z" /><path d="M14 3 L17 6" /></>}
      {name === 'eraser' && <path d="M5 15 L12 8 L19 15 L14 20 L5 20 Z" />}
      {name === 'text' && <><path d="M4 4 H20" /><path d="M12 4 V20" /></>}
      {name === 'sticky' && <path d="M4 4 H16 L20 8 V20 H4 Z" />}
      {name === 'connector' && <><path d="M4 12 H20" /><path d="M16 8 L20 12 L16 16" /></>}
      {name === 'palette' && <path d="M12 4 A8 8 0 1 0 12 20 C10 20 10 16 12 16 C14 16 16 14 16 12 C16 10 14 4 12 4 Z" />}
      {name === 'zoom-in' && <><circle cx={11} cy={11} r={7} /><path d="M11 8 V14 M8 11 H14" /><path d="M16 16 L20 20" /></>}
      {name === 'zoom-out' && <><circle cx={11} cy={11} r={7} /><path d="M8 11 H14" /><path d="M16 16 L20 20" /></>}
      {name === 'zoom-fit' && <><path d="M4 8 V4 H8" /><path d="M16 4 H20 V8" /><path d="M20 16 V20 H16" /><path d="M8 20 H4 V16" /></>}
      {name === 'zoom-reset' && <><circle cx={12} cy={12} r={8} /><path d="M8 12 H16" /></>}
      {name === 'undo' && <><path d="M9 7 L4 12 L9 17" /><path d="M4 12 H16 A4 4 0 0 1 20 16" /></>}
      {name === 'redo' && <><path d="M15 7 L20 12 L15 17" /><path d="M20 12 H8 A4 4 0 0 0 4 16" /></>}
    </svg>
  );
}
