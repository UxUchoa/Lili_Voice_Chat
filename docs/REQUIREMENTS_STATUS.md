# Lili — estado dos requisitos

Revisão local de 29/08/2026, baseada no documento de requisitos anexado e em
testes executados contra Supabase, Realtime, OpenMLS e LiveKit/TURN locais.

> **Desatualizado quanto à criptografia.** Em 01/09/2026 o E2EE foi removido do
> produto por decisão de escopo: o OpenMLS saiu inteiro, mensagens e anexos
> passaram a ser gravados legíveis e a proteção passou a ser autenticação do
> Supabase mais RLS. A mídia do LiveKit também deixou de ser cifrada ponta a
> ponta. Todo item abaixo que menciona OpenMLS, epoch, KeyPackage ou mídia E2EE
> descreve o estado anterior a essa data.

## Funcional e validado

- Home e servidores são contextos separados: a Home tem barra lateral própria
  (amigos, solicitações de mensagem e conversas diretas) e o servidor mostra
  canais, categorias e membros. Nenhum elemento de servidor sobrevive à volta
  para a Home, e o endereço reflete o contexto para refresh e links diretos.
- Criação e edição de canal completas: modal com tipo/nome/categoria/privado,
  herança das permissões da categoria na criação, editor com tópico, modo
  lento, limite de voz e overrides por cargo/membro, ressincronização com a
  categoria e exclusão — tudo validado no banco e coberto por pgTAP.
- Perfil do servidor com nome, ícone e descrição: criado no modal (com
  validação de nome vazio ou só com espaços, recorte/zoom/troca/remoção do
  ícone e feedback de erro sem fechar o modal), persistido em banco e Storage,
  editável depois e reaproveitado em toda a interface.
- Chamadas privadas com sinalização de toque: convite persistido por
  destinatário, modal de chamada recebida global, três respostas (áudio, vídeo
  ou recusar), cancelamento pelo originador e expiração automática de chamada
  não atendida. Bloqueio impede a chamada no banco, não só na interface.
- Sons próprios de toque, entrada e saída, com guarda contra reconexão,
  renegociação e eventos duplicados.
- Solicitações de mensagem com fila própria, badges, aceitar/recusar e
  reabertura automática da conversa quando chega mensagem nova.
- Contadores de não lidas por conversa direta e na barra de servidores.
- Autenticação Supabase, cadastro, login, logout, recuperação e alteração de senha; sessões reais são listadas e revogadas individualmente ou em lote, e a troca de senha encerra as demais sessões.
- Perfis e preferências de privacidade persistidos com RLS.
- Perfil P0 completo na UI: nome, username, avatar, banner, bio, pronomes, status personalizado e presença, incluindo mídia privada persistida.
- Criação, atualização, transferência, saída e exclusão de servidores.
- Convites persistidos, expiração/limite/revogação, entrada de uma segunda conta e atualização Realtime.
- Canais de texto/voz, atualização, privacidade, slowmode imposto no banco, limite transacional de participantes de voz, duplicação, reordenação e exclusão.
- Categorias reais com criação, edição, ocultação, recolhimento persistido, movimentação de canais, sincronização opcional de permissões e exclusão pela UI.
- Cargos com hierarquia, cor, ícone Unicode, hoist/mentionable, atribuição/remoção, duplicação/reordenação, overrides por cargo/membro e simulação combinada “ver como cargo”.
- O cargo `@everyone` é editável em cor, ícone e permissões por quem administra
  cargos (nome e “exibir separadamente” seguem travados, porque todo mundo tem
  esse cargo). O editor mostra o resultado do salvamento na própria barra de
  ações, com “Descartar” e o erro do banco traduzido.
- Quem cria o servidor recebe um cargo “Administração” com `ADMINISTRATOR`, e o
  `@everyone` fica no piso de quem entra depois: ver canais, enviar mensagens,
  entrar na voz, reagir e anexar. `ADMINISTRATOR` agora vale no banco, não só
  no cliente.
