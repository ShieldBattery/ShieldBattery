import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { TextButton } from '../../material/button'
import { CheckBox } from '../../material/check-box'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { mergeAccountSettings } from '../action-creators'
import {
  SectionContainer,
  SettingsSectionDescription,
  SettingsSectionHeader,
} from '../settings-content'

const EnableBothButton = styled(TextButton)`
  align-self: flex-start;
`

export function ZenModeSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const settings = useAppSelector(s => s.settings.account)
  const [saving, setSaving] = useState(false)

  const update = (patch: { zenAnonymizePlayers?: boolean; zenMuteChat?: boolean }) => {
    setSaving(true)
    dispatch(
      mergeAccountSettings(patch, {
        onSuccess: () => setSaving(false),
        onError: () => setSaving(false),
      }),
    )
  }

  return (
    <SectionContainer>
      <SettingsSectionHeader>
        {t('settings.user.social.zen.title', 'Zen mode')}
      </SettingsSectionHeader>
      <SettingsSectionDescription>
        {t(
          'settings.user.social.zen.description',
          'These account settings apply to ranked matchmaking starting with your next match.',
        )}
      </SettingsSectionDescription>
      <CheckBox
        name='zenAnonymizePlayers'
        disabled={saving}
        checked={settings.zenAnonymizePlayers}
        label={t('settings.user.social.zen.anonymize', 'Anonymize other players')}
        onChange={event => update({ zenAnonymizePlayers: event.target.checked })}
      />
      <SettingsSectionDescription>
        {t(
          'settings.user.social.zen.anonymizeDescription',
          'Uses aliases in the draft, on the loading screen, and during the match, including live chat.',
        )}
      </SettingsSectionDescription>
      <CheckBox
        name='zenMuteChat'
        disabled={saving}
        checked={settings.zenMuteChat}
        label={t('settings.user.social.zen.mute', 'Disable sending and receiving match chat')}
        onChange={event => update({ zenMuteChat: event.target.checked })}
      />
      <SettingsSectionDescription>
        {t(
          'settings.user.social.zen.indicator',
          'When match chat is disabled, other players see a Zen icon beside your name.',
        )}
      </SettingsSectionDescription>
      <EnableBothButton
        iconStart='self_improvement'
        label={t('settings.user.social.zen.enableBoth', 'Enable both')}
        disabled={saving || (settings.zenAnonymizePlayers && settings.zenMuteChat)}
        onClick={() => update({ zenAnonymizePlayers: true, zenMuteChat: true })}
      />
    </SectionContainer>
  )
}
