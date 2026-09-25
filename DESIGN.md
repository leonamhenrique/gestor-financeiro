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
  --track:         rgba(255,255,255,0.05);  /* trilho de barras */

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
  --track:           rgba(15,23,32,0.08);

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

Auditar é mecânico: percorrer os elementos com texto, compor o fundo real
(inclusive `background-image` de tinte) e comparar com o mínimo — 4,5:1, ou
3:1 em texto grande. Nenhuma tela, nem as camadas, pode sair com falha.

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

**Data no futuro manda mais que o verbo**: o lançamento nasce **previsto**,
mesmo em "pago no pix amanhã" — dinheiro que ainda vai sair não afeta o saldo
de hoje. Prazo não é valor: em "90 reais em 3 dias", o 3 não vira dinheiro.

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

**Mapa de calor** (gastos ou receitas por dia do mês) — grade de 7 colunas começando na
**segunda** (S T Q Q S S D, cabeçalho no estilo do `.lbl`), gap de 2px, uma
célula por dia do mês e células vazias invisíveis antes do dia 1. Cada célula
tem no mínimo 52px de altura, raio 8px, número do dia no topo (11px
`--fg-muted`) e valor abreviado embaixo (11px/500: `214`, `2,7k`, `12k`).
Dia sem gasto mostra só o número, sem fundo.

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
Hoje ganha borda `--hairline-strong`, como no calendário.

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

**Pill de filtro** — 12px, padding 7/14, raio pill, borda `--hairline-strong`,
texto `--fg-muted`. Ativa: fundo `rgba(110,231,240,0.10)`, borda
`rgba(110,231,240,0.35)`, texto `--accent`.

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

**Ícones** — SVG inline, stroke 1.7–1.8, grid 24, tamanho de render 13–20px,
`currentColor` sempre que possível. Nunca emoji.

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
| Nova transação | camada de 480px sobre a tela anterior |

A coluna principal é a do **conteúdo longo**, não a do que vem primeiro na
leitura. Em Cartões isso põe a lista de cartões no trilho: ela é um índice
curto, ganha a rolagem fixa e devolve a largura para os lançamentos, que é
onde faltava espaço.

Empilhado, a ordem se inverte: quem **escolhe** vem antes de quem é escolhido
(filtro antes da lista, cartão antes da fatura). É o que o `order: -1` no
`.rail` resolve dentro do `max-width: 767px`.

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

Campo também não é caixa. O que desenha um input é a hairline — nunca um fundo
próprio, que reintroduziria o card pela porta dos fundos.

```css
.field { display: flex; flex-direction: column; gap: 6px; }          /* rótulo usa .lbl */
.field input, .field select, .field textarea {
  height: 44px; padding: 0 12px; font: inherit; font-size: 13px;
  color: var(--fg); background: none;
  border: 1px solid var(--hairline-strong); border-radius: var(--r-sm);
}
.field textarea { height: auto; padding: 10px 12px; resize: vertical; }
.field :focus { outline: none; border-color: rgba(110,231,240,0.45); }
.field :disabled { color: var(--fg-subtle); border-color: var(--hairline); }
.field-help  { font-size: 11px; color: var(--fg-subtle); }
.field-error { font-size: 11px; color: var(--negative); }
```

- Altura 44px — é o alvo de toque da regra 4, não uma escolha estética.
- Foco é só a borda em acento a 45%: sem glow, sem outline dupla, sem sombra.
- Escolha entre **2 e 4 opções** usa `.pill` (seção 5), não `select`. `select`
  só quando a lista é aberta ou longa.
- Campo travado por regra de negócio fica `disabled` **com `.field-help`
  explicando o porquê**. Campo desabilitado e mudo é defeito.
- Botão secundário: mesma altura do primário no contexto, borda
  `--hairline-strong`, texto `--fg-muted`, sem fundo.
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
.cal-dia.fora  { color: var(--fg-ghost); }                  /* mês vizinho */
.cal-dia.hoje  { border-color: var(--hairline-strong); }
.cal-dia.on    { background: rgba(110,231,240,0.10); border-color: rgba(110,231,240,0.35); color: var(--accent); }
```

- Célula quadrada (`aspect-ratio: 1`) em grid de 7 colunas: a 390px cada célula
  passa de 44px sozinha, sem truque de alvo de toque.
- Dia selecionado usa **a mesma linguagem do pill ativo**. Não invente um
  destaque só para o calendário.
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
