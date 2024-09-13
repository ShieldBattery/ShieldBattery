import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import audioManager, { AvailableSound } from '../../audio/audio-manager.js'
import { useForm } from '../../forms/form-hook.js'
import SubmitOnEnter from '../../forms/submit-on-enter.js'
import { MaterialIcon } from '../../icons/material/material-icon.js'
import { TextButton } from '../../material/button.js'
import Slider from '../../material/slider.js'
import { useAppDispatch, useAppSelector } from '../../redux-hooks.js'
import { useStableCallback } from '../../state-hooks.js'
import { mergeLocalSettings } from '../action-creators.js'
import { FormContainer } from '../settings-content.js'

const VolumeSettings = styled.div`
  display: flex;
  align-items: flex-end;
  width: 100%;
`

const StyledSlider = styled(Slider)`
  flex-grow: 1;
  margin-bottom: 8px;
`

const TestSoundButton = styled(TextButton)`
  min-width: 108px;
  margin-left: 16px;
  margin-bottom: 4px;
`

interface AppSoundSettingsModel {
  masterVolume: number
}

export function AppSoundSettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)
  const [isPlayingTestSound, setIsPlayingTestSound] = useState(false)
  const playingSoundRef = useRef<AudioBufferSourceNode>()

  const onValidatedChange = useStableCallback((model: Readonly<AppSoundSettingsModel>) => {
    dispatch(
      mergeLocalSettings(
        { masterVolume: model.masterVolume },
        {
          onSuccess: () => {
            audioManager.setMasterVolume(model.masterVolume)
          },
          onError: () => {},
        },
      ),
    )
  })

  const { bindCustom, onSubmit } = useForm(
    {
      masterVolume: localSettings.masterVolume,
    },
    {},
    { onValidatedChange },
  )

  const cleanupSound = useStableCallback(() => {
    if (playingSoundRef.current) {
      setIsPlayingTestSound(false)
      playingSoundRef.current.stop()
      playingSoundRef.current = undefined
    }
  })

  const onTestSoundClick = useStableCallback(() => {
    cleanupSound()
    const sound = audioManager.playSound(AvailableSound.MatchFound)
    playingSoundRef.current = sound

    const endedListener = () => {
      sound?.removeEventListener('ended', endedListener)
      cleanupSound()
    }
    sound?.addEventListener('ended', endedListener)

    setIsPlayingTestSound(true)
  })

  useEffect(() => {
    return () => {
      cleanupSound()
    }
  }, [cleanupSound])

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
      <FormContainer>
        <div>
          <VolumeSettings>
            <StyledSlider
              {...bindCustom('masterVolume')}
              label={t('settings.app.sound.masterVolume', 'Master volume')}
              tabIndex={0}
              min={0}
              max={100}
              step={1}
              showTicks={false}
            />
            <TestSoundButton
              label={
                isPlayingTestSound
                  ? t('common.actions.stop', 'Stop')
                  : t('common.actions.test', 'Test')
              }
              iconStart={
                isPlayingTestSound ? (
                  <MaterialIcon icon='stop' />
                ) : (
                  <MaterialIcon icon='play_arrow' />
                )
              }
              onClick={onTestSoundClick}
            />
          </VolumeSettings>
        </div>
      </FormContainer>
    </form>
  )
}
