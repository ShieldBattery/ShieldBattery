import { ResultOf } from '@graphql-typed-document-node/core'
import { ChangeEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import { Route, Switch } from 'wouter'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getErrorStack } from '../../common/errors'
import { MAX_IMAGE_SIZE_BYTES } from '../../common/images'
import { NewsImageUploadResponse } from '../../common/news'
import { apiUrl, urlPath } from '../../common/urls'
import { useSelfUser } from '../auth/auth-utils'
import { useForm, useFormCallbacks, ValidatorMap } from '../forms/form-hook'
import { required } from '../forms/validators'
import { graphql } from '../gql'
import { NewsPostCreation, NewsPostUpdates } from '../gql/graphql'
import { longTimestamp } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { Markdown } from '../markdown/markdown'
import {
  applyMarkdownFormat,
  MarkdownFormatKind,
  MarkdownToolbar,
} from '../markdown/markdown-toolbar'
import { FilledButton, IconButton, OutlinedButton, TextButton } from '../material/button'
import { DateTimeTextField } from '../material/datetime-text-field'
import { DestructiveMenuItem, MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { RadioButton, RadioGroup } from '../material/radio'
import { TextField } from '../material/text-field'
import { push } from '../navigation/routing'
import { fetchJson } from '../network/fetch'
import { LoadingDotsArea } from '../progress/dots'
import { useNow } from '../react/date-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../styles/centered-container'
import { ContainerLevel, containerStyles } from '../styles/colors'
import {
  bodyLarge,
  bodyMedium,
  labelMedium,
  singleLine,
  titleLarge,
  titleMedium,
} from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'

const AdminNewsListQuery = graphql(/* GraphQL */ `
  query AdminNewsList($first: Int, $after: String) {
    newsPosts(includeUnpublished: true, first: $first, after: $after) {
      edges {
        node {
          id
          title
          summary
          publishedAt
          updatedAt
          author {
            id
            name
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`)

const AdminNewsPostQuery = graphql(/* GraphQL */ `
  query AdminNewsPost($id: UUID!) {
    newsPost(id: $id) {
      id
      title
      summary
      content
      publishedAt
      coverImagePath
      coverImageUrl
      author {
        id
        name
      }
    }
  }
`)

const AdminNewsHistoryQuery = graphql(/* GraphQL */ `
  query AdminNewsHistory($id: UUID!) {
    newsPost(id: $id) {
      id
      title
      edits {
        title
        summary
        content
        publishedAt
        coverImagePath
        editedAt
        editor {
          id
          name
        }
      }
    }
  }
`)

const NewsCreatePostMutation = graphql(/* GraphQL */ `
  mutation NewsCreatePost($post: NewsPostCreation!) {
    newsCreatePost(post: $post) {
      id
    }
  }
`)

const NewsUpdatePostMutation = graphql(/* GraphQL */ `
  mutation NewsUpdatePost($id: UUID!, $updates: NewsPostUpdates!) {
    newsUpdatePost(id: $id, updates: $updates) {
      id
      title
      summary
      content
      publishedAt
      updatedAt
      coverImagePath
      coverImageUrl
      coverImageSmallUrl
    }
  }
`)

const NewsDeletePostMutation = graphql(/* GraphQL */ `
  mutation NewsDeletePost($id: UUID!) {
    newsDeletePost(id: $id)
  }
`)

const PAGE_SIZE = 20

export const PUBLISH_MODE_DRAFT = 'draft'
export const PUBLISH_MODE_NOW = 'now'
export const PUBLISH_MODE_SCHEDULE = 'schedule'
type PublishMode =
  | typeof PUBLISH_MODE_DRAFT
  | typeof PUBLISH_MODE_NOW
  | typeof PUBLISH_MODE_SCHEDULE

type PostStatus =
  | { kind: 'draft' }
  | { kind: 'scheduled'; date: Date }
  | { kind: 'published'; date: Date }

/** Classifies a post's publish state given the current time (`now`, in millis). */
export function getPostStatus(publishedAt: string | null | undefined, now: number): PostStatus {
  if (!publishedAt) {
    return { kind: 'draft' }
  }
  const date = new Date(publishedAt)
  return date.getTime() > now ? { kind: 'scheduled', date } : { kind: 'published', date }
}

/** Formats a `Date` for a `datetime-local` input value (`YYYY-MM-DDTHH:mm`, local time). */
export function toDateTimeLocalString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

export function AdminNews() {
  return (
    <Switch>
      <Route path='/admin/news/new' component={AdminNewsCreate} />
      <Route path='/admin/news/:id/history' component={AdminNewsHistory} />
      <Route path='/admin/news/:id' component={AdminNewsEdit} />
      <Route component={AdminNewsList} />
    </Switch>
  )
}

const Root = styled.div`
  padding-block: 24px;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
`

const Title = styled.div`
  ${titleLarge};
`

const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const NotFoundText = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
`

const ListTable = styled.div`
  display: flex;
  flex-direction: column;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
`

const ListHeaderRow = styled.div`
  ${labelMedium};

  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;

  color: var(--theme-on-surface-variant);
  border-bottom: 1px solid var(--theme-outline-variant);
`

const RowRoot = styled.div`
  min-height: 60px;
  padding: 8px 12px;

  display: flex;
  align-items: center;
  gap: 16px;

  &:not(:last-child) {
    border-bottom: 1px solid var(--theme-outline-variant);
  }

  &:hover {
    background-color: rgba(255, 255, 255, 0.04);
  }
`

const TitleCell = styled.div`
  flex: 1 1 auto;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const TitleText = styled.div`
  ${titleMedium};
  ${singleLine};
`

const SummaryText = styled.div`
  ${bodyMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const StatusCell = styled.div`
  flex: 0 0 auto;
  width: 176px;
`

const AuthorCell = styled.div`
  ${bodyMedium};
  ${singleLine};
  flex: 0 0 auto;
  width: 148px;
`

const UpdatedCell = styled.div`
  ${bodyMedium};
  flex: 0 0 auto;
  width: 176px;
  color: var(--theme-on-surface-variant);
`

const ActionsCell = styled.div`
  flex: 0 0 auto;
  width: 48px;

  display: flex;
  align-items: center;
  justify-content: center;
`

const EmDash = styled.span`
  color: var(--theme-on-surface-variant);
`

const StatusCellRoot = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
`

const STATUS_COLORS: Record<PostStatus['kind'], string> = {
  draft: 'var(--theme-on-surface-variant)',
  scheduled: 'var(--theme-amber)',
  published: 'var(--theme-positive)',
}

const StatusChip = styled.div<{ $kind: PostStatus['kind'] }>`
  ${labelMedium};

  height: 22px;
  padding: 0 10px;

  display: inline-flex;
  align-items: center;

  border: 1px solid currentColor;
  border-radius: 11px;
  color: ${props => STATUS_COLORS[props.$kind]};
`

const StatusDate = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

function StatusDisplay({
  publishedAt,
  now,
}: {
  publishedAt: string | null | undefined
  now: number
}) {
  const { t } = useTranslation()
  const status = getPostStatus(publishedAt, now)

  let label: string
  switch (status.kind) {
    case 'draft':
      label = t('admin.news.status.draft', 'Draft')
      break
    case 'scheduled':
      label = t('admin.news.status.scheduled', 'Scheduled')
      break
    case 'published':
      label = t('admin.news.status.published', 'Published')
      break
    default:
      label = status satisfies never
  }

  return (
    <StatusCellRoot>
      <StatusChip $kind={status.kind}>{label}</StatusChip>
      {status.kind !== 'draft' ? (
        <StatusDate>{longTimestamp.format(status.date)}</StatusDate>
      ) : null}
    </StatusCellRoot>
  )
}

const LoadMoreRow = styled.div`
  display: flex;
  justify-content: center;
  padding: 12px;
`

function AdminNewsList() {
  const { t } = useTranslation()
  // One `after` cursor per loaded page (the first page has none). We page with cursors rather than
  // growing `first`, because the server clamps `first` — an ever-growing page size would silently
  // stop returning new rows past the clamp.
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null])
  // Bumped on refresh to re-mount the pages and force a fresh fetch. Publishing/unpublishing/
  // deleting reorders the connection, so we reset to the first page rather than trying to patch it
  // in the (awkward-to-invalidate) graphcache.
  const [refreshToken, setRefreshToken] = useState(0)
  // `useNow`'s tick can be up to 30s stale, which would briefly classify a just-published post as
  // "Scheduled" — refreshes floor the clock to the refresh time so new statuses classify correctly.
  const [minNow, setMinNow] = useState(0)
  const now = Math.max(useNow(30_000), minNow)

  const [{ fetching: updating, error: updateError }, updatePost] =
    useMutation(NewsUpdatePostMutation)
  const [{ fetching: deleting, error: deleteError }, deletePost] =
    useMutation(NewsDeletePostMutation)
  const mutating = updating || deleting

  const refresh = () => {
    setMinNow(Date.now())
    setPageCursors([null])
    setRefreshToken(token => token + 1)
  }

  const setPublishedAt = (id: string, publishedAt: string | null) => {
    updatePost({ id, updates: { publishedAt } })
      .then(result => {
        if (!result.error) {
          refresh()
        }
      })
      .catch(swallowNonBuiltins)
  }

  const onDelete = (id: string) => {
    deletePost({ id })
      .then(result => {
        if (!result.error) {
          refresh()
        }
      })
      .catch(swallowNonBuiltins)
  }

  return (
    <CenteredContentContainer>
      <Root>
        <HeaderRow>
          <Title>{t('admin.news.title', 'Manage news')}</Title>
          <HeaderActions>
            <OutlinedButton
              label={t('admin.news.refresh', 'Refresh')}
              onClick={refresh}
              disabled={mutating}
            />
            <FilledButton
              label={t('admin.news.newPost', 'New post')}
              iconStart={<MaterialIcon icon='add' />}
              onClick={() => push('/admin/news/new')}
            />
          </HeaderActions>
        </HeaderRow>
        {updateError ? (
          <ErrorText>
            {t('admin.news.updateError', 'Error updating post:')} {updateError.message}
          </ErrorText>
        ) : null}
        {deleteError ? (
          <ErrorText>
            {t('admin.news.deleteError', 'Error deleting post:')} {deleteError.message}
          </ErrorText>
        ) : null}
        <ListTable>
          <ListHeaderRow>
            <TitleCell>{t('admin.news.column.title', 'Title')}</TitleCell>
            <StatusCell>{t('admin.news.column.status', 'Status')}</StatusCell>
            <AuthorCell>{t('admin.news.column.author', 'Author')}</AuthorCell>
            <UpdatedCell>{t('admin.news.column.updated', 'Updated')}</UpdatedCell>
            <ActionsCell />
          </ListHeaderRow>
          {pageCursors.map((cursor, i) => (
            <NewsListPage
              key={`${refreshToken}:${cursor ?? 'first'}`}
              after={cursor}
              now={now}
              isLastPage={i === pageCursors.length - 1}
              mutating={mutating}
              onLoadMore={endCursor => setPageCursors(prev => [...prev, endCursor])}
              onPublishNow={id => setPublishedAt(id, new Date().toISOString())}
              onUnpublish={id => setPublishedAt(id, null)}
              onDelete={onDelete}
            />
          ))}
        </ListTable>
      </Root>
    </CenteredContentContainer>
  )
}

