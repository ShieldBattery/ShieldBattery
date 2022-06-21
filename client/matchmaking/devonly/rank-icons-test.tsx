import React from 'react'
import styled from 'styled-components'
import { RankIcon, UnratedIcon } from '../rank-icon'

const Container = styled.div`
  display: flex;
  gap: 40px;
`

const Column = styled.div``

const Row = styled.div`
  display: flex;
  gap: 24px;
  margin: 16px 24px;
`

// NOTE(tec27): specificity hack in these is just to deal with issues with hot reloading while
// changing multiple files
const SmallIcon = styled(RankIcon)`
  && {
    width: 44px;
    height: 44px;
  }
`

const TinyIcon = styled(RankIcon)`
  && {
    width: 22px;
    height: 22px;
  }
`

const LargeIcon = styled(RankIcon)`
  && {
    width: 172px;
    height: 172px;
  }
`

export function RankIconsTest() {
  return (
    <Container>
      <Column>
        <Row>
          <UnratedIcon />
        </Row>

        <Row>
          <RankIcon rating={1} rank={1200} />
          <RankIcon rating={1000} rank={1200} />
          <RankIcon rating={1060} rank={1200} />
          <RankIcon rating={1160} rank={1200} />
        </Row>

        <Row>
          <RankIcon rating={1200} rank={1200} />
          <RankIcon rating={1300} rank={1200} />
          <RankIcon rating={1400} rank={1200} />
        </Row>

        <Row>
          <RankIcon rating={1500} rank={1200} />
          <RankIcon rating={1550} rank={1200} />
          <RankIcon rating={1600} rank={1200} />
        </Row>

        <Row>
          <RankIcon rating={1700} rank={1200} />
          <RankIcon rating={1800} rank={1200} />
          <RankIcon rating={1900} rank={1200} />
        </Row>

        <Row>
          <RankIcon rating={1980} rank={1200} />
          <RankIcon rating={2000} rank={1200} />
          <RankIcon rating={2200} rank={1200} />
          <RankIcon rating={2800} rank={1200} />
        </Row>

        <Row>
          <RankIcon rating={2200} rank={1} />
          <RankIcon rating={2500} rank={1} />
          <RankIcon rating={2500} rank={7} />
          <RankIcon rating={2500} rank={10} />
        </Row>
      </Column>
      <Column>
        <Row>
          <TinyIcon rating={2500} rank={10} showChampionRank={false} />
        </Row>
        <Row>
          <SmallIcon rating={2500} rank={10} />
        </Row>
        <Row>
          <LargeIcon rating={2500} rank={10} />
        </Row>
      </Column>
    </Container>
  )
}
