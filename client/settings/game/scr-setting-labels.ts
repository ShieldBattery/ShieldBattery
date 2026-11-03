import { TFunction } from 'i18next'
import {
  getAnnouncerName,
  getConsoleSkinName,
  getDisplayModeName,
  getIngameSkinName,
} from '../../../common/settings/blizz-settings'
import { ScrSettings } from '../../../common/settings/local-settings'
import { GameSettingsPage } from '../settings-page'
import { gammaToSliderValue } from './video-settings'

export type ScrSettingKey = keyof Omit<ScrSettings, 'version'>

/** How the setting is displayed to the user, matching how its settings page presents it. */
interface ScrSettingInfo<K extends ScrSettingKey> {
  label: (t: TFunction) => string
  /** The settings page the setting is changed on. */
  page: GameSettingsPage
  format: (value: ScrSettings[K], t: TFunction) => string
}

type ScrSettingInfos = { [K in ScrSettingKey]: ScrSettingInfo<K> }

function onOff(value: boolean, t: TFunction): string {
  return value ? t('material.segmentedButton.on', 'On') : t('material.segmentedButton.off', 'Off')
}

function plainNumber(value: number): string {
  return String(value)
}

// Adding a key to `ScrSettings` fails to compile here until it gets an entry.
const SCR_SETTING_INFOS: ScrSettingInfos = {
  keyboardScrollSpeed: {
    label: t => t('settings.game.input.keyboardScrollSpeed', 'Keyboard scroll speed'),
    page: GameSettingsPage.Input,
    format: plainNumber,
  },
  mouseScrollSpeed: {
    label: t => t('settings.game.input.mouseScrollSpeed', 'Mouse scroll speed'),
    page: GameSettingsPage.Input,
    format: plainNumber,
  },
  mouseSensitivityOn: {
    label: t => t('settings.game.input.customMouseSensitivity', 'Custom mouse sensitivity'),
    page: GameSettingsPage.Input,
    format: onOff,
  },
  mouseSensitivity: {
    label: t => t('settings.game.input.mouseSensitivity', 'Mouse sensitivity'),
    page: GameSettingsPage.Input,
    format: plainNumber,
  },
  mouseScalingOn: {
    label: t => t('settings.game.input.mouseScaling', 'Use mouse scaling'),
    page: GameSettingsPage.Input,
    format: onOff,
  },
  hardwareCursorOn: {
    label: t => t('settings.game.input.hardwareCursor', 'Hardware cursor'),
    page: GameSettingsPage.Input,
    format: onOff,
  },
  mouseConfineOn: {
    label: t => t('settings.game.input.lockCursor', 'Lock cursor to window'),
    page: GameSettingsPage.Input,
    format: onOff,
  },
  musicOn: {
    label: t => t('settings.game.sound.music', 'Music'),
    page: GameSettingsPage.Sound,
    format: onOff,
  },
  musicVolume: {
    label: t => t('settings.game.sound.musicVolume', 'Music volume'),
    page: GameSettingsPage.Sound,
    format: plainNumber,
  },
  soundOn: {
    label: t => t('settings.game.sound.gameSounds', 'Game sounds'),
    page: GameSettingsPage.Sound,
    format: onOff,
  },
  soundVolume: {
    label: t => t('settings.game.sound.soundVolume', 'Sound volume'),
    page: GameSettingsPage.Sound,
    format: plainNumber,
  },
  unitSpeechOn: {
    label: t => t('settings.game.sound.unitSpeech', 'Unit speech'),
    page: GameSettingsPage.Sound,
    format: onOff,
  },
  unitAcknowledgementsOn: {
    label: t => t('settings.game.sound.unitAcknowledgements', 'Unit acknowledgements'),
    page: GameSettingsPage.Sound,
    format: onOff,
  },
  backgroundSoundsOn: {
    label: t => t('settings.game.sound.backgroundSounds', 'Sound plays while in background'),
    page: GameSettingsPage.Sound,
    format: onOff,
  },
  buildingSoundsOn: {
    label: t => t('settings.game.sound.buildingSounds', 'Building sounds'),
    page: GameSettingsPage.Sound,
    format: onOff,
  },
  gameSubtitlesOn: {
    label: t => t('settings.game.sound.gameSubtitles', 'Game subtitles'),
    page: GameSettingsPage.Sound,
    format: onOff,
  },
  cinematicSubtitlesOn: {
    label: t => t('settings.game.sound.cinematicSubtitles', 'Cinematic subtitles'),
    page: GameSettingsPage.Sound,
    format: onOff,
  },
  originalVoiceOversOn: {
    label: t => t('settings.game.sound.originalVoiceOvers', 'Original unit voice overs'),
    page: GameSettingsPage.Sound,
    format: onOff,
  },
  displayMode: {
    label: t => t('settings.game.video.displayMode.title', 'Display mode'),
    page: GameSettingsPage.Video,
    format: getDisplayModeName,
  },
  // The video page shows brightness on a 0-100 slider rather than as SC:R's raw gamma value.
  gamma: {
    label: t => t('settings.game.video.brightness', 'Brightness'),
    page: GameSettingsPage.Video,
    format: value => String(gammaToSliderValue(value)),
  },
  fpsLimitOn: {
    label: t => t('settings.game.video.customFpsLimit', 'Custom FPS limit'),
    page: GameSettingsPage.Video,
    format: onOff,
  },
  fpsLimit: {
    label: t => t('settings.game.video.fpsLimit', 'FPS limit'),
    page: GameSettingsPage.Video,
    format: plainNumber,
  },
  sdGraphicsFilter: {
    label: t => t('settings.game.video.sdGraphicsFilter', 'SD graphics filter'),
    page: GameSettingsPage.Video,
    format: plainNumber,
  },
  vsyncOn: {
    label: t => t('settings.game.video.verticalSync', 'Vertical sync'),
    page: GameSettingsPage.Video,
    format: (value, t) => onOff(value === 1, t),
  },
  hdGraphicsOn: {
    label: t => t('settings.game.video.hdGraphics', 'HD graphics'),
    page: GameSettingsPage.Video,
    format: onOff,
  },
  environmentEffectsOn: {
    label: t => t('settings.game.video.environmentEffects', 'Environment effects'),
    page: GameSettingsPage.Video,
    format: onOff,
  },
  realTimeLightingOn: {
    label: t => t('settings.game.video.realTimeLighting', 'Real-time lighting'),
    page: GameSettingsPage.Video,
    format: onOff,
  },
  smoothUnitTurningOn: {
    label: t => t('settings.game.video.smoothUnitTurning', 'Smooth unit turning'),
    page: GameSettingsPage.Video,
    format: onOff,
  },
  shadowStackingOn: {
    label: t => t('settings.game.video.shadowStacking', 'Shadow stacking'),
    page: GameSettingsPage.Video,
    format: onOff,
  },
  pillarboxOn: {
    label: t => t('settings.game.video.pillarbox', 'Pillarbox (4:3 aspect ratio)'),
    page: GameSettingsPage.Video,
    format: onOff,
  },
  gameTimerOn: {
    label: t => t('settings.game.gameplay.gameTimer', 'Game timer'),
    page: GameSettingsPage.Gameplay,
    format: onOff,
  },
  colorCyclingOn: {
    label: t => t('settings.game.gameplay.colorCycling', 'Enable color cycling'),
    page: GameSettingsPage.Gameplay,
    format: onOff,
  },
  unitPortraits: {
    label: t => t('settings.game.gameplay.unitPortraits.title', 'Portraits'),
    page: GameSettingsPage.Gameplay,
    format: (value, t) => {
      switch (value) {
        case 2:
          return t('settings.game.gameplay.unitPortraits.animated', 'Animated')
        case 1:
          return t('settings.game.gameplay.unitPortraits.still', 'Still')
        default:
          return t('settings.game.gameplay.unitPortraits.disabled', 'Disabled')
      }
    },
  },
  minimapPosition: {
    label: t => t('settings.game.gameplay.minimapPosition.title', 'Minimap position'),
    page: GameSettingsPage.Gameplay,
    format: (value, t) =>
      value
        ? t('settings.game.gameplay.minimapPosition.bottomLeft', 'Bottom-left corner')
        : t('settings.game.gameplay.minimapPosition.standard', 'Standard'),
  },
  apmDisplayOn: {
    label: t => t('settings.game.gameplay.apmDisplay', 'APM display'),
    page: GameSettingsPage.Gameplay,
    format: onOff,
  },
  apmAlertOn: {
    label: t => t('settings.game.gameplay.apmAlert', 'Alert when APM falls below'),
    page: GameSettingsPage.Gameplay,
    format: onOff,
  },
  apmAlertValue: {
    label: t => t('settings.game.battleNet.apmAlertValue', 'APM alert threshold'),
    page: GameSettingsPage.Gameplay,
    format: plainNumber,
  },
  apmAlertColorOn: {
    label: t => t('settings.game.battleNet.apmAlertColor', 'Color APM alert text'),
    page: GameSettingsPage.Gameplay,
    format: onOff,
  },
  apmAlertSoundOn: {
    label: t => t('settings.game.battleNet.apmAlertSound', 'Play APM alert sound'),
    page: GameSettingsPage.Gameplay,
    format: onOff,
  },
  consoleSkin: {
    label: t => t('settings.game.gameplay.consoleSkins.title', 'Console skin'),
    page: GameSettingsPage.Gameplay,
    format: getConsoleSkinName,
  },
  selectedSkin: {
    label: t => t('settings.game.gameplay.ingameSkins.title', 'Ingame skin'),
    page: GameSettingsPage.Gameplay,
    format: getIngameSkinName,
  },
  showBonusSkins: {
    label: t => t('settings.game.gameplay.showBonusSkins', 'Show bonus skins'),
    page: GameSettingsPage.Gameplay,
    format: onOff,
  },
  selectedAnnouncer: {
    label: t => t('settings.game.sound.announcer.title', 'Announcer'),
    page: GameSettingsPage.Sound,
    format: getAnnouncerName,
  },
  showFps: {
    label: t => t('settings.game.video.showFps', 'Show FPS'),
    page: GameSettingsPage.Video,
    format: onOff,
  },
  showTurnRate: {
    label: t => t('settings.game.gameplay.latency', 'Show latency'),
    page: GameSettingsPage.Gameplay,
    format: onOff,
  },
}

export function getScrSettingLabel(key: ScrSettingKey, t: TFunction): string {
  return SCR_SETTING_INFOS[key].label(t)
}

export function getScrSettingPage(key: ScrSettingKey): GameSettingsPage {
  return SCR_SETTING_INFOS[key].page
}

/** Formats a setting's value, which settings files written before the setting existed lack. */
export function formatScrSetting<K extends ScrSettingKey>(
  key: K,
  value: ScrSettings[K] | undefined,
  t: TFunction,
): string {
  return value === undefined
    ? t('settings.game.battleNet.notSet', 'Not set')
    : SCR_SETTING_INFOS[key].format(value, t)
}

/** Every comparable setting, in the order the settings pages present them. */
export const ALL_SCR_SETTING_KEYS = Object.keys(SCR_SETTING_INFOS) as ScrSettingKey[]
