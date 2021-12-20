import { Record } from 'immutable'
import { Announcer, ConsoleSkin, IngameSkin } from '../../common/blizz-settings'
import {
  LocalSettingsData,
  ScrSettingsData,
  ShieldBatteryAppSettingsData,
} from '../../common/local-settings'

// NOTE(2Pac): These setting records should *only* contain the actual setting values that will be
// persisted somewhere permanently (so don't put stuff like `lastError` in here). This allows us to
// use these records to easily save/fetch settings without doing some kind of filtering.

export class LocalSettings
  extends Record({
    runAppAtSystemStart: true,
    runAppAtSystemStartMinimized: false,
    starcraftPath: '',
    masterVolume: 0,
    gameWinWidth: -1,
    gameWinHeight: -1,
    v1161displayMode: -1,
    v1161mouseSensitivity: -1,
    v1161maintainAspectRatio: false,
  })
  implements Readonly<Omit<LocalSettingsData, keyof ShieldBatteryAppSettingsData>> {}

export class ScrSettings
  extends Record({
    // Input settings
    keyboardScrollSpeed: 0,
    mouseScrollSpeed: 0,
    mouseSensitivityOn: false,
    mouseSensitivity: 0,
    mouseScalingOn: false,
    hardwareCursorOn: false,
    mouseConfineOn: false,
    // Sound settings
    musicOn: false,
    musicVolume: 0,
    soundOn: false,
    soundVolume: 0,
    unitSpeechOn: false,
    unitAcknowledgementsOn: false,
    backgroundSoundsOn: false,
    buildingSoundsOn: false,
    gameSubtitlesOn: false,
    cinematicSubtitlesOn: false,
    originalVoiceOversOn: false,
    selectedAnnouncer: Announcer.Default as Announcer,
    // Video settings
    displayMode: 0,
    fpsLimitOn: false,
    fpsLimit: 0,
    sdGraphicsFilter: 0,
    vsyncOn: 0,
    hdGraphicsOn: false,
    environmentEffectsOn: false,
    realTimeLightingOn: false,
    smoothUnitTurningOn: false,
    shadowStackingOn: false,
    pillarboxOn: false,
    // Gameplay settings
    gameTimerOn: false,
    colorCyclingOn: false,
    unitPortraits: 0,
    minimapPosition: false,
    apmDisplayOn: false,
    apmAlertOn: false,
    apmAlertValue: 0,
    apmAlertColorOn: false,
    apmAlertSoundOn: false,
    consoleSkin: ConsoleSkin.Default as ConsoleSkin,
    selectedSkin: IngameSkin.Default as IngameSkin,
    showBonusSkins: false,
  })
  implements Readonly<Omit<ScrSettingsData, 'version'>> {}
