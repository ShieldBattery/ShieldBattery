import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import { CheckBox } from '../../material/check-box'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { mergeLocalSettings } from '../action-creators'
import { FormContainer, SectionContainer, SettingsSectionHeader } from '../settings-content'
import { JavaSettings } from './java-settings'

const IndentedCheckBox = styled(CheckBox)`
  margin-left: 28px;
`

interface AppSystemSettingsModel {
  runAppAtSystemStart: boolean
  runAppAtSystemStartMinimized: boolean
  quitOnClose: boolean
  minimizeWhilePlaying: boolean
}

export function AppSystemSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)
  const { bindCheckable, getInputValue, submit, form } = useForm<AppSystemSettingsModel>(
    {
      runAppAtSystemStart: localSettings.runAppAtSystemStart,
      runAppAtSystemStartMinimized: localSettings.runAppAtSystemStartMinimized,
      quitOnClose: localSettings.quitOnClose,
      minimizeWhilePlaying: localSettings.minimizeWhilePlaying,
    },
    {},
  )

  useFormCallbacks(form, {
    onValidatedChange: model => {
      dispatch(
        mergeLocalSettings(
          {
            runAppAtSystemStart: model.runAppAtSystemStart,
            runAppAtSystemStartMinimized: model.runAppAtSystemStartMinimized,
            quitOnClose: model.quitOnClose,
            minimizeWhilePlaying: model.minimizeWhilePlaying,
          },
          {
            onSuccess: () => {},
            onError: () => {},
          },
        ),
      )
    },
  })

  return (
    <form noValidate={true} onSubmit={submit}>
      <FormContainer>
        <SectionContainer>
          <SettingsSectionHeader>
            {t('settings.app.system.startupOverline', 'Startup')}
          </SettingsSectionHeader>
          <CheckBox
            {...bindCheckable('runAppAtSystemStart')}
            label={t('settings.app.system.runOnStartup', 'Run ShieldBattery on system startup')}
            inputProps={{ tabIndex: 0 }}
          />
          <IndentedCheckBox
            {...bindCheckable('runAppAtSystemStartMinimized')}
            label={t('settings.app.system.startMinimized', 'Start minimized')}
            inputProps={{ tabIndex: 0 }}
            disabled={!getInputValue('runAppAtSystemStart')}
          />
        </SectionContainer>
        <SectionContainer>
          <SettingsSectionHeader>
            {t('settings.app.system.closingOverline', 'Closing')}
          </SettingsSectionHeader>
          <CheckBox
            {...bindCheckable('quitOnClose')}
            label={t(
              'settings.app.system.quitOnClose',
              'Quit ShieldBattery when closing the window',
            )}
            inputProps={{ tabIndex: 0 }}
          />
        </SectionContainer>
        <SectionContainer>
          <SettingsSectionHeader>
            {t('settings.app.system.playingOverline', 'Playing')}
          </SettingsSectionHeader>
          <CheckBox
            {...bindCheckable('minimizeWhilePlaying')}
            label={t(
              'settings.app.system.minimizeWhilePlaying',
              'Minimize ShieldBattery while a game is running',
            )}
            inputProps={{ tabIndex: 0 }}
          />
        </SectionContainer>
        <JavaSettings />
      </FormContainer>
    </form>
  )
}
