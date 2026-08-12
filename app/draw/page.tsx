import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export default async function NewDraw() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const sketch = await prisma.sketch.create({
    data: { userId: session.user.id },
  });

  redirect(`/draw/${sketch.id}`);
}
