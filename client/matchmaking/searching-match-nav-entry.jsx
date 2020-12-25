import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import SubheaderButton from '../material/left-nav/subheader-button.jsx'

import CancelSearchIcon from '../icons/material/ic_close_black_24px.svg'

import { colorTextSecondary } from '../styles/colors'
import { Body2Old, TitleOld, robotoCondensed } from '../styles/typography'

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

const ElapsedTimeContainer = styled(Body2Old)`
  color: ${colorTextSecondary};
  font-size: 16px;
  margin: 0 16px;
`

export default class SearchingMatchNavEntry extends React.Component {
  static propTypes = {
    elapsedTime: PropTypes.number,
    onCancelSearch: PropTypes.func.isRequired,
  }

  formatElapsedTime() {
    const { elapsedTime } = this.props
    const hours = Math.floor(elapsedTime / 3600)
    const minutes = Math.floor(elapsedTime / 60) % 60
    const seconds = elapsedTime % 60

    return [hours, minutes, seconds]
      .map(v => ('' + v).padStart(2, '0'))
      .filter((v, i) => v !== '00' || i > 0)
      .join(':')
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
        <ElapsedTimeContainer>Time: {this.formatElapsedTime()}</ElapsedTimeContainer>
      </>
    )
  }

  onCancelSearchClick = () => {
    this.props.onCancelSearch()
  }
}
