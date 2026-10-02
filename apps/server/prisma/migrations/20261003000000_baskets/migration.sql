-- CreateTable
CREATE TABLE "Basket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "deviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '📚',
    "color" TEXT NOT NULL,
    "holidays" JSONB NOT NULL DEFAULT '[]',
    "termStart" TEXT,
    "termEnd" TEXT,
    "minAttendance" DOUBLE PRECISION,
    "targetAttendance" DOUBLE PRECISION,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Basket_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Subject" ADD COLUMN "compulsory" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "basketId" TEXT;

-- CreateIndex
CREATE INDEX "Basket_userId_updatedAt_idx" ON "Basket"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "Basket" ADD CONSTRAINT "Basket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
