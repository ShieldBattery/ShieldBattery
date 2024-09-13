import React from 'react'
import { useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import {
  ALL_ANNOUNCERS,
  Announcer,
  getAnnouncerName,
} from '../../../common/settings/blizz-settings.js'
import { useForm } from '../../forms/form-hook.js'
import SubmitOnEnter from '../../forms/submit-on-enter.js'
import { CheckBox } from '../../material/check-box.js'
import { SelectOption } from '../../material/select/option.js'
import { Select } from '../../material/select/select.js'
import Slider from '../../material/slider.js'
import { useAppDispatch, useAppSelector } from '../../redux-hooks.js'
import { useStableCallback } from '../../state-hooks.js'
import { colorTextSecondary } from '../../styles/colors.js'
import { overline } from '../../styles/typography.js'
import { mergeScrSettings } from '../action-creators.js'
import { FormContainer } from '../settings-content.js'

const AnnouncerOverline = styled.div`
  ${overline};
  color: ${colorTextSecondary};
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
  const { t } = useTranslation()
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
          <CheckBox
            {...bindCheckable('musicOn')}
            label={t('settings.game.sound.music', 'Music')}
            inputProps={{ tabIndex: 0 }}
          />
          <Slider
            {...bindCustom('musicVolume')}
            label={t('settings.game.sound.musicVolume', 'Music volume')}
            tabIndex={0}
            min={0}
            max={100}
            step={5}
            disabled={!getInputValue('musicOn')}
            showTicks={false}
          />
        </div>
        <div>
          <CheckBox
            {...bindCheckable('soundOn')}
            label={t('settings.game.sound.gameSounds', 'Game sounds')}
            inputProps={{ tabIndex: 0 }}
          />
          <Slider
            {...bindCustom('soundVolume')}
            label={t('settings.game.sound.soundVolume', 'Sound volume')}
            tabIndex={0}
            min={0}
            max={100}
            step={5}
            disabled={!getInputValue('soundOn')}
            showTicks={false}
          />
        </div>
        <div>
          <AnnouncerOverline>
            {t('settings.game.sound.announcer.info', 'Packs (must be purchased from Blizzard)')}
          </AnnouncerOverline>
          <Select
            {...bindCustom('selectedAnnouncer')}
            label={t('settings.game.sound.announcer.title', 'Announcer')}
            allowErrors={false}
            tabIndex={0}>
            {ALL_ANNOUNCERS.map(announcer => (
              <SelectOption
                key={announcer}
                value={announcer}
                text={getAnnouncerName(announcer, t)}
              />
            ))}
          </Select>
        </div>
        <div>
          <CheckBox
            {...bindCheckable('unitSpeechOn')}
            label={t('settings.game.sound.unitSpeech', 'Unit speech')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('unitAcknowledgementsOn')}
            label={t('settings.game.sound.unitAcknowledgements', 'Unit acknowledgements')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('backgroundSoundsOn')}
            label={t('settings.game.sound.backgroundSounds', 'Sound plays while in background')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('buildingSoundsOn')}
            label={t('settings.game.sound.buildingSounds', 'Building sounds')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('gameSubtitlesOn')}
            label={t('settings.game.sound.gameSubtitles', 'Game subtitles')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('cinematicSubtitlesOn')}
            label={t('settings.game.sound.cinematicSubtitles', 'Cinematic subtitles')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('originalVoiceOversOn')}
            label={t('settings.game.sound.originalVoiceOvers', 'Original unit voice overs')}
            inputProps={{ tabIndex: 0 }}
          />
        </div>
      </FormContainer>
    </form>
  )
}
