import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation } from 'urql'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { urlPath } from '../../common/urls'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { DestructiveMenuItem, MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { push } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { NewsDeletePostMutation, NewsUpdatePostMutation } from './news-post-mutations'
import { PostStatus } from './news-post-status'
import { urlForNewsPostEditor } from './news-url'

const StyledIconButton = styled(IconButton)`
  color: var(--theme-on-surface-variant);

  &:hover {
    color: var(--theme-amber);
  }
`

/**
 * The editor's management menu for a news post, rendered on the post's public page beside the
 * copy-link button. Callers render it only for users with the `manageNews` permission; the server
 * guards the underlying mutations regardless.
 */
export function NewsPostAdminMenu({
  postId,
  postTitle,
  status,
  onPublishStateChanged,
  className,
}: {
  postId: string
  postTitle: string
  status: PostStatus
  /** Called after a publish/unpublish mutation succeeds. */
  onPublishStateChanged: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'bottom')
  const [menuOpen, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  const [{ fetching: updating }, updatePost] = useMutation(NewsUpdatePostMutation)
  const [{ fetching: deleting }, deletePostMutation] = useMutation(NewsDeletePostMutation)
  const mutating = updating || deleting

  const setPublishedAt = (publishedAt: string | null) => {
    updatePost({ id: postId, updates: { publishedAt } })
      .then(result => {
        if (result.error) {
          snackbarController.showSnackbar(
            `${t('admin.news.updateError', 'Error updating post:')} ${result.error.message}`,
          )
        } else {
          onPublishStateChanged()
        }
      })
      .catch(swallowNonBuiltins)
  }

  const deletePost = () => {
    deletePostMutation({ id: postId })
      .then(result => {
        if (result.error) {
          snackbarController.showSnackbar(
            `${t('admin.news.deleteError', 'Error deleting post:')} ${result.error.message}`,
          )
        } else {
          snackbarController.showSnackbar(t('news.postDeleted', 'News post deleted'))
          push('/admin/news')
        }
      })
      .catch(swallowNonBuiltins)
  }

  return (
    <>
      <StyledIconButton
        ref={anchorRef}
        icon={<MaterialIcon icon='more_vert' />}
        title={t('news.adminActions', 'Admin actions')}
        ariaLabel={t('news.adminActions', 'Admin actions')}
        ariaHasPopup='menu'
        ariaExpanded={menuOpen}
        testName='news-post-admin-menu'
        disabled={mutating}
        className={className}
        onClick={openMenu}
      />
      <Popover
        open={menuOpen}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='top'>
        <MenuList>
          <MenuItem
            icon={<MaterialIcon icon='edit' />}
            text={t('admin.news.action.edit', 'Edit')}
            onClick={() => {
              closeMenu()
              push(urlForNewsPostEditor(postId, { returnToPost: true }))
            }}
          />
          <MenuItem
            icon={<MaterialIcon icon='history' />}
            text={t('admin.news.action.history', 'Edit history')}
            onClick={() => {
              closeMenu()
              push(urlPath`/admin/news/${postId}/history`)
            }}
          />
          {status.kind !== 'published' ? (
            <MenuItem
              icon={<MaterialIcon icon='publish' />}
              text={t('admin.news.action.publishNow', 'Publish now')}
              onClick={() => {
                closeMenu()
                setPublishedAt(new Date().toISOString())
              }}
            />
          ) : null}
          {status.kind !== 'draft' ? (
            <MenuItem
              icon={<MaterialIcon icon='unpublished' />}
              text={t('admin.news.action.unpublish', 'Unpublish')}
              onClick={() => {
                closeMenu()
                setPublishedAt(null)
              }}
            />
          ) : null}
          <DestructiveMenuItem
            icon={<MaterialIcon icon='delete' />}
            text={t('admin.news.action.delete', 'Delete')}
            onClick={() => {
              closeMenu()
              dispatch(
                openDialog({
                  type: DialogType.NewsPostDeleteConfirmation,
                  initData: { title: postTitle, onConfirm: deletePost },
                }),
              )
            }}
          />
        </MenuList>
      </Popover>
    </>
  )
}
