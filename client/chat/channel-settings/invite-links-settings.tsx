import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  BasicChannelInfo,
  ChannelInviteLinkJson,
  DetailedChannelInfo,
  JoinedChannelInfo,
  SbChannelId,
} from '../../../common/chat'
import { ConnectedAvatar } from '../../avatars/avatar'
import { useFormatLocale } from '../../i18n/locale-formats'
import InfiniteScrollList from '../../lists/infinite-scroll-list'
import { TextButton } from '../../material/button'
import { useAppDispatch } from '../../redux-hooks'
import { ErrorText } from '../../settings/settings-content'
import { useSnackbarController } from '../../snackbars/snackbar-overlay'
import { listChannelInviteLinks, revokeChannelInviteLink } from '../action-creators'
import {
  describeInviteLinkCreated,
  describeInviteLinkExpiry,
  describeInviteLinkUses,
} from '../invite-link-text'
import {
  UserListCardActions,
  UserListCardInfo,
  UserListCardRow,
  UserListCardSubtitle,
  UserListCardUsername,
  UserListNoResults,
  UserListRoot,
  UserListSearchInput,
  UserListSearchResults,
  useSearchableUserList,
} from './user-list'

const LinkCardContent = styled.div`
  position: relative;
  flex-grow: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  text-align: left;
`

const StyledAvatar = styled(ConnectedAvatar)`
  width: 40px;
  height: 40px;
  flex-shrink: 0;
`

interface LoadedInviteLink {
  inviteLink: ChannelInviteLinkJson
  /** When the link was loaded, which its created and expiry times are described relative to. */
  loadedAt: number
}

/**
 * Lists a private channel's working invite links, searchable by who created them, and lets the
 * viewer revoke any of them.
 */
export function InviteLinksSettings({
  basicChannelInfo,
}: {
  basicChannelInfo: BasicChannelInfo
  detailedChannelInfo: DetailedChannelInfo
  joinedChannelInfo: JoinedChannelInfo
  onCloseSettings: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const {
    entries: inviteLinks,
    setEntries: setInviteLinks,
    hasMore,
    isLoadingMore,
    searchError,
    searchQuery,
    refreshToken,
    onSearchChange,
    onLoadMore,
  } = useSearchableUserList<LoadedInviteLink>({
    loadPage: ({ searchQuery: query, offset, signal, onSuccess, onError }) => {
      dispatch(
        listChannelInviteLinks(basicChannelInfo.id, query, offset, {
          signal,
          onSuccess: data => {
            const loadedAt = Date.now()
            onSuccess({
              entries: data.inviteLinks.map(inviteLink => ({ inviteLink, loadedAt })),
              hasMore: data.hasMoreInviteLinks,
            })
          },
          onError,
        }),
      )
    },
    getEntryKey: entry => entry.inviteLink.token,
  })

  const onRevoked = (token: string) => {
    setInviteLinks(prev => prev?.filter(l => l.inviteLink.token !== token))
  }

  let content
  if (searchError) {
    content = (
      <UserListSearchResults>
        <ErrorText>
          {t('chat.channelSettings.inviteLinks.loadError', 'Failed to load invite links.')}
        </ErrorText>
      </UserListSearchResults>
    )
  } else if (inviteLinks?.length === 0 && !hasMore) {
    // Revoked links get removed from the loaded list locally, so an emptied page must keep the
    // scroll list (and its load-more trigger) mounted while the server still has more to show.
    content = (
      <UserListSearchResults>
        <UserListNoResults>
          {searchQuery
            ? t(
                'chat.channelSettings.inviteLinks.noSearchResults',
                'No invite links were created by a matching user',
              )
            : t(
                'chat.channelSettings.inviteLinks.noLinks',
                'This channel has no working invite links',
              )}
        </UserListNoResults>
      </UserListSearchResults>
    )
  } else {
    content = (
      <InfiniteScrollList
        nextLoadingEnabled={true}
        isLoadingNext={isLoadingMore}
        hasNextData={hasMore}
        refreshToken={refreshToken}
        onLoadNextData={onLoadMore}>
        <UserListSearchResults>
          {(inviteLinks ?? []).map(entry => (
            <InviteLinkRow
              key={entry.inviteLink.token}
              entry={entry}
              channelId={basicChannelInfo.id}
              onRevoked={onRevoked}
            />
          ))}
        </UserListSearchResults>
      </InfiniteScrollList>
    )
  }

  return (
    <UserListRoot data-testid='invite-links-settings'>
      <UserListSearchInput searchQuery={searchQuery} onSearchChange={onSearchChange} />

      {content}
    </UserListRoot>
  )
}

function InviteLinkRow({
  entry: { inviteLink, loadedAt },
  channelId,
  onRevoked,
}: {
  entry: LoadedInviteLink
  channelId: SbChannelId
  onRevoked: (token: string) => void
}) {
  const { t } = useTranslation()
  const locale = useFormatLocale()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const [isRevoking, setIsRevoking] = useState(false)

  const onRevokeClick = () => {
    setIsRevoking(true)
    dispatch(
      revokeChannelInviteLink(channelId, inviteLink.token, {
        onSuccess: () => {
          snackbarController.showSnackbar(
            t('chat.channelSettings.inviteLinks.revoked', 'Invite link revoked'),
          )
          onRevoked(inviteLink.token)
        },
        onError: () => {
          setIsRevoking(false)
          snackbarController.showSnackbar(
            t(
              'chat.channelSettings.inviteLinks.revokeError',
              'Something went wrong revoking the invite link',
            ),
          )
        },
      }),
    )
  }

  return (
    <UserListCardRow data-testid='invite-link-row'>
      <LinkCardContent>
        <StyledAvatar userId={inviteLink.createdBy} />

        <UserListCardInfo>
          <UserListCardUsername userId={inviteLink.createdBy} interactive={false} />
          <UserListCardSubtitle>
            {describeInviteLinkCreated(inviteLink, loadedAt, locale, t)}
          </UserListCardSubtitle>
          <UserListCardSubtitle>
            {`${describeInviteLinkUses(inviteLink, t)} · ${describeInviteLinkExpiry(inviteLink, loadedAt, locale, t)}`}
          </UserListCardSubtitle>
        </UserListCardInfo>
      </LinkCardContent>

      <UserListCardActions>
        <TextButton
          label={t('chat.channelSettings.inviteLinks.revoke', 'Revoke')}
          disabled={isRevoking}
          onClick={onRevokeClick}
          testName='invite-link-revoke-button'
        />
      </UserListCardActions>
    </UserListCardRow>
  )
}
