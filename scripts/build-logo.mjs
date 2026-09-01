/**
 * Gera os arquivos de marca a partir do SVG de origem.
 *
 *   npx electron scripts/build-logo.mjs <caminho-do-svg-ou-png>
 *
 * Roda dentro do Electron de propósito. Ele já é dependência de build e traz
 * as duas coisas que faltavam: um rasterizador de SVG de verdade (o Chromium)
 * e o `nativeImage`, que redimensiona bem. Assim nenhuma dependência nova
 * entra no projeto só para converter um ícone.
 *
 * Escreve, em `public/`:
 *   - `logo-vetorizada.svg` — a arte, usada pelo <Logo> dentro do app
 *   - `logo-vetorizada.png` — 1024×1024, para notificação e para a janela
 *   - `logo-vetorizada.ico` — o ícone da barra de tarefas, do atalho e do
 *     instalador, com todas as resoluções que o shell do Windows pede
 *
 * Os nomes são os de antes porque `package.json` (electron-builder),
 * `index.html` e `src/main.tsx` apontam para eles.
 *
 * Por que o ICO precisa de várias resoluções: o Windows escolhe a entrada
 * mais próxima do tamanho que vai desenhar. Um ICO só com 256px é reduzido
 * pelo shell com um filtro pobre, e a arte chega borrada na barra de tarefas.
 */
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, nativeImage } from "electron";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2];

/** Tamanhos que o shell do Windows realmente pede. */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

/** Lado do rasterizado mestre. Todo o resto sai daqui por redução. */
const MASTER = 1024;

/**
 * Monta um .ico com entradas PNG.
 *
 * O formato aceita PNG embutido desde o Vista, e é o único jeito de guardar
 * 256×256 sem estourar o tamanho do arquivo.
 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // 1 = ícone
  header.writeUInt16LE(entries.length, 4);

  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach((entry, index) => {
    const at = index * 16;
    // 0 significa 256: o campo tem um byte só.
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at);
    directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1);
    directory.writeUInt8(0, at + 2); // paleta
    directory.writeUInt8(0, at + 3); // reservado
    directory.writeUInt16LE(1, at + 4); // planos
    directory.writeUInt16LE(32, at + 6); // bits por pixel
    directory.writeUInt32LE(entry.data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += entry.data.length;
  });

  return Buffer.concat([
    header,
    directory,
    ...entries.map((entry) => entry.data),
  ]);
}

/**
 * Desenha a arte num quadrado de `MASTER` e devolve o bitmap.
 *
 * O desenho vai para um `<canvas>` dentro da página, e não para um
 * `capturePage()` da janela. Capturar a janela depende do compositor do
 * sistema — numa janela escondida e transparente ele falha com
 * `UnknownVizError` — e ainda entrega o resultado já achatado contra o fundo.
 * O canvas não depende de nada disso e preserva o alfa.
 */
async function rasterize(file) {
  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    readFileSync(file).toString("utf8"),
  )}`;
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, offscreen: true },
  });
  await window.loadURL("data:text/html;charset=utf-8,<!doctype html><title>x</title>");
  const dataUrl = await window.webContents.executeJavaScript(
    `new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = ${MASTER};
        canvas.height = ${MASTER};
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, ${MASTER}, ${MASTER});
        resolve(canvas.toDataURL("image/png"));
      };
      image.onerror = () => reject(new Error("o SVG não pôde ser desenhado"));
      image.src = ${JSON.stringify(svgUrl)};
    })`,
  );
  window.destroy();
  return nativeImage.createFromDataURL(dataUrl);
}

// `app.whenReady()` fica no `.then`, e não num await de topo: num entry ESM do
// Electron o módulo precisa terminar de avaliar antes de o evento `ready`
// disparar, e esperar por ele no topo trava o processo para sempre.
const watchdog = setTimeout(() => {
  console.error("A rasterização travou.");
  process.exit(2);
}, 60_000);

app.whenReady().then(async () => {
  try {
    if (!source)
      throw new Error("Uso: npx electron scripts/build-logo.mjs <arte>");

    const input = resolve(source);
    const isSvg = extname(input).toLowerCase() === ".svg";
    const master = isSvg
      ? await rasterize(input)
      : nativeImage
          .createFromPath(input)
          .resize({ width: MASTER, height: MASTER, quality: "best" });

    if (master.isEmpty())
      throw new Error(`Não foi possível ler a imagem: ${source}`);

    if (isSvg) copyFileSync(input, resolve(root, "public/logo-vetorizada.svg"));
    writeFileSync(resolve(root, "public/logo-vetorizada.png"), master.toPNG());
    writeFileSync(
      resolve(root, "public/logo-vetorizada.ico"),
      buildIco(
        ICO_SIZES.map((size) => ({
          size,
          data: master
            .resize({ width: size, height: size, quality: "best" })
            .toPNG(),
        })),
      ),
    );

    console.log(
      `Marca gerada a partir de ${source}: png ${MASTER}×${MASTER}, ico ${ICO_SIZES.join("/")}`,
    );
    clearTimeout(watchdog);
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    clearTimeout(watchdog);
    process.exit(1);
  }
});
