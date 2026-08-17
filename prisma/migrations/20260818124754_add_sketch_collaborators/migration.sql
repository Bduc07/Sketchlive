-- CreateTable
CREATE TABLE "SketchCollaborator" (
    "id" TEXT NOT NULL,
    "sketchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastVisitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SketchCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SketchCollaborator_sketchId_userId_key" ON "SketchCollaborator"("sketchId", "userId");

-- AddForeignKey
ALTER TABLE "SketchCollaborator" ADD CONSTRAINT "SketchCollaborator_sketchId_fkey" FOREIGN KEY ("sketchId") REFERENCES "Sketch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SketchCollaborator" ADD CONSTRAINT "SketchCollaborator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
