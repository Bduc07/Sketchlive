"use client";

import dynamic from "next/dynamic";
import type { Shape } from "./DrawingCanvas";

// Three.js needs a real browser (WebGL, canvas) to set up its renderer, so
// this has to be loaded client-side only - never during server rendering.
const LiveScene = dynamic(() => import("./LiveScene"), { ssr: false });

export default function LiveSceneLoader({ shapes }: { shapes: Shape[] }) {
  return <LiveScene shapes={shapes} />;
}
