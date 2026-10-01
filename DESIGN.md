# Padrão visual — App Gestor Financeiro
### Direção "Densa / data-first" · dark mode minimalista futurista

Este arquivo é o padrão único de todas as telas do app. Cole-o no projeto como
`DESIGN.md` (ou dentro do `CLAUDE.md`) e referencie-o em qualquer prompt de tela.

---

## Prompt para gerar uma tela nova

> Crie a tela **[NOME DA TELA]** do app gestor financeiro para
> **[mobile | desktop | ambos]**, seguindo exatamente o padrão visual descrito
> em `DESIGN.md`.
>
> Conteúdo da tela: **[liste os blocos, de cima para baixo]**
>
> Não invente um estilo novo: use os tokens, a anatomia de componentes e as
> regras de composição do padrão. Componente único autocontido, responsivo a
> partir de 390px, com dados mock realistas em BRL. Se incluir desktop, siga a
> seção 9 — composição, trilho e escala de tipografia.

O padrão abaixo é o que faz esse prompt funcionar — mantenha-o atualizado.

---

## 1. Princípio

**Sem cards.** A hierarquia nasce de tipografia, espaçamento e hairlines — nunca
de caixas empilhadas. Cada pixel de borda que você não desenha é informação que
cabe na primeira dobra. Se um bloco parece perdido, o problema é o espaçamento,
não a falta de um contêiner.

Consequências práticas:

- Nenhum `background` em bloco de conteúdo. O fundo da tela é o fundo de tudo.
- Separação entre itens: `border-top: 1px solid rgba(255,255,255,0.06)`.
- Agrupamento: rótulo em caixa alta + espaço maior acima. Nada mais.
- Exceções permitidas (as únicas): grids segmentados (receitas/despesas, cards de
  meta) que usam `border: 1px` com `border-radius: 12–16px`, e o botão primário.

## 2. Tokens

```css
:root {
  /* superfície */
  --bg:            #070B12;
  --hairline:      rgba(255,255,255,0.06);
  --hairline-strong: rgba(255,255,255,0.08);
  --controle-borda:  rgba(255,255,255,0.34);   /* 3,03:1 — contorno de controle */
  --warning-borda:   rgba(255,184,107,0.45);   /* 3,06:1 — contorno do aviso */
  --track:         rgba(255,255,255,0.38);  /* 3,51:1 — trilho de barras */

  /* texto */
  --fg:            #E2EEF8;
  --fg-muted:      rgba(226,238,248,0.72);  /* valores secundários */
  --fg-subtle:     rgba(226,238,248,0.54);  /* metadados, rótulos */
  --fg-ghost:      rgba(226,238,248,0.42);  /* centavos, sufixos */

  /* semântica */
  --accent:        #6EE7F0;   /* ciano — dado em destaque, seleção, ação */
  --accent-ink:    #051016;   /* texto sobre o acento */
  --positive:      #3DD68C;
  --negative:      #FF6B6B;
  --warning:       #FFB86B;   /* orçamento estourando */

  /* forma */
  --r-sm: 10px; --r-md: 12px; --r-lg: 16px; --r-pill: 999px;
  --bar-h: 4px;              /* altura de toda barra de progresso */
}
```

Regra de uso do acento: **um acento por tela em posição de destaque.** Ciano é
para o dado que importa agora — nunca para decorar. Verde e vermelho só em
sinal de valor (entrada/saída, variação). Laranja só em limite/alerta.

### Tema claro

O padrão nasce escuro, e o claro é a **mesma anatomia com os tons invertidos** —
nenhuma regra de composição muda. Três coisas não são simples inversão:

1. **Fundo não é branco puro.** `#FFFFFF` é a maior fonte de brilho de uma
   tela; o fundo é um off-white levemente frio, ecoando o azul do tema escuro.
2. **Tinta não é preto.** Texto em `#000` sobre claro cansa tanto quanto branco
   puro sobre escuro. É ardósia escura, com os secundários por opacidade — a
   mesma mecânica do escuro.
3. **Acento e sinais escurecem.** Ciano `#6EE7F0` é lindo sobre `#070B12` e
   ilegível sobre claro (contraste ~1,3:1). Sobre claro tudo desce para faixas
   de 4,5:1 ou mais. E **hairline preta precisa de mais opacidade que a branca**
   para pesar o mesmo: 0,06 some sobre claro.

```css
:root[data-tema="claro"] {
  --bg:              #F6F8FB;
  --hairline:        rgba(15,23,32,0.10);
  --hairline-strong: rgba(15,23,32,0.16);
  --controle-borda:  rgba(15,23,32,0.46);      /* 3,00:1 — tinta preta rende menos */
  --warning-borda:   rgba(154,100,16,0.75);    /* 3,01:1 — idem para o aviso */
  --bar-aviso:       #84540C;                  /* 6,06:1 — ocre só do preenchimento */
  --track:           rgba(15,23,32,0.28);      /* 1,85:1 — teto do acento, ver abaixo */

  --fg:        #14202B;
  --fg-muted:  rgba(20,32,43,0.78);
  --fg-subtle: rgba(20,32,43,0.66);
  --fg-ghost:  rgba(20,32,43,0.52);

  --accent:     #0C6E77;   --accent-ink: #F3FBFC;
  --positive:   #0E7C5A;   --negative:   #C0392F;   --warning: #9A6410;
}
```

