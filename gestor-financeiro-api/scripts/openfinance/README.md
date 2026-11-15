# Open Finance pela Polp — experimento

Esta pasta é **bancada, não integração**. Nada aqui é importado pelo app nem
roda em produção: são scripts para medir o que o provedor entrega antes de
escrever uma linha de código que mexa em lançamento de alguém.

O levantamento completo da primeira medição (07/11/2026) está em
`MEDICAO.md`, ao lado deste arquivo.

## O contrato deste branch

Isto é um teste. Se não funcionar, tem de sair **sem comprometer a lógica que
o app já tem**. Por isso:

- o experimento vive no branch `openfinance-polp`, que **não publica** — a
  `main` é que dispara Render e Cloudflare Pages a cada push;
- o código novo fica isolado em `src/openfinance/`, e esta pasta de bancada em
  `scripts/openfinance/`. Desistir é apagar as duas e o branch;
- **nada no banco** até a hora de gravar de verdade; quando for, migration
  `--create-only`, submetida antes de aplicar;
- a funcionalidade nasce atrás de uma flag **desligada por padrão**: sem a
  variável de ambiente, o app se comporta exatamente como hoje;
- **a gramática compartilhada não se toca.** `web/home.html` e o recorte em
  `src/fala/` são divididos com o WhatsApp; mexer ali não é reversível de um
  lado só;
- **nada que a integração faça altera lançamento que o usuário criou.** No
  máximo ela propõe, como o importador de OFX já faz. Assim o pior caso é um
  lançamento duplicado visível, que se apaga — e não saldo corrompido;
- **as duas formas convivem, e a conexão é sempre a segunda.** Exigência do
  dono do app em 15/11/2026: quem não quiser conectar banco nenhum usa o
  sistema inteiro como hoje. Open Finance é **aditivo, nunca substitutivo** —
  nenhuma tela passa a exigir conexão, nenhuma fica pela metade sem ela, e a
  escolha é **por conta/cartão**, não um modo do usuário: dá para conectar o
  Nubank e seguir lançando o cartão da loja na mão. Quem nunca conectar vê
  exatamente uma coisa a mais, um convite recusável.

### Por onde a sincronização entra

Pela porta do **importador que já existe**, não por uma nova. O app já
importa OFX; sincronizar é esse mesmo caminho rodando sozinho, com os mesmos
casadores e a mesma `faturaSugerida`. O ledger do app continua sendo a
verdade, e o banco **alimenta lançamentos** — não vira uma segunda fonte de
saldo brigando com a primeira. Daí sai de graça: nenhuma regra travada muda
(saldo só por `$transaction`, XOR conta/cartão, soft-delete), o lançamento
manual não muda nem para quem conectou, e desligar é parar de sincronizar —
o que sobra parece lançamento importado, que o app já sabe ter.

## Produção, a partir de 15/11/2026

O plano **Starter** (R$ 159/mês) foi assinado em 15/11/2026, e `GET
/api/v2/consents` passou a responder 200 — antes do plano, rota de produção
devolvia 402. Conferido no mesmo dia: **zero consentimento de produção**,
portanto nada cobrável ainda. O plano **não inclui** consentimento: cada um
custa R$ 3,60/mês na primeira faixa, e só conta quando o usuário autoriza no
banco e a sincronização conclui. Sem fidelidade.

`conferir-plano.js` refaz essa conferência e **não cria consentimento
nenhum** — criar um sem o dono da conta mandar seria gastar o dinheiro dele.

Dos 210 bancos do catálogo, 192 estão `OPERATIONAL`, entre eles os dois que
interessam aqui: **Nubank** e **Iti**. O Iti é o que importa para a dúvida em
aberto lá embaixo — ele fecha dia 30 e vence dia 7, a forma que o gerador do
sandbox nunca produziu.

**O que a produção acrescenta ao contrato de reversar:** consentimento real
traz dado financeiro de verdade para dentro do banco de dados. Desistir passa
a incluir **revogar o consentimento na Polp** (`DELETE /consents/{id}`, que
também pára a cobrança) e **apagar os lançamentos sincronizados** — que se
reconhecem pelo id do provedor guardado em cada um. A mesma coluna serve a
duas coisas: não duplicar ao ressincronizar, e saber o que apagar na saída.

