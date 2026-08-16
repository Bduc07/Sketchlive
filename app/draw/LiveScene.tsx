"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import * as THREE from "three";
import type { Shape } from "./DrawingCanvas";

// The 2D drawing canvas is 800x600 with (0,0) at the top-left and y growing
// downward. Three.js is centered on (0,0) with y growing upward - this maps
// one coordinate system onto the other, point by point.
function toWorld(x: number, y: number): [number, number] {
  return [x - 400, -(y - 300)];
}

// Same idea as toWorld, but relative to an arbitrary center instead of the
// canvas origin - every shape is built from points positioned around its own
// center, so behaviors like the twinkle scale-pulse grow/shrink the shape
// around itself instead of around the middle of the whole canvas.
function toLocal(x: number, y: number, centerX: number, centerY: number): [number, number] {
  return [x - centerX, -(y - centerY)];
}

// A ring of rays that slowly rotates, plus a soft halo behind the shape that
// breathes in and out - both driven by useFrame, R3F's per-frame animation hook.
function SunEffect({ radius }: { radius: number; color: string }) {
  const raysRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  useFrame((state, delta) => {
    if (raysRef.current) {
      raysRef.current.rotation.z += delta * 0.4;
    }
    if (glowRef.current) {
      const t = state.clock.elapsedTime;
      const pulse = 1 + Math.sin(t * 2) * 0.12;
      glowRef.current.scale.set(pulse, pulse, 1);
      const material = glowRef.current.material as THREE.MeshBasicMaterial;
      material.opacity = 0.28 + Math.sin(t * 2) * 0.1;
    }
  });

  const rayCount = 12;
  const rays = useMemo<[number, number, number][][]>(() => {
    const innerRadius = radius * 1.15;
    const outerRadius = radius * 1.55;
    return Array.from({ length: rayCount }, (_, i) => {
      const angle = (i / rayCount) * Math.PI * 2;
      return [
        [Math.cos(angle) * innerRadius, Math.sin(angle) * innerRadius, 0],
        [Math.cos(angle) * outerRadius, Math.sin(angle) * outerRadius, 0],
      ];
    });
  }, [radius]);

  return (
    <>
      <mesh ref={glowRef} position={[0, 0, -0.3]}>
        <circleGeometry args={[radius * 1.8, 48]} />
        <meshBasicMaterial color="#fde047" transparent opacity={0.3} />
      </mesh>
      <group ref={raysRef}>
        {rays.map((points, i) => (
          <Line key={i} points={points} color="#f59e0b" lineWidth={3} />
        ))}
      </group>
    </>
  );
}

// Scales a shape's whole group up and down on an irregular flicker (two
// different-frequency sine waves added together, so it reads as "twinkling"
// rather than a smooth pulse), and - if the shape has a fill - brightens its
// color toward white at the same time. Works for any shape: the group ref
// goes on that shape's own centered wrapper, so it always grows/shrinks
// around itself no matter where it sits on the canvas.
function useTwinkle(active: boolean, baseFillColor: THREE.Color) {
  const groupRef = useRef<THREE.Group>(null);
  const fillMaterialRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((state) => {
    if (!active) return;
    const t = state.clock.elapsedTime;
    const raw = 0.5 + 0.5 * Math.sin(t * 5.2) * 0.6 + 0.5 * Math.sin(t * 8.7 + 1.7) * 0.4;
    const flicker = Math.max(0, Math.min(1, raw));

    if (groupRef.current) {
      const scale = 1 + flicker * 0.18;
      groupRef.current.scale.set(scale, scale, 1);
    }
    if (fillMaterialRef.current) {
      fillMaterialRef.current.color.copy(baseFillColor).lerp(new THREE.Color("#ffffff"), flicker * 0.6);
    }
  });

  return { groupRef, fillMaterialRef };
}

// A small repeating stripe pattern, drawn once onto an offscreen canvas and
// used as a texture - this is what actually flows along the tube, instead of
// a dashed line. No image asset needed, just a few fillRect calls.
function createStripeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 16;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#60a5fa";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#bfdbfe";
    context.fillRect(0, 0, 22, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// Splits a straight line into many small points - bending it into an S-curve
// needs points to bend at, and a 2-point line has none in the middle.
function subdivide(p1: [number, number], p2: [number, number], count: number): [number, number][] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
  });
}

