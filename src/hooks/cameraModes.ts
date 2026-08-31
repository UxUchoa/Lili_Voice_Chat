/**
 * Só dois modos de câmera, e de propósito.
 *
 * A câmera oferecia até 4K a 12 Mb/s. Numa implantação em plano gratuito, onde
 * todos os servidores dividem a mesma banda, um participante em 4K consome o
 * que dez em 720p consomem — e ninguém percebe a diferença num tile de meia
 * tela. Os dois modos que sobraram custam quase o mesmo em pixels por segundo:
 * é a escolha entre movimento fluido e imagem detalhada, não entre barato e
 * caro.
 *
 * Vive fora de `useLiveKitRtc` porque é constante pura. Lá dentro, importá-la
 * arrastava o cliente Supabase junto — e qualquer teste que só quisesse
 * conferir uma taxa de quadros passava a exigir uma instância configurada.
 */
export const CAMERA_MODES = {
  720: { resolution: 720, frameRate: 60, bitrate: 2_500_000 },
  1080: { resolution: 1080, frameRate: 30, bitrate: 3_000_000 },
} as const;

export type CameraResolution = keyof typeof CAMERA_MODES;

/** Resolve qualquer resolução guardada para um dos dois modos que existem. */
export function cameraMode(resolution: number) {
  return resolution >= 1080 ? CAMERA_MODES[1080] : CAMERA_MODES[720];
}
