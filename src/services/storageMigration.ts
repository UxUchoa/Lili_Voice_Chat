/**
 * Devolve ao nome antigo as chaves que o rename para Lili levou embora.
 *
 * Houve dois deploys em sequência. O primeiro renomeou o produto e migrou as
 * chaves do navegador de `janja.*` para `lili.*`, **removendo** a original. O
 * segundo desfez o rename no código — o nome Lili ficou só no que a pessoa lê —
 * mas nada trouxe os dados de volta: o módulo de migração foi apagado com a
 * justificativa de que, sem rename, não havia o que migrar. Havia, no sentido
 * inverso, e só para quem tinha aberto o aplicativo entre os dois deploys.
 *
 * O efeito não é cosmético. A sessão do Supabase é uma dessas chaves. Quem
 * passou pelo primeiro deploy ficou com a sessão viva sob `lili.supabase.session`
 * enquanto o cliente voltou a procurá-la em `janja.supabase.session`: parece um
 * logout inexplicável. Pior, o refresh token abandonado continua válido — e com
 * `enable_refresh_token_rotation`, qualquer aba antiga ou o desktop ainda na
 * versão anterior renova por aquele cofre e invalida o token da sessão nova.
 * As duas morrem, todo RPC passa a chegar como `anon`, e o servidor responde
 * "permission denied for function": nenhuma mensagem é enviada nem lida.
 *
 * Por isso a chave órfã é sempre **removida**, mesmo quando não há nada a
 * restaurar. Deixar o segundo cofre de pé é deixar a falha de pé.
 *
 * Esta migração só move chaves de `localStorage`. Ela nasceu para devolver a
 * sessão do Supabase a quem abriu o aplicativo entre os dois deploys do rename
 * e continua valendo enquanto existir alguém nesse estado.
 */
const RENAMED: Array<[abandoned: string, current: string]> = [
  ["lili.supabase.session", "janja.supabase.session"],
  ["lili-ui-preferences-v2", "janja-ui-preferences-v2"],
  ["lili-navigation-v1", "janja-navigation-v1"],
  ["lili-collapsed-categories", "janja-collapsed-categories"],
  ["lili-emoji-recent-v1", "janja-emoji-recent-v1"],
  ["lili.camera.quality", "janja.camera.quality"],
  ["lili.sounds.volume", "janja.sounds.volume"],
  ["lili.sounds.enabled", "janja.sounds.enabled"],
  ["lili.hideMutedChannels", "janja.hideMutedChannels"],
];

/**
 * Move o que ficou para trás e apaga o cofre abandonado.
 *
 * Quem já tem a chave atual preenchida não é sobrescrito: esse valor é o mais
 * recente, e o `lili.*` é resquício de antes do rollback. A remoção acontece
 * nos dois casos.
 *
 * Recebe o `Storage` por parâmetro para poder ser testada sem navegador.
 */
export function migrateLegacyStorageKeys(storage: Storage = localStorage) {
  for (const [abandoned, current] of RENAMED) {
    let value: string | null = null;
    try {
      value = storage.getItem(abandoned);
    } catch {
      // Armazenamento bloqueado (janela privada, site data desligado). Sem
      // acesso não há migração a fazer, e travar o carregamento por causa de
      // uma preferência seria pior que a preferência perdida.
      return;
    }
    if (value === null) continue;
    try {
      if (storage.getItem(current) === null) storage.setItem(current, value);
      storage.removeItem(abandoned);
    } catch {
      // Cota estourada ou escrita recusada: seguimos para as próximas chaves.
      // Uma preferência que não voltou é melhor que o aplicativo não abrir.
    }
  }
}

let done = false;

/** Roda uma vez por carregamento, antes de qualquer leitura de storage. */
export function migrateLegacyStorageKeysOnce() {
  if (done) return;
  done = true;
  migrateLegacyStorageKeys();
}
