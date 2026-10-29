// A tiny element builder. Text always goes in as a text node, never as HTML, and no inline styles or event attributes can
// be set through it (the page's CSP forbids inline styles, and handlers are attached with addEventListener).
type Kid = Node | string | number | null | undefined | false

export function h(tag: string, attrs: Record<string, string> | null, ...kids: Kid[]): HTMLElement {
  const el = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (name === 'style' || name.startsWith('on')) throw new Error(`attribute "${name}" is not allowed`)
    el.setAttribute(name, value)
  }
  for (const kid of kids) if (kid != null && kid !== false) el.append(typeof kid === 'number' ? String(kid) : kid)
  return el
}

export const clear = (el: Element): void => el.replaceChildren()
