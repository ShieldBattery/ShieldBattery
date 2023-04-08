import { useRoute } from 'wouter'
import { useKeyListener } from '../keyboard/key-listener'
import { HotkeyProp } from '../material/button'
import { push } from './routing'

export interface UrlHotkeyProps {
  /** URL to navigate to. */
  url: string
  /**
   * A hotkey, or an array of hotkeys, to register for the URL. Pressing any of the specified
   * modifiers and key combinations will result in the page navigation to the given URL.
   */
  hotkey: HotkeyProp | HotkeyProp[]
  /** Whether the navigation is disabled (hotkey will do nothing). */
  disabled?: boolean
  /** A function that will perform the transition to the new URL. */
  transitionFn?: (url: string) => void
}

/**
 * A hook which allows any component to register a hotkey (or multiple hotkeys) which upon pressing
 * will navigate the application to the given URL.
 *
 * If the currently active URL is the same as the given one, pressing the hotkey will do nothing.
 */
export function useUrlHotkey({ url, hotkey, disabled, transitionFn = push }: UrlHotkeyProps) {
  const [isActive] = useRoute(url)

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      const hotkeys = Array.isArray(hotkey) ? hotkey : [hotkey]
      for (const hotkey of hotkeys) {
        if (
          !disabled &&
          !isActive &&
          event.keyCode === hotkey.keyCode &&
          event.altKey === !!hotkey.altKey &&
          event.shiftKey === !!hotkey.shiftKey &&
          event.ctrlKey === !!hotkey.ctrlKey
        ) {
          transitionFn(url)

          return true
        }
      }

      return false
    },
  })
}
