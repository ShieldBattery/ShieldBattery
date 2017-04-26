// TODO(tec27): There's not terribly much electron-specific about playing audio, we just need
// an alternate way to load the sounds (XHR or something would be fine). We also probably don't want
// to block on stuff like message notification sounds for the web version?

let audioManager
let SOUNDS
if (process.webpackEnv.SB_ENV === 'electron') {
  const AudioManager = require('./audio-manager').default
  audioManager = new AudioManager()
  SOUNDS = AudioManager.SOUNDS
} else {
  SOUNDS = {}
}

export default audioManager
export { SOUNDS }
