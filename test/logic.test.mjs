/**
 * Logic self-test for the generated browser artifact — no dsh process, no
 * network, and no dependency on the dsh checkout: the artifact runs inside the
 * plugin-local DOM harness (`./dom-harness.mjs`), which asserts
 * the reroute conditions exactly as the browser would deliver them.
 *
 * The contract under test (the shipped keymap owns the semantics; the plugin
 * only swaps which gesture carries them):
 *   - Enter       -> replayed as Shift+Enter -> official line break
 *   - Alt+Enter   -> replayed as bare Enter  -> official send (queue)
 *   - Shift+Enter -> untouched: the official line break (0.4.x sent instead)
 *   - Ctrl/Cmd+Enter, Shift+Alt+Enter, AltGr+Enter -> untouched, official
 *   - a held (auto-repeating) Alt+Enter replay keeps the `repeat` flag, so the
 *     shipped held-key guard still refuses the repeated send
 *   - `dsh.composerEnterSendKeys = 'shift' | 'both'` opts back into sending
 *     with Shift+Enter
 *   - menus, popups, non-plain phases, IME composition, foreign targets, the
 *     disable flag and the disposed state are all left to the official code
 *   - the plugin's own replays are stamped and never re-intercepted
 *
 * Run:  node test/logic.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createDom, loadArtifact } from './dom-harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const artifact = readFileSync(join(here, '..', 'lib', 'client.js'), 'utf8')

const REPLAY_FLAG = '__dshComposerEnterReplay'
const DISABLE_FLAG = 'dsh.composerEnter'
const SEND_KEYS_FLAG = 'dsh.composerEnterSendKeys'

function boot(options = {}) {
  const dom = createDom()
  const document = dom.document

  if (options.freezableEvents === true) {
    // Models a host that refuses the plugin's replay stamp: the class is the
    // harness's own, but instances created while `freezeNextEvent` is set are
    // non-extensible, so `Object.defineProperty` on them throws.
    const Base = dom.KeyboardEvent
    dom.freezeNextEvent = false
    dom.KeyboardEvent = class extends Base {
      constructor(...args) {
        super(...args)
        if (dom.freezeNextEvent === true) {
          dom.freezeNextEvent = false
          Object.freeze(this)
        }
      }
    }
  }

  const card = document.createElement('div')
  card.setAttribute('data-composer-card', '')
  const input = document.createElement('div')
  input.setAttribute('data-composer-input', '')
  input.setAttribute('contenteditable', 'true')
  input.setAttribute('data-phase', 'plain')
  card.appendChild(input)
  document.body.appendChild(card)

  const outside = document.createElement('div')
  outside.setAttribute('id', 'outside')
  document.body.appendChild(outside)

  const row = loadArtifact(artifact, dom)
  assert.equal(row.id, 'dsh-client-composer-enter', 'artifact must register under its package name')
  const mod = row.materialize(() => {
    throw new Error('artifact must not require any module')
  })
  assert.equal(typeof mod.apply, 'function', 'artifact must export apply')
  assert.ok(Array.isArray(mod.inject), 'artifact must export inject')

  // Every keydown that actually reaches the composer surface: originals when the
  // plugin leaves the gesture alone, otherwise only the plugin's replay.
  const reached = []
  input.addEventListener('keydown', (event) => { reached.push(event) })

  let disposer = () => {}
  mod.apply({ effect: (fn) => { disposer = fn() } })

  return {
    dom,
    document,
    input,
    outside,
    reached,
    /** The gestures that reached the surface, as their modifier signature. */
    signatures: () => reached.map((event) => (event.shiftKey ? 'shift' : 'bare')),
    dispose: () => disposer(),
  }
}

function press(dom, target, init = {}) {
  const event = new dom.KeyboardEvent('keydown', {
    key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ...init,
  })
  target.dispatchEvent(event)
  return event
}

const cases = []
function test(name, fn) { cases.push({ name, fn }) }

test('plain Enter is rerouted to a synthetic Shift+Enter (line break)', () => {
  const d = boot()
  const original = press(d.dom, d.input)
  assert.equal(original.defaultPrevented, true, 'original must be prevented')
  assert.deepEqual(d.signatures(), ['shift'], 'only the replay reaches the surface')
  assert.equal(d.reached[0].target, d.input)
  d.dispose()
})

test('Shift+Enter keeps the official line break (left alone)', () => {
  const d = boot()
  const original = press(d.dom, d.input, { shiftKey: true })
  assert.equal(original.defaultPrevented, false, 'the official gesture must reach the editor')
  assert.deepEqual(d.signatures(), ['shift'], 'no replay replaces it')
  assert.equal(d.reached[0], original, 'the original event is the one delivered')
  d.dispose()
})