// A single "sideways" direction for the whole path, from its overall
// start-to-end direction - not recomputed per point. Using each point's own
// locally-varying perpendicular (the old approach) meant different parts of
// a curved path could get pushed in visibly different directions each
// frame - a straight-ish stretch near one end barely moved while a curvier
// stretch near the other end swung more, reading as "one side follows the
// bend, the other side just slides in a straight line" instead of one
// coherent flex. One shared direction, varied only in magnitude per point
// (see the sine formula below), keeps the whole tube bending as one piece.
function overallNormal(points: [number, number][]): [number, number] {
  const [startX, startY] = points[0];
  const [endX, endY] = points[points.length - 1];
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.hypot(dx, dy) || 1;
  return [-dy / length, dx / length];
}

// A hand-drawn "river" often isn't a clean single sweep - people scribble
// back and forth to fill in width, the way you'd shade a wide area with a
// pencil. That zigzag has nothing to do with which way the river actually
// flows, but a flow animation would otherwise trace it exactly, doubling
// back on itself. This keeps only the points that make forward progress
// along the path's dominant axis, collapsing any backtracking into its net
// forward trend.
//
// The axis comes from PCA over every point (the direction the point cloud is
// most spread out along), not just the first/last point - a start-to-end
// line breaks down the moment a scribble loops back near where it started,
// which is a completely normal way to draw by hand.
function simplifyToMonotonicPath(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points;

  let meanX = 0;
  let meanY = 0;
  for (const [x, y] of points) {
    meanX += x;
    meanY += y;
  }
  meanX /= points.length;
  meanY /= points.length;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of points) {
    const dx = x - meanX;
    const dy = y - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  // Principal axis of the point cloud's spread - the direction that
  // explains the most variance, i.e. the "main line" the scribble follows.
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ux = Math.cos(angle);
  let uy = Math.sin(angle);

  // PCA gives an axis, not a direction - it could point either way. Flip it
  // if needed so "forward" still means the way the user actually drew
  // (start toward end), not backward.
  const start = points[0];
  const end = points[points.length - 1];
  if ((end[0] - start[0]) * ux + (end[1] - start[1]) * uy < 0) {
    ux = -ux;
    uy = -uy;
  }

  const kept: [number, number][] = [points[0]];
  let lastProjection = points[0][0] * ux + points[0][1] * uy;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i];
    const projection = x * ux + y * uy;
    if (projection > lastProjection) {
      kept.push(points[i]);
      lastProjection = projection;
    }
  }

  const last = points[points.length - 1];
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

// Extrudes an actual 3D tube along the smoothed path, so the river has real
// width/thickness instead of being a flat line - then scrolls a striped
// texture along its length every frame, which is what reads as "flowing".
// On top of that, the whole tube is bent into a gentle S-curve that slowly
// drifts - the first half nudges one way, the second half the other, just
// enough to read as motion without looking like it's actively wiggling.
// Works equally well fed a closed loop (a shape's own outline, first point
// repeated at the end) or an open path (a line/pencil stroke).
function RiverTube({ points, radius }: { points: [number, number][]; radius: number }) {
  const [nx, ny] = useMemo(() => overallNormal(points), [points]);
  const meshRef = useRef<THREE.Mesh>(null);

  const initialCurve = useMemo(
    () => new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0))),
    [points],
  );
  // The curve's real length, not a guess - so the stripe pattern below can
  // be sized to it instead of using a fixed repeat count for every river.
  const curveLength = useMemo(() => initialCurve.getLength(), [initialCurve]);

  const texture = useMemo(() => {
    const tex = createStripeTexture();
    // One stripe cycle per ~30 world units, so a short river and a long one
    // both get similarly-sized stripes instead of the long one's stripes
    // getting stretched out.
    tex.repeat.set(Math.max(2, curveLength / 30), 1);
    return tex;
  }, [curveLength]);

  const initialGeometry = useMemo(
    () => new THREE.TubeGeometry(initialCurve, 64, radius, 8, false),
    [initialCurve, radius],
  );

  useFrame((state, delta) => {
    texture.offset.x -= delta * 0.6;

    const mesh = meshRef.current;
    if (!mesh) return;

    const t = state.clock.elapsedTime;
    const amplitude = Math.min(4, radius * 0.7);
    const bentPoints = points.map(([x, y], i) => {
      const progress = points.length > 1 ? i / (points.length - 1) : 0;
      // One full sine cycle across the whole path - so one half bends one
      // way and the other half bends the opposite way, like a soft "S".
      // Same nx/ny for every point - only the magnitude changes.
      const offset = Math.sin(progress * Math.PI * 2 + t * 0.6) * amplitude;
      return new THREE.Vector3(x + nx * offset, y + ny * offset, 0);
    });
    const curve = new THREE.CatmullRomCurve3(bentPoints);
    const nextGeometry = new THREE.TubeGeometry(curve, 64, radius, 8, false);
    mesh.geometry.dispose();
    mesh.geometry = nextGeometry;
  });

  return (
    <mesh ref={meshRef} geometry={initialGeometry}>
      <meshBasicMaterial map={texture} />
    </mesh>
  );
}

