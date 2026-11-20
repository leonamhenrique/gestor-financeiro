-- Os dias que o BANCO reporta para o cartão, lidos das faturas dele.
-- Antes eram lidos a cada conferência, usados na tela e jogados fora: fora
-- da importação nenhuma tela sabia o que o banco tinha dito, e o usuário
-- ficava sendo a única fonte dos dias — justamente a fonte que erra.
ALTER TABLE "credit_cards" ADD COLUMN "bank_closing_day" INTEGER;
ALTER TABLE "credit_cards" ADD COLUMN "bank_due_day" INTEGER;

-- O ciclo está como uma PESSOA quis, e não como o banco diz. Enquanto for
-- falso, os dias do banco valem sozinhos: não há decisão humana para
-- respeitar. Falso para todo mundo agora é o certo — ninguém decidiu nada
-- ainda, e os cartões que vierem a discordar do banco serão marcados na
-- primeira gravação de ciclo.
ALTER TABLE "credit_cards" ADD COLUMN "cycle_edited_by_user" BOOLEAN NOT NULL DEFAULT false;
