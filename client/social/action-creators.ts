import { apiUrl } from '../../common/urls'
import { GetRelationshipsResponse } from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user-id'
import { ThunkAction } from '../dispatch-registry'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk'
import { fetchJson } from '../network/fetch'

export function getRelationshipsIfNeeded(spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async (dispatch, getState) => {
    const {
      auth: { self },
      relationships,
    } = getState()
    if (relationships.loaded || !self) {
      return
    }

    const result = await fetchJson<GetRelationshipsResponse>(
      apiUrl`users/${self.user.id}/relationships`,
      { signal: spec.signal },
    )
    dispatch({ type: '@users/getRelationships', payload: result })
  })
}

/**
 * How long to wait for relationships (the block list) to load before proceeding with whatever's
 * cached. Keeps a slow/hung request from stalling a game or replay launch.
 */
const RELATIONSHIPS_LOAD_TIMEOUT_MS = 5000

/**
 * Ensures relationship state (including the block list) has been loaded, then runs `onReady`.
 *
 * Relationship state resets on every reconnect, so the game/replay launch paths use this to send an
 * up-to-date block list. If it isn't loaded yet, the load is bounded by a timeout and `onReady` runs
 * with whatever's cached on success, error, or timeout — the launch is never blocked behind a
 * slow/hung request. `callbackOnAbort` is required so the timeout still triggers `onReady`
 * (abortableThunk otherwise skips both callbacks once the signal aborts).
 */
export function ensureRelationshipsLoaded(onReady: () => void): ThunkAction {
  return (dispatch, getState) => {
    if (getState().relationships.loaded) {
      onReady()
    } else {
      dispatch(
        getRelationshipsIfNeeded({
          signal: AbortSignal.timeout(RELATIONSHIPS_LOAD_TIMEOUT_MS),
          callbackOnAbort: true,
          onSuccess: onReady,
          onError: () => onReady(),
        }),
      )
    }
  }
}

export function sendFriendRequest(toId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`users/${toId}/relationships/friend-requests`, {
      method: 'POST',
      signal: spec.signal,
    })
  })
}

export function removeFriendRequest(toId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async (_, getState) => {
    const {
      auth: { self },
    } = getState()

    await fetchJson<void>(apiUrl`users/${toId}/relationships/friend-requests/${self!.user.id}`, {
      method: 'DELETE',
      signal: spec.signal,
    })
  })
}

export function acceptFriendRequest(fromId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async (_, getState) => {
    const {
      auth: { self },
    } = getState()

    await fetchJson<void>(apiUrl`users/${self!.user.id}/relationships/friends/${fromId}`, {
      method: 'POST',
      signal: spec.signal,
    })
  })
}

export function declineFriendRequest(fromId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async (_, getState) => {
    const {
      auth: { self },
    } = getState()

    await fetchJson<void>(apiUrl`users/${self!.user.id}/relationships/friend-requests/${fromId}`, {
      method: 'DELETE',
      signal: spec.signal,
    })
  })
}

export function removeFriend(targetId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async (_, getState) => {
    const {
      auth: { self },
    } = getState()

    await fetchJson<void>(apiUrl`users/${self!.user.id}/relationships/friends/${targetId}`, {
      method: 'DELETE',
      signal: spec.signal,
    })
  })
}

export function blockUser(targetId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async (_, getState) => {
    const {
      auth: { self },
    } = getState()

    await fetchJson<void>(apiUrl`users/${self!.user.id}/relationships/blocks/${targetId}`, {
      method: 'POST',
      signal: spec.signal,
    })
  })
}

export function unblockUser(targetId: SbUserId, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async (_, getState) => {
    const {
      auth: { self },
    } = getState()

    await fetchJson<void>(apiUrl`users/${self!.user.id}/relationships/blocks/${targetId}`, {
      method: 'DELETE',
      signal: spec.signal,
    })
  })
}