// How thick a river tube should be for a shape of this size - proportional,
// but clamped so a huge shape doesn't get a comically fat river and a tiny
// one doesn't get an invisible one.
function riverRadiusFor(auraRadius: number): number {
  return Math.min(8, Math.max(3, auraRadius * 0.12));
}

function CircleShape({ shape }: { shape: Extract<Shape, { type: "circle" }> }) {
  const [x, y] = toWorld(shape.x, shape.y);
  const outline = useMemo<[number, number][]>(() => {
    const points: [number, number][] = [];
    for (let i = 0; i <= 64; i++) {
      const angle = (i / 64) * Math.PI * 2;
      points.push([Math.cos(angle) * shape.radius, Math.sin(angle) * shape.radius]);
    }
    return points;
  }, [shape.radius]);
  const outline3d = useMemo<[number, number, number][]>(
    () => outline.map(([px, py]): [number, number, number] => [px, py, 0]),
    [outline],
  );

  const baseFillColor = useMemo(
    () => new THREE.Color(shape.fillColor ?? shape.color),
    [shape.fillColor, shape.color],
  );
  const { groupRef, fillMaterialRef } = useTwinkle(shape.behavior === "twinkle", baseFillColor);

  return (
    <group position={[x, y, 0]} ref={groupRef}>
      {shape.fillColor && (
        <mesh>
          <circleGeometry args={[shape.radius, 48]} />
          <meshBasicMaterial ref={fillMaterialRef} color={shape.fillColor} />
        </mesh>
      )}
      <Line points={outline3d} color={shape.color} lineWidth={3} />
      {shape.behavior === "sun" && (
        <SunEffect radius={shape.radius} color={shape.fillColor ?? shape.color} />
      )}
      {shape.behavior === "river" && (
        <RiverTube points={outline} radius={riverRadiusFor(shape.radius)} />
      )}
    </group>
  );
}

function BoxShape({ shape }: { shape: Extract<Shape, { type: "box" }> }) {
  const [x, y] = toWorld(shape.x + shape.width / 2, shape.y + shape.height / 2);
  const halfWidth = shape.width / 2;
  const halfHeight = shape.height / 2;
  const outline: [number, number][] = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
    [-halfWidth, -halfHeight],
  ];
  const outline3d: [number, number, number][] = outline.map(([px, py]) => [px, py, 0]);
  const auraRadius = Math.hypot(shape.width, shape.height) / 2;

  const baseFillColor = useMemo(
    () => new THREE.Color(shape.fillColor ?? shape.color),
    [shape.fillColor, shape.color],
  );
  const { groupRef, fillMaterialRef } = useTwinkle(shape.behavior === "twinkle", baseFillColor);

  return (
    <group position={[x, y, 0]} ref={groupRef}>
      {shape.fillColor && (
        <mesh>
          <planeGeometry args={[shape.width, shape.height]} />
          <meshBasicMaterial ref={fillMaterialRef} color={shape.fillColor} />
        </mesh>
      )}
      <Line points={outline3d} color={shape.color} lineWidth={3} />
      {shape.behavior === "sun" && (
        <SunEffect radius={auraRadius} color={shape.fillColor ?? shape.color} />
      )}
      {shape.behavior === "river" && <RiverTube points={outline} radius={riverRadiusFor(auraRadius)} />}
    </group>
  );
}

