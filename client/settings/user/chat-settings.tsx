import { ChangeEvent, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { isChatDisplayMode } from '../../../common/settings/account-settings'
import { useSelfUser } from '../../auth/auth-utils'
import { RadioButton } from '../../material/radio'
import { ChatContext, ChatContextValue } from '../../messaging/chat-context'
import { TextMessage } from '../../messaging/common-message-layout'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { mergeAccountSettings } from '../action-creators'
import {
  FormContainer,
  SectionContainer,
  SettingsSectionDescription,
  SettingsSectionHeader,
} from '../settings-content'

// A fixed point in time so the preview messages always render the same timestamps, rather than
// drifting with whenever the settings page happens to be opened.
const PREVIEW_BASE_TIME = new Date(2024, 0, 1, 20, 41).getTime()

/**
 * Mirrors `RadioGroupContainer` from `client/material/radio.tsx`: `RadioGroup` only accepts
 * `RadioButton` children (it clones each one to wire up `name`/`selected`/`onChange`), so it can't
 * interleave arbitrary preview content between the options. This lays out the same two
 * `RadioButton`s by hand and relies on the native `change` event bubbling up to `onChange`, exactly
 * like `RadioGroup` does internally.
 */
const RadioPreviewGroup = styled.div`
  display: flex;
  flex-direction: column;
`

const PreviewBox = styled.div`
  margin-bottom: 8px;
  margin-left: 48px;
  max-width: 560px;
  padding: 4px 0;

  background-color: var(--theme-container-lowest);
  border-radius: 4px;

  pointer-events: none;
  user-select: none;
`

export function UserChatSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const chatDisplayMode = useAppSelector(s => s.settings.account.chatDisplayMode)

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    if (!isChatDisplayMode(value)) {
      return
    }
    dispatch(
      mergeAccountSettings({ chatDisplayMode: value }, { onSuccess: () => {}, onError: () => {} }),
    )
  }

  return (
    <FormContainer>
      <SectionContainer>
        <SettingsSectionHeader>
          {t('settings.user.chat.displayMode.title', 'Display mode')}
        </SettingsSectionHeader>
        <SettingsSectionDescription>
          {t(
            'settings.user.chat.displayMode.description',
            'How messages are laid out in channels, whispers and lobby chat. Saved to your ' +
              'account and applies on every device you log in from.',
          )}
        </SettingsSectionDescription>
        {/*
          Bound straight to the Redux value rather than `useForm`: another session can change this
          setting while this page is open, and `useForm` only copies its initial model once, so it
          would never pick up that change.
        */}
        <RadioPreviewGroup onChange={onChange}>
          <RadioButton
            name='chatDisplayMode'
            value='classic'
            selected={chatDisplayMode === 'classic'}
            label={t('settings.user.chat.displayMode.classic', 'Classic')}
          />
          <PreviewBox>
            <ClassicChatPreview />
          </PreviewBox>
          <RadioButton
            name='chatDisplayMode'
            value='cozy'
            selected={chatDisplayMode === 'cozy'}
            label={t('settings.user.chat.displayMode.cozy', 'Cozy')}
          />
          <PreviewBox>
            <CozyChatPreview />
          </PreviewBox>
        </RadioPreviewGroup>
      </SectionContainer>
    </FormContainer>
  )
}

function usePreviewChatContext(): ChatContextValue {
  const defaultChatContext = useContext(ChatContext)
  return { ...defaultChatContext, disallowMentionInteraction: true }
}

function ClassicChatPreview() {
  const selfUser = useSelfUser()
  const previewChatContext = usePreviewChatContext()

  if (!selfUser) {
    return null
  }

  return (
    <ChatContext.Provider value={previewChatContext}>
      <TextMessage
        msgId='settings-preview-classic-1'
        userId={selfUser.id}
        selfUserId={selfUser.id}
        time={PREVIEW_BASE_TIME}
        text='gg'
      />
      <TextMessage
        msgId='settings-preview-classic-2'
        userId={selfUser.id}
        selfUserId={selfUser.id}
        time={PREVIEW_BASE_TIME + 20_000}
        text='rematch?'
      />
      <TextMessage
        msgId='settings-preview-classic-3'
        userId={selfUser.id}
        selfUserId={selfUser.id}
        time={PREVIEW_BASE_TIME + 45_000}
        text="same map, I'll host"
      />
    </ChatContext.Provider>
  )
}

function CozyChatPreview() {
  const selfUser = useSelfUser()
  const previewChatContext = usePreviewChatContext()

  if (!selfUser) {
    return null
  }

  return (
    <ChatContext.Provider value={previewChatContext}>
      <TextMessage
        msgId='settings-preview-cozy-1'
        userId={selfUser.id}
        selfUserId={selfUser.id}
        time={PREVIEW_BASE_TIME}
        text='gg'
        layout='cozyHeader'
      />
      <TextMessage
        msgId='settings-preview-cozy-2'
        userId={selfUser.id}
        selfUserId={selfUser.id}
        time={PREVIEW_BASE_TIME + 20_000}
        text='rematch?'
        layout='cozyContinuation'
      />
      <TextMessage
        msgId='settings-preview-cozy-3'
        userId={selfUser.id}
        selfUserId={selfUser.id}
        time={PREVIEW_BASE_TIME + 45_000}
        text="same map, I'll host"
        layout='cozyContinuation'
      />
    </ChatContext.Provider>
  )
}
