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
    width: 176px;
    height: 176px;
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
          <RankIcon rating={1} />
          <RankIcon rating={1000} />
          <RankIcon rating={1060} />
          <RankIcon rating={1160} />
        </Row>

        <Row>
          <RankIcon rating={1200} />
          <RankIcon rating={1300} />
          <RankIcon rating={1400} />
        </Row>

        <Row>
          <RankIcon rating={1500} />
          <RankIcon rating={1550} />
          <RankIcon rating={1600} />
        </Row>

        <Row>
          <RankIcon rating={1700} />
          <RankIcon rating={1800} />
          <RankIcon rating={1900} />
        </Row>

        <Row>
          <RankIcon rating={1980} />
          <RankIcon rating={2000} />
          <RankIcon rating={2200} />
          <RankIcon rating={2800} />
        </Row>

        <Row>
          <RankIcon rating={2200} />
          <RankIcon rating={2500} />
          <RankIcon rating={2500} />
          <RankIcon rating={2500} />
        </Row>
      </Column>
      <Column>
        <Row>
          <TinyIcon rating={2500} size={22} />
        </Row>
        <Row>
          <SmallIcon rating={2500} size={44} />
        </Row>
        <Row>
          <LargeIcon rating={2500} size={176} />
        </Row>
      </Column>
    </Container>
  )
}
