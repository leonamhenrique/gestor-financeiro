# Subir o saldonline para a nuvem

Duas partes, dois lugares:

| Parte | Onde | O que é |
| --- | --- | --- |
| API (NestJS) | **Render** | `gestor-financeiro-api/`, lida por `render.yaml` |
| Banco (Postgres) | **Neon** | grátis, sem prazo de validade |
| App (tela) | **Cloudflare Pages** | `web/` — um HTML e um `config.js` |

Depois que estiver montado, **atualizar é só dar `git push`**: Render e
Cloudflare escutam o repositório e sobem a versão nova sozinhos.

Nenhum segredo entra no repositório. `DATABASE_URL` fica no painel do Render,
e o `JWT_SECRET` é gerado pelo próprio Render — ninguém precisa ver nem
digitar esse valor.

---

## Passo 1 — Git nesta máquina (uma vez)

O Git ainda não está instalado. No PowerShell:

```bash
winget install --id Git.Git -e
```

Feche e abra o terminal, confira com `git --version`, e diga quem você é
(aparece na autoria dos commits):

```bash
git config --global user.name "Seu Nome"
```

```bash
git config --global user.email "seu@email.com"
```

## Passo 2 — Repositório e primeiro envio (uma vez)

Na pasta `gestor financeiro`:

```bash
git init -b main
```

```bash
git add . ; git commit -m "Gestor Financeiro: API, app e deploy"
```

Confira que o `.env` **não** está no commit (ele tem senha do banco):

```bash
git ls-files | Select-String "\.env$"
```

O comando acima não deve imprimir nada. Depois crie um repositório **privado**
em <https://github.com/new>, com o nome `gestor-financeiro`, sem README, e rode
o que o GitHub mostrar na tela — é isto, trocando `SEU-USUARIO`:

```bash
git remote add origin https://github.com/SEU-USUARIO/gestor-financeiro.git
```

```bash
git push -u origin main
```

## Passo 3 — Banco no Neon (uma vez)

1. Entre em <https://neon.com> e crie um projeto (região `AWS São Paulo`, se
   aparecer; senão `US East`). Postgres 16 ou mais novo.
2. Na tela de conexão, copie **as duas** strings — o seletor "Connection
   type" alterna entre elas:
   - **Pooled connection** → vai virar `DATABASE_URL`. O host tem `-pooler`.
   - **Direct connection** → vai virar `DIRECT_URL`. Mesmo host, sem `-pooler`.
3. Guarde no gerenciador de senhas. São as senhas do seu banco: não cole em
   chat, e-mail ou arquivo do projeto.

São duas porque o app e as migrations precisam de coisas diferentes: o app
quer o pool (muitas conexões curtas), e o `prisma migrate deploy` precisa de
uma conexão direta para segurar o lock que impede dois deploys migrarem ao
mesmo tempo. Pelo pool, a migration falha no meio.

## Passo 4 — API no Render (uma vez)

1. Entre em <https://render.com> com a conta do GitHub.
2. **New > Blueprint**, escolha o repositório. O Render lê o `render.yaml` e
   já monta o serviço.
3. Ele vai pedir as variáveis que faltam:
   - `DATABASE_URL` → a string **Pooled** do Neon.
   - `DIRECT_URL` → a string **Direct** do Neon.
   - `CORS_ORIGINS` e `APP_URL` → a URL do app. Você ainda não a tem: ponha
     `https://gestor-financeiro.pages.dev` por enquanto e ajuste no passo 6.
4. Clique em **Apply**. O primeiro deploy demora alguns minutos: ele instala,
   compila, **aplica as migrations** e sobe.
5. Guarde a URL que aparecer, algo como
   `https://gestor-financeiro-api.onrender.com`. Abrindo no navegador, ela
   responde uma linha de texto — é o sinal de que está no ar.

## Passo 5 — App no Cloudflare Pages (uma vez)

1. Entre em <https://dash.cloudflare.com> > **Workers & Pages** > **Create** >
   **Pages** > **Connect to Git**, e escolha o repositório.
