import { Record } from 'immutable'

// NOTE(2Pac): These setting records should *only* contain the actual setting values that will be
// persisted somewhere permanently (so don't put stuff like `lastError` in here). This allows us to
// use these records to easily save/fetch settings without doing some kind of filtering.

export const LocalSettings = new Record({
  starcraftPath: null,
  masterVolume: -1,
  gameWinWidth: -1,
  gameWinHeight: -1,
  gameWinX: -1,
  gameWinY: -1,
  v1161displayMode: -1,
  v1161mouseSensitivity: -1,
  v1161maintainAspectRatio: false,
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
