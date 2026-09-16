import { fireEvent, render } from '@testing-library/react'
import { domMax, LazyMotion } from 'motion/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GameType } from '../../../common/games/game-type'
import { Team } from '../../../common/lobbies'
import { Slot, SlotType } from '../../../common/lobbies/slot'
import { DraggableSlot, SlotDragProvider } from './slot-drag-drop'

const SOURCE: Slot = {
  type: SlotType.Human,
  race: 'r',
  id: 'source',
  joinedAt: 0,
  hasForcedRace: false,
  playerId: 0,
  typeId: 0,
}

function destination(type: SlotType = SlotType.Open, id = 'destination'): Slot {
  return {
    type,
    race: 'r',
    id,
    joinedAt: 0,
    hasForcedRace: false,
    playerId: 0,
    typeId: 0,
  }
}

function teamsWith(destinationSlot: Slot = destination()): ReadonlyArray<Team> {
  return [
    {
      name: 'Players',
      teamId: 0,
      isObserver: false,
      slots: [SOURCE, destinationSlot],
      hiddenSlots: [],
    },
  ]
}

function DragTestHarness({
  teams = teamsWith(),
  enabled = true,
  onMoveSlot,
  onControlClick = vi.fn(),
}: {
  teams?: ReadonlyArray<Team>
  enabled?: boolean
  onMoveSlot: (fromSlotId: string, toSlotId: string) => void
  onControlClick?: () => void
}) {
  return (
    <LazyMotion features={domMax}>
      <SlotDragProvider
        teams={teams}
        gameType={GameType.Melee}
        enabled={enabled}
        onMoveSlot={onMoveSlot}>
        <DraggableSlot slot={teams[0].slots[0]}>
          <div>
            <span data-slot-drag-handle data-testid='source-handle'>
              Source player
            </span>
            <button type='button' data-slot-controls onClick={onControlClick}>
              Source control
            </button>
          </div>
        </DraggableSlot>
        <DraggableSlot slot={teams[0].slots[1]}>
          <div>Destination</div>
        </DraggableSlot>
      </SlotDragProvider>
    </LazyMotion>
  )
}

