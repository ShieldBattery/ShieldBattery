import { Map, Record } from 'immutable'

// NOTE(2Pac): These setting records should *only* contain the actual setting values that will be
// persisted somewhere permanently (so don't put stuff like `lastError` in here). This allows us to
// easily save/fetch settings without doing some kind of filtering.

export const LocalSettings = new Record({
  starcraftPath: null,
  masterVolume: null,
  gameWinWidth: -1,
  gameWinHeight: -1,
  gameWinX: null,
  gameWinY: null,
  v1161displayMode: 0,
  v1161mouseSensitivity: 0,
  v1161maintainAspectRatio: true,
})
export const ScrSettings = new Record({
  // Input settings
  keyboardScrollSpeed: -1,
  mouseScrollSpeed: -1,
  mouseSensitivityOn: false,
  mouseSensitivity: -1,
  mouseScalingOn: false,
  hardwareCursorOn: false,
  mouseConfineOn: false,
  // Sound settings
  musicOn: false,
  musicVolume: -1,
  soundOn: false,
  soundVolume: -1,
  unitSpeechOn: false,
  unitAcknowledgementsOn: false,
  backgroundSoundsOn: false,
  buildingSoundsOn: false,
  gameSubtitlesOn: false,
  cinematicSubtitlesOn: false,
  originalVoiceOversOn: false,
  original1998CampaignOn: false,
  // Video settings
  displayMode: -1,
  fpsLimitOn: false,
  fpsLimit: -1,
  sdGraphicsFilter: -1,
  vsyncOn: false,
  hdGraphicsOn: false,
  environmentEffectsOn: false,
  realTimeLightingOn: false,
  smoothUnitTurningOn: false,
  shadowStackingOn: false,
  pillarboxOn: false,
  // Gameplay settings
  gameTimerOn: false,
  colorCyclingOn: false,
  unitPortraits: -1,
  minimapPosition: false,
  apmDisplayOn: false,
  apmAlertOn: false,
  apmAlertValue: -1,
  apmAlertColorOn: false,
  apmAlertSoundOn: false,
})

// Mapping of setting names between SB and SC:R, where the names used in SB are the keys, and the
// names used in SC:R are the values. Used for converting both from SC:R -> SB settings (when
// fetching), and SB -> SC:R settings (when saving).
export const scrSettingMappings = new Map([
  ['keyboardScrollSpeed', 'm_kscroll'],
  ['mouseScrollSpeed', 'm_mscroll'],
  ['mouseSensitivityOn', 'MouseUseSensitivity'],
  ['mouseSensitivity', 'MouseSensitivity'],
  ['mouseScalingOn', 'MouseScaling'],
  ['hardwareCursorOn', 'MouseHardwareCursor'],
  ['mouseConfineOn', 'MouseConfine'],
  ['musicOn', 'MusicEnabled'],
  ['musicVolume', 'music'],
  ['soundOn', 'SfxEnabled'],
  ['soundVolume', 'sfx'],
  ['unitSpeechOn', 'unitspeech'],
  ['unitAcknowledgementsOn', 'unitnoise'],
  ['backgroundSoundsOn', 'SoundInBackground'],
  ['buildingSoundsOn', 'bldgnoise'],
  ['gameSubtitlesOn', 'trigtext'],
  ['cinematicSubtitlesOn', 'cinematicSubtitlesEnabled'],
  ['originalVoiceOversOn', 'originalUnitVO'],
  ['original1998CampaignOn', 'originalCampaign'],
  ['displayMode', 'WindowMode'],
  ['fpsLimitOn', 'FPSLimitEnabled'],
  ['fpsLimit', 'FPSLimit'],
  ['sdGraphicsFilter', 'SDFilterMode'],
  ['vsyncOn', 'VSync'],
  ['hdGraphicsOn', 'HDPreferences'],
  ['environmentEffectsOn', 'ShowFoliage'],
  ['realTimeLightingOn', 'RealtimeLightingEnabled'],
  ['smoothUnitTurningOn', 'UseHDRotation'],
  ['shadowStackingOn', 'ShadowStacking'],
  ['pillarboxOn', 'OriginalAspectRatio'],
  ['gameTimerOn', 'GameTimer'],
  ['colorCyclingOn', 'ColorCycle'],
  ['unitPortraits', 'UnitPortraits'],
  ['minimapPosition', 'consoleSplit'],
  ['apmDisplayOn', 'apm_Showing'],
  ['apmAlertOn', 'apm_AlertUser'],
  ['apmAlertValue', 'apm_AlertValue'],
  ['apmAlertColorOn', 'apm_AlertUseColor'],
  ['apmAlertSoundOn', 'apm_AlertUseSound'],
])

export function fromScrToSb(scrSettings) {
  const mappedScrSettings = Object.entries(scrSettings).reduce((acc, [name, value]) => {
    const sbKeyName = scrSettingMappings.findKey(scrKeyName => scrKeyName === name)

    acc[sbKeyName] = value

    return acc
  }, {})

  return new ScrSettings(mappedScrSettings)
}

export function fromSbToScr(sbSettings) {
  return Object.entries(sbSettings).reduce((acc, [name, value]) => {
    const scrKeyName = scrSettingMappings.get(name)

    acc[scrKeyName] = value

    return acc
  }, {})
}
