import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const sketch = await prisma.sketch.findUnique({ where: { id } });
  // Owner always has access; a collaborator (any signed-in user, once the
  // owner has turned sharing on) can save too - same rule the draw page and
  // the Liveblocks auth route use to decide who can open the sketch at all.
  if (!sketch || (sketch.userId !== session.user.id && !sketch.isShared)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await request.json();
  const { data, isShared } = body as { data?: unknown; isShared?: unknown };

  if (data !== undefined && !Array.isArray(data)) {
    return NextResponse.json({ error: "data must be an array." }, { status: 400 });
  }
  // Only the owner can turn sharing on/off - a collaborator shouldn't be able
  // to grant further access to the sketch they were just let into.
  if (isShared !== undefined && (typeof isShared !== "boolean" || sketch.userId !== session.user.id)) {
    return NextResponse.json({ error: "Only the owner can change sharing." }, { status: 403 });
  }

  await prisma.sketch.update({
    where: { id },
    data: {
      ...(data !== undefined ? { data } : {}),
      ...(isShared !== undefined ? { isShared: isShared as boolean } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { id } = await params;
  const sketch = await prisma.sketch.findUnique({ where: { id } });
  if (!sketch || sketch.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  await prisma.sketch.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
