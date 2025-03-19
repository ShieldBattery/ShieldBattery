import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { DEV_INDICATOR } from '../../../common/flags'
import {
  ALL_CONSOLE_SKINS,
  ALL_INGAME_SKINS,
  ConsoleSkin,
  getConsoleSkinName,
  getIngameSkinName,
  IngameSkin,
} from '../../../common/settings/blizz-settings'
import {
  ALL_STARTING_FOG,
  getStartingFogLabel,
  StartingFog,
} from '../../../common/settings/local-settings'
import { useForm, useFormCallbacks, Validator } from '../../forms/form-hook'
import SubmitOnEnter from '../../forms/submit-on-enter'
import { CheckBox } from '../../material/check-box'
import { NumberTextField } from '../../material/number-text-field'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { mergeLocalSettings, mergeScrSettings } from '../action-creators'
import { FormContainer, SectionOverline } from '../settings-content'

const BonusSkinsCheckBox = styled(CheckBox)`
  margin-bottom: 8px;
`

interface GameplaySettingsModel {
  apmAlertOn: boolean
  apmAlertColorOn: boolean
  apmAlertSoundOn: boolean
  apmAlertValue: number
  apmDisplayOn: boolean
  colorCyclingOn: boolean
  consoleSkin: ConsoleSkin
  gameTimerOn: boolean
  minimapPosition: boolean
  showBonusSkins: boolean
  selectedSkin: IngameSkin
  unitPortraits: number
  showTurnRate: boolean
  startingFog: StartingFog
  // Dev-only settings
  visualizeNetworkStalls?: boolean
}

function validateApmValue(): Validator<number, GameplaySettingsModel> {
  return (val, model, _dirty, t) => {
    if (!model.apmAlertOn) {
      return undefined
    }

    return val <= 0 || val > 999
      ? t('settings.game.gameplay.apmValueValidation', 'Enter a value between 1 and 999')
      : undefined
  }
}

