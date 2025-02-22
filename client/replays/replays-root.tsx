import React from 'react'
import { OnlyInApp } from '../download/only-in-app'

const LoadableLocalReplays = React.lazy(async () => ({
  default: (await import('./browse-local-replays')).BrowseLocalReplays,
}))

export function ReplaysRoot() {
  return IS_ELECTRON ? <LoadableLocalReplays /> : <OnlyInApp />
}
