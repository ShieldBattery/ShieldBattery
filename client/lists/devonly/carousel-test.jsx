import React from 'react'
import { styled } from 'styled-components'
import { range } from '../../../common/range.js'
import Card from '../../material/card.js'
import { background400, background700, colorTextSecondary } from '../../styles/colors.js'
import Carousel from '../carousel.js'

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
  background-color: ${background400};
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
  background-color: ${background700};

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

export default class CarouselTest extends React.Component {
  state = {
    page: 1,
    isLoading: false,
  }

  _timer = null

  componentWillUnmount() {
    if (this._timer) {
      clearTimeout(this._timer)
      this._timer = null
    }
  }

  render() {
    const items = Array.from(range(0, TOTAL_ITEMS_COUNT), i => (
      <CarouselItem key={i}>
        <span>{i + 1}</span>
      </CarouselItem>
    ))
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
        this._timer = setTimeout(
          () => this.setState({ isLoading: false, page: this.state.page + 1 }),
          3000,
        )
      },
    )
  }
}
