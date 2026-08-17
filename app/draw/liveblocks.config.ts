"use client";

import { createClient } from "@liveblocks/client";
import { createRoomContext } from "@liveblocks/react";
import type { Shape } from "./DrawingCanvas";

const client = createClient({
  authEndpoint: "/api/liveblocks-auth",
});

// Mutable per-connection state, broadcast to everyone else in the room on
// every change - just the live cursor position, so other collaborators can
// see where you're pointing.
type Presence = {
  cursor: { x: number; y: number } | null;
};

// The shared, persisted state of the room. `shapes` is stored as one plain
// JSON array rather than a LiveList/LiveObject per shape: every edit already
// recomputes the whole array anyway (see commitShapes in DrawingCanvas), so
// a single atomic replace matches how the app already works, and per-shape
// granularity would only matter if two people needed to edit fields of the
// SAME shape at once, which isn't a case this app needs to handle well.
type Storage = {
  shapes: Shape[];
};

// Static identity for a connection, set once at auth time (see
// /api/liveblocks-auth) - who they are and what color to draw their cursor.
type UserMeta = {
  id: string;
  info: {
    name: string;
    color: string;
  };
};

export const {
  RoomProvider,
  useStorage,
  useMutation,
  useOthers,
  useMyPresence,
  useUpdateMyPresence,
  useSelf,
} = createRoomContext<Presence, Storage, UserMeta>(client);
