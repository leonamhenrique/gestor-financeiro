-- ============================================================
-- O ciclo do cartão vira uma linha do tempo
-- ============================================================
-- Banco deixa mudar o dia do vencimento — no Itaú, de seis em seis meses — e
-- quando ele muda, o fechamento vem junto. Só que a mudança vale DALI PARA A
-- FRENTE: a fatura que já fechou, foi paga ou venceu continua com as datas
-- que teve, e quem muda o vencimento ganha uma fatura mais longa na virada.
--
-- Um par de dias por cartão não consegue dizer isso. Ele responde por TODOS
-- os meses, inclusive os de trás: trocar o par reescreveria o passado inteiro
-- — cada compra antiga reagrupada, cada fatura velha com outra data. Era por
-- isso que `updateBillingCycle` recusava a troca depois da primeira fatura,
-- e é esse remendo que esta tabela remove.
--
-- `valid_from` é o mês de REFERÊNCIA da primeira fatura que usa estes dias,
-- sempre dia 1. Para uma fatura de referência R valem os dias da última linha
-- com `valid_from <= R`.
--
-- A linha de trás (1900-01-01) existe para que essa busca NUNCA volte vazia:
-- "desde sempre, estes dias". Sem ela, toda leitura precisaria de um caso
-- especial para o cartão que nunca mudou — que é a imensa maioria.
--
-- As colunas `closing_day`/`due_day` do cartão continuam onde estão, como o
-- período de AGORA. É o que quase toda leitura quer, e mantê-las evita que
-- cada uma percorra a linha do tempo para descobrir o óbvio. Quem muda o
-- ciclo grava nos dois lugares.
--
-- Esta migração não muda comportamento nenhum: toda fatura que existe hoje
-- continua com as mesmas datas, porque todo cartão nasce aqui com UMA linha,
-- com os dias que ele já tinha.
-- ============================================================

-- CreateTable
CREATE TABLE "credit_card_billing_cycles" (
    "id" TEXT NOT NULL,
    "credit_card_id" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "closing_day" INTEGER NOT NULL,
    "due_day" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_card_billing_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_card_billing_cycles_credit_card_id_idx" ON "credit_card_billing_cycles"("credit_card_id");

-- CreateIndex
-- Um período por mês de início: duas linhas com o mesmo `valid_from` fariam a
-- mesma fatura ter dois fechamentos, e a escolha entre eles seria a ordem em
-- que o banco devolveu as linhas.
CREATE UNIQUE INDEX "credit_card_billing_cycles_credit_card_id_valid_from_key" ON "credit_card_billing_cycles"("credit_card_id", "valid_from");

-- AddForeignKey
ALTER TABLE "credit_card_billing_cycles" ADD CONSTRAINT "credit_card_billing_cycles_credit_card_id_fkey" FOREIGN KEY ("credit_card_id") REFERENCES "credit_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- RLS, pela mesma trilha das faturas ----------
-- A tabela não tem `user_id`: o dono vem pelo cartão, como em
-- `credit_card_invoices`.
ALTER TABLE "credit_card_billing_cycles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_card_billing_cycles" FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_credit_card_billing_cycles ON "credit_card_billing_cycles"
  USING (EXISTS (SELECT 1 FROM "credit_cards" c WHERE c.id = credit_card_id AND c.user_id = dono_atual()))
  WITH CHECK (EXISTS (SELECT 1 FROM "credit_cards" c WHERE c.id = credit_card_id AND c.user_id = dono_atual()));

-- ---------- o período que todo cartão já tem ----------
-- Uma linha por cartão existente, com os dias que ele usa hoje, valendo
-- "desde sempre". É o que mantém cada fatura já gravada exatamente como está.
--
-- O FORCE sai e volta, e sem isto o backfill não copiaria cartão nenhum.
-- `credit_cards` tem RLS FORÇADO, e forçado quer dizer que vale até para o
-- DONO da tabela — que é o papel com que esta migração roda. Sem
-- `app.user_id` definido, `dono_atual()` é NULL, a política não casa com
-- nada e o SELECT abaixo enxergaria ZERO cartões: a tabela nasceria vazia,
-- em silêncio, e todo cartão ficaria sem período.
--
-- Medido: no banco local isto passa de qualquer jeito, porque lá a conexão é
-- `postgres` (superusuário, com BYPASSRLS). Em produção o papel é o dono sem
-- superpoder, e é lá que o silêncio aconteceria.
--
-- A janela é mínima e cabe na transação da própria migração: se qualquer
-- linha abaixo falhar, o FORCE volta junto com o resto.
ALTER TABLE "credit_cards" NO FORCE ROW LEVEL SECURITY;

INSERT INTO "credit_card_billing_cycles" ("id", "credit_card_id", "valid_from", "closing_day", "due_day")
SELECT gen_random_uuid(), "id", DATE '1900-01-01', "closing_day", "due_day"
  FROM "credit_cards";

ALTER TABLE "credit_cards" FORCE ROW LEVEL SECURITY;
