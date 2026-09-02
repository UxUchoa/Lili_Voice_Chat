# Deploy de produção — Lili Voice Chat

Quatro peças, nesta ordem. Cada uma depende de um valor que a anterior produz,
e é por isso que a ordem importa: o site precisa da URL do Supabase, o Supabase
precisa do domínio do site para liberar CORS, e o desktop precisa dos dois.

```
Supabase  →  LiveKit/TURN  →  Vercel (web)  →  GitHub Releases (desktop)
  ↑                                │
  └──── ALLOWED_ORIGIN + Auth URLs ┘
```

## Regra que não tem exceção

Tudo com prefixo `VITE_` é embutido em texto puro no bundle e fica visível para
qualquer visitante. `SUPABASE_SERVICE_ROLE_KEY`, `LIVEKIT_API_SECRET`,
`VAPID_PRIVATE_KEY`, `PUSH_DISPATCH_SECRET`, `ATTACHMENTS_EXPIRE_SECRET` e o
certificado de assinatura **nunca** entram numa variável `VITE_`.

`npm run build:web` recusa o build quando isso acontece, quando a publishable
key é na verdade uma service-role key, e — com `LILI_STRICT_ENV=true` ou na
produção da Vercel — quando alguma URL ainda aponta para `127.0.0.1`.

## 0. GitHub

O repositório é a origem de tudo: a Vercel constrói a partir dele e o
`electron-updater` publica os instaladores nos Releases dele.

```powershell
git init -b main
git add .
git commit -m "Lili Voice Chat"
gh repo create Lili_Voice_Chat --private --source . --push
```

Sem o `gh`, crie o repositório vazio pelo site e use
`git remote add origin https://github.com/<owner>/Lili_Voice_Chat.git` seguido
de `git push -u origin main`.

Confira antes do primeiro push que nada de `.env` com valor real entrou:
`git ls-files | Select-String "\.env"` deve devolver só os dois `.env.example`.

Em **Settings → Secrets and variables → Actions**, aba _Variables_:

| Variável                        | Exemplo                             |
| ------------------------------- | ----------------------------------- |
| `VITE_SUPABASE_URL`             | `https://abcd.supabase.co`          |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…`                  |
| `VITE_LIVEKIT_URL`              | `wss://<projeto>.livekit.cloud`     |
| `VITE_FORCE_TURN`               | `false`                             |
| `VITE_VAPID_PUBLIC_KEY`         | chave pública VAPID                 |
| `VITE_TENOR_API_KEY`            | opcional, só para o seletor de GIFs |

Na aba _Secrets_: `CSC_LINK` e `CSC_KEY_PASSWORD` (seção 5).

`vendor/openmls` não é versionado — são 19 MB de terceiro mais um `target/` que
passa de 1 GB. Quem precisar recompilar o wrapper WASM roda
`npm run vendor:openmls`, que clona o commit fixado e aplica
`patches/openmls-wasm.patch`. O `.wasm` compilado está versionado, então nem a
Vercel nem o build do desktop precisam de Rust.

## 1. Supabase

```powershell
npx supabase login
npm run deploy:supabase -- --project-ref YOUR_PROJECT_REF
```

O script faz `link`, `db push`, envia os segredos e implanta **as quatro**
funções com o `verify_jwt` que cada uma declara no `config.toml` — implantar
`attachments-expire` com o padrão a deixaria inacessível para o agendador.
Antes de rodar, crie `supabase/functions/.env.production` a partir de
`supabase/functions/.env.example`:

```text
LIVEKIT_URL=wss://<projeto>.livekit.cloud
LIVEKIT_API_KEY=…
LIVEKIT_API_SECRET=…
VAPID_SUBJECT=mailto:admin@example.com
VAPID_PUBLIC_KEY=…
VAPID_PRIVATE_KEY=…
PUSH_DISPATCH_SECRET=…
ATTACHMENTS_EXPIRE_SECRET=…
ACCOUNTS_PRUNE_SECRET=…
ALLOWED_ORIGIN=https://lilivoicechat-five.vercel.app,https://*.vercel.app,null
```

Gere cada segredo com
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
e o par VAPID com `npx web-push generate-vapid-keys`.

