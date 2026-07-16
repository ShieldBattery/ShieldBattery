import { lazy } from 'react'
import { useTrackPageView } from '../analytics/analytics'
import { OnlyInApp } from '../download/only-in-app'

const LoadableReplayLibrary = lazy(async () => ({
  default: (await import('./replay-library')).ReplayLibrary,
}))

export function ReplaysRoot() {
  useTrackPageView('/replays')
  return IS_ELECTRON ? <LoadableReplayLibrary /> : <OnlyInApp />
}