type NewsListPost = ResultOf<typeof AdminNewsListQuery>['newsPosts']['edges'][number]['node']

function NewsListPage({
  after,
  now,
  isLastPage,
  mutating,
  onLoadMore,
  onPublishNow,
  onUnpublish,
  onDelete,
}: {
  after: string | null
  now: number
  isLastPage: boolean
  mutating: boolean
  onLoadMore: (endCursor: string) => void
  onPublishNow: (id: string) => void
  onUnpublish: (id: string) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const [{ data, fetching, error }] = useQuery({
    query: AdminNewsListQuery,
    variables: { first: PAGE_SIZE, after: after ?? undefined },
    // Show cached rows immediately but always revalidate, so a refresh (or returning from an edit)
    // reflects server state.
    requestPolicy: 'cache-and-network',
  })

  const posts = data?.newsPosts.edges.map(e => e.node) ?? []
  const pageInfo = data?.newsPosts.pageInfo

  return (
    <>
      {posts.map(post => (
        <NewsPostRow
          key={post.id}
          post={post}
          now={now}
          mutating={mutating}
          onPublishNow={onPublishNow}
          onUnpublish={onUnpublish}
          onDelete={onDelete}
        />
      ))}
      {fetching && !data ? <LoadingDotsArea /> : null}
      {error ? (
        <ErrorText>
          {t('admin.news.loadError', 'Error loading news posts:')} {error.message}
        </ErrorText>
      ) : null}
      {isLastPage && pageInfo?.hasNextPage && pageInfo.endCursor ? (
        <LoadMoreRow>
          <OutlinedButton
            label={t('admin.news.loadMore', 'Load more')}
            onClick={() => onLoadMore(pageInfo.endCursor!)}
          />
        </LoadMoreRow>
      ) : null}
    </>
  )
}

const ConfirmDeleteRoot = styled.div`
  ${bodyLarge};

  flex: 1 1 auto;

  display: flex;
  align-items: center;
  gap: 16px;
`

const ConfirmDeleteText = styled.div`
  flex: 1 1 auto;
`

function NewsPostRow({
  post,
  now,
  mutating,
  onPublishNow,
  onUnpublish,
  onDelete,
}: {
  post: NewsListPost
  now: number
  mutating: boolean
  onPublishNow: (id: string) => void
  onUnpublish: (id: string) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [menuOpen, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })
  const status = getPostStatus(post.publishedAt, now)

  if (confirmingDelete) {
    return (
      <RowRoot>
        <ConfirmDeleteRoot>
          <ConfirmDeleteText>
            {t('admin.news.confirmDelete', 'Delete "{{title}}"? This cannot be undone.', {
              title: post.title,
            })}
          </ConfirmDeleteText>
          <TextButton
            label={t('common.actions.cancel', 'Cancel')}
            onClick={() => setConfirmingDelete(false)}
            disabled={mutating}
          />
          <TextButton
            label={t('common.actions.delete', 'Delete')}
            onClick={() => {
              setConfirmingDelete(false)
              onDelete(post.id)
            }}
            disabled={mutating}
          />
        </ConfirmDeleteRoot>
      </RowRoot>
    )
  }

  return (
    <RowRoot data-test='news-post-row'>
      <TitleCell>
        <TitleText>{post.title}</TitleText>
        <SummaryText>{post.summary}</SummaryText>
      </TitleCell>
      <StatusCell>
        <StatusDisplay publishedAt={post.publishedAt} now={now} />
      </StatusCell>
      <AuthorCell>
        {post.author ? <ConnectedUsername userId={post.author.id} /> : <EmDash>—</EmDash>}
      </AuthorCell>
      <UpdatedCell>{longTimestamp.format(new Date(post.updatedAt))}</UpdatedCell>
      <ActionsCell>
        <IconButton
          ref={anchorRef}
          icon={<MaterialIcon icon='more_vert' />}
          title={t('admin.news.action.menu', 'Actions')}
          onClick={openMenu}
          disabled={mutating}
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
                push(urlPath`/admin/news/${post.id}`)
              }}
            />
            <MenuItem
              icon={<MaterialIcon icon='history' />}
              text={t('admin.news.action.history', 'Edit history')}
              onClick={() => {
                closeMenu()
                push(urlPath`/admin/news/${post.id}/history`)
              }}
            />
            {status.kind !== 'published' ? (
              <MenuItem
                icon={<MaterialIcon icon='publish' />}
                text={t('admin.news.action.publishNow', 'Publish now')}
                onClick={() => {
                  closeMenu()
                  onPublishNow(post.id)
                }}
              />
            ) : null}
            {status.kind !== 'draft' ? (
              <MenuItem
                icon={<MaterialIcon icon='unpublished' />}
                text={t('admin.news.action.unpublish', 'Unpublish')}
                onClick={() => {
                  closeMenu()
                  onUnpublish(post.id)
                }}
              />
            ) : null}
            <DestructiveMenuItem
              icon={<MaterialIcon icon='delete' />}
              text={t('admin.news.action.delete', 'Delete')}
              onClick={() => {
                closeMenu()
                setConfirmingDelete(true)
              }}
            />
          </MenuList>
        </Popover>
      </ActionsCell>
    </RowRoot>
  )
}

