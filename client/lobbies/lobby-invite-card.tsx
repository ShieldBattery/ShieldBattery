import { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { GameType, gameTypeToLabel } from '../../common/games/game-type'
import { getPlayerSlots, openSlotCount, slotCount } from '../../common/lobbies'
import {
  isLaunchingLifecycle,
  LobbyLifecycle,
  LobbyPlayerSlotCounts,
} from '../../common/lobbies/lobby-network'
import { lobbyIdFromPath } from '../../common/lobbies/lobby-url'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { MapImageInfo, SbMapId } from '../../common/maps'
import { SbUserId } from '../../common/users/sb-user-id'
import { MaterialIcon } from '../icons/material/material-icon'
import {
  BackdropCard,
  BackdropCardAction,
  BackdropCardGone,
  BackdropCardHeader,
  BackdropCardLoading,
  BackdropCardMeta,
  BackdropCardMetaKeyText,
  BackdropCardMetaText,
  BackdropCardTitle,
  backdropTextShadow,
  CardClickBoundary,
  CardTooltip,
  getBackdropCardHeight,
  TooltipText,
} from '../messaging/backdrop-card'
import { shieldBatteryPathFromLink } from '../navigation/external-link'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodySmall, labelMedium, singleLine, titleLarge } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { isInLobby } from './lobby-reducer'
import { LobbySummaryLoadState, useLobbySummary } from './lobby-summary'
import { navigateToLobby } from './lobby-url'
import { useJoinLobbyAction } from './use-join-lobby-action'

/**
 * How old a message can be while still rendering an invite card for a lobby link in it. Lobbies
 * are ephemeral, so links past this age are almost certainly dead — not rendering their cards
 * keeps scrollback from filling with "no longer open" boxes and reduces how many cards load a
 * summary at all. (This bounds cards by age, not count; the hard bound on summary-fetch fan-out
 * from sender-controlled message content is the fetch budget in `lobby-summary.tsx`.)
 */
export const LOBBY_INVITE_CARD_MAX_AGE_MS = 60 * 60 * 1000

/**
 * Returns the lobby id embedded in a chat message link, or undefined if the link isn't a
 * ShieldBattery lobby link (an external URL, or a ShieldBattery URL for something other than a
 * lobby).
 */
export function lobbyIdFromMessageLink(href: string): SbLobbyId | undefined {
  const pathname = shieldBatteryPathFromLink(href)
  return pathname !== undefined ? lobbyIdFromPath(pathname) : undefined
}

/** The line heights of the typography tokens the card's body stacks, which set its height. */
const TITLE_LARGE_LINE_HEIGHT = 32
const DETAIL_ROW_HEIGHT = 20

const BODY_ROW_GAP = 8
const BODY_HEIGHT = TITLE_LARGE_LINE_HEIGHT + BODY_ROW_GAP + DETAIL_ROW_HEIGHT
const CARD_HEIGHT = getBackdropCardHeight(BODY_HEIGHT)

const SEAT_TILE_SIZE = 20
const SEAT_TILE_GAP = 4
/** Seat tiles per row in a grid: a lobby holds at most 8 player seats, which lay out in two rows. */
const SEAT_TILES_PER_ROW = 4

/**
 * The plain, already-resolved data {@link LobbyInviteCardBody} needs to render a loaded card,
 * regardless of whether it came from a summary fetch or the viewer's own live lobby state.
 */
export interface LobbyInviteDisplayData {
  name: string
  map: ReadonlyDeep<MapImageInfo & { id: SbMapId }>
  gameType: GameType
  hostId: SbUserId
  /** How many player seats the lobby has, and how many are filled or open (the rest are closed). */
  playerSlots: LobbyPlayerSlotCounts
  lifecycle: LobbyLifecycle
}

const SeatTileGrid = styled.span<{ $columns: number }>`
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(${props => props.$columns}, ${SEAT_TILE_SIZE}px);
  grid-auto-rows: ${SEAT_TILE_SIZE}px;
  gap: ${SEAT_TILE_GAP}px;
  align-content: center;
`

