import { useTranslation } from 'react-i18next'
import { CheckBox } from '../../material/check-box'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { mergeAccountSettings } from '../action-creators'
import {
  FormContainer,
  SectionContainer,
  SettingsSectionDescription,
  SettingsSectionHeader,
} from '../settings-content'

export function UserNotificationSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const settings = useAppSelector(s => s.settings.account)

  return (
    <FormContainer>
      <SectionContainer>
        <SettingsSectionHeader>
          {t('settings.user.notifications.inGame.title', 'In game')}
        </SettingsSectionHeader>
        <SettingsSectionDescription>
          {t(
            'settings.user.notifications.inGame.description',
            "While you're in a game, messages won't play a sound or flash the taskbar, even ones " +
              'that mention you. Saved to your account and applies on every device you log in ' +
              'from.',
          )}
        </SettingsSectionDescription>
        {/*
          Bound straight to the Redux value rather than `useForm`: another session can change these
          settings while this page is open, and `useForm` only copies its initial model once, so it
          would never pick up that change.
        */}
        <CheckBox
          checked={settings.quietChannelsWhileInGame}
          onChange={event =>
            dispatch(
              mergeAccountSettings(
                { quietChannelsWhileInGame: event.target.checked },
                { onSuccess: () => {}, onError: () => {} },
              ),
            )
          }
          name='quietChannelsWhileInGame'
          label={t(
            'settings.user.notifications.quietChannelsWhileInGame',
            'Quiet channels while in a game',
          )}
        />
        <CheckBox
          checked={settings.quietWhispersWhileInGame}
          onChange={event =>
            dispatch(
              mergeAccountSettings(
                { quietWhispersWhileInGame: event.target.checked },
                { onSuccess: () => {}, onError: () => {} },
              ),
            )
          }
          name='quietWhispersWhileInGame'
          label={t(
            'settings.user.notifications.quietWhispersWhileInGame',
            'Quiet whispers while in a game',
          )}
        />
      </SectionContainer>
    </FormContainer>
  )
}
