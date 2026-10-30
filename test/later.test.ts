// The ghosts from later. The Doppelganger counts what a copied key opens on the transactions the page already holds; the Revenant lists what a
// computer that solves discrete logarithms would read, and simulates it with the published demo keys on the demo payments only.
// The expected numbers are the ones written down when each transaction was sent (ledger.json, scripts/make-hero.mjs and make-demo.mjs), not read back from this code.
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ledger from '../ledger.json'
import { audited } from '../src/auditor.ts'
import { parseTransaction, type TxView } from '../src/chain.ts'
import { SEANCE_RESOURCE } from '../src/config.ts'
import { createData, demoKeys, demos, ourIds } from '../src/data.ts'
import { auditCounts, auditSentences, RUNGS, viewCount, viewSentence, windowOf, windowWords } from '../src/doppel.ts'
import { amountOf } from '../src/format.ts'
import { fields, INTRO, separate, SIMULATION, simulate, standIns, tiers } from '../src/revenant.ts'

interface Tx {
  id: string
  to: string
  reply: unknown
  expected: { outputs: { output: string; reader: string | null; value?: string; memo?: string | null; auditor?: string }[] }
}
const txs = ledger.txs as unknown as Tx[]
const heroes = ledger.hero as unknown as Tx[]
const keys = ledger.keys as Record<string, { viewSecret: string }>
const recorded = txs.map((t) => parseTransaction(t.reply))
const heroViews = heroes.map((t) => parseTransaction(t.reply))
const crowd = (ledger.recent.transactions as unknown[]).flatMap((t) => {
  try {
    const v = parseTransaction(t)
    return v.outputs.length ? [v] : []
  } catch {
    return [] // a shape this page does not read, skipped as the page skips it
  }
})
const alive = (): boolean => true
const TARI = recorded[0].outputs[0].resource
const names = (v: TxView): string[] => fields(v).map((f) => f.name)

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the Doppelganger: a view key on the recorded window', () => {
  const win = windowOf(recorded[0], 'recorded', { recorded, latest: [] })

  it('is the 11 recorded demo payments, 21 sealed notes', () => {
    expect(win.length).toBe(11)
    expect(win.flatMap((v) => v.outputs).length).toBe(21)
  })

  it('opens what the recording says each key opens: Bob 5 of 21, Carol 5 of 21, Eve none', async () => {
    const want = (name: string): number => txs.flatMap((t) => t.expected.outputs).filter((o) => o.reader === name).length
    for (const [name, n] of [['bob', 5], ['carol', 5], ['eve', 0]] as const) {
      const c = await viewCount(keys[name].viewSecret, win, alive)
      expect(want(name), name).toBe(n)
      expect(c, name).toMatchObject({ transactions: 11, notes: 21, opened: n })
    }
  })

  it("adds up what the opened notes hold per token, and shows none of them as spent in the recording", async () => {
    const bob = await viewCount(keys.bob.viewSecret, win, alive)
    const total = txs.flatMap((t) => t.expected.outputs).filter((o) => o.reader === 'bob').reduce((sum, o) => sum + BigInt(o.value as string), 0n)
    expect(bob?.worth).toEqual([amountOf(TARI, total)])
    expect(bob?.spent).toBe(0)
  })

  it('counts an opened note as spent when another transaction in the window spends it', async () => {
    const bobsNote = recorded[0].statements[0].outputs[0]
    const spender: TxView = { ...recorded[1], id: 'cd'.repeat(32), outputs: [], statements: [{ ...recorded[1].statements[0], outputs: [], inputCommitments: [bobsNote.commitment] }] }
    const bob = await viewCount(keys.bob.viewSecret, [...win, spender], alive)
    expect(bob).toMatchObject({ transactions: 12, notes: 21, opened: 5, spent: 1 })
  })

  it('tokens are never added together', async () => {
    const mixed = [...win, ...heroViews]
    const bob = await viewCount(keys.bob.viewSecret, mixed, alive)
    expect(bob?.worth.length).toBe(2)
    expect(bob?.worth.some((w) => w.endsWith('tTARI'))).toBe(true)
    expect(bob?.worth.some((w) => w.endsWith('SEANCE'))).toBe(true)
  })

  it('stops when the answer is no longer wanted', async () => {
    let t = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (t += 25)) // every transaction takes a whole slice, so the count yields and asks
    expect(await viewCount(keys.bob.viewSecret, win, () => false)).toBeNull()
  })

  it('says it in the words the page uses', async () => {
    const bob = (await viewCount(keys.bob.viewSecret, win, alive)) as NonNullable<Awaited<ReturnType<typeof viewCount>>>
    expect(viewSentence(bob, 'the recorded demo payments and the one on the table')).toBe(
      `In the recorded demo payments and the one on the table (11 transactions, 21 sealed notes), this key opens 5 notes worth ${bob.worth[0]}. The window shows 0 of them as spent.`,
    )
    expect(viewSentence({ ...bob, opened: 0, worth: [], spent: 0 }, 'your file')).toBe('In your file (11 transactions, 21 sealed notes), this key opens none of the notes.')
    expect(viewSentence({ ...bob, opened: 1, worth: ['1 tTARI'], spent: 1 }, 'x')).toContain('opens 1 note worth 1 tTARI')
  })
})

