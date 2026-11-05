/**
 * How close a mouse press has to be to the window gaining focus to count as what caused it. The two
 * land a few milliseconds apart, while a person can't focus the window another way and then click
 * in it anywhere near this quickly.
 */
const ACTIVATING_PRESS_WINDOW_MS = 100

let focusGainedAt = Number.NEGATIVE_INFINITY
let lastPressAt = Number.NEGATIVE_INFINITY

// Element focus events don't bubble, so without capturing this only sees the window's own.
window.addEventListener('focus', event => {
  focusGainedAt = event.timeStamp
})
window.addEventListener(
  'mousedown',
  event => {
    lastPressAt = event.timeStamp
  },
  true /* useCapture */,
)

/**
 * Returns whether the click being handled is the one that brought the window forward. Clicking an
 * unfocused window both focuses it and delivers the click to the page, by which point the window
 * reports having focus, so this can't be determined by checking for focus when the click arrives.
 * The order of the focus event and the press isn't relied upon.
 */
export function isActivatingClick(): boolean {
  return lastPressAt - focusGainedAt < ACTIVATING_PRESS_WINDOW_MS
}
