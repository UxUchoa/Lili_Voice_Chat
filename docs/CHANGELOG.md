# Notas de versão

Uma seção por versão publicada. O texto daqui é o corpo da release no GitHub:
`scripts/release-notes.mjs` recorta a seção da versão e o workflow
`release.yml` a envia junto do instalador. Uma versão sem seção aqui derruba a
publicação de propósito — release sem notas é release que ninguém sabe o que
mudou.

## 0.2.1

### Correções

- **GIFs e imagens não apareciam no chat aberto durante a chamada.** A mensagem
  chegava, a legenda aparecia e a mídia não — e ela voltava inteira assim que
  você saía da chamada, o que fazia parecer atraso de sincronização. Nada estava
  sendo perdido: o painel de chat da chamada era uma segunda implementação, que
  só sabia desenhar texto. Agora ele é a mesma conversa da tela cheia — anexo,
  GIF, imagem, reação, resposta, menção e markdown, tudo em tempo real, sem
  precisar sair e voltar.
- **A voz chegava duplicada, como se duas pessoas falassem juntas com alguns
  milissegundos de diferença.** Ligar o microfone leva um tempo — o filtro de
  ruído precisa carregar — e nesse intervalo o botão continuava mostrando
  "silenciado". Quem clicava de novo abria uma segunda captura, e as duas iam
  ao ar. O timbre metálico vinha do mesmo lugar: uma voz somada a uma cópia
  atrasada de si mesma vira um filtro pente, que soa como lata. Agora existe
  uma captura por vez, sempre.
- **O compartilhamento de tela ia mudo.** Duas causas somadas. O áudio vinha
  desligado por padrão — e quem compartilha é justamente quem não percebe.
  E, no aplicativo instalado, a via que pedia o som do sistema tinha deixado de
  funcionar: o Chromium parou de conceder o áudio por ali, a tentativa falhava
  em silêncio e a transmissão subia só com imagem. As duas foram corrigidas, e
  agora existe um teste que reprova a versão muda antes de ela sair.
- **Compartilhar pelo navegador podia falhar por causa do áudio.** Se o pedido
  de som desagradasse ao navegador, o compartilhamento inteiro morria em vez de
  ir sem som. Agora ele vai sem som e diz isso — e, quando falha de verdade, a
  mensagem conta o motivo em vez de "não foi possível".
- **Os controles da chamada ficavam colados na borda de baixo.** A barra estava
  travada em 70px de altura enquanto os botões pediam mais que isso, então eles
  transbordavam a caixa e encostavam na borda. A barra passa a medir o que tem
  dentro, com o mesmo respiro em cima e embaixo.
- **O X das notas da versão nascia por baixo do aviso amarelo de atualização** —
  literalmente invisível, junto com o topo do card. Os dois falam da mesma
  atualização e aparecem juntos por definição; agora o card desce até abaixo do
  aviso.

### Melhorias

- **GTC RN é a supressão de ruído padrão.** Os dois modelos rodam nesta máquina
  e custam CPU parecida; a diferença está no que sobra da voz. O RNNoise decide
  um ganho por banda de frequência, e quando erra apaga a banda inteira — é o
  que se ouve como voz de rádio velho. Quem estava no padrão antigo é movido
  junto; quem tinha escolhido outra coisa fica onde está.
- **O silêncio entre as palavras volta a ser silêncio.** A transmissão de voz
  parava de enviar nas pausas e o outro lado sintetizava um chiado no lugar —
  com a supressão funcionando bem, esse chiado é justamente o que não estava
  lá, e o liga-desliga a cada palavra soava artificial. A economia era da ordem
  de um centésimo do que o compartilhamento de tela usa.
- **720p a 60 quadros: mesma imagem, um pouco mais de folga.** O teto de banda
  cai de 2,3 para 2,2 Mb/s. Quatro por cento não se enxerga num quadro e devolve
  margem para absorver um pico sem cortar nada.
