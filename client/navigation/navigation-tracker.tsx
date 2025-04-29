import React, { useContext } from 'react'

export interface NavigationTrackerContextValue {
  onNavigation: () => void
}

const NavigationTrackerContext = React.createContext<NavigationTrackerContextValue>({
  onNavigation: () => {},
})

/**
 * A context that allows a component to track navigation by any of its descendants (provided they
 * utilize `useNavigationTracker` and call the `onNavigation` function).
 */
export function NavigationTrackerProvider({
  onNavigation,
  children,
}: {
  onNavigation: () => void
  children: React.ReactNode
}) {
  const { onNavigation: parentOnNavigation } = useContext(NavigationTrackerContext)
  return (
    <NavigationTrackerContext.Provider
      value={{
        onNavigation: () => {
          onNavigation()
          parentOnNavigation()
        },
      }}>
      {children}
    </NavigationTrackerContext.Provider>
  )
}

export function useNavigationTracker(): NavigationTrackerContextValue {
  return useContext(NavigationTrackerContext)
}
