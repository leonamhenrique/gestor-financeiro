-- CreateEnum
CREATE TYPE "SeriesKind" AS ENUM ('FIXED', 'INSTALLMENT');

-- CreateEnum
CREATE TYPE "SeriesFrequency" AS ENUM ('BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "invoice_month_override" DATE,
ADD COLUMN     "series_id" TEXT,
ADD COLUMN     "series_index" INTEGER;

-- CreateTable
CREATE TABLE "transaction_series" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "SeriesKind" NOT NULL,
    "frequency" "SeriesFrequency" NOT NULL,
    "count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_series_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transaction_series_user_id_idx" ON "transaction_series"("user_id");

-- CreateIndex
CREATE INDEX "transactions_series_id_idx" ON "transactions"("series_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "transaction_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_series" ADD CONSTRAINT "transaction_series_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
