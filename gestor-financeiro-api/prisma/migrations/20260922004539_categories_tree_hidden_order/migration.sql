-- DropIndex
DROP INDEX "categories_user_id_name_type_key";

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "is_hidden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "parent_id" TEXT,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "credit_cards" ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: a ordem inicial é a de criação (a mesma que as listas já usavam).
UPDATE "bank_accounts" b SET "sort_order" = o.n
FROM (SELECT id, (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) - 1)::int AS n FROM "bank_accounts") o
WHERE b.id = o.id;

UPDATE "credit_cards" c SET "sort_order" = o.n
FROM (SELECT id, (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) - 1)::int AS n FROM "credit_cards") o
WHERE c.id = o.id;

UPDATE "categories" c SET "sort_order" = o.n
FROM (SELECT id, (ROW_NUMBER() OVER (PARTITION BY user_id, type ORDER BY created_at) - 1)::int AS n FROM "categories" WHERE user_id IS NOT NULL) o
WHERE c.id = o.id;
