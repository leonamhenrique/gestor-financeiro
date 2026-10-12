-- ============================================================
-- Remove os restos da integração com WhatsApp
-- ============================================================
-- A tabela `whatsapp_message_logs`, a coluna `users.whatsapp_number` e os dois
-- enums nasceram na migration inicial e nunca foram usados: não existe módulo,
-- controller nem rota de WhatsApp na API, e o app web não menciona a palavra
-- uma única vez. Schema que insinua uma coleta que não acontece é o tipo de
-- coisa que confunde auditoria de privacidade — e este app declara, na política
-- publicada, que não guarda telefone.
--
-- A tabela é descartada sem salvar nada porque nenhum caminho de código jamais
-- escreveu nela.
-- ============================================================

-- O enum perde o valor WHATSAPP. O `USING` abaixo converte a coluna, e a
-- conversão FALHA se alguma linha ainda usar o valor que está saindo — o que
-- abortaria a migration e, com ela, a subida da API (`migrate deploy` roda
-- dentro do start). O UPDATE existe para que isso não possa acontecer: a API
-- aceitava `source` vindo do cliente, então não dá para garantir, de fora, que
-- nenhuma linha tenha WHATSAPP gravado.
UPDATE "transactions" SET "source" = 'APP' WHERE "source" = 'WHATSAPP';

-- AlterEnum
BEGIN;
CREATE TYPE "TransactionSource_new" AS ENUM ('APP');
ALTER TABLE "transactions" ALTER COLUMN "source" DROP DEFAULT;
ALTER TABLE "transactions" ALTER COLUMN "source" TYPE "TransactionSource_new" USING ("source"::text::"TransactionSource_new");
ALTER TYPE "TransactionSource" RENAME TO "TransactionSource_old";
ALTER TYPE "TransactionSource_new" RENAME TO "TransactionSource";
DROP TYPE "TransactionSource_old";
ALTER TABLE "transactions" ALTER COLUMN "source" SET DEFAULT 'APP';
COMMIT;

-- DropForeignKey
ALTER TABLE "whatsapp_message_logs" DROP CONSTRAINT "whatsapp_message_logs_user_id_fkey";

-- DropForeignKey
ALTER TABLE "whatsapp_message_logs" DROP CONSTRAINT "whatsapp_message_logs_parsed_transaction_id_fkey";

-- DropIndex
DROP INDEX "users_whatsapp_number_key";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "whatsapp_number";

-- DropTable
-- As políticas de Row Level Security da tabela caem junto com ela.
DROP TABLE "whatsapp_message_logs";

-- DropEnum
DROP TYPE "WhatsappMessageStatus";
