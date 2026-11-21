import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUser } from '../../common/users/sb-user'
import { whisperServiceErrorToString } from '../../common/whispers'
import { ChatHeaderRoot } from '../chat/channel-header'
import { MaterialIcon } from '../icons/material/material-icon'
import { useAutoFocusRef } from '../material/auto-focus'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch } from '../redux-hooks'
import { titleLarge } from '../styles/typography'
import { UserSearchField } from '../users/user-search-field'
import { navigateToWhisper, startWhisperSessionByName } from './action-creators'
import { SuggestedPeople } from './suggested-people'

const Root = styled.div`
  flex-grow: 1;
  min-width: 0;
  height: 100%;
  padding-top: 8px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const HeaderIcon = styled.div`
  width: 40px;
  height: 40px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  border-radius: 50%;
  background-color: var(--theme-primary-container);
  color: var(--theme-on-primary-container);
`

const HeaderTitle = styled.div`
  ${titleLarge};
  flex-grow: 1;
`

const HeaderIdentity = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`

const Body = styled.div`
  flex-grow: 1;
  min-height: 0;
  padding-bottom: 16px;

  display: flex;
  flex-direction: column;
  gap: 24px;

  overflow-y: auto;
`

const BodyContent = styled.div`
  width: 100%;
  max-width: 720px;
  padding-inline: 8px;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

/** Picks who to start a whisper with, offering matching people as their name is typed. */
export function NewWhisper() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const inputRef = useAutoFocusRef<HTMLInputElement>()
  const [query, setQuery] = useState('')
  const [isStarting, setIsStarting] = useState(false)
  const [error, setError] = useState<Error>()

  const startWith = (user: SbUser) => {
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
      <ChatHeaderRoot $hasActions={true}>
        <HeaderIdentity>
          <HeaderIcon>
            <MaterialIcon icon='edit' size={20} />
          </HeaderIcon>
          <HeaderTitle>{t('whispers.page.newWhisper', 'New whisper')}</HeaderTitle>
        </HeaderIdentity>
      </ChatHeaderRoot>

      <Body>
        <BodyContent>
          <UserSearchField
            ref={inputRef}
            value={query}
            label={t('whispers.newWhisper.recipient', 'To')}
            floatingLabel={true}
            errorText={errorText}
            disabled={isStarting}
            omitSelfAndBlocked={true}
            initialIsOpen={true}
            onChange={value => {
              setQuery(value)
              setError(undefined)
            }}
            onPick={startWith}
            onSubmitTyped={startWithTypedName}
          />
          <SuggestedPeople />
        </BodyContent>
      </Body>
    </Root>
  )
}
