import { debounce } from 'lodash-es'
import { useEffect, useId, useRef, useState } from 'react'
import styled, { css } from 'styled-components'
import { USERNAME_MAXLENGTH } from '../../common/constants'
import { FriendActivityStatus } from '../../common/users/relationships'
import { SbUser } from '../../common/users/sb-user'
import { SbUserId } from '../../common/users/sb-user-id'
import { ConnectedAvatar } from '../avatars/avatar'
import logger from '../logging/logger'
import { MenuItem } from '../material/menu/item'
import { getMenuItemId, MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { TextField } from '../material/text-field'
import { rankByQuery } from '../messaging/rank-by-query'
import { MAX_TYPEAHEAD_ROWS } from '../messaging/typeahead'
import { describeFetchError } from '../network/fetch-errors'
import { useMultiplexRef } from '../react/refs'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { searchUsers } from './action-creators'

const SuggestionList = styled(MenuList)`
  // Capped at MAX_TYPEAHEAD_ROWS rows, so it never needs to scroll.
  max-height: none;
`

const SuggestionItem = styled(MenuItem)<{ $faded: boolean }>`
  ${props =>
    props.$faded
      ? css`
          color: var(--theme-on-surface-variant);
        `
      : ''}
`

const SuggestionAvatar = styled(ConnectedAvatar)<{ $faded: boolean }>`
  width: 24px;
  height: 24px;

  ${props =>
    props.$faded
      ? css`
          opacity: var(--theme-disabled-opacity);
        `
      : ''}
`

/** How long name searches are coalesced for while the user is still typing. */
const SEARCH_COALESCE_MS = 150

/**
 * Searches the server for users whose name starts with what's typed. The first keystroke searches
 * right away; while typing continues, searches are coalesced so only the latest text is looked up.
 */
function useNameSearch(query: string): SbUser[] {
  const dispatch = useAppDispatch()
  const [results, setResults] = useState<{ query: string; users: SbUser[] }>()
  const [search] = useState(() => {
    let abortController: AbortController | undefined
    const run = debounce(
      (q: string) => {
        abortController?.abort()
        abortController = new AbortController()
        dispatch(
          searchUsers(q, {
            signal: abortController.signal,
            onSuccess: users => setResults({ query: q, users }),
            onError: err => {
              logger.error(`Error searching for users: ${describeFetchError(err)}`)
            },
          }),
        )
      },
      SEARCH_COALESCE_MS,
      { leading: true, trailing: true },
    )

    return {
      run,
      cancel: () => {
        run.cancel()
        abortController?.abort()
      },
    }
  })

  const trimmed = query.trim()
  useEffect(() => {
    if (trimmed.length > 0 && trimmed.length <= USERNAME_MAXLENGTH) {
      search.run(trimmed)
    }
  }, [search, trimmed])

  useEffect(() => () => search.cancel(), [search])

  // Results for text that the current text extends still apply, narrowed down, until the results
  // for the current text arrive.
  const lowered = trimmed.toLowerCase()
  if (!results || !lowered.startsWith(results.query.toLowerCase())) {
    return []
  }
  return results.users.filter(u => u.name.toLowerCase().startsWith(lowered))
}

/**
 * The people suggested for `query`: the known people (friends and open whispers) that match it,
 * followed by the server's matches. Nothing is suggested before anything is typed. When
 * `omitSelfAndBlocked` is set, the current user and anyone they've blocked are never suggested.
 */
function useSuggestions(
  query: string,
  omitSelfAndBlocked: boolean,
): Array<{ user: SbUser; online: boolean | undefined }> {
  const selfId = useAppSelector(s => s.auth.self?.user.id)
  const usersById = useAppSelector(s => s.users.byId)
  const friends = useAppSelector(s => s.relationships.friends)
  const friendActivityStatus = useAppSelector(s => s.relationships.friendActivityStatus)
  const blocks = useAppSelector(s => s.relationships.blocks)
  const sessions = useAppSelector(s => s.whispers.sessions)
  const searched = useNameSearch(query)

  const isOnline = (id: SbUserId) => {
    if (!friends.has(id)) {
      return undefined
    }
    return (
      (friendActivityStatus.get(id) ?? FriendActivityStatus.Offline) !==
      FriendActivityStatus.Offline
    )
  }
  const canSuggest = (id: SbUserId) => !omitSelfAndBlocked || (id !== selfId && !blocks.has(id))

  const known: SbUser[] = []
  for (const id of new Set([...friends.keys(), ...sessions])) {
    const user = usersById.get(id)
    if (user && canSuggest(id)) {
      known.push(user)
    }
  }
  known.sort((a, b) => a.name.localeCompare(b.name))

  const trimmed = query.trim()
  if (trimmed.length === 0) {
    return []
  }

  const suggested = rankByQuery(known, u => [u.name], trimmed)
  const included = new Set(suggested.map(u => u.id))
  for (const user of searched) {
    if (!included.has(user.id) && canSuggest(user.id)) {
      suggested.push(user)
    }
  }

  return suggested.slice(0, MAX_TYPEAHEAD_ROWS).map(user => ({ user, online: isOnline(user.id) }))
}

export interface UserSearchFieldProps {
  value: string
  onChange: (value: string) => void
  /** Called when a suggestion is chosen, by click or by Enter while the suggestions show. */
  onPick: (user: SbUser) => void
  /** Called when Enter is pressed while no suggestion is showing. */
  onSubmitTyped: () => void
  /** Never suggest the current user or anyone they have blocked. */
  omitSelfAndBlocked?: boolean
  /** Whether the suggestions may show before the field is interacted with. */
  initialIsOpen?: boolean
  label: string
  floatingLabel?: boolean
  dense?: boolean
  allowErrors?: boolean
  errorText?: string
  disabled?: boolean
  className?: string
  ref?: React.Ref<HTMLInputElement | HTMLTextAreaElement | null>
}

/**
 * A username text field that suggests matching people as the name is typed: friends and people
 * with open whispers first, then the server's prefix matches.
 */
export function UserSearchField({
  value,
  onChange,
  onPick,
  onSubmitTyped,
  omitSelfAndBlocked = false,
  initialIsOpen = false,
  label,
  floatingLabel,
  dense,
  allowErrors,
  errorText,
  disabled,
  className,
  ref,
}: UserSearchFieldProps) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const multiplexedRef = useMultiplexRef(inputRef, ref)
  // Set while the field is being focused after a pick, so that focus doesn't reopen the list.
  const focusingAfterPick = useRef(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition<HTMLDivElement>(
    'left',
    'bottom',
  )
  const [open, openList, closeList] = usePopoverController({ initialIsOpen, refreshAnchorPos })

  const suggestions = useSuggestions(value, omitSelfAndBlocked)
  const clampedActiveIndex = Math.min(activeIndex, Math.max(suggestions.length - 1, 0))
  const showing = open && suggestions.length > 0

  const pick = (user: SbUser) => {
    closeList()
    onPick(user)
    // Clicking a suggestion moves focus out of the field, and Enter needs the field focused.
    focusingAfterPick.current = true
    try {
      inputRef.current?.focus()
    } finally {
      focusingAfterPick.current = false
    }
  }

  return (
    <>
      <TextField
        ref={multiplexedRef}
        containerRef={anchorRef}
        className={className}
        value={value}
        label={label}
        floatingLabel={floatingLabel}
        dense={dense}
        allowErrors={allowErrors}
        errorText={errorText}
        disabled={disabled}
        maxLength={USERNAME_MAXLENGTH}
        inputProps={{
          autoCapitalize: 'off',
          autoComplete: 'off',
          autoCorrect: 'off',
          spellCheck: false,
          'aria-autocomplete': 'list',
          'aria-controls': showing ? listId : undefined,
          'aria-activedescendant': showing ? getMenuItemId(listId, clampedActiveIndex) : undefined,
          onClick: event => {
            // Keeps the click that opens the suggestions from also counting as one outside of them.
            event.stopPropagation()
            openList(event)
          },
        }}
        onChange={event => {
          onChange(event.target.value)
          setActiveIndex(0)
          openList(event)
        }}
        onFocus={event => {
          if (!focusingAfterPick.current) {
            openList(event)
          }
        }}
        onEnterKeyDown={() => {
          const active = showing ? suggestions[clampedActiveIndex] : undefined
          if (active) {
            pick(active.user)
          } else {
            onSubmitTyped()
          }
        }}
      />

      {showing ? (
        <Popover
          open={open}
          onDismiss={closeList}
          anchorX={anchorX ?? 0}
          anchorY={(anchorY ?? 0) + 4}
          originX='left'
          originY='top'
          // Keep the focus in the field so the user can keep typing.
          focusOnMount={false}>
          <SuggestionList
            id={listId}
            role='listbox'
            dense={true}
            virtualFocus={true}
            activeIndex={clampedActiveIndex}
            onActiveIndexChange={setActiveIndex}>
            {suggestions.map(({ user, online }) => (
              <SuggestionItem
                key={user.id}
                text={user.name}
                $faded={online === false}
                icon={
                  <SuggestionAvatar
                    userId={user.id}
                    showAvailability={true}
                    showOffline={true}
                    $faded={online === false}
                  />
                }
                onClick={() => pick(user)}
              />
            ))}
          </SuggestionList>
        </Popover>
      ) : null}
    </>
  )
}
