// The codicons license file is the CC BY 4.0 legal code, which the CC-licensed sounds share.
import ccBy4License from '../icons/codicons/LICENSE?raw'
import interLicense from './texts/Inter-OFL.txt?raw'
import materialSymbolsLicense from './texts/MaterialSymbols-Apache-2.0.txt?raw'
import notoColorEmojiLicense from './texts/NotoColorEmoji-OFL.txt?raw'
import sofiaSansLicense from './texts/SofiaSans-OFL.txt?raw'
import sofiaSansCondensedLicense from './texts/SofiaSansCondensed-OFL.txt?raw'

/**
 * A third-party font, sound, or icon set that ships with the client. Unlike packages, these aren't
 * found by the build, so they're listed here by hand.
 */
export interface BundledAsset {
  name: string
  /** Who made it, as the license asks them to be credited. */
  author: string
  /** Where it came from. */
  source: string
  /** SPDX identifier of the license it's used under. */
  license: string
  /** What we changed, for licenses that ask for modifications to be noted. */
  modifications?: string
  /** The full license text, if the license is one that needs to accompany the work. */
  licenseText?: string
}

/** Fonts in `app/assets/fonts` (mirrored to `server/public/fonts`), served from Google Fonts. */
const FONTS: BundledAsset[] = [
  {
    name: 'Inter',
    author: 'The Inter Project Authors',
    source: 'https://github.com/rsms/inter',
    license: 'OFL-1.1',
    licenseText: interLicense,
  },
  {
    name: 'Material Symbols',
    author: 'Google',
    source: 'https://github.com/google/material-design-icons',
    license: 'Apache-2.0',
    licenseText: materialSymbolsLicense,
  },
  {
    name: 'Noto Color Emoji',
    author: 'Google',
    source: 'https://github.com/googlefonts/noto-emoji',
    license: 'OFL-1.1',
    licenseText: notoColorEmojiLicense,
  },
  {
    name: 'Sofia Sans',
    author: 'The Sofia Sans Project Authors',
    source: 'https://github.com/lettersoup/Sofia-Sans',
    license: 'OFL-1.1',
    licenseText: sofiaSansLicense,
  },
  {
    name: 'Sofia Sans Condensed',
    author: 'The Sofia Sans Project Authors',
    source: 'https://github.com/lettersoup/Sofia-Sans',
    license: 'OFL-1.1',
    licenseText: sofiaSansCondensedLicense,
  },
]

/**
 * Sounds in `app/assets/sounds` that aren't our own. Keep in sync with that directory's
 * `USAGE.MD`.
 */
const SOUNDS: BundledAsset[] = [
  {
    name: '"Ticking Clock, A.wav"',
    author: 'InspectorJ',
    source: 'https://freesound.org/s/343130/',
    license: 'CC-BY-4.0',
    modifications: 'Cut into individual ticks and re-encoded.',
    licenseText: ccBy4License,
  },
  {
    name: '"Epic angry boat/Inception Sound effect.mp3"',
    author: 'funnyman850',
    source: 'https://freesound.org/people/funnyman850/sounds/194812/',
    license: 'CC0-1.0',
  },
]

/** Icon sets in `client/icons` that aren't our own. */
const ICONS: BundledAsset[] = [
  {
    name: 'Codicons',
    author: 'Microsoft Corporation',
    source: 'https://github.com/microsoft/vscode-codicons',
    license: 'CC-BY-4.0',
    licenseText: ccBy4License,
  },
]

export const BUNDLED_ASSETS: ReadonlyArray<BundledAsset> = [...FONTS, ...SOUNDS, ...ICONS]
