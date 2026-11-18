-- "Novos" deixa de ser "tudo que ainda não entrou".
--
-- O provedor importa DOZE MESES de uma vez. No primeiro dia isso virou um
-- aviso de 487 lançamentos — e quem decide não importar o histórico inteiro
-- fica com esse número para sempre, aceso, sem querer dizer nada. Número que
-- não desce para de ser lido, que é a mesma regra já escrita no menu.
--
-- `pending_seen_at` é o instante em que a pessoa VIU a lista. Daí em diante,
-- novidade é o que o provedor recebeu DEPOIS disso — pela data em que ele
-- recebeu do banco, não pela data da compra: a compra de março chegou hoje,
-- e para quem olha é novidade de hoje.
--
-- `pending_new_count` é essa conta, guardada junto com o total pelo mesmo
-- motivo que o total já era guardado: contar custa baixar o extrato inteiro.
ALTER TABLE "open_finance_connections" ADD COLUMN "pending_seen_at" TIMESTAMP(3);
ALTER TABLE "open_finance_connections" ADD COLUMN "pending_new_count" INTEGER;
