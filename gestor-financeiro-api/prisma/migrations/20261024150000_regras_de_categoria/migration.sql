-- CreateTable
CREATE TABLE "category_rules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "category_rules_user_id_idx" ON "category_rules"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_rules_user_id_merchant_key" ON "category_rules"("user_id", "merchant");

-- AddForeignKey
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_rules" ADD CONSTRAINT "category_rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

