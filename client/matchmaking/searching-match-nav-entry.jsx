import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import CancelSearchIcon from '../icons/material/ic_close_black_24px.svg'
import SubheaderButton from '../material/left-nav/subheader-button'
import { colorTextSecondary } from '../styles/colors'
import { body2, cabin, TitleOld } from '../styles/typography'
import { ElapsedTime } from './elapsed-time'

const SearchingContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  height: 48px;
`

const SearchTitle = styled(TitleOld)`
  ${cabin};
  font-weight: 500;
  margin: 0 16px;
`

const StyledElapsedTime = styled(ElapsedTime)`
  ${body2}
  color: ${colorTextSecondary};
  margin: 0 16px;
`

export default class SearchingMatchNavEntry extends React.Component {
  static propTypes = {
    startTime: PropTypes.number,
    onCancelSearch: PropTypes.func.isRequired,
  }

  render() {
    return (
      <>
        <SearchingContainer>
          <SearchTitle>Searching for match</SearchTitle>
          <SubheaderButton
            icon={<CancelSearchIcon />}
            title='Cancel search'
            onClick={this.onCancelSearchClick}
          />
        </SearchingContainer>
        <StyledElapsedTime prefix={'Time: '} startTimeMs={this.props.startTime} />
      </>
    )
  }

  onCancelSearchClick = () => {
    this.props.onCancelSearch()
  }
}
