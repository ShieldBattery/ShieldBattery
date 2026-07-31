import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { gameTypeToLabel } from '../../common/games/game-type'
import { lobbyIdFromPath } from '../../common/lobbies/lobby-url'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { MapThumbnail } from '../maps/map-thumbnail'
import { FilledButton } from '../material/button'
import { isShieldBatteryUrl } from '../navigation/external-link'
import { useAppDispatch } from '../redux-hooks'
import { bodySmall, singleLine, titleSmall } from '../styles/typography'
import { LobbySummaryLoadState, useLobbySummary } from './lobby-summary'
import { navigateToLobby } from './lobby-url'

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

// All card states share one fixed width (and height, see below) so no state transition ever
// changes the card's footprint.
const CARD_WIDTH = 440
const CARD_PADDING = 8
const CARD_BORDER_WIDTH = 1

const THUMBNAIL_SIZE = 64

// The loaded card's height is fully determined by its thumbnail (forced to a square aspect ratio
// below, regardless of the actual map's dimensions), its padding, and its border -- fixed here so
// every other state (loading, not-found) can reserve the same height and the card never resizes
// after it first mounts.
const CARD_HEIGHT = THUMBNAIL_SIZE + CARD_PADDING * 2 + CARD_BORDER_WIDTH * 2

const cardBase = css`
  width: ${CARD_WIDTH}px;
  max-width: 100%;
  height: ${CARD_HEIGHT}px;
  margin-top: 4px;
  /* The card renders as a block child of the message container, whose hanging-indent trick
   * (72px padding pushed back out with a negative text-indent) is meant for message text only. */
  text-indent: 0;

  background-color: var(--theme-container-low);
  border: ${CARD_BORDER_WIDTH}px solid var(--theme-outline-variant);
  border-radius: 8px;

  /* The chat area sets user-select: text on every descendant so message text copies cleanly; the
   * card is UI rather than message text and must not splice itself into a copied selection. The
   * doubled class outranks that rule. */
  &&,
  && * {
    user-select: none;
  }
`

const CardRoot = styled.div`
  ${cardBase};
  padding: ${CARD_PADDING}px;

  display: flex;
  align-items: center;
  gap: 12px;
`

const GoneCard = styled.div`
  ${cardBase};
  ${bodySmall};
  ${singleLine};
  padding: 8px 12px;

  display: flex;
  align-items: center;

  color: var(--theme-on-surface-variant);
`

// A purely visual placeholder shown while the summary is loading, sized to match `CardRoot` (the
// tallest state) so the card never grows once the real content replaces it.
const LoadingCard = styled.div`
  ${cardBase};
`

const ThumbnailContainer = styled.div`
  flex-shrink: 0;
  width: ${THUMBNAIL_SIZE}px;
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
  gap: 2px;
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
 * The presentational part of {@link LobbyInviteCard}: renders the loading/notFound/error/loaded
 * states without fetching anything itself, so it can be driven directly (e.g. from a devonly test
 * page) without racing a real lobby.
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
    <CardRoot>
      <ThumbnailContainer>
        <MapThumbnail map={lobby.map} size={THUMBNAIL_SIZE} forceAspectRatio={1} />
      </ThumbnailContainer>
      <InfoColumn>
        <LobbyName title={lobby.name}>{lobby.name}</LobbyName>
        <SecondaryLine>
          {host.name} · {gameTypeToLabel(lobby.gameType, t)} ·{' '}
          {t('lobbies.summary.openSlotCount', {
            defaultValue: '{{count}} open',
            count: lobby.openSlotCount,
          })}
        </SecondaryLine>
      </InfoColumn>
      <JoinButton
        label={t('lobbies.joinLobby.action', 'Join lobby')}
        onClick={onJoinClick}
        testName='lobby-invite-card-join-button'
      />
    </CardRoot>
  )
}

/**
 * A rich invite preview for a lobby link posted in chat: the lobby's map, name, host, game type,
 * and open slot count, with a button to join it. Reads through the cached summary lookup (see
 * `useLobbySummary`) since the same lobby link often appears in several rendered messages at once.
 */
export function LobbyInviteCard({ lobbyId }: { lobbyId: SbLobbyId }) {
  const dispatch = useAppDispatch()
  const [state] = useLobbySummary(lobbyId, { cached: true })

  const onJoinClick = () => {
    if (IS_ELECTRON) {
      // The join preview page at this route handles the actual join attempt (and its errors).
      navigateToLobby(lobbyId, state?.status === 'loaded' ? state.data.summary.name : undefined)
    } else {
      dispatch(openDialog({ type: DialogType.Download }))
    }
  }

  return <LobbyInviteCardContent state={state} onJoinClick={onJoinClick} />
}
