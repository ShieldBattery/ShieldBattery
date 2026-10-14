import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { WhisperConversation } from '../../common/whispers'
import { ConnectedAvatar } from '../avatars/avatar'
import { useBreakpoint } from '../dom/dimension-hooks'
import { MaterialIcon } from '../icons/material/material-icon'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { LoadErrorRow } from '../lists/load-error-row'
import logger from '../logging/logger'
import { Tooltip } from '../material/tooltip'
import { MessagePreviewLine, PreviewableMessage } from '../messaging/message-preview-line'
import { push } from '../navigation/routing'
import { describeFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodyMedium, singleLine } from '../styles/typography'
import { ConnectedUserContextMenu } from '../users/user-context-menu'
import { useUserOverlays } from '../users/user-overlays'
import { getWhisperConversations } from './action-creators'
import { WhisperConversationUserMenu } from './whisper-menu-items'
import { urlForWhisper } from './whisper-url'

/** The width of the whispers page's content below which the rail collapses to avatars only. */
export const RAIL_COLLAPSE_BELOW_PX = 1100

// Mirrors the container query below via a ResizeObserver on the rail's own rendered width, rather
// than duplicating the page breakpoint: 56px (collapsed) and 280px (expanded) sit well on either
// side of the 120px threshold.
const RAIL_COLLAPSE_BREAKPOINTS: Array<[minWidth: number, collapsed: boolean]> = [
  [0, true],
  [120, false],
]

const RailRoot = styled.div`
  width: 280px;
  flex-shrink: 0;
  height: 100%;
  padding-block: 8px;

  display: flex;
  flex-direction: column;
  gap: 2px;

  overflow-x: hidden;
  overflow-y: auto;

  & > * {
    flex-shrink: 0;
  }

  @container whispers-page (width < ${RAIL_COLLAPSE_BELOW_PX}px) {
    width: 56px;
    scrollbar-width: none;
  }
`

// A plain `div` (not a link) since a message preview inside it can hold links of its own.
const RowRoot = styled.div<{ $selected: boolean }>`
  position: relative;
  width: 100%;
  min-height: 56px;
  padding: 8px;

  display: flex;
  align-items: center;
  gap: 12px;

  border-radius: 6px;
  cursor: pointer;
  background-color: ${props => (props.$selected ? 'var(--theme-container-high)' : 'transparent')};

  &:hover {
    background-color: ${props =>
      props.$selected
        ? 'var(--theme-container-high)'
        : 'rgb(from var(--theme-on-surface) r g b / 0.06)'};
  }

  &:focus-visible {
    outline: 2px solid var(--theme-grey-blue);
    outline-offset: -2px;
  }
`

/** A rail row that navigates to `url` when activated. */
function RailRow({
  url,
  selected,
  label,
  onContextMenu,
  children,
}: {
  url: string
  selected: boolean
  label: string | undefined
  onContextMenu?: (event: React.MouseEvent) => void
  children: React.ReactNode
}) {
  return (
    <RowRoot
      $selected={selected}
      role='link'
      tabIndex={0}
      aria-label={label}
      aria-current={selected ? 'page' : undefined}
      onClick={() => push(url)}
      onContextMenu={onContextMenu}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          push(url)
        }
      }}>
      {children}
    </RowRoot>
  )
}

const RowIcon = styled.div`
  width: 40px;
  height: 40px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;
`

const NewWhisperIcon = styled(RowIcon)`
  border-radius: 50%;
  background-color: var(--theme-primary-container);
  color: var(--theme-on-primary-container);
`

const RowText = styled.div`
  min-width: 0;
  flex-grow: 1;

  display: flex;
  flex-direction: column;

  @container whispers-page (width < ${RAIL_COLLAPSE_BELOW_PX}px) {
    display: none;
  }
`

const RowName = styled.div`
  ${bodyMedium};
  ${singleLine};
`

const AttentionIndicator = styled.div`
  width: 8px;
  height: 8px;
  position: absolute;
  left: -3px;
  top: calc(50% - 4px);

  border-radius: 50%;
  background-color: var(--theme-error);
`

/**
 * Every conversation the user has had, open or closed, newest activity first. Pages come from the
 * server as the list is scrolled; messages that arrive while the page is up (or that the user
 * sends) keep their conversations current without reloading anything.
 */
