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
import { saveReplayToLibrary, watchReplayFromUrl } from '../replays/action-creators'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
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

const GameListEntryRoot = styled.div<{
  $fillPlayers?: boolean
  $dense?: boolean
  $hasThumbnail?: boolean
}>`
  width: 100%;
  /*
    The floor keeps a single-team (e.g. 1v1) row from collapsing to nothing; taller multi-team rows
    exceed it and drive their own height, so team matchups still read as taller. The dense floor
    suits rows without a thumbnail (the replay library), where the default 80px — sized around the
    64px thumbnail — would leave a 1v1 mostly empty.
  */
  min-height: ${props => (props.$dense ? '52px' : '80px')};
  padding-top: 8px;
  padding-bottom: 8px;
  padding-left: 6px;
  /*
    A trailing thumbnail (games list) already holds the map name / game type well clear of the right
    edge. Without one (the replay library) that text would sit almost flush against the edge, so
    those rows take a bit more trailing room to breathe.
  */
  padding-right: ${props => (props.$hasThumbnail ? '6px' : '16px')};

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;

  /*
    Controls how a row wider than its content distributes the slack. By default every cell shares it
    evenly (fine for a narrow, capped list). Under the fill-players mode, only the players cell grows
    so the duration + map stay compact and read as a stats cluster pinned to the right — used by the
    full-width replay library, where spreading every cell would leave the duration floating in an
    empty middle.
  */
  --_side-cell-grow: ${props => (props.$fillPlayers ? 0 : 1)};
`

const BaseCell = styled.div`
  height: 100%;
  flex-grow: var(--_side-cell-grow, 1);
  flex-shrink: 1;
  flex-basis: auto;
`

/**
 * A fixed-width, non-growing column reserved for a single leading action (e.g. a replay's star /
 * bookmark toggle), kept narrow so it reads as its own column rather than sharing the leading cell.
 */
const BookmarkCell = styled.div`
  flex: 0 0 auto;
  width: 48px;
  height: 100%;

  display: flex;
  align-items: center;
  justify-content: center;
`

const LeadingCell = styled(BaseCell)`
  width: 128px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
`

const PlayersCell = styled(BaseCell)`
  width: 328px;
  /* Always grows, so under the fill-players mode it's the cell that absorbs a row's extra width. */
  flex-grow: 1;
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
  gap: 4px;

  opacity: 0;
  transition: opacity 0.2s ease;

  ${GameListEntryRoot}:hover & {
    opacity: 1;
  }
`

export interface GameListEntryLayoutProps {
  /**
   * Content of a narrow, dedicated leading action column (e.g. a replay's star / bookmark toggle).
   * When omitted, the column isn't rendered.
   */
  bookmark?: React.ReactNode
  /**
   * Content of the leading cell (e.g. the result + date, or a date/time on its own). When omitted,
   * the cell isn't rendered.
   */
  leading?: React.ReactNode
  /** Content of the players cell (a players/teams display). */
  players: React.ReactNode
  /** Preformatted game duration text (e.g. `12:34`, or `—` when unknown). */
  duration: string
  /** Map name text (already color-code-stripped). */
  mapName: string
  /** Game type / mode label. */
  gameTypeLabel: string
  /**
   * Thumbnail cell content (a `ThumbnailContainer` with a thumbnail or placeholder + overlay). When
   * omitted, no thumbnail is rendered and the map name / game type take the full cell.
   */
  thumbnail?: React.ReactNode
  /**
   * When set, a row wider than its content lets only the players cell grow (keeping duration + map
   * as a compact right-side cluster) instead of spreading the slack across every cell. Suited to
   * full-width lists.
   */
  fillPlayers?: boolean
  /**
   * When set, uses a shorter min-height so short (single-team) rows are compact while taller
   * multi-team rows still drive their own height. Suited to thumbnail-less rows (e.g. replays).
   */
  dense?: boolean
  className?: string
  /** Extra content rendered inside the row root after the cells (e.g. a `Ripple`). */
  children?: React.ReactNode
}

/**
 * The purely presentational layout for a game/replay list row: the row root plus its cells (an
 * optional bookmark column and leading cell, then players, duration, map + game type, and an
 * optional thumbnail). Carries no data dependencies so it can back both real games (see
 * `GameListEntry`) and local replay files.
 */
export function GameListEntryLayout({
  bookmark,
  leading,
  players,
  duration,
  mapName,
  gameTypeLabel,
  thumbnail,
  fillPlayers,
  dense,
  className,
  children,
}: GameListEntryLayoutProps) {
  return (
    <GameListEntryRoot
      className={className}
      $fillPlayers={fillPlayers}
      $dense={dense}
      $hasThumbnail={thumbnail !== undefined}>
      {bookmark !== undefined ? <BookmarkCell>{bookmark}</BookmarkCell> : null}

      {leading !== undefined ? <LeadingCell>{leading}</LeadingCell> : null}

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
  const snackbarController = useSnackbarController()
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

  const onSaveReplay = (e: React.MouseEvent) => {
    e.stopPropagation()
    // This is needed to prevent the link from being followed
    e.preventDefault()

    if (!replayInfo) return

    dispatch(
      saveReplayToLibrary(replayInfo, {
        onSuccess: result => {
          snackbarController.showSnackbar(
            result.alreadySaved
              ? t(
                  'gameDetails.saveReplayAlreadySaved',
                  "This game's replay is already in your library",
                )
              : t('gameDetails.saveReplaySuccess', 'Replay saved to your library'),
          )
        },
        onError: err => {
          logger.error(`Error saving replay: ${getErrorStack(err)}`)
          snackbarController.showSnackbar(
            t('gameDetails.saveReplayError', 'There was a problem saving the replay'),
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
                <Tooltip text={t('gameDetails.buttonSaveReplay', 'Save replay')} position='top'>
                  <IconButton
                    styledAs='div'
                    icon={<MaterialIcon icon='save' />}
                    onClick={onSaveReplay}
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
