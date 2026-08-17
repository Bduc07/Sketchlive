"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useMyPresence, useOthers, useStorage } from "./liveblocks.config";

type Point = { x: number; y: number };

// Any shape can carry any behavior - which shapes look best with which
// behavior is a matter of taste, not something the tool should decide for
// the person drawing.
type Behavior =
  | "sun"
  | "river"
  | "twinkle"
  | "fire"
  | "smoke"
  | "flower"
  | "bird"
  | "vehicle"
  | "spin"
  | "snow";

export type Shape =
  | {
      type: "circle";
      x: number;
      y: number;
      radius: number;
      color: string;
      fillColor?: string;
      behavior?: Behavior;
    }
  | {
      type: "box";
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      fillColor?: string;
      behavior?: Behavior;
    }
  | {
      type: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      behavior?: Behavior;
    }
  | {
      type: "triangle";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x3: number;
      y3: number;
      color: string;
      fillColor?: string;
      behavior?: Behavior;
    }
  | {
      type: "star";
      x: number;
      y: number;
      radius: number;
      color: string;
      fillColor?: string;
      behavior?: Behavior;
    }
  | {
      type: "pencil";
      points: Point[];
      color: string;
      strokeWidth?: number;
      behavior?: Behavior;
    };

const COLORS = [
  "#000000", // black
  "#ffffff", // white
  "#6b7280", // gray
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#a855f7", // purple
  "#ec4899", // pink
  "#92400e", // brown
];

const BEHAVIOR_OPTIONS: { value: Behavior | ""; label: string }[] = [
  { value: "", label: "None" },
  { value: "sun", label: "Sun" },
  { value: "river", label: "River" },
  { value: "twinkle", label: "Twinkle" },
  { value: "fire", label: "Fire" },
  { value: "smoke", label: "Smoke" },
  { value: "flower", label: "Flower" },
  { value: "bird", label: "Bird" },
  { value: "vehicle", label: "Vehicle" },
  { value: "spin", label: "Spin" },
  { value: "snow", label: "Snow" },
];

const PENCIL_WIDTH = 3;
const BRUSH_WIDTH = 22;

// How many steps back undo/redo can go - bounded so localStorage doesn't
// grow without limit over a long drawing session.
const HISTORY_LIMIT = 50;

function undoStorageKey(sketchId: string) {
  return `sketch-undo-${sketchId}`;
}

// Undo/redo history lives in localStorage, not the database - it's local
// editing state for this browser, not part of the sketch itself, so it's
// read synchronously via useState's lazy initializer (localStorage is
// synchronous) rather than fetched from the server.
function loadHistory(sketchId: string): { past: Shape[][]; future: Shape[][] } {
  if (typeof window === "undefined") return { past: [], future: [] };
  try {
    const raw = window.localStorage.getItem(undoStorageKey(sketchId));
    if (!raw) return { past: [], future: [] };
    const parsed = JSON.parse(raw);
    return {
      past: Array.isArray(parsed.past) ? parsed.past : [],
      future: Array.isArray(parsed.future) ? parsed.future : [],
    };
  } catch {
    return { past: [], future: [] };
  }
}

// A blue four-way arrow, shown as the mouse cursor while a shape is picked up.
const MOVE_CURSOR_SVG = `
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
    <g fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
      <line x1="12" y1="2" x2="12" y2="22"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <polyline points="8,6 12,2 16,6"/>
      <polyline points="8,18 12,22 16,18"/>
      <polyline points="6,8 2,12 6,16"/>
      <polyline points="18,8 22,12 18,16"/>
    </g>
  </svg>
`;
const MOVE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(MOVE_CURSOR_SVG)}") 12 12, move`;