function AdminNewsCreate() {
  return <NewsEditor post={undefined} />
}

function AdminNewsEdit({ params: { id } }: { params: { id: string } }) {
  const { t } = useTranslation()
  const [{ data, fetching, error }] = useQuery({
    query: AdminNewsPostQuery,
    variables: { id },
  })

  const post = data?.newsPost

  if (error) {
    return (
      <CenteredContentContainer>
        <Root>
          <ErrorText>
            {t('admin.news.loadError', 'Error loading news posts:')} {error.message}
          </ErrorText>
        </Root>
      </CenteredContentContainer>
    )
  }
  if (!post) {
    return fetching ? (
      <LoadingDotsArea />
    ) : (
      <CenteredContentContainer>
        <Root>
          <NotFoundText>
            {t('admin.news.notFound', 'No news post found with this ID.')}
          </NotFoundText>
        </Root>
      </CenteredContentContainer>
    )
  }

  // Keyed by id so switching directly between two edit pages (e.g. via history) remounts the
  // editor instead of keeping the previous post's form state.
  return <NewsEditor key={post.id} post={post} />
}

type EditablePost = NonNullable<ResultOf<typeof AdminNewsPostQuery>['newsPost']>

export interface NewsEditorModel {
  title: string
  summary: string
  content: string
  publishMode: PublishMode
  scheduledAt: string
}

