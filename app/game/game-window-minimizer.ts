/** The parts of a `BrowserWindow` the minimizer uses. */
export interface MinimizableWindow {
  isDestroyed(): boolean
  isVisible(): boolean
  isMinimized(): boolean
  minimize(): void
  restore(): void
}

/**
 * Minimizes the app window while games run, and brings it back once the last one has exited.
 *
 * A visible app window keeps drawing whatever it shows, and on laptops that switch the display
 * between graphics cards, that drawing can keep the display on the slower card for the whole game.
 *
 * The window only comes back if it's still minimized when the games end: one the user brought back
 * themselves mid-game is left alone, as is one that was hidden or minimized before the game.
 */
export class GameWindowMinimizer {
  private runningGames = new Set<string>()
  private minimizedForGames = false

  constructor(private getWindow: () => MinimizableWindow | null) {}

  gameLaunching(gameId: string) {
    this.runningGames.add(gameId)
  }

  /** Minimizes the window, if any game is still running. */
  minimizeForGames() {
    if (this.runningGames.size === 0 || this.minimizedForGames) {
      return
    }
    const window = this.getWindow()
    if (!window || window.isDestroyed() || !window.isVisible() || window.isMinimized()) {
      return
    }
    window.minimize()
    this.minimizedForGames = true
  }

  gameEnded(gameId: string) {
    this.runningGames.delete(gameId)
    if (this.runningGames.size > 0 || !this.minimizedForGames) {
      return
    }
    this.minimizedForGames = false
    const window = this.getWindow()
    if (window && !window.isDestroyed() && window.isMinimized()) {
      window.restore()
    }
  }
}