`ALLOWED_ORIGIN` é uma lista: o domínio de produção, o curinga das
pré-visualizações da Vercel e `null` — este último libera o desktop
empacotado, que carrega o `dist/` por `file://` e manda `Origin: null`. Sem ele
nenhuma chamada de voz conecta no aplicativo instalado. Você só conhece o
domínio depois da seção 3; volte aqui e rode
`npx supabase secrets set ALLOWED_ORIGIN=…` quando souber.

Depois, no **SQL Editor** do painel (o CLI não faz):

1. `supabase/snippets/schedule_push_dispatch.sql` — despacha a fila de push a
   cada minuto.
2. `supabase/snippets/schedule_attachments_expire.sql` — apaga os anexos
   vencidos a cada cinco minutos. Sem isto o arquivo de 24 h só some quando
   alguém abre o aplicativo, e a promessa deixa de valer para conversa parada.
3. `supabase/snippets/schedule_accounts_prune.sql` — uma vez por dia,
   transforma em lápide a conta parada há 90 dias. **Antes de ligar**, veja o
   alcance sem executar nada: a função aceita `{"dryRun": true}` e devolve
   quantas contas casam e desde quando a mais antiga está parada.
4. Limites reais da quota mostrada no painel do usuário (em bytes):

   ```sql
   update public.instance_quota_config
   set database_limit_bytes = 10737418240,
       storage_limit_bytes = 10737418240,
       updated_at = now()
   where singleton;
   ```

E no painel:

- **Authentication → URL Configuration**: a **Site URL** continua sendo
  `https://lilivoicechat-five.vercel.app`, e as **Redirect URLs** o mesmo
  domínio mais `https://*.vercel.app/**` para as pré-visualizações. Nenhum
  e-mail leva link desde a mudança para código (seção 3b), mas a Site URL ainda
  identifica o projeto em outros lugares do painel.
- **Authentication → Providers → Email**: ligue _Confirm email_ **depois** de
  configurar o SMTP do Brevo — a ordem importa, porque com o servidor embutido
  o cadastro esbarra em `email rate limit exceeded` e a confirmação vira um
  portão que ninguém atravessa. Os passos estão na seção 3b.
- **Settings → Storage**: limite de upload em **101 MiB**. O bucket
  `attachments` aceita 104861696 bytes (100 MiB + a folga de 4 KB da tag do
  AES-GCM); um teto global menor recusa o upload antes de a política ser
  consultada.
- **Storage → Buckets**: confirme que `attachments`, `avatars`, `banners`,
  `gdm-icons` e `server-icons` continuam **privados**.

Valide o schema hospedado:

```powershell
npx supabase db lint --linked --schema public --level warning
```

Rode `npm run test:db` localmente antes de qualquer `db push`.

## 2. LiveKit e TURN

### LiveKit Cloud (caminho escolhido)

Em <https://cloud.livekit.io> crie um projeto e anote, em _Settings → Keys_:

| Valor                               | Onde vai                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| URL `wss://<projeto>.livekit.cloud` | `VITE_LIVEKIT_URL` (Vercel + GitHub Variables) **e** `LIVEKIT_URL` (segredo da Edge Function) |
| API Key                             | `LIVEKIT_API_KEY` (só no segredo da função)                                                   |
| API Secret                          | `LIVEKIT_API_SECRET` (só no segredo da função)                                                |

A URL é pública — ela vai para o bundle de qualquer jeito. **Key e secret não**:
quem os tem emite token para qualquer sala. Eles vivem apenas nos segredos das
Edge Functions, que é quem assina o token de acesso do usuário.

O Cloud já entrega `wss://`, TURN/TLS em 443 e Redis; não há nada de
infraestrutura para manter. Mantenha `VITE_FORCE_TURN=false`: o TURN entra
sozinho quando o UDP direto falha, e forçar relay em todo mundo só adiciona um
salto. O plano gratuito tem teto de minutos e de participantes simultâneos —
confira antes de abrir para um grupo grande.

O SFU processa a mídia em claro, então quem hospeda o LiveKit é superfície de
confiança da chamada. É o critério que costuma decidir entre o serviço
gerenciado e o auto-hospedado.

### Alternativa: auto-hospedado

`infra/livekit/livekit.production.example.yaml` é a base. Nesse caminho você
assume:

- `wss://` para sinalização com certificado válido;
- Redis persistente e privado;
- `use_external_ip` ou o IP público correto;
- 7881/TCP, a faixa UDP do RTC e a faixa UDP de relay abertas;
- TURN/TLS em 443 para redes que bloqueiam UDP.

