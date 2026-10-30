// "Send the Seance a secret": the wallet side (src/wallet.ts), with a mock window.tari and fake timers. No network, no real wallet.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AMOUNT, APPROVAL_MS, CHECKS, GAP_MS, MEMO_MAX, POLL_MS, RESOURCE, WalletError, reason, sendSecret, waitForNote, waitForWallet, type Provider, type Problem } from '../src/wallet.ts'

const BOB = 'otl_esm_1bobsaddressbobsaddressbobsaddress'
const VISITOR = 'otl_esm_1visitorsecretaddressmustneverappear'
const COMMITMENT = 'a4e5b2d45401da7fcff14d2bf19028c5dfb1dd980ea0bbe96215dc16f88c8d43'
const TXID = '438449c523fbe05fe5ab56b16c41678c6fdee116a79cf37d5b8221f7b9cdad7c'
type Handler = (params: unknown) => unknown

/** A wallet that answers the way Sapient 0.6.14 did in the spike, and records every call. `over` replaces single answers. */
function mockWallet(over: Record<string, Handler> = {}) {
  const calls: { method: string; params?: unknown; at: number }[] = []
  let polls = 0
  const handlers: Record<string, Handler> = {
    tari_requestAccounts: () => [{ address: VISITOR }],
    tari_getNetwork: () => 'esmeralda',
    tari_getCapabilities: () => ({ privateSpend: true }),
    tari_createTransactionRequest: () => ({ requestId: 'req-1' }),
    tari_getTransactionRequest: () => (++polls < 3 ? { status: 'pending' } : { status: 'approved' }),
    tari_submitTransactionRequest: () => ({ transactionId: TXID, recipientCommitment: COMMITMENT, recipientSubstateId: 'substate_x', minimumValuePromise: '0' }),
    ...over,
  }
  const provider: Provider = {
    async request(call) {
      calls.push({ ...call, at: Date.now() })
      const h = handlers[call.method]
      if (!h) throw new Error(`unexpected call ${call.method}`)
      return h(call.params)
    },
  }
  return { provider, calls, methods: () => calls.map((c) => c.method) }
}

