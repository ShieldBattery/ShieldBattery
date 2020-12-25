import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import SubheaderButton from '../material/left-nav/subheader-button.jsx'

import CancelSearchIcon from '../icons/material/ic_close_black_24px.svg'

import { colorTextSecondary } from '../styles/colors'
import { body2, TitleOld, robotoCondensed } from '../styles/typography'
import { ElapsedTime } from './elapsed-time'

const SearchingContainer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  height: 48px;
`

const SearchTitle = styled(TitleOld)`
  ${robotoCondensed};
  font-weight: 700;
  margin: 0 16px;
`

const StyledElapsedTime = styled(ElapsedTime)`
  ${body2}
  color: ${colorTextSecondary};
  font-size: 16px;
  margin: 0 16px;
`

export default class SearchingMatchNavEntry extends React.Component {
  static propTypes = {
    startTime: PropTypes.number,
    onCancelSearch: PropTypes.func.isRequired,
  }

  render() {
    const elapsedTime = window.performance.now() - this.props.startTime

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
        <StyledElapsedTime prefix={'Time: '} timeMs={elapsedTime} />
      </>
    )
  }

  onCancelSearchClick = () => {
    this.props.onCancelSearch()
  }
}
