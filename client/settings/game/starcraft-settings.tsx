import React, { useRef } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { TypedIpcRenderer } from '../../../common/ipc'
import { useForm } from '../../forms/form-hook'
import SubmitOnEnter from '../../forms/submit-on-enter'
import { RaisedButton } from '../../material/button'
import { TextField } from '../../material/text-field'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { useStableCallback } from '../../state-hooks'
import { background500 } from '../../styles/colors'
import { body1, body2 } from '../../styles/typography'
import { mergeLocalSettings } from '../action-creators'
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
  starcraftPath: string
}

export function StarcraftSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)
  const browseButtonRef = useRef<HTMLButtonElement>(null)

  const onValidatedChange = useStableCallback((model: Readonly<StarcraftSettingsModel>) => {
    dispatch(
      mergeLocalSettings(
        { starcraftPath: model.starcraftPath },
        {
          onSuccess: () => {},
          onError: () => {},
        },
      ),
    )
  })

  const { bindInput, getInputValue, setInputValue, onSubmit } = useForm(
    {
      starcraftPath: localSettings.starcraftPath,
    },
    {},
    { onValidatedChange },
  )

  const onBrowseClick = useStableCallback(async () => {
    const currentPath = getInputValue('starcraftPath') || ''

    const selection = await ipcRenderer.invoke('settingsBrowseForStarcraft', currentPath)!
    const selectedPath = selection.filePaths[0]
    browseButtonRef.current?.blur()

    if (selection.canceled || currentPath.toLowerCase() === selectedPath.toLowerCase()) return

    setInputValue('starcraftPath', normalizePath(selectedPath))
  })

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
      <FormContainer>
        <div>
          <Instructions>
            {t(
              'settings.game.starcraft.instructions.topPart',
              'Please select the directory where you have installed StarCraft: Remastered.',
            )}
          </Instructions>
          <Instructions>
            <Trans t={t} i18nKey='settings.game.starcraft.instructions.bottomPart'>
              This is usually <ExampleText>C:\Program Files (x86)\StarCraft</ExampleText> but may be
              elsewhere if you have customized it in the Battle.net launcher.
            </Trans>
          </Instructions>

          <SelectFolderContainer>
            <PathContainer onClick={onBrowseClick}>
              <StyledTextField
                {...bindInput('starcraftPath')}
                label={t('settings.game.starcraft.folderPath', 'StarCraft folder path')}
                disabled={true}
              />
            </PathContainer>
            <BrowseButtonContainer>
              <RaisedButton
                ref={browseButtonRef}
                label={t('common.actions.browse', 'Browse')}
                onClick={onBrowseClick}
              />
            </BrowseButtonContainer>
          </SelectFolderContainer>
        </div>
      </FormContainer>
    </form>
  )
}
