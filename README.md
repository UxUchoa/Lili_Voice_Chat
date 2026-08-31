# Lili — Voice Chat

Cliente Web + Electron para mensagens, áudio, vídeo e compartilhamento de tela. O ambiente local usa Supabase, LiveKit/TURN e OpenMLS por dispositivo; não há fallback com dados demonstrativos.

## Estado atual

- Navegação em dois contextos que nunca se misturam, como no Discord: a Home
  (amigos, conversas diretas e solicitações) e um servidor por vez. Clicar no
  ícone da aplicação desmonta o servidor inteiro — nome, categorias, canais,
  membros e menus somem. O endereço acompanha o contexto
  (`#/channels/@me`, `#/channels/@me/<conversa>`, `#/channels/<servidor>/<canal>`),
  então atualizar a página, colar um link ou usar voltar/avançar levam ao mesmo
  lugar.
- Canais criados por modal, com tipo (texto, voz ou categoria), nome, categoria
  e privacidade decididos antes de qualquer coisa existir. Um canal criado
  dentro de uma categoria já nasce herdando as permissões dela.
- Editor de canal no formato do Discord: visão geral (nome, tópico, modo lento,
  limite de voz) e permissões por cargo ou membro com os três estados
  negar/herdar/permitir, além de ressincronizar com a categoria e excluir.
  Acessível pelo menu de contexto do canal e pelas configurações do servidor.
- Anexos com prévia no chat: imagem e vídeo tocam ali mesmo, com visualizador
  em tela cheia. Cada arquivo aceita até 100 MB, vive 24 h no servidor e depois
  some — quem perdeu o prazo pede o reenvio para quem mandou.
- Seletor de GIFs (API do Tenor) e de emoji no compositor. O GIF escolhido é
  baixado e enviado como anexo cifrado, não como link: postar a URL entregaria
  ao Tenor quem abriu a conversa e deixaria o arquivo fora da validade e do
  limite de tamanho.
- Perfil de servidor real: nome, ícone (com recorte, zoom e reposicionamento) e
  descrição definidos no modal de criação, editáveis depois por quem tem
  MANAGE_SERVER e reaproveitados na barra de servidores, no cabeçalho e nas
  configurações. Servidor sem ícone usa o monograma do próprio nome.
- Chamadas com toque: quem liga fica em "Chamando…" e pode cancelar; quem
  recebe vê um modal acima de qualquer tela com atender só com áudio, atender
  com vídeo ou recusar. Atendida, recusada, cancelada e não atendida são
  estados persistidos e sincronizados entre as duas contas.
- Identidade sonora própria sintetizada com Web Audio: toque em laço
  ("tutu tutu tum tum"), som de entrada grave e ascendente e som de saída mais
  agudo e seco, cada um disparado apenas por uma transição real de presença.
- Solicitações de mensagem: uma conversa iniciada por quem ainda não é amigo
  chega numa fila própria da Home, com aceitar e recusar.
- Recuperação de senha por link de e-mail, com tela própria: o link autentica
  e o aplicativo se interpõe antes de abrir para exigir a senha nova, em vez de
  deixar a pessoa entrar achando que trocou. Trocar encerra as outras sessões.
  E-mail cadastrado e desconhecido recebem a mesma resposta.
- Conta sem login por 90 dias vira lápide: acesso e identidade destruídos,
  conversa preservada. Servidor órfão passa para o administrador mais antigo.
- Supabase Auth, PostgreSQL, RLS, RPCs transacionais, Realtime, Storage privado e Edge Functions.
- Mensagens e anexos E2EE: o Supabase armazena ciphertext e metadados mínimos, nunca colunas de plaintext.
- OpenMLS WASM com identidade e KeyPackages por dispositivo, persistência local cifrada, `ADD_COMMIT`, `REMOVE_COMMIT`, epoch monotônico e exporter de chave de mídia.
- Remover acesso ao canal ou revogar dispositivo torna o alvo elegível a `MLS Remove`; somente o fundador ativo do grupo pode publicar o commit.
- LiveKit SFU com E2EE de áudio/vídeo/tela derivada do epoch MLS e TURN UDP/TLS configurável.
- Push Web Push/VAPID com preferências `ALL`, `MENTIONS` e `NONE`, fila atômica, backoff e payload genérico sem conteúdo.
- Notificação foreground nativa/Web após decisão de entrega no banco e descriptografia local; escopos GLOBAL/SERVER/CHANNEL e silêncio temporário.
- GDM com escolha de membros, nome, ícone privado e gestão de acesso; sessões Auth revogáveis e dashboard de quota real DB/Storage.
- Electron com sandbox, `contextIsolation`, IPC validado, DPAPI via `safeStorage`, NSIS, tray e `electron-updater`.
- Workflow de release que exige certificado válido e publica instalador, blockmap e metadata no GitHub Releases.

O instalador local é funcional, mas permanece `NotSigned` até que um certificado de code signing seja fornecido ao workflow. Câmera, microfone e compartilhamento exigem autorização explícita do sistema/navegador.

## Pré-requisitos

- Node.js 22+
- Docker Desktop com virtualização habilitada
- PowerShell 7 ou Windows PowerShell
- Rust + target `wasm32-unknown-unknown` somente para alterar o wrapper
  OpenMLS. O `.wasm` compilado está versionado, e `npm run vendor:openmls`
  recria `vendor/openmls` a partir do commit fixado mais
  `patches/openmls-wasm.patch` — o clone em si não é versionado

