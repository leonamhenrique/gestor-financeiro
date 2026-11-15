-- ============================================================
-- Quantos lançamentos esperam, sem perguntar ao banco
-- ============================================================
-- O app precisa dizer "12 lançamentos aguardando conferência" numa tela que
-- a pessoa abre todo dia. Descobrir isso na hora custaria uma ida ao
-- provedor a cada abertura do app — para um cartão com 483 transações, e
-- para não mostrar nada na maioria das vezes.
--
-- Então quem pergunta é o trabalho diário, uma vez por conexão, e o número
-- fica aqui. A tela lê do banco e responde na hora.
--
-- `pending_checked_at` existe para o número poder ser lido com desconfiança:
-- um "12" de três dias atrás não é a mesma coisa que um "12" de hoje de
-- manhã, e sem a data a tela não teria como saber a diferença.
--
-- As duas são nulas em toda conexão que existe hoje, e nulo quer dizer
-- "ainda não perguntei" — que é diferente de zero, "perguntei e não havia
-- nada". A diferença importa: só o zero autoriza a tela a ficar calada.
-- ============================================================

ALTER TABLE "open_finance_connections" ADD COLUMN "pending_count" INTEGER;
ALTER TABLE "open_finance_connections" ADD COLUMN "pending_checked_at" TIMESTAMP(3);
