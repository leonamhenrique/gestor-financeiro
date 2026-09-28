-- Chave de idempotência do lançamento.
--
-- A fila offline só tira um item dela DEPOIS que a resposta do servidor
-- chega. Se o servidor gravou e a resposta se perdeu no caminho, o item
-- continua na fila e é reenviado — e o mesmo dinheiro entrava duas vezes.
-- Com a chave, o reenvio devolve o lançamento que já existe.
--
-- Só ADICIONA: coluna nula em tudo que já está gravado, e índice único por
-- usuário. No Postgres nulos não colidem entre si num índice único, então
-- nenhuma linha existente é afetada e quem não manda chave continua podendo
-- lançar quantas vezes quiser.

ALTER TABLE "transactions" ADD COLUMN "client_key" TEXT;

CREATE UNIQUE INDEX "transactions_user_id_client_key_key" ON "transactions"("user_id", "client_key");
