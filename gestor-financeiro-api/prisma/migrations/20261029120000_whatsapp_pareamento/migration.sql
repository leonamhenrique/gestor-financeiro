-- ============================================================
-- O número de WhatsApp que pode lançar nesta conta
-- ============================================================
-- Não é a volta da tabela que a migration 20261012190000 removeu. Aquela era
-- um resto da migration inicial: nasceu sem código que a usasse, guardava o
-- telefone em claro numa coluna de `users` e insinuava uma coleta que não
-- acontecia. Estas duas nascem com uso definido, sem o número legível em
-- lugar nenhum, e com a tela que explica o que está ligado.
--
-- `phone_hash` é um HMAC com um segredo do servidor (WHATSAPP_PHONE_PEPPER),
-- e não um SHA-256 puro: telefone tem pouca entropia — um celular brasileiro
-- cabe em ~10^11 tentativas — e um hash simples disso se reverte por força
-- bruta. `phone_last4` é o que a tela mostra, pelo mesmo acordo do cartão:
-- últimos quatro, nunca o número inteiro.
-- ============================================================

-- CreateTable
CREATE TABLE "whatsapp_links" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "phone_last4" TEXT NOT NULL,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3),

    CONSTRAINT "whatsapp_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_pairings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_pairings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Um vínculo por usuário, e um usuário por número: sem o segundo, uma
-- mensagem resolveria para dois donos e o lançamento cairia na conta errada.
CREATE UNIQUE INDEX "whatsapp_links_user_id_key" ON "whatsapp_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_links_phone_hash_key" ON "whatsapp_links"("phone_hash");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_pairings_code_hash_key" ON "whatsapp_pairings"("code_hash");

-- CreateIndex
CREATE INDEX "whatsapp_pairings_user_id_idx" ON "whatsapp_pairings"("user_id");

-- AddForeignKey
ALTER TABLE "whatsapp_links" ADD CONSTRAINT "whatsapp_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_pairings" ADD CONSTRAINT "whatsapp_pairings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- as duas ficam FORA do RLS, de propósito ----------
-- O mesmo caso de `share_links`. O webhook não tem dono para o banco ler: ele
-- precisa descobrir DE QUEM é a mensagem antes de saber de quem ela é. Com
-- RLS aqui, a busca pelo hash do telefone voltaria vazia sempre e nenhuma
-- mensagem acharia o seu dono.
--
-- O que a abertura expõe, no pior caso, são estas duas tabelas: hashes, datas
-- e ids. Não há número legível, nome, e-mail nem valor. E quem entrar por ela
-- não ganha mais nada — achado o dono, a API define `app.user_id` com o id
-- DELE e todo o resto volta a passar pelo RLS, como numa requisição
-- autenticada qualquer.
