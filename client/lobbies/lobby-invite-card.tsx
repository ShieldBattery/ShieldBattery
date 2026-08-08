import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { GameType, gameTypeToLabel } from '../../common/games/game-type'
import { openSlotCount as countOpenLobbySlots } from '../../common/lobbies'
import { lobbyIdFromPath } from '../../common/lobbies/lobby-url'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { MapImageInfo, SbMapId } from '../../common/maps'
import { openMapPreviewDialog } from '../maps/action-creators'
import { MapThumbnail } from '../maps/map-thumbnail'
import { FilledButton } from '../material/button'
import { isShieldBatteryUrl } from '../navigation/external-link'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodySmall, singleLine, titleSmall } from '../styles/typography'
import { isInLobby } from './lobby-reducer'
import { LobbySummaryLoadState, useLobbySummary } from './lobby-summary'
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
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return undefined
  }

  return isShieldBatteryUrl(url) ? lobbyIdFromPath(url.pathname) : undefined
}

// All card states share one fixed width, and no state is ever taller than the loading placeholder,
// so a state transition can only keep or shrink the card's footprint (shrinking is safe for the
// message list's autoscroll; only growth breaks it).
const CARD_WIDTH = 440
const CARD_PADDING = 8
const CARD_BORDER_WIDTH = 1

const THUMBNAIL_SIZE = 64

// InfoColumn stacks 3 rows (lobby name, host/game type, open slot count) separated by its own
// `gap`; their combined height comes straight from the typography tokens those rows render with
// (`titleSmall`/`bodySmall`'s `line-height`, see client/styles/typography.ts) rather than a
// guessed number, so it stays correct if either token's line-height ever changes.
const INFO_COLUMN_GAP = 2
const LOBBY_NAME_LINE_HEIGHT = 20 // titleSmall
const SECONDARY_LINE_HEIGHT = 16 // bodySmall
const INFO_STACK_HEIGHT = LOBBY_NAME_LINE_HEIGHT + SECONDARY_LINE_HEIGHT * 2 + INFO_COLUMN_GAP * 2

// The loaded card's height is determined by whichever of its two columns is taller -- the
// thumbnail (forced to a square aspect ratio below, regardless of the actual map's dimensions) or
// the 3-row info stack -- plus the card's own padding and border. Fixed here so the loading state
// can reserve the same height and a loaded card never grows past its placeholder.
const CARD_HEIGHT =
  Math.max(THUMBNAIL_SIZE, INFO_STACK_HEIGHT) + CARD_PADDING * 2 + CARD_BORDER_WIDTH * 2

const cardShell = css`
  width: ${CARD_WIDTH}px;
  max-width: 100%;
  margin-top: 4px;
  /* The card renders as a block child of the message container, whose hanging-indent trick
   * (72px padding pushed back out with a negative text-indent) is meant for message text only. */
  text-indent: 0;

  border-radius: 8px;

  /* The chat area sets user-select: text on every descendant so message text copies cleanly; the
   * card is UI rather than message text and must not splice itself into a copied selection. The
   * doubled class outranks that rule. */
  &&,
  && * {
    user-select: none;
  }
`

const cardBase = css`
  ${cardShell};
  height: ${CARD_HEIGHT}px;

  background-color: var(--theme-container-low);
  border: ${CARD_BORDER_WIDTH}px solid var(--theme-outline-variant);
`

const CardRoot = styled.div`
  ${cardBase};
  padding: ${CARD_PADDING}px;

  display: flex;
  align-items: center;
  gap: 12px;
`

// The same surface treatment as a live card, but collapsed to a single quiet line since there's
// nothing else to show. Shorter than the loading placeholder it replaces, which only ever shrinks
// the message.
const GoneCard = styled.div`
  ${cardShell};
  ${bodySmall};
  ${singleLine};
  padding: 8px 12px;

  color: var(--theme-on-surface-variant);
  background-color: var(--theme-container-low);
  border: ${CARD_BORDER_WIDTH}px solid var(--theme-outline-variant);
`

// A purely visual placeholder shown while the summary is loading, sized to match `CardRoot` (the
// tallest state) so the card never grows once the real content replaces it.
const LoadingCard = styled.div`
  ${cardBase};
`

const ThumbnailContainer = styled.div`
  flex-shrink: 0;
  width: ${THUMBNAIL_SIZE}px;
  /* The thumbnail's no-image fallback sizes itself to its (larger) placeholder icon rather than
   * the requested size, so both axes are pinned and the excess clipped to keep the card's fixed
   * height holding for maps without a generated image. */
  height: ${THUMBNAIL_SIZE}px;
  overflow: hidden;
`

// A long lobby name gives InfoColumn a large flex basis that would otherwise shrink the button
// past its label (which hard-clips, since the button contains its content); the name is the one
// that truncates instead.
const JoinButton = styled(FilledButton)`
  flex-shrink: 0;
`

const InfoColumn = styled.div`
  min-width: 0;
  flex-grow: 1;

  display: flex;
  flex-direction: column;
  gap: ${INFO_COLUMN_GAP}px;
`

const LobbyName = styled.div`
  ${titleSmall};
  ${singleLine};
`

const SecondaryLine = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

/**
 * The plain, already-resolved data {@link LobbyInviteCardBody} needs to render a loaded card,
 * regardless of whether it came from a summary fetch or the viewer's own live lobby state.
 */
export interface LobbyInviteDisplayData {
  name: string
  map: ReadonlyDeep<MapImageInfo & { id: SbMapId }>
  gameType: GameType
  hostName: string
  openSlotCount: number
}

/**
 * The card's join button: either an active join action, or a disabled acknowledgment that the
 * viewer is already seated in the lobby.
 */
