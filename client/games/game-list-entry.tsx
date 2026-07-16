import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { getErrorStack } from '../../common/errors'
import { GameRecordJson, getGameDurationString, getGameTypeLabel } from '../../common/games/games'
import { getResultLabel, ReconciledResult } from '../../common/games/results'
import { SbUserId } from '../../common/users/sb-user-id'
import { openSimpleDialog } from '../dialogs/action-creators'
import { longTimestamp, narrowDuration } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { ReduxMapThumbnail } from '../maps/map-thumbnail'
import { IconButton, useButtonState } from '../material/button'
import { LinkButton } from '../material/link-button'
import { Ripple } from '../material/ripple'
import { elevationPlus1 } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { watchReplayFromUrl } from '../replays/action-creators'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import {
  bodyMedium,
  headlineMedium,
  labelMedium,
  singleLine,
  titleSmall,
} from '../styles/typography'
import { getGameResultsUrl } from './action-creators'
import { GamePlayersDisplay } from './game-players-display'

const GameListEntryRoot = styled.div`
  width: 100%;
  min-height: 80px;
  padding-top: 8px;
  padding-bottom: 8px;
  padding-left: 6px;
  padding-right: 6px;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
`

const BaseCell = styled.div`
  height: 100%;
  flex: 1 1 auto;
`

const LeadingCell = styled(BaseCell)`
  width: 128px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
`

const PlayersCell = styled(BaseCell)`
  width: 328px;
`

const GameLengthCell = styled(BaseCell)`
  ${headlineMedium};
  width: 128px;

  display: flex;
  justify-content: flex-end;
`

const MapAndGameTypeCell = styled(BaseCell)`
  width: 196px;
  position: relative;
  z-index: 1;

  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
`

const GameListEntryResult = styled.div<{ $result: ReconciledResult }>`
  ${headlineMedium};
  color: ${props => {
    switch (props.$result) {
      case 'win':
        return 'var(--theme-positive)'
      case 'loss':
        return 'var(--theme-negative)'
      default:
        return 'var(--theme-on-surface-variant)'
    }
  }};
  flex-shrink: 0;
`

/** The muted, single-line text style used for the date/time in the leading cell of a game row. */
export const GameDate = styled.div`
  ${labelMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const MapNameAndGameTypeContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 0;
`

const MapName = styled.div`
  ${titleSmall};
  ${singleLine};

  min-width: 0;
  width: 100%;
  text-align: right;
`

const GameType = styled.div`
  ${bodyMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);

  min-width: 0;
  width: 100%;
  text-align: right;
`

/** Positioned wrapper for a 64×64 thumbnail (or placeholder) plus its hover overlay. */
export const ThumbnailContainer = styled.div`
  position: relative;
  flex-shrink: 0;
`

const StyledMapThumbnail = styled(ReduxMapThumbnail)`
  ${elevationPlus1};
  width: 64px;
  height: 64px;
  flex-shrink: 0;
`

/** A 64×64 tile used when no real map thumbnail is available; holds a centered placeholder icon. */
export const MapNoImageContainer = styled.div`
  ${elevationPlus1};
  width: 64px;
  height: 64px;
  flex-shrink: 0;

  display: flex;
  justify-content: center;
  align-items: center;

  border-radius: 4px;
  background-color: var(--theme-container);
`

const MapNoImageIcon = styledWithAttrs(MaterialIcon, { icon: 'question_mark', size: 36 })`
  opacity: 0.5;
`

/**
 * A hover-reveal overlay over a game/replay thumbnail that surfaces a "watch replay" control. Keys
 * off `GameListEntryRoot`, so any row that renders the layout gets the hover behavior for free.
 */
export const WatchReplayOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: 4px;
  background-color: rgba(0, 0, 0, 0.5);

  display: flex;
  align-items: center;
  justify-content: center;

  opacity: 0;
  transition: opacity 0.2s ease;

  ${GameListEntryRoot}:hover & {
    opacity: 1;
  }