function getSlot(container: HTMLElement, id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-drag-slot="${id}"]`)
  if (!element) throw new Error(`Slot ${id} was not rendered`)
  return element
}

function selectDestination(source: HTMLElement) {
  fireEvent.keyDown(source, { key: ' ' })
  fireEvent.keyDown(source, { key: 'ArrowDown' })
}

const pointerCaptureDescriptors = {
  setPointerCapture: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture'),
  hasPointerCapture: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hasPointerCapture'),
  releasePointerCapture: Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'releasePointerCapture',
  ),
}

beforeEach(() => {
  Object.defineProperties(HTMLElement.prototype, {
    setPointerCapture: { configurable: true, value: () => {} },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: () => {} },
  })
})

afterEach(() => {
  for (const [name, descriptor] of Object.entries(pointerCaptureDescriptors)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor)
    else Reflect.deleteProperty(HTMLElement.prototype, name)
  }
})

describe('client/lobbies/room/slot-drag-drop', () => {
  test('moves to a selected open slot once from the keyboard', () => {
    const onMoveSlot = vi.fn()
    const { container } = render(<DragTestHarness onMoveSlot={onMoveSlot} />)
    const source = getSlot(container, SOURCE.id)

    selectDestination(source)
    fireEvent.keyDown(source, { key: ' ' })
    fireEvent.keyDown(source, { key: ' ', repeat: true })

    expect(onMoveSlot).toHaveBeenCalledExactlyOnceWith(SOURCE.id, 'destination')
  })

  test('swaps with an occupied slot once from the keyboard', () => {
    const onMoveSlot = vi.fn()
    const { container } = render(
      <DragTestHarness onMoveSlot={onMoveSlot} teams={teamsWith(destination(SlotType.Human))} />,
    )
    const source = getSlot(container, SOURCE.id)

    selectDestination(source)
    fireEvent.keyDown(source, { key: 'Enter' })
    fireEvent.keyDown(source, { key: 'Enter', repeat: true })

    expect(onMoveSlot).toHaveBeenCalledExactlyOnceWith(SOURCE.id, 'destination')
  })

  test('cancels a keyboard drag with Escape', () => {
    const onMoveSlot = vi.fn()
    const { container } = render(<DragTestHarness onMoveSlot={onMoveSlot} />)
    const source = getSlot(container, SOURCE.id)
    const target = getSlot(container, 'destination')

    selectDestination(source)
    expect(target.dataset.dropTarget).toBe('true')

    fireEvent.keyDown(source, { key: 'Escape' })
    fireEvent.keyDown(source, { key: ' ' })

    expect(target.dataset.dropTarget).toBeUndefined()
    expect(onMoveSlot).not.toHaveBeenCalled()
  })

  test('does not start or dispatch while dragging is disabled', () => {
    const onMoveSlot = vi.fn()
    const { container } = render(<DragTestHarness enabled={false} onMoveSlot={onMoveSlot} />)
    const source = getSlot(container, SOURCE.id)

    fireEvent.keyDown(source, { key: ' ' })
    fireEvent.keyDown(source, { key: 'ArrowDown' })
    fireEvent.keyDown(source, { key: ' ' })

    expect(source.tabIndex).toBe(-1)
    expect(onMoveSlot).not.toHaveBeenCalled()
  })

  test('does not resurrect a keyboard drag after permission or topology returns', () => {
    const onMoveSlot = vi.fn()
    const initialTeams = teamsWith()
    const { container, rerender } = render(
      <DragTestHarness teams={initialTeams} onMoveSlot={onMoveSlot} />,
    )
    const source = getSlot(container, SOURCE.id)
    const target = getSlot(container, 'destination')

    selectDestination(source)
    rerender(<DragTestHarness enabled={false} teams={initialTeams} onMoveSlot={onMoveSlot} />)
    rerender(<DragTestHarness teams={initialTeams} onMoveSlot={onMoveSlot} />)
    expect(target.dataset.dropTarget).toBeUndefined()

    selectDestination(source)
    const changedTeams = teamsWith(destination(SlotType.Open, 'replacement'))
    rerender(<DragTestHarness teams={changedTeams} onMoveSlot={onMoveSlot} />)
    rerender(<DragTestHarness teams={initialTeams} onMoveSlot={onMoveSlot} />)

    expect(getSlot(container, 'destination').dataset.dropTarget).toBeUndefined()
    expect(onMoveSlot).not.toHaveBeenCalled()
  })

  test('leaves nested controls clickable after they reject initiation and a drag is canceled', () => {
    const onMoveSlot = vi.fn()
    const onControlClick = vi.fn()
    const { container, getByRole, getByTestId } = render(
      <DragTestHarness onMoveSlot={onMoveSlot} onControlClick={onControlClick} />,
    )
    const control = getByRole('button', { name: 'Source control' })
    const handle = getByTestId('source-handle')

    fireEvent.pointerDown(control, { button: 0, isPrimary: true, pointerId: 1 })
    fireEvent.pointerMove(control, { clientX: 10, clientY: 0, pointerId: 1 })
    fireEvent.pointerUp(control, { clientX: 10, clientY: 0, pointerId: 1 })
    fireEvent.click(control)

    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 0,
      clientY: 0,
      isPrimary: true,
      pointerId: 2,
    })
    fireEvent.pointerMove(handle, { clientX: 10, clientY: 0, pointerId: 2 })
    fireEvent.pointerCancel(handle, { pointerId: 2 })
    fireEvent.pointerDown(control, { button: 0, isPrimary: true, pointerId: 3 })
    fireEvent.pointerUp(control, { pointerId: 3 })
    fireEvent.click(control)

    expect(onControlClick).toHaveBeenCalledTimes(2)
    expect(onMoveSlot).not.toHaveBeenCalled()
    expect(getSlot(container, SOURCE.id).dataset.dropTarget).toBeUndefined()
  })
})
