-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "import_batch_id" TEXT,
ADD COLUMN     "imported_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "transactions_user_id_import_batch_id_idx" ON "transactions"("user_id", "import_batch_id");

