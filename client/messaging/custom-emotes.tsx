import styled from 'styled-components'
import { CUSTOM_EMOTES } from '../../common/text/custom-emotes'

// Original placeholder art (not game assets — those can't be redistributed). Kept as inline SVG
// data URIs so the same URL string works for <img> tags and for the emoji picker's custom emoji
// config without any asset-pipeline involvement.
const EMOTE_SVGS: Record<string, string> = {
  // Protoss
  bwProbe: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#d9a441" d="M12 2l5 6-5 6-5-6z"/><path fill="#8c6520" d="M7 8l-4 5 4 3zM17 8l4 5-4 3z"/><path fill="#f2ce7e" d="M12 14l3.5 4L12 22l-3.5-4z"/></svg>`,
  bwZealot: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#8c6520" d="M11 1h2v4h-2z"/><path fill="#d9a441" d="M8 4h8l1 6-5 4-5-4z"/><path fill="#58c8e8" d="M3 21l5-9 2 2-5 8zM21 21l-5-9-2 2 5 8z"/></svg>`,
  bwDragoon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#8c6520" d="M8 13l-5 8h2.5l4-6zM16 13l5 8h-2.5l-4-6zM10 14l-3 8h2.5l2-7zM14 14l3 8h-2.5l-2-7z"/><circle cx="12" cy="9" r="5.5" fill="#d9a441"/><circle cx="12" cy="9" r="2.2" fill="#58c8e8"/></svg>`,
  bwHighTemplar: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#d9a441" d="M7 22c0-8 2-12 5-12s5 4 5 12z"/><path fill="#8c6520" d="M9 10c0-3 1.5-5 3-5s3 2 3 5c-1-1.2-5-1.2-6 0z"/><path fill="#58c8e8" d="M17 1l-4 6h2.5l-3.5 6 6-8h-2.5z"/></svg>`,
  bwDarkTemplar: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#3d4b5c" d="M8 22c0-8 2-12 4-12s4 4 4 12z"/><path fill="#22303c" d="M9 10c0-3 1.5-5 3-5s3 2 3 5c-1-1.2-5-1.2-6 0z"/><path fill="#7de89a" d="M2 12l15 5-.7 2L2 14z"/></svg>`,
  bwArchon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#58c8e8" opacity=".3"/><circle cx="12" cy="12" r="7" fill="#58c8e8" opacity=".5"/><circle cx="12" cy="8" r="2.3" fill="#eaf7ff"/><path fill="#eaf7ff" d="M5.5 17c1-4 3.5-5.8 6.5-5.8s5.5 1.8 6.5 5.8z"/></svg>`,
  bwDarkArchon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#c2455e" opacity=".35"/><circle cx="12" cy="12" r="7" fill="#c2455e" opacity=".55"/><circle cx="12" cy="8" r="2.3" fill="#2b1024"/><path fill="#2b1024" d="M5.5 17c1-4 3.5-5.8 6.5-5.8s5.5 1.8 6.5 5.8z"/></svg>`,
  bwReaver: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="5" cy="17" r="3.5" fill="#8c6520"/><circle cx="10" cy="15" r="4" fill="#d9a441"/><circle cx="16" cy="14" r="4.5" fill="#d9a441"/><path fill="#f2ce7e" d="M16 10c4 0 6 3 6 7l-6 2z"/><circle cx="19" cy="14" r="1.2" fill="#58c8e8"/></svg>`,
  bwCarrier: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#d9a441" d="M2 9l7-4h9l4 5-4 5H9z"/><path fill="#8c6520" d="M2 9l7 6h9l-2 0z" opacity=".6"/><circle cx="7" cy="19" r="1.3" fill="#58c8e8"/><circle cx="12" cy="21" r="1.3" fill="#58c8e8"/><circle cx="17" cy="19" r="1.3" fill="#58c8e8"/></svg>`,
  bwPylon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#58c8e8" d="M12 2l4 7-4 8-4-8z"/><path fill="#2e8fb0" d="M12 2v15l-4-8z"/><path fill="#d9a441" d="M6 19h12l-2 3H8z"/></svg>`,
  // Terran
  bwScv: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="10" rx="2" fill="#9aa7b3"/><rect x="8.5" y="8.5" width="7" height="4" rx="1" fill="#22303c"/><path fill="#6e7c88" d="M7 16l-4 5 2 1.5 4-5zM17 16l4 5-2 1.5-4-5z"/></svg>`,
  bwMarine: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#5b8db8" d="M4 14a8 8 0 0 1 16 0v5H4z"/><rect x="6" y="12" width="9" height="3.5" rx="1.75" fill="#22303c"/><path fill="#7fb2d9" d="M4 14a8 8 0 0 1 8-8v3a5 5 0 0 0-5 5z"/></svg>`,
  bwFirebat: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#9aa7b3" d="M6 22V12a6 6 0 0 1 12 0v10z"/><rect x="9" y="10.5" width="6" height="3" rx="1.5" fill="#22303c"/><path fill="#e8843c" d="M4 21c-1-3 1-5 1-7 1.5 1 2.5 4 1.5 7zM20 21c1-3-1-5-1-7-1.5 1-2.5 4-1.5 7z"/></svg>`,
  bwGhost: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#4d5a66" d="M4 2l2-1.2L19 20l-2 1.2z"/><path fill="#8895a3" d="M9.5 22V11a2.5 2.5 0 0 1 5 0v11z"/><circle cx="12" cy="6.5" r="2.5" fill="#9aa7b3"/><rect x="10.5" y="5.8" width="3" height="1.4" fill="#c94f43"/></svg>`,
  bwVulture: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#6e7c88" d="M1 10l7 1.5v2L1 15zM3 6l6 3.5-1 1.5-6-2z"/><path fill="#9aa7b3" d="M8 9h7l3 2 5 1-2 6H10l-3-4z"/><rect x="12" y="6.5" width="3" height="3" rx="1" fill="#22303c"/></svg>`,
  bwTank: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#8895a3" d="M13 13l8-9.5 2 1.8L15 15z"/><path fill="#6e7c88" d="M3 21l3-6h12l3 6z"/><rect x="7.5" y="11.5" width="9" height="5" rx="1.5" fill="#9aa7b3"/></svg>`,
  bwGoliath: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="3.5" y="3" width="4" height="5" rx="1" fill="#6e7c88"/><rect x="16.5" y="3" width="4" height="5" rx="1" fill="#6e7c88"/><rect x="6.5" y="5.5" width="11" height="8" rx="1.5" fill="#9aa7b3"/><rect x="9" y="7.5" width="6" height="3" rx="1" fill="#22303c"/><path fill="#6e7c88" d="M9 13.5l-3.5 8h3l2.5-8zM15 13.5l3.5 8h-3l-2.5-8z"/></svg>`,
  bwWraith: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#9aa7b3" d="M12 1.5l2.8 9L22 17l-8.5-2-1.5 7.5L10.5 15 2 17l7.2-6.5z"/><circle cx="12" cy="8.5" r="1.6" fill="#58c8e8"/></svg>`,
  bwBattlecruiser: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#9aa7b3" d="M3 5h4.5v4L22 10.5 19 17H6l-3.5-5z"/><path fill="#6e7c88" d="M3 13l3 4h13l1-2.5z"/><circle cx="6" cy="7.5" r="1.2" fill="#c94f43"/></svg>`,
  bwNuke: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#c94f43" d="M12 22l-3.5-5h7z"/><path fill="#9aa7b3" d="M9 17V8c0-3.5 1.5-6 3-6s3 2.5 3 6v9z"/><path fill="#6e7c88" d="M9 11l-3 5h3zM15 11l3 5h-3z"/></svg>`,
  // Zerg
  bwDrone: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="10" r="6" fill="#a05cc2"/><path fill="#c98be0" d="M8.5 6.5c1.5-2 5.5-2 7 0-2.5-1-4.5-1-7 0z"/><path fill="#7a3f9d" d="M8.5 14.5l-3.5 7 2 1 3-6.5zM15.5 14.5l3.5 7-2 1-3-6.5z"/></svg>`,
  bwZergling: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#a05cc2" d="M3 19c1-6 5-10 10-11l3-5 2 4c2 2 3 5 3 8l-3 4-2-4-3 4-2-4-3 4z"/><path fill="#7a3f9d" d="M13 8l3-5 2 4-2 3z"/></svg>`,
  bwHydralisk: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5 20c6 1.5 10-2.5 10-8 0-3-1.2-5-3-6.5" stroke="#a05cc2" stroke-width="4.5" fill="none" stroke-linecap="round"/><circle cx="11.5" cy="4.5" r="2.8" fill="#a05cc2"/><path fill="#7a3f9d" d="M9 7L4 4.5l1.8 4.5zM15 6.5l5-2-2 4.5z"/></svg>`,
  bwLurker: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#a05cc2" d="M2 19c2-5.5 6-8 10-8s8 2.5 10 8z"/><path fill="#7a3f9d" d="M6.5 12l.5-5 2.5 3.8zM11 10.5l1-6 1 6zM14.5 10.8L17 7l.5 5z"/></svg>`,
  bwMutalisk: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#a05cc2" d="M11.5 10C9 4 4.5 2.5 1 4.5c3 1 5 3.5 5.8 7.5 2-1 3.7-1.2 4.7-2zM12.5 10c2.5-6 7-7.5 10.5-5.5-3 1-5 3.5-5.8 7.5-2-1-3.7-1.2-4.7-2z"/><path fill="#7a3f9d" d="M10 9.5h4l-1 4.5h2.2L10 22.5l1.3-6.5H9z"/></svg>`,
  bwUltralisk: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#c98be0" d="M13 9C11 4.5 7 2 2 2.5c3 2.5 4.5 5.5 5.5 8.5zM16.5 8c.5-3.5 2.5-5.5 5.5-5.5-1.2 2.8-1.2 5-3 7.8z"/><path fill="#a05cc2" d="M4 21.5c0-7 4.5-11.5 10-11.5 4 0 7 2 8 5.5l-2.5 6z"/><path fill="#7a3f9d" d="M7 21.5l1.5-4 2 4zM12.5 21.5l1.5-4 2 4z"/></svg>`,
  bwDefiler: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#7a3f9d" d="M8.5 15.5L5 5.5l4.2 2.8 1.3 7.2zM15.5 15.5l3.5-10-4.2 2.8-1.3 7.2z"/><path fill="#a05cc2" d="M2.5 19.5c2.5-3.5 5.8-5 9.5-5s7 1.5 9.5 5l-1.2 2.5H3.7z"/></svg>`,
  bwOverlord: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#a05cc2" d="M3.5 11.5c0-5 4-8.5 8.5-8.5s8.5 3.5 8.5 8.5c0 3.5-3.5 5.5-8.5 5.5s-8.5-2-8.5-5.5z"/><path fill="#c98be0" d="M6.5 8c2-2.5 6.5-3 9.5-1.5-3-.5-6.5 0-9.5 1.5z"/><path fill="#7a3f9d" d="M8 17l-1.5 5.5 2-1 1.2-4.5zM11.2 17.3h1.6V23h-1.6zM16 17l1.5 5.5-2-1-1.2-4.5z"/></svg>`,
  // Misc
  bwMineral: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#5fa8e8" d="M7 20l-4-6 5-5 3 4z"/><path fill="#8ec6f2" d="M11 20l-1-8 5-8 4 9-3 7z"/><path fill="#3d7dbb" d="M15 4l4 9-3 7h-3z"/></svg>`,
  bwGg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#3f6bb6"/><text x="12" y="15.5" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="9" fill="#fff">GG</text></svg>`,
}

