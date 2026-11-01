# Segurança dos Dados (Data Safety) — saldonline

O formulário que o Google Play exige em *Política e programas → Conteúdo do
app*. Ele vira um quadro público na ficha da loja, e errar ali não é detalhe:
divergência entre o declarado e o que o app faz é motivo de remoção.

Este arquivo existe porque a parte difícil não é preencher — é **saber o que
responder**. Cada resposta abaixo vem do código, com o lugar de onde saiu, para
poder ser conferida de novo quando o app mudar.

## A definição que decide quase tudo

> *"'Collect' means transmitting data from your app off a user's device."*

**Coletar é o dado SAIR do aparelho.** Dado que o app lê e usa só localmente
não é coletado e não se declara. Isso resolve dois casos deste app que
pareceriam "sim" numa leitura apressada — ver *Casos que enganam*, no fim.

**Compartilhar** é transferir dado já coletado para um terceiro.

---

## Respostas no nível do app

| Pergunta | Resposta | Por quê |
| --- | --- | --- |
| O app coleta ou compartilha dados? | **Sim** | Nome, e-mail e os lançamentos vão para a API própria |
| Tudo é criptografado em trânsito? | **Sim** | App e API só respondem em HTTPS; o app é servido pelo Cloudflare e a API pelo Render, ambos com TLS |
| Há como pedir exclusão dos dados? | **Sim** | Dois caminhos, e os dois apagam de verdade |

Sobre a exclusão, vale detalhar na resposta, porque a Play distingue
*desativar* de *apagar*:

- Dentro do app: **Perfil → Excluir minha conta**.
- Fora dele, para quem desinstalou: <https://saldonline.com.br/excluir-conta>.

A exclusão remove as linhas do banco, em ordem, numa transação
(`auth.service.ts`, `deleteAccount`). Não há modo inativo nem arquivo morto.
Isso foi verificado contra o Postgres de verdade: uma conta com dado em 14
tabelas ficou com zero linhas em todas as 19 depois do pedido.

---

## Por tipo de dado

### Coletados

| Categoria | Tipo | Obrigatório? | Finalidade | Compartilhado? |
| --- | --- | --- | --- | --- |
| Informações pessoais | **Nome** | Obrigatório | Funcionalidade do app; Gerenciamento de contas | Não |
| Informações pessoais | **Endereço de e-mail** | Obrigatório | Funcionalidade do app; Gerenciamento de contas | Não |
| Informações pessoais | **IDs de usuários** | Obrigatório | Funcionalidade do app; Gerenciamento de contas | Não |
| Informações financeiras | **Outras informações financeiras** | Obrigatório | Funcionalidade do app | Não |
| Informações pessoais | **Número de telefone** | **Opcional** | Funcionalidade do app | Não |
| Mensagens | **Outras mensagens no app** | **Opcional** | Funcionalidade do app | Não |
| Arquivos de áudio | **Gravações de voz ou som** | **Opcional** | Funcionalidade do app | Não |
| Fotos e vídeos | **Fotos** | **Opcional** | Funcionalidade do app | Não |

As quatro últimas existem por causa de **um** recurso, e só valem para quem o
liga: lançar mandando mensagem para o WhatsApp do app. Quem não conecta o
número não produz nenhuma delas — ver *Lançar pelo WhatsApp*, nos casos que
enganam.

**Nome e e-mail** (`User.name`, `User.email`): informados no cadastro. O e-mail
identifica a conta e é por onde chega a redefinição de senha.

**IDs de usuários** (`User.id`): identificador que o próprio sistema gera e
guarda. Não é identificador de aparelho nem de publicidade — desses, o app não
coleta nenhum.

**Outras informações financeiras**: é onde entra o conteúdo do app — contas
bancárias e saldos, cartões (apelido, limite, fechamento, vencimento),
lançamentos, transferências, faturas, objetivos de poupança e planejamentos.
Tudo digitado pelo usuário: **o app não se conecta a banco, não faz Open
Finance e não lê extrato**.

