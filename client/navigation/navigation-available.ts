import * as React from 'react'
import { useContext } from 'react'

/**
 * Whether the UI below this point can move the app to another route. Screens that hold the user in
 * place (e.g. the draft screen, which traps navigation) provide `false`, and controls whose whole
 * purpose is to navigate (viewing a profile, opening a whisper, viewing or joining a channel) are
 * left out there rather than offered and then undone by the trap. Defaults to `true`.
 */
export const NavigationAvailableContext = React.createContext(true)

/** Returns whether controls that navigate to another route should be offered here. */
export function useIsNavigationAvailable(): boolean {
  return useContext(NavigationAvailableContext)
}