// Keyed by lowercased code, since emote codes match case-insensitively
const EMOTE_URLS = new Map(
  Object.entries(EMOTE_SVGS).map(([code, svg]) => [
    code.toLowerCase(),
    `data:image/svg+xml,${encodeURIComponent(svg)}`,
  ]),
)

/** Returns the image URL for a custom emote code (case-insensitive), or `undefined` if unknown. */
export function customEmoteImageUrl(code: string): string | undefined {
  return EMOTE_URLS.get(code.toLowerCase())
}

/**
 * The custom emote list in the shape the emoji picker's `customEmojis` config expects. Names
 * include the code so searching for either works.
 */
export function customEmotesForPicker(): Array<{ id: string; names: string[]; imgUrl: string }> {
  return CUSTOM_EMOTES.filter(e => EMOTE_URLS.has(e.code.toLowerCase())).map(e => ({
    id: e.code,
    names: [e.name, e.code],
    imgUrl: EMOTE_URLS.get(e.code.toLowerCase())!,
  }))
}

const EmoteImg = styled.img`
  width: 22px;
  height: 22px;
  /* Negative block margin keeps a lone emote from growing the 20px message line very much while
     still rendering larger than the text */
  margin: -4px 1px;
  vertical-align: middle;
`

export function CustomEmote({ code, className }: { code: string; className?: string }) {
  const url = EMOTE_URLS.get(code.toLowerCase())
  // The message matcher only matches known codes, but render the literal text as a fallback so a
  // stale/mismatched registry degrades the same way unknown codes do
  if (!url) {
    return <>{`:${code}:`}</>
  }
  return <EmoteImg className={className} src={url} alt={`:${code}:`} title={`:${code}:`} />
}