/** Runs a promise to its end with the fake clock moved on by `ms`, and hands back what it did, so a rejection is never left hanging. */
async function settle<T>(p: Promise<T>, ms = 0): Promise<{ value?: T; error?: unknown }> {
  const done = p.then((value) => ({ value }), (error: unknown) => ({ error }))
  await vi.advanceTimersByTimeAsync(ms)
  return done
}
const kindOf = (r: { error?: unknown }): Problem | undefined => (r.error instanceof WalletError ? r.error.kind : undefined)
const rpc = (code: number, message: string) => Object.assign(new Error(message), { code })

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('sendSecret: the call order and the request', () => {
  it('connects, checks the network and private spending, creates, waits, submits, and gives back the commitment', async () => {
    const w = mockWallet()
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'spike test' }), 5000)
    expect(r.error).toBeUndefined()
    expect(r.value).toBe(COMMITMENT)
    expect(w.methods()).toEqual([
      'tari_requestAccounts',
      'tari_getNetwork',
      'tari_getCapabilities',
      'tari_createTransactionRequest',
      'tari_getTransactionRequest',
      'tari_getTransactionRequest',
      'tari_getTransactionRequest',
      'tari_submitTransactionRequest',
    ])
  })

  it('asks for a private payment of 31415 with the private fee enforced, and no minimum value promise', async () => {
    const w = mockWallet()
    await settle(sendSecret(w.provider, { recipient: BOB, memo: 'spike test' }), 5000)
    const create = w.calls.find((c) => c.method === 'tari_createTransactionRequest')
    expect(create?.params).toEqual({
      kind: 'sendPrivately',
      resourceAddress: 'resource_' + '01'.repeat(32),
      recipientWalletAddress: BOB,
      amount: '31415',
      memo: 'spike test',
      feeType: 'private',
      enforceFeeType: true,
    })
    expect(Object.keys(create?.params as object)).not.toContain('minimumValuePromise')
    expect(RESOURCE).toBe('resource_' + '01'.repeat(32))
    expect(AMOUNT).toBe('31415')
  })

  it('never asks for the payment result or for view access, and never lets the visitor address out', async () => {
    const w = mockWallet()
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'spike test' }), 5000)
    expect(w.methods()).not.toContain('tari_getTransactionResult')
    expect(w.methods()).not.toContain('tari_requestViewAccess')
    expect(w.methods().every((m) => ['tari_requestAccounts', 'tari_getNetwork', 'tari_getCapabilities', 'tari_createTransactionRequest', 'tari_getTransactionRequest', 'tari_submitTransactionRequest'].includes(m))).toBe(true)
    expect(JSON.stringify(r)).not.toContain(VISITOR)
    expect(JSON.stringify(w.calls.map((c) => c.params))).not.toContain(VISITOR) // nothing the wallet told the page is sent back to it
  })

  it('polls the request every 500 ms, and gives the request id back to the wallet each time', async () => {
    const w = mockWallet()
    await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }), 5000)
    const polls = w.calls.filter((c) => c.method === 'tari_getTransactionRequest')
    expect(polls.map((c) => c.params)).toEqual([{ requestId: 'req-1' }, { requestId: 'req-1' }, { requestId: 'req-1' }])
    expect(polls[1].at - polls[0].at).toBe(POLL_MS)
    expect(polls[2].at - polls[1].at).toBe(POLL_MS)
  })

  it('reports each step, in order', async () => {
    const w = mockWallet()
    const steps: string[] = []
    await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }, (s) => steps.push(s)), 5000)
    expect(steps).toEqual(['connect', 'create', 'approve', 'submit'])
  })

  it('takes the commitment from a request that is already submitted, without submitting again', async () => {
    const w = mockWallet({ tari_getTransactionRequest: () => ({ status: 'submitted', result: { recipientCommitment: COMMITMENT.toUpperCase() } }) })
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }), 1000)
    expect(r.value).toBe(COMMITMENT) // lower-cased, as the indexer writes it
    expect(w.methods()).not.toContain('tari_submitTransactionRequest')
  })

  it('keeps waiting while the wallet says submitting, and does not submit twice', async () => {
    let n = 0
    const w = mockWallet({ tari_getTransactionRequest: () => (++n < 3 ? { status: 'submitting' } : { status: 'submitted', result: { recipientCommitment: COMMITMENT } }) })
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }), 5000)
    expect(r.value).toBe(COMMITMENT)
    expect(w.methods()).not.toContain('tari_submitTransactionRequest')
  })

  it('refuses empty words and words over the limit before it calls the wallet', async () => {
    const w = mockWallet()
    expect(kindOf(await settle(sendSecret(w.provider, { recipient: BOB, memo: '   ' })))).toBe('failed')
    expect(kindOf(await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x'.repeat(MEMO_MAX + 1) })))).toBe('failed')
    expect(w.calls).toEqual([])
  })

  it('accepts words of exactly the limit', async () => {
    const w = mockWallet()
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x'.repeat(MEMO_MAX) }), 5000)
    expect(r.value).toBe(COMMITMENT)
  })
})

