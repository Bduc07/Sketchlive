"use client";

import { RoomProvider } from "../liveblocks.config";
import type { Shape } from "../DrawingCanvas";
import type { ReactNode } from "react";

// A room is one sketch - `initialStorage` only takes effect the very first
// time anyone opens it (Liveblocks keeps its own copy after that), so it's
// what seeds the room from whatever was last saved to Postgres. DrawingCanvas
// itself (the only child that matters here) shows its own loading state and
// guards its own mutations until storage has actually finished loading -
// see the `shapes === null` check near the top of that component.
export default function CollabRoom({
  sketchId,
  initialShapes,
  children,
}: {
  sketchId: string;
  initialShapes: Shape[];
  children: ReactNode;
}) {
  return (
    <RoomProvider id={sketchId} initialPresence={{ cursor: null }} initialStorage={{ shapes: initialShapes }}>
      {children}
    </RoomProvider>
  );
}
