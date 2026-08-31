/**
 * Um modo de câmera, e de propósito.
 *
 * A câmera oferecia até 4K a 12 Mb/s. Numa implantação em plano gratuito, onde
 * todos os servidores dividem a mesma banda, um participante em 4K consome o
 * que dez em 720p consomem — e ninguém percebe a diferença num tile de meia
 * tela. Sobrou um modo só: 720p a 60 quadros. Rosto em movimento pede fluidez,
 * não densidade de pixel, e um teto único é uma conta de banda previsível por
 * participante.
 *
 * Vive fora de `useLiveKitRtc` porque é constante pura. Lá dentro, importá-la
 * arrastava o cliente Supabase junto — e qualquer teste que só quisesse
 * conferir uma taxa de quadros passava a exigir uma instância configurada.
 */
export const CAMERA_MODES = {
  720: { resolution: 720, frameRate: 60, bitrate: 2_500_000 },
} as const;

export type CameraResolution = keyof typeof CAMERA_MODES;

/** Resolve qualquer resolução guardada para um dos dois modos que existem. */
export function cameraMode(_resolution?: number) {
  return CAMERA_MODES[720];
}
