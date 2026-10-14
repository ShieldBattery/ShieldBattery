import { debounce } from 'lodash-es'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { USERNAME_MAXLENGTH } from '../../common/constants'
import { FriendActivityStatus } from '../../common/users/relationships'
import { SbUser } from '../../common/users/sb-user'
import { SbUserId } from '../../common/users/sb-user-id'
import { whisperServiceErrorToString } from '../../common/whispers'
import { ConnectedAvatar } from '../avatars/avatar'
import logger from '../logging/logger'
import { useAutoFocusRef } from '../material/auto-focus'
import { MenuItem } from '../material/menu/item'
import { getMenuItemId, MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { TextField } from '../material/text-field'
import { rankByQuery } from '../messaging/rank-by-query'
import { MAX_TYPEAHEAD_ROWS } from '../messaging/typeahead'
import { describeFetchError, isFetchError } from '../network/fetch-errors'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { searchUsers } from '../users/action-creators'
import { navigateToWhisper, startWhisperSessionByName } from './action-creators'

const Root = styled.div`
  flex-grow: 1;
  min-width: 0;
  max-width: 720px;
  padding-top: 8px;
`

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
 * The people suggested for `query`: online friends while nothing is typed, otherwise the known
 * people (friends and open whispers) that match it, followed by the server's matches.
 */
function useSuggestions(query: string): Array<{ user: SbUser; online: boolean | undefined }> {
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
  const canSuggest = (id: SbUserId) => id !== selfId && !blocks.has(id)

  const known: SbUser[] = []
  for (const id of new Set([...friends.keys(), ...sessions])) {
    const user = usersById.get(id)
    if (user && canSuggest(id)) {
      known.push(user)
    }
  }
  known.sort((a, b) => a.name.localeCompare(b.name))

  let suggested: SbUser[]
  const trimmed = query.trim()
  if (trimmed.length === 0) {
    suggested = known.filter(u => isOnline(u.id))
  } else {
    suggested = rankByQuery(known, u => [u.name], trimmed)
    const included = new Set(suggested.map(u => u.id))
    for (const user of searched) {
      if (!included.has(user.id) && canSuggest(user.id)) {
        suggested.push(user)
      }
    }
  }

  return suggested.slice(0, MAX_TYPEAHEAD_ROWS).map(user => ({ user, online: isOnline(user.id) }))
}

/** Picks who to start a whisper with, offering matching people as their name is typed. */
export function NewWhisper() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const inputRef = useAutoFocusRef<HTMLInputElement>()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState<Error>()
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition<HTMLDivElement>(
    'left',
    'bottom',
  )
  const [paletteOpen, openPalette, closePalette] = usePopoverController({
    initialIsOpen: true,
    refreshAnchorPos,
  })

  const suggestions = useSuggestions(query)
  const clampedActiveIndex = Math.min(activeIndex, Math.max(suggestions.length - 1, 0))
  const paletteShowing = paletteOpen && suggestions.length > 0

  const startWith = (user: SbUser) => {
    closePalette()
    navigateToWhisper(user.id, user.name)
  }

  // Nothing suggested for what's typed (the search may not have caught up, say), so the name is
  // looked up as typed.
  const startWithTypedName = () => {
    const name = query.trim()
    if (!name || isStarting) {
      return
    }

    setIsStarting(true)
    setError(undefined)
    dispatch(
      startWhisperSessionByName(name, {
        onSuccess: ({ userId }) => navigateToWhisper(userId, name),
        onError: err => {
          setIsStarting(false)
          setError(err)
        },
      }),
    )
  }

  let errorText: string | undefined
  if (error) {
    errorText = isFetchError(error)
      ? whisperServiceErrorToString(error.code, t)
      : t('whispers.newWhisper.error', {
          defaultValue: 'Error starting the whisper: {{errorMessage}}',
          errorMessage: error.message,
        })
  }

  return (
    <Root>
      <TextField
        ref={inputRef}
        containerRef={anchorRef}
        value={query}
        label={t('whispers.newWhisper.recipient', 'To')}
        floatingLabel={true}
        errorText={errorText}
        disabled={isStarting}
        maxLength={USERNAME_MAXLENGTH}
        inputProps={{
          autoCapitalize: 'off',
          autoComplete: 'off',
          autoCorrect: 'off',
          spellCheck: false,
          'aria-autocomplete': 'list',
          'aria-controls': paletteShowing ? listId : undefined,
          'aria-activedescendant': paletteShowing
            ? getMenuItemId(listId, clampedActiveIndex)
            : undefined,
          onClick: event => {
            // Keeps the click that opens the suggestions from also counting as one outside of them.
            event.stopPropagation()
            openPalette(event)
          },
        }}
        onChange={event => {
          setQuery(event.target.value)
          setActiveIndex(0)
          setError(undefined)
          openPalette(event)
        }}
        onFocus={event => openPalette(event)}
        onEnterKeyDown={() => {
          const active = paletteShowing ? suggestions[clampedActiveIndex] : undefined
          if (active) {
            startWith(active.user)
          } else {
            startWithTypedName()
          }
        }}
      />

      {paletteShowing ? (
        <Popover
          open={paletteOpen}
          onDismiss={closePalette}
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
                onClick={() => startWith(user)}
              />
            ))}
          </SuggestionList>
        </Popover>
      ) : null}
    </Root>
  )
}