const SeatTile = styled.span<{ $filled: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;

  ${props =>
    props.$filled
      ? css`
          background-color: var(--theme-on-surface);
          color: var(--theme-container-low);
          box-shadow: 0 1px 3px rgb(0 0 0 / 0.5);
        `
      : css`
          border: 1.5px dashed var(--theme-on-surface-variant);
        `}
`

/** The seats render inside their tooltip's wrapper, which is what actually sits in a row. */
const SeatsTooltip = styled(CardTooltip)`
  flex-shrink: 0;
`

const SeatCountText = styled.span`
  ${bodySmall};
  ${singleLine};
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

/**
 * A lobby's player seats as tiles, filled ones first: in a single row, or a grid of up to
 * {@link SEAT_TILES_PER_ROW} per row. Only counts are shown, since who holds each seat isn't part of
 * what a lobby link reveals.
 */
export function LobbySeats({
  playerSlots,
  lifecycle,
  layout,
}: {
  playerSlots: LobbyPlayerSlotCounts
  lifecycle: LobbyLifecycle
  layout: 'row' | 'grid'
}) {
  const { t } = useTranslation()
  const seats = [
    ...Array.from({ length: playerSlots.taken }, () => true),
    ...Array.from({ length: playerSlots.open }, () => false),
  ]
  const tooltip = t('lobbies.inviteCard.seats', {
    defaultValue: '{{taken}} of {{total}} seats filled',
    taken: playerSlots.taken,
    total: playerSlots.taken + playerSlots.open,
  })
  const countText =
    lifecycle === 'gathering'
      ? t('lobbies.summary.openSlotCount', {
          defaultValue: '{{count}} open',
          count: playerSlots.open,
        })
      : undefined

  const columns = layout === 'row' ? seats.length : Math.min(SEAT_TILES_PER_ROW, seats.length)

  return (
    <>
      {countText ? <SeatCountText>{countText}</SeatCountText> : null}
      <SeatsTooltip text={tooltip} position='top'>
        <SeatTileGrid $columns={Math.max(1, columns)}>
          {seats.map((filled, i) => (
            <SeatTile key={i} $filled={filled}>
              {filled ? <MaterialIcon icon='person' size={16} filled={true} /> : null}
            </SeatTile>
          ))}
        </SeatTileGrid>
      </SeatsTooltip>
    </>
  )
}

export const StatusChip = styled.span<{ $kind: 'inGame' | 'starting' }>`
  ${labelMedium};
  flex-shrink: 0;
  align-self: center;
  height: 20px;
  padding: 0 8px;

  display: flex;
  align-items: center;
  gap: 6px;

  border-radius: 10px;
  color: var(--theme-on-surface);
  background-color: ${props =>
    props.$kind === 'inGame'
      ? 'rgb(from var(--theme-positive) r g b / 0.24)'
      : 'rgb(from var(--theme-amber) r g b / 0.24)'};

  &::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: ${props =>
      props.$kind === 'inGame' ? 'var(--theme-positive)' : 'var(--theme-amber)'};
  }
`

const JoinedLabel = styled.span`
  ${labelMedium};
  ${singleLine};
  flex-shrink: 0;
  align-self: center;

  display: flex;
  align-items: center;
  gap: 4px;

  color: var(--theme-on-surface-variant);
`

/**
 * The card's header: what it is, the lobby's map and game type, and what the lobby is doing now.
 * Viewers already seated in the lobby are told so; anyone else gets the join action when
 * `onJoinClick` is set.
 */
function LobbyInviteHeader({
  display,
  joined,
  onJoinClick,
}: {
  display: LobbyInviteDisplayData
  joined: boolean
  onJoinClick: (() => void) | undefined
}) {
  const { t } = useTranslation()
  const isLaunching = isLaunchingLifecycle(display.lifecycle)

  return (
    <BackdropCardHeader>
      <BackdropCardTitle text={t('lobbies.inviteCard.title', 'Lobby')} />
      <BackdropCardMeta>
        {/* The map is hard to pick out from the blurred image behind the card. */}
        <BackdropCardMetaKeyText text={display.map.name} />
        <BackdropCardMetaText text={' · ' + gameTypeToLabel(display.gameType, t)} />
      </BackdropCardMeta>
      {display.lifecycle === 'inGame' ? (
        <StatusChip $kind='inGame'>{t('lobbies.lobby.inGame', 'In game')}</StatusChip>
      ) : null}
      {isLaunching ? (
        <StatusChip $kind='starting'>
          {t('lobbies.summary.startingGame', 'Starting game')}
        </StatusChip>
      ) : null}
      {joined ? (
        <JoinedLabel>
          <MaterialIcon icon='check_circle' size={16} />
          {t('lobbies.inviteCard.joined', "You're in this lobby")}
        </JoinedLabel>
      ) : null}
      {!joined && onJoinClick ? (
        <BackdropCardAction onClick={onJoinClick} testName='lobby-invite-card-join-button'>
          <MaterialIcon icon='login' size={18} />
          {t('lobbies.inviteCard.join', 'Join')}
        </BackdropCardAction>
      ) : null}
    </BackdropCardHeader>
  )
}

const HostLine = styled.div`
  ${bodySmall};
  min-width: 0;
  height: ${DETAIL_ROW_HEIGHT}px;

  display: flex;
  align-items: center;
  gap: 0.3em;

  color: var(--theme-on-surface-variant);
  white-space: nowrap;

  /* The username renders inside its tooltip's wrapper, which is what actually sits in the line. */
  & > * {
    min-width: 0;
  }
`

const HostName = styled(ConnectedUsername)`
  ${bodySmall};
  ${singleLine};
  min-width: 0;
  font-weight: 600;
  color: var(--theme-on-surface);
`

/** The lobby's host as an interactive username, which handles its own clicks. */
function HostUsername({ userId }: { userId: SbUserId }) {
  return (
    <CardClickBoundary>
      <HostName userId={userId} showTooltipForOverflow='top' />
    </CardClickBoundary>
  )
}

export function HostedBy({ hostId }: { hostId: SbUserId }) {
  const { t } = useTranslation()
  return (
    <HostLine>
      <Trans t={t} i18nKey='lobbies.inviteCard.hostedBy'>
        Hosted by <HostUsername userId={hostId} />
      </Trans>
    </HostLine>
  )
}

const LargeLobbyName = styled(TooltipText)`
  ${titleLarge};
  min-width: 0;
  color: var(--theme-on-surface);
`

const Body = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: ${BODY_ROW_GAP}px;
`

const DetailRow = styled.div`
  min-width: 0;
  height: ${DETAIL_ROW_HEIGHT}px;

  display: flex;
  align-items: center;
  gap: 8px;

  & > ${HostLine} {
    flex-grow: 1;
  }
`

const InviteCard = styled(BackdropCard)`
  & ${LargeLobbyName}, & ${HostLine}, & ${SeatCountText} {
    ${backdropTextShadow};
  }
`

/**
 * Renders a loaded invite card from already-resolved display data, shared by the fetch-backed
 * ({@link LobbyInviteCardContent}) and own-lobby ({@link LobbyInviteJoinedCard}) cards.
 */
function LobbyInviteCardBody({
  display,
  joined,
  onClick,
  onJoinClick,
}: {
  display: LobbyInviteDisplayData
  joined: boolean
  onClick: () => void
  onJoinClick: (() => void) | undefined
}) {
  const { t } = useTranslation()
  return (
    <InviteCard
      imageUrl={display.map.image512Url ?? display.map.image256Url}
      height={CARD_HEIGHT}
      onClick={onClick}
      actionLabel={
        joined
          ? t('lobbies.inviteCard.goToLobby', 'Go to lobby')
          : t('lobbies.inviteCard.view', 'View lobby')
      }
      testName='lobby-invite-card-view-button'>
      <LobbyInviteHeader display={display} joined={joined} onJoinClick={onJoinClick} />
      <Body>
        <LargeLobbyName text={display.name} />
        <DetailRow>
          <HostedBy hostId={display.hostId} />
          <LobbySeats
            playerSlots={display.playerSlots}
            lifecycle={display.lifecycle}
            layout='row'
          />
        </DetailRow>
      </Body>
    </InviteCard>
  )
}

/**
 * The presentational part of {@link LobbyInviteCard} for a lobby the viewer isn't in: renders the
 * loading/notFound/error/loaded states without fetching anything itself, so it can be driven
 * directly (e.g. from a devonly test page) without racing a real lobby.
 *
 * The loading state renders a placeholder the loaded card's height, so the message it's attached
 * to doesn't grow once the summary arrives. The error state renders nothing: the inline link in the
 * message text still works, and shrinking away is safe (only growth breaks the message list's
 * autoscroll).
 */
export function LobbyInviteCardContent({
  state,
  onClick,
  onJoinClick,
}: {
  state: LobbySummaryLoadState | undefined
  /** Opens the lobby's page, where the viewer can choose to join it. */
  onClick: () => void
  onJoinClick: () => void
}) {
  const { t } = useTranslation()

  if (!state) {
    return <BackdropCardLoading $height={CARD_HEIGHT} aria-hidden={true} />
  }

  if (state.status === 'error') {
    return null
  }

  if (state.status === 'notFound') {
    return (
      <BackdropCardGone>
        {t('lobbies.summary.noLongerOpen', 'This lobby is no longer open.')}
      </BackdropCardGone>
    )
  }

  const { summary: lobby, host } = state.data

  return (
    <LobbyInviteCardBody
      display={{
        name: lobby.name,
        map: lobby.map,
        gameType: lobby.gameType,
        hostId: host.id,
        playerSlots: lobby.playerSlots,
        lifecycle: lobby.lifecycle,
      }}
      joined={false}
      onClick={onClick}
      onJoinClick={onJoinClick}
    />
  )
}

/**
 * The presentational part of {@link LobbyInviteCard} for the lobby the viewer is seated in: the same
 * card, telling the viewer they're in it. Exported so a devonly test page can drive it with mock
 * display data the same way it drives {@link LobbyInviteCardContent}.
 */
export function LobbyInviteJoinedCard({
  display,
  onClick,
}: {
  display: LobbyInviteDisplayData
  /** Opens the lobby. */
  onClick: () => void
}) {
  return (
    <LobbyInviteCardBody
      display={display}
      joined={true}
      onClick={onClick}
      onJoinClick={undefined}
    />
  )
}

/**
 * A rich invite preview for a lobby link posted in chat: the lobby's name, host, map, game type and
 * seats over a blurred image of its map. Clicking it opens the lobby's page, which for anyone not
 * already in the lobby is a preview they can choose to join from. Reads through the cached summary
 * lookup (see `useLobbySummary`) since the same lobby link often appears in several rendered
 * messages at once.
 *
 * A viewer already seated in the linked lobby (the common case being its own invite link pasted
 * into its own chat) still sees the card, built from the live lobby state instead of a summary
 * fetch. A seated member's store is both more current than any summary snapshot and free to read,
 * so a lobby's own link appearing in its own chat costs no requests at all.
 */
export function LobbyInviteCard({ lobbyId }: { lobbyId: SbLobbyId }) {
  const isInThisLobby = useAppSelector(s => isInLobby(s.lobby) && s.lobby.info.id === lobbyId)

  if (isInThisLobby) {
    return <OwnLobbyInviteCard />
  }

  return <JoinableLobbyInviteCard lobbyId={lobbyId} />
}

function JoinableLobbyInviteCard({ lobbyId }: { lobbyId: SbLobbyId }) {
  const dispatch = useAppDispatch()
  const [joinLobbyAction] = useJoinLobbyAction()
  const [state] = useLobbySummary(lobbyId, { cached: true })
  const host = state?.status === 'loaded' ? state.data.host : undefined
  const name = state?.status === 'loaded' ? state.data.summary.name : undefined

  useEffect(() => {
    // The summary carries the host's user info, so their name renders without a lookup of its own.
    if (host) {
      dispatch({ type: '@users/loadUsers', payload: [host] })
    }
  }, [dispatch, host])

  return (
    <LobbyInviteCardContent
      state={state}
      onClick={() => navigateToLobby(lobbyId, name)}
      onJoinClick={() => joinLobbyAction(lobbyId, { name })}
    />
  )
}

/**
 * Renders the invite card for the lobby the viewer is currently seated in, entirely from local
 * lobby state -- see the invariant on {@link LobbyInviteCard} for why this never fetches a
 * summary. Only ever rendered while `isInLobby` holds for the current lobby, so `info` is that
 * lobby's live data and its host slot is always occupied.
 */
function OwnLobbyInviteCard() {
  const info = useAppSelector(s => s.lobby.info)
  const runState = useAppSelector(s => s.lobby.runState)
  const loadingState = useAppSelector(s => s.lobby.loadingState)

  let lifecycle: LobbyLifecycle = 'gathering'
  if (runState) {
    lifecycle = 'inGame'
  } else if (loadingState.isLoading) {
    lifecycle = 'loading'
  } else if (loadingState.isCountingDown) {
    lifecycle = 'countingDown'
  }

  return (
    <LobbyInviteJoinedCard
      display={{
        name: info.name,
        map: info.map!,
        gameType: info.gameType,
        hostId: info.host.userId!,
        playerSlots: {
          taken: getPlayerSlots(info).length,
          open: openSlotCount(info),
          total: slotCount(info),
        },
        lifecycle,
      }}
      onClick={() => navigateToLobby(info.id, info.name)}
    />
  )
}
