-- Id da tela de pagamento hospedada pelo gateway.
--
-- Gravado ANTES de o usuário sair do app para pagar. Enquanto ele está na
-- tela do gateway, é a única ponte que existe entre a compra e a conta: o
-- cliente e a assinatura do lado do gateway só nascem depois do pagamento, e
-- o webhook de volta chega falando deste id. Sem ele, um pagamento
-- confirmado não teria dono.
--
-- Aditiva: coluna nova, anulável. Nenhuma linha existente muda.
ALTER TABLE "subscriptions" ADD COLUMN "provider_checkout_id" TEXT;

-- Único para o webhook poder procurar por ele, e para o mesmo checkout não
-- acabar vinculado a duas contas.
CREATE UNIQUE INDEX "subscriptions_provider_checkout_id_key" ON "subscriptions"("provider_checkout_id");
