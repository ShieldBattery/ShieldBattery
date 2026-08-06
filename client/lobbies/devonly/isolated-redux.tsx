import React, { useState } from 'react'
import { Provider as ReduxProvider } from 'react-redux'
import { ReduxAction } from '../../action-types'
import createStore from '../../create-store'
import { ConnectedDialogOverlay } from '../../dialogs/connected-dialog-overlay'

export interface IsolatedReduxProviderProps {
  children: React.ReactNode
  /**
   * Actions dispatched against the page-local store before its first render, seeding whatever
   * starting state the page needs (e.g. a logged-in user) instead of mounting with an empty store.
   */
  seedActions?: ReadonlyArray<ReduxAction>
}

/**
 * Provides a Redux store scoped to a dev page: state seeded or dispatched inside stays local
 * instead of landing in the app's real store (where, e.g., a seeded lobby would make the rest of
 * the app act as if the user were really in one). Renders its own dialog overlay so dialogs
 * opened from inside the page read the same page-local store.
 */
export function IsolatedReduxProvider({ children, seedActions }: IsolatedReduxProviderProps) {
  const [store] = useState(() => {
    const newStore = createStore()
    for (const action of seedActions ?? []) {
      newStore.dispatch(action)
    }
    return newStore
  })

  return (
    <ReduxProvider store={store}>
      {children}
      <ConnectedDialogOverlay />
    </ReduxProvider>
  )
}
