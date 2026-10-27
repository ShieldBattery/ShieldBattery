import { describe, expect, test } from 'vitest'
import { GameWindowMinimizer, MinimizableWindow } from './game-window-minimizer'

class FakeWindow implements MinimizableWindow {
  visible = true
  minimized = false
  minimizeCalls = 0
  restoreCalls = 0

  isDestroyed() {
    return false
  }
  isVisible() {
    return this.visible
  }
  isMinimized() {
    return this.minimized
  }
  minimize() {
    this.minimized = true
    this.minimizeCalls++
  }
  restore() {
    this.minimized = false
    this.restoreCalls++
  }
}

function setup() {
  const window = new FakeWindow()
  const minimizer = new GameWindowMinimizer(() => window)
  return { window, minimizer }
}

describe('app/game/game-window-minimizer', () => {
  test('minimizes for a game and restores when it ends', () => {
    const { window, minimizer } = setup()
    minimizer.gameLaunching('a')
    minimizer.minimizeForGames()
    expect(window.minimized).toBe(true)

    minimizer.gameEnded('a')
    expect(window.minimized).toBe(false)
    expect(window.restoreCalls).toBe(1)
  })

  test('restores only once the last running game ends', () => {
    const { window, minimizer } = setup()
    minimizer.gameLaunching('a')
    minimizer.minimizeForGames()
    minimizer.gameLaunching('b')
    minimizer.minimizeForGames()
    expect(window.minimizeCalls).toBe(1)

    minimizer.gameEnded('a')
    expect(window.minimized).toBe(true)
    minimizer.gameEnded('b')
    expect(window.minimized).toBe(false)
  })

  test("doesn't minimize once the game has already ended", () => {
    const { window, minimizer } = setup()
    minimizer.gameLaunching('a')
    minimizer.gameEnded('a')
    minimizer.minimizeForGames()
    expect(window.minimizeCalls).toBe(0)
  })

  test('leaves a hidden or already minimized window alone', () => {
    const { window, minimizer } = setup()
    window.visible = false
    minimizer.gameLaunching('a')
    minimizer.minimizeForGames()
    minimizer.gameEnded('a')
    expect(window.minimizeCalls).toBe(0)
    expect(window.restoreCalls).toBe(0)

    window.visible = true
    window.minimized = true
    minimizer.gameLaunching('b')
    minimizer.minimizeForGames()
    minimizer.gameEnded('b')
    expect(window.minimizeCalls).toBe(0)
    expect(window.restoreCalls).toBe(0)
  })

  test('leaves a window the user brought back during the game alone', () => {
    const { window, minimizer } = setup()
    minimizer.gameLaunching('a')
    minimizer.minimizeForGames()
    window.minimized = false
    minimizer.gameEnded('a')
    expect(window.restoreCalls).toBe(0)

    // The next game minimizes again, rather than counting as already minimized.
    minimizer.gameLaunching('b')
    minimizer.minimizeForGames()
    expect(window.minimizeCalls).toBe(2)
  })
})