test('Alt+Enter is rerouted to a synthetic bare Enter (send)', () => {
  const d = boot()
  const original = press(d.dom, d.input, { altKey: true })
  assert.equal(original.defaultPrevented, true, 'Alt+Enter is a send chord now')
  assert.deepEqual(d.signatures(), ['bare'])
  assert.equal(d.reached[0].altKey, false, 'the official keymap must see no Alt')
  d.dispose()
})

test('a held Alt+Enter forwards the auto-repeat flag to the send replay', () => {
  const d = boot()
  press(d.dom, d.input, { altKey: true, repeat: true })
  assert.equal(d.reached.length, 1, 'exactly one replay reaches the surface')
  assert.equal(d.reached[0].shiftKey, false, 'the send gesture stays bare Enter')
  assert.equal(d.reached[0].repeat, true, 'the shipped held-key guard must still see the repeat')
  d.dispose()
})

test('a first Alt+Enter replays without the repeat flag', () => {
  const d = boot()
  press(d.dom, d.input, { altKey: true })
  assert.equal(d.reached[0].repeat, false, 'a single press must still submit')
  d.dispose()
})

test('a held plain Enter forwards the repeat flag to the line-break replay', () => {
  const d = boot()
  press(d.dom, d.input, { repeat: true })
  assert.deepEqual(d.signatures(), ['shift'], 'the line-break replay still carries Shift')
  assert.equal(d.reached[0].repeat, true, 'the originating repeat flag is forwarded')
  d.dispose()
})

test("the plugin's own replays are stamped and never re-intercepted", () => {
  const d = boot()
  press(d.dom, d.input)
  assert.equal(d.reached[0][REPLAY_FLAG], true, 'the replay carries the re-entrancy stamp')
  // A stamped event delivered by hand must pass straight through.
  const stamped = new d.dom.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
  Object.defineProperty(stamped, REPLAY_FLAG, { value: true })
  d.input.dispatchEvent(stamped)
  assert.equal(stamped.defaultPrevented, false, 'a stamped event is left alone')
  assert.deepEqual(d.signatures(), ['shift', 'bare'])
  d.dispose()
})

test('Ctrl/Cmd+Enter stays official (the complementary Queue/Steer gesture)', () => {
  for (const init of [{ ctrlKey: true }, { metaKey: true }]) {
    const d = boot()
    const original = press(d.dom, d.input, init)
    assert.equal(original.defaultPrevented, false, `${JSON.stringify(init)} must stay official`)
    assert.deepEqual(d.signatures(), ['bare'], 'only the original is delivered')
    d.dispose()
  }
})

test('Shift+Alt+Enter stays official', () => {
  const d = boot()
  const original = press(d.dom, d.input, { shiftKey: true, altKey: true })
  assert.equal(original.defaultPrevented, false)
  assert.deepEqual(d.signatures(), ['shift'], 'only the original is delivered')
  d.dispose()
})

test('AltGr+Enter (AltGraph) stays with the keyboard layout', () => {
  const d = boot()
  const original = press(d.dom, d.input, { altKey: true, modifierState: { AltGraph: true } })
  assert.equal(original.defaultPrevented, false)
  assert.deepEqual(d.signatures(), ['bare'])
  d.dispose()
})

test("sendKeys 'shift' makes Alt+Enter inert while Shift+Enter still sends", () => {
  const d = boot()
  d.dom.localStorage.setItem(SEND_KEYS_FLAG, 'shift')
  const alt = press(d.dom, d.input, { altKey: true })
  assert.equal(alt.defaultPrevented, false, 'Alt+Enter falls back to the stock no-op')
  const shift = press(d.dom, d.input, { shiftKey: true })
  assert.equal(shift.defaultPrevented, true)
  assert.deepEqual(d.signatures(), ['bare', 'bare'])
  d.dispose()
})

test("sendKeys 'alt' (the default) leaves Shift+Enter official while Alt+Enter sends", () => {
  const d = boot()
  d.dom.localStorage.setItem(SEND_KEYS_FLAG, 'alt')
  const shift = press(d.dom, d.input, { shiftKey: true })
  assert.equal(shift.defaultPrevented, false, 'Shift+Enter falls back to the official line break')
  const alt = press(d.dom, d.input, { altKey: true })
  assert.equal(alt.defaultPrevented, true)
  assert.deepEqual(d.signatures(), ['shift', 'bare'])
  d.dispose()
})

