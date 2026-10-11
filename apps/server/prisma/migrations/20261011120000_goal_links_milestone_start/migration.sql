-- AlterTable
ALTER TABLE "Milestone" ADD COLUMN "startDate" TEXT;

-- AlterTable
ALTER TABLE "ClassSchedule" ADD COLUMN "goalId" TEXT;

-- AlterTable
ALTER TABLE "ClassInstance" ADD COLUMN "goalId" TEXT;
