import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { liveblocks } from "@/lib/liveblocks";

// A handful of distinct, easy-to-tell-apart colors for cursors - picked by
// hashing the user's id, so the same person always gets the same color
// across sessions instead of a random one each time they connect.
const CURSOR_COLORS = ["#ef4444", "#f97316", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899"];

function colorForUserId(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

// Liveblocks calls this route itself (see authEndpoint in liveblocks.config)
// whenever a client tries to join a room - it doesn't take our word for who's
// asking, so this re-derives access from the same NextAuth session and the
// same owner-or-shared rule used everywhere else a sketch is opened.
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Not signed in.", { status: 401 });
  }

  const body = await request.json();
  const room = body?.room;
  if (typeof room !== "string") {
    return new Response("Missing room.", { status: 400 });
  }

  const sketch = await prisma.sketch.findUnique({ where: { id: room } });
  if (!sketch || (sketch.userId !== session.user.id && !sketch.isShared)) {
    return new Response("Not found.", { status: 404 });
  }

  const userSession = liveblocks.prepareSession(session.user.id, {
    userInfo: {
      name: session.user.email ?? "Anonymous",
      color: colorForUserId(session.user.id),
    },
  });
  userSession.allow(room, userSession.FULL_ACCESS);

  const { status, body: responseBody } = await userSession.authorize();
  return new Response(responseBody, { status });
}
