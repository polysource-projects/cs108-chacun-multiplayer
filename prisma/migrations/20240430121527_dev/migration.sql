/*
  Warnings:

  - A unique constraint covering the columns `[name,hasStarted]` on the table `Game` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Game_name_hasEnded_key";

-- CreateIndex
CREATE UNIQUE INDEX "Game_name_hasStarted_key" ON "Game"("name", "hasStarted");
