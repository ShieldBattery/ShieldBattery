import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import audioManager, { AvailableSound } from '../../audio/audio-manager'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import SubmitOnEnter from '../../forms/submit-on-enter'
import { MaterialIcon } from '../../icons/material/material-icon'
import { TextButton } from '../../material/button'
import { Slider } from '../../material/slider'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { mergeLocalSettings } from '../action-creators'
import { FormContainer } from '../settings-content'

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
  const playingSoundRef = useRef<AudioBufferSourceNode>(undefined)

  const cleanupSound = useCallback(() => {
    if (playingSoundRef.current) {
      setIsPlayingTestSound(false)
      playingSoundRef.current.stop()
      playingSoundRef.current = undefined
    }
  }, [])

  useEffect(() => {
    return () => {
      cleanupSound()
    }
  }, [cleanupSound])

  const { bindCustom, submit, form } = useForm<AppSoundSettingsModel>(
    {
      masterVolume: localSettings.masterVolume,
    },
    {},
  )

  useFormCallbacks(form, {
    onSubmit: model => {
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
    },
  })

  return (
    <form noValidate={true} onSubmit={submit}>
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
              onClick={() => {
                cleanupSound()
                const sound = audioManager.playSound(AvailableSound.MatchFound)
                playingSoundRef.current = sound

                const endedListener = () => {
                  sound?.removeEventListener('ended', endedListener)
                  cleanupSound()
                }
                sound?.addEventListener('ended', endedListener)

                setIsPlayingTestSound(true)
              }}
            />
          </VolumeSettings>
        </div>
      </FormContainer>
    </form>
  )
}
