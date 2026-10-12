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
| Endereço, Telefone | Não há campo que peça — ver *Tabelas mortas* |
| Informações de pagamento | Nada de pagamento sai do aparelho hoje |
| Saúde e fitness | Não se aplica |
| Mensagens (e-mail, SMS, no app) | O app não lê nem envia mensagens do usuário |
| Fotos e vídeos | Não há acesso a câmera nem galeria |
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

### Ditado por voz: o áudio sai, mas não pelo app

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

### Infraestrutura não é compartilhamento

Cloudflare (serve as telas), Render (hospeda API e banco) e Resend (entrega o
e-mail de redefinição) recebem dados para executar o serviço em nome do app —
são operadores, não destinatários. A orientação do Google exclui de
"compartilhamento" a transferência para prestador que processa em seu nome.

**Confira esse ponto no texto de ajuda do próprio formulário antes de enviar.**
É a única resposta deste documento que depende de interpretação, e não de um
fato do código.

### Tabelas mortas no banco

O schema tem `User.whatsappNumber` e a tabela `WhatsappMessageLog`, restos de
uma integração que **não existe**: não há módulo, controller nem rota de
WhatsApp, e o app web não menciona a palavra uma vez sequer. Nenhum dado chega
ali.

Por isso **telefone e mensagens não entram na declaração**. Mas o schema
sugerindo uma coleta que não acontece é o tipo de coisa que confunde uma
auditoria futura — vale remover numa migration quando houver ocasião.

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
muda. Esquecer disso é uma das formas mais comuns de divergência.

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

**Antes de enviar o app para a Play, o fluxo precisa de uma destas saídas:**

1. **Esconder** as entradas de Assinatura e Planos enquanto o paywall estiver
   dormente. É a menor mudança e a mais honesta: o que não funciona não aparece.
2. **Deixar visível, sem cobrar**: planos em modo informativo, sem formulário de
   cartão e sem escolher plano pago.
3. **Implementar o Play Billing** e ligar de verdade — o caminho completo, e o
   único que permite cobrar dentro do app.

Isto é decisão de produto, não de código. Mas publicar com o fluxo como está é
pedir reprovação na revisão.
