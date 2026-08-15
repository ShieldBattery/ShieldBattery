import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { registerSecondsListener } from '../../matchmaking/elapsed-time'
import { formatGameDuration, LobbyChip } from './browser-parts'

function AnchoredElapsedTime({ elapsedMs }: { elapsedMs: number }) {
  const [anchoredAt] = useState(() => performance.now())
  const [now, setNow] = useState(anchoredAt)

  useEffect(() => registerSecondsListener(() => setNow(performance.now())), [])

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
