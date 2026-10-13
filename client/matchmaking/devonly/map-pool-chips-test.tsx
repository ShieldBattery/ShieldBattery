import styled from 'styled-components'
import { FightingSpirit } from '../../maps/devonly/maps-for-testing'
import { MapThumbnail } from '../../maps/map-thumbnail'
import { titleMedium } from '../../styles/typography'

const Root = styled.div`
  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

const Row = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 16px;
`

const RowTitle = styled.div`
  ${titleMedium};
`

const Tile = styled.div<{ $size: number }>`
  flex-shrink: 0;
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;
`

const LABEL_SETS: ReadonlyArray<[title: string, labels: ReadonlyArray<string>]> = [
  ['No pools', []],
  ['One pool', ['1v1']],
  ['Several pools', ['1v1', '1v1 Fastest', '2v2', '3v3 Fastest']],
]

const SIZES = [512, 256, 160]

export function MapPoolChipsTest() {
  return (
    <Root>
      {LABEL_SETS.map(([title, labels]) => (
        <div key={title}>
          <RowTitle>{title}</RowTitle>
          <Row>
            {SIZES.map(size => (
              <Tile key={size} $size={size}>
                <MapThumbnail
                  map={FightingSpirit}
                  size={size > 256 ? 512 : 256}
                  showInfoLayer={true}
                  mapPoolLabels={labels}
                  onClick={() => {}}
                  onPreview={() => {}}
                />
              </Tile>
            ))}
          </Row>
        </div>
      ))}
    </Root>
  )
}
