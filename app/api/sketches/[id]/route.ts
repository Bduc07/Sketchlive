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
  if (!sketch || sketch.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await request.json();
  const { data } = body as { data?: unknown };
  if (!Array.isArray(data)) {
    return NextResponse.json({ error: "data must be an array." }, { status: 400 });
  }

  await prisma.sketch.update({ where: { id }, data: { data } });
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
