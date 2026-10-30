// Sending a short secret to the page's demo recipient with the Sapient wallet extension (window.tari), and watching the list for the payment.
// No DOM in here, so a mock wallet tests it; walletui.ts joins it to the page. The README lists every wallet method the page calls.
// It never calls tari_getTransactionResult or tari_requestViewAccess: the page finds the payment in the list by its commitment, and asks for no view key.
// What the wallet returns is dropped on the spot, except the commitment of the note that was sent: a value that is public on the chain anyway.

/** The part of window.tari this page calls. */
export interface Provider {
  request(call: { method: string; params?: unknown }): Promise<unknown>
}

export const NETWORK = 'esmeralda'
/** 0.031415 tTARI (testnet TARI) in the token's smallest unit (6 decimals). The fee is extra, and is paid privately. */
export const AMOUNT = '31415'
export const AMOUNT_TEXT = '0.031415 tTARI (testnet TARI)'
export const RESOURCE = 'resource_' + '01'.repeat(32)
// shortcut: 40 chars proven on Sapient 0.6.14, longer not tested
export const MEMO_MAX = 40
export const WALLET_WAIT_MS = 3000
export const POLL_MS = 500
/** How long the page waits for the visitor to answer in the wallet: 300 s. */
export const APPROVAL_MS = 300_000
/** After a send: up to 9 looks at the list, each 20 s after the one before. */
export const CHECKS = 9
export const GAP_MS = 20_000

export type Problem = 'no-wallet' | 'wrong-network' | 'no-private-spend' | 'rejected' | 'not-connected' | 'no-funds' | 'timeout' | 'failed'

export class WalletError extends Error {
  kind: Problem
  constructor(kind: Problem, message: string) {
    super(message)
    this.kind = kind
  }
}

const SAYS: Record<Exclude<Problem, 'failed'>, string> = {
  'no-wallet': 'This needs the Sapient wallet extension in a Chromium browser, on the Esmeralda testnet, with a little private testnet TARI. No wallet? The video shows this step.',
  'wrong-network': 'Your wallet is not on the Esmeralda testnet, so nothing was sent. Switch the wallet to Esmeralda and try again.',
  'no-private-spend': 'This wallet does not offer private sending, so nothing was sent.',
  rejected: 'You said no in the wallet, so nothing was sent.',
  'not-connected': 'The wallet says this page is not connected. Press the button again and approve the connection.',
  'no-funds': `The wallet does not hold enough private testnet TARI for ${AMOUNT_TEXT} plus the fee, so the payment did not go through.`,
  timeout: 'The wallet did not answer in time, so the page stopped waiting. Check the wallet before you try again.',
}
const problem = (kind: Exclude<Problem, 'failed'>): WalletError => new WalletError(kind, SAYS[kind])
export const NO_WALLET = SAYS['no-wallet']

// The wallet's own words are shown as text, after anything that looks like an address or an id is taken out and the length is cut.
const ADDRESS_LIKE = /otl_[a-z0-9]+_[0-9a-z]+|(?:component|vault|utxo|resource|substate|account|template|tx)_[0-9a-f]{8,}|[0-9a-f]{40,}/gi
export function reason(text: string): string {
  const t = text.replace(ADDRESS_LIKE, '(hidden)').replace(/\s+/g, ' ').trim()
  return t.length > 200 ? `${t.slice(0, 200).trimEnd()}…` : t
}

/** A wallet failure, in words: 4001 is the visitor saying no, 4100 is "not connected", and a missing balance has a sentence of its own. */
function classify(e: unknown): WalletError {
  if (e instanceof WalletError) return e
  const o = (typeof e === 'object' && e !== null ? e : {}) as { code?: unknown; message?: unknown }
  const raw = typeof o.message === 'string' ? o.message : typeof e === 'string' ? e : ''
  if (Number(o.code) === 4001) return problem('rejected')
  if (Number(o.code) === 4100) return problem('not-connected')
  if (/InsufficientFunds|insufficient funds/i.test(raw)) return problem('no-funds')
  const why = reason(raw)
  return new WalletError('failed', why ? `The wallet reported a problem: ${why}` : 'The wallet reported a problem but did not say what.')
}

/** The wallet object, or null when there is none within `ms`. The extension announces itself with a `tari#initialized` event, and may already be there. */
export function waitForWallet(win: Pick<Window, 'addEventListener' | 'removeEventListener'> & { tari?: unknown }, ms: number = WALLET_WAIT_MS): Promise<Provider | null> {
  const have = (): Provider | null => {
    const t = win.tari as Partial<Provider> | undefined
    return t && typeof t.request === 'function' ? (t as Provider) : null
  }
  const now = have()
  if (now) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      win.removeEventListener('tari#initialized', done)
      resolve(have())
    }
    const timer = setTimeout(done, ms)
    win.addEventListener('tari#initialized', done)
  })
}

