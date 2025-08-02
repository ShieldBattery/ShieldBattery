import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { range } from '../../../common/range'
import { Card } from '../../material/card'
import { Carousel } from '../carousel'

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
  background-color: var(--theme-container-low);
`

const CarouselItem = styled.div`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 200px;
  height: 200px;
  background-color: var(--theme-container);

  &:not(:first-child) {
    margin-left: 4px;
  }

  span {
    font-size: 64px;
    color: var(--theme-on-surface-variant);
  }
`

const TOTAL_ITEMS_COUNT = 50
const ITEMS_PER_PAGE = 10

export default function CarouselTest() {
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)

  const timerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const items = Array.from(range(0, TOTAL_ITEMS_COUNT), i => (
    <CarouselItem key={i}>
      <span>{i + 1}</span>
    </CarouselItem>
  ))

  const onLoadMoreData = () => {
    setIsLoading(true)
    timerRef.current = setTimeout(() => {
      setIsLoading(false)
      setPage(page + 1)
    }, 3000)
  }

  const dynamicItems = items.filter((item, index) => index < page * ITEMS_PER_PAGE)
  const hasMoreItems = TOTAL_ITEMS_COUNT > dynamicItems.length

  return (
    <Container>
      <StyledCard>
        <h3>Statically loaded</h3>
        <Carousel>{items}</Carousel>
        <h3>Dynamically loaded</h3>
        <Carousel
          infiniteListProps={{
            isLoadingNext: isLoading,
            hasNextData: hasMoreItems,
            onLoadNextData: onLoadMoreData,
          }}>
          {dynamicItems}
        </Carousel>
      </StyledCard>
    </Container>
  )
}
