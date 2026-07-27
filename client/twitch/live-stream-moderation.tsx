import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation } from 'urql'
import { SbUserId } from '../../common/users/sb-user-id'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { graphql } from '../gql'
import { MaterialIcon } from '../icons/material/material-icon'
import { logger } from '../logging/logger'
import { IconButton } from '../material/button'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { useSnackbarController } from '../snackbars/snackbar-overlay'

const BlockStreamMutation = graphql(/* GraphQL */ `
  mutation BlockStream($userId: SbUserId!) {
    blockStream(userId: $userId)
  }
`)

const UnblockStreamMutation = graphql(/* GraphQL */ `
  mutation UnblockStream($userId: SbUserId!) {
    unblockStream(userId: $userId)
  }
`)

/** Whether the current user can moderate the home-page live-streams feed. */
export function useCanModerateLiveStreams() {
  return useHasAnyPermission('manageLiveStreams')
}

const Container = styled.div`
  position: relative;

  &:hover [data-live-stream-moderation] {
    opacity: 1;
  }
`

// A dark, circular backdrop so the control stays legible over any thumbnail. Hidden until the entry
// is hovered (or the control is focused for keyboard users), so it doesn't clutter the feed.
const OverlayRoot = styled.div`
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 1;
  display: flex;

  border-radius: 50%;
  background-color: rgb(0 0 0 / 72%);

  opacity: 0;
  transition: opacity 75ms linear;

  &:focus-within {
    opacity: 1;
  }
`

const OverlayButton = styled(IconButton)`
  width: 32px;
  min-height: 32px;
  border-radius: 50%;
  color: var(--theme-on-surface);

  &:hover {
    color: var(--theme-on-surface);
    background-color: rgb(255 255 255 / 8%);
  }
`

/**
 * Wraps a live-stream feed entry, overlaying an admin-only "remove from feed" control for users with
 * the `manageLiveStreams` permission. Removing is a durable block on the streamer (they stay hidden
 * from the feed until unblocked); the snackbar offers an immediate undo. For everyone else this
 * renders `children` unchanged, with no extra wrapper.
 */
export function LiveStreamModeration({
  userId,
  name,
  onModerated,
  children,
}: {
  userId: SbUserId
  name: string
  /** Called after a successful block/unblock so the feed can refetch and reflect the change. */
  onModerated?: () => void
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const canModerate = useCanModerateLiveStreams()
  const snackbarController = useSnackbarController()
  const [{ fetching }, blockStream] = useMutation(BlockStreamMutation)
  const [, unblockStream] = useMutation(UnblockStreamMutation)

  if (!canModerate) {
    return <>{children}</>
  }

  const onUndo = () => {
    unblockStream({ userId })
      .then(result => {
        if (!result.error) {
          onModerated?.()
        }
      })
      .catch(err => logger.error(`Error undoing stream block: ${err.stack ?? err}`))
  }

  const onRemove = () => {
    blockStream({ userId })
      .then(result => {
        if (result.error) {
          snackbarController.showSnackbar(
            t('twitch.moderation.blockError', {
              defaultValue: "Couldn't remove {{name}} from the live streams feed",
              name,
            }),
          )
          return
        }

        onModerated?.()
        snackbarController.showSnackbar(
          t('twitch.moderation.blocked', {
            defaultValue: 'Removed {{name}} from the live streams feed',
            name,
          }),
          DURATION_LONG,
          { action: { label: t('common.actions.undo', 'Undo'), onClick: onUndo } },
        )
      })
      .catch(err => logger.error(`Error blocking stream: ${err.stack ?? err}`))
  }

  const removeLabel = t('twitch.moderation.removeTooltip', 'Remove from live streams')

  return (
    <Container>
      {children}
      <OverlayRoot data-live-stream-moderation={true}>
        <OverlayButton
          icon={<MaterialIcon icon='visibility_off' size={18} />}
          title={removeLabel}
          ariaLabel={removeLabel}
          onClick={onRemove}
          disabled={fetching}
          testName='remove-live-stream'
        />
      </OverlayRoot>
    </Container>
  )
}
