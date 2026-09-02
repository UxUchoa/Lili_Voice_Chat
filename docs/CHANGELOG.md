# Notas de versão

Uma seção por versão publicada. O texto daqui é o corpo da release no GitHub:
`scripts/release-notes.mjs` recorta a seção da versão e o workflow
`release.yml` a envia junto do instalador. Uma versão sem seção aqui derruba a
publicação de propósito — release sem notas é release que ninguém sabe o que
mudou.

## 0.1.8

### Correções

- **O seletor de GIFs abria com todos os quadros quebrados.** A política de
  segurança do build ainda liberava o provedor anterior, o Tenor, e recusava o
  Giphy — que é de onde o seletor busca desde a versão passada. O navegador
  descartava cada prévia antes de virar requisição, e a falha parecia ser da
  busca, que estava funcionando o tempo todo. Escolher o GIF também dependia
  disso: o arquivo é baixado aqui antes de virar anexo seu.
- **O código de verificação volta a exigir seis dígitos**, agora recusando em
  voz alta em vez de cortar em silêncio. Um código mais longo que o esperado
  diz o tamanho que veio, em vez de virar um "código inválido" sem explicação.

## 0.1.7

### Novidades

- **As notas da versão aparecem dentro do aplicativo.** O `electron-updater` já
  recebia o corpo da release junto do aviso de versão nova — ele só era
  descartado. Agora vira um painel, com o mesmo texto que está na página da
  release.
- **O download da atualização não começa mais sozinho.** São ~118 MB que saíam
  pela rede da pessoa sem aviso: o primeiro sinal de que havia versão nova era o
  "pronto para reiniciar". Agora a versão se anuncia com o que mudou e um botão.
- **Botão de baixar à mão** quando o atualizador não puder fazer o trabalho —
  canal ausente, erro de rede, instalação sem permissão de escrita. É a saída de
  quem está justamente com o caminho automático quebrado.

### Correções

- **O cadastro não passava da tela do código.** O servidor estava configurado
  para mandar oito dígitos e o aplicativo cortava em seis: o código saía
  truncado daqui e a resposta do servidor era a mesma de um código vencido, o
  que mandava todo mundo procurar o erro no lugar errado. O campo passa a
  aceitar a faixa inteira que o servidor pode usar, e nem a tela nem o e-mail
  prometem mais um número de dígitos que não é deles.
- **A prévia do próprio perfil não aparecia.** O painel de conta é uma coluna
  que rola, e o cartão da prévia era o único item que o navegador podia
  encolher — sobrava dele a espessura das bordas. Avatar, banner, nome e
  presença estavam lá o tempo todo, cortados por dois pixels de altura.
- **Apagar mensagem com anexo falhava pela metade.** O arquivo saía do
  armazenamento e a mensagem continuava na conversa apontando para ele, porque a
  exclusão esbarrava numa permissão do banco. A limpeza automática dos anexos
  vencidos parava pelo mesmo motivo.
- **Envio de e-mail recusado no cadastro** devolvia a pessoa ao formulário, onde
  tentar de novo gerava outro código e cancelava o que ainda estava a caminho.
  Agora leva à tela do código, com o reenvio liberado na hora.
- **A última mensagem ficava cortada** nas conversas longas. A descida
  automática dependia de quantas mensagens havia na lista, e passando de
  cinquenta esse número para de mudar: chegava mensagem, a lista rolava sozinha
  para cima e nada descia.
- O prazo do código de verificação era dito em dois lugares com dois valores
  diferentes. O e-mail agora diz o que o servidor faz.

## 0.1.6

- **A cota do servidor acompanha a exclusão de outro servidor.** A fatia é o
  teto da instância dividido pelo número de servidores, então ela cresce quando
  um servidor deixa de existir — mas a medição só acontecia ao abrir a aba e no
  botão "Atualizar". Com a aba aberta, excluir um servidor deixava a fatia
  antiga na tela, e parecia que a exclusão não havia liberado nada. A medição
  agora acompanha quantos servidores existem. Um servidor criado ou excluído
  por outra pessoa continua chegando na próxima medição.

## 0.1.5

Marca nova em toda a aplicação, e a maior leva de correções de interface desde
o começo.

### Novidades

- **Verificação de conta por código de e-mail**, entregue pelo Brevo. O
  cadastro deixa de depender do link que o cliente de e-mail às vezes engolia.
- **Busca de GIFs** dentro do compositor, pelo Giphy. A chave vive na função de
  borda, e não no pacote: o GIF escolhido é baixado e enviado como anexo comum,
  então nada do que você abre chega ao provedor.
- **Mensagem de voz**: gravador no compositor e player próprio, no formato que
  o navegador aceita de volta.
- **Pastas na barra de servidores**, com ordem que se arrasta e sobrevive ao
  recarregar.
- **Menções**: a lista abre ao digitar `@`, e a menção aparece destacada na
  mensagem — inclusive a que é para você, que antes chegava como texto cru
  mesmo tendo notificado.
- **Spoiler** em anexo e no texto, no mesmo formato do Discord.
- **Excluir categoria** pergunta para onde vão os canais de dentro, em vez de
  decidir sozinho.
- Ícones em SVG no lugar dos emojis, que mudavam de forma a cada sistema.

### Correções

- **Áudio saindo só no canal esquerdo**: o microfone passa a ser travado em
  mono.
- **Barra de canais**: os títulos "CANAIS DE TEXTO" e "CANAIS DE VOZ" eram
  fixos e não existiam no banco — pareciam categorias e não davam para
  renomear nem excluir. Agora todo título é uma categoria de verdade, os canais
  sem categoria ficam soltos no topo, e cada canal e categoria tem um `⋯`
  visível com editar, mover e excluir.
- **Menu de contexto vazando pela lateral da janela**: ele se media antes de
  entrar no documento, media zero, e a conta de virar para o outro lado nunca
  acontecia.
- **Botões do Windows por cima dos do app**: a barra de título agora termina
  antes da faixa que o sistema desenha, e some a segunda fileira de
  minimizar/maximizar/fechar.
- **Última mensagem cortada ao digitar**: o que cresce embaixo da lista — o
  compositor com duas linhas, o aviso de "está digitando" — tirava altura dela
  sem reposicionar a rolagem.
- **Aba de configurações piscando**: cada aba era remontada a cada render do
  painel, o que zerava o estado dela e refazia a medição da quota.
- Cápsula da pasta na barra de servidores mais estreita que a capa, caixas de
  seleção de tamanhos e lados diferentes conforme a tela, ícone colado no texto
  dentro dos seletores, filtros do cabeçalho encostados uns nos outros e um
  segundo contorno em volta deles.
- A barra de título passa a trazer o nome inteiro, "Lili — Voice Chat".

## 0.1.4

Release completa, com instalador e `latest.yml` publicados juntos — a 0.1.3
tinha ficado no ar só com o blockmap por uma corrida entre dois publicadores.

## 0.1.3

O aplicativo instalado passa a carregar o site publicado, em vez de levar uma
cópia do bundle dentro do pacote.

## 0.1.2

Fim da criptografia ponta a ponta: a proteção passa a ser autenticação e RLS,
aplicadas no próprio banco a cada consulta.

## 0.1.1

Primeiro instalador Windows.