**A autorização no banco é do dono da conta.** Ela acontece no Polp Link, com
o login do banco dele; nenhum passo deste experimento preenche senha.

## O módulo, a partir de 15/11/2026

`src/openfinance/` existe, com 32 testes. O que ele **faz**: fala com a Polp,
guarda a conexão, e devolve uma **proposta**. O que ele **não faz**: gravar
lançamento. Quem decide é a tela de conferência, com a pessoa olhando — o
pior caso de um erro aqui é uma linha a mais numa lista, e não dinheiro
errado no saldo de alguém.

| arquivo | o que é |
| --- | --- |
| `polp.client.ts` | a conversa com o provedor, e só isso. Normaliza e devolve. |
| `openfinance.service.ts` | conectar, conferir, propor, desconectar. |
| `openfinance.controller.ts` | as rotas, todas atrás da flag. |

**A flag é a saída de emergência.** Sem `OPENFINANCE_ENABLED=true` o guard
responde **404**, e não 403: 403 conta que a coisa existe e você não pode;
404 é o app de antes, em que isto nunca foi escrito. (Para quem nem token
tem, o guard global responde 401 primeiro — a rota continua não existindo
para quem está logado, que é o caso que importa.)

### Duas "não duplicações", que são problemas diferentes

1. **A mesma transação vindo de novo do banco**, numa segunda
   sincronização. Resolve-se no servidor, por `providerTxId`: exata, sem
   tolerância, sem depender de texto. O provedor reenvia tudo a cada
   leitura — sem esse corte, a lista de conferência viria cheia do que a
   pessoa importou ontem.
2. **O que o usuário já tinha lançado à mão**, ou que o app projetou como
   parcela. Essa não tem `providerTxId` nenhum — o banco não sabe que ela
   existe. Quem resolve é o casamento da tela.

Confundir as duas erra nos dois sentidos: a primeira, resolvida por texto e
data, erraria; a segunda, resolvida por id, nunca casaria.

### O CPF atravessa e some

Ele vai no corpo do `POST /openfinance/connections`, segue para o provedor e
**não é gravado**. Guardar documento de alguém por uma integração opcional
aumenta o que se perde num vazamento em troca de nada: na reconexão ele
digita de novo, uma vez por ano. Tem teste que lê o que foi gravado e exige
que o número não esteja lá.

### A tela, e a prova de ponta a ponta

A tela existe e entra pela porta do importador de OFX — que já tem
conferência, casamento, criação de parcelas e desfazer por lote. Depois que
os lançamentos chegam, não há mais nada de Open Finance no caminho.

Rodado em 15/11/2026 com a API local e o consentimento real do Inter:

| passo | medido |
| --- | --- |
| sincronizar | 18 na conta + 483 no cartão, em **14 faturas** na tela |
| importar uma fatura | 14 lançamentos, todos com `provider_tx_id` e `synced_at` |
| vínculo | cartão ligado à conexão e à conta de lá |
| sincronizar de novo | a fatura importada **sumiu** da proposta |
| desfazer o lote | 14 removidos, saldo e fatura de volta |

Três defeitos só apareceram aí, e nenhum deles teria aparecido em teste de
unidade: o botão que não fazia nada (seletor de uma classe que deixou de
existir), o `provider_tx_id` que não atravessava do navegador até o pedido
— a idempotência existia só no papel — e o vínculo que nunca era gravado
porque ninguém chamava a função.

### Ligar isso em produção

Duas variáveis, e a ordem importa:

- `OPENFINANCE_ENABLED=true` liga as rotas. Sozinha, ela **estrearia o
  recurso para o app inteiro** — e cada consentimento autorizado é cobrado
  na nossa conta do provedor, de quem quer que conecte;
- `OPENFINANCE_USERS` é a lista de quem ENXERGA: ids ou e-mails separados por
  vírgula. Com ela, a integração sobe ligada e continua invisível para todos
  menos para quem está nela. **Vazia quer dizer todo mundo.**

