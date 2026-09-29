-- Row Level Security: o BANCO passa a recusar linha de outro dono.
--
-- Até aqui, quem garantia o isolamento era o código — e o código estava
-- certo (18 tentativas de um usuário alcançar outro, nenhuma passou). Mas a
-- garantia dependia de toda consulta futura lembrar do filtro. Daqui em
-- diante não depende: uma consulta que esqueça o `user_id` não devolve nada.
--
-- Quem é o dono da requisição vem de `app.user_id`, que a API define com
-- `set_config(..., true)` DENTRO da transação. O `true` é "local": some no
-- fim da transação. Isso é obrigatório aqui porque a API fala com o Neon por
-- conexão em pool, e conexão de pool é reaproveitada entre requisições —
-- definir na sessão deixaria o dono de um pendurado para o próximo.
--
-- Sem `app.user_id`, `dono_atual()` é NULL e as políticas não casam com
-- nada. Falha fechada, de propósito.

-- Devolve `text` porque as colunas de id são `text` neste schema (o Prisma
-- gera uuid como texto). Com `uuid` aqui, toda política estouraria com
-- "operador não existe: text = uuid" e a migration nem aplicaria.
CREATE OR REPLACE FUNCTION dono_atual() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '');
$$ LANGUAGE sql STABLE;

-- FORCE é o que faz isto valer de verdade. Sem ele, o DONO da tabela — que é
-- exatamente o usuário com que a API se conecta — ignora as políticas, e o
-- RLS vira enfeite: fica ligado, aparece no schema e não protege ninguém.

-- ---------- tabelas com dono direto ----------
ALTER TABLE "bank_accounts"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_accounts"     FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_bank_accounts ON "bank_accounts"
  USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual());

ALTER TABLE "credit_cards"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_cards"      FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_credit_cards ON "credit_cards"
  USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual());

ALTER TABLE "transactions"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transactions"      FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_transactions ON "transactions"
  USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual());

ALTER TABLE "transaction_series" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transaction_series" FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_transaction_series ON "transaction_series"
  USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual());

-- ---------- categorias: as padrão do sistema são de todos ----------
-- `user_id IS NULL` é categoria padrão, compartilhada de propósito. Criar
-- uma dessas só é permitido quando NÃO há dono no contexto, que é o caso da
-- subida da API — pela API logada, ninguém consegue inventar uma "padrão".
ALTER TABLE "categories"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories"        FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_categories ON "categories"
  USING (user_id = dono_atual() OR user_id IS NULL)
  WITH CHECK (user_id = dono_atual() OR (user_id IS NULL AND dono_atual() IS NULL));

-- ---------- tabelas que chegam pelo pai ----------
-- Fatura não tem dono próprio: ela é do cartão, e o cartão é de alguém.
ALTER TABLE "credit_card_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_card_invoices" FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_credit_card_invoices ON "credit_card_invoices"
  USING (EXISTS (SELECT 1 FROM "credit_cards" c WHERE c.id = credit_card_id AND c.user_id = dono_atual()))
  WITH CHECK (EXISTS (SELECT 1 FROM "credit_cards" c WHERE c.id = credit_card_id AND c.user_id = dono_atual()));

ALTER TABLE "invoice_payments"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_payments"  FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_invoice_payments ON "invoice_payments"
  USING (EXISTS (
    SELECT 1 FROM "credit_card_invoices" f
      JOIN "credit_cards" c ON c.id = f.credit_card_id
     WHERE f.id = invoice_id AND c.user_id = dono_atual()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "credit_card_invoices" f
      JOIN "credit_cards" c ON c.id = f.credit_card_id
     WHERE f.id = invoice_id AND c.user_id = dono_atual()));

-- ---------- o que NÃO recebe RLS, e por quê ----------
-- `users`, `refresh_tokens`, `password_reset_tokens`: o login precisa lê-las
--   ANTES de saber quem é o usuário. Pôr RLS aqui impediria entrar.
-- `plans`, `webhook_events`: catálogo e eventos do provedor, não são de
--   ninguém em particular.
-- `subscriptions`, `subscription_invoices`, `payment_methods`: o webhook do
--   provedor mexe nelas sem usuário logado. Ficam de fora por ora; o dado
--   sensível do app são os lançamentos, e esses estão cobertos.
