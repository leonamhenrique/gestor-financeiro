-- Despesas compartilhadas: dividir um gasto com alguém e acertar a conta.
--
-- Nada aqui é lançamento. Dividir não cria dinheiro, e acertar não é receita:
-- é dívida sendo quitada. É o mesmo motivo que deu tabela própria à
-- transferência entre contas — como Transaction, um acerto entraria em todo
-- relatório de receita e despesa e cada um precisaria de uma exceção para
-- expulsá-lo. Separado, nunca aparece lá porque nunca foi lançamento.
--
-- Nenhum saldo de pessoa é gravado. Ele é somado na hora, a partir das partes
-- e dos acertos: mais um saldo guardado é mais um saldo para sair do ar.

-- CreateEnum
CREATE TYPE "SettlementDirection" AS ENUM ('RECEIVED', 'PAID');

-- CreateTable
CREATE TABLE "people" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pix_key" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_expenses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "transaction_id" TEXT,
    "paid_by_person_id" TEXT,
    "description" TEXT,
    "amount" DECIMAL(14,2),
    "expense_date" DATE,
    "category_id" TEXT,
    "client_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shared_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_shares" (
    "id" TEXT NOT NULL,
    "shared_expense_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "percent" DECIMAL(7,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "direction" "SettlementDirection" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "settled_at" DATE NOT NULL,
    "bank_account_id" TEXT,
    "description" TEXT,
    "client_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_viewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "people_user_id_idx" ON "people"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "shared_expenses_transaction_id_key" ON "shared_expenses"("transaction_id");

-- CreateIndex
CREATE INDEX "shared_expenses_user_id_idx" ON "shared_expenses"("user_id");

-- CreateIndex
CREATE INDEX "shared_expenses_paid_by_person_id_idx" ON "shared_expenses"("paid_by_person_id");

-- CreateIndex
CREATE UNIQUE INDEX "shared_expenses_user_id_client_key_key" ON "shared_expenses"("user_id", "client_key");

-- CreateIndex
CREATE INDEX "expense_shares_person_id_idx" ON "expense_shares"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_shares_shared_expense_id_person_id_key" ON "expense_shares"("shared_expense_id", "person_id");

-- CreateIndex
CREATE INDEX "settlements_user_id_settled_at_idx" ON "settlements"("user_id", "settled_at");

-- CreateIndex
CREATE INDEX "settlements_person_id_idx" ON "settlements"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_user_id_client_key_key" ON "settlements"("user_id", "client_key");

-- CreateIndex
CREATE UNIQUE INDEX "share_links_token_hash_key" ON "share_links"("token_hash");

-- CreateIndex
CREATE INDEX "share_links_user_id_idx" ON "share_links"("user_id");

-- CreateIndex
CREATE INDEX "share_links_person_id_idx" ON "share_links"("person_id");

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_expenses" ADD CONSTRAINT "shared_expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_expenses" ADD CONSTRAINT "shared_expenses_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_expenses" ADD CONSTRAINT "shared_expenses_paid_by_person_id_fkey" FOREIGN KEY ("paid_by_person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_expenses" ADD CONSTRAINT "shared_expenses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_shared_expense_id_fkey" FOREIGN KEY ("shared_expense_id") REFERENCES "shared_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ------------------------------------------------------------
-- Mesma regra do resto do banco: sem `app.user_id` definido, `dono_atual()`
-- é NULL, nenhuma política casa e a consulta volta vazia. Falha fechada.
-- FORCE é o que faz valer para o próprio dono da tabela, que é o usuário com
-- que a API se conecta — sem ele o RLS fica ligado e não protege ninguém.

-- ---------- tabelas com dono direto ----------
ALTER TABLE "people"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "people"          FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_people ON "people"
  USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual());

ALTER TABLE "shared_expenses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shared_expenses" FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_shared_expenses ON "shared_expenses"
  USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual());

ALTER TABLE "settlements"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "settlements"     FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_settlements ON "settlements"
  USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual());

-- ---------- tabela que chega pelo pai ----------
-- A parte não tem dono próprio: ela é da despesa, e a despesa é de alguém.
ALTER TABLE "expense_shares"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "expense_shares"  FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_expense_shares ON "expense_shares"
  USING (EXISTS (
    SELECT 1 FROM "shared_expenses" d
     WHERE d.id = "expense_shares".shared_expense_id AND d.user_id = dono_atual()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "shared_expenses" d
     WHERE d.id = "expense_shares".shared_expense_id AND d.user_id = dono_atual()
  ));

-- ---------- share_links fica FORA do RLS, de propósito ----------
-- A rota pública não tem dono para o banco ler: ela precisa resolver o token
-- ANTES de saber de quem ele é. Com RLS aqui, a busca pelo hash voltaria
-- vazia sempre e o link nunca abriria.
--
-- O que essa abertura expõe, no pior caso, é esta tabela: hash de token, duas
-- datas e dois ids. Não há valor, nome nem e-mail. E quem entra por ela não
-- ganha acesso a mais nada — depois de achar o dono, a API define
-- `app.user_id` com o id DELE e todo o resto volta a passar pelo RLS normal,
-- exatamente como numa requisição autenticada.