`

export interface GameListEntryLayoutProps {
  /** Content of the leading cell (e.g. the result + date, or a date/time on its own). */
  leading: React.ReactNode
  /** Content of the players cell (a players/teams display). */
  players: React.ReactNode
  /** Preformatted game duration text (e.g. `12:34`, or `—` when unknown). */
  duration: string
  /** Map name text (already color-code-stripped). */
  mapName: string
  /** Game type / mode label. */
  gameTypeLabel: string
  /** Thumbnail cell content (a `ThumbnailContainer` with a thumbnail or placeholder + overlay). */
  thumbnail: React.ReactNode
  className?: string
  /** Extra content rendered inside the row root after the cells (e.g. a `Ripple`). */
  children?: React.ReactNode
}

/**
 * The purely presentational layout for a game/replay list row: the row root plus the four cells
 * (leading, players, duration, map + game type). Carries no data dependencies so it can back both
 * real games (see `GameListEntry`) and local replay files.
 */
export function GameListEntryLayout({
  leading,
  players,
  duration,
  mapName,
  gameTypeLabel,
  thumbnail,
  className,
  children,
}: GameListEntryLayoutProps) {
  return (
    <GameListEntryRoot className={className}>
      <LeadingCell>{leading}</LeadingCell>

      <PlayersCell>{players}</PlayersCell>

      <GameLengthCell>{duration}</GameLengthCell>

      <MapAndGameTypeCell>
        <MapNameAndGameTypeContainer>
          <MapName title={mapName}>{mapName}</MapName>
          <GameType>{gameTypeLabel}</GameType>
        </MapNameAndGameTypeContainer>

        {thumbnail}
      </MapAndGameTypeCell>

      {children}
    </GameListEntryRoot>
  )
}

export interface GameListEntryProps {
  game: ReadonlyDeep<GameRecordJson>
  showResult?: boolean
  forUserId?: SbUserId
}

export function GameListEntry({ game, showResult = false, forUserId }: GameListEntryProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const map = useAppSelector(s => s.maps.byId.get(game.mapId))
  const replayInfo = useAppSelector(s => s.games.replayInfoById.get(game.id))

  const [buttonProps, rippleRef] = useButtonState({})

  const { results, startTime } = game

  // NOTE(2Pac): No need to memoize this under react-compiler; it re-derives only when its inputs
  // change.
  let result: ReconciledResult = 'unknown'
  if (results && forUserId) {
    for (const [userId, r] of results) {
      if (userId === forUserId) {
        result = r.result
        break
      }
    }
  }

  const gameType = getGameTypeLabel(game, t)
  const mapName = map?.name ?? t('game.mapName.unknown', 'Unknown map')

  const onWatchReplay = (e: React.MouseEvent) => {
    e.stopPropagation()
    // This is needed to prevent the link from being followed
    e.preventDefault()

    if (!replayInfo) return

    dispatch(
      watchReplayFromUrl(replayInfo, game.id, {
        onSuccess: () => {},
        onError: err => {
          logger.error(`Error watching replay: ${getErrorStack(err)}`)
          dispatch(
            openSimpleDialog(
              t('replays.watch.errorTitle', 'Error loading replay'),
              err?.message ??
                t(
                  'replays.watch.errorBody',
                  'There was a problem downloading or loading the replay. Please try again later.',
                ),
            ),
          )
        },
      }),
    )
  }

  const dateCell = (
    <Tooltip text={longTimestamp.format(startTime)} position='right'>
      <GameDate>{narrowDuration.format(startTime)}</GameDate>
    </Tooltip>
  )

  return (
    <LinkButton {...buttonProps} href={getGameResultsUrl(game.id)}>
      <GameListEntryLayout
        leading={
          showResult && forUserId ? (
            <>
              <GameListEntryResult $result={result}>
                {getResultLabel(result, t, true)}
              </GameListEntryResult>
              {dateCell}
            </>
          ) : (
            dateCell
          )
        }
        players={<GamePlayersDisplay game={game} forUserId={forUserId} showTeamLabels={false} />}
        duration={game.gameLength ? getGameDurationString(game.gameLength) : '—'}
        mapName={mapName}
        gameTypeLabel={gameType}
        thumbnail={
          <ThumbnailContainer>
            {map ? (
              <StyledMapThumbnail
                key={map.hash}
                mapId={map.id}
                size={64}
                forceAspectRatio={1}
                hasMapPreviewAction={false}
                hasFavoriteAction={false}
              />
            ) : (
              <MapNoImageContainer>
                <MapNoImageIcon />
              </MapNoImageContainer>
            )}
            {IS_ELECTRON && replayInfo && (
              <WatchReplayOverlay>
                <Tooltip text={t('gameDetails.buttonWatchReplay', 'Watch replay')} position='top'>
                  <IconButton
                    styledAs='div'
                    icon={<MaterialIcon icon='play_circle' />}
                    onClick={onWatchReplay}
                  />
                </Tooltip>
              </WatchReplayOverlay>
            )}
          </ThumbnailContainer>
        }>
        <Ripple ref={rippleRef} />
      </GameListEntryLayout>
    </LinkButton>
  )
}
