/**
 * Renomeia as chaves de armazenamento que ficaram do nome antigo.
 *
 * O produto passou a se chamar Lili. Estas são as chaves de preferência — a
 * sessão do Supabase e a master key do MLS ficaram de fora de propósito, com o
 * motivo escrito ao lado de cada uma.
 *
 * As chaves guardadas no navegador não podem simplesmente mudar de nome: quem tem sessão aberta seria deslogado,
 * quem escolheu 720p voltaria para 1080p, o volume voltaria ao padrão e as
 * categorias recolhidas se abririam. Nada disso é grave sozinho — junto, é o
 * aplicativo inteiro parecendo ter esquecido a pessoa por causa de uma
 * mudança de marca.
 *
 * Roda uma vez, no carregamento, antes de qualquer store ler o que quer que
 * seja. Se a chave nova já existir, a antiga é só descartada: quem já migrou
 * não pode ter a preferência atual sobrescrita pela antiga.
 */
const RENAMED: Array<[legacy: string, current: string]> = [
  ["janja-ui-preferences-v2", "lili-ui-preferences-v2"],
  ["janja-navigation-v1", "lili-navigation-v1"],
  ["janja-collapsed-categories", "lili-collapsed-categories"],
  ["janja-emoji-recent-v1", "lili-emoji-recent-v1"],
  ["janja.camera.quality", "lili.camera.quality"],
  ["janja.sounds.volume", "lili.sounds.volume"],
  ["janja.sounds.enabled", "lili.sounds.enabled"],
  ["janja.hideMutedChannels", "lili.hideMutedChannels"],
];

let done = false;

export function migrateLegacyStorageKeys() {
  if (done) return;
  done = true;
  try {
    for (const [legacy, current] of RENAMED) {
      const value = localStorage.getItem(legacy);
      if (value === null) continue;
      if (localStorage.getItem(current) === null)
        localStorage.setItem(current, value);
      localStorage.removeItem(legacy);
    }
  } catch {
    // Armazenamento bloqueado pelo navegador (janela privada, site data
    // desligado). O aplicativo funciona com os padrões; falhar aqui seria
    // impedir o carregamento por causa de uma preferência.
  }
}

migrateLegacyStorageKeys();
