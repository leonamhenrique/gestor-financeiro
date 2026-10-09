-- ============================================================
-- Planejamento mensal
-- ============================================================
-- Duas tabelas e nada de realizado gravado: o planejamento guarda só a
-- INTENÇÃO do mês (quanto espero receber, quanto me permito gastar, teto de
-- cada categoria). Quanto já foi gasto é recontado na leitura, porque depende
-- dos lançamentos e da configuração de exibição de relatório — por data de
-- compra ou por vencimento da fatura —, que é escolha do aparelho e muda sem
-- avisar o servidor.
-- ============================================================

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "income" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_items" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "budget_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "from_children" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budgets_user_id_idx" ON "budgets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_user_id_month_key" ON "budgets"("user_id", "month");

-- CreateIndex
CREATE INDEX "budget_items_user_id_idx" ON "budget_items"("user_id");

-- CreateIndex
CREATE INDEX "budget_items_category_id_idx" ON "budget_items"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "budget_items_budget_id_category_id_key" ON "budget_items"("budget_id", "category_id");

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_budget_id_fkey" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- o que o banco se recusa a guardar ----------
-- O mês é a chave do planejamento: se ele puder vir "2026-7" ou "julho", a
-- unicidade por mês deixa de valer e o mesmo mês ganha dois planejamentos.
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_mes_bem_formado"
  CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- Teto de gasto negativo não é planejamento, é erro de digitação.
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_total_nao_negativo" CHECK (total >= 0);
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_receita_nao_negativa" CHECK (income >= 0);

-- Meta de categoria: zero é legítimo ("não quero gastar nada aqui"), negativo
-- não significa coisa nenhuma.
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_meta_nao_negativa" CHECK (amount >= 0);

-- ---------- RLS, como em toda tabela com dono ----------
ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budgets" FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_budgets ON "budgets"
  USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual());

ALTER TABLE "budget_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "budget_items" FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_budget_items ON "budget_items"
  USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual());