**A opacidade da tinta secundária é medida, não escolhida no olho.** Com as
primeiras opacidades (0,38 no escuro, 0,50 no claro) metadado e rótulo ficavam
em 3,2:1 — legíveis na mesa, invisíveis no celular ao sol. Os pisos medidos são
0,51 no escuro e 0,64 no claro para 4,5:1, **contando os fundos tingidos**
(células de receita/despesa e o primeiro degrau do mapa de calor), e é de lá
que saem os valores acima. Mesma medição vale para o acento do tema claro: o
ciano anterior (#0E7C86) dava 4,19:1 sobre o próprio tinte no pill ativo.

**`--fg-ghost` não veste texto pequeno.** Ele é medido para 3:1, não 4,5:1,
porque nasceu para o que é grande ou não é letra: centavos do número herói,
alça de arraste, marca vazia dos primeiros passos. O dia do mês vizinho no
calendário usava o fantasma em 13px e ficava em 3,39:1 no claro e 3,61:1 no
escuro — texto reprovado. Foi para `--fg-subtle` (5,21:1 e 5,31:1) e continua
nitidamente mais apagado que o dia do mês corrente, que é o trabalho dele.
Antes de vestir um elemento com o fantasma: é grande, ou não é texto?

Auditar é mecânico: percorrer os elementos com texto, compor o fundo real
(inclusive `background-image` de tinte) e comparar com o mínimo — 4,5:1, ou
3:1 em texto grande. Nenhuma tela, nem as camadas, pode sair com falha.

**Placeholder é texto**, e entra na mesma conta: o cinza padrão do navegador
dá 4,33:1 no tema claro, abaixo do mínimo. Ele usa `--fg-subtle`, com
`opacity: 1` — o Firefox aplica uma opacidade própria por cima da cor.

**Tinte translúcido precisa de fundo próprio por baixo.** A célula tingida fica
sobre o fundo do grid, que é a hairline: sem repintar `--bg` embaixo, o tinte
compõe sobre o cinza e escurece a célula — foi o que derrubou o rótulo para
4,2:1 no claro. Duas camadas: `background-color: var(--bg)` e o tinte como
`background-image`.

**Nada de cor fixa no CSS fora do `:root`.** Todo `rgba()` derivado — tinte do
pill ativo, borda de foco, hover de linha, polegar da barra, backdrop da camada,
borda de ação destrutiva — é token, senão o tema claro herda tons calculados
para fundo escuro. O teste é mecânico: fora dos blocos `:root` não pode sobrar
nenhum `#hex` nem `rgba()`.

Cada tema declara **`color-scheme`** (`dark` / `light`). É o que faz o navegador
pintar o que o CSS não alcança: a lista suspensa do `select`, o calendário
nativo, o preenchimento automático. Sem isso o popup do `select` vem do sistema
e destoa. O fundo dessas superfícies flutuantes é o token `--superficie`, que
não é `--bg`: popup precisa se destacar da página, não se fundir com ela.

A escolha do usuário vive em `localStorage` sob chave própria (é preferência de
aparelho, não dado do app) e é aplicada **antes da primeira pintura**, num
script no topo; sem isso quem usa claro vê um lampejo escuro. Sem escolha
salva, segue `prefers-color-scheme`.

### Rolagem

A barra padrão do sistema é clara e tem trilho — num fundo `--bg` ela vira a
coisa mais brilhante da tela. Toda área que rola, **inclusive a página**, usa a
mesma barra fina, sem trilho:

```css
* { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.14) transparent; }
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.14); border-radius: var(--r-pill);
  border: 3px solid transparent; background-clip: content-box;   /* polegar de 4px */
}
```

**Rolador horizontal reserva 10px de calha no rodapé.** Onde a barra é
flutuante — o padrão em celular e no Chrome com barras sobrepostas —, o polegar
é desenhado POR CIMA do conteúdo, encostado na base do contêiner. Se a última
linha do conteúdo for texto, ele leva um risco no meio: no gráfico de fluxo,
medido em 320px, os nomes dos meses iam de 221 a 234 e a base do contêiner
também era 234. No tema escuro o polegar se perde no fundo e ninguém nota; no
claro é uma barra escura atravessando "SET" e "OUT". A calha é `padding-bottom`
no próprio contêiner que rola, não margem no conteúdo.

## 3. Tipografia

- Família: **Space Grotesk** (400/500/600), fallback `system-ui, sans-serif`.
- Nunca usar Inter, Roboto ou Arial — descaracterizam o padrão.
- Dois pesos por tela, no máximo três.

| Papel | Tamanho | Peso | Cor | Extra |
|---|---|---|---|---|
| Número herói (saldo, valor) | 38–46px | 500 | `--fg` | centavos em `--fg-ghost` |
| Título de tela | 17px | 600 | `--fg` | |
| Rótulo de seção | 10px | 400 | `--fg-subtle` | `uppercase`, `letter-spacing: 0.16em` |
| Item de lista | 13px | 400 | `--fg` | |
| Metadado | 11px | 400 | `--fg-subtle` | |
| Valor em lista | 13px | 400 | `--fg` | tabular |

Todo número recebe:

```css
.num { font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
```

Formatação BRL: `R$ 1.234,56`. Em listas densas o prefixo `R$` pode cair —
`−218,40`, `+8.200,00` — desde que a moeda apareça no cabeçalho do bloco.
Sinal de menos é o caractere `−` (U+2212), não hífen.

## 4. Grid e espaçamento

- Largura base 390px, padding lateral **20px**, topo 24px, base 28–32px.
- Espaçamento em múltiplos de 4. Gaps recorrentes: `6` (dentro de um item),
  `12` (entre itens), `14–16` (dentro de um bloco), `22–24` (entre blocos).
- Sempre `display: flex` / `grid` com `gap`. Nunca margens soltas entre irmãos.
- Grids de 2 ou 3 colunas: `repeat(N, minmax(0, 1fr))`.

## 5. Anatomia dos componentes

**Rótulo de seção** — `.lbl`: 10px, uppercase, tracking 0.16em, `--fg-subtle`.
Abre todo bloco. Quando há um total, ele vai alinhado à direita na mesma linha,
em 12px `--fg-muted`.

**Bloco de valor herói** — rótulo, número 38–46px, e à direita na linha de base
a variação (seta 10px + percentual, verde ou vermelho). Abaixo, uma linha de
contexto em 12px `--fg-subtle`.

**Sparkline** — largura total, altura 56px, traço 1.6px em `--accent`,
preenchimento em gradiente vertical do acento a 22% → 0%, ponto final marcado
com círculo de 3.2px preenchido com `--bg` e contorno do acento.

**Grid segmentado** (receitas/despesas, pares de métrica) — `display: grid`,
`gap: 1px`, fundo `--hairline-strong`, borda 1px, raio 12px, `overflow: hidden`;
cada célula com `background: var(--bg)` e padding 14/16. As hairlines nascem do
gap — não desenhe bordas internas.

A célula de **receita** e a de **despesa** fogem do fundo neutro: fundo tingido
a 10% do próprio sinal (`--seg-receita-fundo`, `--seg-despesa-fundo`) e valor
na cor cheia (`--seg-receita-tinta`, `--seg-despesa-tinta`). É a exceção da
regra do verde/vermelho, não uma violação: aqui a cor **é** o sinal de valor,
e o par lado a lado é justamente o que o usuário compara. A célula de
**resultado** usa as mesmas duas cores, escolhidas no render pelo sinal do
total (positivo → receita, negativo → despesa, zero → neutro). As demais
células do grid seguem `--bg`. No tema claro o verde e o vermelho
de token ficam em 4,4:1 sobre o tinte, abaixo do mínimo de texto, então as
tintas escurecem um passo só aqui (5,29:1 e 5,08:1); no escuro são os tokens.

**Uma fatura aceita vários pagamentos.** Pagar menos que o total deixa a fatura
em aberto pelo restante, e o botão da tela de cartões vira "Pagar o restante",
já sugerindo o saldo. Cada pagamento é uma linha na lista de pagamentos, com
editar e desfazer próprios. Só some quando não há mais saldo.

**O vencimento pode estar no mês seguinte ao do fechamento, e quase sempre
está.** A fatura de referência (ano, mês) vence no dia do vencimento *daquele*
mês **só se esse dia cair depois do fechamento**; senão, vence no mês seguinte.
Num cartão que fecha dia 25 e vence dia 5 — o arranjo mais comum do mercado —
supor os dois no mesmo mês põe o vencimento 20 dias antes do fechamento: a
fatura nasce vencida, pula de `Aberta` direto para `Atrasada` sem nunca passar
por `Fechada`, e o rotativo começa a transportar saldo cedo demais. Os dois
dias entram **já limitados ao último dia do mês**, senão "fecha 29 e vence 30"
em fevereiro vira 28 e 28, e o empate manda o vencimento para o mesmo dia do
fechamento em vez de março. Essa conta mora num lugar só de cada lado
(`datasDoCiclo` no backend, `vencimentoDaFatura` no app) e os dois lados têm de
concordar: quando divergiram, a tela dizia "Atrasada" para uma fatura que a API
considerava fechada.

**Fatura paga em parte é "Transportada", não "meio aberta".** Depois do
**vencimento**, o que sobrou vira saldo da fatura seguinte (rotativo, sem juros
aqui). A etiqueta da fatura de origem é `Transportada` (classe `warn`), a
célula "Em aberto" dela vai a zero e um `field-help` diz para onde o valor foi.
Na fatura de destino o saldo entra como **linha de lançamento** — dot em
`--warning`, "Saldo transportado de <mês>" — para a lista somar o confirmado.
No extrato, a linha do mês de origem vale o que foi pago, com o restante no
metadado. Fatura sem pagamento nenhum não transporta: ela continua atrasada no
mês em que venceu. O corte é o vencimento, não o fechamento — antes dele o
usuário ainda está pagando aquela fatura.

**Em que mês uma compra de cartão entra é escolha do usuário, e a escolha vale
para TODOS os relatórios.** A mesma compra pode ser contada em dois meses
diferentes, e as duas contagens estão certas — dependem da pergunta:

| modo | a pergunta | a data que vale |
| --- | --- | --- |
| `fatura` (padrão) | quando o dinheiro sai? | vencimento da fatura em que a compra caiu |
| `compra` | quando eu gastei? | a data do próprio lançamento |

Compra de 20/09 numa fatura que vence em 17/10: por fatura ela pesa em outubro
e **não aparece** em setembro; por compra pesa em setembro e **não aparece** em
outubro. Nunca nos dois.

**O que não pode é o app responder às duas ao mesmo tempo** — e respondia. O
total de outubro dizia R$ 80,00 e o mapa de calor do mesmo outubro dizia
R$ 0,00, porque o total contava pela fatura e o mapa pela data da compra. Uma
função só decide (`dataDeRelatorio`), e total, extrato, faixa de meses, mapa de
calor e ranking de categorias leem dela. Regra prática: nenhuma tela de
relatório lê `t.data` direto.

**A escolha vale para os relatórios, não para o extrato.** A tela de
Lançamentos é o razão de caixa — o que sai da conta e quando —, e ali a fatura
aparece **sempre** no vencimento dela, com as compras dentro. Fazer essa tela
seguir o regime apagava a fatura de outubro sem colocar nada no lugar: quem
abria o mês via "nenhum lançamento" e uma fatura que existe.

**A consequência tem de estar escrita, não descoberta.** No modo por compra,
o Resumo e o extrato mostram despesas diferentes para o mesmo mês — um conta a
compra no dia dela, o outro conta a fatura no vencimento. São perguntas
diferentes, e as duas respostas estão certas. Por isso o extrato ganha uma
linha de ajuda enquanto esse modo está ligado, dizendo exatamente isso. Número
que diverge sem explicação é defeito; número que diverge com o motivo ao lado
é informação.

**Compra no cartão nasce confirmada; lançamento de conta nasce previsto.** A
diferença é o que já aconteceu. Passar o cartão **é** o gasto: quando a pessoa
registra, o dinheiro já foi comprometido e a fatura já o espera — pedir uma
segunda confirmação é pedir para confirmar duas vezes a mesma coisa. Na conta
é outra história: "pagar o aluguel dia 10" costuma ser plano, e previsto é o
estado honesto até o dinheiro sair.

**Controle que não faz nada some.** Na antecipação de parcelas, a caixa
"lançar como confirmadas" só aparece quando **alguma das parcelas que vão se
mover** ainda está prevista. Como parcelamento no cartão nasce confirmado, na
maior parte das vezes ela era um controle sem efeito — e controle sem efeito
ensina a ignorar os que têm. A decisão é por seleção, não por série: mudar a
quantidade pode fazer a caixa voltar, porque a próxima parcela pode ser
prevista. A frase da ajuda que falava dela some junto, senão sobra explicação
sem objeto.

**Parcelamento no cartão segue a mesma lógica até o fim: TODAS as parcelas
nascem confirmadas.** A compra aconteceu uma vez só; as doze parcelas são ela
repartida, e cada fatura futura já as espera — é assim que a fatura do cartão
funciona no mundo real. Deixar as seguintes previstas pedia para confirmar,
mês a mês, uma dívida que já existe.

A regra é do **cartão**, não do parcelamento em si. Repetição fixa (aluguel,
assinatura) continua com só a primeira confirmada: a cobrança do mês que vem
ainda não aconteceu. E parcelamento na conta também — ali o dinheiro sai
parcela a parcela, e as próximas ainda não saíram.

Continua sendo escolha, não imposição: a caixa está lá para desmarcar a compra
que ainda vai acontecer (a assinatura que renova semana que vem), e desmarcar
vale para a série inteira. E **escolha
feita não se desfaz sozinha** — trocar o destino depois de marcar à mão
respeita a marcação; só reabrir o formulário volta ao padrão.

O ditado segue a mesma regra e pela mesma razão, senão a mesma compra nasceria
confirmada digitada e prevista falada. Indício de futuro ainda manda mais:
"vou comprar no cartão" é previsto. Isso exige que as listas de passado e
futuro tenham os mesmos verbos — foi ao aplicar este padrão que apareceu a
falta de "vou gastar" e "vou comprar", que existiam só no passado.

**O texto da caixa muda com o destino**: na conta o confirmado mexe no saldo,
no cartão mexe na fatura. Dizer "afeta o saldo" nos dois casos ensinava errado
metade das vezes.

**O saldo previsto é acumulado, não uma fotografia do mês.** Ele soma TODO
previsto com data até o fim do mês olhado — não só o daquele mês — e desconta
TODA fatura ainda em aberto que vence até lá. O previsto de um mês tem de
começar onde o do mês anterior terminou.

Olhando só o mês corrente, a projeção se reinicia a cada virada: quem tinha
60 previstos em outubro e 50 em novembro via **1.230** em novembro (saldo
confirmado menos os 50) em vez de **1.170**, porque os 60 de outubro
evaporavam. Pior: num mês sem nenhum previsto, o "previsto" voltava a ser
igual ao "atual", como se as dívidas dos meses anteriores tivessem sido
pagas.

**Previsto que ficou para trás continua contando.** Uma despesa prevista em
agosto que ninguém confirmou ainda é dinheiro que deve sair — some da
projeção só quando for confirmada ou apagada. É a mesma regra da fatura sem
pagamento, que continua atrasada em vez de desaparecer.

**O saldo não muda de regime.** Saldo é caixa sempre — o dinheiro sai da conta
no vencimento, escolha o usuário o que escolher. Por isso as faturas continuam
sendo calculadas no modo por compra, mesmo sem virar linha: quem precisa delas
ali é o saldo previsto.

**A fatura entra no mês em que VENCE**, não no mês de referência dela. Num
cartão que fecha 25 e vence 5, a fatura de setembro sai da conta em outubro, e
é em outubro que ela pesa — senão a linha apareceria em setembro com data de
outubro, e o agrupamento por dia do extrato mentiria.

**O total é a soma das linhas listadas.** "Receitas" e "Despesas" somam
exatamente o que a lista daquele mês mostra — inclusive a fatura em aberto,
pelo valor da própria linha. Um mês com fatura listada e "Despesas R$ 0,00"
é bug, não recorte: a tela não pode dizer duas coisas sobre o mesmo mês.

**Vocabulário**: a tela fala **Receitas** e **Despesas**, nunca "entradas" e
"saídas" — o mesmo par usado nas categorias, no filtro do extrato e no mapa de
calor. Os ids internos podem continuar `entradas`/`saidas`.

**Barra de categoria** — rótulo e valor na mesma linha (`align-items: baseline`),
barra de 4px abaixo. Escala **relativa ao maior item**: a maior categoria ocupa
100% e as demais proporcionalmente. Opacidade decrescente (1 → 0.8 → 0.62 →
0.46 → 0.32) mantém a ordem legível sem inventar cores.

**Barra de progresso** (meta, orçamento) — 4–6px, trilho `--track`, raio pill.
Acento quando saudável, `--warning` a partir de 80% do limite.

**O trilho tem dois vizinhos e os dois contam.** Contra o fundo ele diz onde a
barra começa e acaba; contra o preenchimento, quanto dela está cheio. Sem o
primeiro não há proporção nenhuma para ler — era o caso em 0,05, com o trilho
em 1,10:1: via-se um pedaço de cor flutuando, sem "de quanto". Mas subir o
trilho **aproxima** ele do preenchimento, então o ganho de um lado sai do
outro, e o valor certo é o que mantém os dois legíveis, não o que maximiza um.

No escuro dá para ter tudo: trilho em **3,51:1** e preenchimentos em 4,76
(neutro), 3,84 (acento) e 3,29 (aviso) contra ele.

No claro **não existe** esse valor, e o teto é do palette. Ele foi levantado
em duas etapas, e a segunda mostra como se sobe um teto desses: não pelo
trilho, mas tirando da frente quem limita.

Primeiro o limite era o ocre `--warning`, que rende só 4,69:1 contra a página
— com o preenchimento tão claro, não sobrava espaço entre os dois. O trilho
parou em 1,53:1. Depois o ocre **do preenchimento da barra** ganhou token
próprio (`--bar-aviso`, 6,06:1) e saiu da frente; o limite passou a ser o
acento da marca, e o trilho subiu para **1,85:1**, com todo preenchimento
ainda acima de 3:1 contra ele (neutro 8,38, acento 3,03, ocre 3,27).

**O ocre escuro vale só na barra**: em texto, borda e etiqueta o aviso segue
`--warning`. É o mesmo remédio do verde e do vermelho da célula tingida —
escurecer um passo, e só no lugar onde o fundo exige.

Daqui em diante quem limita é o **acento**, em 5,62:1. Escurecê-lo só na
barra deixaria o preenchimento diferente do acento do resto da tela, e isso
custa mais do que os 0,2 de contraste que se ganharia. É onde a conta para.

Área grande e chapada rende mais do que o número sugere: o limiar de 3:1 foi
escrito para detalhe fino, e uma faixa de 4px atravessando a coluna se vê.

**Ditado** (lançar por voz) — camada própria, aberta pelo menu do botão
flutuante. Botão de microfone de 56px (a mesma medida do flutuante), contorno
em `--accent-borda`; ouvindo, ele inverte: fundo `--accent`, ícone
`--accent-ink`. Ao lado, uma linha de estado em 12px `--fg-subtle` que diz o
que está acontecendo ("Ouvindo… pode falar", "Microfone bloqueado aqui").

**Na primeira abertura do app**, uma camada curta ("Lançar falando") explica
para que serve o microfone e oferece `Permitir microfone` / `Agora não`. Ela é
um **convite, não o alerta**: o alerta é do navegador e nasce do clique no
botão primário. Pedir direto no carregamento não funciona — sem gesto o
navegador ignora ou nega de vez, e o usuário perde a chance para sempre.
A camada aparece **uma vez**: a resposta fica em `state.permissoes`, e quem já
concedeu ou já negou nem chega a vê-la. Negando, ela troca o texto pelo
caminho de reabrir e o botão vira "Tentar de novo" — sem insistir de novo em
aberturas seguintes.

**Data falada entende o futuro.** "Amanhã", "depois de amanhã", "em 3 dias",
"daqui 3 dias" e "daqui a 3 dias" (as duas formas, com ou sem o "a"), "daqui
uns 5 dias", "dentro de 10 dias", "daqui um mês", "semana que vem", "mês que
vem", "na sexta", "fim do mês", "dia 5 do mês que vem". O prazo pode vir em
número ou por extenso, e "uns/umas" é só arredondamento de fala — não muda a
conta. Sem ano dito, mês por extenso vira a ocorrência
**mais próxima de hoje** (dizer "5 de janeiro" em setembro é falar do janeiro
que vem); "dia 5" seco só anda para frente quando a frase é de futuro
("pagarei dia 5" no dia 20 é o mês seguinte; "gastei dia 5" é este mês).

**O tempo do verbo decide a situação, e os dois lados são simétricos.**
Passado é dinheiro que já se moveu e nasce **confirmado** — "recebi", "caiu",
"entrou", "gastei", "comprei", "paguei". Futuro nasce **previsto** — "vou
receber", "receberei", "a receber", "pagarei", "vou pagar", "vai cair". Falta
de simetria aqui é defeito: o app entendia "paguei" e não "recebi", e toda
entrada nascia prevista esperando uma confirmação que a frase já tinha dado.
Forma de pagamento dita ("no pix", "no débito") também confirma, mas ela é
reforço, não a única pista.

**Receita ou despesa é outra pergunta, e ela também é simétrica.** Quem recebe
registra receita tendo o dinheiro chegado ou não: "recebi", "caiu", "entrou",
"ganhei" e, do outro lado, "vou receber", "receberei", "a receber", "vão me
pagar", "vai cair", "vai entrar". O tempo do verbo muda a *situação*, nunca o
*tipo* — tratar o futuro como despesa jogava a receita prevista para o lado
errado do saldo. As duas listas moram juntas no código pelo mesmo motivo:
separadas, uma cresce e a outra fica para trás.

**Data no futuro manda mais que o verbo**: o lançamento nasce **previsto**,
mesmo em "pago no pix amanhã" — dinheiro que ainda vai sair não afeta o saldo
de hoje. **Prazo não é valor**, e o descarte olha a vizinhança de cada número,
não o número solto: em "daqui 10 dias 10 BRL" o primeiro 10 é prazo e o
segundo é dinheiro. Procurar o valor no texto inteiro fazia os dois sumirem
juntos quando calhavam de ser iguais.

**A permissão é pedida no clique, nunca ao abrir a tela.** O alerta do
navegador só nasce de um gesto do usuário, em origem segura (https ou
localhost), e o app pede explicitamente (`getUserMedia`) antes de ligar o
reconhecimento — assim dá para separar "negado pelo usuário" de "a página
hospedeira não libera" e mostrar o caminho certo em cada caso, num
`field-help` abaixo do campo. Se o navegador já souber que está negado
(`navigator.permissions`), o aviso aparece antes do clique: botão mudo é pior
que recado claro.

Abaixo, **sempre**, o campo de texto com a frase: reconhecimento de voz pode
não existir no navegador ou ser bloqueado pela página que hospeda o app, e o
campo é a saída — dá para escrever ou usar o ditado do teclado. Nunca deixe a
camada depender só do microfone.

Depois vem "O que eu entendi": uma linha por campo (tipo, valor, conta ou
cartão, categoria, fatura, data, situação), com o valor à direita. O que não
foi identificado aparece em `--warning`, com o texto "não identificado" — o
app não inventa dado. Dois botões: `.ghost` "Revisar no formulário", que abre
o lançamento pré-preenchido, e o primário "Lançar", ativo só quando valor,
destino e categoria foram entendidos. **Ditado nunca grava direto sem o
usuário ver o que foi entendido.**

**Tela de entrada** (login / criar conta) — é a única tela sem navegação: sem
barra inferior, sem trilho, sem botão flutuante. Coluna única de até 400px,
centralizada na altura: marca em `--accent` (ícone + "Gestor Financeiro"),
título de 24px/500, uma linha de contexto em `--fg-muted`, e os pills
`Entrar` / `Criar conta` trocando o formulário no lugar — nada de duas telas.
Campos pela anatomia da seção 11; "Criar conta" acrescenta nome e repetir a
senha. A senha tem botão `Mostrar/Ocultar` ao lado (`.ghost`, 44px), e o
primário ocupa a largura da coluna. "Esqueci minha senha" é um link sublinhado
em `--fg-muted`, não um botão — mas com 44px de altura, porque parecer texto
não o isenta da regra 4. O texto de exemplo da senha é curto ("Sua senha",
"Crie uma senha") para caber ao lado do "Mostrar" em 320px; a regra completa
vai na linha de ajuda. No celular pequeno (320 × 568) o botão Entrar tem de
estar visível sem rolar.

Regras que não se negociam aqui:
- **A senha nunca vai para o estado nem para o armazenamento.** Ela existe
  só no campo enquanto a pessoa digita e é apagada ao enviar e ao sair.
  Quem confere senha é o servidor; o app guarda apenas "há sessão ou não".
- `autocomplete` certo em cada campo (`email`, `current-password` para entrar,
  `new-password` para criar): é o que deixa o gerenciador de senhas do
  aparelho preencher e sugerir senha forte.
- Validação antes de enviar, com a mesma regra do servidor (e-mail válido;
  senha de 8+ caracteres com letras e números; confirmação igual), numa linha
  de erro em `--negative` acima do botão — nunca um alerta.
- **Criar conta começa vazio**: sem os dados de exemplo, só com as
  categorias padrão, e o Resumo abre nos primeiros passos. Entrar mantém o que
  já existe. Sair volta a esta tela com o e-mail preenchido.
- **Com servidor, a sessão é do servidor.** O botão mostra o que está
  acontecendo ("Entrando…", desabilitado) e o erro exibido é a mensagem da
  API — nunca um texto inventado no cliente. Senha recusada é apagada do
  campo. O token de acesso fica só em memória; a sessão longa é um cookie
  httpOnly que a página não lê. Ao abrir, o app tenta renovar em silêncio e só
  então decide entre a tela de entrada e o Resumo. A linha de aviso no pé da
  tela diz em qual modo o app está (servidor local ou demonstração).
- "Esqueci minha senha" usa o e-mail já digitado e responde sempre a mesma
  coisa ("se houver uma conta com esse e-mail…"), exista a conta ou não.
- **"Instalar no aparelho"** aparece abaixo de "Esqueci minha senha", com o
  mesmo tratamento de link (44px de altura). Só existe quando dá para
  instalar de fato: o navegador avisou que o app é instalável, ou é iPhone,
  onde esse aviso nunca vem e o texto explica o caminho do Safari. Some quando
  o app já está instalado e na tela de senha nova — ali a pessoa veio de um
  link do e-mail resolver uma coisa só. O mesmo convite se repete no menu do
  perfil, para quem já entrou; são dois momentos de decisão, não dois botões
  concorrentes.

**Lançamento pendente de sincronização** — lançar é a única ação que funciona
sem internet: ela fica numa fila no aparelho e sobe sozinha quando a conexão
volta. Na tela, o pendente é um lançamento como os outros — entra no extrato,
no mapa de calor e nos totais —, com uma `.tag warn` "pendente" ao lado do
nome e o motivo no metadado ("aguardando conexão"). Recusado pelo servidor
troca para `.tag danger` "recusado" com a mensagem dele. A única ação
disponível nessa linha é remover da fila: confirmar, editar e antecipar
dependem de um id que ainda não existe. Um `.banner` no topo diz quantos
estão esperando e oferece "Tentar agora" quando há rede.

**A fila tenta sozinha de três formas**, porque só uma não cobre a vida real:
no evento de reconexão do aparelho, ao voltar para a frente
(`visibilitychange` — o gesto de tirar o celular do bolso) e de minuto em
minuto enquanto houver algo esperando. O evento de reconexão sozinho não basta:
servidor que caiu e voltou não avisa ninguém, e o plano grátis do Render dorme.

**O saldo conta o que está na fila.** O número da conta vem do servidor, que
ainda não viu esses lançamentos; somá-los na exibição é o que evita a tela
dizer R$ 1.000 depois de a pessoa gastar R$ 97,50 na padaria sem sinal.

**Primeiros passos** (onboarding) — primeiro bloco do Resumo (`--i:0`), com
`.lbl` "Primeiros passos", contador "2 de 5" no `.lbl-row`, barra de progresso
e uma linha por passo. Cada linha: marcador redondo de 20px à esquerda
(hairline vazio quando pendente, contorno e check em `--positive` quando
feito), nome, metadado de uma linha e, à direita, um `.ghost` com o verbo do
passo ("Criar conta") ou a palavra "Feito" em `--positive`. Sem cor de alerta:
passo pendente é convite, não erro.

O estado de cada passo é **derivado dos dados**, nunca de um flag salvo:
apagar a única conta devolve o passo para pendente, que é a verdade da tela.
"Criar uma categoria sua" olha por categoria não-padrão — as que já vêm no app
não contam, senão o passo nasceria feito. **Cumpridos os cinco, o bloco some**
sozinho e o Resumo volta ao normal.

**Faixa de meses** (resultado mês a mês, no Resumo) — uma coluna por mês, em
rolagem horizontal. Cada coluna tem, de cima para baixo: o mês em escala de
`.lbl` (`SET/26`), **o resultado do mês no meio, que é o que a faixa tem a
dizer** — `+3.000,00` em `--positive`, `−600,00` em `--negative` — e embaixo,
miúdos, os dois totais que o formam (receitas em cima, despesas embaixo, em
`valorCurto`). Mês sem nenhum lançamento mostra `—` em `--fg-subtle`: **não
inventa `R$ 0,00`**, porque zero é um resultado e "não houve nada" é outro.

**E contam o pendente de sincronização**, pela mesma razão que o saldo conta:
para quem lançou, o dinheiro já se moveu — a fila é problema do app, não do
usuário. O lançamento offline entra em `state.transactions` como qualquer
outro, então a faixa o soma sem saber que ele é especial. O aviso de que algo
ainda não subiu é do `.banner` no topo e da etiqueta na linha do extrato, não
da faixa: repetir o recado em cada coluna seria ruído.

**Os totais contam o previsto.** Receitas e despesas do mês inteiro, confirmadas
ou não — é a pergunta "como vai fechar este mês", não "como fechou até agora".
E saem de `totaisDoMes`, **a mesma fonte do bloco de Receitas/Despesas logo
abaixo**: somar por fora aqui faria a faixa e o detalhe do mês dizerem números
diferentes sobre o mesmo mês, que é exatamente o que a regra do total proíbe.

**Sem card.** As colunas se separam por hairline vertical, como a lista se
separa por hairline horizontal (regra 1), e o mês escolhido é marcado como a
aba ativa — filete de `--accent` na borda de cima, nome em `--accent` — nunca
por caixa com fundo e contorno próprios.

**Os três estados da coluna seguem o padrão de controle do app**: repouso sem
filete, hover em `--accent-borda`, escolhido no acento cheio e com o nome do
mês também em `--accent`. O hover nasceu na hairline de leitura e ficava em
1,40:1 no tema claro — apontar o mês não dizia nada. É a mesma regra do dia do
calendário e do botão secundário; escrevê-la num lugar não dispensa aplicá-la
no componente seguinte.

**A largura da coluna é medida, não escolhida.** O CSS dá um piso (84px, 76px
abaixo de 380) e `renderFaixaMeses` sobe esse piso até caber o resultado mais
largo do período. Com largura fixa, um valor de cinco dígitos — `+12.330,05`,
74px de texto em 60px úteis — vazava por cima da coluna vizinha e apagava a
hairline entre as duas: três meses seguidos viravam uma fileira de dígitos
colados. O número não pode quebrar linha (`nowrap`) nem encolher, então quem
cede é a coluna; a faixa rola de qualquer jeito, e uma coluna mais larga não
custa nada. A medida é refeita no `resize` porque a fonte da coluna muda em
380px: medida no retrato de um celular de 375 e não refeita, ela ficaria curta
demais na paisagem do mesmo aparelho.

**O movimento é esmaecido**: a faixa tem máscara de gradiente nas duas pontas,
então o mês que entra e sai da vista desaparece em vez de ser cortado por uma
borda dura. É também o que conta que há mais mês para os lados, sem gastar uma
seta nova na tela — as do bloco de baixo continuam servindo ao teclado. Quando
tudo cabe, a máscara sai (`.inteira`): senão ela apagaria o primeiro e o último
mês sem haver nada para rolar.

**A barra de rolagem fica** — a regra de rolagem vale aqui como em toda área
que rola. Escondê-la parecia limpeza e era perda: no celular ela é sobreposta e
não custa altura nenhuma, mas no desktop é a única alça que o mouse tem para
correr a faixa sem trocar de mês. Ela reserva 10px embaixo, fina e sem trilho,
como no resto do app.

**A faixa também navega**: tocar numa coluna troca o mês do bloco abaixo, do
mapa de calor e das categorias, e a faixa rola sozinha para deixar o mês
escolhido no centro. A janela vai de onze meses atrás até o mês que vem, e
estica para conter o mês escolhido — quem navegar para longe pelas setas
continua se vendo nela.

**Falta pagar e receber** (no Resumo) — o **consolidado**, no mesmo par de
células de Receitas/Despesas logo acima: `A vencer` num tinte de aviso, `Vencidas`
no de despesa. O analítico não mora aqui. Com a lista inteira aberta, oito linhas
de pendência empurravam o mapa de calor e as categorias para fora da primeira
tela — e Resumo é consulta rápida, não relatório.

**O número grande de cada célula é o que falta PAGAR**, porque é ele que cobra
uma ação. O que há a receber desce para a linha de baixo (`.seg-sub`), e some
quando é zero. Os dois nunca viram um líquido: receber R$ 450 não quita uma
fatura de R$ 845, e um número só esconderia as duas obrigações.

**Lado vazio mostra `—`, não `R$ 0,00`** — a mesma regra da faixa de meses, e
aqui a ausência é notícia boa: o metadado passa a dizer "nada a vencer". A
célula fica no lugar de qualquer jeito, porque o par não pode encolher e mudar
o desenho do bloco conforme o mês. **Sem nada pendente dos dois lados, o bloco
inteiro some**, como o de primeiros passos.

**A célula é `button` e abre a tela de Pendências.** A seta no canto do rótulo é
o que conta isso — no toque não há hover, e uma célula que abre tela não pode
parecer igual a uma que só mostra número. Sendo `button`, ela desfaz o que o
navegador põe por conta própria (fonte, borda, alinhamento) e ganha anel de foco
para o teclado.

**Pendências** (tela filha do Resumo) — o analítico. Não tem aba na barra de
baixo: entra pelo bloco consolidado e volta pelo botão do topo, e enquanto
está aberta **a aba acesa é a do pai** (`TELA_PAI`), senão as cinco apagariam e
a pessoa ficaria sem saber de onde veio.

**Duas colunas só quando cada uma cabe a linha inteira.** A linha de Pendências
é a mais pesada do app — nome, meta de quatro partes (data · distância ·
categoria · conta), valor e três ações. Num desktop de 800 a coluna saía com
303px e sobravam **121px para o nome**: 9 de 9 metas cortadas, a pior faltando
175px. Medido coluna por coluna: 303 corta 9 metas, 403 corta 7, 453 corta 2,
503 corta 0 metas mas ainda 1 nome. E a coluna **não passa de 544px**, porque
`--content-max` é 1120 — ela só fica inteira quando o conteúdo bate no teto, o
que acontece em 1120 + 72 de trilho + 64 de calha ≈ 1256. Daí o ponto de quebra
em **1280**: duas colunas só quando cada uma já está no seu tamanho máximo.
Abaixo disso, uma coluna dá de 600 a 1050px por linha, que é folga de sobra, e o
filete do `.rail` sai junto — em coluna única ele não divide nada. Categorias usa
o mesmo `split--par` e fica de fora: a linha dela é leve e cabe em 353px (medido,
0 de 19 cortadas em 900).

**O conteúdo mora num `.split--par`.** No desktop a `.view` é um grid de duas
colunas com o cabeçalho na linha 1 e o `.split` na linha 2: uma tela cujos
blocos ficam soltos cai na auto-colocação desse grid, e foi o que aconteceu na
primeira versão — a navegação de mês foi parar no canto do cabeçalho por
acidente e a segunda coluna, dimensionada por `auto`, estourava a página em
1,6px num celular deitado de 812. Com `split--par` as duas seções têm colunas
iguais, separadas pela hairline do `.rail`, e a navegação de mês vira `.v-cta` de
propósito. No celular o `.split` volta a ser coluna única e tudo empilha na
ordem de leitura: voltar, título, mês, A vencer, Vencidas.

**O mês é o mesmo objeto do Resumo** (`resumoMes`), não uma cópia: as setas das
duas telas e a faixa de meses passam todas por `mudarMesDoResumo`, que redesenha
as duas. Espalhar a lista de telas a redesenhar por cada handler foi como a tela
filha nasceu dessincronizada na primeira versão.

**As seções vêm na ordem do par, não na da urgência**: `A vencer` e depois
`Vencidas`, porque quem tocou na célula da esquerda tem que cair na seção da
esquerda. Dentro de cada uma a ordem é a da urgência — o atraso maior primeiro,
o vencimento mais próximo primeiro. Cada linha é a `.row` de sempre, e a meta diz
**data, distância em palavras e origem**: `12/08/2026 · há 48 dias · Fatura de
agosto`. A distância é o que a data crua não diz; ler "há 48 dias" é imediato,
converter "12/08" para dias de atraso é conta. Seção vazia mostra `.empty`, não
some: a ausência de vencidas é justamente o que a pessoa quer ver.

**A linha traz as mesmas ações da tela de Lançamentos** — confirmar, editar,
excluir — e **pelos mesmos `data-*`**: quem trata o clique é o `acoesDeLista` de
sempre, ouvindo em `.content`, que já cobre esta tela. Handlers próprios aqui
criariam duas verdades sobre o que "confirmar" faz. Resolver na tela de consulta
é o ponto: quem veio ver o que falta não devia ter de ir a outro lugar para
fazer.

**O que muda por tipo de pendência**: lançamento de conta leva as três ações;
lançamento ainda na fila de envio leva só "remover da fila" (ele não existe no
servidor, então confirmar e editar não têm o que tocar — mesma regra do
extrato); e **fatura não se confirma nem se edita: se paga**. O botão dela abre a
camada de pagamento já apontada para aquela fatura, e a linha inteira continua
levando para a fatura no cartão, como no extrato.

**`abrirPagarFatura` ajusta `cartaoSel` e `faturaMes` antes de abrir**, porque é
deles que o envio do formulário tira a fatura a pagar. Chamada de outra tela sem
mover os dois, ela lançaria o pagamento na fatura que estava selecionada em
Cartões — outra.

**No celular a linha quebra**, como a de conta e a de fatura já quebram: nome e
meta na primeira linha, valor e ações na segunda. O critério é o do extrato ao
contrário — lá a lista é para **varrer**, e alongar a linha custaria caro; aqui
ela é para **resolver**, e são poucas linhas por vez. Com tudo numa linha só, a
meta desta tela (data · distância · categoria · conta) mais as três ações
deixavam **74px** para o nome: "Aluguel receb…", "IPTU parcela …". Quebrando:
0 de 9 nomes cortados, 0 de 9 metas cortadas, linha de 104px.

**O ponto colorido vai dentro do `.row-title`, não ao lado do `.row-main`.** Como
irmão dele, na linha que quebra o ponto sobrava sozinho numa primeira linha e a
altura ia a 118px.

**Só entra o que não está confirmado**, porque a pergunta é o que falta fazer, e
confirmado já foi feito.

**O cartão entra pela fatura, nunca pelas compras.** Somar as compras do cartão
*e* a fatura contaria o mesmo dinheiro duas vezes; somar só as compras diria um
vencimento que não existe (a compra de 20/08 não vence em 20/08). Então a compra
no cartão nunca aparece solta: o que aparece é a fatura em aberto, com o valor de
`emAberto` e a data do vencimento — a mesma data que a tela de Lançamentos mostra,
independente da configuração de relatório.

**A lista olha do mês escolhido para trás**, como o saldo previsto: conta de
setembro que ninguém pagou continua na lista em outubro e em novembro. Some em
agosto, porque agosto não sabe de setembro; mudar de mês não faz o tempo passar,
então um lançamento de 25/09 segue em "a vencer" mesmo olhando outubro — vencido
é o que passou de **hoje**, não do mês na tela.

**O ano sai do rótulo da fatura quando é o mesmo do vencimento** (`Fatura de
agosto`, não `Fatura de agosto 2026`): a data ao lado já carrega o ano, e a
linha da meta é o primeiro texto a ser cortado numa tela de 320px. Ele volta
quando muda — fatura de dezembro que vence em janeiro diz `Fatura de dezembro
de 2026`, senão o rótulo mentiria por omissão.

**O tinte de aviso é um token à parte** (`--seg-aviso-fundo`/`--seg-aviso-tinta`).
No escuro o ocre de token já rende 9,89:1 sobre o próprio tinte e não precisa de
versão própria; no claro ele dá 4,35:1, abaixo do mínimo de texto, e escurece um
passo para 5,86:1 — mesmo remédio que o verde e o vermelho da célula tingida já
usavam, e valendo só ali: o aviso em texto, borda e etiqueta não muda.

**O anel de foco é do app, não do navegador.** Sem regra própria cada navegador
pinta o seu: no Chrome saía um laranja que não existe nesta paleta, e com
`outline: auto` a **cor nem é medível** — o navegador pinta um anel que não é o
`outlineColor` computado, então o auditor mecânico não tem o que ler. Agora todo
botão (`.icon-btn`, `.ghost`, `.pill`, `.link-ghost`) usa o mesmo anel da célula
do Resumo: `2px solid var(--accent)` com 2px de deslocamento. Medido: 5,62:1 no
claro, 13,47:1 no escuro, e 2px de folga entre os anéis de duas ações vizinhas —
o deslocamento cabe no vão de 6px sem encostar no vizinho.

**O hover do destrutivo tem que ACENDER o contorno, não apagá-lo.**
`--negative-borda` valia 0,35 no claro (1,71:1) e 0,40 no escuro (1,98:1) —
**mais fraco que a borda em repouso** (3,00 e 3,03). Apontar o "excluir" deixava
o botão com o contorno mais apagado da tela, justo no botão em que o retorno
importa mais. É o mesmo erro que o `--warning-forte` já tinha cometido, e a
regra que ele deixou escrita continua valendo: um estado ativo nunca pode render
menos que o estado de repouso do mesmo controle. Agora 0,75 no claro (3,41:1) e
0,67 no escuro (3,66:1), ao lado dos 3,38 e 3,63 do `--accent-borda` — o botão
destrutivo responde ao mouse com a mesma força que os outros, só na cor dele.

**Como medir um estado que só existe sob o ponteiro**: o painel de pré-visualização
impõe CSP que bloqueia estilo injetado (atributo `style` e `<style>` novo), e o
ponteiro sintético não segura `:hover` até o script rodar. Então o valor sai das
**cores vivas dos tokens** lidas da página (`getPropertyValue`) com a **regra de
hover lida do CSSOM** — nada transcrito à mão —, e a aplicação do pseudo se
confere por screenshot. Um detalhe do varredor: desde o CSS aninhado, uma regra
comum também expõe `cssRules` (vazio); tratar isso como "é um grupo" faz a
varredura pular o seletor de todas elas e concluir, errado, que nenhuma regra de
hover existe.

**A lista tem teto; os números, não.** A lista olha do mês escolhido para trás,
então ela não tem limite natural: quem nunca confirma nada chega a setembro de
2026 com tudo que deixou em aberto desde 2024. Medido com **2.952 lançamentos**:
**706 linhas** numa seção só e **42.676px de rolagem** — 42 metros de uma lista
que existe para ser resolvida e que, nesse tamanho, não se resolve. O teto de
**50 por seção** mantém as mais urgentes à mão (cada seção já vem na sua ordem
de urgência) e o resto vira uma linha de texto: *"Mostrando as 50 mais urgentes.
Faltam mais 656, somados no total acima."* Nenhum número mente — o total do
cabeçalho e a contagem do subtítulo seguem somando tudo. Depois do teto:
**3.360px** de página e 856 nós na tela, contra 11.449.

**Uma varredura por desenho.** `pendenciasDoMes` percorre TODOS os lançamentos e,
para cada cartão, monta todas as faturas. Com 3 mil lançamentos ela custa ~87ms —
e era chamada **duas vezes** por desenho: uma pelo bloco do Resumo, outra pela
tela. Medido: trocar de mês levava **165ms**; com uma varredura só, **72ms**. O
resultado fica lembrado por mês, e quem esquece é `renderAll` — por onde passa
toda mudança de dado. Navegar entre meses só troca a chave.

**A fatura é calculada uma vez por desenho.** `faturasDoCartao` é pura em
relação ao estado — com os mesmos lançamentos e pagamentos devolve sempre a mesma
coisa — e era recalculada dezenas de vezes por desenho com entrada idêntica: só a
faixa de meses pede 13 meses × 3 cartões, e cada pedido varre a lista inteira.
Medido com 2.952 lançamentos: **475µs por cartão**, e a faixa inteira em **35ms**.

O cache vive **apenas dentro de `comCacheDeFaturas`**, que embrulha um desenho.
Isso é seguro por construção e não por vigilância: um desenho é síncrono, então o
estado não muda no meio dele. Fora do desenho não há cache, e qualquer chamada
solta continua lendo o estado de agora — nada de invalidar à mão em cada lugar
que mexe em lançamento, que é onde esse tipo de cache apodrece. Três testes
prendem o contrato: dentro do desenho a fatura é objeto único, fora dele um
lançamento novo aparece na hora, e o desenho seguinte enxerga o estado novo.

No banco de ensaio, um desenho inteiro (faixa + totais + pendências + saldos)
caiu de **42,5ms para 5,0ms**.

**Tela escondida não se desenha.** Trocar o mês redesenhava Resumo *e* Pendências,
quem quer que estivesse à vista. `irPara` já redesenha as duas ao entrar nelas, o
que torna seguro pular a que está escondida — e são 37ms (Resumo) e 11ms
(Pendências) que ninguém precisava pagar pela tela que não está olhando.
Categorias fica de fora da regra, porque `irPara` **não** a redesenha: pulá-la
deixaria a tela com o mês antigo.

**O resultado, com 2.952 lançamentos e 3 cartões** (mediana de 7 trocas de mês):

| caminho | antes | depois |
|---|---|---|
| trocar mês em Pendências | 165ms | **21ms** |
| trocar mês no Resumo | 163ms | **44ms** |
| trocar mês no Extrato (controle) | 12ms | 12ms |

O que sobra não tem mais gargalo único: está espalhado entre montar as 13 colunas
da faixa (10,5ms), a série do saldo (7,5ms), as barras de categoria (7,9ms) e o
traçado do spark (6,3ms) — trabalho de DOM, não varredura repetida.

**Valor que não cabe desce de linha, não encolhe nem é cortado.** Na célula de
131px de uma tela de 320, `+333.148,36` vazava 26px para fora e era cortado na
borda. O par "a receber / valor" passa a quebrar em duas linhas quando precisa —
número cortado é número errado, e abreviar um valor que o resto da célula mostra
por extenso seria inventar duas unidades na mesma caixa. Com valores normais, e
em qualquer largura de desktop, a linha segue uma só. (O valor grande da célula
quebrando em duas linhas a 320 é de `.seg-val` e vem de antes: Receitas e
Despesas fazem o mesmo.)

**Enquanto o pedido está no ar, o botão fica ocupado.** Entre o toque e a
resposta há uma ida à rede — **offline, até 3 segundos** — e nesse intervalo o
botão ficava exatamente igual: nada dizia que o toque tinha sido registrado.
Medido: **3 toques, 3 pedidos**, e um aviso de "sem conexão" atrás do outro.
Agora `comServidor` desabilita o botão que disparou a ação e marca
`aria-busy` até a resposta voltar; `.icon-btn:disabled` usa o mesmo apagado dos
outros controles desabilitados do app, que diz "não toque de novo" sem inventar
sinal novo. Depois: **4 toques, 1 pedido**.

O botão chega até lá por uma variável que `acoesDeLista` deposita e
`comServidor` consome — é o único jeito de ele saber que o pedido é dele sem
passar o elemento por dentro de cada função de negócio. E o `finally` só
reabilita o que ainda está na página (`isConnected`): `renderAll` troca o HTML
da lista, e o botão de antes pode já não existir.

**Offline, a tela de Pendências continua inteira.** O service worker serve a
casca, os dados da última sessão abrem do aparelho, e o bloco do Resumo conta o
que está na fila — lançamento offline entra em `state.transactions` como
qualquer outro. A linha que ainda não subiu leva a etiqueta `pendente`, o
metadado "pendente, aguardando conexão" e **só "remover da fila"**: confirmar e
editar não têm o que tocar no servidor. Remover da fila funciona offline, porque
é local. Pagar fatura abre a camada (também local) mas o envio avisa "sem
conexão" e **não mexe na fatura** — nada de pagamento fantasma. Quando a conexão
volta, a fila sobe sozinha e a linha troca as próprias ações, sem navegação.

**Sessão morta é uma terceira categoria de erro**, ao lado de "sem rede" e de
erro comum, e as três terminam diferente. Sem rede, o pedido não chegou a ser
julgado: a pessoa fica onde está e tenta de novo depois. Erro comum vira aviso e
a tela continua. **Sessão negada pelo servidor não tem como dar certo numa
segunda tentativa** — insistir só repete o 401 a cada toque —, então o app
encerra a sessão e leva para a entrada, com o e-mail preenchido e o motivo
escrito no campo de erro.

O sintoma que expôs isso: tocar em "confirmar" abria uma camada dizendo
**"Unauthorized"**, em inglês, e deixava a pessoa na mesma tela, onde todo botão
repetiria o mesmo. `Unauthorized` e `Forbidden` são o texto padrão do framework;
`mensagemDaApi` passa a traduzi-los por status, e qualquer mensagem própria do
servidor continua passando inteira — ela costuma ser mais específica que o
genérico.

**Fluxo de caixa** (tela própria, item do trilho) — o relatório do ano, em
quatro seções numeradas: entradas e saídas mês a mês, para onde foi o dinheiro,
para onde vai e os insights. Ela segue a referência visual que o pedido trouxe,
e a referência já era quase esta casa: fundo, acento e Space Grotesk batem com
os tokens daqui.

**Os números vêm prontos do servidor.** `GET /reports/cashflow?year=` entrega
tudo calculado; a tela só desenha. Refazer a conta aqui criaria duas verdades
sobre o mesmo dinheiro, e a que divergisse seria descoberta pelo usuário, não
por nós. A consequência é assumida: **sem servidor a tela não inventa um
relatório** — no modo demonstração e offline ela diz por que está vazia. É o
oposto do resto do app, que funciona no aparelho, e é a troca certa aqui.

**A única tela com duas famílias tipográficas.** A referência pede JetBrains
Mono em todo número, e ela entra só por `.view[data-view="fluxo"]`. Em todas as
outras telas o número é Space Grotesk com `tabular-nums`, que já alinha coluna.
Fica isolada de propósito: some com a regra e os números voltam ao padrão sem
mexer em mais nada. O `@import` mora no topo da folha junto com o da Space
Grotesk — no meio dela o navegador o ignora em silêncio, e a tela cairia na
fonte de texto sem avisar.

**Barra prevista é tracejada, não mais clara.** `repeating-linear-gradient` a
135° com borda `dashed`, nas duas cores. Clarear a barra diria "menos", e o
previsto não é menos: é outra natureza. A divisória de hoje é a mesma ideia, uma
linha tracejada entre o último mês realizado e o primeiro previsto.

**As duas escalas do gráfico são uma só.** A altura é relativa ao maior valor do
ano, receita ou despesa — escalas separadas fariam uma despesa de 8 mil parecer
do tamanho de uma receita de 12 mil.

**Barra horizontal na categoria, nunca rosca.** Comparar comprimentos é
imediato; comparar ângulos não é. E o preenchimento usa `--bar-aviso`, não
`--warning`: ele encosta no TRILHO, não na página, e contra o trilho o ocre de
texto dá 2,53:1 no tema claro.

**Cinco indicadores numa grade de duas ou três colunas deixam um buraco**, e o
buraco aparece — a célula vazia tem o mesmo fundo das outras e vira uma caixa
escura sem conteúdo. O último estica para fechar a linha. Em cinco colunas eles
já fecham sozinhos, e esticar ali quebraria a grade.

**A barra de abas usa `minmax(0, 1fr)`, não `1fr`.** O atalho significa
`minmax(auto, 1fr)`, e `auto` deixa a coluna crescer além da sua fatia para
caber o rótulo: com seis abas em 375px a soma dava 388 e a última ficava cortada
pela borda da tela — e com cinco já cortava em 320. O zero prende cada aba à sua
fatia, e quem cede é o texto, com reticências. Nome cortado com reticências
ainda se lê; aba empurrada para fora da tela, não.

**Mapa de calor** (gastos ou receitas por dia do mês) — grade de 7 colunas começando na
**segunda** (S T Q Q S S D, cabeçalho no estilo do `.lbl`), gap de 2px, uma
célula por dia do mês e células vazias invisíveis antes do dia 1. Cada célula
tem no mínimo 52px de altura, raio 8px, número do dia no topo (11px
`--fg-muted`) e valor abreviado embaixo (11px/500: `214`, `2,7k`, `12k`).
Dia sem gasto mostra só o número, sem fundo.

**Modo "Ambos": duas faixas na mesma célula.** Uma cor só não conta duas
histórias — misturar as duas rampas num tinte único seria inventar um terceiro
significado. Então cada lado ganha **a sua faixa, a sua rampa e a sua escala**:
receita em cima, gasto embaixo, dentro da mesma célula.

**O que separa os dois não é a cor, é a posição** — e ela é fixa. Um dia sem
receita mantém a faixa de cima vazia e transparente em vez de subir a de baixo:
se a posição dançasse, um dia só de gastos pareceria um dia só de receitas. Sobre
a posição vêm a rampa e o sinal escrito, três canais para a mesma informação, o
que mantém a leitura de pé para quem não distingue verde de vermelho.

**Cada faixa tem a sua escala.** Uma escala comum faria a receita de um mês de
salário apagar todos os gastos, e o mapa existe justamente para comparar dia com
dia **dentro de cada lado**.

**A tinta do número é neutra, não a cor do sinal.** Número verde sobre tinte
verde é a mesma cor disputando dois trabalhos: medido, a receita em `--positive`
cai para **4,15:1** no primeiro degrau do tema claro e **2,44:1** no terceiro; o
gasto em `--negative`, para 2,43:1. O tinte carrega a intensidade; quem diz o
lado são a posição, a rampa e o sinal. É a mesma regra que o número do dia já
segue, e com ela os 13 valores da tela passam nos dois temas (pior caso 4,94:1).

**Abaixo de 380 o sinal sai.** Numa tela de 320 a célula tem 36px e sobram 24
para o texto: com o sinal, `−890` virava `−89` e `+5,2k` virava `+5,2`. **Número
cortado é número errado** — pior que número sem sinal. Acima de 380 ele volta
(medido: em 375 a célula tem 44px e cabe inteiro), e a legenda do rodapé mantém
`+` e `−` em qualquer largura.

**O rodapé ganha duas escalas**, uma por faixa, cada uma com o seu próprio
máximo — é o que traduz intensidade em valor no lado certo. A ponta de baixo,
que nos mapas de um tipo só é `0`, vira o sinal: duas escalas empilhadas
distinguidas apenas pela cor deixariam sem resposta quem não separa as duas, e o
sinal ocupa o mesmo caractere que o zero ocupava.

**"Maior movimento", não "maior gasto".** No modo Ambos o dia de destaque é o de
maior movimento (entradas + saídas); eleger um dos lados ali seria escolher por
quem lê. E o total do bloco segue a régua do app: os dois sentidos lado a lado,
nunca somados num líquido.

A intensidade é **o acento em 5 degraus de opacidade** (`--calor-1` a
`--calor-5`), relativa ao maior dia do mês — a mesma lógica da barra de
categoria. Uma cor só: nada de laranja, vermelho ou escala arco-íris, porque
laranja é alerta e vermelho/verde é sinal de valor. Os degraus são tokens
por tema, e a cor do texto também (`--calor-tinta-4`, `--calor-tinta-5`):
nos degraus fortes o fundo fica claro (escuro) demais e o texto troca para
`--accent-ink`. Onde exatamente troca foi **medido** para 4,5:1, não estimado.

**Um mapa por tela, com filtro.** Despesas e receitas não ganham dois mapas
empilhados — o usuário teria de descobrir qual cor é qual. Abaixo do
`.lbl-row` vai uma linha de pills (`Despesas` / `Receitas`, `aria-pressed`)
que troca o que o mapa mostra. O rótulo do bloco é fixo — **"Mapa de calor"**,
o nome do componente, não do recorte: quem diz o tipo são as pills e o rodapé
("Maior gasto" / "Maior receita"). O total do mês acompanha o filtro. Trocar
de mês mantém o filtro.

Com Receitas, a rampa passa para `--positive` (`.calor--receita`, tokens
`--calor-rec-1` a `--calor-rec-5`): o verde é exatamente o sinal de valor que
a regra reserva — entrada. Mesmos degraus de opacidade e mesma troca de tinta
(medida de novo sobre o verde). Despesas **não** vai para vermelho: saída
herda `--fg` na linha de transação, e uma grade vermelha leria como alerta.

Embaixo, uma linha de rodapé 11px `--fg-subtle`: o maior dia à esquerda e, à
direita, a legenda da escala (`0 ▪▪▪▪▪ 2,8k`); ela pode quebrar para a linha
de baixo em tela estreita (`flex-wrap`), mas a legenda nunca encolhe.
**Abaixo de 380px** a célula fica com ~36px e o valor sai cortado com o padding
e a fonte do desktop: lá o padding cai para 5/4px e a fonte para 10px. Valor
cortado é pior que valor pequeno. O total do mês vai no `.lbl-row`.
Hoje ganha borda `--controle-borda`, como no calendário. Nessa borda o que
conta é o lado de **fora**: por dentro ela encosta no tinte da célula, e no
degrau cheio nenhum neutro fecha 3:1 ali — nem `--fg`, que é o hover. Por
fora ela encosta na fresta de 2px que mostra `--bg`, e é lá que ela rende de
3,8:1 a 13:1. O caso que estava cego era o oposto: **dia sem gasto**, sem
tinte nenhum, onde a hairline dava 1,19:1 e a marca simplesmente não existia.

Comportamento: só o dia com gasto é focável (`tabindex=0`). Passar o mouse ou
focar mostra uma dica flutuante (fundo `--superficie`, borda
`--hairline-strong`, sem sombra) com `Dia 23 · R$ 2.841,00 · 3 lançamentos`,
o valor em destaque, e quanto daquilo é previsto. A dica nunca é o único
caminho para o número: o valor abreviado está na célula e o texto completo
vai em `.sr-only` para leitor de tela.

**Clicar no dia** (ou Enter/Espaço com foco nele) abre uma camada com os
lançamentos daquele dia — exatamente os que a célula somou, do maior para o
menor. Título é a data por extenso (`Terça-feira, 8 de setembro de 2026`) e o
contexto diz qual filtro estava ativo e repete a dica
(`Receitas · R$ 3.200,00 · 1 lançamento`). As linhas são a
**linha de transação do extrato, com as mesmas ações** (confirmar, editar,
excluir); a camada fica aberta enquanto o usuário age nela e se atualiza a
cada mudança. Dia sem gasto não é clicável.

O que entra: toda despesa do mês **confirmada ou prevista**, pela data do
gasto — compra no cartão cai no dia da compra. Pagamento de fatura fica de
fora (é o mesmo dinheiro das compras, contaria duas vezes) e estorno não é
gasto. Por isso o total bate com "Maiores despesas"; pode diferir de "Despesas"
do mês, que representa o cartão pela fatura (uma linha) e não pelas compras.
No mapa de receitas entra toda receita confirmada ou prevista,
inclusive estorno de cartão — o mesmo critério de "Maiores receitas", com que
o total bate.

**Linha com etiqueta no celular** — a linha tem dot, nome, etiqueta, valor e
até três ações. Nessa largura, algo tem de sair: sai a **etiqueta de estado**
(`prevista` no lançamento, `padrão` na categoria), que desce para o metadado, e
o nome recupera o dobro de espaço ("Projeto Clie…" volta a ser "Projeto
Cliente XPTO"; "Alimentação" para de ser cortado). Não saem as ações, e elas
**não** descem para uma segunda linha: isso encompridaria a lista inteira
(60px → 102px por linha) numa tela feita para varrer. O ícone de ação vai a
36px com `::after` de 44px — desenho pequeno, alvo grande. Etiqueta de status
de fatura (`Fechada`, `Atrasada`) **fica**: ali ela é o dado da linha.

**O `inset` do `::after` é −5px, não −4.** O `.icon-btn` é `display: grid` com
borda de 1px, e o bloco de contenção de um filho absoluto é a caixa de
**padding** — 34px, não os 36 da caixa de borda. Com −4 o alvo saía 34+8 = 42, e
o comentário que prometia 44 estava errado pela mesma conta que já tinha furado
na alça de arraste. Com −5: 34+10 = 44. **O alvo se mede por toque**
(`elementFromPoint` varrendo a partir do centro), não pela caixa do elemento:
medida na caixa, a seta diz 36 e some com o `::after`; medida por toque, ela diz
se o dedo acerta.

**E o halo não pode invadir o vizinho.** Numa fila de ações o vão é de 6px, então
cabem 3px para cada lado (`.row-acoes .icon-btn::after { inset: -5px -3px }`):
42 de largura, 44 de altura. **Alvos sobrepostos são piores que alvo curto** — o
toque no vão acerta o botão errado, e do lado do "excluir" isso apaga o que a
pessoa não pediu. É a mesma razão pela qual a alça de arraste não estica 11px
para cada lado. Onde a linha quebra e o vão pode crescer para 10px — as listas de
Pendências —, o halo volta a `-5px` por todos os lados e o alvo fecha 44×44.
Medido: nenhum vão ambíguo (um ponto 1px além da borda de um botão nunca cai no
seguinte).

**Linha de conta no celular** — é a única com **quatro** ações. Com elas e o
saldo na mesma linha sobram ~40px para o nome ("XP Investimentos" vira "XP
I…"), então aqui a linha quebra: nome e metadado em cima, saldo à esquerda e
ações à direita embaixo. Vale porque são poucas contas por usuário — no
extrato, com dezenas de linhas, a mesma quebra custaria caro demais.

**Calendário do formulário ocupa a linha inteira no celular.** Dividindo a
linha com o botão "Hoje", a grade fica com ~226px e o dia vira um alvo de
31px — metade de um dedo. No telefone o calendário toma 100% da largura e o
botão desce para a linha seguinte, alinhado à direita: o dia volta a 44px,
como manda a regra 4.

**Campo de formulário no celular usa 16px.** Abaixo disso o Safari do iPhone
dá zoom ao focar e deixa a tela deslocada. É o único texto que muda de
tamanho no telefone; a altura de 44px e o resto da tipografia continuam.

**Grid segmentado de três células no celular** — com ~105px por célula, o
padding e a fonte do desktop cortam um valor de cinco dígitos. Só esse grid
encolhe: padding 12/10 e valor em 15px (14px abaixo de 380px). O par
receitas/despesas, que tem duas células largas, continua no tamanho normal.

**Linha de transação** — dot de 6px (cor = categoria) · nome 13px ·
metadado 11px `--fg-subtle` · valor 13px tabular à direita. Padding vertical 13px,
`border-top` hairline. Entrada em `--positive`; saída herda `--fg`.

**Lista hierárquica** — pai e filha são ambos linha; o que separa é um recuo de
20px **no conteúdo**, não na linha. A hairline continua correndo a largura
inteira, senão a lista parece quebrada em duas. O pai mostra o total
consolidado (o dele mais o das filhas) e, no metadado, quantas filhas tem.
Dois níveis bastam: com três, o seletor que consome essa árvore vira labirinto.

**Alça de ordenação** — seis pontos de 12px em `--fg-ghost`, à esquerda do nome.
Em dispositivo com mouse (`@media (hover: hover)`) ela só aparece ao passar
sobre a linha: ordem é preferência que se ajusta de vez em quando, não algo
para ficar na tela o tempo todo. Em toque não há hover, então lá ela é
sempre visível. O desenho tem 18px, mas o alvo de toque chega a 44px por um
`::after` (regra 4). Durante o arraste a linha ganha o tinte de seleção
(`--accent-fraco`) — sem sombra, sem elevação.

Três regras de comportamento:
- **Só a alça arrasta**, nunca a linha inteira: a linha pode ter clique
  próprio (abrir a fatura), e soltar um arraste não pode virar navegação.
- **Pointer Events, não a API de drag do HTML**, que não funciona em toque. A
  captura do ponteiro fica no contêiner, que não se move — na linha, mover o
  nó no DOM soltaria a captura no meio do gesto.
- **Teclado também reordena**: seta para cima/baixo na alça, com o foco
  devolvido a ela depois do render.
- **Em lista hierárquica, o item só troca de lugar com irmãos.** Cada pai é um
  bloco que contém as filhas: arrastar o pai leva o bloco inteiro, e uma filha
  arrastada para cima do próprio pai para como primeira filha — nunca escapa
  para virar raiz. Mudar de pai é edição, não arraste. No bloco, o hover acende
  só a alça da linha sob o mouse, não a do pai e de todas as filhas juntas.

**Pill de filtro** — 12px, padding 7/14, raio pill, borda `--controle-borda`,
texto `--fg-muted`. Ativa: fundo `--accent-fraco`, borda `--accent-borda`,
texto `--accent`. As duas bordas são medidas (seção de contraste): o pill é
controle, não rótulo.

**Botão primário** — altura 52px, raio 14px, fundo `--accent`, texto
`--accent-ink` 15px/600. Um por tela.

**Botão flutuante** — variante do primário para a ação que o app inteiro
oferece o tempo todo (lançar). Círculo de 56px em `--accent`, ícone de 24px,
fixo no canto inferior direito: 20px da borda no mobile e 32px no desktop. No
mobile fica **acima da barra inferior** (`bottom: 72px`), e o conteúdo ganha
padding de rodapé suficiente para nada terminar atrás dele.

O flutuante **é** o primário da tela: onde ele existe, nenhum outro botão de
acento aparece. A ação secundária de criação daquela tela (novo cartão, nova
categoria) vira `.ghost` no cabeçalho. Separação do conteúdo vem do contraste
do acento — sem sombra, mantendo a regra 3.

**Despesa e Receita são o único par em que o pill ligado não usa o acento.** Em
todos os outros, acento quer dizer "é esta a escolhida" e mais nada. Aqui a
escolha **é o sinal do dinheiro**, e o app inteiro já ensina que vermelho sai e
verde entra — da linha do extrato à faixa do mapa de calor. Pintar de acento
seria guardar essa informação justamente no momento em que ela está sendo
decidida. Vale nos dois lugares em que o par aparece: tipo do lançamento e tipo
da categoria, que são o mesmo controle fazendo a mesma pergunta.

**A tinta é a `--seg-*-tinta`, não o token de sinal cru.** São a mesma cor um
passo mais escura, e existem porque vermelho e verde de token não sobrevivem ao
próprio tinte no tema claro: medido aqui, o verde cru deu **4,38:1** e o
vermelho **4,55:1** — um reprovado e o outro a 0,05 do limite. Com elas, 5,50 e
5,27. No escuro as duas apontam para o token cru, então lá nada muda.

**E a borda do verde subiu para 0,80.** O contorno de um pill ligado encosta em
dois fundos e precisa de 3:1 nos **dois**: a página por fora e o próprio tinte
por dentro — a mesma conta que o `--accent-borda` já documenta. Em 0,74 o verde
dava 3,09 por fora mas **2,88 por dentro**; o piso medido é 0,77. O vermelho já
passava em 0,75 (3,41 e 3,14).

**`.ghost--acento` — o degrau entre os dois.** Numa tela que já tem primário (o
flutuante), a ação principal do conteúdo não pode virar um segundo acento cheio,
mas também não pode ficar no mesmo cinza de tudo. O meio-termo é acento **em
contorno**: fundo `--accent-fraco`, borda `--accent-borda`, texto `--accent` — a
mesma receita que o pill ligado já usa para dizer "é esta aqui". Contorno não
disputa com preenchimento, então a regra acima continua de pé.

**E ele segue a ação que dá para fazer.** Na fatura, `Pagar fatura` leva o acento
enquanto há o que pagar; quitada (ou com o resto transportado), pagar deixa de
ser opção e o acento passa para `Adicionar lançamento`, que é o que sobra. Os
dois no mesmo cinza faziam a tela inteira parecer desligada.

**A borda dele é de 2px, e isso não é enfeite.** O destaque não pode depender só
do matiz. Medido em escala de cinza no tema claro: o texto em `--accent` fica em
**12,6** de luminância contra os **7,7** do ghost neutro — numa página clara,
mais claro é mais fraco, então o botão em destaque saía **menos** presente que o
normal, e quem não separa o teal do cinza lia o contrário do pretendido. (No
escuro a conta se inverte sozinha: 66,8 contra 41,9, e ali mais claro é mais
forte.) A borda dobrada devolve o peso por **área** — 1,48× de contorno —, que
sobrevive a qualquer percepção de cor e não mexe na altura, porque a caixa é
`border-box`. É o mesmo filete de 2px que a coluna do mês e o item do trilho já
usam para dizer "é esta".

**O anel de foco continua legível sobre ela.** Anel e borda são a mesma família
de cor, mas o `outline-offset` de 2px deixa a página aparecer entre os dois, e é
essa fresta que os separa — o foco se anuncia acrescentando uma segunda linha,
não trocando a cor da primeira.

**Desabilitado é 0,65 de opacidade, não 0,4.** Desabilitado precisa dizer "isto
não dá agora", e para dizer tem que ser lido. Em 0,4 o rótulo caía para
**1,95:1** no tema claro e 2,28:1 no escuro, e a borda sumia em 1,41:1 — não é
apagado, é ilegível, e foi assim que uma fatura quitada passou a parecer uma
tela quebrada. Medido: o piso para o rótulo fechar 3:1 é 0,62 no claro (o tema
mais exigente aqui); 0,65 dá **3,26:1 no claro e 4,23:1 no escuro**. A borda fica
em ~1,9:1 **de propósito** — a regra do desabilitado é justamente poder afrouxar
o contorno, e é ele que separa o controle morto do vivo.

**Ícones** — SVG inline, stroke 1.7–1.8, grid 24, tamanho de render 13–20px,
`currentColor` sempre que possível. Nunca emoji.

### Tabela densa

Tabela aqui é lista com colunas — sem zebra, sem borda externa, sem fundo
próprio (regra 1). A linha se separa por `border-top` de hairline, o cabeçalho
por uma hairline mais firme, e o `tfoot` do total por `--hairline-strong`.

**Toda coluna a partir da segunda carrega seu próprio vão: 12px, 8px abaixo de
480.** O vão vai no `th + th` / `td + td`, nunca nas bordas da tabela, para a
primeira e a última coluna continuarem alinhadas com o resto do bloco. Sem ele a
célula ainda cabe e nada transborda — então **nenhuma checagem de truncamento
acusa** —, mas dois números encostam e `27.400` ao lado de `43,1%` é lido como
`27.40043,1%`. Em 320px foi exatamente o que aconteceu.

**Quando a largura acaba, cede primeiro a coluna que repete.** Uma barra de
participação ao lado da coluna "%" é a tradução visual do mesmo número: abaixo
de 480 ela sai e o número fica. Informação duplicada cede antes de qualquer
número, e nunca se encolhe a fonte para caber.

**Cor de valor com sinal se aplica pela célula, não pela classe solta.**
`.tabela td { color: var(--fg) }` tem especificidade (0,1,1) e vence
`.fx-pos { color: var(--positive) }` (0,1,0) **por especificidade, não por
ordem** — escrever a regra depois não adianta. A forma correta é
`.tabela td.fx-pos`. Escritas soltas, as quatro regras de sinal desta tela
foram CSS morto desde o primeiro commit: 27 valores saíam na tinta neutra e
ninguém reclamava, porque a tela não parecia quebrada — parecia sem cor.
Medido depois de corrigir, contra a página: positivo 4,87 (claro) / 10,51
(escuro), negativo 5,10 / 7,10, ocre 4,69 / 11,56, acento 5,62 / 13,47.

### Tela que depende do servidor

Tela calculada no servidor não inventa um resultado local quando a rede cai:
ela esconde o conteúdo e diz o que houve. Esconder é parte da regra — deixar o
relatório anterior na tela faz número velho passar por número de agora.

**Todo aviso de falha carrega a saída.** Falha de rede ou de servidor mostra um
botão de nova tentativa; ano sem lançamento não mostra, porque ali não há o que
tentar. O botão é `ghost`, nunca de acento: onde o flutuante existe, ele é o
primário da tela.

**E a tela se cura sozinha quando a rede volta.** O relatório é pedido ao
ENTRAR na tela, então quem ficou parado nela durante a queda continuava lendo
"não foi possível carregar" com o servidor já de volta — medido, com o evento
`online` disparado e tudo. Um ouvinte de `online` refaz o pedido, e só quando
duas coisas valem ao mesmo tempo: a tela está visível e o último desenho
falhou. Sem as duas, o evento vira pedido à toa em toda tela do app.

O evento `online` só dispara quando é o **aparelho** que recupera a rede.
Servidor que caiu e voltou não avisa ninguém — e é exatamente para esse caso
que o botão existe.

## 6. Regras que não se negociam

1. Nenhum card com fundo próprio em bloco de conteúdo.
2. Nenhum gradiente colorido de fundo. O único gradiente é o do sparkline.
3. Nenhuma sombra. Profundidade vem de hairline e opacidade.
4. Alvo de toque mínimo de 44px em qualquer elemento interativo.
5. Contraste mínimo 4.5:1 em texto — `--fg-subtle` só para metadado não essencial.
6. Nada de status bar ou teclado do sistema desenhados na tela.
7. Sem emoji, sem dado decorativo: se um número não muda uma decisão, ele sai.

## 7. Movimento

Discreto e único por tela: fade-in escalonado dos blocos (60ms de atraso entre
eles) e uma animação de entrada no gráfico principal. Transições de estado em
160–200ms, `ease-out`. Nenhuma micro-interação espalhada.

## 8. Alturas de referência

Telas de conteúdo rolam; a tela de lançamento cabe inteira no aparelho.

| Tela | Frame |
|---|---|
| Resumo | 390 × 1180 |
| Extrato | 390 × 1060 |
| Detalhe de categoria | 390 × 980 |
| Nova transação | 390 × 910 (sem rolagem) |

---

## 9. Desktop

O mobile é a base. Desktop **não é a coluna de 390px centralizada** numa tela
larga — isso troca densidade por respiro, que é o oposto do princípio. A
linguagem atravessa inteira (tokens, tipografia, hairlines, ausência de card,
anatomia de barra e lista); o que muda é só a composição.

Em tela larga o "sem cards" perde o apoio natural da coluna única: blocos sem
fundo tendem a flutuar e o agrupamento se desfaz. A resposta **não** é
reintroduzir caixa — é trilho: uma hairline vertical nascida do grid, mais
espaço entre blocos, e largura de leitura limitada.

### 9.1 Tokens adicionais

```css
:root {
  --nav-w:       240px;   /* navegação lateral a partir de 1180px */
  --nav-w-min:    72px;   /* 768–1179px: só ícones */
  --pad-x:        32px;   /* padding lateral do conteúdo */
  --col-gap:      32px;   /* espaço entre colunas */
  --blk-gap:      32px;   /* espaço entre blocos (24px no mobile) */
  --content-max: 1120px;  /* largura máxima do conteúdo */
  --read-max:     720px;  /* largura máxima de bloco em lista de texto */
}
```

Breakpoints: `< 768px` coluna única (seções 1–8, sem alteração) · `768–1179px`
navegação em ícones + até 2 colunas · `≥ 1180px` navegação completa + até 3
colunas.

### 9.2 Shell

A navegação é um **trilho fixo de 72px que abre para 240px no hover** — nunca
some por completo: ícone sem rótulo ainda orienta, trilho vazio não. Ela é
`position: fixed` e a coluna do grid mantém os 72px reservados, para a expansão
**sobrepor** o conteúdo em vez de reflowar a página a cada passada de mouse.

```css
.shell { display: grid; grid-template-columns: var(--nav-w-min) minmax(0,1fr); min-height: 100vh; }
@media (max-width: 767px) { .shell { grid-template-columns: minmax(0,1fr); } }

.nav {
  position: fixed; top: 0; left: 0; bottom: 0; z-index: 7;
  width: var(--nav-w-min); overflow-x: hidden; overflow-y: auto;
  background: var(--bg); border-right: 1px solid var(--hairline);
  padding: 32px 0; display: flex; flex-direction: column; gap: 4px;
  transition: width 180ms ease-out;
}
.nav:hover, .nav:focus-within { width: var(--nav-w); transition-delay: 120ms; }

/* rótulo some por opacidade e é recortado pelo overflow — com display:none
   ele apareceria de estalo no fim da animação, fora de sincronia */
.nav-item span, .nav-foot-name, .nav-brand span { opacity: 0; white-space: nowrap; transition: opacity 140ms ease-out; }
.nav:hover .nav-item span, .nav:focus-within .nav-item span { opacity: 1; }
.nav-item { height: 44px; display: flex; align-items: center; gap: 12px; padding: 0 20px;
            font-size: 13px; color: var(--fg-subtle); border-left: 2px solid transparent; }
.nav-item.on { color: var(--fg); border-left-color: var(--accent); }
.nav-item svg { width: 18px; height: 18px; }

.content { padding: 32px var(--pad-x) 40px; }
.content-inner { max-width: var(--content-max); margin: 0 auto;
                 display: flex; flex-direction: column; gap: var(--blk-gap); }
```

A navegação **não tem fundo próprio** — o que a separa do conteúdo é a
`border-right` hairline. Ela declara `background: var(--bg)` apenas porque
sobrepõe o conteúdo ao abrir; é a cor da página, não uma superfície nova. O
item ativo é marcado por barra de 2px em `--accent` e texto em `--fg`, nunca
por fundo preenchido.

O hover tem **120ms de atraso para abrir e nenhum para fechar**: sem isso,
atravessar a borda esquerda da tela abriria o trilho sem querer. O padding
lateral dos itens é o mesmo nos dois estados (26px), para o ícone não saltar
quando a largura muda. `:focus-within` abre junto, senão a navegação por
teclado percorre rótulos invisíveis.

### 9.3 Colunas e trilho

```css
.split { display: grid; grid-template-columns: minmax(0,1.6fr) minmax(320px,1fr);
         gap: var(--col-gap); align-items: stretch; }
.grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: var(--col-gap); }
.grid-3 { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: var(--col-gap); }

.rail { border-left: 1px solid var(--hairline); padding-left: var(--col-gap); }
```

O trilho é `border-left` na coluna da direita e vive do `align-items: stretch`
do grid — nunca é um elemento desenhado, nunca tem altura fixa. Máximo de
**dois trilhos verticais por tela**; acima disso vira moldura.

### 9.4 O que escala

| Papel | Mobile | Desktop |
|---|---|---|
| Número herói | 38–46px | 52–60px |
| Título de tela | 17px | 20px |
| Rótulo de seção | 10px | 10px |
| Item de lista | 13px | 13px |
| Metadado | 11px | 11px |
| Valor em lista | 13px | 13px |
| Sparkline (altura) | 56px | 96px |
| Barras (`--bar-h`) | 4px | 4px |

Só o herói, o título de tela e o sparkline crescem. Aumentar texto de lista
reduz linhas visíveis — é perda de informação, não conforto.

### 9.5 Componentes que mudam de forma

**Linha de transação** — ganha colunas explícitas em vez de empilhar metadado:

```css
@media (min-width: 768px) {
  .row { display: grid; grid-template-columns: 64px minmax(0,1fr) 128px 132px 112px;
         align-items: center; gap: 16px; }   /* data · nome · categoria · origem · valor */
  .row-val { text-align: right; }
}
```

As faixas somam 436px + 64px de gap, o que deixa ~220px para o nome dentro do
`--read-max`. Não alargue as colunas fixas: quem precisa de espaço é o nome.

Lista em colunas **exige cabeçalho**, na escala de `.lbl`, e ele **gruda no
topo** (`position: sticky; top: 0`) com `background: var(--bg)`: numa lista
longa, coluna sem rótulo à vista é número sem significado. Declare as faixas
uma vez só, para o cabeçalho e para a linha — se divergirem, o rótulo passa a
mentir sobre a coluna:

```css
.list--extrato .row, .list-head { display: grid; grid-template-columns: …; gap: 16px; }
```

O cabeçalho fecha com `border-bottom` em `--hairline-strong` e a primeira linha
perde o `border-top` — duas hairlines coladas viram um traço grosso.

**Lista longa se agrupa por dia**, no formato da seção 1: rótulo em caixa alta
com o total do dia à direita. O rótulo também gruda, logo **abaixo** do
cabeçalho de colunas, e é empurrado pelo grupo seguinte:

```css
.list-head { height: var(--head-h); }    /* altura fixa, senão sobra folga */
.dia-sep   { position: sticky; top: var(--head-h); background: var(--bg); z-index: 2; }
.list-head { z-index: 3; }               /* o cabeçalho passa por cima do rótulo */
```

A altura do cabeçalho precisa ser fixa: se o `top` do rótulo não encostar nela
exatamente, linhas aparecem deslizando na fresta entre os dois.

**Coluna ordenável é o próprio rótulo**, virado `<button>` — sem ícone extra de
"ordenar" ao lado. A coluna ativa passa de `--fg-subtle` para `--fg` e ganha
uma seta de 10px; as demais não mostram seta nenhuma. O primeiro clique usa o
padrão do dado (data começa da mais recente, texto de A a Z, valor do maior),
e o segundo inverte.

Empate resolve sempre pelo mesmo critério secundário — a data mais recente —
senão a lista dança entre renders. E **ordenar por outra coisa que não a data
desliga o agrupamento por dia**: os grupos se fragmentariam e o rótulo do dia
passaria a mentir sobre o que está embaixo dele.

Mantém 13px, padding vertical 13px e `border-top` hairline. As colunas se
alinham por grid e as linhas se separam por hairline horizontal — **nunca as
duas coisas juntas formando grade**.

**Grid segmentado** — de 2 células para 3 ou 4, mesma anatomia (`gap: 1px`).

**Botão primário** — não estica: altura 44px, padding `0 24px`, largura
automática, ancorado à direita no cabeçalho da tela. Continua um por tela.

**Nova transação** — deixa de ser tela e vira camada: overlay
`rgba(7,11,18,0.72)` e um painel de 480px com `background: var(--bg)`, borda
1px `--hairline-strong`, raio `--r-lg`, padding 28px. Sem sombra (regra 3). É
camada, não card — a proibição da regra 1 continua valendo para conteúdo.

**Hover** — o único estado que o desktop acrescenta:

```css
@media (hover: hover) { .row.clickable:hover { background: rgba(255,255,255,0.02); } }
```

Transiente e só em linha clicável. É a única ocasião em que um bloco de
conteúdo recebe `background`.

Alvo de toque mínimo cai de 44px para **32px** em ponteiro fino — nunca menos.

### 9.6 Composição por tela

| Tela | Composição em 1440px |
|---|---|
| Resumo | `.split` — herói, sparkline, segmentado, mapa de calor e maiores despesas/receitas à esquerda; cartões e contas no `.rail` |
| Extrato | coluna única limitada a `--read-max`; filtros e totais no `.rail` |
| Cartões | `.split` — a **fatura** à esquerda; a lista de cartões no `.rail` |
| Detalhe de categoria | `.split` — barras e evolução à esquerda; lançamentos no `.rail` |
| Fluxo de caixa | `.split` a partir de **1280** — KPIs, gráfico de doze meses e categorias à esquerda; previsto e insights no `.rail`. Abaixo de 1280, coluna única |
| Nova transação | camada de 480px sobre a tela anterior |

A coluna principal é a do **conteúdo longo**, não a do que vem primeiro na
leitura. Em Cartões isso põe a lista de cartões no trilho: ela é um índice
curto, ganha a rolagem fixa e devolve a largura para os lançamentos, que é
onde faltava espaço.

Empilhado, a ordem se inverte: quem **escolhe** vem antes de quem é escolhido
(filtro antes da lista, cartão antes da fatura). É o que o `order: -1` no
`.rail` resolve dentro do `max-width: 767px`.

O corpo da tela **é** o `.split`, não um `div` dentro dele. Um invólucro solto
cai na auto-colocação do grid da `.view`, cuja primeira coluna é dimensionada
pelo `auto` da segunda — a do `.v-cta`. Em Fluxo isso dava uma tela de 902px
num corpo de 1120: a borda direita dos KPIs era ditada pela largura das duas
setinhas de ano, e 218px morriam em toda largura de desktop. Quando um bloco
precisa da linha inteira, ele declara `grid-column: 1 / -1` — é o que `.split`
já faz, e é por isso que ele é o invólucro certo.

**Duas colunas só quando cada uma já cabe no que carrega.** O critério não é
"sobrou largura", é o tamanho mínimo do conteúdo de cada lado: em Fluxo, 560px
para o gráfico de doze meses não rolar e 320 para o trilho, mais a calha de 64
— 944px de corpo, que só existem quando o conteúdo bate no teto de 1120.
Daí o corte em 1280, o mesmo de Pendências, por aritmética diferente.

**Uma regra escrita para o trilho vale enquanto o trilho existe.** Abaixo do
ponto de quebra o `.rail` continua no DOM, com a classe, só que ocupando a
coluna única — e uma regra como `.rail .fx-insights { grid-template-columns:
1fr }` empilha seis insights numa largura onde dois cabiam. Regra de trilho
mora dentro do `@media` do ponto de quebra, não do de 768.

### 9.7 Regras que não se negociam (desktop)

1. Navegação lateral sem fundo próprio — só `border-right` hairline.
2. Bloco de lista de texto nunca passa de `--read-max` (720px).
3. Máximo de dois trilhos verticais por tela.
4. Só herói, título de tela e sparkline escalam; o resto mantém o tamanho do mobile.
5. Colunas por grid **ou** linhas por hairline — nunca as duas formando grade fechada.
6. O botão primário não ocupa largura total.
7. Nenhuma tela ganha bloco novo só porque sobrou largura. Se o dado não muda
   uma decisão, a largura fica vazia — e está certo.

---

### Viewport e área segura

A página declara `<meta name="viewport" content="width=device-width,
initial-scale=1, viewport-fit=cover">`. Sem isso o celular monta a página num
viewport virtual de ~980px e mostra a versão desktop reduzida — os pontos de
quebra desta seção nunca chegam a valer, e nada disso aparece no navegador do
desenvolvedor até alguém abrir no aparelho.

`viewport-fit=cover` pede as bordas do aparelho, então tudo que encosta no
fundo soma `env(safe-area-inset-bottom)`: a barra inferior (altura e padding),
o botão flutuante, o rodapé das camadas em folha e o padding de rodapé do
conteúdo. Sem isso, num aparelho com barra de gestos o botão primário da folha
e os ícones da barra ficam embaixo dela.

## 10. Navegação

No desktop é a barra lateral da seção 9.2. No mobile é uma barra inferior fixa
— e ela obedece às mesmas regras do resto: sem fundo próprio, sem sombra, sem
blur. O que a separa do conteúdo é uma hairline.

```css
.tabbar {
  position: fixed; left: 0; right: 0; bottom: 0; height: 56px;
  display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
  background: var(--bg); border-top: 1px solid var(--hairline);
}
.tab {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  border-top: 2px solid transparent; color: var(--fg-subtle);
}
.tab.on { color: var(--fg); border-top-color: var(--accent); }
.tab svg { width: 20px; height: 20px; }
.tab span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; }

.content { padding-bottom: 88px; }   /* 56 da barra + 32 de respiro */
```

- Máximo de **5 itens**. O rótulo usa a escala de `.lbl` — não invente tamanho novo.
- O marcador do item ativo é a barra de 2px em `--accent` no topo do item: a
  mesma regra da navegação lateral, transposta de eixo.
- A barra some a partir de 768px, onde a navegação lateral assume.

---

## 11. Formulários e camadas

Campo também não é caixa. O que desenha um input é o contorno — nunca um fundo
próprio, que reintroduziria o card pela porta dos fundos.

```css
.field { display: flex; flex-direction: column; gap: 6px; }          /* rótulo usa .lbl */
.field input, .field select, .field textarea {
  height: 44px; padding: 0 12px; font: inherit; font-size: 13px;
  color: var(--fg); background: none;
  border: 1px solid var(--controle-borda); border-radius: var(--r-sm);
}
.field textarea { height: auto; padding: 10px 12px; resize: vertical; }
.field input::placeholder { color: var(--fg-subtle); opacity: 1; }
.field :focus { outline: none; border-color: var(--accent); }
.field :disabled { color: var(--fg-subtle); border-color: var(--hairline-strong); }
.field-help  { font-size: 11px; color: var(--fg-subtle); }
.field-error { font-size: 11px; color: var(--negative); }
```

- Altura 44px — é o alvo de toque da regra 4, não uma escolha estética.
- **O contorno do aviso (`.banner`) também é medido em 3:1**, por
  `--warning-borda`: sem ele, o aviso no tema claro ficava em 1,49:1 e parecia
  texto solto, não um quadro. O hover do botão dentro dele subiu junto — em
  2,17:1 ele ficaria mais fraco que a borda parada, invertendo o sinal.
- **O contorno de controle tem token próprio, `--controle-borda`, medido em
  3:1** — e veste tudo que se clica: campo, pill, `.ghost`, botão de ícone, X
  da camada, opção de lista. Ele não é a hairline: hairline é divisória de
  leitura, e o contorno é o que diz "isto se opera" — a regra 1.4.11 da WCAG
  pede 3:1 para isso. Vestidos de hairline, o pill e o botão secundário
  ficavam em 1,19:1 no escuro e 1,40:1 no claro: a forma do alvo só existia
  para quem já sabia que ela estava ali. As hairlines de lista, separador,
  moldura de grid e superfície continuam leves, como sempre foram — quem não
  recebe clique não precisa dos 3:1.
- **O contorno do controle ligado encosta em duas cores e precisa dos 3:1 nos
  dois lados.** O pill ativo tem `--bg` por fora e o tinte de acento por
  dentro; medir só contra o fundo deixa o lado de dentro em 2,5:1. Daí
  `--accent-borda` a 0,47 no escuro (3,63:1 fora, 3,04:1 dentro) e a 0,74 no
  claro (3,38:1 e 3,02:1) em vez dos 0,41 e 0,68 que bastariam contra o fundo.
  Era o pior contorno da tela — 1,61:1 no claro — justo no controle que
  carrega estado.
- Foco é só a borda, no **acento cheio**: sem glow, sem outline dupla, sem
  sombra. Cheio e não a 45%, porque com a borda em repouso a 3:1 o acento
  translúcido ficava em 1,99:1 no tema claro — o foco apareceria menos que o
  estado normal.
- Campo desabilitado afrouxa para `--hairline-strong`: ali não há interação
  para sinalizar, e o contorno forte prometeria o contrário.
- Escolha entre **2 e 4 opções** usa `.pill` (seção 5), não `select`. `select`
  só quando a lista é aberta ou longa.
- Campo travado por regra de negócio fica `disabled` **com `.field-help`
  explicando o porquê**. Campo desabilitado e mudo é defeito.
- Botão secundário: mesma altura do primário no contexto, borda
  `--controle-borda`, texto `--fg-muted`, sem fundo. No hover a borda passa
  para `--accent-borda`, que é mais forte que a de repouso — hover que
  enfraquece o contorno inverte o sinal.
- **Caixa de seleção: a linha inteira é o alvo, e no telefone ela cresce para
  44px.** O desenho continua com 16px; quem cresce é o rótulo, e o texto segue
  centrado. Aqui o `::after` dos outros controles não serve: duas caixas
  vizinhas ficam a 16px uma da outra, e esticar 11px para cada lado faria os
  alvos se sobreporem — toque na borda pegando a caixa errada é pior que alvo
  pequeno.
- **Linha com QUATRO ações quebra no telefone**: valor e ações descem para a
  segunda linha e o nome fica com a largura inteira. Com tudo na mesma linha
  sobram ~58px para o nome, e o que se perde é o fim — justamente onde mora o
  que distingue uma linha da outra ("Notebook (Parcela 2/6)" virava
  "Noteboo…"). Vale para contas e para os lançamentos da fatura; no extrato
  não, porque lá são muitas linhas e a altura dobrada pesaria.

- Ação destrutiva é **texto em `--negative`**, nunca fundo vermelho. Vermelho
  cheio é para valor negativo, não para botão.

### Calendário

Campo de data abre o calendário **em linha**, empurrando o conteúdo abaixo —
não como popover. Dentro de um formulário que rola, popover é cortado pelo
contêiner; painel em linha nunca é.

```css
.cal { border: 1px solid var(--hairline-strong); border-radius: var(--r-md); padding: 12px;
       display: flex; flex-direction: column; gap: 10px; }
.cal-week, .cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0,1fr)); gap: 2px; }
.cal-dia { aspect-ratio: 1; display: grid; place-items: center; font-size: 13px;
           background: none; border: 1px solid transparent; border-radius: var(--r-sm); }
.cal-dia.fora  { color: var(--fg-subtle); }                 /* mês vizinho: texto, 4,5:1 */
.cal-dia.hoje  { border-color: var(--controle-borda); }     /* 3,03:1 */
.cal-dia:hover { border-color: var(--accent-borda); }       /* depois de .hoje, de propósito */
.cal-dia.on    { background: var(--accent-fraco); border-color: var(--accent-borda); color: var(--accent); }
```

- Célula quadrada (`aspect-ratio: 1`) em grid de 7 colunas. **A conta da
  largura é a da coluna, não a da tela**: o calendário mora dentro da camada,
  que come 24px de cada lado, e o painel come mais um tanto. Num aparelho de
  375 isso deixava a coluna em 41px — abaixo do alvo mínimo. No telefone o
  painel cede folga (`padding: 10px 4px`) e a fresta cai para 1px, e a coluna
  sobe para 44,1px.
- **Abaixo de 380 o quadrado sai** (`aspect-ratio: auto`). Ali a coluna tem
  ~36px e o quadrado deixa de ser enfeite e vira defeito: com `aspect-ratio` e
  `min-height: 44px` juntos, o dia deriva a **largura** da altura, passa por
  cima da coluna do grid, sobrepõe o vizinho, vaza o painel e cria uma rolagem
  lateral dentro do calendário. Com ele fora, o dia fica ~37x44 — estreito,
  mas inteiro. Acima de 380 o quadrado fica: sem ele o dia viraria um
  retângulo deitado de 67x44.
- O bloco de telefone do calendário vem **depois** das regras base dele no
  arquivo. `@media` não soma especificidade: um override de `.cal` declarado
  antes da própria `.cal` perde para ela, e o media query parece simplesmente
  não funcionar.
- Dia selecionado usa **a mesma linguagem do pill ativo**. Não invente um
  destaque só para o calendário.
- O dia é botão e segue o padrão de botão: `--controle-borda` no repouso
  marcado (hoje), `--accent-borda` no hover. Hover e "hoje" já foram a mesma
  hairline, e o resultado era duplo: a marca de hoje não aparecia (1,19:1) e
  o dia de hoje era o único que não respondia ao mouse.
- **A ordem das três regras é a regra.** `:hover` vem depois de `.hoje` e `.on`
  depois das duas: mesma especificidade, então quem vem por último ganha. Dia
  apontado vence dia de hoje; dia escolhido vence dia apontado. Trocar a ordem
  no arquivo troca o comportamento sem trocar uma linha de valor.
- Cabeçalho de dias da semana usa a escala de `.lbl`.
- Marcador de fronteira (fechamento de fatura, fim de competência) é a **borda
  inferior da própria célula** em `--fg-muted` — nunca uma cor nova, nunca
  sombra.
- O calendário tem um rodapé de 11px em `--fg-subtle` para a consequência da
  data escolhida ("cai na fatura de Outubro"). Data sem consequência não tem
  rodapé.

### Camada

Diálogo, confirmação e formulário vivem em camada — e camada não é card: ela
está fora do fluxo de conteúdo, então a regra 1 não se aplica. Continua sem
sombra (regra 3).

```css
dialog {
  width: min(480px, calc(100vw - 40px)); padding: 0;
  background: var(--bg); color: var(--fg);
  border: 1px solid var(--hairline-strong); border-radius: var(--r-lg);
  max-height: calc(100vh - 48px); overflow-y: auto;   /* a rolagem é da camada */
}
dialog::backdrop { background: rgba(7,11,18,0.72); }
.layer-head {                                  /* título 17px/600 + contexto 12px */
  padding: 22px 64px 0 24px;                   /* espaço reservado para o X */
  position: sticky; top: 0; background: var(--bg); z-index: 2;
}
.layer-x {                                     /* dispensar é só aqui */
  position: absolute; top: 14px; right: 14px; width: 44px; height: 44px;
  border-radius: 50%; border: 1px solid var(--hairline-strong);
  background: none; color: var(--fg-muted);
}
.layer-body { padding: 20px 24px; display: flex; flex-direction: column; gap: 16px; }
.layer-foot { padding: 0 24px 22px; display: flex; gap: 10px; justify-content: flex-end; }

@media (max-width: 767px) {                                 /* ancora embaixo no mobile */
  dialog { width: 100%; max-width: none; margin: auto 0 0; border-radius: var(--r-lg) var(--r-lg) 0 0; }
}
```

O que separa a camada do fundo é a borda e o backdrop — nada de blur nem de
elevação. Uma camada por vez, salvo quando a segunda existe para criar um
registro que a primeira precisa (ex: nova categoria a partir do lançamento).

**Clicar no fundo dispensa a camada**, como o X e o Escape. O clique no
`::backdrop` chega como clique no próprio `<dialog>`, então testar
`e.target === dialog` não basta: a **barra de rolagem da camada** também tem o
dialog como alvo e está dentro dele. Compare com o `getBoundingClientRect()`,
senão arrastar a barra fecha o formulário.

Em camada de confirmação, fechar pelo fundo é **cancelar** — a ação pendente
precisa ser limpa no evento `close`, senão fica pendurada esperando um clique
futuro em "Confirmar".

**Dispensar é o X, não um botão de rodapé.** Toda camada tem um X de 44px no
canto superior direito (36px em ponteiro fino) e **nenhum botão "Cancelar"**:
rodapé é só para ação que avança. Dois caminhos para a mesma saída gastam a
linha do rodapé e competem com a ação de verdade.

Como o X passa a ser a única saída visível, o cabeçalho **gruda no topo**
(`position: sticky`) — num formulário longo, um X que rola para fora deixaria a
camada sem saída aparente. O rodapé continua rolando junto com o conteúdo.

**A rolagem é da camada inteira, nunca do corpo.** Barra interna corta o
formulário em dois e deixa cabeçalho e rodapé grudados, o que num formulário
longo esconde o botão de ação atrás de uma segunda área de rolagem. Com a
rolagem na camada, ela rola como uma página: cabeçalho, campos e rodapé na
mesma corrente. A barra é fina, sem trilho, polegar em branco a 14%.
