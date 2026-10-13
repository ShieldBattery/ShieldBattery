import { TypedIpcRenderer } from '../../common/ipc'
import {
  CreateReplaySessionRequest,
  CreateReplaySessionResponse,
  GetReplaySessionSourceResponse,
  InviteToReplaySessionRequest,
  ReplaySessionClientRequest,
  ReplaySessionJson,
  ReportReplaySessionLoadedRequest,
  SbReplaySessionId,
  SendReplaySessionChatRequest,
  StageReplaySessionSourceResponse,
} from '../../common/replay-sessions'
import { apiUrl } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { ThunkAction } from '../dispatch-registry'
import { jotaiStore } from '../jotai-store'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { clientId } from '../network/client-id'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { ensureReplayCached } from '../replays/action-creators'
import { replaySessionAtom, replaySessionChatAtom } from './replay-session-atoms'

const ipcRenderer = new TypedIpcRenderer()

/** The replay a host can start a session from. */
export type ReplaySessionSourceChoice = { gameId: string } | { localPath: string }

/** Takes on a session the server just placed this client in. */
function enterSession(session: ReplaySessionJson) {
  const current = jotaiStore.get(replaySessionAtom)
  if (current?.id !== session.id) {
    jotaiStore.set(replaySessionChatAtom, [])
  }
  // The session's channel may already have delivered a newer snapshot than this response
  if (!current || current.id !== session.id || current.revision < session.revision) {
    jotaiStore.set(replaySessionAtom, session)
  }
}

/** Stages a local replay on the server so a session can be created from it. */
async function stageLocalReplay(
  localPath: string,
  signal?: AbortSignal,
): Promise<StageReplaySessionSourceResponse> {
  const data = await ipcRenderer.invoke('fsReadFile', localPath)
  if (!data) {
    throw new Error('Could not read the replay file')
  }
  const formData = new FormData()
  formData.append('replay', new Blob([data], { type: 'application/octet-stream' }), 'replay.rep')

  return await fetchJson<StageReplaySessionSourceResponse>(apiUrl`replay-sessions/sources`, {
    method: 'POST',
    body: formData,
    signal,
  })
}

/** Creates a replay session hosted by this client, uploading a local replay first if needed. */
export function createReplaySession(
  source: ReplaySessionSourceChoice,
  spec: RequestHandlingSpec<ReplaySessionJson>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    const request: CreateReplaySessionRequest =
      'gameId' in source
        ? { clientId, gameId: source.gameId }
        : { clientId, uploadId: (await stageLocalReplay(source.localPath, spec.signal)).sourceId }

    const { session } = await fetchJson<CreateReplaySessionResponse>(apiUrl`replay-sessions`, {
      method: 'POST',
      body: encodeBodyAsParams<CreateReplaySessionRequest>(request),
      signal: spec.signal,
    })
    enterSession(session)
    return session
  })
}

export function joinReplaySession(
  sessionId: SbReplaySessionId,
  spec: RequestHandlingSpec<ReplaySessionJson>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    const { session } = await fetchJson<CreateReplaySessionResponse>(
      apiUrl`replay-sessions/${sessionId}/join`,
      {
        method: 'POST',
        body: encodeBodyAsParams<ReplaySessionClientRequest>({ clientId }),
        signal: spec.signal,
      },
    )
    enterSession(session)
    return session
  })
}

export function declineReplaySessionInvite(
  sessionId: SbReplaySessionId,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`replay-sessions/${sessionId}/decline`, {
      method: 'POST',
      signal: spec.signal,
    })
  })
}

export function inviteToReplaySession(
  sessionId: SbReplaySessionId,
  targetId: SbUserId,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`replay-sessions/${sessionId}/invite`, {
      method: 'POST',
      body: encodeBodyAsParams<InviteToReplaySessionRequest>({ clientId, targetId }),
      signal: spec.signal,
    })
  })
}

function postSessionAction(
  sessionId: SbReplaySessionId,
  action: 'start' | 'leave' | 'close',
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`replay-sessions/${sessionId}/${action}`, {
      method: 'POST',
      body: encodeBodyAsParams<ReplaySessionClientRequest>({ clientId }),
      signal: spec.signal,
    })
  })
}

/** Moves the host's session into loading, which launches the replay for every member. */
export function startReplaySession(sessionId: SbReplaySessionId, spec: RequestHandlingSpec) {
  return postSessionAction(sessionId, 'start', spec)
}

export function leaveReplaySession(sessionId: SbReplaySessionId, spec: RequestHandlingSpec) {
  return postSessionAction(sessionId, 'leave', spec)
}

export function closeReplaySession(sessionId: SbReplaySessionId, spec: RequestHandlingSpec) {
  return postSessionAction(sessionId, 'close', spec)
}

export function sendReplaySessionChat(
  sessionId: SbReplaySessionId,
  text: string,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async () => {
    await fetchJson<void>(apiUrl`replay-sessions/${sessionId}/chat`, {
      method: 'POST',
      body: encodeBodyAsParams<SendReplaySessionChatRequest>({ clientId, text }),
      signal: spec.signal,
    })
  })
}

/**
 * Downloads a session's replay into the local replay cache, which only keeps it if its bytes hash
 * to what the server says the session plays.
 */
export async function ensureSessionReplayCached(
  sessionId: SbReplaySessionId,
): Promise<{ path: string; hash: string }> {
  const source = await fetchJson<GetReplaySessionSourceResponse>(
    apiUrl`replay-sessions/${sessionId}/source`,
  )
  // The cache verifies a replay against its hash before keeping it, so the hash also serves as
  // the cache entry's id: a session replay's identity is its content.
  const path = await ensureReplayCached({ id: source.hash, url: source.url, hash: source.hash })
  if (!path) {
    throw new Error('Could not cache the session replay')
  }
  return { path, hash: source.hash }
}

/** Tells the server this client has loaded the session's replay and is ready to play it. */
export async function reportReplaySessionLoaded(
  sessionId: SbReplaySessionId,
  hash: string,
): Promise<void> {
  await fetchJson<void>(apiUrl`replay-sessions/${sessionId}/loaded`, {
    method: 'POST',
    body: encodeBodyAsParams<ReportReplaySessionLoadedRequest>({ clientId, hash }),
  })
}
