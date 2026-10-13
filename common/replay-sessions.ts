/** Metadata for a replay staged on the server while its owner creates a replay session. */
export interface ReplaySessionSourceMetadata {
  mapName: string
  gameType: string
  durationFrames: number
}

/**
 * The response from staging a local replay for a future multiplayer replay session.
 *
 * `sourceId` is only useful to the owner while it remains unexpired. It is intentionally not a
 * download capability: the staged object's storage path and URL never leave the server here.
 */
export interface StageReplaySessionSourceResponse {
  sourceId: string
  hash: string
  size: number
  metadata: ReplaySessionSourceMetadata
}
