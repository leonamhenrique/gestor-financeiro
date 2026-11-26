-- O teste passa de 7 para 30 dias, e dois buracos se fecham junto.
--
-- 1) QUEM SE CADASTROU DEPOIS DA MIGRACAO ANTERIOR NAO GANHOU TESTE NENHUM.
--    A coluna nasceu preenchida por um UPDATE unico, e nada no cadastro a
--    preenchia desde entao: toda conta criada de 22/11 para ca entrou direto
--    no gratis. Agora o cadastro grava a data (ver `auth.service.ts`), e as
--    contas orfas ganham os 30 dias a partir de agora -- a partir do
--    cadastro elas ja teriam perdido um prazo que nunca tiveram.
UPDATE "users" SET "trial_ends_at" = NOW() + INTERVAL '30 days'
 WHERE "trial_ends_at" IS NULL;

-- 2) QUEM ESTA NO TESTE DE 7 DIAS PASSA A TER 30, CONTADOS DA MESMA LARGADA.
--    Toda linha preenchida pela migracao anterior recebeu `largada + 7 dias`,
--    entao `+ 23 dias` devolve exatamente `largada + 30`. Nao e um numero
--    escolhido a esmo: e a mesma data de inicio, com o prazo novo.
--
--    Teste ja vencido fica como esta. Reabrir um prazo que acabou seria dar
--    o Pro de volta a quem ja viu a conta virar gratis, e tirar de novo
--    depois.
UPDATE "users" SET "trial_ends_at" = "trial_ends_at" + INTERVAL '23 days'
 WHERE "trial_ends_at" IS NOT NULL AND "trial_ends_at" > NOW();
