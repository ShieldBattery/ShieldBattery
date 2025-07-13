import React, { useContext, useEffect, useRef } from 'react'

interface NavigationTrapContext {
  activateTrap(stateKey: string): void
  deactivateTrap(stateKey: string): void
}

const NavigationTrapContext = React.createContext<NavigationTrapContext | undefined>(undefined)

interface WouterNavigationEvent extends Event {
  arguments: [state: any, unused: unknown, url?: string]
}

const TRAP_STATE_KEY = 'NAVIGATION_TRAP'

/**
 * Context provider that enables trapping a user within a specific navigation state
 * (basically disabling back/forward and any other forms of navigation until released). This only
 * works inside Electron (because we can ensure there is no way to navigate multiple steps at once).
 */
export function NavigationTrapProvider({ children }: { children: React.ReactNode }) {
  const currentTrapRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    // NOTE(tec27): The push/replace events are added by wouter, if we switch off of it or it
    // changes its implementation, this may break (but we could just add them back ourselves)
    function onPushState(event: WouterNavigationEvent) {
      if (currentTrapRef.current && history.state !== currentTrapRef.current) {
        // Go back to the trap
        history.back()
      }
    }

    function onReplaceState(event: WouterNavigationEvent) {
      if (currentTrapRef.current && history.state !== currentTrapRef.current) {
        // Overwrite the thing that just overwrote our trap state with the trap state
        history.replaceState(currentTrapRef.current, '')
      }
    }

    function onPopState(event: PopStateEvent) {
      if (!currentTrapRef.current) {
        if (event.state === TRAP_STATE_KEY) {
          // We must have been in the process of exiting a deactivated trap, or the user hit
          // forward to go back into the (now inactive) trap, so put them out of the trap
          history.back()
        }
      } else {
        if (event.state === TRAP_STATE_KEY) {
          // The user went back, push them back into the trap
          history.pushState(currentTrapRef.current, '')
        } else if (event.state !== currentTrapRef.current) {
          // popstate also fires for forward events, so we go back to get to the trap state
          history.back()
        }
      }
    }

    window.addEventListener('pushState', onPushState as any)
    window.addEventListener('replaceState', onReplaceState as any)
    window.addEventListener('popstate', onPopState)

    return () => {
      window.removeEventListener('pushState', onPushState as any)
      window.removeEventListener('replaceState', onReplaceState as any)
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  return (
    <NavigationTrapContext.Provider
      value={{
        activateTrap: (stateKey: string) => {
          if (!IS_ELECTRON) {
            throw new Error('Navigation traps are only supported in Electron')
          }
          if (currentTrapRef.current) {
            throw new Error(
              `Can't activate ${stateKey} navigation trap, ` +
                `${currentTrapRef.current} is already active`,
            )
          }

          history.pushState(TRAP_STATE_KEY, '')
          history.pushState(stateKey, '')
          currentTrapRef.current = stateKey
        },
        deactivateTrap: (stateKey: string) => {
          if (!IS_ELECTRON) {
            throw new Error('Navigation traps are only supported in Electron')
          }
          if (currentTrapRef.current !== stateKey) {
            throw new Error(`Navigation trap ${stateKey} is not currently active`)
          }

          currentTrapRef.current = undefined
          history.back()
        },
      }}>
      {children}
    </NavigationTrapContext.Provider>
  )
}

/**
 * Hook that can be activated to trap the user in a specific navigation state. This is useful for
 * preventing navigation on certain screens, namely ones that overlay the entire UI (like the
 * draft screen). This only works inside Electron (because we can ensure there is no way to
 * navigate multiple steps at once).
 */
export function useNavigationTrap(stateKey: string, trapActive: boolean) {
  const context = useContext(NavigationTrapContext)
  if (!context) {
    throw new Error('useNavigationTrap must be used within a NavigationTrapProvider')
  }

  useEffect(() => {
    if (trapActive) {
      context.activateTrap(stateKey)
      return () => {
        context.deactivateTrap(stateKey)
      }
    } else {
      return () => {}
    }
  }, [context, stateKey, trapActive])
}
