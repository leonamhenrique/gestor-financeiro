-- O acerto de despesa compartilhada pode virar um LANÇAMENTO.
--
-- Até aqui ele mexia no saldo por fora e não aparecia em relatório nenhum.
-- Isso deixava um buraco: quando a outra pessoa pagava e você acertava com
-- ela, saíam 500 da sua conta e NENHUMA despesa era reconhecida. O dinheiro
-- sumia dos relatórios, e a sua metade do jantar — que é consumo seu — não
-- aparecia em "para onde foi o dinheiro".
--
-- Com `transaction_id` preenchido, quem mexe no saldo e entra nos relatórios
-- é o lançamento; o acerto não mexe em nada sozinho, senão o dinheiro andaria
-- duas vezes. E, sendo lançamento, o acerto pode nascer PREVISTO e ser
-- confirmado depois, como qualquer outro.
--
-- `is_refund` é o outro lado da conta. Quando alguém devolve a sua parte de
-- um gasto que VOCÊ pagou inteiro, esse dinheiro não é renda: você só está
-- recebendo de volta o que adiantou. O lançamento continua INCOME (o dinheiro
-- entrou, e o saldo sobe), mas todo relatório o lê como despesa negativa —
-- ele abate a despesa original, na categoria dela. O cartão já fazia isso:
-- receita no cartão é estorno e reduz a fatura. Agora vale para conta também.
--
-- Tudo aditivo: nenhuma linha existente muda de valor, e o padrão `false`
-- deixa todo lançamento já gravado exatamente como estava.

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "is_refund" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "settlements" ADD COLUMN     "transaction_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "settlements_transaction_id_key" ON "settlements"("transaction_id");

-- AddForeignKey
-- Cascade: apagar o lançamento apaga o acerto que ele representava — o
-- dinheiro deixou de existir no extrato, e a dívida volta ao que era.
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
