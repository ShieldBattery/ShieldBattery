import React from 'react'
import styled from 'styled-components'
import {
  ALL_ANNOUNCERS,
  Announcer,
  getAnnouncerName,
} from '../../../common/settings/blizz-settings'
import { useForm } from '../../forms/form-hook'
import SubmitOnEnter from '../../forms/submit-on-enter'
import CheckBox from '../../material/check-box'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import Slider from '../../material/slider'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { useStableCallback } from '../../state-hooks'
import { colorTextSecondary } from '../../styles/colors'
import { overline } from '../../styles/typography'
import { mergeScrSettings } from '../action-creators'
import { FormContainer } from '../settings-content'

const MusicVolumeSlider = styled(Slider)`
  margin-bottom: 40px;
`

const AnnouncerOverline = styled.div`
  ${overline};
  color: ${colorTextSecondary};
  margin-top: 40px;
  margin-bottom: 8px;
`

interface GameSoundSettingsModel {
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

export function GameSoundSettings() {
  const dispatch = useAppDispatch()
  const scrSettings = useAppSelector(s => s.settings.scr)

  const onValidatedChange = useStableCallback((model: Readonly<GameSoundSettingsModel>) => {
    dispatch(
      mergeScrSettings(
        {
          musicOn: model.musicOn,
          musicVolume: model.musicVolume,
          soundOn: model.soundOn,
          soundVolume: model.soundVolume,
          selectedAnnouncer: model.selectedAnnouncer,
          unitSpeechOn: model.unitSpeechOn,
          unitAcknowledgementsOn: model.unitAcknowledgementsOn,
          backgroundSoundsOn: model.backgroundSoundsOn,
          buildingSoundsOn: model.buildingSoundsOn,
          gameSubtitlesOn: model.gameSubtitlesOn,
          cinematicSubtitlesOn: model.cinematicSubtitlesOn,
          originalVoiceOversOn: model.originalVoiceOversOn,
        },
        {
          onSuccess: () => {},
          onError: () => {},
        },
      ),
    )
  })

  const { bindCheckable, bindCustom, getInputValue, onSubmit } = useForm(
    { ...scrSettings },
    {},
    { onValidatedChange },
  )

  return (
    <form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter />
      <FormContainer>
        <div>
          <CheckBox {...bindCheckable('musicOn')} label='Music' inputProps={{ tabIndex: 0 }} />
          <MusicVolumeSlider
            {...bindCustom('musicVolume')}
            label='Music volume'
            tabIndex={0}
            min={0}
            max={100}
            step={5}
            disabled={!getInputValue('musicOn')}
            showTicks={false}
          />
          <CheckBox
            {...bindCheckable('soundOn')}
            label='Game sounds'
            inputProps={{ tabIndex: 0 }}
          />
          <Slider
            {...bindCustom('soundVolume')}
            label='Sound volume'
            tabIndex={0}
            min={0}
            max={100}
            step={5}
            disabled={!getInputValue('soundOn')}
            showTicks={false}
          />

          <AnnouncerOverline>Packs (must be purchased from Blizzard)</AnnouncerOverline>
          <Select {...bindCustom('selectedAnnouncer')} label='Announcer' tabIndex={0}>
            {ALL_ANNOUNCERS.map(announcer => (
              <SelectOption key={announcer} value={announcer} text={getAnnouncerName(announcer)} />
            ))}
          </Select>
        </div>
        <div>
          <CheckBox
            {...bindCheckable('unitSpeechOn')}
            label='Unit speech'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('unitAcknowledgementsOn')}
            label='Unit acknowledgements'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('backgroundSoundsOn')}
            label='Sound plays while in background'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('buildingSoundsOn')}
            label='Building sounds'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('gameSubtitlesOn')}
            label='Game subtitles'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('cinematicSubtitlesOn')}
            label='Cinematic subtitles'
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('originalVoiceOversOn')}
            label='Original unit voice overs'
            inputProps={{ tabIndex: 0 }}
          />
        </div>
      </FormContainer>
    </form>
  )
}