2. Configuração do build:
   - Framework preset: **None**
   - Build command: **deixe vazio**
   - Build output directory: **`web`**
3. **Save and Deploy**. Guarde a URL, algo como
   `https://gestor-financeiro.pages.dev`.

## Passo 6 — Ligar o app na API (uma vez)

1. Abra `web/config.js` e ponha a URL da API do passo 4, sem barra no fim:

   ```js
   window.GF_API_URL = "https://gestor-financeiro-api.onrender.com";
   ```

2. No painel do Render, corrija `CORS_ORIGINS` e `APP_URL` para a URL real do
   passo 5. Sem isso o navegador recusa as chamadas.
3. Envie a mudança (é também a rotina de todo dia):

   ```bash
   git add . ; git commit -m "Aponta o app para a API publicada" ; git push
   ```

Abra a URL do app, crie uma conta e entre. Se entrar, está tudo ligado.

---

## A rotina, a cada atualização

```bash
git add . ; git commit -m "o que mudou" ; git push
```

É só isso. O `push` dispara o deploy dos dois: Render (API, com as migrations)
e Cloudflare (app). Acompanhe em *Logs*, no Render, e em *Deployments*, no
Cloudflare.

Antes de enviar, vale rodar os testes:

```bash
cd gestor-financeiro-api ; npm test
```

## Migrations

Criar continua sendo local, revisando o SQL antes:

```bash
cd gestor-financeiro-api ; npx prisma migrate dev --create-only --name o_que_muda
```

O `prisma migrate deploy` roda sozinho no start do Render, aplicando no banco
do Neon o que ainda falta. Migration que **apaga** coluna ou tabela some com
os dados de verdade: leia o SQL gerado antes do push.

## Ligar a cobrança (Asaas)

A cobrança acontece **pela web**, no checkout hospedado do Asaas. Dentro do app
da Play ela não existe: lá a política do Google exige o faturamento do Play, e
nem linkar para a nossa cobrança é permitido.

Enquanto `PAYMENT_PROVIDER` for `FAKE`, a tela de assinatura **some sozinha** no
app — a API responde que não há com que cobrar. Nada de ruim acontece se você
parar no meio desta receita.

**1. Conta e chave.** No painel do Asaas de **produção**, menu do usuário →
Integrações → gerar API Key. Ela aparece **uma vez só**. A de produção não tem o
prefixo `$aact_hmlg_` (esse é do sandbox) — e o adaptador recusa rodar se a
chave não combinar com a `ASAAS_BASE_URL`, para um teste não cobrar ninguém de
verdade.

**2. Token do webhook.** Um valor que **você inventa**, de 32 a 255 caracteres,
e que não pode ser a chave de API. Guarde: o Asaas só o mostra na criação.

**3. No painel do Render** (Environment), preencha **antes** de trocar o
provedor:

| variável | valor |
|---|---|
| `ASAAS_API_KEY` | a chave de produção |
| `ASAAS_WEBHOOK_TOKEN` | o token que você inventou |
| `APP_URL` | `https://saldonline.com.br` (se ainda não estiver) |

Depois troque `PAYMENT_PROVIDER` para `ASAAS`. A ordem importa: com `ASAAS` e
sem chave, quem tentar assinar vê erro.

**4. O webhook, no painel do Asaas.** URL
`https://<a-api-no-render>/billing/webhook`, com o token do passo 2 e estes seis
eventos:

```
PAYMENT_CONFIRMED  PAYMENT_RECEIVED  PAYMENT_OVERDUE
CHECKOUT_PAID      CHECKOUT_CANCELED  CHECKOUT_EXPIRED
```

Depois de **15 falhas seguidas o Asaas PAUSA a fila inteira** e para de mandar
eventos até alguém reativar. Se as assinaturas pararem de ser liberadas, é o
primeiro lugar para olhar.

**5. Os planos.** Os preços que o app mostra saem da tabela `plans` do Neon — não
há preço escrito na tela. Confira o que está lá antes de ligar.