- **1080p a 60 quadros engasgava menos.** O teto cai de 4,0 para 3,5 Mb/s —
  4 Mb/s era mais do que a nossa infraestrutura sustenta, e um pedido que não
  cabe é cortado em ciclos, cada corte um engasgo. Continuam 1920×1080 e 60
  quadros: derrubar a fluidez resolveria o número e estragaria justamente o que
  se está transmitindo.
- **Dá para ver o que a transmissão está realmente fazendo.** Em "Privacidade",
  durante um compartilhamento, aparecem a resolução e os quadros reais, a banda
  medida, o codec e o que está limitando a qualidade — CPU do encoder ou banda
  disponível. São coisas diferentes e pedem correções opostas.
- **As ações do aviso de atualização e das notas viraram botões de verdade.**
  "Ver o que mudou" e "Depois" eram texto clicável ao lado de um botão
  vermelho, e ninguém os encontrava. Continuam secundários — só uma das ações é
  a recomendada — mas agora parecem clicáveis.

## 0.2.0

### Novidades

- **Quatro modos de qualidade para o compartilhamento de tela**: 720p e 1080p,
  cada um a 30 ou 60 quadros por segundo.
- **720p a 60 quadros é o novo padrão.** Conteúdo em movimento — jogo, vídeo,
  navegação — é lido pela fluidez, e meia resolução a sessenta quadros custa
  menos banda que resolução cheia a trinta.
- **Trocar de modo vale na hora.** Antes o menu só mudava o texto na tela: a
  escolha passava a valer na próxima vez que você começasse a compartilhar, o
  que ninguém tinha como adivinhar.

### Correções

- **O compartilhamento rodava a cerca de 15 quadros por segundo, escolhesse
  você o que escolhesse.** O limite não vinha da sua rede nem da sua máquina:
  a biblioteca de vídeo ignorava em silêncio a qualidade que pedíamos e
  aplicava o padrão dela, de quinze quadros. A opção de 15 quadros também saiu
  da lista — não é qualidade, era o sintoma.
- **A lista de GIFs virava um carrossel horizontal.** A grade era montada com
  um recurso de colunas que, num espaço de altura limitada, cresce para o lado
  em vez de continuar para baixo. Por isso a forma mudava conforme a categoria
  escolhida e só a última faixa rolava direito.
- **O compartilhamento levava junto o som do computador inteiro.** Agora o
  padrão é só a imagem, e o áudio segue a fonte escolhida: compartilhando uma
  aba, vai o som daquela aba e de mais nada. O Windows não sabe capturar
  apenas o som de uma janela, então quando essa opção for ligada a tela diz,
  com todas as letras, que vai o som de tudo o que estiver tocando.
- **O aviso de atualização voltava a cada abertura** mesmo depois de você
  mandar deixar para depois, e o "veja o que mudou" nunca aparecia depois de
  instalar. As duas respostas passam a sobreviver ao fechar o aplicativo, e a
  versão instalada agora carrega as próprias notas.

### Melhorias

- **Banda por modo, dimensionada para a nossa infraestrutura**: de 1,5 Mb/s no
  720p a 30 quadros até 4 Mb/s no 1080p a 60. Antes um 1080p a 60 pedia dez
  megabits — mais do que a instância entrega, o que fazia o controle de
  congestionamento cortar tudo de uma vez.
- **Quando a rede aperta, o que cede primeiro é a nitidez, não a fluidez.**
  Era o contrário, e é metade da explicação dos quinze quadros.

## 0.1.9

### Correções

- **O histórico mostrava as chamadas dos outros.** Quem dividia um canal de voz
  encontrava, no próprio painel de amigos, chamadas de que nunca participou —
  com o nome de quem esteve nelas e a hora. A permissão de entrar no canal, que
  precisa existir para o "ativo agora" mostrar quem já está na sala, também
  estava abrindo tudo o que já tinha terminado. Chamada em andamento continua
  sendo um fato do canal; encerrada, é de quem esteve nela.

  > Esta correção depende do banco: a política nova sobe com as migrações, e
  > sem elas a versão nova do aplicativo apenas deixa de **mostrar** o que
  > continua acessível.

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
