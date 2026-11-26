import { LobbyBestOfLogoJson } from '../../../common/lobbies/lobby-best-of'

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/** A square emblem in light artwork on a transparent background. */
export const SQUARE_LOGO: LobbyBestOfLogoJson = {
  url: svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
      <path d="M128 16 L224 52 V124 C224 184 184 224 128 240 C72 224 32 184 32 124 V52 Z"
        fill="none" stroke="#ffffff" stroke-width="14"/>
      <path d="M128 64 L150 112 L202 116 L162 150 L174 200 L128 172 L82 200 L94 150 L54 116 L106 112 Z"
        fill="#ffffff"/>
    </svg>`,
  ),
  fileName: 'shield-cup-emblem.png',
}

/** A wide 4:1 wordmark in dark artwork on a transparent background. */
export const WIDE_LOGO: LobbyBestOfLogoJson = {
  url: svgDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 144">
      <rect x="8" y="24" width="96" height="96" rx="12" fill="#101010"/>
      <path d="M56 40 L88 72 L56 104 L24 72 Z" fill="none" stroke="#f0f0f0" stroke-width="8"/>
      <text x="124" y="98" font-family="Arial, sans-serif" font-weight="900" font-size="72"
        textLength="436" lengthAdjust="spacingAndGlyphs" fill="#101010">NEXUS CUP</text>
    </svg>`,
  ),
  fileName: 'nexus-cup-wordmark-with-a-long-file-name-from-the-designer-final-v3.svg',
}
