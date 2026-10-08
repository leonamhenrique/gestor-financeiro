-- Objetivos de poupança: uma meta com prazo, e o dinheiro guardado para ela.
--
-- O saldo inicial do objetivo NÃO entra em nenhum total: é dinheiro que já era
-- do usuário e nunca passou pelas contas do app. As aplicações e os resgates,
-- sim: eles saem de uma conta de verdade e voltam para ela.

-- CreateEnum
CREATE TYPE "GoalMovementType" AS ENUM ('DEPOSIT', 'WITHDRAW');
-- CreateTable
CREATE TABLE "goals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "target_date" DATE NOT NULL,
    "target_amount" DECIMAL(14,2) NOT NULL,
    "initial_balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "account_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "goals_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "goal_movements" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "goal_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "type" "GoalMovementType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "movement_date" DATE NOT NULL,
    "client_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "goal_movements_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "goals_user_id_target_date_idx" ON "goals"("user_id", "target_date");
-- CreateIndex
CREATE INDEX "goals_account_id_idx" ON "goals"("account_id");
-- CreateIndex
CREATE INDEX "goal_movements_user_id_movement_date_idx" ON "goal_movements"("user_id", "movement_date");
-- CreateIndex
CREATE INDEX "goal_movements_goal_id_idx" ON "goal_movements"("goal_id");
-- CreateIndex
CREATE INDEX "goal_movements_bank_account_id_idx" ON "goal_movements"("bank_account_id");
-- CreateIndex
CREATE UNIQUE INDEX "goal_movements_user_id_client_key_key" ON "goal_movements"("user_id", "client_key");
-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "goals" ADD CONSTRAINT "goals_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "goal_movements" ADD CONSTRAINT "goal_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "goal_movements" ADD CONSTRAINT "goal_movements_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "goal_movements" ADD CONSTRAINT "goal_movements_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Valor positivo: aplicar zero não guarda nada, e aplicar negativo é um
-- resgate escrito de um jeito que confunde.
ALTER TABLE "goals" ADD CONSTRAINT "goals_meta_positiva" CHECK ("target_amount" > 0);
ALTER TABLE "goals" ADD CONSTRAINT "goals_saldo_inicial_nao_negativo" CHECK ("initial_balance" >= 0);
ALTER TABLE "goal_movements" ADD CONSTRAINT "goal_movements_valor_positivo" CHECK ("amount" > 0);
-- O prazo termina depois de começar.
ALTER TABLE "goals" ADD CONSTRAINT "goals_prazo_coerente" CHECK ("target_date" >= "start_date");

-- ---------- RLS, como em toda tabela com dono ----------
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goals" FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_goals ON "goals"
  USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual());

ALTER TABLE "goal_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goal_movements" FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_goal_movements ON "goal_movements"
  USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual());
