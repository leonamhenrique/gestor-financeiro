-- Onde o aparelho pede para ser avisado.
--
-- O `endpoint` é a URL que o serviço de push do navegador dá, e é ela que
-- identifica o aparelho — não o usuário, não o navegador. A mesma pessoa em
-- três aparelhos tem três linhas, e é isso mesmo: avisar em um só seria
-- avisar onde ela talvez não esteja.
--
-- `p256dh` e `auth` são as chaves que o PRÓPRIO navegador gerou para cifrar
-- o aviso. Sem elas o payload não se monta. Não são segredo nosso e não
-- servem para mais nada: fora deste endpoint elas não abrem porta nenhuma.
--
-- `ultimo_aviso_em` existe para a regra de "no máximo um por dia". Ela mora
-- no banco, e não em memória, para valer igual com mais de uma instância da
-- API rodando — duas instâncias acordando às 6h mandariam dois avisos.
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "ultimo_aviso_em" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- O mesmo aparelho se inscrevendo de novo é a MESMA inscrição: o navegador
-- devolve o mesmo endpoint, e duas linhas iguais virariam dois avisos.
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "push_subscriptions" FORCE  ROW LEVEL SECURITY;
CREATE POLICY dono_push_subscriptions ON "push_subscriptions"
  USING (user_id = dono_atual()) WITH CHECK (user_id = dono_atual());
