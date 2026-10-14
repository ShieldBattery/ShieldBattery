import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { useAppSelector } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { ConversationRail } from './conversation-rail'
import { NewWhisper } from './new-whisper'
import { ConnectedWhisper } from './whisper'

const Root = styled(CenteredContentContainer)`
  /*
    Named container so the rail can collapse based on the space the page actually gets, which
    depends on the window size *and* the social sidebar, rather than the viewport.
  */
  container: whispers-page / inline-size;

  display: flex;
  gap: 24px;

  /* Each column scrolls on its own; the page itself never does. */
  overflow-y: hidden;
`

/**
 * Every whisper conversation the user has had down the side, with either the selected conversation
 * or (with no target) the picker for starting a new one beside it.
 */
export function WhispersPage({
  targetId,
  targetUsername,
}: {
  targetId?: SbUserId
  targetUsername?: string
}) {
  const isConnected = useAppSelector(s => s.network.isConnected)

  return (
    <Root $fullWidth={true} data-content-fullbleed=''>
      {/*
        Reconnecting clears the conversations the client knows of, so the rail starts its paging
        over rather than carrying on from where it was.
      */}
      <ConversationRail key={String(isConnected)} selectedTarget={targetId} />
      {targetId !== undefined ? (
        <ConnectedWhisper targetId={targetId} targetUsername={targetUsername} />
      ) : (
        <NewWhisper />
      )}
    </Root>
  )
}
