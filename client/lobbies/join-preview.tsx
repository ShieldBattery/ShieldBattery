import { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { gameTypeToLabel } from '../../common/games/game-type'
import { isLaunchingLifecycle, LobbySummaryResponse } from '../../common/lobbies/lobby-network'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton } from '../material/button'
import { backdropTextShadow } from '../messaging/backdrop-card'
import { useAppDispatch } from '../redux-hooks'
import {
  bodyLarge,
  bodyMedium,
  headlineMedium,
  singleLine,
  titleMedium,
  titleSmall,
} from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { LobbySeats, StatusChip } from './lobby-invite-card'

type Lobby = LobbySummaryResponse['summary']

const BackdropImage = styled.img`
  position: absolute;
  inset: 0;
  z-index: -2;
  width: 100%;
  height: 100%;

  object-fit: cover;
  filter: saturate(0.9) blur(2px);
  transform: scale(1.04);
`

/** Lightest behind the map on the left, darkening behind the text beside it. */
const Scrim = styled.div`
  position: absolute;
  inset: 0;
  z-index: -1;

  background: linear-gradient(
    90deg,
    rgb(from var(--theme-container-low) r g b / 0.5) 0%,
    rgb(from var(--theme-container-low) r g b / 0.86) 45%,
    rgb(from var(--theme-container-low) r g b / 0.92) 100%
  );
`

const MetaLine = styled.div`
  ${bodyMedium};
  ${backdropTextShadow};
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 8px;

  color: var(--theme-on-surface-variant);
`

const MetaTitle = styled.span`
  ${titleSmall};
  flex-shrink: 0;
  color: var(--theme-on-surface);
`

const MetaText = styled.span`
  ${singleLine};
  min-width: 0;
`

function LobbyMeta({ lobby }: { lobby: Lobby }) {
  const { t } = useTranslation()
  return (
    <MetaLine>
      <MetaTitle>{t('lobbies.inviteCard.title', 'Lobby')}</MetaTitle>
      <MetaText>
        {lobby.map.name} · {gameTypeToLabel(lobby.gameType, t)}
      </MetaText>
      <LifecycleChip lobby={lobby} />
    </MetaLine>
  )
}

function LifecycleChip({ lobby }: { lobby: Lobby }) {
  const { t } = useTranslation()
  if (lobby.lifecycle === 'inGame') {
    return <StatusChip $kind='inGame'>{t('lobbies.lobby.inGame', 'In game')}</StatusChip>
  }
  if (isLaunchingLifecycle(lobby.lifecycle)) {
    return (
      <StatusChip $kind='starting'>{t('lobbies.summary.startingGame', 'Starting game')}</StatusChip>
    )
  }
  return null
}

const HostLineRoot = styled.div`
  ${bodyLarge};
  ${backdropTextShadow};
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 0.3em;
  white-space: nowrap;

  color: var(--theme-on-surface-variant);
`

const HostName = styled(ConnectedUsername)`
  ${titleMedium};
  ${singleLine};
  min-width: 0;
  color: var(--theme-on-surface);
`

function HostLine({ summary }: { summary: LobbySummaryResponse }) {
  const { t } = useTranslation()
  return (
    <HostLineRoot>
      <Trans t={t} i18nKey='lobbies.inviteCard.hostedBy'>
        Hosted by <HostName userId={summary.host.id} showTooltipForOverflow='top' />
      </Trans>
    </HostLineRoot>
  )
}

const LobbyName = styled.div`
  ${headlineMedium};
  margin-top: 12px;
  ${singleLine};
  ${backdropTextShadow};
  min-width: 0;
  color: var(--theme-on-surface);
`

const SeatsLine = styled.div`
  ${bodyMedium};
  ${backdropTextShadow};
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 12px;

  color: var(--theme-on-surface-variant);
`

function Seats({ lobby }: { lobby: Lobby }) {
  return (
    <SeatsLine>
      <LobbySeats playerSlots={lobby.playerSlots} lifecycle={lobby.lifecycle} layout='grid' />
    </SeatsLine>
  )
}

function JoinButton({ isJoining, onJoinClick }: { isJoining: boolean; onJoinClick: () => void }) {
  const { t } = useTranslation()
  // NOTE: The button stays enabled even if the summary reports 0 open slots — the summary is a
  // snapshot, so fullness may have changed since it loaded. The server arbitrates on click, and a
  // still-full lobby gets a specific error message from the join attempt.
  return (
    <FilledButton
      label={t('lobbies.joinLobby.action', 'Join lobby')}
      iconStart={<MaterialIcon icon='login' />}
      onClick={onJoinClick}
      disabled={isJoining}
      testName='join-lobby-button'
    />
  )
}

const MAP_SIZE = 256

const PreviewRoot = styled.div`
  position: relative;
  width: 100%;
  max-width: 800px;
  overflow: hidden;
  isolation: isolate;
  padding: 24px;

  display: flex;
  gap: 28px;

  background-color: var(--theme-container-low);
  border: 1px solid var(--theme-outline-variant);
  border-radius: 12px;
`

const MapImage = styled.img`
  width: ${MAP_SIZE}px;
  height: ${MAP_SIZE}px;
  flex-shrink: 0;

  object-fit: cover;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.5);
`

const MapImagePlaceholder = styled.div`
  width: ${MAP_SIZE}px;
  height: ${MAP_SIZE}px;
  flex-shrink: 0;
  border-radius: 8px;
  background-color: var(--theme-container);
`

const Info = styled.div`
  min-width: 0;
  flex-grow: 1;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const Foot = styled.div`
  margin-top: auto;

  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
`

interface JoinPreviewProps {
  summary: LobbySummaryResponse
  isJoining: boolean
  onJoinClick: () => void
}

/**
 * A loaded lobby's join preview: what the lobby is, who hosts it, how full it is, and the button
 * that joins it, beside an image of its map (and over the same image, blurred).
 */
export function JoinPreview({ summary, isJoining, onJoinClick }: JoinPreviewProps) {
  const dispatch = useAppDispatch()
  const lobby = summary.summary
  const host = summary.host
  const image = lobby.map.image512Url ?? lobby.map.image256Url

  useEffect(() => {
    // The summary carries the host's user info, so their name renders without a lookup of its own.
    dispatch({ type: '@users/loadUsers', payload: [host] })
  }, [dispatch, host])

  return (
    <PreviewRoot>
      {image ? <BackdropImage src={image} alt='' draggable={false} /> : null}
      <Scrim />
      {image ? (
        <MapImage src={image} alt={lobby.map.name} draggable={false} />
      ) : (
        <MapImagePlaceholder />
      )}
      <Info>
        <LobbyMeta lobby={lobby} />
        <LobbyName>{lobby.name}</LobbyName>
        <HostLine summary={summary} />
        <Foot>
          <Seats lobby={lobby} />
          <JoinButton isJoining={isJoining} onJoinClick={onJoinClick} />
        </Foot>
      </Info>
    </PreviewRoot>
  )
}