Note que isto **não** é "Informações de pagamento do usuário", que no
vocabulário da Play significa meio de pagamento — ver *Quando a assinatura for
ligada*.

### Não coletados

| Categoria | Por quê |
| --- | --- |
| Local (aproximado ou exato) | O app nunca pede nem usa localização |
| Endereço | Não há campo que peça |
| Informações de pagamento | Nada de pagamento sai do aparelho hoje |
| Saúde e fitness | Não se aplica |
| E-mails e SMS | O app não lê nem envia nenhum dos dois |
| ~~Fotos e vídeos~~ | **Mudou em 01/11/2026**: o app continua sem acessar câmera e galeria, mas passou a receber foto de cupom pelo WhatsApp — ver a tabela do que é coletado |
| Arquivos e documentos, Agenda, Contatos | Sem acesso |
| Atividade em apps | **Não há analytics.** Nenhuma interação é registrada |
| Navegação na Web | Não se aplica |
| Informações e desempenho do app | **Não há relatório de falhas nem diagnóstico** |
| Identificadores do dispositivo | Nenhum identificador de aparelho ou publicidade |

A ausência de analytics e de relatório de falhas é escolha, não esquecimento —
e é o que a política de privacidade publicada afirma: *"Não tem rastreadores.
Nenhuma ferramenta de analytics, nenhum pixel, nenhum SDK de publicidade."*
Declarar o contrário aqui contradiria um documento público.

---

## Casos que enganam

### Cartão de crédito: a tela pede, o servidor nunca recebe

O app tem uma tela de forma de pagamento com número e CVV
(`index.html`, `#cp-cvv`). Parece coleta de dado de pagamento. Não é, por dois
motivos somados:

1. **Número e CVV são descartados.** Só bandeira e quatro últimos dígitos
   sobrevivem, e a própria tela diz isso ao usuário.
2. **Nada disso sai do aparelho hoje.** O app não faz nenhuma chamada a
   `/billing/` — a assinatura opera sobre estado local. Pela definição do
   formulário, não há coleta.

### Ditado por voz na tela: o áudio sai, mas não pelo app

O app permite lançar falando, usando o **reconhecimento de voz do navegador**
(Web Speech API). No Chrome e no Android, isso significa que o áudio vai para
servidores do Google.

Esse é o único ponto genuinamente ambíguo do formulário. A regra diz que a
coleta cobre o que sai do aparelho "a partir do seu app", inclusive por
bibliotecas e SDKs — e aqui quem transmite é o **navegador**, um recurso da
plataforma, não um SDK empacotado no app.

**Recomendação: declarar mesmo assim**, como *Arquivos de áudio → Gravações de
voz ou som*, **opcional** (depende da permissão de microfone, e todo o resto do
app funciona sem ela), finalidade *Funcionalidade do app*, marcado como
**processado de forma efêmera** — o app não grava, não armazena e só recebe o
texto resultante.

O raciocínio: declarar a mais não é infração; declarar a menos é. E a política
de privacidade já divulga esse comportamento, então omitir aqui criaria
divergência entre os dois documentos.

### Lançar pelo WhatsApp: o recurso que mudou esta declaração

Desde 31/10/2026 dá para lançar mandando mensagem — escrita ou falada — para o
número de WhatsApp do app. É daqui que saem as três linhas opcionais da tabela
de coletados, e vale separar o que cada uma significa.

**Número de telefone — coletado, opcional.** Para saber de quem é cada
mensagem, o número de quem escreve precisa estar ligado a uma conta. O vínculo
só nasce se a pessoa quiser: ela pega um código em *Perfil → WhatsApp* e o
manda pelo WhatsApp. No banco **não fica o número legível** — fica um HMAC com
uma chave que só o servidor tem, mais os quatro últimos dígitos, que são o que
a tela mostra (`whatsapp_links`, `telefone.ts`). Mesmo assim se declara: o
número *saiu* do aparelho e chegou ao servidor, e guardar em forma irreversível
é uma proteção, não uma dispensa.