- O editor de cargo lista os canais privados do servidor e libera o acesso de
  cada um com um interruptor, gravando o override na hora — antes isso só
  existia canal a canal.
- Anexos: teto de 100 MB por arquivo (tabela, bucket e cliente com o mesmo
  número), validade de 24 h e pedido de reenvio quando o prazo passa. A
  remoção roda na função de borda `attachments-expire`, porque o Supabase
  recusa `delete` direto em `storage.objects`.
- Imagem, vídeo e áudio aparecem tocáveis na mensagem, com visualizador em
  tela cheia; arquivos acima de 8 MB esperam um clique para decifrar.
- Seletor de GIFs e emoji no compositor. Emoji são os Unicode padrão, com
  busca sem acento e lista de usados com frequência. GIFs vêm do Tenor com
  `VITE_TENOR_API_KEY`; sem a chave o seletor explica o que falta em vez de
  quebrar.
- Nenhuma exclusão usa o `confirm` do navegador: um modal próprio explica o que
  se perde, e excluir um servidor exige digitar o nome dele.
- Kick, ban, timeout, unban, nickname e audit log estruturado/pesquisável.
- Amizades, bloqueios e DMs usando RPCs/RLS.
- GDM completo: seleção explícita de amigos, nome, ícone privado, adição/remoção/saída, sucessão segura do criador e perda imediata de acesso, validado com quatro contas.
- Mensagens com Markdown estrutural, multiline, links, respostas, edição, exclusão lógica, reações, pins e anexos cifrados; edições consecutivas preservam anexos e recalculam menções.
- Menções por username, cargo, `@everyone` e `@here`, com resolução de destinatários, validação de `mentionable`/`MENTION_EVERYONE` no banco, supressão de cargos/everyone, contador persistido e Inbox decifrada no cliente.
- Histórico completo buscado em lotes e infinite scrolling com cursor composto, sem o antigo teto de 200 mensagens por canal.
- OpenMLS para mensagens/anexos e remoção criptográfica de dispositivos/membros pelo fundador do grupo.
- Busca e Inbox sobre conteúdo decifrado no cliente; o quick switcher abre servidores, canais e DMs reais por teclado, mostra o nome do interlocutor e nenhum plaintext é consultado no banco.
- Presença e indicador de digitação via Realtime.
- Voz, vídeo e compartilhamento de tela via LiveKit; seleção de dispositivos, PTT/VAD e mídia E2EE.
- Mute/deafen/move/disconnect de voz persistidos, auditados e aplicados no LiveKit.
- O move de voz usa um pedido persistido e reconecta o alvo no canal de destino, obtendo nova sessão LiveKit e chave OpenMLS em vez de conservar a chave da sala anterior.
- TURN local forçado validado com dois participantes e áudio sintético E2EE.
- Duas contas isoladas entram na mesma chamada pela UI, aparecem uma para a outra, trocam microfone/câmera/saída de áudio, publicam e removem tela, ensurdecem localmente e permanecem conectadas durante a hidratação periódica do workspace e após restart do LiveKit.
- Sessões e participantes de chamada são persistidos; heartbeat remove presença abandonada após falha abrupta, o contador lateral reflete participantes reais, a saída simultânea encerra a sessão de forma serializada e a tela inicial permite reabrir o canal pelo histórico recente.
- O estado real da conexão LiveKit, falhas e o epoch E2EE ficam visíveis na chamada; a chave de mídia é atualizada quando um dispositivo entra depois do fundador.
- Um grupo MLS vazio e abandonado pode trocar de fundador somente após janela de segurança e apenas quando não existe mensagem, Welcome ou commit; isso evita deadlock sem reescrever histórico cifrado.
- Verificação de dispositivo por código curto e revogação persistida.
- Notificações locais/desktop descriptografadas somente no cliente, preferências GLOBAL/SERVER/CHANNEL, herança, modos ALL/MENTIONS/NONE, supressões e silêncio temporário; decisão de entrega protegida no banco.
- Dashboard de quota do PostgreSQL e Storage com medidas reais, limites configuráveis e níveis em 70%, 85% e 95%, restrito a proprietários.
- Duas sessões de navegador isoladas entram no mesmo servidor e trocam mensagens OpenMLS nos dois sentidos.
- Não existe fallback offline, seed de interface, IndexedDB de mensagens nem backend simulado; indisponibilidade da stack local é um erro visível.
- Electron, instalador NSIS e atualização N→N+1; acessibilidade básica e redução de movimento.
- Navegação responsiva por drawer entre Início, servidores, canais de texto e canais de voz, validada em viewport de 390 × 844.

