import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth, signOut } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { Shape } from "@/app/draw/DrawingCanvas";
import SketchThumbnail from "@/app/SketchThumbnail";

type DashboardSketch = {
  id: string;
  title: string;
  data: unknown;
  updatedAt: Date;
};

// One card, reused for both "Your drawings" and "Shared with you" - the only
// difference is whether a Delete button makes sense (only the owner can
// delete, so collaborator cards on the shared list skip it entirely rather
// than show a button that would silently do nothing).
function SketchCard({ sketch, showDelete }: { sketch: DashboardSketch; showDelete: boolean }) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-black/8 bg-white transition-colors hover:border-zinc-400 dark:border-white/[.145] dark:bg-zinc-950 dark:hover:border-zinc-600">
      <Link href={`/draw/${sketch.id}`} className="flex flex-1 flex-col">
        <div className="flex aspect-square items-center justify-center overflow-hidden bg-zinc-100 text-zinc-400 dark:bg-zinc-900">
          <SketchThumbnail shapes={sketch.data as unknown as Shape[]} />
        </div>
        <div className="px-3 py-2">
          <p className="truncate text-sm font-medium text-black dark:text-zinc-50">{sketch.title}</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">{sketch.updatedAt.toLocaleDateString()}</p>
        </div>
      </Link>
      {showDelete && (
        <form
          action={async () => {
            "use server";
            const deleteSession = await auth();
            if (!deleteSession?.user) return;
            await prisma.sketch.deleteMany({
              where: { id: sketch.id, userId: deleteSession.user.id },
            });
            revalidatePath("/");
          }}
          className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <button
            type="submit"
            className="rounded-full bg-white px-2 py-1 text-xs font-medium text-red-600 shadow dark:bg-zinc-800"
          >
            Delete
          </button>
        </form>
      )}
    </div>
  );
}

export default async function Dashboard() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const [sketches, sharedSketches] = await Promise.all([
    prisma.sketch.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
    }),
    // Sketches this user doesn't own but has actually opened while shared -
    // see the SketchCollaborator upsert in app/draw/[id]/page.tsx. Without
    // this, a collaborator's own contributions to someone else's sketch
    // would be invisible on their dashboard even though they were saved.
    prisma.sketch.findMany({
      where: { userId: { not: session.user.id }, collaborators: { some: { userId: session.user.id } } },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="flex items-center justify-between border-b border-black/8 px-8 py-4 dark:border-white/[.145]">
        <h1 className="text-lg font-semibold text-black dark:text-zinc-50">sketchlive</h1>
        <div className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
          <span>Signed in as {session.user.email}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="font-medium text-zinc-950 dark:text-zinc-50">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-8 py-10">
        <div className="mb-8 flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-black dark:text-zinc-50">Your drawings</h2>
          <Link
            href="/draw"
            className="flex h-10 items-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            + Create
          </Link>
        </div>

        {sketches.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-black/12 py-24 text-center dark:border-white/[.145]">
            <p className="text-zinc-700 dark:text-zinc-300">No drawings yet.</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-500">
              Click <span className="font-medium">Create</span> to start your first one.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {sketches.map((sketch) => (
              <SketchCard key={sketch.id} sketch={sketch} showDelete />
            ))}
          </div>
        )}

        {sharedSketches.length > 0 && (
          <>
            <h2 className="mt-12 mb-8 text-2xl font-semibold text-black dark:text-zinc-50">Shared with you</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {sharedSketches.map((sketch) => (
                <SketchCard key={sketch.id} sketch={sketch} showDelete={false} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
