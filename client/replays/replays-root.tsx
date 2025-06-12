import { lazy } from 'react'
import { useTrackPageView } from '../analytics/analytics'
import { OnlyInApp } from '../download/only-in-app'

const LoadableLocalReplays = lazy(async () => ({
  default: (await import('./browse-local-replays')).BrowseLocalReplays,
}))

export function ReplaysRoot() {
  useTrackPageView('/replays')
  return IS_ELECTRON ? <LoadableLocalReplays /> : <OnlyInApp />
}