const FormArea = styled.div`
  display: flex;
  gap: 24px;
  align-items: stretch;
`

const EditorColumn = styled.div`
  flex: 1 1 50%;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ContentField = styled(TextField)`
  width: 100%;
`

const MarkdownPreview = styled(Markdown)`
  flex: 1 1 50%;
  min-width: 0;
  min-height: 480px;
  padding: 16px 24px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
  overflow-y: auto;
`

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const PublishControl = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 12px;

  border-radius: 4px;
`

const ScheduleField = styled(DateTimeTextField)`
  max-width: 320px;
`

const ScheduleHint = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const SaveRow = styled.div`
  display: flex;
  gap: 8px;
`

const CoverSection = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 12px;

  border-radius: 4px;
`

const CoverLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const CoverPreview = styled.div`
  width: 100%;
  max-width: 480px;
  aspect-ratio: 2 / 1;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
  overflow: hidden;
`

const CoverImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`

const CoverPlaceholder = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const CoverActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const CoverHint = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const HiddenFileInput = styled.input`
  display: none;
`

/**
 * Splices an image markdown snippet (`![](url)`) into editor content. When a cursor selection is
 * given the snippet replaces it; otherwise the snippet is appended as its own block. Returns the
 * new content and the cursor position inside the snippet's alt-text brackets.
 */
export function insertInlineImage(
  content: string,
  url: string,
  selection?: { start: number; end: number },
): { content: string; cursor: number } {
  const snippet = `![](${url})`

  if (selection) {
    const { start, end } = selection
    return {
      content: content.slice(0, start) + snippet + content.slice(end),
      cursor: start + 2,
    }
  }

  if (content.trim() === '') {
    return { content: snippet, cursor: 2 }
  }

  const trimmed = content.replace(/\s+$/, '')
  return {
    content: `${trimmed}\n\n${snippet}`,
    cursor: trimmed.length + 2 + 2,
  }
}

/** Computes the `publishedAt` value for a newly-created post (undefined leaves it a draft). */
export function createPublishedAt(model: NewsEditorModel): string | undefined {
  switch (model.publishMode) {
    case PUBLISH_MODE_DRAFT:
      return undefined
    case PUBLISH_MODE_NOW:
      return new Date().toISOString()
    case PUBLISH_MODE_SCHEDULE:
      return new Date(model.scheduledAt).toISOString()
    default:
      return model.publishMode satisfies never
  }
}