## Rodar o ambiente online local

Copie `.env.example` para `.env.local`, preencha a publishable key retornada por `npx supabase status -o env` e crie `supabase/functions/.env.local` com os segredos locais de LiveKit. Nunca coloque service-role key no frontend.

Depois instale as dependências e inicie toda a stack:

```powershell
npm ci
npm run local:up
```

O comando acima abre/prepara o Docker Desktop, inicia Supabase e LiveKit/TURN,
aplica migrations e mantém Vite + Edge Functions em execução. Acesse
`http://127.0.0.1:5173/` e mantenha o terminal aberto.

Para validar duas contas e a mídia local:

```powershell
npm run test:local
```

Esse comando prepara a infraestrutura, cria e remove contas temporárias, testa o
workspace compartilhado, conversa OpenMLS e chamada real em dois contextos de
navegador, câmera/tela/dispositivos, navegação mobile, moderação de voz,
heartbeat e limpeza de presença abandonada, LiveKit/TURN, banco/RLS, frontend,
typecheck e build. Para o aceite com hardware, siga também o
[checklist manual da manhã](docs/MORNING_TEST_CHECKLIST.md).

Abra `http://127.0.0.1:5173`. O script LiveKit detecta o IPv4 LAN do Windows e gera `infra/livekit/livekit.local.yaml`; se necessário, informe manualmente:

```powershell
powershell -File scripts/configure-livekit-local.ps1 -NodeIp 192.168.1.20
```

## Testes

```powershell
npm run typecheck
npm test
npm run test:db
npm run test:workspace
npm run test:chat
npm run test:livekit
npm run test:update-installed
npm run build
npm audit --audit-level=high
```

`test:livekit` cria dois participantes sintéticos, publica áudio com E2EE e, por padrão, exige candidato TURN `relay`. Ele não solicita câmera ou microfone.

Resultados locais mais recentes:

- 56/56 testes TypeScript/Vitest, incluindo a identidade sonora (toque em laço,
  entrada e saída distintas, volume padrão audível), as rotas da navegação e o
  CORS das funções de borda (origem exata, curinga de pré-visualização,
  `null` do desktop e a recusa de sufixo forjado)
- 269/269 testes pgTAP de RLS, RPC, Storage, MLS, recuperação de grupo vazio, convites, menções, cargos/ícones, GDM, sessões, quota, histórico/heartbeat de chamadas, limite/movimentação de voz, dispositivos e push
- 3/3 testes nativos OpenMLS
- 7/7 cenários Playwright em navegador, incluindo a separação entre Home e servidor (o contexto do servidor desaparece por completo ao voltar para a Home), incluindo quick switcher por teclado com servidor/DM real, GDM com quatro contas/ícone privado, notificação desktop, Markdown, sessões reais, quota, categorias, limite real de canal de voz e navegação mobile em 390 × 844
- duas sessões isoladas trocando mensagens, respostas, reações, pins, exclusão, anexos e menções de usuário/cargo/`@everyone`/`@here` via OpenMLS no mesmo canal; edições consecutivas preservam anexos e atualizam metadados de menção
- duas contas entrando pela UI na mesma chamada, com contador real, heartbeat, troca de microfone/câmera/saída, publicação e remoção de tela, sobrevivência a restart do LiveKit e histórico persistido ao sair
- moderação de voz real (mute/deafen/move/disconnect), move com nova sessão/chave E2EE no destino, dois participantes LiveKit, áudio E2EE e TURN relay confirmados
- schema público sem erros de lint e auditoria npm sem vulnerabilidades
- ciclo NSIS instalado 0.1.0 → auto-update 0.1.1 → desinstalar aprovado por feed HTTP restrito a `127.0.0.1`

## Desktop

```powershell
npm run desktop:dev
npm run desktop:dist
```

Os artefatos ficam em `release/`. Builds locais sem assinatura servem para
validação interna e não devem ser distribuídos como release oficial.

Builds locais não apontam para um servidor fictício de atualização. O canal de
auto-update só é incluído pelo workflow de release (GitHub) ou pelo harness local
de atualização; uma build sem canal configurado informa esse estado na interface.

## Produção

O caminho inteiro está em [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), na ordem em
que precisa ser seguido — cada etapa produz um valor que a seguinte consome:

```
Supabase  →  LiveKit/TURN  →  Vercel (web)  →  GitHub Releases (desktop)
```

Resumo dos comandos:

```powershell
npm run deploy:supabase -- --project-ref YOUR_PROJECT_REF   # schema, segredos e as 4 funções
npm run build:web                                           # o mesmo build que a Vercel roda
```

`build:web` valida a configuração pública antes de compilar: recusa URL de
`127.0.0.1` em produção, recusa uma service-role key colada no lugar da
publishable key e recusa qualquer segredo com prefixo `VITE_` — tudo com esse
prefixo vai em texto puro para o navegador. O `vercel.json` cuida da reescrita
de SPA, do cache e dos cabeçalhos de segurança; a CSP restrita é montada no
build a partir das origens reais do ambiente (`vite.config.ts`).

Funcionalidades P1/P2/P3 do documento de requisitos continuam fora do corte P0.