function LineShape({ shape }: { shape: Extract<Shape, { type: "line" }> }) {
  const centerCanvasX = (shape.x1 + shape.x2) / 2;
  const centerCanvasY = (shape.y1 + shape.y2) / 2;
  const [cx, cy] = toWorld(centerCanvasX, centerCanvasY);
  const [lx1, ly1] = toLocal(shape.x1, shape.y1, centerCanvasX, centerCanvasY);
  const [lx2, ly2] = toLocal(shape.x2, shape.y2, centerCanvasX, centerCanvasY);
  const auraRadius = Math.hypot(lx2 - lx1, ly2 - ly1) / 2;

  const baseFillColor = useMemo(() => new THREE.Color(shape.color), [shape.color]);
  const { groupRef } = useTwinkle(shape.behavior === "twinkle", baseFillColor);

  return (
    <group position={[cx, cy, 0]} ref={groupRef}>
      <Line
        points={[
          [lx1, ly1, 0],
          [lx2, ly2, 0],
        ]}
        color={shape.color}
        lineWidth={3}
      />
      {shape.behavior === "sun" && <SunEffect radius={auraRadius} color={shape.color} />}
      {shape.behavior === "river" && (
        <RiverTube
          points={subdivide([lx1, ly1], [lx2, ly2], 16)}
          radius={riverRadiusFor(auraRadius)}
        />
      )}
    </group>
  );
}

function TriangleShape({ shape }: { shape: Extract<Shape, { type: "triangle" }> }) {
  const centerCanvasX = (shape.x1 + shape.x2 + shape.x3) / 3;
  const centerCanvasY = (shape.y1 + shape.y2 + shape.y3) / 3;
  const [cx, cy] = toWorld(centerCanvasX, centerCanvasY);
  const [lx1, ly1] = toLocal(shape.x1, shape.y1, centerCanvasX, centerCanvasY);
  const [lx2, ly2] = toLocal(shape.x2, shape.y2, centerCanvasX, centerCanvasY);
  const [lx3, ly3] = toLocal(shape.x3, shape.y3, centerCanvasX, centerCanvasY);
  const auraRadius = Math.max(Math.hypot(lx1, ly1), Math.hypot(lx2, ly2), Math.hypot(lx3, ly3));

  const geometry = useMemo(() => {
    const outline = new THREE.Shape();
    outline.moveTo(lx1, ly1);
    outline.lineTo(lx2, ly2);
    outline.lineTo(lx3, ly3);
    outline.closePath();
    return outline;
  }, [lx1, ly1, lx2, ly2, lx3, ly3]);

  const baseFillColor = useMemo(
    () => new THREE.Color(shape.fillColor ?? shape.color),
    [shape.fillColor, shape.color],
  );
  const { groupRef, fillMaterialRef } = useTwinkle(shape.behavior === "twinkle", baseFillColor);

  return (
    <group position={[cx, cy, 0]} ref={groupRef}>
      {shape.fillColor && (
        <mesh>
          <shapeGeometry args={[geometry]} />
          <meshBasicMaterial ref={fillMaterialRef} color={shape.fillColor} />
        </mesh>
      )}
      <Line
        points={[
          [lx1, ly1, 0],
          [lx2, ly2, 0],
          [lx3, ly3, 0],
          [lx1, ly1, 0],
        ]}
        color={shape.color}
        lineWidth={3}
      />
      {shape.behavior === "sun" && (
        <SunEffect radius={auraRadius} color={shape.fillColor ?? shape.color} />
      )}
      {shape.behavior === "river" && (
        <RiverTube
          points={[
            [lx1, ly1],
            [lx2, ly2],
            [lx3, ly3],
            [lx1, ly1],
          ]}
          radius={riverRadiusFor(auraRadius)}
        />
      )}
    </group>
  );
}

function starOutline(cx: number, cy: number, radius: number): [number, number][] {
  const points = 5;
  const outerRadius = radius;
  const innerRadius = radius * 0.4;
  const result: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (i * Math.PI) / points;
    result.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return result;
}