**Mensagens — coletado, opcional, efêmero.** O texto da frase chega ao servidor
e é lido ali. **Não há histórico de conversa**: nenhuma tabela guarda o que foi
dito, nem quem disse o quê. O que sobra é o lançamento que a pessoa confirmou,
igual ao que ela teria digitado na tela. Marque *processado de forma efêmera*
no formulário.

**Áudio — coletado, opcional, efêmero.** Recado de voz é baixado, transcrito e
descartado. Não há arquivo, não há coluna, não há log do que foi dito
(`audio.service.ts`). Difere do ditado na tela num ponto que importa: aqui
quem transmite é o **servidor do app**, não o navegador do usuário — então
este caso não tem a ambiguidade do outro. É coleta, sem discussão.

Nada disso acontece para quem não conecta o WhatsApp, e o recurso inteiro pode
ser desligado em *Perfil → WhatsApp → Desligar*, o que apaga o vínculo na hora.

**Foto de cupom — coletada, opcional, efêmera.** A foto mandada pelo WhatsApp
é baixada, enviada ao serviço de leitura de imagem e descartada. Dela saem
quatro campos — valor total, data, forma de pagamento e estabelecimento — que
viram o lançamento que a pessoa confirma. A imagem não é gravada, nem em
arquivo nem em coluna.

Dois pontos que esta declaração não pode arredondar:

- **a imagem INTEIRA é enviada ao terceiro**, e um cupom traz mais que o
  total: os itens comprados, o CNPJ da loja, o nome do operador do caixa e os
  dígitos mascarados do cartão da maquininha. Aproveitar só quatro campos não
  muda o que foi transmitido, e é isso que o formulário pergunta;
- **número de cartão nunca é extraído nem guardado**, nem mascarado. É a mesma
  regra que vale no resto do app, onde só existem bandeira, últimos quatro e
  validade, digitados pela pessoa.

O app continua **sem pedir permissão de câmera ou galeria**: quem escolhe e
envia a foto é o WhatsApp, no aparelho, pela interface dele. Ainda assim a
categoria *Fotos e vídeos* é declarada, porque o dado sai do aparelho — que é
a definição que o Google usa.

**Áudio e foto só saem se o servidor estiver configurado para isso.** Sem as
variáveis `STT_PROVIDER` e `STT_API_KEY` (áudio) e `VISION_PROVIDER` /
`VISION_API_KEY` (imagem), o app responde por escrito que não escuta nem
enxerga, e nenhum byte deixa o servidor — o padrão é mudo e cego de propósito,
para que mandar conteúdo a um terceiro seja decisão de quem opera, e não
efeito colateral de um deploy.

### Infraestrutura não é compartilhamento

Cloudflare (serve as telas), Render (hospeda API e banco), Resend (entrega o
e-mail de redefinição) e o **serviço de transcrição e leitura de imagem**
(recebe o áudio do recado de voz e a foto do cupom, devolve texto e não os
guarda) recebem dados para executar o serviço em nome do app — são operadores,
não destinatários. A orientação do
Google exclui de "compartilhamento" a transferência para prestador que
processa em seu nome.

**A Meta é outro caso, e por isso está dita aqui.** Toda mensagem trocada com
o número do app passa pelos servidores dela, sob a política de privacidade
dela — como em qualquer conversa de WhatsApp. Ela não é um prestador
contratado pelo app: é a plataforma que a própria pessoa escolheu usar, do
mesmo jeito que o provedor de e-mail dela recebe o e-mail de redefinição de
senha. Quem não quiser isso tem o app inteiro funcionando sem conectar o
WhatsApp, e a política publicada diz isso com todas as letras.

**Confira esse ponto no texto de ajuda do próprio formulário antes de enviar.**
É a única resposta deste documento que depende de interpretação, e não de um
fato do código.

### As tabelas mortas foram removidas, e as de hoje são outras

