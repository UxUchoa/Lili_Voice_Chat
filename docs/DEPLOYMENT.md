# Deploy de produção — Janja Voice Chat

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
key é na verdade uma service-role key, e — com `JANJA_STRICT_ENV=true` ou na
produção da Vercel — quando alguma URL ainda aponta para `127.0.0.1`.

## 0. GitHub

O repositório é a origem de tudo: a Vercel constrói a partir dele e o
`electron-updater` publica os instaladores nos Releases dele.

```powershell
git init -b main
git add .
git commit -m "Janja Voice Chat"
gh repo create janja-voice-chat --private --source . --push
```

Sem o `gh`, crie o repositório vazio pelo site e use
`git remote add origin https://github.com/<owner>/janja-voice-chat.git` seguido
de `git push -u origin main`.

Confira antes do primeiro push que nada de `.env` com valor real entrou:
`git ls-files | Select-String "\.env"` deve devolver só os dois `.env.example`.

Em **Settings → Secrets and variables → Actions**, aba *Variables*:

| Variável | Exemplo |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://abcd.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` |
| `VITE_LIVEKIT_URL` | `wss://livekit.example.com` |
| `VITE_FORCE_TURN` | `false` |
| `VITE_VAPID_PUBLIC_KEY` | chave pública VAPID |
| `VITE_TENOR_API_KEY` | opcional, só para o seletor de GIFs |

Na aba *Secrets*: `CSC_LINK` e `CSC_KEY_PASSWORD` (seção 5).

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
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_API_KEY=…
LIVEKIT_API_SECRET=…
VAPID_SUBJECT=mailto:admin@example.com
VAPID_PUBLIC_KEY=…
VAPID_PRIVATE_KEY=…
PUSH_DISPATCH_SECRET=…
ATTACHMENTS_EXPIRE_SECRET=…
ALLOWED_ORIGIN=https://SEU_DOMINIO,https://*.vercel.app,null
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
3. Limites reais da quota mostrada no painel do usuário (em bytes):

   ```sql
   update public.instance_quota_config
   set database_limit_bytes = 10737418240,
       storage_limit_bytes = 10737418240,
       updated_at = now()
   where singleton;
   ```

E no painel:

- **Authentication → URL Configuration**: Site URL com o domínio de produção;
  Redirect URLs com o domínio, as pré-visualizações e `janja://auth/callback`
  para o desktop.
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

Use `infra/livekit/livekit.production.example.yaml` como base. Em produção:

- publique `wss://` para sinalização;
- Redis persistente e privado;
- API key e secret fora do repositório;
- `use_external_ip` ou o IP público correto;
- 7881/TCP, a faixa UDP do RTC e a faixa UDP de relay abertas;
- TURN/TLS em 443 para redes que bloqueiam UDP;
- certificado TLS válido no domínio do TURN.

Teste **de fora da LAN**, não da mesma rede:

```powershell
$env:LIVEKIT_URL='wss://livekit.example.com'
$env:LIVEKIT_API_KEY='...'
$env:LIVEKIT_API_SECRET='...'
$env:JANJA_FORCE_TURN='true'
npm run test:livekit
```

O resultado precisa informar `participants: 2`, `e2ee: true` e
`relayCandidate: true`.

## 3. Vercel

**Import Project** apontando para o repositório do GitHub. O `vercel.json` já
define tudo — framework, `npm run build:web`, saída em `dist/`, reescrita de
SPA e cabeçalhos. Não sobrescreva pelo painel.

Em **Settings → Environment Variables**, para *Production*, *Preview* e
*Development*:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
VITE_LIVEKIT_URL=wss://livekit.example.com
VITE_FORCE_TURN=false
VITE_VAPID_PUBLIC_KEY=...
VITE_TENOR_API_KEY=...
```

O build falha de propósito se faltar Supabase ou LiveKit — um site publicado
sem backend é uma tela branca com erro de configuração. Para publicar
deliberadamente sem chamadas, use `JANJA_SKIP_LIVEKIT_CHECK=true`.

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
- O sourcemap **não** é publicado. `JANJA_SOURCEMAP=true` liga quando precisar
  depurar um build.

Com o domínio em mãos, volte ao Supabase e ajuste `ALLOWED_ORIGIN` e as
Redirect URLs de Auth. Sem isso o navegador recusa toda chamada às funções de
borda e o login por link não volta para o site.

HTTPS não é opcional: Web Push e as APIs de mídia só existem em origem segura
fora de `localhost`.

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

## 5. Assinatura e auto-update do Windows

Obtenha um certificado Authenticode (de preferência EV ou serviço de assinatura
confiável) e configure em **Settings → Secrets and variables → Actions →
Secrets**:

- `CSC_LINK`: PFX em base64/data URL ou URL segura aceita pelo electron-builder;
- `CSC_KEY_PASSWORD`: senha do certificado.

As *Variables* `VITE_*` da seção 0 alimentam o mesmo validador da Vercel: o
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
- [ ] duas contas e dois dispositivos reais trocam mensagens e anexos E2EE
- [ ] remover acesso gera novo epoch e o dispositivo removido não lê o futuro
- [ ] chamada de áudio, vídeo e tela entre redes diferentes
- [ ] TURN/TLS funciona em rede com UDP bloqueado
- [ ] push chega com o aplicativo fechado
- [ ] anexo enviado há mais de 24 h desapareceu sozinho (cron ativo)
- [ ] o aplicativo instalado consegue entrar numa chamada (`null` em
      `ALLOWED_ORIGIN`)
- [ ] instalador e executáveis retornam assinatura `Valid`
- [ ] versão N atualiza para N+1 e pode ser desinstalada

Funcionalidades P1/P2/P3 do documento de requisitos continuam fora do corte P0.
