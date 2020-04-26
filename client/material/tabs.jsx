import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import WindowListener from '../dom/window-listener.jsx'

import { amberA400, colorTextSecondary } from '../styles/colors'
import { fastOutSlowIn } from '../material/curve-constants'

const Container = styled.ul`
  position: relative;
  display: flex;
  flex-direction: row;
  height: 48px;
  margin: 0;
  padding: 0;
  list-style: none;
`

export const TabTitle = styled.span`
  font-size: 14px;
  font-weight: 500;
  text-transform: uppercase;
  color: ${props => (props.active ? amberA400 : colorTextSecondary)};
`

export const TabItemContainer = styled.li`
  flex: 1 1 0;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  transition: background-color 15ms linear;

  &:hover {
    background-color: rgba(255, 255, 255, 0.04);
    cursor: pointer;
  }

  &:active {
    background-color: rgba(255, 255, 255, 0.08);
  }
`

const ActiveIndicator = styled.div`
  position: absolute;
  bottom: 0;
  width: ${props => `${props.indicatorWidth}px`};
  height: 2px;
  background-color: ${amberA400};
  transform: ${props => `translateX(${props.indicatorPosition}px)`};
  transition: transform 250ms ${fastOutSlowIn};
`

export class TabItem extends React.Component {
  static propTypes = {
    text: PropTypes.string.isRequired,
    value: PropTypes.number,
    active: PropTypes.bool,
    onClick: PropTypes.func,
  }

  render() {
    const { text, active } = this.props

    return (
      <TabItemContainer onClick={this.onTabClick}>
        <TabTitle active={active}>{text}</TabTitle>
      </TabItemContainer>
    )
  }

  onTabClick = () => {
    if (this.props.onClick) {
      this.props.onClick(this.props.value)
    }
  }
}

export default class Tabs extends React.Component {
  static propTypes = {
    activeTab: PropTypes.number.isRequired,
    onChange: PropTypes.func,
  }

  state = {
    indicatorWidth: 0,
    indicatorPosition: 0,
  }

  _root = null
  _setRoot = elem => {
    this._root = elem
  }

  componentDidMount() {
    this._calcIndicatorPosition()
  }

  componentDidUpdate(prevProps) {
    if (prevProps.activeTab !== this.props.activeTab) {
      this._calcIndicatorPosition()
    }
  }

  _calcIndicatorPosition = () => {
    const containerWidth = this._root.getBoundingClientRect().width
    const tabCount = React.Children.count(this.props.children)
    const tabSize = containerWidth / tabCount

    this.setState({
      indicatorWidth: tabSize,
      indicatorPosition: this.props.activeTab * tabSize,
    })
  }

  render() {
    const { indicatorWidth, indicatorPosition } = this.state
    const tabs = React.Children.map(this.props.children, (child, i) => {
      return React.cloneElement(child, {
        value: i,
        active: i === this.props.activeTab,
        onClick: this.onTabChange,
      })
    })

    return (
      <Container ref={this._setRoot}>
        <WindowListener event='resize' listener={this._calcIndicatorPosition} />
        {tabs}
        <ActiveIndicator indicatorWidth={indicatorWidth} indicatorPosition={indicatorPosition} />
      </Container>
    )
  }

  onTabChange = value => {
    if (this.props.onChange) {
      this.props.onChange(value)
    }
  }
}