Até 12/10/2026 o schema tinha `User.whatsappNumber` e `WhatsappMessageLog`,
restos da migration inicial que **nenhum código usava**. Eles foram removidos
(migration `20261012190000_remove_whatsapp`) justamente porque schema que
insinua uma coleta inexistente confunde auditoria.

As tabelas de WhatsApp que existem hoje — `whatsapp_links` e
`whatsapp_pairings` — são outra coisa: nasceram com uso definido, guardam
hash, datas e identificadores, e **nenhuma delas tem o número legível nem
qualquer trecho de conversa**. É por causa delas, e do recurso que elas
sustentam, que esta declaração passou a incluir telefone, mensagens, áudio e
foto.

---

## Quando a assinatura for ligada

Hoje o provedor de pagamento é o `FakePaymentProvider` e o app não chama a API
de cobrança. Quando isso mudar, **a declaração muda junto**:

- **Informações financeiras → Informações de pagamento do usuário** passa a ser
  coletado, com finalidade *Funcionalidade do app*.
- O que será guardado continua sendo só bandeira, quatro últimos dígitos,
  validade e o identificador devolvido pelo meio de pagamento
  (`PaymentMethod`). Número completo e CVV não são recebidos nem gravados.
- Se a cobrança passar a usar o **Google Play Billing**, confira quem coleta o
  quê: nesse desenho o dado de pagamento é tratado pelo Google, não pelo app.

Atualizar a declaração é obrigatório a cada release em que o comportamento
muda. Esquecer disso é uma das formas mais comuns de divergência — e já
aconteceu uma vez aqui: o WhatsApp entrou em produção em 31/10/2026 e este
arquivo continuou dizendo, por algumas horas, que telefone e mensagens não
eram coletados.

---

## Um risco encontrado ao levantar isto

A apuração acima revelou algo que não é sobre o formulário, mas que atinge a
publicação: **o app tem um fluxo de assinatura alcançável que parece uma compra
e não é uma.**

Caminho: **Perfil → Assinatura → trocar cartão**, e **Perfil → Planos**, com um
plano "Pro" a R$ 29,90/mês. A tela aceita número de cartão e CVV, e o que
acontece depois é só isto:

```js
state.assinatura.cartao = { bandeira, final, nome, validade };
persist();   // localStorage, no próprio aparelho
```

Nada é enviado. Não há chamada a `/billing/`. O plano muda em estado local.

Dois problemas, nesta ordem:

**Política de pagamentos da Play.** Bem digital vendido dentro do app Android
tem de passar pelo Google Play Billing. Um revisor que abrir "Planos", escolher
o Pro e ver o app aceitar um cartão vai ler isso como cobrança por fora — e a
intenção de que seja demonstração não aparece em lugar nenhum da tela.

**Confiança do usuário.** Uma pessoa pode digitar o número real do cartão num
formulário que não faz nada. Mesmo descartando número e CVV, nome, bandeira,
final e validade ficam gravados em `localStorage`, em texto, no aparelho.

### Resolvido: as telas saíram de cena

Assinatura e Planos ficam escondidos enquanto o paywall não cobrar de verdade.
A chave é `ASSINATURA_VISIVEL`, no `index.html`, e a proteção é dupla: as
entradas do menu saem, e `abrirAssinatura` e `abrirPlanos` recusam abrir mesmo
se o pedido vier por outro caminho.

Junto veio um invariante: com a assinatura fora de alcance,
`assinaturaBloqueada()` devolve `false` sempre. Sem isso, uma conta marcada
como pendente ficaria impedida de criar registros e seria mandada para uma tela
que não abre — recusa sem explicação, que é pior que a cobrança.

Para religar, depois de o Play Billing existir: trocar a constante para `true`.
O teste "com a assinatura fora de alcance, pendente NAO bloqueia" volta a
esperar `true` nesse dia.

As outras saídas consideradas eram deixar os planos em modo informativo, sem
formulário de cartão, ou implementar o Play Billing de uma vez. A primeira foi
escolhida por ser a menor e a mais honesta: o que não funciona não aparece.
