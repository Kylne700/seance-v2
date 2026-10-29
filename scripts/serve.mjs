// Tiny static server for dist/: also serves it under a sub-path (e.g. /seance/) to prove the relative base works.
//   node scripts/serve.mjs [dir=dist] [port=4273] [prefix=/seance/]      (library: import { serveDir })
import http from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8', '.wasm': 'application/wasm' }

export function serveDir(dir, port, prefix = '/') {
  const root = resolve(dir)
  const server = http.createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname))
    if (!path.startsWith(prefix)) return void res.writeHead(404).end('not found')
    const rel = path.slice(prefix.length)
    let file = join(root, rel)
    if (!file.startsWith(root)) return void res.writeHead(403).end('forbidden')
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file)) return void res.writeHead(404).end('not found')
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(file))
  })
  // 127.0.0.1 only; a busy port is an error (strictPort), because another agent may be using its own ports.
  return new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => ok(server))
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , dir = 'dist', port = '4273', prefix = '/seance/'] = process.argv
  await serveDir(dir, Number(port), prefix)
  console.log(`serving ${dir} at http://127.0.0.1:${port}${prefix}`)
}
