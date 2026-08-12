import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import DrawingCanvas from "../DrawingCanvas";

export default async function DrawSketch({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const { id } = await params;
  const sketch = await prisma.sketch.findUnique({ where: { id } });

  if (!sketch || sketch.userId !== session.user.id) {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 text-center dark:bg-black">
      <p className="text-zinc-700 dark:text-zinc-300">&ldquo;{sketch.title}&rdquo;</p>
      <DrawingCanvas />
      <Link href="/" className="font-medium text-zinc-950 underline dark:text-zinc-50">
        Back to dashboard
      </Link>
    </div>
  );
}