describe('the Doppelganger: an audit key', () => {
  it('counts the notes that carry an audit copy, as many as the recording says the Auditor opens, with no key tried', () => {
    for (const [i, v] of heroViews.entries()) {
      const want = heroes[i].expected.outputs.filter((o) => o.auditor !== undefined).length
      expect(want).toBe(2)
      expect(audited(v.outputs).length).toBe(want)
      expect(auditCounts([v])).toEqual([{ resource: SEANCE_RESOURCE, audited: want, notes: v.outputs.length }])
    }
  })

  it('finds none in the window of TARI payments, and counts only the audited token in a mixed one', () => {
    expect(auditCounts(recorded)).toEqual([])
    expect(auditCounts([...recorded, heroViews[0]])).toEqual([{ resource: SEANCE_RESOURCE, audited: 2, notes: 2 }])
  })

  it('names the published demo key for the demo token, and no key for another', () => {
    expect(auditSentences(auditCounts([heroViews[0]]), 'the one on the table')).toEqual(['In the one on the table, 2 of the 2 notes of SEANCE carry an audit copy of the amount. The key that opens them is the published demo audit key, the one the Auditor uses.'])
    expect(auditSentences([{ resource: 'resource_' + 'ab'.repeat(32), audited: 1, notes: 3 }], 'your file')[0]).toMatch(/^In your file, 1 of the 3 notes of the token ababab…ababab carries an audit copy of the amount\. This page does not hold that token's audit key\./)
    expect(auditSentences([], 'your file')).toEqual(['No note in your file carries an audit copy, so no audit key opens anything there.'])
  })
})

describe('the window', () => {
  const stranger = crowd.find((v) => !recorded.some((r) => r.id === v.id)) as TxView

  it('is the recording plus the transaction on the table, never twice', () => {
    expect(windowOf(stranger, 'recorded', { recorded, latest: [] }).map((v) => v.id)).toEqual([...recorded.map((v) => v.id), stranger.id])
    expect(windowOf(recorded[3], 'recorded', { recorded, latest: [] }).length).toBe(11)
  })

  it('is the downloaded list plus the transaction on the table when live, and the file alone for a file', () => {
    expect(windowOf(heroViews[0], 'live', { recorded, latest: crowd }).map((v) => v.id)).toEqual([...crowd.map((v) => v.id), heroViews[0].id])
    expect(windowOf(crowd[0], 'live', { recorded, latest: crowd }).length).toBe(crowd.length)
    expect(windowOf(crowd[0], 'live', { recorded, latest: [] }).map((v) => v.id)).toEqual([crowd[0].id])
    expect(windowOf(crowd[0], 'file', { recorded, latest: crowd }).map((v) => v.id)).toEqual([crowd[0].id])
  })

  it('is described by where it comes from', () => {
    expect(windowWords('file', true)).toBe('your file')
    expect(windowWords('live', false)).toBe('the transaction on the table')
    expect(windowWords('recorded', true)).toContain('recorded demo payments')
    expect(windowWords('live', true)).toContain('latest transactions this page downloaded')
  })

  it('is read from the list the page already holds, and asking for it asks nobody', async () => {
    const fn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ transactions: ledger.recent.transactions }), { status: 200 }))
    vi.stubGlobal('fetch', fn)
    const data = createData({ pick: () => 0 })
    expect(await data.latest()).toEqual([])
    expect(fn).not.toHaveBeenCalled()
    await data.recent()
    expect(fn).toHaveBeenCalledTimes(1)
    expect((await data.latest()).map((v) => v.id)).toEqual(crowd.map((v) => v.id))
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('counting makes no request', async () => {
    const fn = vi.fn()
    vi.stubGlobal('fetch', fn)
    await viewCount(keys.bob.viewSecret, recorded, alive)
    auditCounts(heroViews)
    await simulate(heroViews[3], standIns(heroViews[3], demos, demoKeys) as { view: string; audit: string }, alive)
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('the four rungs', () => {
  const text = (id: string): string => RUNGS.find((r) => r.id === id)!.lines.map(([a, b]) => `${a}. ${b}`).join(' ')

  it('run from no key to the spend key, each with what it opens, whether it can spend and whether the owner can stop it', () => {
    expect(RUNGS.map((r) => r.id)).toEqual(['none', 'view', 'audit', 'spend'])
    for (const r of RUNGS) {
      expect(r.lines.map(([label]) => label), r.id).toEqual(expect.arrayContaining(['Opens', 'Can spend', 'Can the owner stop it']))
    }
  })

  it('say "cannot spend" only as the code says it, and say what was not covered', () => {
    expect(text('view')).toContain('it cannot spend (by the code; not tried)')
    expect(text('audit')).toContain('it cannot spend (by the code; not tried), provided it is a fresh key used for nothing else')
    expect(text('audit')).toContain('no such function in the Tari code we read, v0.46.1 and v0.48.0')
    expect(text('spend')).toContain('Not covered by the Tari code we read for this page.')
    expect(text('spend')).toContain('Never asks for it')
  })
})

describe('the Revenant: tiers, fields and the lines apart from reading', () => {
  const tari = recorded[0]
  const hero = heroViews[0]
  const empty: TxView = { ...tari, outputs: [], statements: [] }

  it('puts a transaction without an audit copy under tiers 1 and 2, and one with audit copies under tiers 2 and 3', () => {
    const [a1, a2, a3] = tiers(tari)
    expect(a1.here).toContain('2 of the 2 sealed notes here have no audit copy')
    expect(a2.here).toContain('whoever received these 2 sealed notes')
    expect(a3.here).toBe('No note here carries an audit copy, so this tier does not reach this transaction.')
    const [b1, , b3] = tiers(hero)
    expect(b1.here).toContain('Every sealed note here carries an audit copy')
    expect(b3.here).toBe('2 of the 2 sealed notes here carry an audit copy. That computer would read their amounts from public data alone.')
  })

  it('has nothing to say about notes in a transaction that seals none', () => {
    const [t1, t2, t3] = tiers(empty)
    expect(t1.here).toContain('seals no note')
    expect(t2.here).toBe('No sealed note here.')
    expect(t3.here).toContain('No note here carries an audit copy')
    expect(names(empty)).toEqual(['Already public'])
    expect(separate(empty).join(' ')).not.toContain('could be spent')
  })

  it('lists the fields this transaction holds, and the audit copy only when a note carries one', () => {
    expect(names(tari)).toEqual(['Commitment', 'Range proof', 'Locked message', "Sender's one-time key", 'Tag', 'Lock key', 'Balance proof', 'Already public'])
    expect(names(hero)).toEqual(['Commitment', 'Range proof', 'Locked message', "Sender's one-time key", 'Tag', 'Lock key', 'Audit copy', 'Balance proof', 'Already public'])
  })

  it('says, field by field, that the commitment and the range proof give that computer nothing', () => {
    const row = (n: string) => fields(tari).find((f) => f.name === n)!
    expect(row('Commitment').alone).toMatch(/^Nothing\./)
    expect(row('Range proof').alone).toMatch(/^Nothing\./)
    expect(row('Locked message').alone).toBe('Nothing.')
    expect(row('Locked message').withAddress).toContain('every note sent to that address')
    expect(fields(hero).find((f) => f.name === 'Audit copy')!.alone).toContain('Every amount of the token')
  })

  it('keeps theft, broken binding and forged signatures out of the list of who can read', () => {
    const lines = separate(tari)
    expect(lines.length).toBe(3)
    expect(lines[0]).toMatch(/^Notes not yet spent could be spent\. 2 notes here have a lock key in the open/)
    expect(lines[1]).toMatch(/^Broken binding\./)
    expect(lines[2]).toMatch(/^Signatures\. This transaction names \d+ signer keys? in the open/)
    expect(lines.join(' ')).not.toMatch(/\bstolen\b/)
  })

  it('pins the label and the introduction', () => {
    expect(SIMULATION).toBe("Simulation. We use the demo keys we published in place of a computer that can solve discrete logarithms. Such a computer could be, for example, a large quantum computer running Shor's algorithm; this page does not say when or whether one will exist.")
    expect(INTRO.startsWith('Harvest now, decrypt later')).toBe(true)
  })
})

describe('the Revenant: the simulation reads demo payments only', () => {
  it('has stand-in keys for each of the 15 demo payments, the recipient view key and the demo audit key', () => {
    expect(demos.length).toBe(15)
    for (const d of demos) {
      const view = [...recorded, ...heroViews].find((v) => v.id === d.id) as TxView
      expect(standIns(view, demos, demoKeys), d.id).toEqual({ view: keys[d.to].viewSecret, audit: ledger.auditor.secret })
    }
  })

  it('has none for any other transaction, and the demo keys open nothing in the recorded sample of them', async () => {
    const notOurs = crowd.filter((v) => !ourIds.has(v.id)) // the recorded sample also holds one payment of our own, from an earlier set
    expect(notOurs.length).toBeGreaterThan(0)
    for (const v of notOurs) {
      expect(standIns(v, demos, demoKeys), v.id).toBeNull()
      const s = await simulate(v, { view: keys.bob.viewSecret, audit: ledger.auditor.secret }, alive)
      expect(s?.reads, v.id).toEqual([])
    }
  })

  it("reads a TARI demo payment with the recipient's view key, and has no audit copy to count", async () => {
    const i = txs.findIndex((t) => t.to === 'bob')
    const s = await simulate(recorded[i], standIns(recorded[i], demos, demoKeys) as { view: string; audit: string }, alive)
    const want = txs[i].expected.outputs.filter((o) => o.reader === 'bob')
    expect(s?.counts).toBeNull()
    expect(s?.reads.map((r) => [String(r.plain.value), r.plain.memo])).toEqual(want.map((o) => [o.value, o.memo ?? null]))
  })

  it('reads a demo-token payment twice: the memo and amount with the view key, both amounts with the audit key', async () => {
    const i = 3
    const s = await simulate(heroViews[i], standIns(heroViews[i], demos, demoKeys) as { view: string; audit: string }, alive)
    const out = heroes[i].expected.outputs
    expect(s?.reads.map((r) => [String(r.plain.value), r.plain.memo])).toEqual(out.filter((o) => o.reader).map((o) => [o.value, o.memo]))
    expect(s?.counts?.map((c) => String(c.amount))).toEqual(out.map((o) => o.auditor))
  })

  it('stops when the answer is no longer wanted', async () => {
    expect(await simulate(heroViews[3], standIns(heroViews[3], demos, demoKeys) as { view: string; audit: string }, () => false)).toBeNull()
  })
})

describe('the new modules ask nobody', () => {
  it('use no network, storage or dynamic import', () => {
    for (const f of ['doppel', 'revenant']) {
      const src = readFileSync(new URL(`../src/${f}.ts`, import.meta.url), 'utf8')
      expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|\bimport\s*\(|IndexerClient|localStorage|sessionStorage|indexedDB|document\.cookie/)
    }
  })
})