**6. Conferir.** Assine com um cartão de verdade, de valor baixo se possível, e
veja a assinatura virar `ACTIVE` sozinha. Se ficar em `INCOMPLETE`, o pagamento
aconteceu e o webhook não chegou — confira a URL e o token.

### O que NÃO passa por aqui

Número de cartão e CPF. Os dois são pedidos na tela do Asaas, direto ao
pagador. É de propósito: mantém o app fora do escopo pesado do PCI-DSS e o CPF
fora do nosso banco e da declaração de Data Safety da Play.

## O que esperar (e o que não)

- **A API grátis do Render dorme** depois de 15 minutos parada. A primeira
  chamada depois disso demora ~30 segundos e pode parecer travada. Sair do
  plano grátis (US$ 7/mês) resolve.
- **O banco do Neon também hiberna** no plano grátis, e acorda em segundos.
- **Backup**: o Neon grátis guarda o histórico recente e permite voltar o
  banco a um ponto no tempo. Para algo além disso, é preciso plano pago ou um
  dump seu, agendado.
- **O cookie de sessão** está como `COOKIE_SAMESITE=none` no `render.yaml`
  porque app e API ficam em domínios diferentes. No dia em que os dois
  estiverem sob um domínio seu (`app.seudominio.com` e `api.seudominio.com`),
  troque para `strict` — é mais seguro.
- **E-mail**: ver a seção abaixo. Com `MAIL_PROVIDER=NONE` a API funciona
  inteira e só a recuperação de senha fica desligada, avisando quem tentar.

## Ligar o "esqueci minha senha" (Resend)

A ordem abaixo não é sugestão. O `ResendMailer` confere `RESEND_API_KEY` e
`MAIL_FROM` **no construtor**, que roda quando a API sobe: trocar
`MAIL_PROVIDER` para `RESEND` antes de a chave existir no painel derruba o
deploy inteiro, não só o e-mail.

1. Crie a conta em <https://resend.com>, com `contato@saldonline.com.br`.
2. **Domínio**: em *Domains*, adicione `saldonline.com.br`. O Resend mostra
   três registros, e os valores reais saem do painel dele:

   | Tipo | Nome | Valor |
   | --- | --- | --- |
   | `TXT` | `resend._domainkey` | a chave DKIM, longa, começando com `p=` |
   | `CNAME` | `send` | `send.forge.rmta.net` |
   | `CNAME` | `rsend` | `rsend-sae1.forge.rmta.net` (o sufixo é a região) |

   Os dois CNAMEs entram com **proxy desligado** (nuvem cinza): proxiados, a
   Cloudflare responderia com os IPs dela e a cadeia de envio quebraria. O TXT
   não tem essa opção — só A, AAAA e CNAME têm.

   **Confira os valores no painel, não aqui.** O Resend já mudou esse conjunto
   uma vez: a documentação dele ainda descreve um `MX` e um `TXT` de SPF em
   `send`, e o produto hoje usa os dois CNAMEs acima. A tabela serve para você
   saber ONDE cada coisa vai; o QUE colar sai da tela.

   Repare onde eles ficam: tudo do Resend mora em nome próprio — `send`,
   `rsend` e `resend._domainkey`. O MX da raiz (Hostinger, que recebe) e o SPF
   da raiz não são tocados. Quem recebe e quem envia são serviços diferentes,
   em nomes diferentes, e não se encostam.

   Deixe **Enable Receiving** desligado: quem recebe é a Hostinger.

   Sem domínio verificado, o Resend entrega **apenas para o e-mail dono da
   conta** — dá para testar, não para usar de verdade.
3. Em *API Keys*, crie uma chave com permissão de envio.
4. No Render, em *Environment*, cole a chave em `RESEND_API_KEY`. **Ela nunca
   entra no repositório**, que é público. `MAIL_FROM` já está versionado no
   `render.yaml`, porque não é segredo.
5. Confira que `APP_URL` é a URL do app: o link do e-mail é montado a partir
   dela.