/**
 * Computes the `publishedAt` change to send in an update, or `undefined` if the publish state is
 * unchanged (so we omit the field and leave it alone). A returned `{ value: null }` unpublishes.
 */
export function publishedAtUpdate(
  model: NewsEditorModel,
  originalPublishedAt: string | null,
): { value: string | null } | undefined {
  if (model.publishMode === PUBLISH_MODE_DRAFT) {
    return originalPublishedAt === null ? undefined : { value: null }
  }
  if (model.publishMode === PUBLISH_MODE_NOW) {
    // An explicit "publish now" always re-dates the post to the current time.
    return { value: new Date().toISOString() }
  }

  // Scheduled: compare at minute precision (the input's granularity) so re-saving an untouched
  // post doesn't bump its publish time.
  const targetMinute = Math.floor(new Date(model.scheduledAt).getTime() / 60_000)
  const originalMinute =
    originalPublishedAt !== null
      ? Math.floor(new Date(originalPublishedAt).getTime() / 60_000)
      : null
  if (targetMinute === originalMinute) {
    return undefined
  }
  return { value: new Date(model.scheduledAt).toISOString() }
}

function NewsEditor({ post }: { post: EditablePost | undefined }) {
  const { t } = useTranslation()
  const selfUser = useSelfUser()
  const snackbarController = useSnackbarController()
  const [{ fetching: creating, error: createError }, createPost] =
    useMutation(NewsCreatePostMutation)
  const [{ fetching: updating, error: updateError }, updatePost] =
    useMutation(NewsUpdatePostMutation)
  const fetching = creating || updating
  const error = createError ?? updateError

  const coverFileInputRef = useRef<HTMLInputElement>(null)
  const [coverImagePath, setCoverImagePath] = useState<string | null>(post?.coverImagePath ?? null)
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(post?.coverImageUrl ?? null)
  const [coverUploading, setCoverUploading] = useState(false)
  const [coverError, setCoverError] = useState<string | undefined>(undefined)

  const imageFileInputRef = useRef<HTMLInputElement>(null)
  const contentInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  // Tracks whether the content field has ever been focused: a textarea's selectionStart/End
  // default to 0 before any user interaction, so a selection is only a real cursor position once
  // the field has been focused at some point.
  const contentEverFocusedRef = useRef(false)
  const [imageUploading, setImageUploading] = useState(false)
  const [imageError, setImageError] = useState<string | undefined>(undefined)

  const onCoverFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset the input so selecting the same file again still fires a change event.
    event.target.value = ''
    if (!file) {
      return
    }
    if (!file.type.startsWith('image/')) {
      setCoverError(t('admin.news.form.coverInvalidType', 'Please choose an image file.'))
      return
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setCoverError(t('admin.news.form.coverTooLarge', 'That image is too large (max 5 MB).'))
      return
    }

    setCoverError(undefined)
    setCoverUploading(true)
    const formData = new FormData()
    formData.append('image', file)
    fetchJson<NewsImageUploadResponse>(apiUrl`news/images`, {
      method: 'POST',
      body: formData,
    })
      .then(result => {
        setCoverUploading(false)
        setCoverImagePath(result.path)
        setCoverImageUrl(result.url)
      })
      .catch(err => {
        setCoverUploading(false)
        setCoverError(
          t('admin.news.form.coverUploadError', 'Something went wrong uploading the cover image.'),
        )
        logger.error(`Error uploading news cover image: ${getErrorStack(err)}`)
      })
  }

  const onRemoveCover = () => {
    setCoverError(undefined)
    setCoverImagePath(null)
    setCoverImageUrl(null)
  }

  const onImageFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset the input so selecting the same file again still fires a change event.
    event.target.value = ''
    if (!file) {
      return
    }
    if (!file.type.startsWith('image/')) {
      setImageError(t('admin.news.form.imageInvalidType', 'Please choose an image file.'))
      return
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setImageError(t('admin.news.form.imageTooLarge', 'That image is too large (max 5 MB).'))
      return
    }

    setImageError(undefined)
    setImageUploading(true)
    const formData = new FormData()
    formData.append('image', file)
    // Inline images intentionally reuse the cover upload pipeline.
    fetchJson<NewsCoverImageUploadResponse>(apiUrl`news/cover-images`, {
      method: 'POST',
      body: formData,
    })
      .then(result => {
        setImageUploading(false)
        // Read the content from the DOM element rather than the form state this closure captured
        // when the upload started, so text typed while the upload was in flight isn't lost.
        const textarea = contentInputRef.current
        const currentContent = textarea?.value ?? getInputValue('content')
        const selection =
          textarea &&
          contentEverFocusedRef.current &&
          textarea.selectionStart !== null &&
          textarea.selectionEnd !== null
            ? { start: textarea.selectionStart, end: textarea.selectionEnd }
            : undefined
        const { content, cursor } = insertInlineImage(currentContent, result.url, selection)
        setInputValue('content', content)
        requestAnimationFrame(() => {
          if (textarea) {
            textarea.focus()
            textarea.setSelectionRange(cursor, cursor)
          }
        })
      })
      .catch(err => {
        setImageUploading(false)
        setImageError(
          t('admin.news.form.imageUploadError', 'Something went wrong uploading the image.'),
        )
        logger.error(`Error uploading news inline image: ${getErrorStack(err)}`)
      })
  }

  const onFormat = (kind: MarkdownFormatKind) => {
    const textarea = contentInputRef.current
    const currentContent = textarea?.value ?? getInputValue('content')
    const selection =
      textarea &&
      contentEverFocusedRef.current &&
      textarea.selectionStart !== null &&
      textarea.selectionEnd !== null
        ? { start: textarea.selectionStart, end: textarea.selectionEnd }
        : undefined
    const result = applyMarkdownFormat(kind, currentContent, selection)
    setInputValue('content', result.content)
    requestAnimationFrame(() => {
      if (textarea) {
        textarea.focus()
        textarea.setSelectionRange(result.selectionStart, result.selectionEnd)
      }
    })
  }

  let publishMode: PublishMode = PUBLISH_MODE_DRAFT
  let scheduledAt = toDateTimeLocalString(new Date())
  if (post?.publishedAt) {
    // Both scheduled (future) and already-published (past) posts start here with their current
    // publish time prefilled; leaving it untouched preserves it on save.
    publishMode = PUBLISH_MODE_SCHEDULE
    scheduledAt = toDateTimeLocalString(new Date(post.publishedAt))
  }

  const defaults: NewsEditorModel = {
    title: post?.title ?? '',
    summary: post?.summary ?? '',
    content: post?.content ?? '',
    publishMode,
    scheduledAt,
  }

  const validations: ValidatorMap<NewsEditorModel> = {
    title: required(t('admin.news.form.titleRequired', 'Title is required')),
    summary: required(t('admin.news.form.summaryRequired', 'Summary is required')),
    content: required(t('admin.news.form.contentRequired', 'Content is required')),
    scheduledAt: (value, model) => {
      if (model.publishMode !== PUBLISH_MODE_SCHEDULE) {
        return undefined
      }
      if (!value || Number.isNaN(new Date(value).getTime())) {
        return t('admin.news.form.scheduleRequired', 'Choose a valid date and time')
      }
      return undefined
    },
  }

  const { submit, bindInput, form, getInputValue, setInputValue } = useForm<NewsEditorModel>(
    defaults,
    validations,
  )

  useFormCallbacks(form, {
    onSubmit: model => {
      if (post) {
        const updates: NewsPostUpdates = {}
        if (model.title !== post.title) {
          updates.title = model.title
        }
        if (model.summary !== post.summary) {
          updates.summary = model.summary
        }
        if (model.content !== post.content) {
          updates.content = model.content
        }
        const publishedChange = publishedAtUpdate(model, post.publishedAt ?? null)
        if (publishedChange) {
          updates.publishedAt = publishedChange.value
        }
        if (coverImagePath !== (post.coverImagePath ?? null)) {
          // Send the new path, or an explicit null to clear it; omit when unchanged.
          updates.coverImagePath = coverImagePath
        }

        if (Object.keys(updates).length === 0) {
          push('/admin/news')
          return
        }

        updatePost({ id: post.id, updates })
          .then(result => {
            if (!result.error) {
              snackbarController.showSnackbar(t('admin.news.saved', 'News post saved'))
              push('/admin/news')
            }
          })
          .catch(swallowNonBuiltins)
      } else {
        const publishedAt = createPublishedAt(model)
        const creation: NewsPostCreation = {
          // The server records the creator in the edit log and enforces authorId == self; sending
          // it makes the post render "by {name}" like an authored post.
          authorId: selfUser?.id,
          title: model.title,
          summary: model.summary,
          content: model.content,
          ...(publishedAt !== undefined ? { publishedAt } : {}),
          ...(coverImagePath !== null ? { coverImagePath } : {}),
        }

        createPost({ post: creation })
          .then(result => {
            if (!result.error) {
              snackbarController.showSnackbar(t('admin.news.created', 'News post created'))
              push('/admin/news')
            }
          })
          .catch(swallowNonBuiltins)
      }
    },
  })

  const currentPublishMode = getInputValue('publishMode')

  return (
    <CenteredContentContainer>
      <Root>
        <HeaderRow>
          <Title>
            {post
              ? t('admin.news.editTitle', 'Edit news post')
              : t('admin.news.createTitle', 'Create news post')}
          </Title>
          <HeaderActions>
            {post ? (
              <TextButton
                label={t('admin.news.viewPost', 'View post')}
                iconStart={<MaterialIcon icon='open_in_new' />}
                onClick={() => push(urlPath`/news/${post.id}`)}
              />
            ) : null}
            <TextButton
              label={t('admin.news.backToList', 'Back to list')}
              onClick={() => push('/admin/news')}
            />
          </HeaderActions>
        </HeaderRow>
        {error ? <ErrorText>{error.message}</ErrorText> : null}
        <Form onSubmit={submit}>
          <TextField {...bindInput('title')} label={t('admin.news.form.title', 'Title')} />
          <TextField
            {...bindInput('summary')}
            label={t('admin.news.form.summary', 'Summary')}
            multiline={true}
            rows={2}
            maxRows={4}
          />
          <FormArea>
            <EditorColumn>
              <MarkdownToolbar onFormat={onFormat}>
                <HiddenFileInput
                  ref={imageFileInputRef}
                  type='file'
                  accept='image/*'
                  onChange={onImageFileSelected}
                  data-test='news-inline-image-file-input'
                />
                <IconButton
                  icon={<MaterialIcon icon='add_photo_alternate' />}
                  title={t('admin.news.form.insertImage', 'Insert image')}
                  onClick={() => imageFileInputRef.current?.click()}
                  disabled={imageUploading}
                />
                {imageUploading ? (
                  <CoverHint>{t('admin.news.form.imageUploading', 'Uploading…')}</CoverHint>
                ) : null}
              </MarkdownToolbar>
              <ContentField
                {...bindInput('content')}
                ref={contentInputRef}
                onFocus={() => {
                  contentEverFocusedRef.current = true
                }}
                label={t('admin.news.form.content', 'Content (Markdown)')}
                multiline={true}
                rows={18}
                maxRows={40}
              />
              {imageError ? <ErrorText>{imageError}</ErrorText> : null}
            </EditorColumn>
            <MarkdownPreview source={getInputValue('content')} allowMedia={true} />
          </FormArea>
          <CoverSection>
            <CoverLabel>{t('admin.news.form.cover', 'Cover image')}</CoverLabel>
            <CoverPreview>
              {coverImageUrl ? (
                <CoverImage src={coverImageUrl} alt='' draggable={false} />
              ) : (
                <CoverPlaceholder>
                  {t('admin.news.form.coverNone', 'No cover image (a stock image will be used)')}
                </CoverPlaceholder>
              )}
            </CoverPreview>
            <HiddenFileInput
              ref={coverFileInputRef}
              type='file'
              accept='image/*'
              onChange={onCoverFileSelected}
              data-test='news-cover-file-input'
            />
            <CoverActions>
              <OutlinedButton
                label={
                  coverImageUrl
                    ? t('admin.news.form.coverChange', 'Change cover')
                    : t('admin.news.form.coverUpload', 'Upload cover')
                }
                iconStart={<MaterialIcon icon='image' />}
                onClick={() => coverFileInputRef.current?.click()}
                disabled={coverUploading}
              />
              {coverImageUrl ? (
                <TextButton
                  label={t('admin.news.form.coverRemove', 'Remove cover')}
                  onClick={onRemoveCover}
                  disabled={coverUploading}
                />
              ) : null}
            </CoverActions>
            {coverUploading ? (
              <CoverHint>{t('admin.news.form.coverUploading', 'Uploading…')}</CoverHint>
            ) : null}
            {coverError ? <ErrorText>{coverError}</ErrorText> : null}
          </CoverSection>
          <PublishControl>
            <RadioGroup
              {...bindInput('publishMode')}
              label={t('admin.news.form.publish', 'Publish')}
              dense={true}>
              <RadioButton
                value={PUBLISH_MODE_DRAFT}
                label={t('admin.news.form.publishDraft', 'Draft (not published)')}
              />
              <RadioButton
                value={PUBLISH_MODE_NOW}
                label={t('admin.news.form.publishNow', 'Publish now')}
              />
              <RadioButton
                value={PUBLISH_MODE_SCHEDULE}
                label={t('admin.news.form.publishSchedule', 'Schedule')}
              />
            </RadioGroup>
            {currentPublishMode === PUBLISH_MODE_SCHEDULE ? (
              <>
                <ScheduleField
                  {...bindInput('scheduledAt')}
                  label={t('admin.news.form.scheduleDate', 'Publish date and time')}
                  floatingLabel={true}
                />
                <ScheduleHint>
                  {t(
                    'admin.news.form.scheduleHint',
                    'A future date/time schedules the post; a past date/time publishes it immediately.',
                  )}
                </ScheduleHint>
              </>
            ) : null}
          </PublishControl>
          <SaveRow>
            <FilledButton
              label={
                post
                  ? t('admin.news.saveChanges', 'Save changes')
                  : t('admin.news.createPost', 'Create post')
              }
              onClick={submit}
              disabled={fetching || coverUploading || imageUploading}
            />
          </SaveRow>
        </Form>
      </Root>
    </CenteredContentContainer>
  )
}

