import { ReactNode } from 'react'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfPermissions } from '../auth/auth-utils'
import { graphql } from '../gql'
import { longTimestamp } from '../i18n/date-formats'
import { logger } from '../logging/logger'
import { TextButton } from '../material/button'
import { LoadingDotsArea } from '../progress/dots'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium, singleLine, TitleLarge, titleSmall } from '../styles/typography'

const BlockedStreamsQuery = graphql(/* GraphQL */ `
  query AdminBlockedStreams {
    blockedStreams {
      createdAt
      twitchLogin
      twitchDisplayName
      user {
        id
        name
      }
      blockedBy {
        id
        name
      }
    }
  }
`)

const AdminUnblockStreamMutation = graphql(/* GraphQL */ `
  mutation AdminUnblockStream($userId: SbUserId!) {
    unblockStream(userId: $userId)
  }
`)

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 700px;
  padding: 16px;
`

const SectionDescription = styled.div`
  ${bodyLarge};
  max-width: 600px;
  color: var(--theme-on-surface-variant);
`

const LoadingError = styled.div`
  ${bodyLarge};
  margin-top: 40px;
`

const EmptyText = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
`

const BlockList = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const BlockRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;

  & + & {
    border-top: 1px solid var(--theme-outline-variant);
  }
`

const BlockInfo = styled.div`
  min-width: 0;
  flex: 1;
`

const Name = styled.div`
  ${titleSmall};
  ${singleLine};
`

const Handle = styled.div`
  ${bodyMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const Meta = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

export function AdminLiveStreams() {
  const selfPermissions = useSelfPermissions()
  const snackbarController = useSnackbarController()
  const [{ data, error }, reexecuteQuery] = useQuery({ query: BlockedStreamsQuery })
  const [{ fetching: unblocking }, unblockStream] = useMutation(AdminUnblockStreamMutation)

  if (!selfPermissions?.manageLiveStreams) {
    return <LoadingError>Access denied.</LoadingError>
  }

  const blocked = data?.blockedStreams

  const onUnblock = (userId: SbUserId, name: string) => {
    unblockStream({ userId })
      .then(result => {
        if (result.error) {
          snackbarController.showSnackbar(`Couldn't unblock ${name}`)
          return
        }
        snackbarController.showSnackbar(`${name} can appear in the live streams feed again`)
        reexecuteQuery({ requestPolicy: 'network-only' })
      })
      .catch(err => logger.error(`Error unblocking stream: ${err.stack ?? err}`))
  }

  let content: ReactNode
  if (error) {
    content = (
      <LoadingError>There was a problem loading blocked streamers: {error.message}</LoadingError>
    )
  } else if (blocked === undefined) {
    content = <LoadingDotsArea />
  } else if (blocked.length === 0) {
    content = <EmptyText>No streamers are blocked from the live streams feed.</EmptyText>
  } else {
    content = (
      <BlockList>
        {blocked.map(entry => {
          const name = entry.user?.name ?? entry.twitchDisplayName ?? 'Unknown user'
          const key = entry.user?.id ?? entry.twitchLogin ?? name
          return (
            <BlockRow key={key}>
              <BlockInfo>
                <Name>{name}</Name>
                {entry.twitchLogin ? <Handle>twitch.tv/{entry.twitchLogin}</Handle> : null}
                <Meta>
                  Blocked {longTimestamp.format(new Date(entry.createdAt))}
                  {entry.blockedBy ? ` by ${entry.blockedBy.name}` : ''}
                </Meta>
              </BlockInfo>
              <TextButton
                label='Unblock'
                onClick={() => entry.user && onUnblock(entry.user.id, name)}
                disabled={unblocking || !entry.user}
              />
            </BlockRow>
          )
        })}
      </BlockList>
    )
  }

  return (
    <Root>
      <TitleLarge>Live stream feed blocks</TitleLarge>
      <SectionDescription>
        Streamers listed here are hidden from the live streams feed (both on the home page and the
        dedicated live streams page). Their live status is still shown everywhere else (their
        profile, the "live" avatar ring, friend notifications). Unblock a streamer to let them
        appear in the feed again.
      </SectionDescription>

      {content}
    </Root>
  )
}
