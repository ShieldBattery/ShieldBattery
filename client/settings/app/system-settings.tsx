import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useForm } from '../../forms/form-hook'
import SubmitOnEnter from '../../forms/submit-on-enter'
import CheckBox from '../../material/check-box'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { useStableCallback } from '../../state-hooks'
import { mergeLocalSettings } from '../action-creators'
import { FormContainer } from '../settings-content'

const IndentedCheckbox = styled(CheckBox)`
  margin-left: 28px;
`

interface AppSystemSettingsModel {
  runAppAtSystemStart: boolean
  runAppAtSystemStartMinimized: boolean
}

export function AppSystemSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)

  const onValidatedChange = useStableCallback((model: Readonly<AppSystemSettingsModel>) => {
    dispatch(
      mergeLocalSettings(
        {
          runAppAtSystemStart: model.runAppAtSystemStart,
          runAppAtSystemStartMinimized: model.runAppAtSystemStartMinimized,
        },
        {
          onSuccess: () => {},
          onError: () => {},
        },
      ),
    )
  })

  const { bindCheckable, onSubmit, getInputValue } = useForm(
    {
      runAppAtSystemStart: localSettings.runAppAtSystemStart,
      runAppAtSystemStartMinimized: localSettings.runAppAtSystemStartMinimized,
    },
    {},
    { onValidatedChange },
  )

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
      <FormContainer>
        <div>
          <CheckBox
            {...bindCheckable('runAppAtSystemStart')}
            label={t('settings.app.system.runOnStartup', 'Run ShieldBattery on system startup')}
            inputProps={{ tabIndex: 0 }}
          />
          <IndentedCheckbox
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