6. **Só agora** troque `MAIL_PROVIDER` para `RESEND` no `render.yaml` e dê
   push. A API confere as duas variáveis na subida — faltando alguma, o deploy
   falha na hora, em vez de falhar no dia em que alguém esquecer a senha.
7. Teste com uma conta de verdade: peça "esqueci minha senha" e veja o e-mail
   chegar. O endereço `nao-responda@` não precisa de caixa postal — o Resend
   só envia.

O link vale 30 minutos, serve uma vez só e, ao ser usado, derruba as sessões
abertas. Se o envio falhar (domínio não verificado, chave errada), quem pediu
vê a mesma mensagem de sempre e o motivo fica no *Logs* do Render: dizer "esse
e-mail não existe" entregaria quais e-mails têm conta.
- **Domínio próprio**: dá para apontar um depois, nos dois painéis, sem mudar
  nada do código além das variáveis `CORS_ORIGINS` e `APP_URL`.

---

## O app na Play Store (`assetlinks.json`)

Na Play o app é um **TWA**: um invólucro Android que abre o site em tela cheia,
sem barra de endereço. Quem autoriza esse "sem barra de endereço" é o próprio
site, pelo arquivo `web/.well-known/assetlinks.json`.

Duas coisas o identificam, e as duas são rígidas:

- **`package_name`** — `br.com.saldonline.app`. **É permanente.** Depois do
  primeiro envio não se renomeia: um pacote errado só se conserta publicando
  outro app, do zero, sem usuários e sem avaliações.
- **`sha256_cert_fingerprints`** — a impressão da chave que assina o app. No
  Console ela fica em **Test and release > Setup > App integrity**, e é a
  impressão da **chave de assinatura do app** (*app signing key*), **não** a da
  chave de envio (*upload key*). Trocar as duas é o erro clássico: a Play
  aceita o envio, o app instala, e abre com a barra do Chrome à vista.

O Android busca o arquivo em `https://<domínio que o app abre>/.well-known/assetlinks.json`
— o domínio da `start_url`, não o nome do pacote. Ao migrar de
`gestor-financeiro.pages.dev` para `saldonline.com.br`, o arquivo tem de estar
**nos dois** enquanto houver versão apontando para cada um.

---

## O domínio `saldonline.com.br`

Registrado pela Hostinger, mas o registro de um `.com.br` mora sempre no
registro.br — a Hostinger é revendedora. **O titular é o CNPJ da empresa**, e
isso importa além da formalidade: a conta de organização no Play Console
declara o site da organização, e um WHOIS em nome de pessoa física ao lado de
uma conta em nome da empresa é divergência onde não precisava haver.

### Ao mover os nameservers para a Cloudflare

O apex (`saldonline.com.br`, sem `www`) **só funciona no Cloudflare Pages se o
DNS estiver na Cloudflare**: CNAME não existe na raiz de uma zona, e quem
resolve isso é o achatamento que a Cloudflare faz na zona dela. Subdomínio
aceitaria um CNAME em qualquer provedor; a raiz, não.

Trocar o nameserver **apaga a zona da Hostinger**, e com ela o e-mail — sem
erro, sem aviso: quem escrever para `contato@saldonline.com.br` passa a receber
devolução. Estes são os registros que precisam existir na Cloudflare ANTES da
troca valer:

| Tipo | Nome | Valor | Para quê |
| --- | --- | --- | --- |
| `MX` | `@` | `mx1.hostinger.com` (prio 5) | receber e-mail |
| `MX` | `@` | `mx2.hostinger.com` (prio 10) | receber e-mail |
| `TXT` | `@` | `v=spf1 include:_spf.mail.hostinger.com ~all` | quem pode enviar |
| `CNAME` | `hostingermail-a._domainkey` | `hostingermail-a.dkim.mail.hostinger.com` | assinatura |
| `CNAME` | `hostingermail-b._domainkey` | `hostingermail-b.dkim.mail.hostinger.com` | assinatura |
| `CNAME` | `hostingermail-c._domainkey` | `hostingermail-c.dkim.mail.hostinger.com` | assinatura |
| `TXT` | `_dmarc` | `v=DMARC1; p=none` | política de DMARC |
| `TXT` | `@` | `google-site-verification=…` | verificação do site no Play |
| `TXT` | `resend._domainkey` | a chave DKIM do Resend | assinatura do envio |
| `CNAME` | `send` / `rsend` | `*.forge.rmta.net` | envio pelo Resend |

