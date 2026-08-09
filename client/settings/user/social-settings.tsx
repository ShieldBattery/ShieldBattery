import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MAX_BLOCKS } from '../../../common/users/relationships'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ConnectedAvatar } from '../../avatars/avatar'
import { MaterialIcon } from '../../icons/material/material-icon'
import { IconButton } from '../../material/button'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { useSnackbarController } from '../../snackbars/snackbar-overlay'
import { unblockUser } from '../../social/action-creators'
import { useRelationshipsLoader } from '../../social/friends-list'
import { userRelationshipErrorToString } from '../../social/relationship-errors'
import { bodyLarge, labelLarge, singleLine, titleLarge, titleSmall } from '../../styles/typography'
import { areUserEntriesEqual, useUserEntriesSelector } from '../../users/user-entries'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const SectionHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
`

const HeaderTitle = styled.div`
  ${titleLarge};
`

const BlockCount = styled.div`
  ${labelLarge};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const Description = styled.div`
  ${bodyLarge};
  margin-bottom: 8px;
  color: var(--theme-on-surface-variant);
`

const BlockList = styled.div`
  display: flex;
  flex-direction: column;
`

const EmptyList = styled.div`
  ${bodyLarge};
  padding: 32px 0 48px;

  color: var(--theme-on-surface-variant);
  text-align: center;
`

const BlockedUserRoot = styled.div`
  height: 56px;
  padding: 4px 8px;

  display: flex;
  align-items: center;
  gap: 16px;

  border-radius: 4px;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }
`

const StyledAvatar = styled(ConnectedAvatar)`
  width: 40px;
  height: 40px;
  flex-shrink: 0;
`

const BlockedUserName = styled.div`
  ${titleSmall};
  ${singleLine};
  flex-grow: 1;
`

const LoadingName = styled.div`
  flex-grow: 1;
  max-width: 96px;
  height: 20px;

  background-color: var(--theme-skeleton);
  border-radius: 4px;
`

export function UserSocialSettings() {
  const { t } = useTranslation()
  useRelationshipsLoader()

  const blocks = useAppSelector(s => s.relationships.blocks)
  const blockedEntries = useAppSelector(useUserEntriesSelector(blocks), areUserEntriesEqual)

  return (
    <Root>
      <SectionHeader>
        <HeaderTitle>{t('settings.user.social.blockedUsers.title', 'Blocked users')}</HeaderTitle>
        <BlockCount>
          {t('settings.user.social.blockedUsers.count', {
            defaultValue: '{{blocked}} / {{max}}',
            blocked: blocks.size,
            max: MAX_BLOCKS,
          })}
        </BlockCount>
      </SectionHeader>
      <Description>
        {t(
          'settings.user.social.blockedUsers.description',
          "You won't see messages from blocked users in chat or in games, and they can't send you " +
            'friend requests.',
        )}
      </Description>
      {blockedEntries.length === 0 ? (
        <EmptyList>
          {t('settings.user.social.blockedUsers.empty', "You haven't blocked anyone.")}
        </EmptyList>
      ) : (
        <BlockList>
          {blockedEntries.map(([userId, username]) => (
            <BlockedUserEntry key={userId} userId={userId} username={username} />
          ))}
        </BlockList>
      )}
    </Root>
  )
}

function BlockedUserEntry({ userId, username }: { userId: SbUserId; username?: string }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()

  return (
    <BlockedUserRoot>
      <StyledAvatar userId={userId} />
      {username ? (
        <BlockedUserName>{username}</BlockedUserName>
      ) : (
        <LoadingName aria-label={t('common.loading.username', 'Username loading…')} />
      )}
      <IconButton
        icon={<MaterialIcon icon='person_remove' />}
        title={t('common.actions.unblock', 'Unblock')}
        onClick={() => {
          dispatch(
            unblockUser(userId, {
              onSuccess: () => {
                snackbarController.showSnackbar(
                  t('users.contextMenu.userUnblocked', 'User unblocked'),
                )
              },
              onError: err => {
                snackbarController.showSnackbar(
                  userRelationshipErrorToString(
                    err,
                    t('users.errors.friendsList.errorUnblockingUser', 'Error unblocking user'),
                    t,
                  ),
                )
              },
            }),
          )
        }}
      />
    </BlockedUserRoot>
  )
}