describe('sendSecret: what goes wrong, in plain words', () => {
  it('rejected (4001) in the wallet is a quiet reset: nothing is sent', async () => {
    const w = mockWallet({ tari_createTransactionRequest: () => { throw rpc(4001, 'User rejected the request') } })
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }))
    expect(kindOf(r)).toBe('rejected')
    expect((r.error as Error).message).toBe('You said no in the wallet, so nothing was sent.')
    expect(w.methods()).not.toContain('tari_submitTransactionRequest')
  })

  it('a request the wallet reports as rejected is the same quiet reset', async () => {
    const w = mockWallet({ tari_getTransactionRequest: () => ({ status: 'rejected', error: 'user said no' }) })
    expect(kindOf(await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }), 1000))).toBe('rejected')
    expect(w.methods()).not.toContain('tari_submitTransactionRequest')
  })

  it('a refusal while submitting (4001) is the same quiet reset', async () => {
    const w = mockWallet({ tari_submitTransactionRequest: () => { throw rpc(4001, 'no') } })
    expect(kindOf(await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }), 5000))).toBe('rejected')
  })

  it('not connected (4100) says to press again and approve the connection', async () => {
    const w = mockWallet({ tari_createTransactionRequest: () => { throw rpc(4100, 'Not connected') } })
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }))
    expect(kindOf(r)).toBe('not-connected')
    expect((r.error as Error).message).toMatch(/not connected.*approve the connection/i)
  })

  it('no wallet account on the connect call is a refusal too (4001 at the first popup)', async () => {
    const w = mockWallet({ tari_requestAccounts: () => { throw rpc(4001, 'User rejected') } })
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }))
    expect(kindOf(r)).toBe('rejected')
    expect(w.methods()).toEqual(['tari_requestAccounts'])
  })

  it('a wallet on another network stops the send before anything is created', async () => {
    const w = mockWallet({ tari_getNetwork: () => 'mainnet' })
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }))
    expect(kindOf(r)).toBe('wrong-network')
    expect((r.error as Error).message).toMatch(/not on the Esmeralda testnet.*nothing was sent/)
    expect(w.methods()).toEqual(['tari_requestAccounts', 'tari_getNetwork'])
  })

  it('a wallet without private spending stops the send before anything is created', async () => {
    const w = mockWallet({ tari_getCapabilities: () => ({ privateSpend: false }) })
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }))
    expect(kindOf(r)).toBe('no-private-spend')
    expect(w.methods()).toEqual(['tari_requestAccounts', 'tari_getNetwork', 'tari_getCapabilities'])
    const none = mockWallet({ tari_getCapabilities: () => null })
    expect(kindOf(await settle(sendSecret(none.provider, { recipient: BOB, memo: 'x' })))).toBe('no-private-spend')
  })

  it('InsufficientFunds in the error says there is not enough private TARI for the amount and the fee', async () => {
    const w = mockWallet({ tari_createTransactionRequest: () => { throw new Error('Execution failure (InsufficientFunds): Bucket or vault contained insufficient revealed funds. Required: 10000000') } })
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }))
    expect(kindOf(r)).toBe('no-funds')
    expect((r.error as Error).message).toContain('0.031415 tTARI (testnet TARI)')
    expect((r.error as Error).message).toMatch(/enough private testnet TARI.*plus the fee/)
  })

  it('InsufficientFunds in a failed request is the same sentence', async () => {
    const w = mockWallet({ tari_getTransactionRequest: () => ({ status: 'failed', error: 'Execution failure (InsufficientFunds): vault is short' }) })
    expect(kindOf(await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }), 1000))).toBe('no-funds')
  })

  it('any other error is shown as the wallet worded it, as text, with addresses and ids taken out', async () => {
    const w = mockWallet({ tari_createTransactionRequest: () => { throw new Error(`Unknown template for ${VISITOR} in component_${'ab'.repeat(32)} (${'cd'.repeat(32)})`) } })
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }))
    expect(kindOf(r)).toBe('failed')
    const text = (r.error as Error).message
    expect(text).toContain('The wallet reported a problem: Unknown template for (hidden) in (hidden) ((hidden))')
    expect(text).not.toContain(VISITOR)
    expect(text).not.toMatch(/[0-9a-f]{20}/)
  })

  it('a failed request with no words still gets a sentence', async () => {
    const w = mockWallet({ tari_getTransactionRequest: () => ({ status: 'failed' }) })
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }), 1000)
    expect(kindOf(r)).toBe('failed')
    expect((r.error as Error).message).toBe('The wallet reported a problem but did not say what.')
  })

  it('a wallet that throws something that is not an Error still gives a sentence, without a crash', async () => {
    const w = mockWallet({ tari_getNetwork: () => { throw 'boom' } }) // eslint-disable-line no-throw-literal
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }))
    expect(kindOf(r)).toBe('failed')
    expect((r.error as Error).message).toBe('The wallet reported a problem: boom')
  })

  it('the page stops waiting after 300 s with no answer from the visitor', async () => {
    const w = mockWallet({ tari_getTransactionRequest: () => ({ status: 'pending' }) })
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }), APPROVAL_MS + 2000)
    expect(kindOf(r)).toBe('timeout')
    const polls = w.calls.filter((c) => c.method === 'tari_getTransactionRequest').length
    expect(polls).toBeGreaterThan(550)
    expect(polls).toBeLessThanOrEqual(APPROVAL_MS / POLL_MS + 2) // bounded
    expect(w.methods()).not.toContain('tari_submitTransactionRequest')
  })

  it('a wallet that answers without the commitment says so, and does not put an id on the page', async () => {
    const w = mockWallet({ tari_submitTransactionRequest: () => ({ transactionId: TXID, minimumValuePromise: '0' }) })
    const r = await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' }), 5000)
    expect(kindOf(r)).toBe('failed')
    expect((r.error as Error).message).toMatch(/without the note's commitment/)
    expect((r.error as Error).message).not.toContain(TXID)
    const odd = mockWallet({ tari_submitTransactionRequest: () => ({ recipientCommitment: 'not-hex' }) })
    expect(kindOf(await settle(sendSecret(odd.provider, { recipient: BOB, memo: 'x' }), 5000))).toBe('failed')
  })

  it('a create answer with no request id is a failure, not an endless wait', async () => {
    const w = mockWallet({ tari_createTransactionRequest: () => ({}) })
    expect(kindOf(await settle(sendSecret(w.provider, { recipient: BOB, memo: 'x' })))).toBe('failed')
  })
})