Quem não está na lista recebe o MESMO 404 de quando a flag está desligada:
para ele a integração não existe, e não "existe e é para outros".

A migration não tem passo manual: o `startCommand` do Render é
`prisma migrate deploy && node dist/main`, então ela se aplica no deploy. As
quatro variáveis estão declaradas no `render.yaml` com `sync: false` — o
nome versionado, o valor só no painel.

## Credenciais

`POLP_API_CLIENT` e `POLP_API_SECRET`, no `.env` da API (ignorado pelo git) e
no painel do Render. O secret aparece uma vez só na criação, no dashboard da
Polp. **Um par de chaves serve aos dois ambientes**: quem escolhe produção ou
sandbox é a rota (`/api/v2` contra `/api/v2/sandbox`), não a chave.

## Os scripts

```bash
node scripts/openfinance/medir-sandbox.js            # o que o sandbox entrega
node scripts/openfinance/medir-sandbox.js --revogar <consentId>
node scripts/openfinance/medir-forecast.js           # caça o cartão que atravessa o mês
node scripts/openfinance/casar.js                    # casamento no CARTÃO
node scripts/openfinance/casar-conta.js              # casamento na CONTA
node scripts/openfinance/conferir-plano.js [nome]    # produção: só leitura
```

Os quatro primeiros só tocam `/api/v2/sandbox`, onde consentimento nunca é
cobrado, e revogam o que criam (`medir-sandbox` imprime o comando; os outros
revogam sozinhos). Para conferir que não ficou nada vivo, `GET
/api/v2/sandbox/consents` deve devolver lista vazia.

`conferir-plano.js` é o único que fala com **produção**, e só lê: lista
consentimentos e instituições. Ele não cria nada, logo não gera cobrança.

Cada um é autossuficiente, com a sua própria cópia das quatro funções de
rede. É de propósito enquanto for bancada: um script de medição que se roda
sozinho vale mais que três que dependem de um quarto. Quando isto virar
código de verdade, em `src/openfinance/`, aí sim há um lugar só.

Os dois casadores não copiam a lógica do app: leem `chaveDeLancamento`,
`textoComparavel` e `seriesDeParcelas` direto de `web/home.html`, como o
banco de testes da tela faz. Reescrevê-las aqui seria a segunda versão da
mesma regra.

## O que já se sabe

Sete achados da primeira medição estão em `MEDICAO.md`. Os três que mudam o
código:

1. **Parcela futura se detecta por `bill_id === null`**, nunca pela
   data-sentinela `"0001-01-01"` que a documentação promete — no sandbox ela
   veio com data real.
2. **O banco projeta uma fatura à frente**, não a série inteira: de uma compra
   em 6× vieram 2 parcelas. A colisão com o que o app projeta é pequena.
3. **As datas chegam como `...T03:00:00Z`** (meia-noite de Brasília em UTC):
   cortar os 10 primeiros caracteres acerta; converter para hora local tira um
   dia, e num cartão que fecha dia 16 isso muda a fatura da compra.

## O casamento, medido

Os dois casadores rodam em memória e não gravam nada. Cada um monta um
cenário a partir das próprias transações do sandbox, **com a resposta certa
anotada em cada caso**, e se confere no fim. Os dois recusam aprovar no
vazio: se o caso central não apareceu na amostra, dizem isso em vez de
imprimir um número bonito.

**No cartão** o texto casa, porque os dois lados dizem o nome do lojista. O
que não casa é a data: o banco repete a data da COMPRA em todas as parcelas,
enquanto o app avança um mês a cada uma — medido, a parcela 1/3 e a 2/3
vieram ambas em `2026-09-28`. Por isso existe uma passada que casa por série
e número de parcela ignorando a data; sem ela, a parcela que o app projetou e
a que o banco mandou ficariam as duas no extrato, com o mesmo valor.

