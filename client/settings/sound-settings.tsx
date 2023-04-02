import React, { useImperativeHandle, useMemo } from 'react'
import styled from 'styled-components'
import { ALL_ANNOUNCERS, Announcer, getAnnouncerName } from '../../common/blizz-settings'
import { useForm } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import CheckBox from '../material/check-box'
import { SelectOption } from '../material/select/option'
import { Select } from '../material/select/select'
import Slider from '../material/slider'
import { colorTextSecondary } from '../styles/colors'
import { overline } from '../styles/typography'
import { FormContainer } from './settings-content'
import { SettingsFormHandle } from './settings-form-ref'
import { ScrSettings } from './settings-records'
import { useTranslation } from 'react-i18next'

const MusicVolumeSlider = styled(Slider)`
  margin-bottom: 40px;
`

const AnnouncerOverline = styled.div`
  ${overline};
  color: ${colorTextSecondary};
  margin-top: 40px;
  margin-bottom: 8px;
`

interface SoundSettingsModel {
  musicOn: boolean
  musicVolume: number
  soundOn: boolean
  soundVolume: number
  selectedAnnouncer: Announcer
  unitSpeechOn: boolean
  unitAcknowledgementsOn: boolean
  backgroundSoundsOn: boolean
  buildingSoundsOn: boolean
  gameSubtitlesOn: boolean
  cinematicSubtitlesOn: boolean
  originalVoiceOversOn: boolean
}

const SoundSettingsForm = React.forwardRef<
  SettingsFormHandle,
  {
    model: SoundSettingsModel
    onChange: (model: SoundSettingsModel) => void
    onSubmit: (model: SoundSettingsModel) => void
  }
>((props, ref) => {
  const { bindCheckable, bindCustom, getInputValue, onSubmit } = useForm(
    props.model,
    {},
    { onChange: props.onChange, onSubmit: props.onSubmit },
  )
  const { t } = useTranslation()
  useImperativeHandle(ref, () => ({
    submit: onSubmit,
  }))

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
      <FormContainer>
        <div>
          <CheckBox {...bindCheckable('musicOn')} label='Music' inputProps={{ tabIndex: 0 }} />
          <MusicVolumeSlider
            {...bindCustom('musicVolume')}
            label={t('settings.soundSettings.musicVolumeLabel', 'Music volume')}
            tabIndex={0}
            min={0}
            max={100}
            step={5}
            disabled={!getInputValue('musicOn')}
            showTicks={false}
          />
          <CheckBox
            {...bindCheckable('soundOn')}
            label={t('settings.soundSettings.gameSoundLabel', 'Game sounds')}
            inputProps={{ tabIndex: 0 }}
          />
          <Slider
            {...bindCustom('soundVolume')}
            label={t('settings.soundSettings.soundVolumeLabel', 'Sound volume')}
            tabIndex={0}
            min={0}
            max={100}
            step={5}
            disabled={!getInputValue('soundOn')}
            showTicks={false}
          />

          <AnnouncerOverline>{t('settings.soundSettings.announcerPackHeaderText', 'Packs (must be purchased from Blizzard)')}</AnnouncerOverline>
          <Select {...bindCustom('selectedAnnouncer')} label={t('settings.soundSettings.announcerLabel', 'Announcer')} tabIndex={0}>
            {ALL_ANNOUNCERS.map(announcer => (
              <SelectOption key={announcer} value={announcer} text={getAnnouncerName(announcer)} />
            ))}
          </Select>
        </div>
        <div>
          <CheckBox
            {...bindCheckable('unitSpeechOn')}
            label={t('settings.soundSettings.unitSpeechLabel', 'Unit speech')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('unitAcknowledgementsOn')}
            label={t('settings.soundSettings.unitAcknowledgmentsLabel', 'Unit acknowledgments')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('backgroundSoundsOn')}
            label={t('settings.soundSettings.backgroundSoundsLabel', 'Sound plays while in background')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('buildingSoundsOn')}
            label={t('settings.soundSettings.buildingSoundsLabel', 'Building sounds')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('gameSubtitlesOn')}
            label={t('settings.soundSettings.gameSubtitlesLabel', 'Game subtitles')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('cinematicSubtitlesOn')}
            label={t('settings.soundSettings.cinematicSubtitlesLabel', 'Cinematic subtitles')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('originalVoiceOversOn')}
            label={t('settings.soundSettings.originalUnitVoiceOversLabel', 'Original unit voice overs')}
            inputProps={{ tabIndex: 0 }}
          />
        </div>
      </FormContainer>
    </form>
  )
})

export interface SoundSettingsProps {
  scrSettings: ScrSettings
  formRef: React.Ref<SettingsFormHandle>
  onChange: (model: SoundSettingsModel) => void
  onSubmit: (model: SoundSettingsModel) => void
}

export default function SoundSettings({
  scrSettings,
  formRef,
  onChange,
  onSubmit,
}: SoundSettingsProps) {
  const formModel = useMemo(() => ({ ...scrSettings.toJS() } as SoundSettingsModel), [scrSettings])

  return (
    <SoundSettingsForm ref={formRef} model={formModel} onChange={onChange} onSubmit={onSubmit} />
  )
}
