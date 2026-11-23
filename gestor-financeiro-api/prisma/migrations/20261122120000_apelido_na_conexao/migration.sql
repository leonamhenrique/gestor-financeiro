-- Apelido da conexão de Open Finance.
--
-- Nulo em tudo que já existe: quem só tem uma conexão por banco nunca
-- precisou distinguir nada, e a tela continua mostrando o nome da
-- instituição quando não há apelido.
ALTER TABLE "open_finance_connections" ADD COLUMN "nickname" TEXT;
