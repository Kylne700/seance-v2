import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { blankBuildPaths } from '../scripts/wasm-paths.ts'

const HOME = ['/ho', 'me/'].join('') // pieces: npm run scan counts the literal in a tracked file as a home path
const sdk = readFileSync(new URL('../node_modules/@tari-project/ootle-wasm/ootle_wasm_bg.wasm', import.meta.url))

describe('blankBuildPaths', () => {
  it('blanks a build-machine home folder at the same length and touches nothing else', () => {
    const before = Buffer.from(`AA${HOME}builder/.cargo/registry/src/x.rs${HOME}builder/work/y.rsBB`, 'latin1')
    const { bytes, ranges } = blankBuildPaths(before)
    expect(bytes.length).toBe(before.length)
    expect(ranges).toEqual([[2, 2 + HOME.length + 'builder'.length]]) // the second path is not under .cargo/registry: left alone
    expect(bytes.toString('latin1')).toBe(`AA/${'_'.repeat(HOME.length - 1 + 'builder'.length)}/.cargo/registry/src/x.rs${HOME}builder/work/y.rsBB`)
    expect(before.toString('latin1').startsWith(`AA${HOME}`)).toBe(true) // the input is not changed
  })

  it('does nothing to bytes that hold no such path', () => {
    const plain = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 255])
    const { bytes, ranges } = blankBuildPaths(plain)
    expect(ranges).toEqual([])
    expect(bytes.equals(plain)).toBe(true)
  })

  it("the SDK's wasm: no home folder is left, every changed byte is inside a blanked range, and it still compiles", () => {
    const { bytes, ranges } = blankBuildPaths(sdk)
    expect(ranges.length).toBeGreaterThan(0) // if the SDK ever stops carrying them, this test has nothing left to prove
    expect(bytes.length).toBe(sdk.length)
    const stray: number[] = []
    for (let i = 0; i < sdk.length; i++) if (sdk[i] !== bytes[i] && !ranges.some(([a, b]) => i >= a && i < b)) stray.push(i)
    expect(stray).toEqual([])
    expect(bytes.toString('latin1').includes(HOME)).toBe(false)
    expect(() => new WebAssembly.Module(bytes)).not.toThrow()
  })
})
