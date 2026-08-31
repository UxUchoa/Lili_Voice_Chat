# openmls-wasm — artefato compilado

Saída de `wasm-pack build --target web` do wrapper OpenMLS, **versionada de
propósito**. É o que permite que o build da web (Vercel) e o do desktop rodem
sem Rust instalado.

O `wasm-pack` deixa um `.gitignore` com `*` no diretório de saída; ele foi
removido. Se você recompilar e copiar a pasta inteira de novo, apague-o outra
vez — sem isso o `openmls_wasm.js` some do repositório e o `tsc` falha com
"Cannot find module './openmls-wasm/openmls_wasm'" apenas no CI, nunca na
máquina de quem compilou.

## Recompilar

```powershell
npm run vendor:openmls        # clona o commit fixado e aplica o patch local
cd vendor/openmls/openmls-wasm
wasm-pack build --target web
```

Depois copie de `vendor/openmls/openmls-wasm/pkg/` para cá:
`openmls_wasm.js`, `openmls_wasm.d.ts`, `openmls_wasm_bg.wasm`,
`openmls_wasm_bg.wasm.d.ts` e `package.json`.

O que o patch adiciona ao upstream (export/restore do estado do provider e os
acessórios usados pelo `mlsEngine`) está em `patches/openmls-wasm.patch`.