**Na conta** é o contrário, e é o caso difícil: quem lançou um previsto
escreveu "Aluguel", e o banco manda "PIX ENVIADO IMOBILIARIA". O texto nunca
vai bater. A saída é não decidir — mesmo valor, mesma direção e data dentro
de sete dias viram **candidata**, para o app perguntar. E quando mais de um
previsto cabe, nenhum é escolhido: a saída é **ambígua**. Sortear com o
dinheiro de alguém é pior que perguntar.

### Contra extrato de verdade, 15/11/2026

Os dois casadores aceitam `--consent <id>` e passam a ler **produção** em vez
do sandbox — leitura pura: não criam consentimento, e não revogam o que não
criaram. Rodados contra o consentimento do Inter:

| | cartão | conta |
| --- | --- | --- |
| transações | 483 | 18 |
| conferência | 483 de 483 | 18 de 18 |
| o caso central apareceu | 3 parcelas projetadas | sim |

No cartão, a série real repetiu o que o sandbox tinha mostrado: as quatro
parcelas de uma compra chegaram **todas com a data da compra**, e sem a
passada que casa por série ignorando a data elas entrariam de novo, com o
mesmo valor, ao lado das que o app projetou.

**`PAGAMENTO_DE_FATURA` deixou de ser ramo não medido:** apareceu **6 vezes**
no extrato real, onde no sandbox nunca tinha aparecido nenhuma. É o caso de
não contar o mesmo dinheiro duas vezes — a fatura já é a soma das compras, e
o pagamento dela na conta tem caminho próprio no app.

### O que ainda não foi exercitado

- O cenário do lado do APP é montado, não é a base de ninguém: as transações
  do banco são reais, mas "o que o app já tem" é construído a partir delas,
  com a resposta certa anotada. Cobre os casos que sabemos nomear.
- As janelas de dias (3 no cartão, 7 no previsto) são chute explícito. Num
  extrato real elas se recalibram.
- A primeira sincronização de todas tem 100% de "nova". Isso não é
  duplicação, é carga inicial — outro problema, ainda não tratado.

## A dúvida, RESPONDIDA em 15/11/2026

`bill_forecast_date` é o mês do **VENCIMENTO**. Medido em fatura de verdade:
cartão Inter GOLD, que fecha dia 30 e vence dia 7 — **15 faturas, todas
atravessando o mês**, e **469 de 469** transações faturadas com o previsto
igual ao mês do vencimento. Nenhuma exceção, nenhum empate.

É a mesma convenção que o app adotou em 07/11 (`3653c86`): a fatura se chama
pelo mês em que vence. O provedor e o app falam a mesma língua.

Duas coisas vieram junto, e as duas corrigem o que o sandbox tinha sugerido:

1. **`bill_post_date` nunca veio como `"0001-01-01"`**, nem nas 14 transações
   da fatura ainda aberta: vem a data real de lançamento. O critério de "ainda
   não faturada" continua sendo `bill_id === null`, como já estava decidido.
2. **`occurrences[]` tem forma diferente nos dois ambientes.** No sandbox vem
   como objetos com os campos da parcela; em produção vem como **ids de
   transação**. Ler o campo direto da ocorrência devolve `undefined` em
   produção — e `undefined` se parece com "o banco não mandou o campo".
   Parecia INCONCLUSIVO quando era lugar errado. Os campos moram em
   `/credit-cards/{id}/transactions`.

Refaz com `--medir <consentId>`.

**O caminho escolhido não muda.** Para parcela futura a fatura continua sendo
derivada por `faturaSugerida(data, cartão)` — a regra do próprio app — e o
`bill_forecast_date` segue como conferência. Agora se sabe que as duas devem
concordar, e discordar virou sinal de defeito, não dúvida de interpretação.

A pergunta ao Suporte, enviada em 07/11, perdeu a urgência: dados reais
responderam.

**Ela não bloqueia.** Para transação já faturada não há ambiguidade: o
`bill_id` leva à fatura, que traz as duas datas. Ela só importa na parcela
futura — e ali o caminho escolhido é não depender do campo: derivar a fatura
com `faturaSugerida(data, cartão)`, a regra do próprio app, e usar
`bill_forecast_date` apenas como conferência. Divergiu, o app pergunta em vez
de decidir.