export function GameplaySettings() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const localSettings = useAppSelector(s => s.settings.local)
  const scrSettings = useAppSelector(s => s.settings.scr)

  const { bindCustom, bindCheckable, getInputValue, submit, form } = useForm<GameplaySettingsModel>(
    {
      ...scrSettings,
      visualizeNetworkStalls: localSettings.visualizeNetworkStalls,
      startingFog: localSettings.startingFog,
    },
    { apmAlertValue: validateApmValue() },
  )

  useFormCallbacks(form, {
    onValidatedChange: model => {
      dispatch(
        mergeScrSettings(
          {
            apmAlertOn: model.apmAlertOn,
            apmAlertColorOn: model.apmAlertColorOn,
            apmAlertSoundOn: model.apmAlertSoundOn,
            apmAlertValue: model.apmAlertValue,
            apmDisplayOn: model.apmDisplayOn,
            colorCyclingOn: model.colorCyclingOn,
            consoleSkin: model.consoleSkin,
            gameTimerOn: model.gameTimerOn,
            minimapPosition: model.minimapPosition,
            showBonusSkins: model.showBonusSkins,
            selectedSkin: model.selectedSkin,
            unitPortraits: model.unitPortraits,
            showTurnRate: model.showTurnRate,
          },
          {
            onSuccess: () => {},
            onError: () => {},
          },
        ),
      )
      dispatch(
        mergeLocalSettings(
          {
            startingFog: model.startingFog,
          },
          {
            onSuccess: () => {},
            onError: () => {},
          },
        ),
      )

      if (DEV_INDICATOR) {
        dispatch(
          mergeLocalSettings(
            {
              visualizeNetworkStalls: model.visualizeNetworkStalls,
            },
            {
              onSuccess: () => {},
              onError: () => {},
            },
          ),
        )
      }
    },
  })

  return (
    <form noValidate={true} onSubmit={submit}>
      <SubmitOnEnter />
      <FormContainer>
        <div>
          <Select
            {...bindCustom('unitPortraits')}
            label={t('settings.game.gameplay.unitPortraits.title', 'Portraits')}
            tabIndex={0}>
            <SelectOption
              value={2}
              text={t('settings.game.gameplay.unitPortraits.animated', 'Animated')}
            />
            <SelectOption
              value={1}
              text={t('settings.game.gameplay.unitPortraits.still', 'Still')}
            />
            <SelectOption
              value={0}
              text={t('settings.game.gameplay.unitPortraits.disabled', 'Disabled')}
            />
          </Select>
          <Select
            {...bindCustom('minimapPosition')}
            label={t('settings.game.gameplay.minimapPosition.title', 'Minimap position')}
            tabIndex={0}>
            <SelectOption
              value={true}
              text={t('settings.game.gameplay.minimapPosition.bottomLeft', 'Bottom-left corner')}
            />
            <SelectOption
              value={false}
              text={t('settings.game.gameplay.minimapPosition.standard', 'Standard')}
            />
          </Select>
          <Select
            {...bindCustom('startingFog')}
            label={t('settings.game.gameplay.startingFog.title', 'Starting fog of war')}
            tabIndex={0}>
            {ALL_STARTING_FOG.map(fog => (
              <SelectOption key={fog} value={fog} text={getStartingFogLabel(fog, t)} />
            ))}
          </Select>
        </div>
        <div>
          <SectionOverline>
            {t('settings.game.gameplay.skinsInfo', 'Skins (must be purchased from Blizzard)')}
          </SectionOverline>
          <BonusSkinsCheckBox
            {...bindCheckable('showBonusSkins')}
            label={t('settings.game.gameplay.showBonusSkins', 'Show bonus skins')}
            inputProps={{ tabIndex: 0 }}
          />
          <Select
            {...bindCustom('selectedSkin')}
            label={t('settings.game.gameplay.ingameSkins.title', 'Ingame skin')}
            tabIndex={0}
            disabled={!getInputValue('showBonusSkins')}>
            {ALL_INGAME_SKINS.map(skin => (
              <SelectOption
                key={skin || 'default'}
                value={skin}
                text={getIngameSkinName(skin, t)}
              />
            ))}
          </Select>
          <Select
            {...bindCustom('consoleSkin')}
            label={t('settings.game.gameplay.consoleSkins.title', 'Console skin')}
            tabIndex={0}>
            {ALL_CONSOLE_SKINS.map(skin => (
              <SelectOption key={skin} value={skin} text={getConsoleSkinName(skin, t)} />
            ))}
          </Select>
        </div>
        <div>
          <CheckBox
            {...bindCheckable('gameTimerOn')}
            label={t('settings.game.gameplay.gameTimer', 'Game timer')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('apmDisplayOn')}
            label={t('settings.game.gameplay.apmDisplay', 'APM display')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('colorCyclingOn')}
            label={t('settings.game.gameplay.colorCycling', 'Enable color cycling')}
            inputProps={{ tabIndex: 0 }}
          />
          <CheckBox
            {...bindCheckable('showTurnRate')}
            label={t('settings.game.gameplay.latency', 'Show latency')}
            inputProps={{ tabIndex: 0 }}
          />
        </div>
        <div>
          <SectionOverline>
            {t('settings.game.gameplay.apmAlertHeader', 'APM alert')}
          </SectionOverline>
          <CheckBox
            {...bindCheckable('apmAlertOn')}
            label={t('settings.game.gameplay.apmAlert', 'Alert when APM falls below')}
            inputProps={{ tabIndex: 0 }}
          />
          <NumberTextField
            {...bindCustom('apmAlertValue')}
            floatingLabel={false}
            dense={true}
            label={t('settings.game.gameplay.apmValue', 'APM value')}
            inputProps={{ min: 0, max: 999 }}
            disabled={!getInputValue('apmAlertOn')}
          />
          <CheckBox
            {...bindCheckable('apmAlertColorOn')}
            label={t('settings.game.gameplay.apmColorText', 'Color text')}
            inputProps={{ tabIndex: 0 }}
            disabled={!getInputValue('apmAlertOn')}
          />
          <CheckBox
            {...bindCheckable('apmAlertSoundOn')}
            label={t('settings.game.gameplay.apmSound', 'Play sound')}
            inputProps={{ tabIndex: 0 }}
            disabled={!getInputValue('apmAlertOn')}
          />
        </div>
        {DEV_INDICATOR ? (
          <div>
            <SectionOverline>
              {t('settings.game.gameplay.devOnlySettings', 'Dev-only settings')}
            </SectionOverline>
            <CheckBox
              {...bindCheckable('visualizeNetworkStalls')}
              label={t('settings.game.gameplay.visualizeNetworkStalls', 'Visualize network stalls')}
              inputProps={{ tabIndex: 0 }}
            />
          </div>
        ) : null}
      </FormContainer>
    </form>
  )
}
