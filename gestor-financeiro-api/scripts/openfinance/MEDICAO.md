# Medição do sandbox da Polp — 07/11/2026

Ambiente sandbox, provedor Celcoin. Dois consentimentos criados e revogados;
nenhuma rota de produção tocada, nada cobrado.

## O que o ambiente exige

|                    | Produção                          | Sandbox             |
| ------------------ | --------------------------------- | ------------------- |
| Base               | `/api/v2`                         | `/api/v2/sandbox`   |
| Plano ativo        | obrigatório                       | não exigido         |
| Fatura em atraso   | bloqueia (402)                    | não bloqueia        |
| Cobrança           | consentimento autorizado é cobrado| nunca               |
| Autorização        | usuário autoriza no banco         | já nasce `AUTHORISED` |
| Instituição        | precisa estar `OPERATIONAL`       | qualquer uma        |

`POST /api/v2/sandbox/consents` com o mesmo corpo de produção responde 201 já
`AUTHORISED` / `SUCCESS`, e `url_to_authenticate` aponta direto para a URL de
retorno — o mesmo front-end funciona sem a tela do banco. Os ambientes são
isolados: recurso de um consultado pelo outro responde 404, inclusive ao
tratar webhook.

## O que o sandbox gera

Por consentimento, conforme os `products` pedidos: 2 contas, 2 cartões
(limites, faturas fechadas, até 50 transações, com compras parceladas e
assinaturas), 1 empréstimo e 1 financiamento, 9 posições de investimento.
Dados determinísticos — o mesmo consentimento devolve os mesmos ids e
valores, e sincronizar de novo não duplica.

Teto de **50 transações mais recentes** por conta e por cartão: não existe
carga histórica de uma vez, o histórico se acumula sincronizando.

## Os sete achados

| Achado | O que muda no código |
| --- | --- |
| **A documentação erra sobre parcela futura.** Promete `bill_post_date = "0001-01-01"`; veio data real (`2026-10-22`) com `bill_id` nulo. | Detectar "ainda não faturada" por `bill_id === null`. Seguir a documentação faria toda parcela futura entrar como já faturada. |
| **O banco projeta uma fatura à frente.** Compra em 6×: chegaram 2 parcelas, ambas previstas para `2026-11`. | A colisão com as parcelas que o app projeta é pequena e localizada — não são duas séries completas brigando. |
| **`totalInstallments` vem completo** (6) mesmo com só 2 parcelas recebidas. | Casa com o `quantasParcelasFaltam` que o importador de OFX já usa. |
| **Fuso.** Datas chegam como `2026-10-16T03:00:00.000000Z` — meia-noite de Brasília em UTC. | Cortar os 10 primeiros caracteres acerta; converter para hora local tira um dia, e num cartão que fecha dia 16 isso joga a compra para a outra fatura. |
| **Valores são string e sem sinal** (`{ amount: "1500.00", currency: "BRL" }`). | A direção vem de `credit_debit_type`. Somar sem olhar esse campo inverte despesa e receita. |
| **Categoria já vem classificada** (`INCOME_SALARY`, `FOOD_AND_DRINK_GROCERIES`…). | Dá para mapear na árvore de categorias do app em vez de reclassificar pelo nome do lojista. |
| **`/credit-cards/{id}/installments`** agrupa a compra parcelada: `description`, `amount` por parcela, `totalInstallments`, `occurrences[]` ordenadas por `charge_identificator`. | É o par direto do `seriesDeParcelas` do importador. |

## Por que o sandbox não responde à pergunta do mês

`bill_forecast_date` (AAAA-MM) só se distingue num cartão cuja fatura feche
num mês e vença no seguinte. Em **21 cartões de 10 instituições** (de 188
disponíveis), isso nunca aconteceu: o vencimento veio **sempre exatamente 7
dias** depois do fechamento, e o dia de fechamento nunca passou de 18.

```
BTG Banking / Mastercard Gold        fecha 16/10   vence 23/10
BTG Banking / Elo Black              fecha 07/10   vence 14/10
Banco XP / Mastercard Infinite       fecha 08/10   vence 15/10
Banco Safra / Elo Classic            fecha 03/11   vence 10/11
Banco PAN / Visa Classic             fecha 15/10   vence 22/10
Santander PF / Elo Black             fecha 01/11   vence 08/11
BNDES / Elo Platinum                 fecha 06/11   vence 13/11
… outros 14, todos com a mesma distância de 7 dias
```

Com fechamento no máximo no dia 18 e mais 7 dias, o vencimento cai no máximo
no dia 25 — sempre no mesmo mês. O cartão ITI do usuário, que fecha dia 30 e
vence dia 7 do mês seguinte, é exatamente a forma que o gerador não produz.

`medir-forecast.js` refaz essa varredura e diz "INCONCLUSIVO" em vez de
inventar um número, caso a Polp mude o gerador.

## Onde a dúvida cabe

| Situação | O que se sabe | Ambíguo? |
| --- | --- | --- |
| Transação já faturada | tem `bill_id`; a fatura traz `bill_closing_date` **e** `due_date` | não |
| Parcela futura | só existe `bill_forecast_date` | **sim** |

Daí a escolha de não depender do campo: na parcela futura, derivar a fatura
com `faturaSugerida(data, cartão)` — a regra do próprio app, a mesma do
importador de OFX — e usar `bill_forecast_date` só como conferência.

## Enviado ao Suporte em 07/11/2026

1. `bill_forecast_date` segue `bill_closing_date` ou `due_date`?
2. Qual o comportamento garantido de `bill_post_date` em parcela futura, já
   que no sandbox ele não veio como `"0001-01-01"`? Dá para usar
   `bill_id = null` como critério?
3. O sandbox pode gerar cartões cuja fatura feche num mês e vença no
   seguinte, para validar (1) sem consentimento de produção?