Os registros de e-mail são **proxy desligado** (nuvem cinza) na Cloudflare: MX e
TXT não têm essa opção, e marcar um CNAME de DKIM ou de envio como proxied
quebra a cadeia — a Cloudflare passaria a responder com os IPs dela.

**Nenhum destes pode ser apagado numa limpeza futura.** Em especial o
`google-site-verification`: sem ele o site deixa de estar verificado no Search
Console, e a conta de organização no Play perde a verificação junto. Ele não
parece ter dono, porque não serve a nada visível — e é exatamente por isso que
seria o primeiro a ser removido por quem não souber.

O SPF é **um registro TXT só por nome**: dois TXT de SPF no mesmo nome
invalidam os dois. Isso vale para a raiz, e é por isso que o Resend não entra
aqui — ele usa um subdomínio próprio (`send.`), com SPF separado. A raiz
continua só com a Hostinger.

### Depois da troca

No Pages, `saldonline.com.br` e `www.saldonline.com.br` entram em *Custom
domains*. Com a zona na mesma conta, a Cloudflare cria os registros sozinha e
o certificado cobre os dois nomes.

No Render, em *Environment* (são `sync: false`, moram no painel):

| Key | Value |
| --- | --- |
| `CORS_ORIGINS` | `https://saldonline.com.br,https://www.saldonline.com.br,https://gestor-financeiro.pages.dev` |
| `APP_URL` | `https://saldonline.com.br` |

O `pages.dev` continua na lista de propósito: enquanto houver versão do app ou
atalho apontando para lá, tirá-lo quebraria o login dessas pessoas sem aviso —
o navegador recusa a chamada antes de ela sair. `APP_URL` é só um, porque é o
endereço escrito no link de redefinição de senha, e esse tem de ser canônico.

O `assetlinks.json` precisa responder **em todos os domínios que o app abre**,
porque o Android o verifica por domínio.

### O que ainda é cross-site

`COOKIE_SAMESITE=none` continua necessário: o app está em
`saldonline.com.br` e a API em `onrender.com`, que para o navegador são sites
diferentes. Dar à API um `api.saldonline.com.br` (domínio próprio no Render,
agora fácil porque o DNS está na Cloudflare) permitiria voltar para `strict`,
que é a postura mais segura contra CSRF.

---

## A conta de organização no Play Console

A exigência de **12 testadores por 14 dias** vale só para contas **pessoais**
criadas depois de 13/11/2023. Conta de organização fica fora do escopo da
regra — e conta de organização não existe sem um número D-U-N-S.

### A identidade da empresa

Estes quatro campos precisam ser **idênticos** no D-U-N-S, no perfil de
pagamentos do Google e em qualquer formulário que compare os dois:

| | |
| --- | --- |
| Razão social | `OFIX SERVICOS ADMINISTRATIVOS LTDA` |
| CNPJ | `62.836.488/0001-49` |
| D-U-N-S | `574382940` |
| Endereço | Praça Silviano Brandão, 66, Loja 02 — Centro, Contagem/MG, 32017-680 |
| Site | `https://saldonline.com.br` |
| Contato público | `contato@saldonline.com.br` |
| Contato com o Google | `admin@saldonline.com.br` (alias da caixa acima) |
| Conta no Play Console | **Saldonline**, organização, ID `8016104932395775122` |

O endereço é o da Receita. Não é o que aparece como contato administrativo no
painel do domínio — aquele é pessoal, e usar o errado aqui aciona o prazo de
28 dias que o Google dá para corrigir divergência, sob risco de remover a
conta e os apps.

