# Subir o Gestor Financeiro para a nuvem

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

1. Crie a conta em <https://resend.com>.
2. **Domínio**: em *Domains*, adicione o seu e crie no seu provedor de DNS os
   registros que ele mostrar (SPF e DKIM). Sem domínio verificado, o Resend
   entrega **apenas para o e-mail dono da conta** — dá para testar, não para
   usar de verdade.
3. Em *API Keys*, crie uma chave com permissão de envio e copie.
4. No Render, em *Environment*, três variáveis:

   | Key | Value |
   | --- | --- |
   | `MAIL_PROVIDER` | `RESEND` |
   | `RESEND_API_KEY` | a chave (começa com `re_`) |
   | `MAIL_FROM` | `Gestor Financeiro <nao-responda@seudominio.com>` |

5. Confira que `APP_URL` é a URL do app: o link do e-mail é montado a partir
   dela.
6. **Save, rebuild, and deploy**. A API confere as duas primeiras na subida —
   faltando alguma, o deploy falha na hora, em vez de falhar no dia em que
   alguém esquecer a senha.

O link vale 30 minutos, serve uma vez só e, ao ser usado, derruba as sessões
abertas. Se o envio falhar (domínio não verificado, chave errada), quem pediu
vê a mesma mensagem de sempre e o motivo fica no *Logs* do Render: dizer "esse
e-mail não existe" entregaria quais e-mails têm conta.
- **Domínio próprio**: dá para apontar um depois, nos dois painéis, sem mudar
  nada do código além das variáveis `CORS_ORIGINS` e `APP_URL`.
