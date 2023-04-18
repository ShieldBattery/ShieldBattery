import React from 'react'
import styled from 'styled-components'
import { LocalSettings, ShieldBatteryAppSettings } from '../../../common/settings/local-settings'
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

function AppSystemSettingsForm({
  localSettings,
  onValidatedChange,
}: {
  localSettings: Omit<LocalSettings, keyof ShieldBatteryAppSettings>
  onValidatedChange: (model: Readonly<AppSystemSettingsModel>) => void
}) {
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
            label='Run ShieldBattery on system startup'
            inputProps={{ tabIndex: 0 }}
          />
          <IndentedCheckbox
            {...bindCheckable('runAppAtSystemStartMinimized')}
            label='Start minimized'
            inputProps={{ tabIndex: 0 }}
            disabled={!getInputValue('runAppAtSystemStart')}
          />
        </div>
      </FormContainer>
    </form>
  )
}

export default function AppSystemSettings() {
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)

  const onValidatedChange = useStableCallback((model: Readonly<AppSystemSettingsModel>) => {
    dispatch(
      mergeLocalSettings(model, {
        onSuccess: () => {},
        onError: () => {},
      }),
    )
  })

  return (
    <AppSystemSettingsForm localSettings={localSettings} onValidatedChange={onValidatedChange} />
  )
}
