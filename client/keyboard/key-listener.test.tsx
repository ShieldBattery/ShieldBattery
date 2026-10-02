import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { KeyListenerBoundary, useKeyListener } from './key-listener'

function EscapeListener({ onEscape }: { onEscape: () => void }) {
  useKeyListener({
    onKeyDown(event) {
      if (event.code === 'Escape') {
        onEscape()
        return true
      }
      return false
    },
  })
  return null
}

function pressEscape() {
  fireEvent.keyDown(document, { code: 'Escape', key: 'Escape' })
}

interface Layers {
  root: () => void
  first?: () => void
  firstNested?: () => void
  second?: () => void
  secondActive?: boolean
}

function LayeredApp({ root, first, firstNested, second, secondActive = true }: Layers) {
  return (
    <KeyListenerBoundary>
      <EscapeListener onEscape={root} />
      {first ? (
        <KeyListenerBoundary>
          <EscapeListener onEscape={first} />
          {firstNested ? (
            <KeyListenerBoundary>
              <EscapeListener onEscape={firstNested} />
            </KeyListenerBoundary>
          ) : null}
        </KeyListenerBoundary>
      ) : null}
      {second ? (
        <KeyListenerBoundary active={secondActive}>
          <EscapeListener onEscape={second} />
        </KeyListenerBoundary>
      ) : null}
    </KeyListenerBoundary>
  )
}

describe('KeyListenerBoundary', () => {
  test('handlers outside an active boundary do not receive keys', () => {
    const root = vi.fn()
    const first = vi.fn()
    const { rerender } = render(<LayeredApp root={root} first={first} />)

    pressEscape()
    expect(first).toHaveBeenCalledTimes(1)
    expect(root).not.toHaveBeenCalled()

    rerender(<LayeredApp root={root} />)
    pressEscape()
    expect(root).toHaveBeenCalledTimes(1)
  })

  test('the most recently activated sibling boundary receives keys', () => {
    const root = vi.fn()
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<LayeredApp root={root} first={first} />)

    rerender(<LayeredApp root={root} first={first} second={second} />)
    pressEscape()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()

    rerender(<LayeredApp root={root} first={first} />)
    pressEscape()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(root).not.toHaveBeenCalled()
  })

  test('removing an earlier sibling keeps keys with the later one', () => {
    const root = vi.fn()
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<LayeredApp root={root} first={first} />)
    rerender(<LayeredApp root={root} first={first} second={second} />)

    rerender(<LayeredApp root={root} second={second} />)
    pressEscape()
    expect(second).toHaveBeenCalledTimes(1)

    rerender(<LayeredApp root={root} />)
    pressEscape()
    expect(root).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  test('boundaries nested in a covered sibling do not receive keys', () => {
    const root = vi.fn()
    const first = vi.fn()
    const firstNested = vi.fn()
    const second = vi.fn()
    const { rerender } = render(<LayeredApp root={root} first={first} firstNested={firstNested} />)

    pressEscape()
    expect(firstNested).toHaveBeenCalledTimes(1)

    rerender(<LayeredApp root={root} first={first} firstNested={firstNested} second={second} />)
    pressEscape()
    expect(second).toHaveBeenCalledTimes(1)
    expect(firstNested).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  test('an inactive boundary leaves keys with its parent, and takes them once activated', () => {
    const root = vi.fn()
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = render(
      <LayeredApp root={root} first={first} second={second} secondActive={false} />,
    )

    // The inactive boundary's handlers register with the root boundary, which is covered by `first`
    pressEscape()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()

    rerender(<LayeredApp root={root} first={first} second={second} secondActive={true} />)
    pressEscape()
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(1)
  })

  test('handled events are marked as default prevented', () => {
    const root = vi.fn()
    render(<LayeredApp root={root} />)

    const event = new KeyboardEvent('keydown', { code: 'Escape', cancelable: true })
    act(() => {
      document.dispatchEvent(event)
    })
    expect(root).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })
})
