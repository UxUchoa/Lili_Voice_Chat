# Teste manual da manhã — Lili local

## 1. Preparar a infraestrutura

1. Abra o Docker Desktop e aguarde o indicador **Engine running**.
2. No PowerShell, dentro de `C:\Users\lucas\Desktop\Lili_Voice_Chat`, execute:

   ```powershell
   npm run local:up
   ```

3. Mantenha esse terminal aberto. O frontend fica em `http://127.0.0.1:5173`.
4. Para testar duas contas, use o aplicativo instalado para a conta A e uma janela InPrivate do Edge em `http://127.0.0.1:5173` para a conta B. O aplicativo desktop aceita apenas uma instância por segurança.

## 2. Fluxo essencial de duas contas

1. Crie duas contas diferentes e anote os usernames.
2. Na conta A, crie um servidor e um convite.
3. Na conta B, resgate o convite.
4. Envie mensagens nos dois sentidos. Elas devem aparecer sem recarregar a página.
5. Envie um arquivo pequeno. A conta B deve baixar exatamente o conteúdo original; o servidor armazena apenas o ciphertext.
6. Teste responder, reagir, fixar, editar e apagar uma mensagem.
7. Mencione a conta B, deixe B na tela Início e abra **Inbox → Menções**.

## 3. Chamada

1. Entre em **Lounge** com as duas contas.
2. O contador do canal deve mudar para `2`, e cada conta deve enxergar a outra.
3. Teste microfone, câmera, seleção de dispositivo, deafen e compartilhamento de tela.
4. Reinicie somente o container LiveKit para conferir reconexão:

   ```powershell
   docker restart livekit-livekit-1
   ```

5. As duas contas devem voltar ao estado **Conectado** sem sair da tela.
6. Feche à força a janela da conta B sem clicar em Sair. Após até 45 segundos, o contador deve voltar para `1` e a conta B deve conseguir entrar novamente; o heartbeat remove a presença abandonada.

## 4. DMs, grupo e administração

1. Adicione as contas como amigas e abra uma DM pelo `Ctrl+K`.
2. Crie um grupo com pelo menos três contas, altere nome e ícone, adicione/remova um membro e envie uma mensagem.
3. Em uma conta sem permissão administrativa, confirme que botões de criação de canal e abas de cargos/canais não aparecem.
4. Na conta proprietária, pesquise um cargo, altere seu ícone Unicode e salve.
5. Teste notificações GLOBAL/SERVER/CHANNEL e silêncio temporário.

## 5. O que só se confere com ouvido e olho

Estes quatro itens têm teste automatizado do que dá para automatizar — a faixa
existe, o número está certo, o elemento renderizou. O que falta é a parte que
nenhum teste vê. Sem isso, "passou" quer dizer só que o encanamento está no
lugar.

1. **A voz.** Entre em chamada com as duas contas e fale por trinta segundos
   seguidos, depois em frases curtas, depois em silêncio com ruído de fundo
   (ventilador, teclado). O que se procura: nada de você repetido alguns
   milissegundos depois, e nada de timbre de lata. O padrão é o GTC RN — ele
   aparece como *recomendado* em Configurações → Voz.
2. **O RNNoise.** Troque o modo no meio da chamada e repita o item acima. A
   troca recaptura o microfone; o outro lado não pode ouvir duas vozes durante
   a transição.
3. **O som do compartilhamento.** Compartilhe um jogo ou um vídeo com som e
   confirme do outro lado que ele chega — e que a sua voz continua chegando ao
   mesmo tempo. Se você estiver no alto-falante, os outros vão se ouvir de
   volta: é o loopback do Windows, não é defeito.
4. **1080p a 60 quadros.** Compartilhe algo em movimento e abra
   **Privacidade** no cabeçalho da chamada. Ali estão a resolução e os quadros
   reais, a banda medida e o motivo da limitação. `limitado por CPU` com mais
   de 16 ms por quadro é o encoder; `limitado por banda` com a resolução real
   abaixo da escolhida é a rede. São problemas diferentes e a correção de um
   não serve para o outro.

## 6. Resultado esperado e parada

- Qualquer falha assíncrona deve aparecer em uma faixa vermelha no topo; tire uma captura antes de fechá-la.
- O estado deve sincronizar sozinho; não use F5 como parte do fluxo normal.
- Para encerrar, pressione `Ctrl+C` no terminal de `local:up`.
- Se a infraestrutura não iniciar, rode `npm run local:prepare` e guarde toda a saída do terminal.