function StarShape({ shape }: { shape: Extract<Shape, { type: "star" }> }) {
  const [cx, cy] = toWorld(shape.x, shape.y);
  // starOutline(0, 0, radius) already gives points centered on the origin -
  // just needs the same y-flip toWorld/toLocal apply, to stay consistent
  // with the world's y-up convention instead of the canvas's y-down one.
  const localPoints = useMemo<[number, number][]>(
    () => starOutline(0, 0, shape.radius).map(([px, py]) => [px, -py]),
    [shape.radius],
  );

  const geometry = useMemo(() => {
    const outline = new THREE.Shape();
    localPoints.forEach(([px, py], i) => {
      if (i === 0) outline.moveTo(px, py);
      else outline.lineTo(px, py);
    });
    outline.closePath();
    return outline;
  }, [localPoints]);

  const linePoints: [number, number, number][] = [
    ...localPoints.map(([px, py]): [number, number, number] => [px, py, 0]),
    [localPoints[0][0], localPoints[0][1], 0],
  ];

  const baseFillColor = useMemo(
    () => new THREE.Color(shape.fillColor ?? shape.color),
    [shape.fillColor, shape.color],
  );
  const { groupRef, fillMaterialRef } = useTwinkle(shape.behavior === "twinkle", baseFillColor);

  return (
    <group position={[cx, cy, 0]} ref={groupRef}>
      {shape.fillColor && (
        <mesh>
          <shapeGeometry args={[geometry]} />
          <meshBasicMaterial ref={fillMaterialRef} color={shape.fillColor} />
        </mesh>
      )}
      <Line points={linePoints} color={shape.color} lineWidth={3} />
      {shape.behavior === "sun" && (
        <SunEffect radius={shape.radius} color={shape.fillColor ?? shape.color} />
      )}
      {shape.behavior === "river" && (
        <RiverTube
          points={[...localPoints, localPoints[0]]}
          radius={riverRadiusFor(shape.radius)}
        />
      )}
    </group>
  );
}

function PencilShape({ shape }: { shape: Extract<Shape, { type: "pencil" }> }) {
  let sumX = 0;
  let sumY = 0;
  for (const point of shape.points) {
    sumX += point.x;
    sumY += point.y;
  }
  const centerCanvasX = shape.points.length ? sumX / shape.points.length : 0;
  const centerCanvasY = shape.points.length ? sumY / shape.points.length : 0;
  const [cx, cy] = toWorld(centerCanvasX, centerCanvasY);

  const localPoints = useMemo<[number, number][]>(
    () => shape.points.map((point) => toLocal(point.x, point.y, centerCanvasX, centerCanvasY)),
    [shape.points, centerCanvasX, centerCanvasY],
  );

  const baseFillColor = useMemo(() => new THREE.Color(shape.color), [shape.color]);
  const { groupRef } = useTwinkle(shape.behavior === "twinkle", baseFillColor);

  if (localPoints.length < 2) return null;

  if (shape.behavior === "river") {
    const flowPoints = simplifyToMonotonicPath(localPoints);
    return (
      <group position={[cx, cy, 0]} ref={groupRef}>
        <RiverTube points={flowPoints} radius={(shape.strokeWidth ?? 3) * 1.6} />
      </group>
    );
  }

  let auraRadius = 20;
  for (const [x, y] of localPoints) {
    auraRadius = Math.max(auraRadius, Math.hypot(x, y));
  }
  const points3d: [number, number, number][] = localPoints.map(([x, y]) => [x, y, 0]);

  return (
    <group position={[cx, cy, 0]} ref={groupRef}>
      <Line points={points3d} color={shape.color} lineWidth={shape.strokeWidth ?? 3} />
      {shape.behavior === "sun" && <SunEffect radius={auraRadius} color={shape.color} />}
    </group>
  );
}

// Stacks each shape a little closer to the camera than the last, in drawing
// order - so later shapes render on top of earlier ones, same as the 2D canvas.
function ShapeMesh({ shape, zIndex }: { shape: Shape; zIndex: number }) {
  return (
    <group position={[0, 0, zIndex]}>
      {shape.type === "circle" && <CircleShape shape={shape} />}
      {shape.type === "box" && <BoxShape shape={shape} />}
      {shape.type === "line" && <LineShape shape={shape} />}
      {shape.type === "triangle" && <TriangleShape shape={shape} />}
      {shape.type === "star" && <StarShape shape={shape} />}
      {shape.type === "pencil" && <PencilShape shape={shape} />}
    </group>
  );
}

export default function LiveScene({ shapes }: { shapes: Shape[] }) {
  return (
    <div style={{ width: 800, height: 600, border: "2px solid black" }}>
      <Canvas orthographic camera={{ position: [0, 0, 500], zoom: 1, near: 0.1, far: 2000 }}>
        <color attach="background" args={["white"]} />
        {shapes.map((shape, i) => (
          <ShapeMesh key={i} shape={shape} zIndex={i} />
        ))}
      </Canvas>
    </div>
  );
}
