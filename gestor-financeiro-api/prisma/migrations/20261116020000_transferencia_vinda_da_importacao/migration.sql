-- A transferência passa a saber de onde veio.
--
-- Um Pix que entrou no Inter e saiu de outro banco não é receita: é dinheiro
-- mudando de lugar. O app já tinha o objeto certo para isso — a
-- transferência, que não entra no resultado do mês —, mas a importação só
-- sabia criar lançamento.
--
-- Estas três colunas são o que falta para a importação poder criá-la SEM
-- mentir:
--
--  `import_batch_id` + `imported_at`: o botão Desfazer diz "esta importação
--  inteira". Se a transferência não carregasse o lote, desfazer deixaria o
--  dinheiro mexido numa conta que a pessoa achou que tinha voltado ao
--  estado anterior. Botão que promete e não cumpre é pior que botão que não
--  existe.
--
--  `provider_tx_id`: a mesma chave de idempotência dos lançamentos. Sem ela
--  a linha vira transferência hoje e volta como "lançamento novo" na
--  sincronização de amanhã, porque o filtro de "já tenho" só olha os
--  lançamentos.
ALTER TABLE "transfers" ADD COLUMN "import_batch_id" TEXT;
ALTER TABLE "transfers" ADD COLUMN "imported_at" TIMESTAMP(3);
ALTER TABLE "transfers" ADD COLUMN "provider_tx_id" TEXT;

CREATE INDEX "transfers_user_id_import_batch_id_idx"
  ON "transfers"("user_id", "import_batch_id");

-- A mesma transação do banco não vira duas transferências. Parcial porque
-- transferência digitada à mão não tem id de provedor nenhum, e NULL não
-- colide com NULL.
CREATE UNIQUE INDEX "transfers_user_id_provider_tx_id_key"
  ON "transfers"("user_id", "provider_tx_id")
  WHERE "provider_tx_id" IS NOT NULL;
