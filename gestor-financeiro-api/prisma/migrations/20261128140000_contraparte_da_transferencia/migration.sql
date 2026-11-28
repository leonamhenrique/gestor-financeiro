-- De quem e o outro lado da transferencia.
--
-- O nome so existia dentro do texto da descricao ("Pix recebido - Fulano"),
-- e dentro do texto ele nao da para comparar: a mesma pessoa aparece como
-- "Pix recebido - Fulano" numa direcao e "Pix enviado - Fulano" na outra.
-- Sem o nome separado, o app nao tinha como perguntar "este sou eu?" -- e
-- por isso etiquetava como transferencia tanto o Pix do proprio titular
-- quanto o Pix para outra pessoa.
ALTER TABLE "transfers" ADD COLUMN "counterparty_name" TEXT;

-- O que ja existe ENSINA. Sem este backfill, a pessoa teria de marcar de
-- novo um nome que ela ja marcou dezenas de vezes -- e o recurso so
-- comecaria a servir semanas depois.
--
-- So nas transferencias que vieram do Open Finance (`provider_tx_id` nao
-- nulo): nas criadas a mao a descricao e texto livre, e tirar prefixo dali
-- inventaria nome.
--
-- E so quando o prefixo REALMENTE existe. Um `split` no primeiro hifen
-- cortaria "Supermercado Dia - Loja 4" no lugar errado; o `WHERE` com o
-- mesmo padrao garante que nada sem prefixo conhecido seja tocado.
UPDATE "transfers"
   SET "counterparty_name" = btrim(
         regexp_replace(
           "description",
           '^(pix recebido|pix enviado|pix|ted recebida|ted enviada|ted|tev|doc|transfer[êe]ncia recebida|transfer[êe]ncia enviada|transfer[êe]ncia)\s*-\s*',
           '',
           'i'
         )
       )
 WHERE "provider_tx_id" IS NOT NULL
   AND "description" IS NOT NULL
   AND "description" ~* '^(pix recebido|pix enviado|pix|ted recebida|ted enviada|ted|tev|doc|transfer[êe]ncia recebida|transfer[êe]ncia enviada|transfer[êe]ncia)\s*-\s*';

-- Quem vai consultar isto pergunta "esta pessoa ja marcou este nome como
-- transferencia?", por usuario.
CREATE INDEX "transfers_user_id_counterparty_name_idx"
    ON "transfers" ("user_id", "counterparty_name");
