import React from 'react'
import styled from 'styled-components'
import { POINTS_FOR_RATING_TARGET_FACTOR } from '../../../common/matchmaking'
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
          <RankIcon points={1} bonusPool={0} />
          <RankIcon points={1000 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
          <RankIcon points={1060 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
          <RankIcon points={1160 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
        </Row>

        <Row>
          <RankIcon points={1200 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
          <RankIcon points={1300 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
          <RankIcon points={1400 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
        </Row>

        <Row>
          <RankIcon points={1500 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
          <RankIcon points={1550 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
          <RankIcon points={1600 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
        </Row>

        <Row>
          <RankIcon points={1700 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
          <RankIcon points={1800 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
          <RankIcon points={1900 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
        </Row>

        <Row>
          <RankIcon points={1980 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
          <RankIcon points={2000 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
          <RankIcon points={2200 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
          <RankIcon points={2800 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
        </Row>

        <Row>
          <RankIcon points={2200 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
          <RankIcon points={2500 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
          <RankIcon points={2500 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
          <RankIcon points={2500 * POINTS_FOR_RATING_TARGET_FACTOR} bonusPool={0} />
        </Row>
      </Column>
      <Column>
        <Row>
          <TinyIcon points={2500 * POINTS_FOR_RATING_TARGET_FACTOR} size={22} bonusPool={0} />
        </Row>
        <Row>
          <SmallIcon points={2500 * POINTS_FOR_RATING_TARGET_FACTOR} size={44} bonusPool={0} />
        </Row>
        <Row>
          <LargeIcon points={2500 * POINTS_FOR_RATING_TARGET_FACTOR} size={176} bonusPool={0} />
        </Row>
      </Column>
    </Container>
  )
}
