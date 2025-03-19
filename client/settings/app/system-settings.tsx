import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import SubmitOnEnter from '../../forms/submit-on-enter'
import { CheckBox } from '../../material/check-box'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { mergeLocalSettings } from '../action-creators'
import { FormContainer, SectionOverline } from '../settings-content'

const IndentedCheckBox = styled(CheckBox)`
  margin-left: 28px;
`

interface AppSystemSettingsModel {
  quickOpenReplays: boolean

  runAppAtSystemStart: boolean
  runAppAtSystemStartMinimized: boolean
}

export function AppSystemSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)

  const { bindCheckable, getInputValue, submit, form } = useForm<AppSystemSettingsModel>(
    {
      quickOpenReplays: localSettings.quickOpenReplays,
      runAppAtSystemStart: localSettings.runAppAtSystemStart,
      runAppAtSystemStartMinimized: localSettings.runAppAtSystemStartMinimized,
    },
    {},
  )

  useFormCallbacks(form, {
    onSubmit: model => {
      dispatch(
        mergeLocalSettings(
          {
            quickOpenReplays: model.quickOpenReplays,
            runAppAtSystemStart: model.runAppAtSystemStart,
            runAppAtSystemStartMinimized: model.runAppAtSystemStartMinimized,
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
      <SubmitOnEnter />
      <FormContainer>
        <div>
          <SectionOverline>{t('settings.app.system.filesOverline', 'Files')}</SectionOverline>
          <CheckBox
            {...bindCheckable('quickOpenReplays')}
            label={t(
              'settings.app.system.replayQuickOpen',
              'Launch replays opened with ShieldBattery immediately without previewing',
            )}
            inputProps={{ tabIndex: 0 }}
          />
        </div>
        <div>
          <SectionOverline>{t('settings.app.system.startupOverline', 'Startup')}</SectionOverline>
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
        </div>
      </FormContainer>
    </form>
  )
}