test("sendKeys 'both' restores the 0.4.x mapping where Shift+Enter sends", () => {
  const d = boot()
  d.dom.localStorage.setItem(SEND_KEYS_FLAG, 'both')
  const shift = press(d.dom, d.input, { shiftKey: true })
  assert.equal(shift.defaultPrevented, true, 'the opt-in swap takes the line-break gesture over')
  assert.deepEqual(d.signatures(), ['bare'])
  const alt = press(d.dom, d.input, { altKey: true })
  assert.equal(alt.defaultPrevented, true)
  assert.deepEqual(d.signatures(), ['bare', 'bare'])
  d.dispose()
})

test('a host that refuses the replay stamp keeps the stock gesture', () => {
  const d = boot({ freezableEvents: true })
  const original = new d.dom.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
  d.dom.freezeNextEvent = true
  d.input.dispatchEvent(original)
  assert.equal(original.defaultPrevented, false, 'nothing is swallowed without a replacement')
  assert.deepEqual(d.signatures(), ['bare'], 'the official keymap receives the original Enter')
  d.dispose()
})

test('an open trigger menu keeps Enter for the official highlight pick', () => {
  const d = boot()
  const menu = d.document.createElement('div')
  menu.setAttribute('data-trigger-menu', '')
  d.document.body.appendChild(menu)
  const original = press(d.dom, d.input)
  assert.equal(original.defaultPrevented, false)
  assert.deepEqual(d.signatures(), ['bare'], 'only the original is delivered')
  d.dispose()
})

test('an open command popup keeps Enter for the official pick', () => {
  const d = boot()
  const popup = d.document.createElement('div')
  popup.setAttribute('role', 'listbox')
  d.document.querySelector('[data-composer-card]').appendChild(popup)
  const original = press(d.dom, d.input)
  assert.equal(original.defaultPrevented, false)
  assert.deepEqual(d.signatures(), ['bare'])
  d.dispose()
})

test('non-plain phases (claimed/adjudicating/submitting/inert) stay official', () => {
  for (const phase of ['claimed', 'adjudicating', 'submitting', 'inert']) {
    const d = boot()
    d.input.setAttribute('data-phase', phase)
    const original = press(d.dom, d.input)
    assert.equal(original.defaultPrevented, false, `phase ${phase} must stay official`)
    assert.deepEqual(d.signatures(), ['bare'], `phase ${phase} must not reroute`)
    d.dispose()
  }
})

test('IME composition Enter (isComposing or keyCode 229) stays with the input method', () => {
  for (const init of [{ isComposing: true }, { keyCode: 229 }]) {
    const d = boot()
    const original = press(d.dom, d.input, init)
    assert.equal(original.defaultPrevented, false, `${JSON.stringify(init)} must not be rerouted`)
    assert.deepEqual(d.signatures(), ['bare'])
    d.dispose()
  }
})

test('the documented localStorage escape hatch restores the stock keymap', () => {
  const d = boot()
  d.dom.localStorage.setItem(DISABLE_FLAG, 'off')
  const bare = press(d.dom, d.input)
  const shift = press(d.dom, d.input, { shiftKey: true })
  const alt = press(d.dom, d.input, { altKey: true })
  assert.equal(bare.defaultPrevented, false)
  assert.equal(shift.defaultPrevented, false)
  assert.equal(alt.defaultPrevented, false)
  assert.deepEqual(d.signatures(), ['bare', 'shift', 'bare'], 'nothing is replayed')
  d.dispose()
})

test('unavailable localStorage still reroutes (the guard degrades to active)', () => {
  const d = boot()
  d.dom.localStorage.throwOnUse = true
  const original = press(d.dom, d.input)
  assert.equal(original.defaultPrevented, true)
  assert.deepEqual(d.signatures(), ['shift'])
  d.dispose()
})

test('keys pressed outside the composer surface are ignored', () => {
  const d = boot()
  const original = press(d.dom, d.outside)
  assert.equal(original.defaultPrevented, false)
  assert.equal(d.reached.length, 0)
  d.dispose()
})

test('a non-editable composer (locked/inert DOM) is ignored', () => {
  const d = boot()
  d.input.setAttribute('contenteditable', 'false')
  const original = press(d.dom, d.input)
  assert.equal(original.defaultPrevented, false)
  assert.deepEqual(d.signatures(), ['bare'])
  d.dispose()
})

test('disposal removes the capture listener', () => {
  const d = boot()
  d.dispose()
  const original = press(d.dom, d.input)
  assert.equal(original.defaultPrevented, false)
  assert.deepEqual(d.signatures(), ['bare'])
})

let failed = 0
for (const { name, fn } of cases) {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL  ${name}\n      ${error.message}`)
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`)
process.exit(failed === 0 ? 0 : 1)