## Parcial — precisa de refinamento

- Web Push: fila, preferências e dispatcher têm testes locais; ainda falta aceite externo com o aplicativo fechado e um endpoint push público real. A notificação foreground/desktop multi-sessão já possui E2E local.
- Dispositivos: revogação persiste imediatamente; a remoção OpenMLS ocorre quando o dispositivo fundador volta a sincronizar o grupo. QR e recovery pack E2EE opcional não existem.
- Voz/vídeo: os controles estão automatizados no Edge com dispositivos virtuais e captura de tela do navegador; ainda falta aceitação manual com hardware físico, múltiplos monitores e redes reais distintas.
- Responsividade e animações: a navegação principal funciona em desktop e 390 px; telas administrativas densas ainda precisam de uma revisão visual dedicada em aparelhos pequenos.
- Bundle web: funcional, porém o chunk principal ainda supera 500 kB e deve ser dividido por rota/feature.
- Instalador Windows: funciona localmente, mas ainda não possui assinatura de código de produção.

## Ausente do escopo completo do documento

- Threads completas, fórum, palco/stage, eventos, enquetes, AutoMod e regras avançadas.
- Emojis/stickers personalizados, soundboard e gestão completa de expressões.
- Webhooks, bots/apps, integrações, OAuth e diretório/descoberta pública de servidores.
- Dashboard de custos do provedor e políticas operacionais completas de retenção/exportação (a quota técnica local de DB/Storage já existe).
- Exportação/eliminação integral de conta e dados pessoais.
- Pipelines CI/CD completos, observabilidade de produção, backup/restore ensaiado e assinatura do instalador.
- Testes E2E e aceite de câmera, microfone, saída e compartilhamento em dois computadores físicos.

## Evidências locais atuais

- Banco/RLS/RPC/MLS: 156 testes pgTAP aprovados e schema sem alertas de lint.
- Frontend: 11 testes Vitest, typecheck e build aprovados; auditoria npm sem vulnerabilidades.
- Navegadores: 7 cenários Playwright aprovados; duas contas isoladas, quick switcher por teclado com servidor/DM real, GDM com quatro contas e ícone privado, sessões da conta, quota real, notificações desktop, Markdown, anexos cifrados, resposta/reação/pin/edição/exclusão, Inbox, categorias completas, limite e contador de voz, heartbeat, navegação mobile, mensagens OpenMLS bidirecionais, ciphertext remoto, quatro tipos de menção e chamada compartilhada estável com histórico persistido.
- Workspace: duas contas independentes, um servidor, dois canais e associação Realtime aprovados.
- Mídia: troca de dispositivos virtuais, deafen local, câmera, tela, reconnect, move seguro, moderação de voz, dois participantes, áudio E2EE e candidato TURN relay aprovados.
- OpenMLS nativo: 3 testes Rust aprovados.
- Desktop empacotado: o `dist/` carrega por `file://` — o esquema do aplicativo
  instalado — com o renderer montado, o wasm do OpenMLS acessível, IndexedDB e
  `localStorage` disponíveis e nenhum erro no console; verificado tanto na
  pasta recém-construída quanto no bundle de dentro do `app.asar`
  (`npm run desktop:smoke`).
