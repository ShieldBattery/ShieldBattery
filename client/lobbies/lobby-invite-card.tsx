import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
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

// Aligns the card under the message text: the timestamp column is 72px wide, plus the 8px of
// horizontal padding `MessageContainer` (message-layout.tsx) uses everywhere else.
const CARD_MARGIN = '4px 0 4px 80px'
const CARD_MAX_WIDTH = 440

const CardRoot = styled.div`
  width: fit-content;
  max-width: ${CARD_MAX_WIDTH}px;
  margin: ${CARD_MARGIN};
  padding: 8px;

  display: flex;
  align-items: center;
  gap: 12px;

  background-color: var(--theme-container-low);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

const GoneCard = styled.div`
  ${bodySmall};
  ${singleLine};
  width: fit-content;
  max-width: ${CARD_MAX_WIDTH}px;
  margin: ${CARD_MARGIN};
  padding: 8px 12px;

  color: var(--theme-on-surface-variant);
  background-color: var(--theme-container-low);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

const THUMBNAIL_SIZE = 64

const ThumbnailContainer = styled.div`
  flex-shrink: 0;
  width: ${THUMBNAIL_SIZE}px;
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
 */
export function LobbyInviteCardContent({
  state,
  onJoinClick,
}: {
  state: LobbySummaryLoadState | undefined
  onJoinClick: () => void
}) {
  const { t } = useTranslation()

  if (!state || state.status === 'error') {
    // The inline link in the message text is still rendered and still works, so there's nothing
    // useful to show here while loading or if the preview couldn't be loaded.
    return null
  }

  if (state.status === 'notFound') {
    return <GoneCard>{t('lobbies.summary.noLongerOpen', 'This lobby is no longer open.')}</GoneCard>
  }

  const { summary: lobby, host } = state.data

  return (
    <CardRoot>
      <ThumbnailContainer>
        <MapThumbnail map={lobby.map} size={THUMBNAIL_SIZE} />
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
      <FilledButton
        label={t('lobbies.joinLobby.action', 'Join lobby')}
        onClick={onJoinClick}
        testName='lobby-invite-card-join-button'
      />
    </CardRoot>
  )
}

/**
 * A rich invite preview for a lobby link posted in chat: the lobby's map, name, host, game type,
 * and open slot count, with a button to join it. Renders nothing while the summary is loading or
 * if it fails to load for a reason other than the lobby being gone (the inline link in the message
 * text is unaffected either way).
 */
export function LobbyInviteCard({ lobbyId }: { lobbyId: SbLobbyId }) {
  const dispatch = useAppDispatch()
  const [state] = useLobbySummary(lobbyId)

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
