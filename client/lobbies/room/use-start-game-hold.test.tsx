import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { START_GAME_HOLD_MS, useStartGameHold } from './use-start-game-hold'

function TestButton({
  allReady = false,
  disabled = false,
  onStartGame,
  onForceStart,
}: {
  allReady?: boolean
  disabled?: boolean
  onStartGame: () => void
  onForceStart: () => void
}) {
  const { isHolding, showHoldHint, buttonProps } = useStartGameHold({
    allReady,
    disabled,
    onStartGame,
    onForceStart,
  })

  return (
    <button
      type='button'
      disabled={disabled}
      data-holding={isHolding}
      data-hint={showHoldHint}
      {...buttonProps}>
      Start game
    </button>
  )
}

function advance(millis: number) {
  act(() => {
    vi.advanceTimersByTime(millis)
  })
}

function pointerDown(button: HTMLButtonElement, pointerId = 1) {
  fireEvent.pointerDown(button, { button: 0, isPrimary: true, pointerId })
}

function pointerUp(button: HTMLButtonElement, pointerId = 1) {
  fireEvent.pointerUp(button, { button: 0, isPrimary: true, pointerId })
}

describe('client/lobbies/room/useStartGameHold', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('shows a brief hold hint after an early pointer release', () => {
    const onStartGame = vi.fn()
    const onForceStart = vi.fn()
    const { getByRole } = render(
      <TestButton onStartGame={onStartGame} onForceStart={onForceStart} />,
    )
    const button = getByRole('button') as HTMLButtonElement

    pointerDown(button)
    advance(500)
    pointerUp(button)
    fireEvent.click(button)

    expect(onForceStart).not.toHaveBeenCalled()
    expect(onStartGame).not.toHaveBeenCalled()
    expect(button.getAttribute('data-hint')).toBe('true')

    advance(START_GAME_HOLD_MS)
    expect(button.getAttribute('data-hint')).toBe('false')
  })

  test('forces start after the full pointer hold and consumes its click', () => {
    const onStartGame = vi.fn()
    const onForceStart = vi.fn()
    const { getByRole } = render(
      <TestButton onStartGame={onStartGame} onForceStart={onForceStart} />,
    )
    const button = getByRole('button') as HTMLButtonElement

    pointerDown(button)
    advance(START_GAME_HOLD_MS)
    pointerUp(button)
    fireEvent.click(button)

    expect(onForceStart).toHaveBeenCalledTimes(1)
    expect(onStartGame).not.toHaveBeenCalled()
  })

  test('ignores repeated keydowns and consumes the keyboard native click', () => {
    const onStartGame = vi.fn()
    const onForceStart = vi.fn()
    const { getByRole } = render(
      <TestButton onStartGame={onStartGame} onForceStart={onForceStart} />,
    )
    const button = getByRole('button') as HTMLButtonElement

    fireEvent.keyDown(button, { key: ' ' })
    fireEvent.keyDown(button, { key: ' ', repeat: true })
    advance(START_GAME_HOLD_MS)
    fireEvent.keyUp(button, { key: ' ' })
    fireEvent.click(button)

    expect(onForceStart).toHaveBeenCalledTimes(1)
    expect(onStartGame).not.toHaveBeenCalled()
  })

  test('cancels a pointer hold and cleans up a pending hold on unmount', () => {
    const onForceStart = vi.fn()
    const { getByRole, unmount } = render(
      <TestButton onStartGame={vi.fn()} onForceStart={onForceStart} />,
    )
    const button = getByRole('button') as HTMLButtonElement

    pointerDown(button)
    fireEvent.pointerCancel(button, { pointerId: 1 })
    advance(START_GAME_HOLD_MS)
    expect(onForceStart).not.toHaveBeenCalled()

    pointerDown(button, 2)
    unmount()
    advance(START_GAME_HOLD_MS)
    expect(onForceStart).not.toHaveBeenCalled()
  })

  test('cancels held force-start when readiness changes and consumes the trailing click', () => {
    const onStartGame = vi.fn()
    const onForceStart = vi.fn()
    const { getByRole, rerender } = render(
      <TestButton onStartGame={onStartGame} onForceStart={onForceStart} />,
    )
    const button = getByRole('button') as HTMLButtonElement

    pointerDown(button)
    rerender(<TestButton allReady onStartGame={onStartGame} onForceStart={onForceStart} />)
    advance(START_GAME_HOLD_MS)
    pointerUp(button)
    fireEvent.click(button)

    expect(onForceStart).not.toHaveBeenCalled()
    expect(onStartGame).not.toHaveBeenCalled()

    fireEvent.click(button)
    expect(onStartGame).toHaveBeenCalledTimes(1)
  })

  test('cancels held force-start when the button becomes disabled', () => {
    const onForceStart = vi.fn()
    const { getByRole, rerender } = render(
      <TestButton onStartGame={vi.fn()} onForceStart={onForceStart} />,
    )
    const button = getByRole('button') as HTMLButtonElement

    pointerDown(button)
    rerender(<TestButton disabled onStartGame={vi.fn()} onForceStart={onForceStart} />)
    advance(START_GAME_HOLD_MS)

    expect(onForceStart).not.toHaveBeenCalled()
  })

  test('keeps an interrupted Enter press from generating repeat or trailing ready-start clicks', () => {
    const onStartGame = vi.fn()
    const onForceStart = vi.fn()
    const { getByRole, rerender } = render(
      <TestButton onStartGame={onStartGame} onForceStart={onForceStart} />,
    )
    const button = getByRole('button') as HTMLButtonElement

    fireEvent.keyDown(button, { key: 'Enter' })
    rerender(<TestButton allReady onStartGame={onStartGame} onForceStart={onForceStart} />)
    fireEvent.keyDown(button, { key: 'Enter', repeat: true })
    fireEvent.click(button)
    fireEvent.keyUp(button, { key: 'Enter' })
    fireEvent.click(button)

    expect(onForceStart).not.toHaveBeenCalled()
    expect(onStartGame).not.toHaveBeenCalled()

    fireEvent.keyDown(button, { key: 'Enter' })
    fireEvent.click(button)
    expect(onStartGame).toHaveBeenCalledTimes(1)
  })

  test('does not start a second hold when pointer and keyboard inputs overlap', () => {
    const onForceStart = vi.fn()
    const { getByRole } = render(<TestButton onStartGame={vi.fn()} onForceStart={onForceStart} />)
    const button = getByRole('button') as HTMLButtonElement

    pointerDown(button)
    fireEvent.keyDown(button, { key: ' ' })
    advance(START_GAME_HOLD_MS)

    expect(onForceStart).toHaveBeenCalledTimes(1)
  })

  test('accepts a fresh gesture after disabling while a pointer is held without an up event', () => {
    const onStartGame = vi.fn()
    const onForceStart = vi.fn()
    const { getByRole, rerender } = render(
      <TestButton onStartGame={onStartGame} onForceStart={onForceStart} />,
    )
    const button = getByRole('button') as HTMLButtonElement

    pointerDown(button)
    rerender(<TestButton allReady disabled onStartGame={onStartGame} onForceStart={onForceStart} />)
    rerender(<TestButton allReady onStartGame={onStartGame} onForceStart={onForceStart} />)
    pointerDown(button, 2)
    pointerUp(button, 2)
    fireEvent.click(button)

    expect(onForceStart).not.toHaveBeenCalled()
    expect(onStartGame).toHaveBeenCalledTimes(1)
  })

  test('preserves a blurred force-start gesture guard through a readiness change', () => {
    const onStartGame = vi.fn()
    const onForceStart = vi.fn()
    const { getByRole, rerender } = render(
      <TestButton onStartGame={onStartGame} onForceStart={onForceStart} />,
    )
    const button = getByRole('button') as HTMLButtonElement

    pointerDown(button)
    fireEvent.blur(button)
    rerender(<TestButton allReady onStartGame={onStartGame} onForceStart={onForceStart} />)
    fireEvent.click(button)

    expect(onForceStart).not.toHaveBeenCalled()
    expect(onStartGame).not.toHaveBeenCalled()

    pointerDown(button, 2)
    pointerUp(button, 2)
    fireEvent.click(button)
    expect(onStartGame).toHaveBeenCalledTimes(1)
  })
})