### Teste, nos dois casos

Teste **de fora da LAN**, não da mesma rede:

```powershell
$env:LIVEKIT_URL='wss://<projeto>.livekit.cloud'
$env:LIVEKIT_API_KEY='...'
$env:LIVEKIT_API_SECRET='...'
$env:LILI_FORCE_TURN='true'
npm run test:livekit
```

O resultado precisa informar `participants: 2`, `e2ee: true` e
`relayCandidate: true`.

## 3. Vercel

**Import Project** apontando para o repositório do GitHub. O `vercel.json` já
define tudo — framework, `npm run build:web`, saída em `dist/`, reescrita de
SPA e cabeçalhos. Não sobrescreva pelo painel.

Em **Settings → Environment Variables**, para _Production_, _Preview_ e
_Development_:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_LIVEKIT_URL=wss://<projeto>.livekit.cloud
VITE_FORCE_TURN=false
VITE_VAPID_PUBLIC_KEY=...
VITE_TENOR_API_KEY=...
VITE_SITE_URL=https://<seu-domínio>
```

O build falha de propósito se faltar Supabase ou LiveKit — um site publicado
sem backend é uma tela branca com erro de configuração. Para publicar
deliberadamente sem chamadas, use `LILI_SKIP_LIVEKIT_CHECK=true`.

O que o `vercel.json` garante e vale conferir depois do primeiro deploy:

- `Content-Security-Policy` restrita, montada no build a partir das origens
  reais deste ambiente — só o seu Supabase, o seu LiveKit, o Tenor e o Google
  Fonts entram em `connect-src`. Veja `vite.config.ts`.
- `frame-ancestors 'none'` e `X-Frame-Options: DENY` (a meta CSP não consegue
  declarar `frame-ancestors`; por isso ele vem por cabeçalho).
- `Permissions-Policy` liberando câmera, microfone e captura de tela **apenas**
  para a própria origem.
- HSTS de dois anos, `Referrer-Policy: no-referrer`, `nosniff`.
- `/assets/*` imutável por um ano; `push-sw.js` e `index.html` sempre
  revalidados — um service worker em cache é um aplicativo velho preso no
  navegador do usuário.
- O sourcemap **não** é publicado. `LILI_SOURCEMAP=true` liga quando precisar
  depurar um build.

Com o domínio em mãos, volte ao Supabase e ajuste `ALLOWED_ORIGIN` e as
Redirect URLs de Auth. Sem isso o navegador recusa toda chamada às funções de
borda e o login por link não volta para o site.

HTTPS não é opcional: Web Push e as APIs de mídia só existem em origem segura
fora de `localhost`.

## 3b. Verificação por código, recuperação e expurgo

### Código de e-mail pelo Brevo

A confirmação de cadastro e a recuperação de senha usam um **código de seis
dígitos**, não link. O link precisava de um endereço de retorno, e o desktop
empacotado vive em `file://` — nenhum provedor de e-mail sabe abrir isso, então
a confirmação só se completava pelo site, num navegador diferente do aplicativo
onde a pessoa estava.

O código é gerado, expirado e conferido pelo próprio Supabase Auth. O Brevo
entra só como transporte, e é ele que resolve o limite de envio que mantinha a
confirmação desligada.

No painel do projeto:

1. **Project Settings → Authentication → SMTP Settings** → _Enable Custom SMTP_.
   Host `smtp-relay.brevo.com`, porta `587`, usuário e senha vindos de
   **SMTP & API → SMTP** no painel do Brevo (a senha é a *chave SMTP*, não a
   senha da conta). Gere a chave na variante **padrão, de 64 caracteres** — a
   curta existe para sistemas antigos com limite de campo, e o Supabase não
   tem esse limite. Remetente num domínio verificado no Brevo, senão a entrega
   cai em spam.

   > A chave "sem expiração" **morre depois de 90 dias consecutivos sem uso**.
   > Aqui ela só é acionada por cadastro ou recuperação de senha, então um
   > período parado a invalida em silêncio — e o sintoma aparece como cadastro
   > que parou de funcionar sem ninguém ter mexido no código.
2. **Authentication → Providers → Email** → ligue _Confirm email_.
3. **Authentication → Email Templates** → cole o conteúdo de
   `supabase/templates/confirmation.html` e `supabase/templates/recovery.html`.
   Os dois usam `{{ .Token }}`; um modelo que ainda tenha `{{ .ConfirmationURL }}`
   volta a mandar link.
4. **Authentication → Providers → Email** → _Email OTP Expiration_ em `600`
   segundos. Uma hora é generoso demais para seis dígitos.

O ambiente local não usa o Brevo: `[auth.email.smtp]` fica desligado no
`config.toml` e o e-mail cai no Mailpit (`http://127.0.0.1:54324`). É o que
permite ao `e2e/local-email-otp.spec.ts` ler o código e provar o fluxo inteiro
sem mandar mensagem para ninguém.

> O `config.toml` **não** é enviado pelo deploy — `npm run deploy:supabase` faz
> `db push`, `secrets set` e `functions deploy`, e nada mais. Os quatro passos
> acima são manuais no painel.

### Chave de recuperação

A chave continua existindo, e não foi substituída pelo código: o código chega
no e-mail e resolve o caso comum, enquanto a chave é para quem também perdeu o
acesso à caixa de entrada.

Ela é **única**, entregue no cadastro e mostrada uma vez. O
botão de entrar só destrava depois que a pessoa confirma ter guardado, porque
é o único momento em que dá para avisar: quem perde a chave perde a conta.

O servidor guarda apenas o SHA-256 da chave normalizada — 160 bits de
entropia, sem dicionário a atacar — e o cadastro nunca transmite a chave em si.
Recuperar troca a senha, derruba todas as sessões vivas e emite uma chave nova;
a anterior morre na mesma operação. Cinco erros travam a conta por quinze
minutos, e chave errada, conta inexistente e conta expurgada respondem a mesma
coisa, para que ninguém descubra quem tem conta perguntando.

Conta criada antes de a chave existir recebe a dela no primeiro login.

Conta sem login por 90 dias vira **lápide**: login, senha, sessões,
dispositivos e chaves são destruídos e a identidade é anonimizada, mas
mensagens, canais e servidores permanecem. Um servidor cujo dono sumiu passa
para o administrador mais antigo; sem ninguém, é apagado.

Ajuste o prazo com `ACCOUNTS_PRUNE_DAYS` nos segredos das funções.

## 4. Push remoto

Cadastre uma assinatura num navegador real, mande uma mensagem de outra conta e
confirme:

1. uma linha genérica foi criada em `notification_envelopes`;
2. o cron invocou `push-dispatch`;
3. a notificação não contém texto, nome de anexo nem chave;
4. endpoints 404/410 foram removidos;
5. falhas transitórias incrementaram `attempt_count` e `next_attempt_at`.

O dispatcher exige o header `x-push-secret`; `attachments-expire` aceita
`x-cron-secret` ou uma sessão autenticada. Nenhum dos dois valores vai para o
cliente.

## 5. O aplicativo desktop

O desktop não é um navegador apontado para o site: ele carrega o mesmo `dist/`
de dentro do próprio pacote, por `file://`. Isso é o que dá janela sem barra de
endereço, bandeja, notificação do sistema, captura de tela pelo
`desktopCapturer` e — o que mais importa aqui — chave de dispositivo protegida
pela DPAPI, em vez do `sessionStorage` que a web perde a cada sessão.

O preço é que três coisas mudam de comportamento fora do `http://`, e nenhuma
delas falha de forma visível:

- **`/assets/...` deixa de existir.** O caminho absoluto do Vite vira
  `file:///C:/assets/...` e a janela abre em branco, sem um erro sequer no
  console. Por isso o build do desktop roda com `LILI_DESKTOP_BUILD=true`, que
  troca o `base` para relativo. A web continua absoluta: o `rewrites` da Vercel
  serve o `index.html` em qualquer profundidade, e ali um caminho relativo
  apontaria para fora de `/assets`.
- **`window.location.origin` vale a string `"file://"`.** Endereço montado em
  cima disso vira `file:///#/invite/CODE`. Quem resolve é `VITE_SITE_URL`,
  obrigatória neste build.
- **Service worker não registra.** O push remoto se desliga sozinho no desktop;
  quem avisa é a bandeja, pelo processo principal. O aplicativo não fecha,
  minimiza.

Para gerar o instalador apontado para produção:

```powershell
npm run desktop:dist
```

O script `scripts/build-desktop.ps1` valida a configuração em modo estrito,
constrói, **fuma o `dist/` por `file://`**, empacota, fuma de novo o `dist/` de
dentro do `app.asar` e só então copia o instalador e o `SHA256SUMS.txt` para
`release/`. O teste é `scripts/test-desktop-smoke.mjs`, e roda sozinho com
`npm run desktop:smoke`.

Os valores de produção saem de `.env.production` (ignorado pelo git; o modelo
está em `.env.example` e os valores reais em `vercel-env.local.txt`). No modo
production do Vite ele sobrepõe o `.env.local`, e é isso que impede um
instalador de sair da máquina falando com `127.0.0.1`.

**Não existe build local do instalador, de propósito.** Um executável apontado
para `127.0.0.1` não roda na máquina de mais ninguém, e isso só se descobre
depois de distribuí-lo. Para ver o aplicativo nativo rodando sobre a
infraestrutura publicada sem empacotar nada, `npm run desktop:prod` — o mesmo
Electron, sobre um servidor Vite em modo production.

`ALLOWED_ORIGIN` precisa conter `null`: o aplicativo instalado manda
`Origin: null` nas chamadas às funções de borda, e sem essa entrada o token do
LiveKit falha como erro de CORS — nada na interface fala em mídia.

## 5b. Assinatura e auto-update do Windows

Obtenha um certificado Authenticode (de preferência EV ou serviço de assinatura
confiável) e configure em **Settings → Secrets and variables → Actions →
Secrets**:

- `CSC_LINK`: PFX em base64/data URL ou URL segura aceita pelo electron-builder;
- `CSC_KEY_PASSWORD`: senha do certificado.

As _Variables_ `VITE_*` da seção 0 alimentam o mesmo validador da Vercel: o
workflow para antes de empacotar se a configuração pública estiver ausente,
apontando para `127.0.0.1` ou carregando um segredo.

Crie uma tag `vX.Y.Z`. O `.github/workflows/release.yml`:

- executa testes, typecheck e `build:web`;
- usa `forceCodeSigning=true`;
- publica pelo provider GitHub do `electron-updater`;
- falha se `Get-AuthenticodeSignature` não retornar `Valid`;
- exige `release/latest.yml`.

Para validar o mecanismo sem publicar nem sair da máquina,
`npm run test:update-installed` cria instaladores N e N+1, hospeda o feed só em
`127.0.0.1`, confirma `update-downloaded`, verifica a versão instalada e
desinstala ao final. Ele não substitui o teste com duas versões reais:

1. publique e instale a versão N;
2. aumente `version` no `package.json` e publique N+1;
3. abra N e use **Atualizações do aplicativo → Verificar atualizações**;
4. confirme download, reinício, assinatura válida e versão N+1;
5. repita depois de reiniciar o Windows e valide o desinstalador.

Uma build autoassinada não estabelece confiança para usuário final.

## 6. Checklist de aceite externo

- [ ] `git ls-files` não lista nenhum `.env` com valor real
- [ ] duas contas e dois dispositivos reais trocam mensagens e anexos
- [ ] remover acesso gera novo epoch e o dispositivo removido não lê o futuro
- [ ] chamada de áudio, vídeo e tela entre redes diferentes
- [ ] TURN/TLS funciona em rede com UDP bloqueado
- [ ] push chega com o aplicativo fechado
- [ ] anexo enviado há mais de 24 h desapareceu sozinho (cron ativo)
- [ ] a chave de recuperação troca a senha e a chave antiga deixa de valer
- [ ] uma conta antiga, sem chave, recebe a dela no primeiro login
- [ ] `list_inactive_accounts(90)` devolve o que você espera antes de o
      expurgo rodar pela primeira vez
- [ ] o aplicativo instalado abre a tela de login (janela em branco significa
      `dist/` empacotado com caminho absoluto)
- [ ] o aplicativo instalado consegue entrar numa chamada (`null` em
      `ALLOWED_ORIGIN`)
- [ ] o convite copiado do aplicativo instalado abre no navegador de outra
      máquina (`VITE_SITE_URL`)
- [ ] instalador e executáveis retornam assinatura `Valid`
- [ ] versão N atualiza para N+1 e pode ser desinstalada

Funcionalidades P1/P2/P3 do documento de requisitos continuam fora do corte P0.
