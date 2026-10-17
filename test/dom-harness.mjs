/**
 * Minimal DOM harness for the local plugins' logic tests.
 *
 * Why this exists: the first version of these tests borrowed `jsdom` from the
 * dsh checkout, which silently broke the moment the repository was re-cloned
 * without `node_modules`. Local plugins must be testable offline, with no
 * dependency on the repository, the network, or an installed dsh.
 *
 * Scope: exactly what the plugins need and no more —
 *   - element tree with attributes, `dataset`, `closest`, `querySelector(All)`
 *     for the simple selector subset the plugins rely on (`tag`, `#id`,
 *     `.class`, `[attr]`, `[attr="value"]`, descendant combinators);
 *   - event dispatch with window capture → target → bubble, honoring
 *     `preventDefault`, `stopPropagation` and `stopImmediatePropagation`;
 *   - `KeyboardEvent` with the fields the composer keymap reads;
 *   - in-memory `localStorage` with an opt-in failure mode.
 *
 * It is a test double, not a browser: it does not implement layout, CSS
 * matching for the plugin stylesheets, React, or HTML parsing (build trees
 * programmatically instead).
 */

/** camelCase -> kebab-case, for the `dataset` <-> attribute bridge. */
function kebab(key) {
  return String(key).replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)
}

/**
 * Parse the supported simple-selector subset into predicates.
 * @param simple - one compound selector, e.g. `div[data-x="1"].cls#id`.
 * @returns predicate taking an element.
 */
