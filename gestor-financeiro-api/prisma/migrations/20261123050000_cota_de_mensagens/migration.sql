-- Quantas mensagens cada conta mandou no mes.
--
-- UM NUMERO por conta e por mes: nem texto, nem telefone, nem horario. O app
-- nao guarda conversa, e contar cota nao e desculpa para comecar.
CREATE TABLE "whatsapp_usage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "whatsapp_usage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "whatsapp_usage_user_id_month_key" ON "whatsapp_usage"("user_id", "month");

ALTER TABLE "whatsapp_usage" ADD CONSTRAINT "whatsapp_usage_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