const HistoryList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const HistoryEntryRoot = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  padding: 12px 16px;

  display: flex;
  flex-direction: column;
  gap: 8px;

  border-radius: 4px;
`

const HistoryEntryHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
`

const HistoryEntryWhen = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const HistoryEntryChangeKind = styled.div`
  ${labelMedium};
  color: var(--theme-amber);
`

const HistoryEntryTitle = styled.div`
  ${titleMedium};
`

const HistoryEntryMeta = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const HistoryEntryChanges = styled.div`
  ${bodyMedium};
`

export type NewsPostEdit = NonNullable<
  ResultOf<typeof AdminNewsHistoryQuery>['newsPost']
>['edits'][number]

/** Field labels that changed between an edit and the next-older revision. */
export function changedFieldLabels(
  edit: NewsPostEdit,
  older: NewsPostEdit | undefined,
  t: ReturnType<typeof useTranslation>['t'],
): string[] {
  if (!older) {
    return []
  }
  const labels: string[] = []
  if (edit.title !== older.title) {
    labels.push(t('admin.news.field.title', 'Title'))
  }
  if (edit.summary !== older.summary) {
    labels.push(t('admin.news.field.summary', 'Summary'))
  }
  if (edit.content !== older.content) {
    labels.push(t('admin.news.field.content', 'Content'))
  }
  if ((edit.publishedAt ?? null) !== (older.publishedAt ?? null)) {
    labels.push(t('admin.news.field.publish', 'Publish date'))
  }
  if ((edit.coverImagePath ?? null) !== (older.coverImagePath ?? null)) {
    labels.push(t('admin.news.field.cover', 'Cover image'))
  }
  return labels
}

