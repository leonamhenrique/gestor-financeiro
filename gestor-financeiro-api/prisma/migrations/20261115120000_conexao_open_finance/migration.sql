-- ============================================================
-- A conta conectada, sem que a conta manual mude de vida
-- ============================================================
-- Duas formas de lançar passam a conviver: quem conectar o banco recebe o
-- realizado por Open Finance, e quem não conectar usa o app exatamente como
-- hoje. A segunda forma é a que já existe, e esta migração foi escrita para
-- não encostar nela: nenhuma coluna vira obrigatória, nenhum padrão muda,
-- nenhuma linha existente é reescrita. Um banco de dados que já roda hoje
-- continua idêntico depois desta migração — o que ela cria nasce tudo nulo.
--
-- POR QUE UMA TABELA, E NÃO COLUNAS NA CONTA
-- Um consentimento não é "de uma conta": ele é de um BANCO, e de uma vez
-- traz várias contas e vários cartões. E tem vida própria — nasce esperando
-- autorização, vive meses, expira, é revogado — enquanto a conta do app
-- continua existindo antes, durante e depois. Guardar isso como colunas da
-- conta espalharia o mesmo consentimento por várias linhas, e revogar
-- passaria a ser um UPDATE em todas elas, com a chance de parar no meio.
--
-- POR QUE `revoked_at` EM VEZ DE APAGAR A LINHA
-- Os lançamentos que já entraram por ela continuam existindo depois de
-- desconectar — é esse o trato: desistir não apaga o dinheiro de ninguém.
-- Apagar a linha deixaria esse passado sem explicação. Soft-delete é o que o
-- resto do app já faz.
--
-- A REGRA DAS DUAS FORMAS, ESCRITA EM SQL
-- `ON DELETE SET NULL` nas duas pontas. Sumir com a conexão NUNCA pode levar
-- junto a conta, o cartão ou os lançamentos de alguém: o que sobra é uma
-- conta comum, manual, com o histórico inteiro. É a diferença entre
-- "desconectei o banco" e "perdi os meus dados".
-- ============================================================

-- CreateTable
CREATE TABLE "open_finance_connections" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    -- Qual intermediário. Hoje só existe 'POLP'; a coluna existe para que
    -- trocar de provedor não seja uma migração de dados.
    "provider" TEXT NOT NULL DEFAULT 'POLP',
    -- O id do consentimento NO PROVEDOR. É por ele que se lê, se confere o
    -- status e se revoga lá fora.
    "consent_id" TEXT NOT NULL,
    "institution_id" TEXT NOT NULL,
    -- O nome fica gravado de propósito, em vez de ser buscado a cada tela: o
    -- catálogo do provedor muda, e uma conexão antiga tem de continuar
    -- sabendo dizer de que banco ela era.
    "institution_name" TEXT,
    "status" TEXT NOT NULL,
    "products" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- Quando a autorização concluiu de fato. Nulo enquanto espera o banco.
    "authorized_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    -- Desconectada, mas não esquecida. Ver a nota lá em cima.
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "open_finance_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "open_finance_connections_user_id_idx" ON "open_finance_connections"("user_id");

-- CreateIndex
-- O mesmo consentimento não entra duas vezes. Sem isto, uma segunda
-- sincronização do mesmo consentimento criaria outra conexão, e as contas
-- ficariam divididas entre as duas — metade do extrato em cada uma.
CREATE UNIQUE INDEX "open_finance_connections_provider_consent_id_key"
  ON "open_finance_connections"("provider", "consent_id");

-- AddForeignKey
ALTER TABLE "open_finance_connections" ADD CONSTRAINT "open_finance_connections_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- RLS, pela mesma trilha das outras tabelas com dono ----------
ALTER TABLE "open_finance_connections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "open_finance_connections" FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_open_finance_connections ON "open_finance_connections"
  USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual());

-- ============================================================
-- De qual conexão vem esta conta / este cartão
-- ============================================================
-- Nulo é o normal: conta criada à mão nunca teve conexão, e continua sem.
-- `provider_account_id` é o id da conta LÁ, e é o que faz uma segunda
-- sincronização reencontrar a conta daqui em vez de criar outra.

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN "connection_id" TEXT;
ALTER TABLE "bank_accounts" ADD COLUMN "provider_account_id" TEXT;

ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "open_finance_connections"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "bank_accounts_connection_id_idx" ON "bank_accounts"("connection_id");

-- Uma conta do banco corresponde a UMA conta daqui. Nulos não colidem entre
-- si num índice único do Postgres, então toda conta manual fica de fora
-- desta regra — que é exatamente o que se quer.
CREATE UNIQUE INDEX "bank_accounts_connection_id_provider_account_id_key"
  ON "bank_accounts"("connection_id", "provider_account_id");

-- AlterTable
ALTER TABLE "credit_cards" ADD COLUMN "connection_id" TEXT;
ALTER TABLE "credit_cards" ADD COLUMN "provider_account_id" TEXT;

ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "open_finance_connections"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "credit_cards_connection_id_idx" ON "credit_cards"("connection_id");

CREATE UNIQUE INDEX "credit_cards_connection_id_provider_account_id_key"
  ON "credit_cards"("connection_id", "provider_account_id");

-- ============================================================
-- O id do lançamento no provedor: a idempotência, e o desfazer
-- ============================================================
-- Esta coluna faz duas coisas com uma chave só.
--
-- A primeira é não duplicar. Sincronizar de novo relê as mesmas transações:
-- sem um id estável, cada passada criaria o mesmo gasto outra vez, e o
-- extrato de quem conectou cresceria sozinho.
--
-- A segunda é saber o que apagar se o experimento for desfeito. Lançamento
-- com `provider_tx_id` veio do banco; sem, é do usuário, e esse não se toca.
-- Sem a coluna, "apagar o que a integração trouxe" viraria adivinhação por
-- data e valor — e adivinhar aqui é apagar o lançamento de alguém.
--
-- É a mesma forma do `client_key`, que já resolve o reenvio da fila offline:
-- texto, nulo no que não veio de fora, único por usuário. No Postgres nulos
-- não colidem entre si, então todo lançamento que existe hoje continua
-- válido sem olhar para esta regra.

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "provider_tx_id" TEXT;
ALTER TABLE "transactions" ADD COLUMN "synced_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "transactions_user_id_provider_tx_id_key"
  ON "transactions"("user_id", "provider_tx_id");
