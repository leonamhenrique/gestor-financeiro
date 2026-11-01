-- ============================================================
-- O regime dos relatórios sai do navegador
-- ============================================================
-- "Contar pela compra ou pela fatura" é uma escolha do usuário, e até agora
-- ela vivia apenas no localStorage do aparelho onde foi feita. Isso bastava
-- enquanto só a tela lia relatório. Com a pergunta "qual meu resultado nesse
-- mês?" pelo WhatsApp, o servidor passou a precisar da MESMA escolha: sem a
-- coluna, ele responderia sempre pelo padrão, e quem tivesse trocado para
-- "compra" veria um número na tela e outro no telefone.
--
-- FATURA como padrão porque é o padrão do app (`var relatorioPor = "fatura"`).
-- Quem já tinha trocado no aparelho continua com a escolha dele lá, e ela
-- sobe para o servidor na primeira vez que a tela de Configurações é usada.
-- ============================================================

-- CreateEnum
CREATE TYPE "ReportRegime" AS ENUM ('COMPRA', 'FATURA');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "report_regime" "ReportRegime" NOT NULL DEFAULT 'FATURA';
