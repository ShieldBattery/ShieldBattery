import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import styled from 'styled-components'
import audioManager, { AvailableSound } from '../audio/audio-manager'
import { useForm } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import PlayIcon from '../icons/material/play_arrow-24px.svg'
import StopIcon from '../icons/material/stop-24px.svg'
import { TextButton } from '../material/button'
import CheckBox from '../material/check-box'
import Slider from '../material/slider'
import { useAppDispatch } from '../redux-hooks'
import { resetMasterVolume } from './action-creators'
import { FormContainer } from './settings-content'
import { SettingsFormHandle } from './settings-form-ref'
import { LocalSettings } from './settings-records'

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
  min-width: 104px;
  margin-left: 16px;
  padding-left: 12px;

  svg {
    margin-right: 8px;
  }
`

const IndentedCheckbox = styled(CheckBox)`
  margin-left: 28px;
`

interface AppSettingsModel {
  masterVolume: number
  runAppAtSystemStart: boolean
  runAppAtSystemStartMinimized: boolean
}

const AppSettingsForm = React.forwardRef<
  SettingsFormHandle,
  {
    model: AppSettingsModel
    onChange: (model: AppSettingsModel) => void
    onSubmit: (model: AppSettingsModel) => void
    onMasterVolumeChange: (volume: number) => void
    isPlayingTestSound: boolean
    onTestSoundClick: () => void
  }
>((props, ref) => {
  const { bindCheckable, bindCustom, onSubmit, getInputValue } = useForm(
    props.model,
    {},
    { onChange: props.onChange, onSubmit: props.onSubmit },
  )

  useImperativeHandle(ref, () => ({
    submit: onSubmit,
  }))

  const { onChange: formOnMasterVolumeChange } = bindCustom('masterVolume')
  const propsOnMasterVolumeChange = props.onMasterVolumeChange
  const onMasterVolumeChange = useCallback(
    (volume: number) => {
      formOnMasterVolumeChange(volume)
      propsOnMasterVolumeChange(volume)
    },
    [formOnMasterVolumeChange, propsOnMasterVolumeChange],
  )

  const testSoundLabel = props.isPlayingTestSound ? (
    <>
      <StopIcon />
      <span>Stop</span>
    </>
  ) : (
    <>
      <PlayIcon />
      <span>Test</span>
    </>
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
              onChange={onMasterVolumeChange}
            />
            <TestSoundButton label={testSoundLabel} onClick={props.onTestSoundClick} />
          </VolumeSettings>
        </div>
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
})

export interface AppSettingsProps {
  localSettings: LocalSettings
  formRef: React.Ref<SettingsFormHandle>
  onChange: (values: AppSettingsModel) => void
  onSubmit: (values: AppSettingsModel) => void
}

export default function AppSettings({
  localSettings,
  formRef,
  onChange,
  onSubmit,
}: AppSettingsProps) {
  const dispatch = useAppDispatch()
  const [isPlayingTestSound, setIsPlayingTestSound] = useState(false)
  const hasSavedSettingsRef = useRef(false)
  const playingSoundRef = useRef<AudioBufferSourceNode>()

  const cleanupSound = useCallback(() => {
    if (playingSoundRef.current) {
      setIsPlayingTestSound(false)
      playingSoundRef.current.stop()
      playingSoundRef.current = undefined
    }
  }, [])
  const onMasterVolumeChange = useCallback((volume: number) => {
    audioManager.setMasterVolume(volume)
  }, [])
  const onTestSoundClick = useCallback(() => {
    cleanupSound()
    const sound = audioManager.playSound(AvailableSound.MatchFound)
    playingSoundRef.current = sound

    const endedListener = () => {
      sound?.removeEventListener('ended', endedListener)
      cleanupSound()
    }
    sound?.addEventListener('ended', endedListener)

    setIsPlayingTestSound(true)
  }, [cleanupSound])
  const trackingOnChange = useCallback(
    (model: AppSettingsModel) => {
      hasSavedSettingsRef.current = false
      onChange(model)
    },
    [onChange],
  )
  const trackingOnSubmit = useCallback(
    (model: AppSettingsModel) => {
      hasSavedSettingsRef.current = true
      onSubmit(model)
    },
    [onSubmit],
  )

  useEffect(() => {
    return () => {
      cleanupSound()

      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (!hasSavedSettingsRef.current) {
        dispatch(resetMasterVolume())
      }
    }
  }, [dispatch, cleanupSound])

  const formModel = useMemo<AppSettingsModel>(
    () => ({
      masterVolume: localSettings.masterVolume,
      runAppAtSystemStart: localSettings.runAppAtSystemStart,
      runAppAtSystemStartMinimized: localSettings.runAppAtSystemStartMinimized,
    }),
    [localSettings],
  )

  return (
    <AppSettingsForm
      ref={formRef}
      model={formModel}
      onChange={trackingOnChange}
      onSubmit={trackingOnSubmit}
      onMasterVolumeChange={onMasterVolumeChange}
      isPlayingTestSound={isPlayingTestSound}
      onTestSoundClick={onTestSoundClick}
    />
  )
}