function publishStateLabel(
  publishedAt: string | null | undefined,
  now: number,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const status = getPostStatus(publishedAt, now)
  switch (status.kind) {
    case 'draft':
      return t('admin.news.status.draft', 'Draft')
    case 'scheduled':
      return t('admin.news.historyScheduled', 'Scheduled for {{date}}', {
        date: longTimestamp.format(status.date),
      })
    case 'published':
      return t('admin.news.historyPublished', 'Published {{date}}', {
        date: longTimestamp.format(status.date),
      })
    default:
      return status satisfies never
  }
}

function AdminNewsHistory({ params: { id } }: { params: { id: string } }) {
  const { t } = useTranslation()
  const now = useNow(30_000)
  const [{ data, fetching, error }] = useQuery({
    query: AdminNewsHistoryQuery,
    variables: { id },
  })

  const post = data?.newsPost
  const edits = post?.edits ?? []

  return (
    <CenteredContentContainer>
      <Root>
        <HeaderRow>
          <Title>{t('admin.news.history.title', 'Edit history')}</Title>
          <HeaderActions>
            <TextButton
              label={t('admin.news.editPost', 'Edit post')}
              onClick={() => push(urlPath`/admin/news/${id}`)}
            />
            <TextButton
              label={t('admin.news.backToList', 'Back to list')}
              onClick={() => push('/admin/news')}
            />
          </HeaderActions>
        </HeaderRow>
        {post ? <HistoryEntryMeta>{post.title}</HistoryEntryMeta> : null}
        {error ? (
          <ErrorText>
            {t('admin.news.loadError', 'Error loading news posts:')} {error.message}
          </ErrorText>
        ) : null}
        {fetching && !data ? <LoadingDotsArea /> : null}
        {!fetching && !error && !post ? (
          <NotFoundText>
            {t('admin.news.notFound', 'No news post found with this ID.')}
          </NotFoundText>
        ) : null}
        {post && edits.length === 0 ? (
          <NotFoundText>
            {t('admin.news.history.empty', 'No edit history for this post.')}
          </NotFoundText>
        ) : null}
        <HistoryList>
          {edits.map((edit, i) => {
            // `edits` is newest-first, so the next-older revision is the following index and the
            // final entry is the post's creation.
            const older = edits[i + 1]
            const isCreation = i === edits.length - 1
            const changedLabels = changedFieldLabels(edit, older, t)

            return (
              <HistoryEntryRoot key={i}>
                <HistoryEntryHeader>
                  <HistoryEntryWhen>
                    {longTimestamp.format(new Date(edit.editedAt))}
                  </HistoryEntryWhen>
                  <HistoryEntryChangeKind>
                    {isCreation
                      ? t('admin.news.history.created', 'Created')
                      : t('admin.news.history.edited', 'Edited')}
                  </HistoryEntryChangeKind>
                </HistoryEntryHeader>
                <HistoryEntryTitle>{edit.title}</HistoryEntryTitle>
                <HistoryEntryMeta>
                  {publishStateLabel(edit.publishedAt, now, t)}
                  {' · '}
                  {edit.editor ? (
                    <>
                      {t('admin.news.history.by', 'by ')}
                      <ConnectedUsername userId={edit.editor.id} />
                    </>
                  ) : (
                    t('admin.news.history.byUnknown', 'by an unknown user')
                  )}
                </HistoryEntryMeta>
                {!isCreation ? (
                  <HistoryEntryChanges>
                    {changedLabels.length > 0
                      ? t('admin.news.history.changed', 'Changed: {{fields}}', {
                          fields: changedLabels.join(', '),
                        })
                      : t('admin.news.history.noFieldChanges', 'No tracked field changes')}
                  </HistoryEntryChanges>
                ) : null}
              </HistoryEntryRoot>
            )
          })}
        </HistoryList>
      </Root>
    </CenteredContentContainer>
  )
}
