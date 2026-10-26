import { css } from 'styled-components'

/**
 * Present on the document root while the window lacks input focus. `client/dom/window-focus.ts`
 * keeps it in sync.
 */
export const WINDOW_UNFOCUSED_ATTR = 'data-window-unfocused'

/**
 * Pauses the CSS animation of the element (or pseudo-element) this is composed into while the
 * window lacks input focus. For decorative animations that loop forever: while one is on screen in
 * a visible window, Chromium draws a new frame on every display refresh, which a player with
 * ShieldBattery on another monitor pays for the whole game. Loading and progress indicators should
 * keep animating instead, since a frozen one reads as a hang.
 */
export const pauseWhileUnfocused = css`
  :root[${WINDOW_UNFOCUSED_ATTR}] & {
    animation-play-state: paused;
  }
`
