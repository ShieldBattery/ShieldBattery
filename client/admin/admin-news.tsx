import { ResultOf } from '@graphql-typed-document-node/core'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import { Route, Switch } from 'wouter'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { urlPath } from '../../common/urls'
import { useSelfUser } from '../auth/auth-utils'
import { useForm, useFormCallbacks, ValidatorMap } from '../forms/form-hook'
import { required } from '../forms/validators'
import { graphql } from '../gql'
import { NewsPostCreation, NewsPostUpdates } from '../gql/graphql'
import { longTimestamp } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { Markdown } from '../markdown/markdown'
import { FilledButton, IconButton, OutlinedButton, TextButton } from '../material/button'
import { DateTimeTextField } from '../material/datetime-text-field'
import { RadioButton, RadioGroup } from '../material/radio'
import { TextField } from '../material/text-field'
import { push } from '../navigation/routing'
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
    }
  }
`)

const NewsDeletePostMutation = graphql(/* GraphQL */ `
  mutation NewsDeletePost($id: UUID!) {
    newsDeletePost(id: $id)
  }
`)

const PAGE_SIZE = 20

const PUBLISH_MODE_DRAFT = 'draft'
const PUBLISH_MODE_NOW = 'now'
const PUBLISH_MODE_SCHEDULE = 'schedule'
type PublishMode =
  | typeof PUBLISH_MODE_DRAFT
  | typeof PUBLISH_MODE_NOW
  | typeof PUBLISH_MODE_SCHEDULE

type PostStatus =
  | { kind: 'draft' }
  | { kind: 'scheduled'; date: Date }
  | { kind: 'published'; date: Date }

/** Classifies a post's publish state given the current time (`now`, in millis). */
function getPostStatus(publishedAt: string | null | undefined, now: number): PostStatus {
  if (!publishedAt) {
    return { kind: 'draft' }
  }
  const date = new Date(publishedAt)
  return date.getTime() > now ? { kind: 'scheduled', date } : { kind: 'published', date }
}

/** Formats a `Date` for a `datetime-local` input value (`YYYY-MM-DDTHH:mm`, local time). */
function toDateTimeLocalString(date: Date): string {
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

  display: flex;
  align-items: center;
  gap: 4px;
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
            <ActionsCell>{t('admin.news.column.actions', 'Actions')}</ActionsCell>
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
          icon={<MaterialIcon icon='edit' />}
          title={t('admin.news.action.edit', 'Edit')}
          onClick={() => push(urlPath`/admin/news/${post.id}`)}
          disabled={mutating}
        />
        <IconButton
          icon={<MaterialIcon icon='history' />}
          title={t('admin.news.action.history', 'Edit history')}
          onClick={() => push(urlPath`/admin/news/${post.id}/history`)}
          disabled={mutating}
        />
        {status.kind !== 'published' ? (
          <IconButton
            icon={<MaterialIcon icon='publish' />}
            title={t('admin.news.action.publishNow', 'Publish now')}
            onClick={() => onPublishNow(post.id)}
            disabled={mutating}
          />
        ) : null}
        {status.kind !== 'draft' ? (
          <IconButton
            icon={<MaterialIcon icon='unpublished' />}
            title={t('admin.news.action.unpublish', 'Unpublish')}
            onClick={() => onUnpublish(post.id)}
            disabled={mutating}
          />
        ) : null}
        <IconButton
          icon={<MaterialIcon icon='delete' />}
          title={t('admin.news.action.delete', 'Delete')}
          onClick={() => setConfirmingDelete(true)}
          disabled={mutating}
        />
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

interface NewsEditorModel {
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

const ContentField = styled(TextField)`
  flex: 1 1 50%;
  min-width: 0;
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

const ScheduleHint = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const SaveRow = styled.div`
  display: flex;
  gap: 8px;
`

/** Computes the `publishedAt` value for a newly-created post (undefined leaves it a draft). */
function createPublishedAt(model: NewsEditorModel): string | undefined {
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
function publishedAtUpdate(
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

  const { submit, bindInput, form, getInputValue } = useForm<NewsEditorModel>(defaults, validations)

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
            <ContentField
              {...bindInput('content')}
              label={t('admin.news.form.content', 'Content (Markdown)')}
              multiline={true}
              rows={18}
              maxRows={40}
            />
            <MarkdownPreview source={getInputValue('content')} />
          </FormArea>
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
                <DateTimeTextField
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
              disabled={fetching}
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

type NewsPostEdit = NonNullable<ResultOf<typeof AdminNewsHistoryQuery>['newsPost']>['edits'][number]

/** Field labels that changed between an edit and the next-older revision. */
function changedFieldLabels(
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
