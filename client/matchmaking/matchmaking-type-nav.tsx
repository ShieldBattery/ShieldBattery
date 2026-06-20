import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  getMatchmakingModeInfo,
  getMatchmakingTypesForFormat,
  MATCHMAKING_FORMATS,
  MatchmakingFormat,
  MatchmakingType,
  matchmakingVariantToLabel,
} from '../../common/matchmaking'
import { TabItem, Tabs } from '../material/tabs'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

export interface MatchmakingTypeNavProps {
  activeType: MatchmakingType
  onChange: (type: MatchmakingType) => void
  className?: string
}

/**
 * A two-level, format-first navigation for matchmaking types: a primary row of formats (1v1 / 2v2 /
 * 3v3) and, when the selected format has more than one variant, a secondary row of variants
 * (Standard / Fastest / ...). This keeps the type selector from overflowing as more modes are added,
 * and is shared by the ladder and the matchmaking admin pages.
 */
export function MatchmakingTypeNav({ activeType, onChange, className }: MatchmakingTypeNavProps) {
  const { t } = useTranslation()
  const activeFormat = getMatchmakingModeInfo(activeType).format

  const formats = MATCHMAKING_FORMATS.filter(f => getMatchmakingTypesForFormat(f).length > 0)
  const variants = getMatchmakingTypesForFormat(activeFormat)

  const onFormatChange = (format: MatchmakingFormat) => {
    // Switch to the format's first (canonical) variant, unless we're already on a variant of it.
    const types = getMatchmakingTypesForFormat(format)
    if (types.length && !types.includes(activeType)) {
      onChange(types[0])
    }
  }

  return (
    <Root className={className}>
      <Tabs activeTab={activeFormat} onChange={onFormatChange}>
        {formats.map(format => (
          <TabItem key={format} text={format} value={format} />
        ))}
      </Tabs>
      {variants.length > 1 ? (
        <Tabs activeTab={activeType} onChange={onChange}>
          {variants.map(type => (
            <TabItem
              key={type}
              text={matchmakingVariantToLabel(getMatchmakingModeInfo(type).variant, t)}
              value={type}
            />
          ))}
        </Tabs>
      ) : null}
    </Root>
  )
}