function parseSimple(simple) {
  const tests = []
  const pattern = /\[([A-Za-z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]|#([A-Za-z0-9_-]+)|\.([A-Za-z0-9_-]+)|^([A-Za-z][A-Za-z0-9-]*)/g
  let match
  let matchedAny = false
  while ((match = pattern.exec(simple)) !== null) {
    matchedAny = true
    if (match[1] !== undefined) {
      const name = match[1]
      const value = match[2] ?? match[3] ?? match[4]
      if (value === undefined) tests.push((el) => el.hasAttribute(name))
      else tests.push((el) => el.getAttribute(name) === value)
    } else if (match[5] !== undefined) {
      const id = match[5]
      tests.push((el) => el.getAttribute('id') === id)
    } else if (match[6] !== undefined) {
      const cls = match[6]
      tests.push((el) => el.classList.contains(cls))
    } else if (match[7] !== undefined) {
      const tag = match[7].toLowerCase()
      tests.push((el) => el.tagName === tag.toUpperCase())
    }
  }
  if (!matchedAny) throw new Error(`dom-harness: unsupported selector "${simple}"`)
  return (el) => tests.every((test) => test(el))
}

/** Whether `ancestor` is a strict ancestor of `el`. */
function isAncestor(ancestor, el) {
  let cursor = el.parentNode
  while (cursor !== null) {
    if (cursor === ancestor) return true
    cursor = cursor.parentNode
  }
  return false
}

/** Does `el` match the whitespace-separated descendant selector? */
function matchesSelector(el, selector) {
  const parts = selector.trim().split(/\s+/)
  const last = parseSimple(parts[parts.length - 1])
  if (!last(el)) return false
  let cursor = el.parentNode
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const test = parseSimple(parts[i])
    let found = false
    while (cursor !== null && cursor.nodeType === 1) {
      if (test(cursor)) {
        found = true
        cursor = cursor.parentNode
        break
      }
      cursor = cursor.parentNode
    }
    if (!found) return false
  }
  return true
}

/** Depth-first walk of an element subtree. */
function walk(root, visit) {
  for (const child of root.childNodes) {
    if (child.nodeType !== 1) continue
    visit(child)
    walk(child, visit)
  }
}

/** Base class every fabricated element inherits from (`instanceof Element`). */
export class Element {}

/** One fabricated element. */
class FakeElement extends Element {
  constructor(ownerDocument, tagName) {
    super()
    this.ownerDocument = ownerDocument
    this.nodeType = 1
    this.tagName = String(tagName).toUpperCase()
    this.childNodes = []
    this.parentNode = null
    this._attributes = new Map()
    this._listeners = new Map()
    this.textContent = ''
  }

  get children() {
    return this.childNodes.filter((child) => child.nodeType === 1)
  }

  get dataset() {
    const el = this
    return new Proxy({}, {
      get: (_target, key) => (typeof key === 'string' ? el.getAttribute(`data-${kebab(key)}`) : undefined),
      set: (_target, key, value) => {
        el.setAttribute(`data-${kebab(key)}`, String(value))
        return true
      },
      has: (_target, key) => (typeof key === 'string' ? el.hasAttribute(`data-${kebab(key)}`) : false),
      deleteProperty: (_target, key) => {
        el.removeAttribute(`data-${kebab(key)}`)
        return true
      },
    })
  }

  get classList() {
    const el = this
    const read = () => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
    return {
      contains: (cls) => read().includes(cls),
      add: (cls) => { if (!read().includes(cls)) el.setAttribute('class', [...read(), cls].join(' ')) },
      remove: (cls) => el.setAttribute('class', read().filter((item) => item !== cls).join(' ')),
    }
  }

  setAttribute(name, value) {
    this._attributes.set(name, String(value))
  }

  getAttribute(name) {
    return this._attributes.has(name) ? this._attributes.get(name) : null
  }

  hasAttribute(name) {
    return this._attributes.has(name)
  }

  removeAttribute(name) {
    this._attributes.delete(name)
  }

  appendChild(child) {
    if (child.parentNode !== null) child.parentNode.removeChild(child)
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }

  removeChild(child) {
    const index = this.childNodes.indexOf(child)
    if (index >= 0) this.childNodes.splice(index, 1)
    child.parentNode = null
    return child
  }

  closest(selector) {
    let cursor = this
    while (cursor !== null && cursor.nodeType === 1) {
      if (matchesSelector(cursor, selector)) return cursor
      cursor = cursor.parentNode
    }
    return null
  }

  matches(selector) {
    return matchesSelector(this, selector)
  }

  querySelectorAll(selector) {
    const found = []
    walk(this, (el) => { if (matchesSelector(el, selector)) found.push(el) })
    return found
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }

  addEventListener(type, listener, options) {
    const capture = options === true || (typeof options === 'object' && options !== null && options.capture === true)
    const bucket = this._listeners.get(type) ?? []
    bucket.push({ listener, capture })
    this._listeners.set(type, bucket)
  }

  removeEventListener(type, listener, options) {
    const capture = options === true || (typeof options === 'object' && options !== null && options.capture === true)
    const bucket = this._listeners.get(type) ?? []
    this._listeners.set(type, bucket.filter((entry) => entry.listener !== listener || entry.capture !== capture))
  }

  dispatchEvent(event) {
    return this.ownerDocument._dispatch(this, event)
  }
}

/** Fabricated `KeyboardEvent` carrying the fields the composer keymap reads. */
export class KeyboardEvent {
  constructor(type, init = {}) {
    this.type = type
    this.key = init.key ?? ''
    this.code = init.code ?? ''
    this.shiftKey = init.shiftKey === true
    this.ctrlKey = init.ctrlKey === true
    this.metaKey = init.metaKey === true
    this.altKey = init.altKey === true
    this.isComposing = init.isComposing === true
    this.keyCode = init.keyCode ?? 0
    this.bubbles = init.bubbles !== false
    this.cancelable = init.cancelable !== false
    this.composed = init.composed === true
    this.repeat = init.repeat === true
    this.defaultPrevented = false
    this.target = null
    this._propagationStopped = false
    this._immediateStopped = false
    this._modifierState = init.modifierState ?? {}
  }

  /** Mirror the browser API plugins probe for AltGraph (AltGr) keyboards. */
  getModifierState(name) {
    return this._modifierState[name] === true
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true
  }

  stopPropagation() {
    this._propagationStopped = true
  }

  stopImmediatePropagation() {
    this._propagationStopped = true
    this._immediateStopped = true
  }
}

/** In-memory storage; set `throwOnUse` to exercise the plugins' guards. */
class FakeStorage {
  constructor() {
    this._map = new Map()
    this.throwOnUse = false
  }

  _guard() {
    if (this.throwOnUse) throw new Error('storage unavailable')
  }

  getItem(key) {
    this._guard()
    return this._map.has(key) ? this._map.get(key) : null
  }

  setItem(key, value) {
    this._guard()
    this._map.set(String(key), String(value))
  }

  removeItem(key) {
    this._guard()
    this._map.delete(key)
  }

  clear() {
    this._guard()
    this._map.clear()
  }
}

/**
 * Build a fresh, empty document/window pair.
 * @returns the harness globals and a `reset()` that detaches every listener.
 */
export function createDom() {
  const FakeDocument = class extends FakeElement {
    constructor() {
      super(null, '#document')
      this.nodeType = 9
      this.ownerDocument = this
      this.documentElement = new FakeElement(this, 'html')
      this.head = new FakeElement(this, 'head')
      this.body = new FakeElement(this, 'body')
      this.documentElement.appendChild(this.head)
      this.documentElement.appendChild(this.body)
      this.appendChild(this.documentElement)
    }

    createElement(tagName) {
      return new FakeElement(this, tagName)
    }

    getElementById(id) {
      return this.querySelector(`#${id}`)
    }

    _dispatch(target, event) {
      const path = []
      let cursor = target
      while (cursor !== null) {
        path.push(cursor)
        cursor = cursor.parentNode
      }
      // window is the outermost target of the capture/target/bubble path.
      path.push(window)
      path.reverse()
      event.target = target
      const invoke = (node, capture) => {
        const bucket = node._listeners?.get(event.type) ?? []
        for (const entry of bucket) {
          if (entry.capture !== capture) continue
          if (event._immediateStopped) return
          entry.listener.call(node, event)
        }
      }
      for (const node of path) {
        if (event._propagationStopped) break
        invoke(node, true)
        if (event._propagationStopped) break
      }
      if (!event._propagationStopped) {
        for (let index = path.length - 1; index >= 0; index -= 1) {
          if (event._propagationStopped) break
          invoke(path[index], false)
        }
      }
      return !event.defaultPrevented
    }
  }

  const document = new FakeDocument()
  const localStorage = new FakeStorage()

  const window = {
    document,
    localStorage,
    listeners: new Map(),
    addEventListener(type, listener, options) {
      const capture = options === true || (typeof options === 'object' && options !== null && options.capture === true)
      const bucket = window.listeners.get(type) ?? []
      bucket.push({ listener, capture })
      window.listeners.set(type, bucket)
    },
    removeEventListener(type, listener, options) {
      const capture = options === true || (typeof options === 'object' && options !== null && options.capture === true)
      const bucket = window.listeners.get(type) ?? []
      window.listeners.set(type, bucket.filter((entry) => entry.listener !== listener || entry.capture !== capture))
    },
    _listeners: {
      get: (type) => window.listeners.get(type) ?? [],
    },
  }
  window.window = window

  return {
    window,
    document,
    localStorage,
    Element,
    KeyboardEvent,
    /** Create a detached element owned by this document. */
    create: (tagName) => document.createElement(tagName),
  }
}

/**
 * Evaluate a generated browser artifact against the harness globals and hand
 * back the row it registered through `window.__ModuleLoader__.load`.
 * @param artifactText - the artifact source (`lib/client.js`).
 * @param dom - a `createDom()` result.
 * @returns the registered row plus a `materialize(requireStub)` helper.
 */
export function loadArtifact(artifactText, dom) {
  let row = null
  const window = dom.window
  window.__ModuleLoader__ = { load: (loaded) => { row = loaded } }
  const factory = new Function('window', 'document', 'KeyboardEvent', 'Element', 'console', artifactText)
  factory(window, dom.document, dom.KeyboardEvent, dom.Element, { info() {}, warn() {}, error() {} })
  if (row === null) throw new Error('artifact did not register through window.__ModuleLoader__.load')
  return {
    id: row.id,
    /** Materialize the lazy factory with a `require` stub. */
    materialize(requireStub = () => { throw new Error('artifact must not require modules') }) {
      return row.factory(requireStub)
    },
  }
}
