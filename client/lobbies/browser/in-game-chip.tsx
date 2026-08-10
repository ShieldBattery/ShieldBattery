import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { formatGameDuration, LobbyChip } from './browser-parts'

type TickCallback = () => void

const tickListeners = new Set<TickCallback>()
let tickTimer: ReturnType<typeof setInterval> | undefined

/**
 * Subscribes to a once-a-second tick shared by every readout on the page, so a list full of running
 * games advances in lockstep off a single timer instead of drifting apart on timers of its own.
 */
function subscribeToSeconds(callback: TickCallback): () => void {
  tickListeners.add(callback)
  if (tickTimer === undefined) {
    tickTimer = setInterval(() => {
      for (const listener of Array.from(tickListeners)) {
        listener()
      }
    }, 1000)
  }

  return () => {
    tickListeners.delete(callback)
    if (tickListeners.size === 0 && tickTimer !== undefined) {
      clearInterval(tickTimer)
      tickTimer = undefined
    }
  }
}

function AnchoredElapsedTime({ elapsedMs }: { elapsedMs: number }) {
  const [anchoredAt] = useState(() => performance.now())
  const [now, setNow] = useState(anchoredAt)

  useEffect(() => subscribeToSeconds(() => setNow(performance.now())), [])

  return <>{formatGameDuration(elapsedMs + (now - anchoredAt))}</>
}

/**
 * How long a lobby's game has been running, ticking up while you watch.
 *
 * Client and server share no wall clock, so `elapsedMs` — a snapshot taken when the summary was
 * serialized — is anchored against the local clock as it arrives and counted up from there. That
 * anchor is a mount-time reading, so a fresh snapshot remounts the readout to re-anchor it,
 * correcting whatever drift built up since the last one.
 */
export function GameElapsedTime({ elapsedMs }: { elapsedMs: number }) {
  return <AnchoredElapsedTime key={elapsedMs} elapsedMs={elapsedMs} />
}

const ChipRoot = styled(LobbyChip)`
  flex-shrink: 0;

  border-color: rgb(from var(--theme-amber) r g b / 0.32);
  background-color: rgb(from var(--theme-amber) r g b / 0.12);
  color: var(--theme-amber);
  font-variant-numeric: tabular-nums;
`

/**
 * Marks a lobby whose game is already running, and how far into it that game is. Amber for activity
 * rather than for any outcome — nobody has won anything yet.
 */
export function InGameChip({ elapsedMs }: { elapsedMs: number | undefined }) {
  const { t } = useTranslation()

  return (
    <ChipRoot>
      {t('lobbies.browser.inGame', 'In game')}
      {elapsedMs !== undefined ? (
        <>
          {' · '}
          <GameElapsedTime elapsedMs={elapsedMs} />
        </>
      ) : null}
    </ChipRoot>
  )
}
