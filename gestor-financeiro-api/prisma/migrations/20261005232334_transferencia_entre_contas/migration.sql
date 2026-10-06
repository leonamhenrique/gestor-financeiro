-- Transferência entre contas do próprio usuário.
--
-- Tabela própria, e não um par de lançamentos: mover dinheiro da conta A para
-- a conta B não é receita nem despesa, e como Transaction ela entraria em todo
-- relatório de receita e despesa — cada um precisando de uma exceção para
-- expulsá-la. Separada, ela nunca aparece lá porque nunca foi lançamento.

-- CreateTable
CREATE TABLE "transfers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "from_account_id" TEXT NOT NULL,
    "to_account_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "transfer_date" DATE NOT NULL,
    "is_confirmed" BOOLEAN NOT NULL DEFAULT true,
    "client_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transfers_user_id_transfer_date_idx" ON "transfers"("user_id", "transfer_date");

-- CreateIndex
CREATE INDEX "transfers_from_account_id_idx" ON "transfers"("from_account_id");

-- CreateIndex
CREATE INDEX "transfers_to_account_id_idx" ON "transfers"("to_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_user_id_client_key_key" ON "transfers"("user_id", "client_key");

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Origem diferente do destino. Aqui vale CHECK simples (não depende de outra
-- linha), então a regra fica no banco TAMBÉM — o serviço valida para dar
-- mensagem em português, e o banco garante que nenhum caminho escape.
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_contas_distintas" CHECK ("from_account_id" <> "to_account_id");

-- Valor positivo: transferir zero não move nada e transferir negativo é a
-- mesma transferência ao contrário, escrita de um jeito que confunde.
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_valor_positivo" CHECK ("amount" > 0);

-- ---------- RLS, como em toda tabela com dono ----------
-- Sem isto, `transfers` seria a única tabela do schema que o banco não
-- protege: uma consulta que esquecesse o `user_id` devolveria transferência
-- de qualquer um. FORCE porque a API se conecta como DONA das tabelas, e sem
-- ele o dono ignora as políticas.
ALTER TABLE "transfers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transfers" FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_transfers ON "transfers"
  USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual());