export type Step = 'connect' | 'create' | 'approve' | 'submit'
interface RequestState {
  status?: string
  result?: unknown
  error?: unknown
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function commitmentOf(result: unknown): string {
  const c = (result as { recipientCommitment?: unknown } | null)?.recipientCommitment
  if (typeof c === 'string' && /^[0-9a-f]{64}$/i.test(c)) return c.toLowerCase()
  throw new WalletError('failed', "The wallet answered without the note's commitment, so this page cannot search for the payment. Your wallet shows whether it was sent.")
}

/**
 * Connects, checks the network and private spending, asks the wallet for a private payment of AMOUNT_TEXT to `recipient` with `memo`, waits for the visitor's answer
 * and submits it. Resolves with the commitment of the note that was sent, the one thing the page needs to find it in the list. Throws a WalletError.
 */
export async function sendSecret(wallet: Provider, o: { recipient: string; memo: string }, say: (step: Step) => void = () => {}): Promise<string> {
  if (!o.memo.trim() || o.memo.length > MEMO_MAX) throw new WalletError('failed', `The words must be between 1 and ${MEMO_MAX} characters.`)
  const call = async (method: string, params?: unknown): Promise<unknown> => {
    try {
      return await wallet.request(params === undefined ? { method } : { method, params })
    } catch (e) {
      throw classify(e)
    }
  }
  say('connect')
  await call('tari_requestAccounts') // the answer holds the visitor's address: it is not read, kept or shown
  if ((await call('tari_getNetwork')) !== NETWORK) throw problem('wrong-network')
  if (!((await call('tari_getCapabilities')) as { privateSpend?: unknown } | null)?.privateSpend) throw problem('no-private-spend')
  say('create')
  const made = await call('tari_createTransactionRequest', {
    kind: 'sendPrivately',
    resourceAddress: RESOURCE,
    recipientWalletAddress: o.recipient,
    amount: AMOUNT,
    memo: o.memo,
    feeType: 'private', // the fee comes out of private funds too, so the sender's account is not named on the chain
    enforceFeeType: true,
    // no minimumValuePromise: it is a public number
  })
  const requestId = (made as { requestId?: unknown } | null)?.requestId
  if (requestId == null) throw new WalletError('failed', 'The wallet did not accept the request.')
  say('approve')
  const until = Date.now() + APPROVAL_MS
  for (;;) {
    const s = ((await call('tari_getTransactionRequest', { requestId })) ?? {}) as RequestState
    if (s.status === 'approved') {
      say('submit')
      return commitmentOf(await call('tari_submitTransactionRequest', { requestId }))
    }
    if (s.status === 'submitted') return commitmentOf(s.result)
    if (s.status === 'rejected') throw problem('rejected')
    if (s.status === 'failed') throw classify({ message: typeof s.error === 'string' ? s.error : (s.error as { message?: unknown } | null)?.message })
    if (Date.now() >= until) throw problem('timeout')
    await sleep(POLL_MS)
  }
}

export interface Watched<T> {
  found: T | null
  /** Looks made (the one that failed counts). */
  checks: number
  /** Looks that failed instead of answering. */
  failed: number
  /** Why the watch ended early, when it did. */
  stopped: string | null
}

/**
 * Waits `gapMs`, looks for the payment, waits again once that look has ended, up to `checks` looks: 9 looks, 20 s apart, by default.
 * `stop` is asked before every look and ends the watch with its answer. A look that fails counts as a look and the watch goes on.
 */
export async function waitForNote<T>(
  look: () => Promise<T | null>,
  o: { checks?: number; gapMs?: number; stop?: () => string | null; progress?: (n: number, of: number, phase: 'waiting' | 'looking') => void } = {},
): Promise<Watched<T>> {
  const total = o.checks ?? CHECKS
  const gap = o.gapMs ?? GAP_MS
  let failed = 0
  for (let n = 1; n <= total; n++) {
    o.progress?.(n, total, 'waiting')
    await sleep(gap)
    const why = o.stop?.() ?? null
    if (why) return { found: null, checks: n - 1, failed, stopped: why }
    o.progress?.(n, total, 'looking')
    try {
      const hit = await look()
      if (hit) return { found: hit, checks: n, failed, stopped: null }
    } catch {
      failed++
    }
  }
  return { found: null, checks: total, failed, stopped: null }
}
