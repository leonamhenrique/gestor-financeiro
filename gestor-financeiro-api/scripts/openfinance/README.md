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
  lançamento duplicado visível, que se apaga — e não saldo corrompido.

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
```

Todos só tocam `/api/v2/sandbox`, onde consentimento nunca é cobrado, e
revogam o que criam (`medir-sandbox` imprime o comando; os outros revogam
sozinhos). Para conferir que não ficou nada vivo, `GET
/api/v2/sandbox/consents` deve devolver lista vazia.

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

### O que ainda não foi exercitado

- O cenário é montado, não é o extrato de verdade de ninguém. Cobre os casos
  que sabemos nomear.
- `PAGAMENTO_DE_FATURA` (reconhecido pela categoria
  `LOAN_PAYMENTS_CREDIT_CARD_PAYMENT`, para não contar o mesmo dinheiro duas
  vezes) nunca apareceu nas contas do sandbox. O ramo existe e não foi
  medido.
- As janelas de dias (3 no cartão, 7 no previsto) são chute explícito. Num
  extrato real elas se recalibram.
- A primeira sincronização de todas tem 100% de "nova". Isso não é
  duplicação, é carga inicial — outro problema, ainda não tratado.

## A dúvida em aberto

Se `bill_forecast_date` segue o mês de `bill_closing_date` ou o de `due_date`.
Pergunta enviada ao Suporte da Polp em 07/11/2026.

**Ela não bloqueia.** Para transação já faturada não há ambiguidade: o
`bill_id` leva à fatura, que traz as duas datas. Ela só importa na parcela
futura — e ali o caminho escolhido é não depender do campo: derivar a fatura
com `faturaSugerida(data, cartão)`, a regra do próprio app, e usar
`bill_forecast_date` apenas como conferência. Divergiu, o app pergunta em vez
de decidir.
