import React, { useRef } from 'react'
import styled from 'styled-components'
import { TypedIpcRenderer } from '../../../common/ipc'
import { LocalSettings, ShieldBatteryAppSettings } from '../../../common/settings/local-settings'
import { useForm } from '../../forms/form-hook'
import SubmitOnEnter from '../../forms/submit-on-enter'
import { RaisedButton } from '../../material/button'
import { TextField } from '../../material/text-field'
import { useAppSelector } from '../../redux-hooks'
import { useStableCallback } from '../../state-hooks'
import { background500 } from '../../styles/colors'
import { body1, body2 } from '../../styles/typography'
import { FormContainer } from '../settings-content'

const ipcRenderer = new TypedIpcRenderer()

function normalizePath(path: string) {
  return path?.replace(/\\(x86|x86_64)\\?$/, '')
}

const Instructions = styled.div`
  ${body1};
  margin-bottom: 16px;
`

const ExampleText = styled.span`
  ${body2};
  padding: 0 4px;
  background-color: ${background500};
`

const SelectFolderContainer = styled.div`
  display: flex;
`

const PathContainer = styled.div`
  flex-grow: 1;
`

const StyledTextField = styled(TextField)`
  flex-grow: 1;
  margin-right: 8px;

  input:hover {
    cursor: pointer;
  }
`

const BrowseButtonContainer = styled.div`
  display: flex;
  align-items: center;
  height: 56px;
`

interface StarcraftSettingsModel {
  path: string
}

function StarcraftSettingsForm({
  localSettings,
  onValidatedChange,
}: {
  localSettings: Omit<LocalSettings, keyof ShieldBatteryAppSettings>
  onValidatedChange: (model: Readonly<StarcraftSettingsModel>) => void
}) {
  const browseButtonRef = useRef<HTMLButtonElement>(null)

  const { bindInput, getInputValue, setInputValue, onSubmit } = useForm(
    {
      path: localSettings.starcraftPath,
    },
    {
      path: async (starcraftPath: string) => {
        const checkResult = await ipcRenderer.invoke('settingsCheckStarcraftPath', starcraftPath)!

        if (!checkResult.path) {
          return 'Select a valid StarCraft path'
        }
        if (!checkResult.version) {
          return 'Select a valid StarCraft version'
        }

        return undefined
      },
    },
    { onValidatedChange },
  )

  const onBrowseClick = useStableCallback(async () => {
    const currentPath = getInputValue('path') || ''

    const selection = await ipcRenderer.invoke('settingsBrowseForStarcraft', currentPath)!
    const selectedPath = selection.filePaths[0]
    browseButtonRef.current?.blur()

    if (selection.canceled || currentPath.toLowerCase() === selectedPath.toLowerCase()) return

    setInputValue('path', normalizePath(selectedPath))
  })

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
      <FormContainer>
        <div>
          <Instructions>
            Please select the directory where you have installed StarCraft: Remastered.
          </Instructions>
          <Instructions>
            This is usually <ExampleText>C:\Program Files (x86)\StarCraft</ExampleText> but may be
            elsewhere if you have customized it in the Battle.net launcher.
          </Instructions>

          <SelectFolderContainer>
            <PathContainer onClick={onBrowseClick}>
              <StyledTextField
                {...bindInput('path')}
                label='StarCraft folder path'
                disabled={true}
              />
            </PathContainer>
            <BrowseButtonContainer>
              <RaisedButton ref={browseButtonRef} label='Browse' onClick={onBrowseClick} />
            </BrowseButtonContainer>
          </SelectFolderContainer>
        </div>
      </FormContainer>
    </form>
  )
}

export function StarcraftSettings() {
  const localSettings = useAppSelector(s => s.settings.local)

  const onValidatedChange = useStableCallback((model: Readonly<StarcraftSettingsModel>) => {
    console.log(model)
    // FIXME(2Pac): Save the settings (debounced?)
  })

  return (
    <StarcraftSettingsForm localSettings={localSettings} onValidatedChange={onValidatedChange} />
  )
}
