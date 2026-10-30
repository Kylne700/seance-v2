// The "Send the Seance a secret" section: a field for a few words, a review that shows them back, the wallet call (src/wallet.ts) and the watch for the payment in the list.
// The words go onto the page as text. Nothing the wallet says about the visitor is read, kept or shown, and an error from the wallet is shown as text and never logged.
import { RECENT_LIMIT } from './config.ts'
import { bobAddress, LookupError, type Shown } from './data.ts'
import { plural, short } from './format.ts'
import { AMOUNT_TEXT, APPROVAL_MS, GAP_MS, NO_WALLET, WalletError, sendSecret, waitForNote, waitForWallet, type Provider, type Step } from './wallet.ts'

export interface Deps {
  $: <T extends HTMLElement = HTMLElement>(id: string) => T
  /** The page's data: which mode it is in, and the finder for the visitor's own payment (the list, never an id). */
  data: { readonly mode: 'live' | 'recorded'; findNote(commitment: string, o?: { fresh?: boolean }): Promise<Shown | null> }
  /** Hands the found payment to the ghosts. */
  show(shown: Shown): void
}

const READY = 'A wallet is available in this browser. Type your words and press "Review my words". Nothing goes to the wallet until you confirm.'
const RECORDED = 'This page is showing recorded data and does not ask the indexer. Press "Use recorded data" again to go back to live data, then send.'
const STOPPED = 'The page stopped looking because it is now showing recorded data. Press "Use recorded data" again to go back to live data, then press "Look again".'
const STILL = `Still not in the indexer's latest ${RECENT_LIMIT} transactions. Press "Look again" to check once more.`
const NO_LIST = 'The indexer did not give a list just now. Press "Look again" to try once more.'
const ODD = 'Something unexpected went wrong. Check your wallet to see whether the payment was sent.'
const STEPS: Record<Step, string> = {
  connect: 'Asking your wallet to connect. Approve the connection in the wallet if it asks.',
  create: `Asking your wallet for a private payment of ${AMOUNT_TEXT} to Bob.`,
  approve: `Waiting for your answer in the wallet. The page waits up to ${APPROVAL_MS / 1000} s.`,
  submit: 'Sending the payment…',
}
const found = (size: number): string =>
  `Found it. The page found your payment among the indexer's latest ${plural(size, 'transaction')} by its commitment, and asked no indexer for it by id. Your wallet looks up its own payment by id at its own host, ootle-indexer-a.tari.com. The three ghosts are reading it.`
const missing = (looks: number, failed: number): string =>
  `Your payment is not in the indexer's latest ${RECENT_LIMIT} transactions yet. It may still be on its way, or a busy network can push it past the newest ${RECENT_LIMIT} before the page looks again. The page looked ${plural(looks, 'time')}, ${GAP_MS / 1000} s apart, and asked nobody for your payment by its id.${failed ? ` ${plural(failed, 'look')} got no list from the indexer.` : ''} Press "Look again" to check once more.`

export function mountWallet({ $, data, show }: Deps): void {
  const field = $<HTMLInputElement>('wallet-memo')
  const send = $('wallet-send')
  const review = $('wallet-review')
  const echo = $('wallet-echo')
  const to = $('wallet-to')
  const confirm = $('wallet-confirm')
  const change = $('wallet-change')
  const status = $('wallet-status')
  const more = $('wallet-more')
  const again = $('wallet-again')
  let idle = true
  let wallet: Provider | null = null
  let words = '' // what the review showed, and what is sent
  let wanted: string | null = null // the commitment of the note being looked for

  const say = (text: string, kind: 'info' | 'warn' | 'error' = 'info'): void => {
    status.textContent = text
    status.className = `status ${kind}`
  }
  const busy = (on: boolean): void => {
    idle = !on
    for (const b of [send, confirm, change, again]) b.setAttribute('aria-disabled', String(on)) // not "disabled": keyboard focus must not fall off the button
    field.readOnly = on
  }
  const closeReview = (): void => {
    review.hidden = true
  }

  // The wallet is looked for when the page is ready, and again when the visitor presses the button. Nothing is asked of it here.
  void waitForWallet(window).then((w) => {
    wallet = w
    if (idle) say(w ? READY : NO_WALLET)
  })

  async function onReview(): Promise<void> {
    if (!idle) return
    const typed = field.value.trim()
    if (!typed) return say('Type a few words to send, then press "Review my words".', 'warn')
    if (data.mode !== 'live') return say(RECORDED, 'warn')
    busy(true)
    say('Looking for your wallet…')
    wallet = await waitForWallet(window)
    busy(false)
    if (!wallet) return say(NO_WALLET)
    words = typed
    echo.textContent = `“${words}”`
    to.textContent = `To Bob, the demo recipient (${short(bobAddress, 12)}): ${AMOUNT_TEXT}, and a fee on top, paid privately.`
    review.hidden = false
    say('')
  }

  function done(shown: Shown): void {
    wanted = null
    more.hidden = true
    field.value = ''
    words = ''
    say(found(shown.list?.size ?? RECENT_LIMIT))
    show(shown)
  }

  async function onConfirm(): Promise<void> {
    if (!idle || review.hidden || !wallet) return
    if (data.mode !== 'live') {
      closeReview()
      return say(RECORDED, 'warn')
    }
    busy(true)
    closeReview()
    more.hidden = true
    try {
      wanted = await sendSecret(wallet, { recipient: bobAddress, memo: words }, (step) => say(STEPS[step]))
      const commitment = wanted
      const r = await waitForNote(() => data.findNote(commitment, { fresh: true }), {
        stop: () => (data.mode === 'live' ? null : 'recorded'),
        progress: (n, of, phase) => say(phase === 'waiting' ? `Sent. Next check in ${GAP_MS / 1000} s (check ${n} of ${of}).` : `Checking the indexer's latest ${RECENT_LIMIT} transactions (check ${n} of ${of}).`),
      })
      if (r.found) done(r.found)
      else {
        more.hidden = false
        say(r.stopped ? STOPPED : missing(r.checks, r.failed), 'warn')
      }
    } catch (e) {
      // A refusal in the wallet is a quiet reset; any other failure is the wallet's own words, as text. Nothing is logged.
      if (e instanceof WalletError) say(e.message, e.kind === 'rejected' ? 'info' : 'error')
      else say(ODD, 'error')
    } finally {
      busy(false)
    }
  }

  async function onAgain(): Promise<void> {
    if (!idle || !wanted) return
    busy(true)
    say(`Checking the indexer's latest ${RECENT_LIMIT} transactions…`)
    try {
      const hit = await data.findNote(wanted, { fresh: true })
      if (hit) done(hit)
      else say(STILL, 'warn')
    } catch (e) {
      say(e instanceof LookupError ? e.message : NO_LIST, 'warn')
    } finally {
      busy(false)
    }
  }

  send.addEventListener('click', () => void onReview())
  confirm.addEventListener('click', () => void onConfirm())
  again.addEventListener('click', () => void onAgain())
  change.addEventListener('click', () => {
    if (!idle) return
    closeReview()
    say(wallet ? READY : '')
    field.focus()
  })
  field.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return
    e.preventDefault()
    void onReview()
  })
  field.addEventListener('input', () => {
    if (idle && !review.hidden) closeReview() // the words changed: what the review showed is no longer what would be sent
  })
  send.removeAttribute('aria-disabled') // shipped as not ready, like the other buttons
}
