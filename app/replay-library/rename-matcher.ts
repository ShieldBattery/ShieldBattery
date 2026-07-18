/**
 * Matches vanished index entries to newly-seen files by content identity (file size + hash of the
 * first bytes), so a moved/renamed replay can be re-pointed at its new path instead of being
 * deleted and re-parsed from scratch.
 */

export interface VanishedReplay {
  path: string
  id: number
  fileSize: number | null
  contentHash: string | null
}

export interface NewFileIdentity {
  path: string
  contentHash: string
  fileSize: number
}

export interface ReplayMove {
  id: number
  fromPath: string
  toPath: string
}

export function matchRenamedReplays(
  vanished: ReadonlyArray<VanishedReplay>,
  newFiles: ReadonlyArray<NewFileIdentity>,
): ReplayMove[] {
  const byIdentity = new Map<string, VanishedReplay[]>()
  for (const v of vanished) {
    if (v.fileSize === null || v.contentHash === null) {
      continue
    }
    const key = `${v.fileSize}:${v.contentHash}`
    const queue = byIdentity.get(key)
    if (queue) {
      queue.push(v)
    } else {
      byIdentity.set(key, [v])
    }
  }

  const moves: ReplayMove[] = []
  for (const newFile of newFiles) {
    const key = `${newFile.fileSize}:${newFile.contentHash}`
    const queue = byIdentity.get(key)
    const match = queue?.shift()
    if (match) {
      moves.push({ id: match.id, fromPath: match.path, toPath: newFile.path })
    }
  }

  return moves
}
