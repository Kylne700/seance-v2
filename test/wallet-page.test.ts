// "Send the Seance a secret": the parts of the page that need no browser to check. A missing id would stop the whole page's code at load, so every id
// src/walletui.ts looks up is checked against index.html, and the words and numbers on the page are checked against src/wallet.ts.
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AMOUNT, AMOUNT_TEXT, MEMO_MAX } from '../src/wallet.ts'

const root = new URL('../', import.meta.url)
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8')
const html = read('index.html')
const ui = read('src/walletui.ts')
const sources = readdirSync(new URL('src/', root))
  .filter((f) => f.endsWith('.ts'))
  .map((f) => [`src/${f}`, read(`src/${f}`)] as const)
const section = html.slice(html.indexOf('<section class="wallet online"'), html.indexOf('</section>', html.indexOf('<section class="wallet online"')))
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1])

describe('index.html: the section', () => {
  it('every id the code looks up is in the page once, and no id is used twice', () => {
    const wanted = [...ui.matchAll(/\$(?:<[^>]+>)?\('([a-z-]+)'\)/g)].map((m) => m[1])
    expect(wanted.length).toBeGreaterThanOrEqual(10)
    for (const id of wanted) expect(ids.filter((x) => x === id), id).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('sits in the picker, between the two columns and the mode bar, and is hidden in the offline copy', () => {
    const picker = html.indexOf('id="picker"')
    const cols = html.indexOf('class="picker-cols"')
    const wallet = html.indexOf('<section class="wallet online"')
    const modebar = html.indexOf('class="modebar"')
    expect(picker).toBeGreaterThan(0)
    expect(cols).toBeGreaterThan(picker)
    expect(wallet).toBeGreaterThan(cols)
    expect(modebar).toBeGreaterThan(wallet)
  })

  it('has a field of 40 characters with the shortcut comment, and no form, inline style or handler', () => {
    expect(section).toMatch(/<input id="wallet-memo" type="text" maxlength="40"/)
    expect(MEMO_MAX).toBe(40)
    expect(section).toContain('<!-- shortcut: 40 chars proven on Sapient 0.6.14, longer not tested -->')
    expect(section).not.toMatch(/<form|\sstyle=|\son[a-z]+=|\ssrc=|\saction=/)
  })

  it('names the amount as the wallet is asked for it, and says the fee is extra, public in amount and paid from private funds', () => {
    expect(html).toContain(AMOUNT_TEXT)
    expect(AMOUNT_TEXT).toBe('0.031415 tTARI (testnet TARI)')
    expect(Number(AMOUNT) / 1e6).toBe(0.031415) // 6 decimals
    expect(section).toContain('The fee is extra. Its amount is public, and your wallet pays it from private funds (its Private fee setting). You need the payment plus the fee: in our own test send the fee was 0.015275 tTARI.')
  })

  it('warns, always on view, that Bob\'s key is published and anyone can read what is sent', () => {
    expect(section).toContain('<p class="hint warn-text" id="wallet-warn">Bob\'s view key is published on this page, so anyone can read what you send, now and later: send a ghost story, not a password.</p>')
  })

  it('says the approval screen does not show the words', () => {
    expect(section).toContain("Your wallet's approval screen shows the amount and the recipient, not your words")
  })

  it('starts with the button not ready and the review and the "Look again" row hidden', () => {
    expect(section).toMatch(/id="wallet-send" aria-disabled="true"/)
    expect(section).toMatch(/id="wallet-review" hidden/)
    expect(section).toMatch(/id="wallet-more" hidden/)
  })
})

describe('index.html: what this page asked of the network', () => {
  const net = html.slice(html.indexOf('id="wallet-net"'), html.indexOf('</p>', html.indexOf('id="wallet-net"')))

  it('says the wallet talks to its own host and looks up its own payment by id, and the page does not', () => {
    expect(net).toContain('The wallet talks to its own host, ootle-indexer-a.tari.com, and looks up its own payment there by id.')
    expect(net).toContain("Those are the wallet's requests, not this page's")
    expect(net).toContain('asks no indexer for it by id')
  })

  it('says the list is downloaded up to 9 times, 20 s apart, like Summon', () => {
    expect(net).toContain('the same list of latest transactions as Summon, up to 9 times, 20 s apart')
  })

  it('writes the wallet host as plain text: it is no address the page can reach, so no link and no address form', () => {
    expect(net).not.toMatch(/https?:|\/\/|href=/)
  })
})

describe('the code', () => {
  it('never calls the methods that would look the payment up by id or hand over a view key, and never asks for the address', () => {
    for (const [file, text] of sources) {
      expect(text, file).not.toMatch(/['"`]tari_(getTransactionResult|requestViewAccess|getWalletAddress)['"`]/)
    }
  })

  it('does not log anything the wallet says, and adds no host', () => {
    for (const file of ['src/wallet.ts', 'src/walletui.ts']) {
      const text = read(file)
      expect(text, file).not.toMatch(/console\./)
      expect(text, file).not.toMatch(/https?:\/\//)
    }
  })

  it('puts the visitor\'s words on the page as text only', () => {
    expect(ui).toMatch(/echo\.textContent = /)
    expect(ui).not.toMatch(/innerHTML|insertAdjacentHTML/)
  })
})

describe('the README: how the Sapient wallet is used', () => {
  const readme = read('README.md')
  const from = readme.indexOf('### How the Sapient wallet is used')
  const part = readme.slice(from, readme.indexOf('\n## ', from))
  const split = part.indexOf('does not call')
  const listed = (text: string): string[] => [...text.matchAll(/^- `(tari_\w+)`/gm)].map((m) => m[1]).sort()
  const called = [...new Set([...read('src/wallet.ts').matchAll(/call\('(tari_\w+)'/g)].map((m) => m[1]))].sort()

  it('lists every wallet method the code calls, and no other', () => {
    expect(from).toBeGreaterThan(0)
    expect(split).toBeGreaterThan(0)
    expect(called).toHaveLength(6)
    expect(listed(part.slice(0, split))).toEqual(called)
  })

  it('lists the two methods it leaves alone, which the code does not call', () => {
    expect(listed(part.slice(split))).toEqual(['tari_getTransactionResult', 'tari_requestViewAccess'])
    for (const name of listed(part.slice(split))) expect(called).not.toContain(name)
  })
})
