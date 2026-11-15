-- ============================================================
-- O que a pessoa recusou não volta sozinho
-- ============================================================
-- Nasceu de um defeito medido: desfiz um lote que tinha entrado
-- automaticamente, reabri a tela, e os mesmos lançamentos entraram de novo.
--
-- O motivo é que a condição "não casa com nada que você já tem" olha o que o
-- app TEM. Depois do desfazer ele não tem mais — e eles voltam a parecer
-- novos. Nada registrava a recusa.
--
-- Automático que a pessoa não consegue desfazer de verdade é automático
-- contra ela. Esta tabela é a memória da recusa: o id do lançamento NO
-- PROVEDOR, e nada mais. Não guarda valor, data nem descrição — para
-- lembrar que alguém não quis, basta saber qual era.
--
-- Vale para a entrada automática E para a proposta: o que foi recusado some
-- das duas, senão a lista voltaria a oferecer todo dia o que já foi
-- dispensado uma vez.
-- ============================================================

CREATE TABLE "open_finance_refusals" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider_tx_id" TEXT NOT NULL,
    "refused_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_finance_refusals_pkey" PRIMARY KEY ("id")
);

-- Recusar duas vezes é a mesma recusa.
CREATE UNIQUE INDEX "open_finance_refusals_user_id_provider_tx_id_key"
  ON "open_finance_refusals"("user_id", "provider_tx_id");

CREATE INDEX "open_finance_refusals_user_id_idx" ON "open_finance_refusals"("user_id");

ALTER TABLE "open_finance_refusals" ADD CONSTRAINT "open_finance_refusals_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "open_finance_refusals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "open_finance_refusals" FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_open_finance_refusals ON "open_finance_refusals"
  USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual());
