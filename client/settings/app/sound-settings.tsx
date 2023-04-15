import React, { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { LocalSettings, ShieldBatteryAppSettings } from '../../../common/settings/local-settings'
import audioManager, { AvailableSound } from '../../audio/audio-manager'
import { useForm } from '../../forms/form-hook'
import SubmitOnEnter from '../../forms/submit-on-enter'
import { MaterialIcon } from '../../icons/material/material-icon'
import { TextButton } from '../../material/button'
import Slider from '../../material/slider'
import { useAppSelector } from '../../redux-hooks'
import { useStableCallback } from '../../state-hooks'
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

function AppSoundSettingsForm({
  localSettings,
  isPlayingTestSound,
  onTestSoundClick,
  onValidatedChange,
}: {
  localSettings: Omit<LocalSettings, keyof ShieldBatteryAppSettings>
  isPlayingTestSound: boolean
  onTestSoundClick: () => void
  onValidatedChange: (model: Readonly<AppSoundSettingsModel>) => void
}) {
  const { bindCustom, onSubmit } = useForm(
    {
      masterVolume: localSettings.masterVolume,
    },
    {},
    { onValidatedChange },
  )

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
      <FormContainer>
        <div>
          <VolumeSettings>
            <StyledSlider
              {...bindCustom('masterVolume')}
              label='Master volume'
              tabIndex={0}
              min={0}
              max={100}
              step={1}
              showTicks={false}
            />
            <TestSoundButton
              label={isPlayingTestSound ? 'Stop' : 'Test'}
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

export function AppSoundSettings() {
  const localSettings = useAppSelector(s => s.settings.local)
  const [isPlayingTestSound, setIsPlayingTestSound] = useState(false)
  const playingSoundRef = useRef<AudioBufferSourceNode>()

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

  const onValidatedChange = useStableCallback((model: Readonly<AppSoundSettingsModel>) => {
    console.log(model)
    // audioManager.setMasterVolume(volume)
  })

  useEffect(() => cleanupSound(), [cleanupSound])

  return (
    <AppSoundSettingsForm
      localSettings={localSettings}
      isPlayingTestSound={isPlayingTestSound}
      onTestSoundClick={onTestSoundClick}
      onValidatedChange={onValidatedChange}
    />
  )
}