describe('reason: the wallet words that may be shown', () => {
  it('takes out addresses, ids and long hex, squeezes white space and cuts at 200 characters', () => {
    expect(reason(`a ${VISITOR}   b\n c`)).toBe('a (hidden) b c')
    expect(reason(`utxo_${'0f'.repeat(32)} resource_${'01'.repeat(32)}`)).toBe('(hidden) (hidden)')
    expect(reason('x'.repeat(500))).toHaveLength(201)
    expect(reason('')).toBe('')
  })
})

describe('waitForWallet', () => {
  const fakeWindow = (tari?: unknown) => Object.assign(new EventTarget(), { tari }) as unknown as Window & { tari?: unknown }

  it('returns the wallet at once when window.tari is already there', async () => {
    const tari = mockWallet().provider
    expect(await waitForWallet(fakeWindow(tari))).toBe(tari)
  })

  it('waits for tari#initialized, and takes the wallet that arrives with it', async () => {
    const win = fakeWindow()
    const p = waitForWallet(win)
    await vi.advanceTimersByTimeAsync(1000)
    win.tari = mockWallet().provider
    win.dispatchEvent(new Event('tari#initialized'))
    expect(await p).toBe(win.tari)
  })

  it('gives up with null after 3000 ms when there is no wallet, and leaves no listener behind', async () => {
    const win = fakeWindow()
    const remove = vi.spyOn(win, 'removeEventListener')
    const p = waitForWallet(win)
    let done = false
    void p.then(() => (done = true))
    await vi.advanceTimersByTimeAsync(2999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toBeNull()
    expect(remove).toHaveBeenCalledWith('tari#initialized', expect.any(Function))
  })

  it('does not take for a wallet something that has no request function', async () => {
    const p = waitForWallet(fakeWindow({ request: 'nope' }))
    await vi.advanceTimersByTimeAsync(3000)
    expect(await p).toBeNull()
  })
})

describe('waitForNote: the watch for the payment in the list', () => {
  it('looks 9 times by default, 20 s after each look ended, and reports not found', async () => {
    const starts: number[] = []
    const ends: number[] = []
    const look = async (): Promise<string | null> => {
      starts.push(Date.now())
      await new Promise((r) => setTimeout(r, 1500)) // a look takes time too
      ends.push(Date.now())
      return null
    }
    const t0 = Date.now()
    const r = await settle(waitForNote(look), 20 * 60_000)
    expect(r.value).toEqual({ found: null, checks: CHECKS, failed: 0, stopped: null })
    expect(CHECKS).toBe(9)
    expect(GAP_MS).toBe(20_000)
    expect(starts).toHaveLength(9)
    expect(starts[0] - t0).toBe(GAP_MS) // the first look is 20 s after the send
    for (let i = 1; i < starts.length; i++) expect(starts[i] - ends[i - 1]).toBeGreaterThanOrEqual(GAP_MS)
  })

  it('stops at the look that finds it', async () => {
    let n = 0
    const r = await settle(waitForNote(async () => (++n === 3 ? 'it' : null)), 20 * 60_000)
    expect(r.value).toEqual({ found: 'it', checks: 3, failed: 0, stopped: null })
    expect(n).toBe(3)
  })

  it('a look that fails counts as a look and the watch goes on', async () => {
    let n = 0
    const r = await settle(
      waitForNote(async () => {
        if (++n < 3) throw new Error('indexer is down')
        return n === 4 ? 'it' : null
      }),
      20 * 60_000,
    )
    expect(r.value).toEqual({ found: 'it', checks: 4, failed: 2, stopped: null })
  })

  it('asks stop() before every look, and ends the watch with its answer before looking again', async () => {
    let looks = 0
    let answer: string | null = null
    const stop = () => answer
    const p = waitForNote(async () => (++looks, null), { stop })
    const r = settle(p)
    await vi.advanceTimersByTimeAsync(GAP_MS) // look 1
    expect(looks).toBe(1)
    answer = 'recorded data'
    await vi.advanceTimersByTimeAsync(GAP_MS)
    expect(looks).toBe(1) // look 2 never happened
    expect((await r).value).toEqual({ found: null, checks: 1, failed: 0, stopped: 'recorded data' })
  })

  it('tells the page where it is: waiting, then looking, for each of the looks', async () => {
    const seen: string[] = []
    await settle(waitForNote(async () => null, { checks: 2, progress: (n, of, phase) => seen.push(`${n}/${of} ${phase}`) }), 120_000)
    expect(seen).toEqual(['1/2 waiting', '1/2 looking', '2/2 waiting', '2/2 looking'])
  })
})
