import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { Lobby } from '../../../common/lobbies'
import { urlForLobby } from '../../../common/lobbies/lobby-url'
import { SbUserId } from '../../../common/users/sb-user-id'
import { OutlinedButton, TextButton } from '../../material/button'
import { useLinkCopier } from '../../navigation/copy-link-button'
import { getServerOrigin } from '../../network/server-url'
import { useAppSelector } from '../../redux-hooks'
import { titleLarge } from '../../styles/typography'
import { RoomChip, useLobbyLifecycle } from './room-parts'

const HeaderRoot = styled.div`
  padding: 12px 16px;

  display: flex;
  flex-wrap: wrap;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;

  border-bottom: 1px solid var(--theme-outline-variant);
`

const NameRow = styled.div`
  flex: 1 1 240px;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 12px;

  & > ${RoomChip} {
    flex-shrink: 0;
  }
`

const LobbyName = styled.div`
  ${titleLarge};
  min-width: 0;
  overflow-wrap: anywhere;
`

const HeaderActions = styled.div`
  max-width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;

  & > button {
    flex-shrink: 0;
  }
`

/** A button that copies the link that lets someone else into this lobby. */
function CopyInviteLinkButton({ lobby }: { lobby: Lobby }) {
  const { t } = useTranslation()
  const [copied, copyLink] = useLinkCopier(
    () => getServerOrigin() + urlForLobby(lobby.id, lobby.name),
  )

  return (
    <TextButton
      label={
        copied
          ? t('lobbies.room.header.copiedInviteLink', 'Copied!')
          : t('lobbies.room.header.copyInviteLink', 'Copy invite link')
      }
      iconStart='link'
      onClick={copyLink}
      testName='copy-invite-link-button'
    />
  )
}

/**
 * The strip across the top of the room: who and what this lobby is on the left, and the host's
 * setup and the way out on the right.
 *
 * Leave sits at the far right edge so it stays put whether or not the host's setup button is
 * beside it. That button stays in place, disabled, once the lobby is past gathering, since a
 * countdown can begin just as the host goes to click it.
 */
export function RoomHeader({
  viewerId,
  onOpenGameSetup,
  onLeaveLobby,
}: {
  viewerId: SbUserId
  onOpenGameSetup: () => void
  onLeaveLobby: () => void
}) {
  const { t } = useTranslation()
  const lobby = useAppSelector(s => s.lobby.info)

  const isHost = lobby.host.userId === viewerId
  // A countdown snapshots what the lobby is about to play, so from then until the game is over
  // there's nothing left to change about the setup.
  const isGathering = useLobbyLifecycle() === 'gathering'

  return (
    <HeaderRoot>
      <NameRow>
        <LobbyName>{lobby.name}</LobbyName>
        <RoomChip>
          {lobby.visibility === 'unlisted'
            ? t('lobbies.room.header.visibilityUnlisted', 'Unlisted')
            : t('lobbies.room.header.visibilityPublic', 'Public')}
        </RoomChip>
      </NameRow>

      <HeaderActions>
        <CopyInviteLinkButton lobby={lobby} />
        {isHost ? (
          <OutlinedButton
            label={t('lobbies.gameSetup.title', 'Game setup')}
            iconStart='tune'
            disabled={!isGathering}
            onClick={onOpenGameSetup}
            testName='lobby-settings-button'
          />
        ) : null}
        <TextButton
          label={t('lobbies.room.header.leave', 'Leave')}
          iconStart='logout'
          onClick={onLeaveLobby}
          testName='leave-lobby-button'
        />
      </HeaderActions>
    </HeaderRoot>
  )
}