type LobbyInviteJoinButton = { joined: false; onClick: () => void } | { joined: true }

/**
 * Renders a loaded invite card's body from already-resolved display data, shared by the
 * fetch-backed ({@link LobbyInviteCardContent}) and own-lobby ({@link LobbyInviteJoinedCard})
 * variants so the markup exists in exactly one place.
 */
function LobbyInviteCardBody({
  display,
  joinButton,
}: {
  display: LobbyInviteDisplayData
  joinButton: LobbyInviteJoinButton
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const hostAndGameType = `${display.hostName} · ${gameTypeToLabel(display.gameType, t)}`
  const slotsText = t('lobbies.joinLobby.openSlotCount', {
    defaultValue: '{{count}} slots open',
    count: display.openSlotCount,
  })

  return (
    <CardRoot>
      <ThumbnailContainer>
        <MapThumbnail
          map={display.map}
          size={THUMBNAIL_SIZE}
          forceAspectRatio={1}
          onPreview={() => dispatch(openMapPreviewDialog(display.map.id))}
        />
      </ThumbnailContainer>
      <InfoColumn>
        <LobbyName title={display.name}>{display.name}</LobbyName>
        <SecondaryLine title={hostAndGameType}>{hostAndGameType}</SecondaryLine>
        <SecondaryLine title={slotsText}>{slotsText}</SecondaryLine>
      </InfoColumn>
      {joinButton.joined ? (
        <JoinButton
          label={t('lobbies.joinLobby.joined', 'Joined')}
          disabled={true}
          testName='lobby-invite-card-join-button'
        />
      ) : (
        <JoinButton
          label={t('lobbies.joinLobby.action', 'Join lobby')}
          onClick={joinButton.onClick}
          testName='lobby-invite-card-join-button'
        />
      )}
    </CardRoot>
  )
}

/**
 * The presentational part of {@link LobbyInviteCard}'s fetch-backed variant: renders the
 * loading/notFound/error/loaded states without fetching anything itself, so it can be driven
 * directly (e.g. from a devonly test page) without racing a real lobby.
 *
 * The loading state renders a placeholder sized to match the loaded card so the message it's
 * attached to doesn't grow again once the summary arrives. The error state renders nothing at all,
 * unlike loading's visible skeleton -- the inline link in the message text is still rendered and
 * still works, so there's nothing useful to show and shrinking away is safe (only growth breaks
 * the message list's autoscroll).
 */
export function LobbyInviteCardContent({
  state,
  onJoinClick,
}: {
  state: LobbySummaryLoadState | undefined
  onJoinClick: () => void
}) {
  const { t } = useTranslation()

  if (!state) {
    return <LoadingCard aria-hidden={true} />
  }

  if (state.status === 'error') {
    return null
  }

  if (state.status === 'notFound') {
    return <GoneCard>{t('lobbies.summary.noLongerOpen', 'This lobby is no longer open.')}</GoneCard>
  }

  const { summary: lobby, host } = state.data

  return (
    <LobbyInviteCardBody
      display={{
        name: lobby.name,
        map: lobby.map,
        gameType: lobby.gameType,
        hostName: host.name,
        openSlotCount: lobby.playerSlots.open,
      }}
      joinButton={{ joined: false, onClick: onJoinClick }}
    />
  )
}

/**
 * The presentational part of {@link LobbyInviteCard}'s own-lobby variant: the same card layout as
 * the fetch-backed one, but with a disabled "Joined" button in place of the join action. Exported
 * so a devonly test page can drive it with mock display data the same way it drives
 * {@link LobbyInviteCardContent}.
 */
export function LobbyInviteJoinedCard({ display }: { display: LobbyInviteDisplayData }) {
  return <LobbyInviteCardBody display={display} joinButton={{ joined: true }} />
}

/**
 * A rich invite preview for a lobby link posted in chat: the lobby's map, name, host, game type,
 * and open slot count, with a button to join it. Reads through the cached summary lookup (see
 * `useLobbySummary`) since the same lobby link often appears in several rendered messages at once.
 *
 * A viewer already seated in the linked lobby (the common case being its own invite link pasted
 * into its own chat) still sees the card, built from the live lobby state instead of a summary
 * fetch: the summary endpoint 404s for a lobby that's mid-countdown or loading (the getter that
 * backs it excludes transient lobbies), which would otherwise show a seated member their own live
 * lobby as "no longer open"; reading local state instead sidesteps that entirely, and keeps the
 * zero-fetch property for the common case of a lobby's own link appearing in its own chat.
 */
export function LobbyInviteCard({ lobbyId }: { lobbyId: SbLobbyId }) {
  const isInThisLobby = useAppSelector(s => isInLobby(s.lobby) && s.lobby.info.id === lobbyId)

  if (isInThisLobby) {
    return <OwnLobbyInviteCard />
  }

  return <JoinableLobbyInviteCard lobbyId={lobbyId} />
}

function JoinableLobbyInviteCard({ lobbyId }: { lobbyId: SbLobbyId }) {
  const joinLobbyAction = useJoinLobbyAction()
  const [state] = useLobbySummary(lobbyId, { cached: true })

  return (
    <LobbyInviteCardContent
      state={state}
      onJoinClick={() =>
        joinLobbyAction(lobbyId, {
          name: state?.status === 'loaded' ? state.data.summary.name : undefined,
        })
      }
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
  const hostName = useAppSelector(s => s.users.byId.get(info.host.userId!)?.name) ?? ''

  return (
    <LobbyInviteJoinedCard
      display={{
        name: info.name,
        map: info.map!,
        gameType: info.gameType,
        hostName,
        openSlotCount: countOpenLobbySlots(info),
      }}
    />
  )
}