**Por que dois endereços em @saldonline.com.br.** O Play Console exige que o
contato da organização seja **diferente** do endereço da Conta do Google que
administra a conta, e que **pertença ao domínio do site** da organização. Com
`contato@` sendo a Conta do Google, nem ele nem um endereço pessoal servem —
daí o alias `admin@`, que é outro endereço, do mesmo domínio, entregando na
mesma caixa. Alias e não caixa nova: o plano tem uma só, e o que o Google
precisa é que o endereço exista e seja lido.

É por esse endereço que chega aviso de violação de política e de suspensão.
Se ele parar de receber, o problema aparece com o app já fora do ar.

### O que não se desfaz

**O perfil de pagamentos do Google não permite trocar país, tipo de conta nem
o D-U-N-S depois de criado.** Para mudar qualquer um dos três é preciso montar
um perfil novo, reenviar documentos e revincular. Conferir os campos acima
antes de confirmar o cadastro custa um minuto; errar custa o processo inteiro.

O mesmo vale para o `package_name` do app (`br.com.saldonline.app`): é
permanente desde o primeiro envio.

### Onde o D-U-N-S saiu

Pela ferramenta da Apple — [developer.apple.com/enroll/duns-lookup](https://developer.apple.com/enroll/duns-lookup/) —,
gratuita e imediata, porque a empresa já constava na base da D&B. O D-U-N-S
identifica a empresa, não a loja: o mesmo número serve para Apple e Google.

Fica registrado porque o caminho não é óbvio: o representante da D&B no Brasil
é a CIAL, cuja via gratuita anuncia **30 dias úteis** e cuja via expressa é
vendida como plano anual. O Google diz, na própria ajuda, que o número é
gratuito e adverte sobre terceiros que cobram caro por ele.

---

## O app Android (TWA)

O app na Play é um **TWA**: um invólucro que abre `saldonline.com.br` em tela
cheia. Não há código Android escrito à mão — o projeto é **gerado** pelo
[Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) a partir do
`manifest.webmanifest` do site.

**O projeto mora FORA do repositório**, em `C:Usershenrisaldonline-twa`, e
isso é deliberado: o `bubblewrap init` gera `android.keystore`, a chave que
assina o app, e este repositório é público. O `.gitignore` ainda bloqueia
`twa/` e qualquer `*.keystore` como segunda barreira.

Como consequência, **o que está escrito aqui é a única memória de como refazer
o projeto**.

### Recriar do zero

```
npx @bubblewrap/cli init --manifest=https://saldonline.com.br/manifest.webmanifest
```

No Windows, o PowerShell recusa o `npx.ps1` por política de execução. Chame o
`.cmd`, que não passa por ela:

```
& "C:\Program Files\nodejs\npx.cmd" --yes "@bubblewrap/cli" init --manifest=https://saldonline.com.br/manifest.webmanifest
```

O Bubblewrap baixa o JDK 17 e as *command line tools* do Android sozinho, para
`~/.bubblewrap`. Android Studio não é necessário.

### As respostas que importam

| Campo | Valor | Por quê |
| --- | --- | --- |
| Application ID | `br.com.saldonline.app` | **Tem de ser idêntico ao do `assetlinks.json`.** Divergindo, o app abre com a barra do Chrome à vista, sem mensagem de erro |
| Play Billing | não | A assinatura está fora de alcance (ver `ASSINATURA_VISIVEL`) |
| Notificações | não | O service worker não tem uma linha de push; ligar isso declara `POST_NOTIFICATIONS` e pede ao usuário uma permissão que o app nunca usa |
| Geolocalização | não | O app não usa |

O Bubblewrap sugere `br.com.saldonline.twa` por conta própria. **Não aceite**:
esse nome descreve a técnica de empacotamento, é permanente, e continuaria
dizendo "twa" se um dia o app virar nativo.

Depois do `init`, o `twa-manifest.json` é a fonte de verdade: editar lá e rodar
`npx @bubblewrap/cli update` regenera o projeto. Note que o `update` **sobe a
versão a cada execução** — confira `versionCode` e `versionName` antes de
empacotar.

### Gerar o pacote

Em tese é `npx @bubblewrap/cli build`. **Nesta máquina não funciona**, e os três
motivos valem registro porque nenhum deles diz o que é de verdade:

**1. `gradlew.bat não é reconhecido como um comando interno ou externo`**

A variável de ambiente `NoDefaultCurrentDirectoryInExePath=1` está definida
aqui. Ela proíbe o `cmd` de procurar executáveis no diretório atual — uma
proteção do Windows contra sequestro de comando. O Bubblewrap chama
`gradlew.bat` pelo nome puro, contando com esse comportamento. O arquivo está
lá; o `cmd` se recusa a olhar. **Não é o espaço no caminho**, que foi a
primeira suspeita e estava errada.

**2. `Could not reserve enough space for 1572864KB object heap`**

O Bubblewrap instala um **JDK de 32 bits** mesmo com Node x64. Numa JVM de 32
bits não cabe o heap de 1,5 GB que o `gradle.properties` pede. A máquina tem
8 GB — o limite é de arquitetura, não de memória. Corrigido para `-Xmx1024m`,
que sobra para um TWA.

**3. `minSdkVersion 21 cannot be smaller than version 24`**

O projeto nasce com `minSdkVersion 21`, e a `androidbrowserhelper`, que é o
motor do TWA, exige 24. Inconsistência do próprio gerador. Subir para 24
(Android 7.0) é a saída correta; o `tools:overrideLibrary` que o Gradle sugere
força a barra e, nas palavras dele, "pode levar a falhas em tempo de execução".

### O caminho que funciona

Compilar pelo Gradle, com caminho absoluto:

```
set JAVA_HOME=C:Usershenri.bubblewrapjdkjdk-17.0.11+9
set ANDROID_HOME=C:Usershenri.bubblewrapandroid_sdk
C:Usershenrisaldonline-twagradlew.bat bundleRelease assembleRelease
```

O Gradle precisa de um `local.properties` com `sdk.dir=C:/Users/henri/.bubblewrap/android_sdk`
(barra normal, não invertida: no formato `.properties` a barra invertida é
escape). O Bubblewrap criaria esse arquivo sozinho; como ele não chega a rodar,
é preciso criá-lo à mão.

O Gradle gera **sem assinatura** — o projeto não tem `signingConfigs`, quem
assinaria seria o Bubblewrap. Então a assinatura vai em passo separado:

```
jarsigner -sigalg SHA256withRSA -digestalg SHA-256 -keystore android.keystore -signedjar app-release-bundle.aab appuildoutputsundle
eleaseapp-release.aab android
zipalign -f -p 4 appuildoutputsapk
eleaseapp-release-unsigned.apk app-release-aligned.apk
apksigner sign --ks android.keystore --ks-key-alias android --out app-release-signed.apk app-release-aligned.apk
```

O `.aab` é o que sobe para a Play. O `.apk` serve para instalar no aparelho e
conferir antes.

### A impressão SHA-256, que fecha o circuito

O `assetlinks.json` **aceita várias impressões**, e hoje ele tem uma: a da
**chave de envio** local, extraída do pacote assinado com
`keytool -printcert -jarfile`. É ela que permite instalar o APK no aparelho e
ver o app abrir em tela cheia antes de qualquer envio à Play.

Falta a segunda. Com o Play App Signing, o Google **reassina** o app com uma
chave própria, e a impressão **dela** precisa ser acrescentada à lista depois do
primeiro envio, copiada do Console em *Test and release → Setup → App
integrity*.

Usar só a do keystore local depois de publicar é o erro clássico: a Play aceita
o envio, o app instala, e abre com a barra do Chrome visível. Nada avisa o
motivo. As duas convivem — a local serve para os seus testes, a do Google para
o app publicado.
