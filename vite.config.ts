import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vitest/config'
import { blankBuildPaths } from './scripts/wasm-paths.ts'
import { INDEXER_URL } from './src/config.ts'

// The only network the built page may open is the indexer. Same-origin fetches are NOT allowed (no 'self' in connect-src):
// the wasm is inlined (see below) and the recorded data is bundled, so nothing else needs fetch().
// 'wasm-unsafe-eval' is the narrowest source that lets the browser compile WebAssembly; plain 'unsafe-eval' stays off.
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self'",
  `connect-src ${INDEXER_URL}`,
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

// @tari-project/ootle-wasm imports its .wasm as an ES module. Bundlers do not support that on their own, and the usual plugin
// fetch()es the file at run time, which would force 'self' into connect-src. This plugin embeds the bytes in the JS instead and
// instantiates them with the import object the wasm asks for. The only change to the bytes: upstream's build-machine home folders
// in its panic messages are blanked at the same length (scripts/wasm-paths.ts).
function wasmInline(): Plugin {
  return {
    name: 'seance-wasm-inline',
    enforce: 'pre',
    load(id) {
      const file = id.split('?')[0]!
      if (!file.endsWith('.wasm')) return null
      const { bytes } = blankBuildPaths(readFileSync(file))
      const mod = new WebAssembly.Module(bytes)
      const modules = [...new Set(WebAssembly.Module.imports(mod).map((i) => i.module))]
      const names = WebAssembly.Module.exports(mod).map((e) => e.name)
      for (const n of names) if (!/^[A-Za-z_$][\w$]*$/.test(n)) throw new Error(`wasm export "${n}" is not a plain identifier`)
      return [
        ...modules.map((m, i) => `import * as __m${i} from ${JSON.stringify(m)};`),
        `const __b = atob(${JSON.stringify(bytes.toString('base64'))});`,
        `const __u = new Uint8Array(__b.length);`,
        `for (let i = 0; i < __b.length; i++) __u[i] = __b.charCodeAt(i);`,
        `const { instance: __i } = await WebAssembly.instantiate(__u, {${modules.map((m, i) => `${JSON.stringify(m)}: __m${i}`).join(',')}});`,
        ...names.map((n) => `export const ${n} = __i.exports[${JSON.stringify(n)}];`),
      ].join('\n')
    },
  }
}

// @tari-project/ootle-wasm declares BSD-3-Clause but ships no LICENSE file, so the generated notice lists it without any text.
// Its two sibling packages (the same project and the same licence) carry the text; it is copied verbatim, so no holder is invented.
function wasmLicenseText(): Plugin {
  const sibling = fileURLToPath(new URL('./node_modules/@tari-project/ootle/LICENSE', import.meta.url))
  return {
    name: 'seance-wasm-license-text',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const notice = bundle['THIRD-PARTY-LICENSES.md']
        if (notice?.type !== 'asset') return
        const text = readFileSync(sibling, 'utf8').trim()
        const before = String(notice.source)
        const after = before.replace(/^(## @tari-project\/ootle-wasm - .*)\n/m, (_m, heading: string) => `${heading}\n\n${text}\n`)
        if (after === before) this.error('the notice has no ootle-wasm entry to complete')
        notice.source = after
      },
    },
  }
}

// Only the production build carries the policy: the dev server injects an HMR socket that the policy would block.
function cspMeta(): Plugin {
  return {
    name: 'seance-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="utf-8" />', (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  }
}

export default defineConfig({
  base: './',
  plugins: [wasmInline(), cspMeta(), wasmLicenseText()],
  optimizeDeps: { exclude: ['@tari-project/ootle', '@tari-project/ootle-wasm'] },
  server: { host: '127.0.0.1', port: 5273, strictPort: true },
  preview: { host: '127.0.0.1', port: 4273, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2500, // one chunk on purpose: the wasm decryptor is most of it (see design.md)
    license: { fileName: 'THIRD-PARTY-LICENSES.md' },
  },
  test: { include: ['test/**/*.test.ts'], execArgv: ['--disable-warning=ExperimentalWarning'] }, // wasm ESM import is flagged experimental in Node 24
})
