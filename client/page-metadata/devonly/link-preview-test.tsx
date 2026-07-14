import { ChangeEvent, SyntheticEvent, useState } from 'react'
import styled, { css } from 'styled-components'
import { NEWS_STOCK_IMAGES_PATH_PREFIX } from '../../../common/news'
import { PageMetadata } from '../../../common/page-metadata'
import { FilledButton } from '../../material/button'
import { FilterChip } from '../../material/filter-chip'
import { RadioButton, RadioGroup } from '../../material/radio'
import { TextField } from '../../material/text-field'
import { fetchRaw } from '../../network/fetch'
import { makePublicAssetUrl, makeServerUrl } from '../../network/server-url'
import { bodySmall, labelLarge } from '../../styles/typography'

function stockImageUrl(name: string): string {
  return makePublicAssetUrl(`${NEWS_STOCK_IMAGES_PATH_PREFIX}${name}.jpg`)
}

const defaultLogoUrl = makeServerUrl('/images/logo-and-text-1200x630.png')

interface Preset {
  id: string
  label: string
  metadata: PageMetadata
}

// Realistic mock content for every resolver registered in `server/lib/page-metadata/page-metadata.ts`,
// so this page can stand in for exercising the real thing without a database.
const PRESETS: Preset[] = [
  {
    id: 'default',
    label: 'Default site',
    metadata: {
      url: 'https://shieldbattery.net',
      type: 'website',
      title: 'ShieldBattery',
      description: 'Play StarCraft 1 on the premier community-run platform.',
      image: defaultLogoUrl,
    },
  },
  {
    id: 'download',
    label: 'Static: Download',
    metadata: {
      url: 'https://shieldbattery.net/download',
      type: 'website',
      title: 'Download ShieldBattery',
      description:
        'Download ShieldBattery to play StarCraft: Brood War online with modern matchmaking, ' +
        'ladder rankings, leagues, and more.',
      image: defaultLogoUrl,
    },
  },
  {
    id: 'news-cover',
    label: 'News post (cover image)',
    metadata: {
      url: 'https://shieldbattery.net/news/Vk92cQ/shieldbattery-9-2-party-voice-chat',
      type: 'article',
      title: 'ShieldBattery 9.2: Party Voice Chat and Replay Improvements',
      description:
        'Talk to your party over voice chat without leaving the app, plus a faster replay ' +
        'browser and a handful of matchmaking fixes.',
      image: stockImageUrl('badlands0'),
      publishedTime: '2026-06-02T17:00:00.000Z',
    },
  },
  {
    id: 'news-long',
    label: 'News post (long title)',
    metadata: {
      url: 'https://shieldbattery.net/news/Qx71wZ/season-12-ladder-reset',
      type: 'article',
      title:
        'Season 12 Ladder Reset, New Fastest Maps Rotation, Replay Auto-Upload Fixes, and a ' +
        'Whole Lot More Coming to ShieldBattery This Month',
      description:
        'The Season 12 ladder reset lands next week alongside a refreshed Fastest maps ' +
        "rotation. We've also shipped a fix for replays that failed to auto-upload after a " +
        'dropped connection, tuned matchmaking search ranges for low-population brackets, and ' +
        'cleaned up a handful of long-standing UI papercuts across the client.',
      image: stockImageUrl('space0'),
      publishedTime: '2026-07-01T16:00:00.000Z',
    },
  },
  {
    id: 'user-avatar',
    label: 'User (avatar)',
    metadata: {
      url: 'https://shieldbattery.net/users/1234/Flash',
      type: 'website',
      title: 'Flash',
      description:
        "View Flash's match history, rankings, and stats on ShieldBattery. Playing since " +
        'March 2024.',
      image: stockImageUrl('ashworld0'),
      cardType: 'summary',
    },
  },
  {
    id: 'user-no-avatar',
    label: 'User (no avatar)',
    metadata: {
      url: 'https://shieldbattery.net/users/5678/SmallFoot',
      type: 'website',
      title: 'SmallFoot',
      description:
        "View SmallFoot's match history, rankings, and stats on ShieldBattery. Playing since " +
        'January 2025.',
      image: defaultLogoUrl,
    },
  },
  {
    id: 'game',
    label: 'Game',
    metadata: {
      url: 'https://shieldbattery.net/games/8pQ2rT',
      type: 'website',
      title: 'PlayerOne, PlayerTwo vs PlayerThree, PlayerFour',
      description: 'Ranked 2v2 game on Fighting Spirit, played July 14, 2026.',
      image: stockImageUrl('jungle0'),
    },
  },
  {
    id: 'league',
    label: 'League',
    metadata: {
      url: 'https://shieldbattery.net/leagues/N3vKp1/shieldbattery-winter-championship',
      type: 'website',
      title: 'ShieldBattery Winter Championship',
      description:
        'A 6-week Bo3 round robin for the top 32 players on the ShieldBattery ladder, ' +
        'culminating in a single-elimination playoff bracket.',
      image: stockImageUrl('space1'),
    },
  },
]

