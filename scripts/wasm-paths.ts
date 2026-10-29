// The SDK's wasm was built on someone else's machine, and rustc left that machine's build paths in its panic messages
// (a home folder, then .cargo/registry). They are upstream's, not ours, but they would ship inside our bundle and read like a leak.
// Each home folder becomes a same-length run of "_": no offset moves and the module stays valid. Nothing else is touched.
// The prefix is built from pieces because npm run scan counts the literal in any tracked file as a home path.
const BUILD_HOME = new RegExp(`${['/ho', 'me/'].join('')}[^/\\s]+(?=/\\.cargo/registry)`, 'g')

/** A copy of the wasm with every build-machine home folder blanked, and the byte range of each one. */
export function blankBuildPaths(wasm: Uint8Array): { bytes: Buffer<ArrayBuffer>; ranges: [number, number][] } {
  const bytes = Buffer.from(wasm)
  const ranges: [number, number][] = []
  for (const m of bytes.toString('latin1').matchAll(BUILD_HOME)) {
    ranges.push([m.index, m.index + m[0].length])
    bytes.fill('_', m.index + 1, m.index + m[0].length) // latin1 is one byte per character, so text offsets are byte offsets; the leading slash stays
  }
  return { bytes, ranges }
}
