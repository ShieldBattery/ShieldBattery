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
          {t('settings.user.notifications.alerts.title', 'Alerts')}
        </SettingsSectionHeader>
        <SettingsSectionDescription>
          {t(
            'settings.user.notifications.alerts.description',
            'How the app gets your attention when something happens while you are looking ' +
              'elsewhere. Message sounds cover chat, whispers, lobby and draft chat; sounds for ' +
              'events like a found match always play. The taskbar flashes for messages that ' +
              'mention you, whispers, found matches and players joining your lobby. Saved to ' +
              'your account and applies on every device you log in from.',
          )}
        </SettingsSectionDescription>
        <CheckBox
          checked={settings.playMessageSounds}
          onChange={event =>
            dispatch(
              mergeAccountSettings(
                { playMessageSounds: event.target.checked },
                { onSuccess: () => {}, onError: () => {} },
              ),
            )
          }
          name='playMessageSounds'
          label={t('settings.user.notifications.playMessageSounds', 'Play message sounds')}
        />
        <CheckBox
          checked={settings.flashTaskbar}
          onChange={event =>
            dispatch(
              mergeAccountSettings(
                { flashTaskbar: event.target.checked },
                { onSuccess: () => {}, onError: () => {} },
              ),
            )
          }
          name='flashTaskbar'
          label={t('settings.user.notifications.flashTaskbar', 'Flash the taskbar')}
        />
      </SectionContainer>
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
      <SectionContainer>
        <SettingsSectionHeader>
          {t('settings.user.notifications.whispers.title', 'Whispers')}
        </SettingsSectionHeader>
        <SettingsSectionDescription>
          {t(
            'settings.user.notifications.whispers.description',
            "Whispers you send and receive are shown as a line in whatever chat you're looking " +
              'at, so you can read them and answer with /r without switching. Turn this off if ' +
              'you stream your screen.',
          )}
        </SettingsSectionDescription>
        <CheckBox
          checked={settings.showWhispersEverywhere}
          onChange={event =>
            dispatch(
              mergeAccountSettings(
                { showWhispersEverywhere: event.target.checked },
                { onSuccess: () => {}, onError: () => {} },
              ),
            )
          }
          name='showWhispersEverywhere'
          label={t(
            'settings.user.notifications.showWhispersEverywhere',
            'Show whispers in every chat',
          )}
        />
      </SectionContainer>
    </FormContainer>
  )
}
