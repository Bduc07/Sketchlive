"use client";

import { useEffect, useRef, useState } from "react";

type Point = { x: number; y: number };

// Any shape can carry any behavior - which shapes look best with which
// behavior is a matter of taste, not something the tool should decide for
// the person drawing.
type Behavior = "sun" | "river" | "twinkle";

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

const PENCIL_WIDTH = 3;
const BRUSH_WIDTH = 22;

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

export default function DrawingCanvas({
  sketchId,
  initialShapes,
}: {
  sketchId: string;
  initialShapes: Shape[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [shapes, setShapes] = useState<Shape[]>(initialShapes);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // The shape a double-click most recently landed on - stays set while its
  // action menu is open, while it's being moved, or while a fill/outline color
  // is "armed" for it, and clears again once the interaction ends.
  const [selectedShapeIndex, setSelectedShapeIndex] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveMode, setMoveMode] = useState(false);
  const [moveLastPoint, setMoveLastPoint] = useState<Point | null>(null);
  const [colorMode, setColorMode] = useState<"fill" | "outline" | null>(null);
  const [currentColor, setCurrentColor] = useState(COLORS[0]);
  // Every point the mouse passes through while the pencil tool is dragging -
  // unlike the other tools, pencil needs the whole path, not just start/end.
  const [pencilPoints, setPencilPoints] = useState<Point[]>([]);
  // Finishing a drag-drawn shape also fires a trailing native "click" event -
  // this flag lets that click be told apart from a genuine standalone click,
  // so finishing a drawing doesn't accidentally trigger a fill too.
  const justFinishedDrawingRef = useRef(false);

  // Removes whichever shape is under the point, topmost first - same
  // hit-testing already used for double-click select, just deleting instead
  // of picking up. Called continuously while dragging, so a drag can wipe out
  // several shapes in one stroke, like a real eraser.
  function eraseAt(point: Point) {
    setShapes((prevShapes) => {
      for (let i = prevShapes.length - 1; i >= 0; i--) {
        if (hitTestShape(prevShapes[i], point)) {
          const nextShapes = prevShapes.filter((_, idx) => idx !== i);
          const canvas = canvasRef.current;
          const context = canvas?.getContext("2d");
          if (canvas && context) redraw(context, canvas, undefined, nextShapes);
          return nextShapes;
        }
      }
      return prevShapes;
    });
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (moveMode || !tool) return;
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

  function handleDoubleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const point = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };

    for (let i = shapes.length - 1; i >= 0; i--) {
      if (hitTestShape(shapes[i], point)) {
        // Double-click both selects the shape and immediately picks it up to
        // move - no extra click needed. Shape Fill / Shape Outline stay as
        // menu options for when a color change is wanted instead of a move.
        setSelectedShapeIndex(i);
        setMoveMode(true);
        setMoveLastPoint(null);
        setColorMode(null);
        setMenuOpen(true);
        return;
      }
    }

    // Double-clicked empty space - close out whatever was selected, if anything.
    setSelectedShapeIndex(null);
    setMenuOpen(false);
    setMoveMode(false);
    setColorMode(null);
  }

  // Called when the user picks Shape Fill / Shape Outline for the
  // double-clicked shape - arms the palette so the next color click fills it
  // (or recolors its outline) instead of moving it.
  function handleMenuAction(action: "fill" | "outline") {
    setMenuOpen(false);
    setColorMode(action);
    setMoveMode(false);
  }

  // Toggles a behavior on the selected shape, whatever type it is - purely a
  // data flag, animated only in the separate Three.js Live view. Picking a
  // different behavior than the one already active switches to it rather
  // than stacking (a shape carries at most one behavior at a time).
  function handleToggleBehavior(behavior: "sun" | "river" | "twinkle") {
    setMenuOpen(false);
    setMoveMode(false);
    setMoveLastPoint(null);
    if (selectedShapeIndex === null) return;

    const index = selectedShapeIndex;
    const toggledShapes = shapes.map((shape, idx) => {
      if (idx !== index) return shape;
      return { ...shape, behavior: shape.behavior === behavior ? undefined : behavior };
    });
    setShapes(toggledShapes);
    setSelectedShapeIndex(null);
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
    setShapes(recoloredShapes);
    redraw(context, canvas, undefined, recoloredShapes);
  }

  function handleClick() {
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

    if (colorMode !== null) {
      setColorMode(null);
      setSelectedShapeIndex(null);
      return;
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
    for (const shape of shapesOverride ?? shapes) {
      drawShape(context, shape);
    }
    if (preview) {
      drawShape(context, preview);
    }
  }

  // Canvas pixels aren't part of React's render output - whatever was saved
  // has to be painted onto the blank canvas by hand once, right after mount.
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    redraw(context, canvas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Skips the very first run - shapes just loaded from the server on mount,
  // there's nothing new to save yet.
  const isFirstRender = useRef(true);
  useEffect(() => {
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
  }, [shapes]);

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
      setShapes(movedShapes);
      setMoveLastPoint(currentPoint);
      redraw(context, canvas, undefined, movedShapes);
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
    if (moveMode) return;
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
        setShapes((prev) => [
          ...prev,
          { type: "pencil", points: pencilPoints, color: currentColor, strokeWidth },
        ]);
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
          setShapes((prev) => [...prev, finished]);
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
      {menuOpen && (
        <div className="flex gap-2">
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
          {selectedShapeIndex !== null && (
            <>
              <button
                type="button"
                onClick={() => handleToggleBehavior("sun")}
                className="rounded-full border border-orange-500 bg-orange-50 px-4 py-1 text-sm font-medium text-orange-600 dark:bg-orange-950"
              >
                {shapes[selectedShapeIndex]?.behavior === "sun" ? "Remove Sun" : "Make Sun"}
              </button>
              <button
                type="button"
                onClick={() => handleToggleBehavior("river")}
                className="rounded-full border border-blue-700 bg-blue-50 px-4 py-1 text-sm font-medium text-blue-700 dark:bg-blue-950"
              >
                {shapes[selectedShapeIndex]?.behavior === "river" ? "Remove River" : "Make River"}
              </button>
              <button
                type="button"
                onClick={() => handleToggleBehavior("twinkle")}
                className="rounded-full border border-yellow-500 bg-yellow-50 px-4 py-1 text-sm font-medium text-yellow-700 dark:bg-yellow-950"
              >
                {shapes[selectedShapeIndex]?.behavior === "twinkle" ? "Remove Twinkle" : "Make Twinkle"}
              </button>
            </>
          )}
        </div>
      )}
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
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        style={{
          border: "2px solid black",
          background: "white",
          cursor: moveMode ? MOVE_CURSOR : "default",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      />
    </div>
  );
}
