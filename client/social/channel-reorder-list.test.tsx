import { fireEvent, render } from '@testing-library/react'
import { domMax, LazyMotion } from 'motion/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbChannelId, SbChannelId } from '../../common/chat'
import { ChannelReorderList, moveChannelTo } from './channel-reorder-list'

const IDS = [1, 2, 3, 4].map(makeSbChannelId)
const LIST_TOP = 100
const ROW_HEIGHT = 50

function Harness({
  onReorder,
  onChannelClick = () => {},
}: {
  onReorder: (channelIds: SbChannelId[]) => void
  onChannelClick?: (channelId: SbChannelId) => void
}) {
  return (
    <LazyMotion features={domMax}>
      <ChannelReorderList
        channelIds={IDS}
        onReorder={onReorder}
        renderChannel={id => (
          <a href='#' data-testid={`channel-${id}`} onClick={() => onChannelClick(id)}>
            Channel {id}
          </a>
        )}
      />
    </LazyMotion>
  )
}

/** Lays rows out top to bottom in DOM order, the way the sidebar does. */
function rectFor(element: Element): DOMRect {
  const row = element.closest('[data-reorder-channel]')
  if (row) {
    const index = Array.from(row.parentElement!.children).indexOf(row)
    return new DOMRect(0, LIST_TOP + index * ROW_HEIGHT, 200, ROW_HEIGHT)
  }
  if (element.querySelector('[data-reorder-channel]')) {
    return new DOMRect(0, LIST_TOP, 200, ROW_HEIGHT * IDS.length)
  }
  return new DOMRect(0, 0, 0, 0)
}

const originalDescriptors = {
  getBoundingClientRect: Object.getOwnPropertyDescriptor(
    Element.prototype,
    'getBoundingClientRect',
  ),
  setPointerCapture: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture'),
  hasPointerCapture: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hasPointerCapture'),
  releasePointerCapture: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'releasePointerCapture',
  ),
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: Element) {
      return rectFor(this)
    },
  })
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: () => {} },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: () => {} },
  })
})

afterEach(() => {
  for (const [name, descriptor] of Object.entries(originalDescriptors)) {
    const target = name === 'getBoundingClientRect' ? Element.prototype : HTMLElement.prototype
    if (descriptor) Object.defineProperty(target, name, descriptor)
    else Reflect.deleteProperty(target, name)
  }
})

function channel(container: HTMLElement, id: number): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-testid="channel-${id}"]`)!
}

/** Presses on the middle of channel `id`'s row and moves the pointer to `toY`. */
function dragTo(container: HTMLElement, id: number, toY: number) {
  const element = channel(container, id)
  const startY = rectFor(element).top + ROW_HEIGHT / 2
  fireEvent.pointerDown(element, {
    button: 0,
    buttons: 1,
    isPrimary: true,
    pointerId: 1,
    clientX: 50,
    clientY: startY,
  })
  fireEvent.pointerMove(element, { buttons: 1, pointerId: 1, clientX: 50, clientY: startY + 10 })
  fireEvent.pointerMove(element, { buttons: 1, pointerId: 1, clientX: 50, clientY: toY })
  return element
}

describe('client/social/channel-reorder-list', () => {
  test('moveChannelTo moves a channel to the given index', () => {
    expect(moveChannelTo(IDS, IDS[0], 2)).toEqual([IDS[1], IDS[2], IDS[0], IDS[3]])
    expect(moveChannelTo(IDS, IDS[3], 0)).toEqual([IDS[3], IDS[0], IDS[1], IDS[2]])
    expect(moveChannelTo(IDS, IDS[1], 99)).toEqual([IDS[0], IDS[2], IDS[3], IDS[1]])
  })

  test('dropping above the list puts the channel first', () => {
    const onReorder = vi.fn()
    const { container } = render(<Harness onReorder={onReorder} />)

    const element = dragTo(container, 3, 0)
    fireEvent.pointerUp(element, { pointerId: 1, clientX: 50, clientY: 0 })

    expect(onReorder).toHaveBeenCalledExactlyOnceWith([IDS[2], IDS[0], IDS[1], IDS[3]])
  })

  test('dropping below the list puts the channel last', () => {
    const onReorder = vi.fn()
    const { container } = render(<Harness onReorder={onReorder} />)

    const element = dragTo(container, 1, 2000)
    fireEvent.pointerUp(element, { pointerId: 1, clientX: 900, clientY: 2000 })

    expect(onReorder).toHaveBeenCalledExactlyOnceWith([IDS[1], IDS[2], IDS[3], IDS[0]])
  })

  test('dropping a channel back where it was does not reorder', () => {
    const onReorder = vi.fn()
    const { container } = render(<Harness onReorder={onReorder} />)

    const element = dragTo(container, 2, LIST_TOP + ROW_HEIGHT * 1.5)
    fireEvent.pointerUp(element, { pointerId: 1, clientY: LIST_TOP + ROW_HEIGHT * 1.5 })

    expect(onReorder).not.toHaveBeenCalled()
  })

  test('Escape cancels a drag', () => {
    const onReorder = vi.fn()
    const { container } = render(<Harness onReorder={onReorder} />)

    const element = dragTo(container, 3, 0)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.pointerUp(element, { pointerId: 1, clientY: 0 })

    expect(onReorder).not.toHaveBeenCalled()
  })

  test('a plain click opens the channel', () => {
    const onReorder = vi.fn()
    const onChannelClick = vi.fn()
    const { container } = render(<Harness onReorder={onReorder} onChannelClick={onChannelClick} />)
    const element = channel(container, 2)

    fireEvent.pointerDown(element, { button: 0, buttons: 1, isPrimary: true, pointerId: 1 })
    fireEvent.pointerUp(element, { pointerId: 1 })
    fireEvent.click(element)

    expect(onChannelClick).toHaveBeenCalledExactlyOnceWith(IDS[1])
    expect(onReorder).not.toHaveBeenCalled()
  })

  test('the click that ends a drag does not open the channel', () => {
    const onReorder = vi.fn()
    const onChannelClick = vi.fn()
    const { container } = render(<Harness onReorder={onReorder} onChannelClick={onChannelClick} />)

    const element = dragTo(container, 3, 0)
    fireEvent.pointerUp(element, { pointerId: 1, clientY: 0 })
    fireEvent.click(element)

    expect(onReorder).toHaveBeenCalledOnce()
    expect(onChannelClick).not.toHaveBeenCalled()
  })
})
