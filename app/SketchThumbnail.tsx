import type { Shape } from "./draw/DrawingCanvas";

type Point = { x: number; y: number };

// Mirrors DrawingCanvas's getStarPoints exactly - a star's points aren't
// stored directly, they're computed from its center + radius, so the
// thumbnail has to derive them the same way to match what was actually drawn.
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

function pointsToString(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

// A cheap, static preview of a sketch for the dashboard grid - plain SVG
// markup (not the Canvas 2D API DrawingCanvas uses) so it can render on the
// server with no browser APIs, and stays crisp at any thumbnail size.
export default function SketchThumbnail({ shapes }: { shapes: Shape[] }) {
  if (!shapes || shapes.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400 dark:text-zinc-600">
        Empty
      </div>
    );
  }

  return (
    <svg viewBox="0 0 800 600" className="h-full w-full bg-white" preserveAspectRatio="xMidYMid meet">
      {shapes.map((shape, i) => {
        if (shape.type === "circle") {
          return (
            <circle
              key={i}
              cx={shape.x}
              cy={shape.y}
              r={shape.radius}
              fill={shape.fillColor ?? "none"}
              stroke={shape.color}
              strokeWidth={3}
            />
          );
        }
        if (shape.type === "box") {
          return (
            <rect
              key={i}
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              fill={shape.fillColor ?? "none"}
              stroke={shape.color}
              strokeWidth={3}
            />
          );
        }
        if (shape.type === "line") {
          return (
            <line
              key={i}
              x1={shape.x1}
              y1={shape.y1}
              x2={shape.x2}
              y2={shape.y2}
              stroke={shape.color}
              strokeWidth={3}
            />
          );
        }
        if (shape.type === "triangle") {
          return (
            <polygon
              key={i}
              points={pointsToString([
                { x: shape.x1, y: shape.y1 },
                { x: shape.x2, y: shape.y2 },
                { x: shape.x3, y: shape.y3 },
              ])}
              fill={shape.fillColor ?? "none"}
              stroke={shape.color}
              strokeWidth={3}
            />
          );
        }
        if (shape.type === "star") {
          return (
            <polygon
              key={i}
              points={pointsToString(getStarPoints(shape))}
              fill={shape.fillColor ?? "none"}
              stroke={shape.color}
              strokeWidth={3}
            />
          );
        }
        return (
          <polyline
            key={i}
            points={pointsToString(shape.points)}
            fill="none"
            stroke={shape.color}
            strokeWidth={shape.strokeWidth ?? 3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}
