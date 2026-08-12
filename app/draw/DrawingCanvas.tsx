"use client";

import { useRef, useState } from "react";

type Point = { x: number; y: number };

type Shape =
  | { type: "circle"; x: number; y: number; radius: number }
  | { type: "box"; x: number; y: number; width: number; height: number }
  | { type: "line"; x1: number; y1: number; x2: number; y2: number }
  | { type: "triangle"; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number }
  | { type: "star"; x: number; y: number; radius: number };

export default function DrawingCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState("circle");
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    setIsDrawing(true);
    setStartPoint({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
  }

  function strokeCircle(context: CanvasRenderingContext2D, circle: { x: number; y: number; radius: number }) {
    context.beginPath();
    context.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
    context.strokeStyle = "black";
    context.lineWidth = 3;
    context.stroke();
  }

  function strokeBox(
    context: CanvasRenderingContext2D,
    rect: { x: number; y: number; width: number; height: number },
  ) {
    context.strokeStyle = "black";
    context.lineWidth = 3;
    context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }

  function strokeLine(
    context: CanvasRenderingContext2D,
    line: { x1: number; y1: number; x2: number; y2: number },
  ) {
    context.strokeStyle = "black";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(line.x1, line.y1);
    context.lineTo(line.x2, line.y2);
    context.stroke();
  }

  function strokeTriangle(
    context: CanvasRenderingContext2D,
    tri: { x1: number; y1: number; x2: number; y2: number; x3: number; y3: number },
  ) {
    context.strokeStyle = "black";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(tri.x1, tri.y1);
    context.lineTo(tri.x2, tri.y2);
    context.lineTo(tri.x3, tri.y3);
    context.closePath();
    context.stroke();
  }

  function strokeStar(context: CanvasRenderingContext2D, star: { x: number; y: number; radius: number }) {
    const points = 5;
    const outerRadius = star.radius;
    const innerRadius = star.radius * 0.4;

    context.strokeStyle = "black";
    context.lineWidth = 3;
    context.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = -Math.PI / 2 + (i * Math.PI) / points;
      const x = star.x + radius * Math.cos(angle);
      const y = star.y + radius * Math.sin(angle);
      if (i === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    }
    context.closePath();
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
    }
  }

  function redraw(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement, preview?: Shape) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (const shape of shapes) {
      drawShape(context, shape);
    }
    if (preview) {
      drawShape(context, preview);
    }
  }

  function buildShape(startPoint: Point, currentPoint: Point, tool: string): Shape | null {
    if (tool === "circle") {
      const dx = currentPoint.x - startPoint.x;
      const dy = currentPoint.y - startPoint.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      return { type: "circle", x: startPoint.x, y: startPoint.y, radius };
    }

    if (tool === "box") {
      const x = Math.min(startPoint.x, currentPoint.x);
      const y = Math.min(startPoint.y, currentPoint.y);
      const width = Math.abs(currentPoint.x - startPoint.x);
      const height = Math.abs(currentPoint.y - startPoint.y);
      return { type: "box", x, y, width, height };
    }

    if (tool === "line") {
      return {
        type: "line",
        x1: startPoint.x,
        y1: startPoint.y,
        x2: currentPoint.x,
        y2: currentPoint.y,
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
      };
    }

    if (tool === "star") {
      const dx = currentPoint.x - startPoint.x;
      const dy = currentPoint.y - startPoint.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      return { type: "star", x: startPoint.x, y: startPoint.y, radius };
    }

    return null;
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawing || !startPoint) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const currentPoint = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
    const preview = buildShape(startPoint, currentPoint, tool);

    redraw(context, canvas, preview ?? undefined);
  }

  function handleMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (isDrawing && startPoint) {
      const currentPoint = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
      const finished = buildShape(startPoint, currentPoint, tool);
      if (finished) {
        setShapes((prev) => [...prev, finished]);
      }
    }
    setIsDrawing(false);
    setStartPoint(null);
  }

  return (
    <div className="flex flex-col items-center gap-2">
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
      </div>
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        style={{ border: "2px solid black", background: "white" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      />
    </div>
  );
}
