import { useEffect, useEffectEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppSelector } from '../../redux-hooks'
import { SetupPage } from '../setup-page'
import { useLobbyBestOf } from './best-of-parts'
import { SeriesResults } from './series-results'

export interface RoomSeriesResultsProps {
  /** The lobby's best-of series to show, one of those it has played or is playing. */
  bestOfId: string
  onClose: () => void
  onWatchReplay: (gameId: string) => void
  onViewGameSummary: (gameId: string) => void
}

/**
 * The full results of one of the lobby's best-of series, as a page that takes over the room. It
 * follows the series as it stands in the lobby, so games that settle and results the host corrects
 * show up while it's open, and it closes itself if the lobby no longer has the series.
 */
export function RoomSeriesResults({
  bestOfId,
  onClose,
  onWatchReplay,
  onViewGameSummary,
}: RoomSeriesResultsProps) {
  const { t } = useTranslation()
  const bestOf = useLobbyBestOf(bestOfId)
  const games = useAppSelector(s => s.lobby.series)
  const playingGameId = useAppSelector(s => s.lobby.runState?.gameId)

  const closeForMissingSeries = useEffectEvent(() => onClose())
  const isMissing = !bestOf
  useEffect(() => {
    if (isMissing) {
      closeForMissingSeries()
    }
  }, [isMissing])

  if (!bestOf) {
    return null
  }

  return (
    <SetupPage title={t('lobbies.room.results.title', 'Results')} onBack={onClose}>
      <SeriesResults
        bestOf={bestOf}
        games={games}
        playingGameId={playingGameId}
        onWatchReplay={onWatchReplay}
        onViewGameSummary={onViewGameSummary}
      />
    </SetupPage>
  )
}