export default function DrawingCanvas({ sketchId }: { sketchId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  // The shapes array itself lives in Liveblocks' shared room storage, not
  // local state - that's what makes edits show up for every collaborator.
  // `useStorage` returns null until the room's storage has finished loading
  // over the network. The null check for that lives further down, AFTER
  // every hook in this component (Rules of Hooks - an early return before
  // some of them would change how many hooks run between renders), which is
  // also why two effects below depend on this raw `shapesFromStorage`
  // instead of the narrowed `shapes` defined after the check: `shapes`
  // doesn't exist yet at the point those effects are declared.
  const shapesFromStorage = useStorage((root) => root.shapes);
  const setShapesMutation = useMutation(({ storage }, next: Shape[]) => {
    storage.set("shapes", next);
  }, []);
  const [, updateMyPresence] = useMyPresence();
  const others = useOthers();
  // Undo/redo stacks of past shapes snapshots - restored from localStorage
  // after mount (not in the initializer: localStorage doesn't exist during
  // server rendering, so reading it before the first paint would make the
  // client's initial render disagree with the server's and break hydration)
  // so history survives a refresh, and written back on every change.
  const [past, setPast] = useState<Shape[][]>([]);
  const [future, setFuture] = useState<Shape[][]>([]);
  // Plain state, not a ref: it needs to flip to true in the SAME re-render
  // where past/future actually become the loaded values (React batches the
  // three setters below together), so the persist effect's guard and the
  // loaded data land in the same render. A ref would flip synchronously
  // inside the load effect itself, before that render happens - so the
  // persist effect (running right after, in that same first pass) would see
  // the guard already open but past/future still at their pre-load `[]`,
  // and overwrite the just-read localStorage data with those empty arrays.
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // The shape a double-click most recently landed on - stays set while its
  // action menu is open, while it's being moved, or while a fill/outline color
  // is "armed" for it, and clears again once the interaction ends.
  const [selectedShapeIndex, setSelectedShapeIndex] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveMode, setMoveMode] = useState(false);
  const [moveLastPoint, setMoveLastPoint] = useState<Point | null>(null);
  // Resize scales the shape live as the mouse moves away from (or toward)
  // its center - resizeStartDistance anchors "how far the mouse was on the
  // first sample" so the scale factor is relative to that, not to the
  // shape's original size directly. resizeOriginalShape is a frozen snapshot
  // scaled fresh from each move, so repeated small scales don't compound
  // rounding drift.
  const [resizeMode, setResizeMode] = useState(false);
  const [resizeCenter, setResizeCenter] = useState<Point | null>(null);
  const [resizeStartDistance, setResizeStartDistance] = useState<number | null>(null);
  const [resizeOriginalShape, setResizeOriginalShape] = useState<Shape | null>(null);
  const [colorMode, setColorMode] = useState<"fill" | "outline" | null>(null);
  const [currentColor, setCurrentColor] = useState(COLORS[0]);
  // Every point the mouse passes through while the pencil tool is dragging -
  // unlike the other tools, pencil needs the whole path, not just start/end.
  const [pencilPoints, setPencilPoints] = useState<Point[]>([]);
  // Finishing a drag-drawn shape also fires a trailing native "click" event -
  // this flag lets that click be told apart from a genuine standalone click,
  // so finishing a drawing doesn't accidentally trigger a fill too.
  const justFinishedDrawingRef = useRef(false);

  // Canvas pixels aren't part of React's render output - whatever was saved
  // has to be painted onto the blank canvas by hand, both once on mount and
  // again whenever selection changes (a plain click that only selects a
  // shape, with no shape mutation, wouldn't otherwise trigger a redraw, and
  // the selection highlight needs to appear/disappear). Calls the `redraw`
  // function declared further down - safe despite the ordering, since
  // function declarations are hoisted and this only actually runs later,
  // deferred, well after the whole component body (including `shapes`
  // below) has finished executing for this render.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    redraw(context, canvas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapesFromStorage, selectedShapeIndex]);

  // Skips the very first run - shapes just loaded from the server on mount,
  // there's nothing new to save yet. Storage arrives as null before it's
  // loaded, then becomes the real array once it has (see the room-storage
  // hook above) - that transition isn't a real edit either, just the
  // initial sync completing, so it's treated the same as "still loading."
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (shapesFromStorage === null) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // Waits a beat after the last change (e.g. the end of a drag, which fires
    // many rapid updates) instead of saving on every single shape edit.
    const timeout = setTimeout(() => {
      handleSave();
    }, 1000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapesFromStorage]);

  // Loads undo/redo history from localStorage once, after mount (client-only
  // - see the state declarations above for why this can't happen earlier).
  // Calling setState synchronously in an effect is usually a smell (the
  // linter's right to flag it in general), but hydrating from a browser-only
  // API right after mount, specifically to avoid an SSR/client mismatch, is
  // the standard justified exception - there's no other point in the render
  // cycle where localStorage can safely be read.
  useEffect(() => {
    const loaded = loadHistory(sketchId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPast(loaded.past);
    setFuture(loaded.future);
    setHistoryLoaded(true);
  }, [sketchId]);

  // Keeps undo/redo history in localStorage in sync with the in-memory
  // stacks, so it's there on the next visit instead of resetting on refresh.
  // Skipped until the load above has run, otherwise this would fire first
  // (with the empty initial state) and overwrite what was actually saved.
  useEffect(() => {
    if (!historyLoaded) return;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(undoStorageKey(sketchId), JSON.stringify({ past, future }));
  }, [sketchId, past, future, historyLoaded]);

  // Every hook in this component has now run (Rules of Hooks satisfied) -
  // only past this point is `shapes` guaranteed loaded, so nothing below can
  // fire a mutation against storage that doesn't exist yet. Everything from
  // here down - including every function declared below - closes over this
  // freshly, explicitly Shape[]-typed `shapes` rather than the nullable
  // `shapesFromStorage`, so none of it has to null-check on every access.
  if (shapesFromStorage === null) {
    return (
      <div className="flex flex-col items-center gap-2 py-20 text-sm text-zinc-500">
        Connecting to the room...
      </div>
    );
  }
  const shapes: Shape[] = shapesFromStorage;

  async function handleSave() {
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/sketches/${sketchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: shapes }),
      });
      setSaveStatus(res.ok ? "saved" : "error");
    } catch {
      setSaveStatus("error");
    }
  }

  // Removes whichever shape is under the point, topmost first - same
  // hit-testing already used for double-click select, just deleting instead
  // of picking up. Called continuously while dragging, so a drag can wipe out
  // several shapes in one stroke, like a real eraser.
  function eraseAt(point: Point) {
    for (let i = shapes.length - 1; i >= 0; i--) {
      if (hitTestShape(shapes[i], point)) {
        const nextShapes = shapes.filter((_, idx) => idx !== i);
        commitShapes(nextShapes);
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (canvas && context) redraw(context, canvas, undefined, nextShapes);
        return;
      }
    }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (moveMode || resizeMode || !tool) return;
    const point = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
    setIsDrawing(true);
    setStartPoint(point);
    if (tool === "pencil" || tool === "brush") {
      setPencilPoints([point]);
    }
    if (tool === "eraser") {
      eraseAt(point);
    }
  }

  // A star's points aren't stored directly - they're computed from its center + radius.
  // Both drawing and hit-testing need that same list of points, so it lives in one place.
  function getStarPoints(star: { x: number; y: number; radius: number }): Point[] {
    const points = 5;
    const outerRadius = star.radius;
    const innerRadius = star.radius * 0.4;
    const result: Point[] = [];
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = -Math.PI / 2 + (i * Math.PI) / points;
      result.push({ x: star.x + radius * Math.cos(angle), y: star.y + radius * Math.sin(angle) });
    }
    return result;
  }

  // Standard ray-casting point-in-polygon test: count how many polygon edges a
  // rightward ray from the point crosses. Odd number of crossings = inside.
  function pointInPolygon(point: Point, vertices: Point[]): boolean {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
      const a = vertices[i];
      const b = vertices[j];
      const crosses =
        a.y > point.y !== b.y > point.y &&
        point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  // Shortest distance from a point to a line SEGMENT (not an infinite line) -
  // projects the point onto the segment, clamping to its two ends.
  function distanceToSegment(point: Point, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    let t = lengthSquared === 0 ? 0 : ((point.x - x1) * dx + (point.y - y1) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    const closestX = x1 + t * dx;
    const closestY = y1 + t * dy;
    return Math.sqrt((point.x - closestX) ** 2 + (point.y - closestY) ** 2);
  }

  function hitTestShape(shape: Shape, point: Point): boolean {
    if (shape.type === "circle") {
      const dx = point.x - shape.x;
      const dy = point.y - shape.y;
      return Math.sqrt(dx * dx + dy * dy) <= shape.radius;
    }

    if (shape.type === "box") {
      return (
        point.x >= shape.x &&
        point.x <= shape.x + shape.width &&
        point.y >= shape.y &&
        point.y <= shape.y + shape.height
      );
    }

    if (shape.type === "line") {
      return distanceToSegment(point, shape.x1, shape.y1, shape.x2, shape.y2) <= 6;
    }

    if (shape.type === "triangle") {
      return pointInPolygon(point, [
        { x: shape.x1, y: shape.y1 },
        { x: shape.x2, y: shape.y2 },
        { x: shape.x3, y: shape.y3 },
      ]);
    }

    if (shape.type === "star") {
      return pointInPolygon(point, getStarPoints(shape));
    }

    if (shape.type === "pencil") {
      const tolerance = (shape.strokeWidth ?? PENCIL_WIDTH) / 2 + 3;
      for (let i = 0; i < shape.points.length - 1; i++) {
        const a = shape.points[i];
        const b = shape.points[i + 1];
        if (distanceToSegment(point, a.x, a.y, b.x, b.y) <= tolerance) return true;
      }
      return false;
    }

    return false;
  }

  // Moving a shape means shifting every one of its coordinate pairs by the same
  // amount - a circle just needs its center moved, but a triangle has three
  // separate points that all have to shift together to keep its shape intact.
  function translateShape(shape: Shape, dx: number, dy: number): Shape {
    if (shape.type === "circle" || shape.type === "star") {
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
    }
    if (shape.type === "box") {
      return { ...shape, x: shape.x + dx, y: shape.y + dy };
    }
    if (shape.type === "line") {
      return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy };
    }
    if (shape.type === "pencil") {
      return { ...shape, points: shape.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
    }
    return {
      ...shape,
      x1: shape.x1 + dx,
      y1: shape.y1 + dy,
      x2: shape.x2 + dx,
      y2: shape.y2 + dy,
      x3: shape.x3 + dx,
      y3: shape.y3 + dy,
    };
  }

  // Where a shape's own center is - resizing scales every point away from
  // (or toward) this point, so the shape grows/shrinks in place instead of
  // drifting as it resizes.
  function getShapeCenter(shape: Shape): Point {
    if (shape.type === "circle" || shape.type === "star") {
      return { x: shape.x, y: shape.y };
    }
    if (shape.type === "box") {
      return { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
    }
    if (shape.type === "line") {
      return { x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 };
    }
    if (shape.type === "triangle") {
      return {
        x: (shape.x1 + shape.x2 + shape.x3) / 3,
        y: (shape.y1 + shape.y2 + shape.y3) / 3,
      };
    }
    if (shape.points.length === 0) return { x: 0, y: 0 };
    let sumX = 0;
    let sumY = 0;
    for (const point of shape.points) {
      sumX += point.x;
      sumY += point.y;
    }
    return { x: sumX / shape.points.length, y: sumY / shape.points.length };
  }

  // Axis-aligned box around a shape - used only to draw the dashed selection
  // outline, so it doesn't need to be exact for circle/star, just enclosing.
  function getShapeBoundingBox(shape: Shape): { minX: number; minY: number; maxX: number; maxY: number } {
    if (shape.type === "circle" || shape.type === "star") {
      return {
        minX: shape.x - shape.radius,
        minY: shape.y - shape.radius,
        maxX: shape.x + shape.radius,
        maxY: shape.y + shape.radius,
      };
    }
    if (shape.type === "box") {
      return { minX: shape.x, minY: shape.y, maxX: shape.x + shape.width, maxY: shape.y + shape.height };
    }
    if (shape.type === "line") {
      return {
        minX: Math.min(shape.x1, shape.x2),
        minY: Math.min(shape.y1, shape.y2),
        maxX: Math.max(shape.x1, shape.x2),
        maxY: Math.max(shape.y1, shape.y2),
      };
    }
    if (shape.type === "triangle") {
      return {
        minX: Math.min(shape.x1, shape.x2, shape.x3),
        minY: Math.min(shape.y1, shape.y2, shape.y3),
        maxX: Math.max(shape.x1, shape.x2, shape.x3),
        maxY: Math.max(shape.y1, shape.y2, shape.y3),
      };
    }
    const xs = shape.points.map((p) => p.x);
    const ys = shape.points.map((p) => p.y);
    return {
      minX: Math.min(...xs, 0),
      minY: Math.min(...ys, 0),
      maxX: Math.max(...xs, 0),
      maxY: Math.max(...ys, 0),
    };
  }

  // Scales every point of a shape by `factor`, away from `center` - the same
  // shape, just bigger or smaller, without moving where it's centered.
  function scaleShape(shape: Shape, factor: number, center: Point): Shape {
    const scalePoint = (x: number, y: number) => ({
      x: center.x + (x - center.x) * factor,
      y: center.y + (y - center.y) * factor,
    });

    if (shape.type === "circle" || shape.type === "star") {
      return { ...shape, radius: Math.max(4, shape.radius * factor) };
    }
    if (shape.type === "box") {
      const width = Math.max(6, shape.width * factor);
      const height = Math.max(6, shape.height * factor);
      return { ...shape, width, height, x: center.x - width / 2, y: center.y - height / 2 };
    }
    if (shape.type === "line") {
      const p1 = scalePoint(shape.x1, shape.y1);
      const p2 = scalePoint(shape.x2, shape.y2);
      return { ...shape, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
    }
    if (shape.type === "triangle") {
      const p1 = scalePoint(shape.x1, shape.y1);
      const p2 = scalePoint(shape.x2, shape.y2);
      const p3 = scalePoint(shape.x3, shape.y3);
      return { ...shape, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x3: p3.x, y3: p3.y };
    }
    return { ...shape, points: shape.points.map((point) => scalePoint(point.x, point.y)) };
  }

  // How close a double-click needs to land to a shape's edge (or, for
  // line/pencil which have no interior, to one of its ends) to mean "resize"
  // rather than "move". Double-clicking near the middle of a shape's body
  // still picks it up to move, exactly as before.
  const EDGE_GRAB_TOLERANCE = 10;

  function isNearShapeEdge(shape: Shape, point: Point): boolean {
    if (shape.type === "circle" || shape.type === "star") {
      const dist = Math.sqrt((point.x - shape.x) ** 2 + (point.y - shape.y) ** 2);
      return Math.abs(dist - shape.radius) <= EDGE_GRAB_TOLERANCE;
    }
    if (shape.type === "box") {
      const { x, y, width, height } = shape;
      const edges: [number, number, number, number][] = [
        [x, y, x + width, y],
        [x, y + height, x + width, y + height],
        [x, y, x, y + height],
        [x + width, y, x + width, y + height],
      ];
      return edges.some(([x1, y1, x2, y2]) => distanceToSegment(point, x1, y1, x2, y2) <= EDGE_GRAB_TOLERANCE);
    }
    if (shape.type === "triangle") {
      const edges: [number, number, number, number][] = [
        [shape.x1, shape.y1, shape.x2, shape.y2],
        [shape.x2, shape.y2, shape.x3, shape.y3],
        [shape.x3, shape.y3, shape.x1, shape.y1],
      ];
      return edges.some(([x1, y1, x2, y2]) => distanceToSegment(point, x1, y1, x2, y2) <= EDGE_GRAB_TOLERANCE);
    }
    if (shape.type === "line") {
      const d1 = Math.hypot(point.x - shape.x1, point.y - shape.y1);
      const d2 = Math.hypot(point.x - shape.x2, point.y - shape.y2);
      return Math.min(d1, d2) <= EDGE_GRAB_TOLERANCE;
    }
    if (shape.points.length === 0) return false;
    const first = shape.points[0];
    const last = shape.points[shape.points.length - 1];
    const d1 = Math.hypot(point.x - first.x, point.y - first.y);
    const d2 = Math.hypot(point.x - last.x, point.y - last.y);
    return Math.min(d1, d2) <= EDGE_GRAB_TOLERANCE;
  }

  function handleDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const point = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };

    for (let i = shapes.length - 1; i >= 0; i--) {
      if (hitTestShape(shapes[i], point)) {
        // Double-click picks the shape straight up to drag - to move if it
        // lands on the shape's body, to resize if it lands near its edge
        // (or, for line/pencil, near one of its ends). The Fill/Outline/
        // behavior menu is a single-click's job (see handleClick) - it stays
        // closed here so the shape doesn't visibly drag itself while the
        // mouse travels up toward a menu button.
        setSelectedShapeIndex(i);
        setColorMode(null);
        setMenuOpen(false);
        snapshotForUpcomingDrag();
        if (isNearShapeEdge(shapes[i], point)) {
          setMoveMode(false);
          setMoveLastPoint(null);
          setResizeCenter(getShapeCenter(shapes[i]));
          setResizeOriginalShape(shapes[i]);
          setResizeStartDistance(null);
          setResizeMode(true);
        } else {
          setMoveMode(true);
          setMoveLastPoint(null);
          setResizeMode(false);
          setResizeCenter(null);
          setResizeStartDistance(null);
          setResizeOriginalShape(null);
        }
        return;
      }
    }

    // Double-clicked empty space - close out whatever was selected, if anything.
    setSelectedShapeIndex(null);
    setMenuOpen(false);
    setMoveMode(false);
    setColorMode(null);
    setResizeMode(false);
    setResizeCenter(null);
    setResizeStartDistance(null);
    setResizeOriginalShape(null);
  }

  // Called when the user picks Shape Fill / Shape Outline for the
  // double-clicked shape - arms the palette so the next color click fills it
  // (or recolors its outline) instead of moving it.
  function handleMenuAction(action: "fill" | "outline") {
    setMenuOpen(false);
    setColorMode(action);
    setMoveMode(false);
    setResizeMode(false);
    setResizeCenter(null);
    setResizeStartDistance(null);
    setResizeOriginalShape(null);
  }

  // Toggles a behavior on the selected shape, whatever type it is - purely a
  // data flag, animated only in the separate Three.js Live view. The dropdown
  // shows the shape's current behavior directly, so setting it just replaces
  // whatever was there (a shape carries at most one behavior at a time) -
  // selection stays open afterward so more than one option can be tried.
  function handleSelectBehavior(value: string) {
    if (selectedShapeIndex === null) return;
    const behavior = (value === "" ? undefined : value) as Behavior | undefined;
    const index = selectedShapeIndex;
    commitShapes(shapes.map((shape, idx) => (idx === index ? { ...shape, behavior } : shape)));
  }

  function handlePickColor(color: string) {
    setCurrentColor(color);

    if (selectedShapeIndex === null || colorMode === null) return;

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const index = selectedShapeIndex;
    const recoloredShapes = shapes.map((shape, idx) => {
      if (idx !== index) return shape;
      if (colorMode === "outline") return { ...shape, color };
      if (shape.type === "line" || shape.type === "pencil") return shape; // no interior to fill
      return { ...shape, fillColor: color };
    });
    commitShapes(recoloredShapes);
    redraw(context, canvas, undefined, recoloredShapes);
  }

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (justFinishedDrawingRef.current) {
      justFinishedDrawingRef.current = false;
      return;
    }

    if (moveMode) {
      setMoveMode(false);
      setSelectedShapeIndex(null);
      setMoveLastPoint(null);
      setMenuOpen(false);
      return;
    }

    if (resizeMode) {
      setResizeMode(false);
      setSelectedShapeIndex(null);
      setResizeCenter(null);
      setResizeStartDistance(null);
      setResizeOriginalShape(null);
      setMenuOpen(false);
      return;
    }

    if (colorMode !== null) {
      setColorMode(null);
      setSelectedShapeIndex(null);
      return;
    }

    // A plain click on a shape - not a drag, not a double-click - just
    // selects it and shows its Fill/Outline/behavior menu. The shape stays
    // exactly where it is; only double-click picks it up to move or resize.
    if (!tool) {
      const point = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
      for (let i = shapes.length - 1; i >= 0; i--) {
        if (hitTestShape(shapes[i], point)) {
          setSelectedShapeIndex(i);
          setMenuOpen(true);
          return;
        }
      }
    }

    if (menuOpen) {
      setMenuOpen(false);
      setSelectedShapeIndex(null);
    }
  }

  function strokeCircle(
    context: CanvasRenderingContext2D,
    circle: { x: number; y: number; radius: number; color: string; fillColor?: string },
  ) {
    context.beginPath();
    context.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
    if (circle.fillColor) {
      context.fillStyle = circle.fillColor;
      context.fill();
    }
    context.strokeStyle = circle.color;
    context.lineWidth = 3;
    context.stroke();
  }

  function strokeBox(
    context: CanvasRenderingContext2D,
    rect: { x: number; y: number; width: number; height: number; color: string; fillColor?: string },
  ) {
    if (rect.fillColor) {
      context.fillStyle = rect.fillColor;
      context.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    context.strokeStyle = rect.color;
    context.lineWidth = 3;
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }

  function strokeLine(
    context: CanvasRenderingContext2D,
    line: { x1: number; y1: number; x2: number; y2: number; color: string },
  ) {
    context.strokeStyle = line.color;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(line.x1, line.y1);
    context.lineTo(line.x2, line.y2);
    context.stroke();
  }

  function strokeTriangle(
    context: CanvasRenderingContext2D,
    tri: {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x3: number;
      y3: number;
      color: string;
      fillColor?: string;
    },
  ) {
    context.beginPath();
    context.moveTo(tri.x1, tri.y1);
    context.lineTo(tri.x2, tri.y2);
    context.lineTo(tri.x3, tri.y3);
    context.closePath();
    if (tri.fillColor) {
      context.fillStyle = tri.fillColor;
      context.fill();
    }
    context.strokeStyle = tri.color;
    context.lineWidth = 3;
    context.stroke();
  }

  function strokeStar(
    context: CanvasRenderingContext2D,
    star: { x: number; y: number; radius: number; color: string; fillColor?: string },
  ) {
    const points = getStarPoints(star);
    context.beginPath();
    points.forEach((point, i) => {
      if (i === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    context.closePath();
    if (star.fillColor) {
      context.fillStyle = star.fillColor;
      context.fill();
    }
    context.strokeStyle = star.color;
    context.lineWidth = 3;
    context.stroke();
  }

  function strokePencil(
    context: CanvasRenderingContext2D,
    pencil: { points: Point[]; color: string; strokeWidth?: number },
  ) {
    if (pencil.points.length < 2) return;
    context.strokeStyle = pencil.color;
    context.lineWidth = pencil.strokeWidth ?? PENCIL_WIDTH;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    pencil.points.forEach((point, i) => {
      if (i === 0) {
        context.moveTo(point.x, point.y);
      } else {
        context.lineTo(point.x, point.y);
      }
    });
    context.stroke();
  }

  function drawShape(context: CanvasRenderingContext2D, shape: Shape) {
    if (shape.type === "circle") {
      strokeCircle(context, shape);
    } else if (shape.type === "box") {
      strokeBox(context, shape);
    } else if (shape.type === "line") {
      strokeLine(context, shape);
    } else if (shape.type === "triangle") {
      strokeTriangle(context, shape);
    } else if (shape.type === "star") {
      strokeStar(context, shape);
    } else if (shape.type === "pencil") {
      strokePencil(context, shape);
    }
  }

  function redraw(
    context: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    preview?: Shape,
    shapesOverride?: Shape[],
  ) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const activeShapes = shapesOverride ?? shapes;
    for (const shape of activeShapes) {
      drawShape(context, shape);
    }
    if (preview) {
      drawShape(context, preview);
    }

    // A dashed box around whichever shape is currently selected - the only
    // visual cue for "this is what a click/double-click will act on", since
    // otherwise nothing on screen shows a shape is selected at all.
    if (selectedShapeIndex !== null && activeShapes[selectedShapeIndex]) {
      const padding = 8;
      const box = getShapeBoundingBox(activeShapes[selectedShapeIndex]);
      context.save();
      context.strokeStyle = "#2563eb";
      context.lineWidth = 1.5;
      context.setLineDash([6, 4]);
      context.strokeRect(
        box.minX - padding,
        box.minY - padding,
        box.maxX - box.minX + padding * 2,
        box.maxY - box.minY + padding * 2,
      );
      context.restore();
    }
  }

  // Records the shapes as they are right now as one undo step, then switches
  // to `next` - starting a brand new action always clears redo history, the
  // same way every other editor's undo stack works. Reads `shapes` from this
  // render's closure rather than a setShapes functional updater on purpose:
  // an updater function must be pure, and React (in development) invokes it
  // twice to enforce that, which would double-push history on every action.
  function commitShapes(next: Shape[]) {
    setPast((p) => [...p, shapes].slice(-HISTORY_LIMIT));
    setFuture([]);
    setShapesMutation(next);
  }

  // Marks "an action is about to begin" without changing shapes yet - used
  // right before a move/resize drag starts, so every frame of that drag
  // collapses into a single undo step instead of one step per mousemove.
  function snapshotForUpcomingDrag() {
    setPast((p) => [...p, shapes].slice(-HISTORY_LIMIT));
    setFuture([]);
  }

  function handleUndo() {
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    setFuture((f) => [...f, shapes].slice(-HISTORY_LIMIT));
    setPast((p) => p.slice(0, -1));
    setShapesMutation(previous);
    setSelectedShapeIndex(null);
    setMenuOpen(false);
    setColorMode(null);
    setMoveMode(false);
    setResizeMode(false);
    setResizeCenter(null);
    setResizeStartDistance(null);
    setResizeOriginalShape(null);
  }

  function handleRedo() {
    if (future.length === 0) return;
    const next = future[future.length - 1];
    setPast((p) => [...p, shapes].slice(-HISTORY_LIMIT));
    setFuture((f) => f.slice(0, -1));
    setShapesMutation(next);
    setSelectedShapeIndex(null);
    setMenuOpen(false);
    setColorMode(null);
    setMoveMode(false);
    setResizeMode(false);
    setResizeCenter(null);
    setResizeStartDistance(null);
    setResizeOriginalShape(null);
  }

  function buildShape(
    startPoint: Point,
    currentPoint: Point,
    tool: string | null,
    color: string,
  ): Shape | null {
    if (tool === "circle") {
      const dx = currentPoint.x - startPoint.x;
      const dy = currentPoint.y - startPoint.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      return { type: "circle", x: startPoint.x, y: startPoint.y, radius, color };
    }

    if (tool === "box") {
      const x = Math.min(startPoint.x, currentPoint.x);
      const y = Math.min(startPoint.y, currentPoint.y);
      const width = Math.abs(currentPoint.x - startPoint.x);
      const height = Math.abs(currentPoint.y - startPoint.y);
      return { type: "box", x, y, width, height, color };
    }

    if (tool === "line") {
      return {
        type: "line",
        x1: startPoint.x,
        y1: startPoint.y,
        x2: currentPoint.x,
        y2: currentPoint.y,
        color,
      };
    }

    if (tool === "triangle") {
      const x = Math.min(startPoint.x, currentPoint.x);
      const y = Math.min(startPoint.y, currentPoint.y);
      const width = Math.abs(currentPoint.x - startPoint.x);
      const height = Math.abs(currentPoint.y - startPoint.y);
      return {
        type: "triangle",
        x1: x + width / 2,
        y1: y,
        x2: x,
        y2: y + height,
        x3: x + width,
        y3: y + height,
        color,
      };
    }

    if (tool === "star") {
      const dx = currentPoint.x - startPoint.x;
      const dy = currentPoint.y - startPoint.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      return { type: "star", x: startPoint.x, y: startPoint.y, radius, color };
    }

    return null;
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    // Broadcasts where the mouse is to every other collaborator in the room,
    // regardless of what else this move is doing (drawing, moving, resizing)
    // - it's just "here's my cursor," independent of the actual edit logic.
    updateMyPresence({ cursor: { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY } });

    if (isDrawing && tool === "eraser") {
      eraseAt({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
      return;
    }

    if (moveMode && selectedShapeIndex !== null) {
      const currentPoint = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };

      // First move sample after "Move" is picked just anchors the starting
      // point - the shape shouldn't jump to wherever the mouse happens to be.
      if (!moveLastPoint) {
        setMoveLastPoint(currentPoint);
        return;
      }

      const dx = currentPoint.x - moveLastPoint.x;
      const dy = currentPoint.y - moveLastPoint.y;

      const movedShapes = shapes.map((shape, i) =>
        i === selectedShapeIndex ? translateShape(shape, dx, dy) : shape,
      );
      setShapesMutation(movedShapes);
      setMoveLastPoint(currentPoint);
      redraw(context, canvas, undefined, movedShapes);
      return;
    }

    if (resizeMode && selectedShapeIndex !== null && resizeCenter && resizeOriginalShape) {
      const currentPoint = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
      const dx = currentPoint.x - resizeCenter.x;
      const dy = currentPoint.y - resizeCenter.y;
      const currentDistance = Math.sqrt(dx * dx + dy * dy);

      // First move sample after "Resize" is picked just anchors the starting
      // distance from center - the shape shouldn't jump in size before the
      // mouse has actually moved.
      if (resizeStartDistance === null) {
        setResizeStartDistance(Math.max(currentDistance, 1));
        return;
      }

      const factor = Math.min(6, Math.max(0.1, currentDistance / resizeStartDistance));
      const resizedShapes = shapes.map((shape, i) =>
        i === selectedShapeIndex ? scaleShape(resizeOriginalShape, factor, resizeCenter) : shape,
      );
      setShapesMutation(resizedShapes);
      redraw(context, canvas, undefined, resizedShapes);
      return;
    }

    if (!isDrawing || !startPoint) return;

    if (tool === "pencil" || tool === "brush") {
      const currentPoint = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
      const nextPoints = [...pencilPoints, currentPoint];
      setPencilPoints(nextPoints);
      const strokeWidth = tool === "brush" ? BRUSH_WIDTH : PENCIL_WIDTH;
      redraw(context, canvas, { type: "pencil", points: nextPoints, color: currentColor, strokeWidth });
      return;
    }

    const currentPoint = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
    const preview = buildShape(startPoint, currentPoint, tool, currentColor);

    redraw(context, canvas, preview ?? undefined);
  }

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (moveMode || resizeMode) return;
    if (isDrawing && tool === "eraser") {
      // Stays armed after erasing, unlike the drawing tools - a real eraser
      // doesn't put itself away after removing one thing.
      setIsDrawing(false);
      setStartPoint(null);
      return;
    }
    if (isDrawing && (tool === "pencil" || tool === "brush")) {
      if (pencilPoints.length > 1) {
        const strokeWidth = tool === "brush" ? BRUSH_WIDTH : PENCIL_WIDTH;
        commitShapes([...shapes, { type: "pencil", points: pencilPoints, color: currentColor, strokeWidth }]);
        justFinishedDrawingRef.current = true;
        setTool(null);
      }
      setPencilPoints([]);
      setIsDrawing(false);
      setStartPoint(null);
      return;
    }
    if (isDrawing && startPoint) {
      const currentPoint = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
      const dx = currentPoint.x - startPoint.x;
      const dy = currentPoint.y - startPoint.y;
      const dragDistance = Math.sqrt(dx * dx + dy * dy);

      if (dragDistance > 3) {
        const finished = buildShape(startPoint, currentPoint, tool, currentColor);
        if (finished) {
          commitShapes([...shapes, finished]);
        }
        justFinishedDrawingRef.current = true;
        // Mirrors how drawing tools behave in MS Word/PowerPoint: the tool
        // deselects itself after one shape, instead of staying armed forever.
        setTool(null);
      }
    }
    setIsDrawing(false);
    setStartPoint(null);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="rounded-full bg-foreground px-5 py-1 text-sm font-medium text-background"
        >
          Save
        </button>
        <button
          type="button"
          onClick={handleUndo}
          disabled={past.length === 0}
          aria-label="Undo"
          title="Undo"
          className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-black/12 text-xl leading-none font-bold disabled:opacity-30 dark:border-white/[.145]"
        >
          &larr;
        </button>
        <button
          type="button"
          onClick={handleRedo}
          disabled={future.length === 0}
          aria-label="Redo"
          title="Redo"
          className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-black/12 text-xl leading-none font-bold disabled:opacity-30 dark:border-white/[.145]"
        >
          &rarr;
        </button>
        <span className="text-sm text-zinc-500">
          {saveStatus === "saving" && "Saving..."}
          {saveStatus === "saved" && "Saved"}
          {saveStatus === "error" && "Couldn't save - try again"}
        </span>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTool("circle")}
          className="rounded-full border border-black/[.12] px-4 py-1 text-sm font-medium dark:border-white/[.145]"
        >
          Circle {tool === "circle" ? "(selected)" : ""}
        </button>
        <button
          type="button"
          onClick={() => setTool("box")}
          className="rounded-full border border-black/[.12] px-4 py-1 text-sm font-medium dark:border-white/[.145]"
        >
          Box {tool === "box" ? "(selected)" : ""}
        </button>
        <button
          type="button"
          onClick={() => setTool("line")}
          className="rounded-full border border-black/[.12] px-4 py-1 text-sm font-medium dark:border-white/[.145]"
        >
          Line {tool === "line" ? "(selected)" : ""}
        </button>
        <button
          type="button"
          onClick={() => setTool("triangle")}
          className="rounded-full border border-black/[.12] px-4 py-1 text-sm font-medium dark:border-white/[.145]"
        >
          Triangle {tool === "triangle" ? "(selected)" : ""}
        </button>
        <button
          type="button"
          onClick={() => setTool("star")}
          className="rounded-full border border-black/[.12] px-4 py-1 text-sm font-medium dark:border-white/[.145]"
        >
          Star {tool === "star" ? "(selected)" : ""}
        </button>
        <button
          type="button"
          onClick={() => setTool("pencil")}
          className="rounded-full border border-black/[.12] px-4 py-1 text-sm font-medium dark:border-white/[.145]"
        >
          Pencil {tool === "pencil" ? "(selected)" : ""}
        </button>
        <button
          type="button"
          onClick={() => setTool("brush")}
          className="rounded-full border border-black/[.12] px-4 py-1 text-sm font-medium dark:border-white/[.145]"
        >
          Brush {tool === "brush" ? "(selected)" : ""}
        </button>
        <button
          type="button"
          onClick={() => setTool((current) => (current === "eraser" ? null : "eraser"))}
          className="rounded-full border border-black/[.12] px-4 py-1 text-sm font-medium dark:border-white/[.145]"
        >
          Eraser {tool === "eraser" ? "(selected)" : ""}
        </button>
      </div>
      {/* Always rendered (never unmounted) so this row's height is reserved
          whether or not a shape is selected - hiding it via display:none
          the way {menuOpen && ...} used to would let the canvas jump up and
          down as selection changes, which is what made double-clicks land
          in the wrong spot right after picking a color. */}
      <div
        className="flex min-h-9.5 items-center gap-2"
        style={{ visibility: menuOpen && selectedShapeIndex !== null ? "visible" : "hidden" }}
      >
        <button
          type="button"
          onClick={() => handleMenuAction("fill")}
          className="rounded-full border border-blue-600 bg-blue-50 px-4 py-1 text-sm font-medium text-blue-600 dark:bg-blue-950"
        >
          Shape Fill
        </button>
        <button
          type="button"
          onClick={() => handleMenuAction("outline")}
          className="rounded-full border border-blue-600 bg-blue-50 px-4 py-1 text-sm font-medium text-blue-600 dark:bg-blue-950"
        >
          Shape Outline
        </button>
        <label className="ml-2 flex items-center gap-1.5 text-sm font-medium text-zinc-600 dark:text-zinc-300">
          Behavior
          <select
            value={(selectedShapeIndex !== null ? shapes[selectedShapeIndex]?.behavior : undefined) ?? ""}
            onChange={(e) => handleSelectBehavior(e.target.value)}
            className="rounded-full border border-black/12 bg-transparent px-3 py-1 text-sm dark:border-white/[.145]"
          >
            {BEHAVIOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex items-center gap-2">
        {COLORS.map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => handlePickColor(color)}
            aria-label={color}
            className="h-7 w-7 rounded-full border-2"
            style={{
              backgroundColor: color,
              borderColor: currentColor === color ? "#2563eb" : "rgba(0,0,0,0.15)",
            }}
          />
        ))}
        {colorMode && (
          <span className="text-sm text-black/60 dark:text-white/60">
            Pick a color to {colorMode === "fill" ? "fill the shape" : "recolor its outline"}
          </span>
        )}
      </div>
      {/* The border lives here, not on the canvas, so the wrapper's content
          box lines up pixel-for-pixel with the canvas's own coordinate space
          - collaborators' cursor overlays are positioned absolutely using
          the same raw canvas coordinates the drawing logic already uses,
          with no border-width offset to account for. */}
      <div style={{ position: "relative", width: 800, height: 600, border: "2px solid black" }}>
        <canvas
          ref={canvasRef}
          width={800}
          height={600}
          style={{
            display: "block",
            background: "white",
            cursor: moveMode ? MOVE_CURSOR : resizeMode ? "nwse-resize" : "default",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => updateMyPresence({ cursor: null })}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        />
        {/* Other collaborators' live cursors, each labeled with their email
            and colored consistently (see colorForUserId in the auth route). */}
        {others.map((other) =>
          other.presence.cursor ? (
            <div
              key={other.connectionId}
              style={{
                position: "absolute",
                left: other.presence.cursor.x,
                top: other.presence.cursor.y,
                pointerEvents: "none",
                transform: "translate(-2px, -2px)",
                zIndex: 10,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" style={{ display: "block" }}>
                <path
                  d="M2 1 L2 15 L5.5 11.5 L8 17 L10 16 L7.5 10.5 L13 10.5 Z"
                  fill={other.info?.color ?? "#000000"}
                  stroke="white"
                  strokeWidth="1"
                />
              </svg>
              <span
                className="whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium text-white"
                style={{ backgroundColor: other.info?.color ?? "#000000" }}
              >
                {other.info?.name ?? "Someone"}
              </span>
            </div>
          ) : null,
        )}
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Click a shape to edit its color/behavior &middot; double-click its body to move &middot; double-click its
        edge to resize
      </p>
    </div>
  );
}