function useConversationList(selectedTarget: SbUserId | undefined) {
  const dispatch = useAppDispatch()
  const [lastLoaded, setLastLoaded] = useState<WhisperConversation>()
  const [hasMore, setHasMore] = useState(true)
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState<Error>()
  const abortRef = useRef<AbortController>(undefined)
  const lastMessages = useAppSelector(s => s.whispers.lastMessages)
  const blocks = useAppSelector(s => s.relationships.blocks)
  const selfId = useAppSelector(s => s.auth.self?.user.id)

  useEffect(() => () => abortRef.current?.abort(), [])

  const loadMore = () => {
    abortRef.current?.abort()
    const abortController = new AbortController()
    abortRef.current = abortController

    setIsLoading(true)
    setLoadError(undefined)
    dispatch(
      getWhisperConversations(lastLoaded, {
        signal: abortController.signal,
        onSuccess: result => {
          setLastLoaded(prev => result.conversations.at(-1) ?? prev)
          setHasMore(result.hasMore)
          setIsLoading(false)
        },
        onError: err => {
          logger.error(`Error loading whisper conversations: ${describeFetchError(err)}`)
          setLoadError(err)
          setIsLoading(false)
        },
      }),
    )
  }

  const targets = Array.from(lastMessages.keys()).sort(
    (a, b) => lastMessages.get(b)!.time - lastMessages.get(a)!.time,
  )
  // A conversation that hasn't had a message yet still gets a row while it's the one being viewed.
  if (selectedTarget !== undefined && !lastMessages.has(selectedTarget)) {
    targets.unshift(selectedTarget)
  }

  return {
    rows: targets
      .filter(t => t !== selfId && !blocks.has(t))
      .map(t => ({ target: t, lastMessage: lastMessages.get(t) })),
    hasMore,
    isLoading,
    loadError,
    loadMore,
  }
}

export function ConversationRail({ selectedTarget }: { selectedTarget?: SbUserId }) {
  const { t } = useTranslation()
  // Observes the rail's own rendered width so JS behavior (tooltips) follows the same collapse
  // point as the CSS container query on `RailRoot`.
  const [railRef, collapsed] = useBreakpoint<HTMLDivElement, boolean>(
    RAIL_COLLAPSE_BREAKPOINTS,
    false,
  )
  const { rows, hasMore, isLoading, loadError, loadMore } = useConversationList(selectedTarget)

  const newWhisperLabel = t('whispers.page.newWhisper', 'New whisper')

  return (
    <RailRoot ref={railRef}>
      <Tooltip text={newWhisperLabel} position='right' disabled={!collapsed} tabIndex={-1}>
        <RailRow url='/whispers' selected={selectedTarget === undefined} label={newWhisperLabel}>
          <NewWhisperIcon>
            <MaterialIcon icon='edit' size={20} />
          </NewWhisperIcon>
          <RowText>
            <RowName>{newWhisperLabel}</RowName>
          </RowText>
        </RailRow>
      </Tooltip>

      <InfiniteScrollList
        nextLoadingEnabled={true}
        isLoadingNext={isLoading}
        hasNextData={hasMore}
        nextError={
          loadError ? (
            <LoadErrorRow
              message={t('whispers.page.loadConversationsError', 'Error loading conversations')}
              onRetry={loadMore}
            />
          ) : undefined
        }
        onLoadNextData={loadMore}>
        {rows.map(({ target, lastMessage }) => (
          <ConversationRow
            key={target}
            target={target}
            lastMessage={lastMessage}
            selected={target === selectedTarget}
            collapsed={collapsed}
          />
        ))}
      </InfiniteScrollList>
      {isLoading && rows.length === 0 ? <LoadingDotsArea /> : null}
    </RailRoot>
  )
}

function ConversationRow({
  target,
  lastMessage,
  selected,
  collapsed,
}: {
  target: SbUserId
  lastMessage: PreviewableMessage | undefined
  selected: boolean
  collapsed: boolean
}) {
  const username = useAppSelector(s => s.users.byId.get(target)?.name)
  const hasUnread = useAppSelector(s => s.whispers.byId.get(target)?.hasUnread ?? false)
  const { contextMenuProps, onContextMenu } = useUserOverlays({
    userId: target,
    UserMenu: WhisperConversationUserMenu,
  })

  return (
    <>
      <ConnectedUserContextMenu {...contextMenuProps} />
      <Tooltip text={username ?? ''} position='right' disabled={!collapsed} tabIndex={-1}>
        <RailRow
          url={urlForWhisper(target, username ?? '')}
          selected={selected}
          label={username}
          onContextMenu={onContextMenu}>
          {hasUnread ? <AttentionIndicator /> : null}
          <RowIcon>
            <ConnectedAvatar userId={target} showAvailability={true} showOffline={true} />
          </RowIcon>
          <RowText>
            <RowName>{username}</RowName>
            {lastMessage ? <MessagePreviewLine message={lastMessage} /> : null}
          </RowText>
        </RailRow>
      </Tooltip>
    </>
  )
}
