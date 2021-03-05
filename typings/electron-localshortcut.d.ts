// NOTE(tec27): The types for this module are super old and against an older version of electron,
// which causes issues. I've just typed what we actually use, this isn't the complete API

declare module 'electron-localshortcut' {
  import { BrowserWindow } from 'electron'

  /**
   * Registers the shortcut `accelerator`on the BrowserWindow instance.
   *
   * @param win BrowserWindow instance to register. This argument could be omitted, in this case
   *     the function registers the shortcut on all app windows.
   * @param accelerator the shortcut to register
   * @param callback This function is called when the shortcut is presse and the window is focused
   *     and not minimized.
   */
  export function register(
    win: BrowserWindow,
    accelerator: string | string[],
    callback: () => void,
  ): void
}
