import { useEffect } from 'react'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { TypedIpcRenderer } from '../../common/ipc'
import { useAppSelector } from '../redux-hooks'
import { useRelationshipsLoader } from '../social/friends-list'
import { isInActiveGame } from './game-client-reducer'

const ipcRenderer = new TypedIpcRenderer()

/**
 * Keeps the active game's copy of the local user's block list current, so blocks and unblocks
 * made while a game runs (here, in another session, or with the game's own chat commands) take
 * effect in its chat right away.
 */
export function ActiveGameBlockSync() {
  const inActiveGame = useAppSelector(s => isInActiveGame(s.gameClient))
  return inActiveGame ? <InGameBlockSync /> : null
}

function InGameBlockSync() {
  // Relationships are cleared on every reconnect, so a reconnect mid-game has to reload them
  // before the game can be kept in sync again.
  useRelationshipsLoader()
  const loaded = useAppSelector(s => s.relationships.loaded)
  const blocks = useAppSelector(s => s.relationships.blocks)

  useEffect(() => {
    // Until relationships load, `blocks` is empty (or holds only the blocks made since the last
    // reconnect), and sending it would unblock everyone else in the game.
    if (!loaded) {
      return
    }
    ipcRenderer
      .invoke('activeGameSetBlockedUsers', Array.from(blocks.keys()))
      ?.catch(swallowNonBuiltins)
  }, [loaded, blocks])

  return null
}
