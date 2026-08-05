import { useAtomValue } from 'jotai'
import styled from 'styled-components'
import { findBenchedUser, Lobby } from '../../../common/lobbies'
import { urlForLobby } from '../../../common/lobbies/lobby-url'
import { SbUserId } from '../../../common/users/sb-user-id'
import { MaterialIcon } from '../../icons/material/material-icon'
import { FilledButton, OutlinedButton, TextButton } from '../../material/button'
import { useLinkCopier } from '../../navigation/copy-link-button'
import { getServerOrigin } from '../../network/server-url'
import { useAppSelector } from '../../redux-hooks'
import { titleLarge } from '../../styles/typography'
import { readyUsersAtom } from './room-atoms'
import { RoomChip } from './room-parts'

const HeaderRoot = styled.div`
  padding: 12px 16px;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;

  border-bottom: 1px solid var(--theme-outline-variant);
`

const NameRow = styled.div`
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;
`

const LobbyName = styled.div`
  ${titleLarge};
`

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
`

/** A button that copies the link that lets someone else into this lobby. */
function CopyInviteLinkButton({ lobby }: { lobby: Lobby }) {
  const [copied, copyLink] = useLinkCopier(
    () => getServerOrigin() + urlForLobby(lobby.id, lobby.name),
  )

  return (
    <TextButton
      label={copied ? 'Copied!' : 'Copy invite link'}
      iconStart={<MaterialIcon icon='link' />}
      onClick={copyLink}
    />
  )
}

/**
 * The viewer's own half of the ready check: a call to action until they answer it, and a way to
 * back out once they have. The button always names the action it performs — the viewer's own
 * ready state reads off their row's mark in the rail and the rail's "N of M ready" tally.
 */
function ReadyButton({
  isViewerReady,
  onToggleReady,
}: {
  isViewerReady: boolean
  onToggleReady: () => void
}) {
  return isViewerReady ? (
    <OutlinedButton label='Cancel ready' onClick={onToggleReady} />
  ) : (
    <FilledButton label='Ready up' onClick={onToggleReady} />
  )
}

/**
 * The strip across the top of the room: who and what this lobby is on the left, and the viewer's
 * own start-related action on the right.
 */
export function RoomHeader({
  viewerId,
  onOpenGameSetup,
  onToggleReady,
}: {
  viewerId: SbUserId
  onOpenGameSetup: () => void
  onToggleReady: () => void
}) {
  const lobby = useAppSelector(s => s.lobby.info)
  const readyUsers = useAtomValue(readyUsersAtom)

  const isHost = lobby.host.userId === viewerId
  const isBenched = !!findBenchedUser(lobby, viewerId)
  const isViewerReady = readyUsers.has(viewerId)

  return (
    <HeaderRoot>
      <NameRow>
        <LobbyName>{lobby.name}</LobbyName>
        <RoomChip>{lobby.visibility === 'unlisted' ? 'Unlisted' : 'Public'}</RoomChip>
        <CopyInviteLinkButton lobby={lobby} />
      </NameRow>

      <HeaderActions>
        {isHost ? (
          <OutlinedButton
            label='Game setup'
            iconStart={<MaterialIcon icon='tune' />}
            onClick={onOpenGameSetup}
          />
        ) : null}
        {!isBenched ? (
          <ReadyButton isViewerReady={isViewerReady} onToggleReady={onToggleReady} />
        ) : null}
      </HeaderActions>
    </HeaderRoot>
  )
}
