import React, { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import { DEV_INDICATOR } from '../../../common/flags.js'
import { TypedIpcRenderer } from '../../../common/ipc.js'
import { useForm } from '../../forms/form-hook.js'
import SubmitOnEnter from '../../forms/submit-on-enter.js'
import { MaterialIcon } from '../../icons/material/material-icon.js'
import logger from '../../logging/logger.js'
import { RaisedButton } from '../../material/button.js'
import { CheckBox } from '../../material/check-box.js'
import { Tooltip } from '../../material/tooltip.js'
import { useAppDispatch, useAppSelector } from '../../redux-hooks.js'
import { useStableCallback } from '../../state-hooks.js'
import { background500, colorError, colorSuccess } from '../../styles/colors.js'
import { selectableTextContainer } from '../../styles/text-selection.js'
import { Overline, Subtitle1, body1, subtitle1, subtitle2 } from '../../styles/typography.js'
import { mergeLocalSettings } from '../action-creators.js'
import { FormContainer, SectionOverline } from '../settings-content.js'

const ipcRenderer = new TypedIpcRenderer()

function normalizePath(path: string) {
  return path?.replace(/\\(x86|x86_64)\\?$/, '')
}

const Layout = styled.div`
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 16px;
`

const CurrentPath = styled.div`
  display: flex;

  line-height: 24px;
  align-items: center;
  gap: 8px;
`

const CurrentPathValueContainer = styled.div`
  ${selectableTextContainer};
`

const CurrentPathValue = styled.div`
  ${subtitle2};
  padding: 0 4px;
  background-color: ${background500};
  border-radius: 2px;
`

const ValidIcon = styled(MaterialIcon).attrs({ icon: 'check' })`
  color: ${colorSuccess};
`

const InvalidIcon = styled(MaterialIcon).attrs({ icon: 'error' })`
  color: ${colorError};
`

const Instructions = styled.div`
  ${body1};
`

const DetectionFailure = styled.div`
  ${subtitle1};
  color: ${colorError};
`

const AdvancedOverline = styled(Overline)`
  margin-top: 48px;
`

interface StarcraftSettingsModel {
  starcraftPath: string
  launch64Bit?: boolean
  disableHd?: boolean
}

export function StarcraftSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)
  const isValidInstall = useAppSelector(s => s.starcraft.pathValid && s.starcraft.versionValid)
  const browseButtonRef = useRef<HTMLButtonElement>(null)
  const [detectionFailed, setDetectionFailed] = useState(false)

  const onValidatedChange = useStableCallback((model: Readonly<StarcraftSettingsModel>) => {
    dispatch(
      mergeLocalSettings(
        {
          starcraftPath: model.starcraftPath,
          launch64Bit: model.launch64Bit || false,
          disableHd: model.disableHd || false,
        },
        {
          onSuccess: () => {},
          onError: () => {},
        },
      ),
    )
  })

  const { bindCheckable, getInputValue, setInputValue, onSubmit } = useForm(
    {
      starcraftPath: localSettings.starcraftPath,
      launch64Bit: localSettings.launch64Bit,
      disableHd: localSettings.disableHd,
    },
    {},
    { onValidatedChange },
  )

  const onDetectPathClick = useStableCallback(() => {
    setDetectionFailed(false)
    Promise.resolve()
      .then(async () => {
        const pathFound = await ipcRenderer.invoke('settingsAutoPickStarcraftPath')
        if (!pathFound) {
          logger.warning('Failed to detect StarCraft folder')
          setDetectionFailed(true)
        }
      })
      .catch(err => {
        logger.error(`Failed to detect StarCraft folder: ${err?.stack ?? err}`)
        setDetectionFailed(true)
      })
  })

  const onBrowseClick = useStableCallback(() => {
    setDetectionFailed(false)
    Promise.resolve()
      .then(async () => {
        const currentPath = getInputValue('starcraftPath') || ''

        const selection = await ipcRenderer.invoke('settingsBrowseForStarcraft', currentPath)!
        const selectedPath = selection.filePaths[0]
        browseButtonRef.current?.blur()

        if (selection.canceled || currentPath.toLowerCase() === selectedPath.toLowerCase()) return

        setInputValue('starcraftPath', normalizePath(selectedPath))
      })
      .catch(err => {
        logger.error(`Failed to browse for StarCraft folder: ${err?.stack ?? err}`)
      })
  })

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
      <FormContainer>
        <Layout>
          <CurrentPath>
            <Subtitle1>
              {t('settings.game.starcraft.currentPathLabel', 'Current game path:')}
            </Subtitle1>
            {localSettings.starcraftPath ? (
              <>
                <CurrentPathValueContainer>
                  <CurrentPathValue>{localSettings.starcraftPath}</CurrentPathValue>
                </CurrentPathValueContainer>
                {isValidInstall ? (
                  <Tooltip
                    text={t(
                      'settings.game.starcraft.pathValid',
                      'This game path appears to be a valid installation.',
                    )}>
                    <ValidIcon />
                  </Tooltip>
                ) : (
                  <Tooltip
                    text={t(
                      'settings.game.starcraft.pathInvalid',
                      'This path does not point to a valid StarCraft: Remastered installation. ' +
                        'Please ensure your installation is up to date or try a different path.',
                    )}>
                    <InvalidIcon />
                  </Tooltip>
                )}
              </>
            ) : (
              <></>
            )}
          </CurrentPath>

          <Instructions>
            {t(
              'settings.game.starcraft.instructions.description',
              'ShieldBattery requires a valid, up-to-date installation of StarCraft: Remastered. ' +
                'Click the button below to automatically detect the installation folder.',
            )}
          </Instructions>

          {detectionFailed ? (
            <DetectionFailure>
              {t(
                'settings.game.starcraft.detectionFailed',
                'Detecting your installation path failed. Please ensure you have ' +
                  'StarCraft: Remastered installed and try again, or set the path manually.',
              )}
            </DetectionFailure>
          ) : undefined}

          <RaisedButton
            onClick={onDetectPathClick}
            label={t('settings.game.starcraft.detectPath', 'Detect installation')}
          />

          <AdvancedOverline>Advanced</AdvancedOverline>

          <Instructions>
            {t(
              'settings.game.starcraft.instructions.advanced',
              'If detection fails, you can set the path manually. Click the button below and ' +
                'select the directory that contains your StarCraft: Remastered installation.',
            )}
          </Instructions>

          <RaisedButton
            ref={browseButtonRef}
            label={t('settings.game.starcraft.browseManually', 'Browse manually')}
            onClick={onBrowseClick}
          />
          {DEV_INDICATOR ? (
            <div>
              <SectionOverline>
                {t('settings.game.starcraft.devOnlySettings', 'Dev-only settings')}
              </SectionOverline>
              <CheckBox
                {...bindCheckable('disableHd')}
                label={t(
                  'settings.game.starcraft.disableHd',
                  "Don't load HD graphics (Crashes if switching to HD in game)",
                )}
                inputProps={{ tabIndex: 0 }}
              />
              <CheckBox
                {...bindCheckable('launch64Bit')}
                label={t('settings.game.starcraft.launch64Bit', 'Launch 64-bit executable')}
                inputProps={{ tabIndex: 0 }}
              />
            </div>
          ) : null}
        </Layout>
      </FormContainer>
    </form>
  )
}