/** Generates the exact `<meta>` tags `server/views/index.pug` would emit for `metadata`. */
function renderMetaTags(metadata: PageMetadata): string {
  const attr = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const lines = [
    `<meta property="og:url" content="${attr(metadata.url)}">`,
    `<meta property="og:type" content="${attr(metadata.type)}">`,
    `<meta property="og:title" content="${attr(metadata.title)}">`,
    `<meta property="og:description" content="${attr(metadata.description)}">`,
    `<meta property="og:image" content="${attr(metadata.image)}">`,
  ]
  if (metadata.publishedTime) {
    lines.push(`<meta property="article:published_time" content="${attr(metadata.publishedTime)}">`)
  }
  lines.push(
    `<meta name="twitter:card" content="${attr(metadata.cardType || 'summary_large_image')}">`,
    `<meta name="twitter:title" content="${attr(metadata.title)}">`,
    `<meta name="twitter:site" content="@ShieldBatteryBW">`,
    `<meta name="twitter:description" content="${attr(metadata.description)}">`,
    `<meta name="twitter:image" content="${attr(metadata.image)}">`,
  )

  return lines.join('\n')
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** Hides a broken preview image instead of showing the browser's broken-image icon. */
function hideOnError(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = 'none'
}

const Root = styled.div`
  padding: 16px;
`

const Layout = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 24px;

  @media (max-width: 960px) {
    flex-direction: column;
  }
`

const FormColumn = styled.div`
  flex-shrink: 0;
  width: 360px;
  max-width: 100%;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const PreviewColumn = styled.div`
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

const SectionHeader = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
  margin-top: 8px;

  &:first-child {
    margin-top: 0;
  }
`

const PresetRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const FetchRow = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
`

const FetchError = styled.div`
  ${bodySmall};
  color: var(--theme-negative);
`

const Panel = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const PanelHeader = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
`

const MetaPre = styled.pre`
  margin: 0;
  padding: 12px;
  background-color: var(--theme-container-low);
  border-radius: 8px;
  overflow-x: auto;

  color: var(--theme-on-surface);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
`

// The following replicate Discord/X's own visual styles (colors, fonts, layout), not
// ShieldBattery's — hardcoded to match those products rather than composing our design tokens.

const DiscordContainer = styled.div`
  max-width: 432px;
  padding: 8px 16px 16px 12px;

  background: #2b2d31;
  border-left: 4px solid #1e1f22;
  border-radius: 4px;

  font-family: 'gg sans', 'Noto Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
`

const DiscordTitle = styled.div`
  color: #00a8fc;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.25;
`

const DiscordDescription = styled.div`
  margin-top: 8px;
  color: #dbdee1;
  font-size: 14px;
  line-height: 1.3;
`

const DiscordThumb = styled.img`
  float: right;
  width: 80px;
  height: 80px;
  margin-left: 12px;

  border-radius: 4px;
  object-fit: cover;
`

const DiscordLargeImage = styled.img`
  display: block;
  margin-top: 8px;
  width: 100%;
  max-width: 400px;

  border-radius: 4px;
`

function DiscordEmbed({ metadata }: { metadata: PageMetadata }) {
  // Approximation: Discord picks its embed layout from the page's actual OG image dimensions, not
  // from the Twitter card type. `cardType === 'summary'` is used here as a stand-in signal for
  // "this should get the small-thumbnail treatment" since it's the only hint `PageMetadata` gives.
  const isThumb = metadata.cardType === 'summary'

  return (
    <DiscordContainer>
      {isThumb ? (
        <DiscordThumb key={metadata.image} src={metadata.image} alt='' onError={hideOnError} />
      ) : null}
      <DiscordTitle>{metadata.title}</DiscordTitle>
      <DiscordDescription>{metadata.description}</DiscordDescription>
      {!isThumb ? (
        <DiscordLargeImage key={metadata.image} src={metadata.image} alt='' onError={hideOnError} />
      ) : null}
    </DiscordContainer>
  )
}

const xFontStack = css`
  font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
`

const XSwatch = styled.div`
  padding: 16px;
  background: #000;
  border-radius: 4px;
`

// X renders cards at ~516px wide in the timeline.
const XCardWidth = styled.div`
  max-width: 516px;
`

const XCardLarge = styled.div`
  ${xFontStack};
  position: relative;
  overflow: hidden;

  border: 1px solid #2f3336;
  border-radius: 16px;
`

const XCardImageLarge = styled.img`
  display: block;
  width: 100%;
  aspect-ratio: 1.91 / 1;
  object-fit: cover;
`

const XTitleChip = styled.div`
  position: absolute;
  left: 8px;
  bottom: 8px;
  max-width: calc(100% - 16px);
  padding: 0 4px;

  background: rgba(0, 0, 0, 0.77);
  border-radius: 4px;
  color: #fff;
  font-size: 15px;

  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const XCaption = styled.div`
  ${xFontStack};
  margin-top: 4px;
  color: #71767b;
  font-size: 13px;
`

const XCardHoriz = styled.div`
  ${xFontStack};
  display: flex;
  overflow: hidden;

  border: 1px solid #2f3336;
  border-radius: 16px;
`

const XCardImageSquare = styled.img`
  flex-shrink: 0;
  width: 128px;
  height: 128px;
  object-fit: cover;
`

const XCardRight = styled.div`
  flex-grow: 1;
  min-width: 0;
  padding: 12px;

  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;
`

const XHostnameLine = styled.div`
  color: #71767b;
  font-size: 13px;
`

const xClamp = css`
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`

const XClampTitle = styled.div`
  ${xClamp};
  color: #fff;
  font-size: 15px;
  font-weight: 600;
`

const XClampDescription = styled.div`
  ${xClamp};
  color: #71767b;
  font-size: 15px;
`

function XCard({ metadata }: { metadata: PageMetadata }) {
  const hostname = hostnameOf(metadata.url)

  if (metadata.cardType === 'summary') {
    return (
      <XCardHoriz>
        <XCardImageSquare key={metadata.image} src={metadata.image} alt='' onError={hideOnError} />
        <XCardRight>
          <XHostnameLine>{hostname}</XHostnameLine>
          <XClampTitle>{metadata.title}</XClampTitle>
          <XClampDescription>{metadata.description}</XClampDescription>
        </XCardRight>
      </XCardHoriz>
    )
  }

  return (
    <div>
      <XCardLarge>
        <XCardImageLarge key={metadata.image} src={metadata.image} alt='' onError={hideOnError} />
        <XTitleChip>{metadata.title}</XTitleChip>
      </XCardLarge>
      <XCaption>From {hostname}</XCaption>
    </div>
  )
}

/**
 * A devonly playground for `PageMetadata`: pick a preset (or edit fields directly) and see how the
 * result would unfurl as a Discord embed and an X (Twitter) card, alongside the exact `<meta>` tags
 * `server/views/index.pug` would emit for it. The "fetch a real path" mode instead loads the tags
 * actually served by the running server for a given path, exercising the real resolvers.
 */
export function LinkPreviewTest() {
  const [metadata, setMetadata] = useState<PageMetadata>(PRESETS[0].metadata)
  const [activePresetId, setActivePresetId] = useState<string | undefined>(PRESETS[0].id)
  const [fetchPath, setFetchPath] = useState('/news/')
  const [fetchError, setFetchError] = useState<string>()

  function applyPreset(preset: Preset) {
    setMetadata(preset.metadata)
    setActivePresetId(preset.id)
    setFetchError(undefined)
  }

  function updateField<K extends keyof PageMetadata>(key: K, value: PageMetadata[K]) {
    setMetadata(prev => ({ ...prev, [key]: value }))
  }

  async function handleFetchClick() {
    setFetchError(undefined)
    try {
      const response = await fetchRaw(fetchPath)
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`)
      }

      const html = await response.text()
      const doc = new DOMParser().parseFromString(html, 'text/html')
      const readMeta = (selector: string) =>
        doc.querySelector(selector)?.getAttribute('content') ?? undefined

      const title = readMeta('meta[property="og:title"]')
      const description = readMeta('meta[property="og:description"]')
      const image = readMeta('meta[property="og:image"]')
      if (!title || !description || !image) {
        throw new Error('Response was missing the expected og: meta tags')
      }

      setMetadata({
        url: readMeta('meta[property="og:url"]') ?? makeServerUrl(fetchPath),
        type: readMeta('meta[property="og:type"]') === 'article' ? 'article' : 'website',
        title,
        description,
        image,
        publishedTime: readMeta('meta[property="article:published_time"]'),
        cardType: readMeta('meta[name="twitter:card"]') === 'summary' ? 'summary' : undefined,
      })
      setActivePresetId(undefined)
    } catch (err) {
      setFetchError(
        `${err instanceof Error ? err.message : 'Failed to fetch metadata'}. If this fails in ` +
          'the Electron client, try the browser dev client instead (likely a CORS issue).',
      )
    }
  }

  return (
    <Root>
      <Layout>
        <FormColumn>
          <SectionHeader>Presets</SectionHeader>
          <PresetRow>
            {PRESETS.map(preset => (
              <FilterChip
                key={preset.id}
                label={preset.label}
                selected={activePresetId === preset.id}
                onClick={() => applyPreset(preset)}
              />
            ))}
          </PresetRow>

          <SectionHeader>Content</SectionHeader>
          <TextField
            label='Title'
            value={metadata.title}
            floatingLabel={true}
            dense={true}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField('title', event.target.value)
            }
          />
          <TextField
            label='Description'
            value={metadata.description}
            floatingLabel={true}
            dense={true}
            multiline={true}
            rows={3}
            maxRows={6}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField('description', event.target.value)
            }
          />
          <TextField
            label='Image URL'
            value={metadata.image}
            floatingLabel={true}
            dense={true}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField('image', event.target.value)
            }
          />
          <TextField
            label='Canonical URL'
            value={metadata.url}
            floatingLabel={true}
            dense={true}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField('url', event.target.value)
            }
          />
          <RadioGroup
            label='Card type'
            value={metadata.cardType ?? 'summary_large_image'}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField('cardType', event.target.value === 'summary' ? 'summary' : undefined)
            }>
            <RadioButton label='summary_large_image (default)' value='summary_large_image' />
            <RadioButton label='summary' value='summary' />
          </RadioGroup>

          <SectionHeader>Fetch a real path</SectionHeader>
          <FetchRow>
            <TextField
              label='Path'
              inputProps={{ placeholder: '/news/…' }}
              value={fetchPath}
              floatingLabel={true}
              dense={true}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setFetchPath(event.target.value)}
            />
            <FilledButton
              label='Fetch served tags'
              onClick={() => {
                handleFetchClick().catch(() => {})
              }}
            />
            {fetchError ? <FetchError>{fetchError}</FetchError> : null}
          </FetchRow>
        </FormColumn>

        <PreviewColumn>
          <Panel>
            <PanelHeader>Discord embed</PanelHeader>
            <DiscordEmbed metadata={metadata} />
          </Panel>

          <Panel>
            <PanelHeader>X (Twitter) card</PanelHeader>
            <XSwatch>
              <XCardWidth>
                <XCard metadata={metadata} />
              </XCardWidth>
            </XSwatch>
          </Panel>

          <Panel>
            <PanelHeader>Served meta tags</PanelHeader>
            <MetaPre>{renderMetaTags(metadata)}</MetaPre>
          </Panel>
        </PreviewColumn>
      </Layout>
    </Root>
  )
}
