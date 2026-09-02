import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation } from 'urql'
import { SbUserId } from '../../common/users/sb-user-id'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { graphql } from '../gql'
import { MaterialIcon } from '../icons/material/material-icon'
import { logger } from '../logging/logger'
import { IconButton } from '../material/button'
import { DestructiveMenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { useAppDispatch } from '../redux-hooks'
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

/** Whether the current user can moderate the live-streams feed (home page and the /live page). */
function useCanModerateLiveStreams() {
  return useHasAnyPermission('manageLiveStreams')
}

/**
 * Wraps a feed entry so the control can overlay it. Exported so each entry variant can keep its own
 * `:hover` styling while the pointer is over the control: the control is a sibling of the entry link
 * (nesting a button inside the link isn't allowed), so hovering it would otherwise drop the entry's
 * own `:hover`. Entries key their hover styles off `${ModerationContainer}:hover` to avoid that.
 */
export const ModerationContainer = styled.div`
  position: relative;

  &:hover [data-live-stream-moderation] {
    opacity: 1;
    pointer-events: auto;
  }
`

/**
 * Where the moderation control sits over an entry. The feed's thumbnails pack every corner with
 * pills, so the placement depends on the entry variant: `top-right` uses the compact row's free
 * corner, while `below-top-pills` drops the control clear of the hero card's live/viewer pills.
 */
type LiveStreamModerationPlacement = 'top-right' | 'below-top-pills'

// A dark, circular backdrop so the control stays legible over any thumbnail. Hidden until the entry
// is hovered, its menu is open, or the control is focused for keyboard users, so it doesn't clutter
// the feed.
const OverlayRoot = styled.div<{
  $placement: LiveStreamModerationPlacement
  $menuOpen: boolean
}>`
  position: absolute;
  /*
    Offsets are measured from the entry wrapper. The hero card pads its thumbnail, so
    'below-top-pills' insets to sit inside that padding: it drops below the hero's live/viewer pills
    and lines its right edge up with them, staying clear of the thumbnail's hover outline. The
    compact row has no such padding or outline, so its control tucks into the free top-right corner.
  */
  top: ${props => (props.$placement === 'below-top-pills' ? '44px' : '6px')};
  right: ${props => (props.$placement === 'below-top-pills' ? '18px' : '6px')};
  z-index: 1;
  display: flex;

  border-radius: 50%;
  background-color: rgb(0 0 0 / 72%);

  opacity: ${props => (props.$menuOpen ? 1 : 0)};
  /*
    Hidden until revealed, so a blind tap on the invisible control can't open the moderation menu (or
    swallow the entry's link) on touch input; re-enabled together with each reveal below. Also forced
    open while its menu is open: the menu renders in a portal outside this container, so once the
    pointer travels from the trigger into the menu it's no longer hovering the moderation container,
    and hover-based reveal alone would fade the trigger out from under its own open menu.
  */
  pointer-events: ${props => (props.$menuOpen ? 'auto' : 'none')};
  transition: opacity 75ms linear;

  &:focus-within {
    opacity: 1;
    pointer-events: auto;
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
 * Wraps a live-stream feed entry, overlaying an admin-only moderation menu for users with the
 * `manageLiveStreams` permission. The menu's "Remove from live streams" item asks for confirmation,
 * then applies a durable block on the streamer (they stay hidden from the feed until unblocked);
 * the resulting snackbar offers an immediate undo. For everyone else this renders `children`
 * unchanged, with no extra wrapper.
 */
export function LiveStreamModeration({
  userId,
  name,
  placement = 'top-right',
  children,
}: {
  userId: SbUserId
  name: string
  /** Where the control sits over the entry; defaults to the compact row's free top-right corner. */
  placement?: LiveStreamModerationPlacement
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const canModerate = useCanModerateLiveStreams()
  const snackbarController = useSnackbarController()
  const [{ fetching }, blockStream] = useMutation(BlockStreamMutation)
  const [, unblockStream] = useMutation(UnblockStreamMutation)
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [menuOpen, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  if (!canModerate) {
    return <>{children}</>
  }

  const onUndo = () => {
    unblockStream({ userId })
      .then(result => {
        if (result.error) {
          snackbarController.showSnackbar(
            t('twitch.moderation.unblockError', {
              defaultValue: "Couldn't restore {{name}} to the live streams feed",
              name,
            }),
          )
          return
        }
      })
      .catch(err => logger.error(`Error undoing stream block: ${err.stack ?? err}`))
  }

  const onRemoveClick = () => {
    closeMenu()
    dispatch(
      openDialog({
        type: DialogType.TwitchRemoveLiveStreamConfirmation,
        initData: { name, onConfirm: onRemoveConfirmed },
      }),
    )
  }

  const onRemoveConfirmed = () => {
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

  const menuLabel = t('twitch.moderation.menuTooltip', 'Stream moderation')
  const removeLabel = t('twitch.moderation.removeTooltip', 'Remove from live streams')

  return (
    <ModerationContainer>
      {children}
      <OverlayRoot data-live-stream-moderation={true} $placement={placement} $menuOpen={menuOpen}>
        <OverlayButton
          ref={anchorRef}
          icon={<MaterialIcon icon='more_vert' size={18} />}
          title={menuLabel}
          ariaLabel={menuLabel}
          onClick={openMenu}
          disabled={fetching}
          testName='live-stream-moderation-menu'
        />
      </OverlayRoot>
      <Popover
        open={menuOpen}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='top'>
        <MenuList>
          <DestructiveMenuItem
            text={removeLabel}
            onClick={onRemoveClick}
            disabled={fetching}
            testName='remove-live-stream'
          />
        </MenuList>
      </Popover>
    </ModerationContainer>
  )
}
