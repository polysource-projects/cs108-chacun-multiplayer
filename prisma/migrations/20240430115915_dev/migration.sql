/*
  Warnings:

  - A unique constraint covering the columns `[name,hasEnded]` on the table `Game` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Game_name_key";

-- AlterTable
ALTER TABLE "Game" ADD COLUMN     "usernames" TEXT[];

-- CreateIndex
CREATE UNIQUE INDEX "Game_name_hasEnded_key" ON "Game"("name", "hasEnded");
