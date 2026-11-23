-- O fim do teste de 7 dias.
--
-- Quem JA EXISTE ganha o teste a partir de agora, e nao a partir do
-- cadastro: medido pela data de criacao, todo mundo que entrou ha mais de
-- uma semana perderia funcao no mesmo instante em que a trava subisse, sem
-- nunca ter tido os sete dias.
ALTER TABLE "users" ADD COLUMN "trial_ends_at" TIMESTAMP(3);
UPDATE "users" SET "trial_ends_at" = NOW() + INTERVAL '7 days';
