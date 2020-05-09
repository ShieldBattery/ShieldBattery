import React from 'react'
import { Range } from 'immutable'
import styled from 'styled-components'

import Card from '../../material/card.jsx'
import Carousel from '../carousel.jsx'

import { grey850, grey800, colorTextSecondary } from '../../styles/colors'

const Container = styled.div`
  display: flex;
  justify-content: center;
  height: auto !important;
  padding: 16px !important;
`

const StyledCard = styled(Card)`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  max-width: 840px;
  margin-left: 16px;
  background-color: ${grey850};
`

const StyledCarousel = styled(Carousel)`
  max-width: 800px;
`

const CarouselItem = styled.div`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 200px;
  height: 200px;
  background-color: ${grey800};

  &:not(:first-child) {
    margin-left: 4px;
  }

  span {
    font-size: 64px;
    color: ${colorTextSecondary};
  }
`

const TOTAL_ITEMS_COUNT = 50
const ITEMS_PER_PAGE = 10

export default class ActivityButtonsTest extends React.Component {
  state = {
    page: 1,
    isLoading: false,
  }

  render() {
    const items = Range(0, TOTAL_ITEMS_COUNT)
      .map(i => (
        <CarouselItem key={i}>
          <span>{i + 1}</span>
        </CarouselItem>
      ))
      .toArray()
    const dynamicItems = items.filter((item, index) => index < this.state.page * ITEMS_PER_PAGE)
    const hasMoreItems = TOTAL_ITEMS_COUNT > dynamicItems.length

    return (
      <Container>
        <StyledCard>
          <h3>Statically loaded</h3>
          <StyledCarousel>{items}</StyledCarousel>
          <h3>Dynamically loaded</h3>
          <StyledCarousel
            isLoading={this.state.isLoading}
            hasMoreItems={hasMoreItems}
            onLoadMoreData={this.onLoadMoreData}>
            {dynamicItems}
          </StyledCarousel>
        </StyledCard>
      </Container>
    )
  }

  onLoadMoreData = () => {
    this.setState(
      () => ({ isLoading: true }),
      () => {
        setTimeout(() => this.setState({ isLoading: false, page: this.state.page + 1 }), 3000)
      },
    )
  }
}
