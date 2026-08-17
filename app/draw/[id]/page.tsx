import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import DrawingCanvas, { type Shape } from "../DrawingCanvas";
import CollabRoom from "./CollabRoom";
import ShareControls from "./ShareControls";

export default async function DrawSketch({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { id } = await params;
  const sketch = await prisma.sketch.findUnique({ where: { id } });

  const isOwner = !!sketch && sketch.userId === session.user.id;
  if (!sketch || (!isOwner && !sketch.isShared)) {
    notFound();
  }

  // Record that this user has actually opened the shared sketch - `isShared`
  // only controls whether the URL grants access, it doesn't track who's used
  // it, and that record is what lets a collaborator's own dashboard surface
  // sketches they've drawn on but don't own (see the SketchCollaborator
  // model). Skipped for the owner - they already see their own sketch.
  if (!isOwner) {
    await prisma.sketchCollaborator.upsert({
      where: { sketchId_userId: { sketchId: sketch.id, userId: session.user.id } },
      create: { sketchId: sketch.id, userId: session.user.id },
      update: { lastVisitedAt: new Date() },
    });
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 text-center dark:bg-black">
      <p className="text-zinc-700 dark:text-zinc-300">&ldquo;{sketch.title}&rdquo;</p>
      {isOwner ? (
        <ShareControls sketchId={sketch.id} initialIsShared={sketch.isShared} />
      ) : (
        <p className="text-xs text-zinc-500">You&apos;re drawing on a shared sketch</p>
      )}
      <CollabRoom sketchId={sketch.id} initialShapes={sketch.data as unknown as Shape[]}>
        <DrawingCanvas sketchId={sketch.id} />
      </CollabRoom>
      <div className="flex gap-4">
        <Link href="/" className="font-medium text-zinc-950 underline dark:text-zinc-50">
          Back to dashboard
        </Link>
        <Link
          href={`/draw/${sketch.id}/live`}
          className="font-medium text-orange-600 underline dark:text-orange-400"
        >
          Live
        </Link>
      </div>
    </div>
  );
}
