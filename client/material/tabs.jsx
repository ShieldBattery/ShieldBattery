import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import WindowListener from '../dom/window-listener'
import { fastOutSlowIn } from '../material/curve-constants'
import { amberA400, colorDividers, colorTextFaint, colorTextSecondary } from '../styles/colors'
import { buttonText } from '../styles/typography'

const Container = styled.ul`
  position: relative;
  display: flex;
  flex-direction: row;
  height: 48px;
  margin: 0;
  padding: 0;
  list-style: none;

  contain: content;
`

export const TabTitle = styled.span`
  ${buttonText};

  ${props => {
    let color = colorTextSecondary
    if (props.active) {
      color = amberA400
    } else if (props.disabled) {
      color = colorTextFaint
    }

    return `color: ${color}`
  }};
`

export const TabItemContainer = styled.li`
  flex: 1 1 0;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  transition: background-color 15ms linear;

  ${props => {
    if (props.disabled) return ''

    return `
      &:hover {
        background-color: rgba(255, 255, 255, 0.04);
        cursor: pointer;
      }

      &:active {
        background-color: rgba(255, 255, 255, 0.08);
      }
    `
  }}
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

const BottomDivider = styled.div`
  position: absolute;
  height: 1px;
  bottom: 0;
  left: 0;
  right: 0;

  background-color: ${colorDividers};
`

export class TabItem extends React.Component {
  static propTypes = {
    text: PropTypes.string.isRequired,
    value: PropTypes.number,
    active: PropTypes.bool,
    disabled: PropTypes.bool,
    onClick: PropTypes.func,
  }

  render() {
    const { text, active, disabled } = this.props

    return (
      <TabItemContainer disabled={disabled} onClick={this.onTabClick}>
        <TabTitle active={active} disabled={disabled}>
          {text}
        </TabTitle>
      </TabItemContainer>
    )
  }

  onTabClick = () => {
    if (!this.props.disabled && this.props.onClick) {
      this.props.onClick(this.props.value)
    }
  }
}

export default class Tabs extends React.Component {
  static propTypes = {
    activeTab: PropTypes.number.isRequired,
    onChange: PropTypes.func,
    bottomDivider: PropTypes.bool,
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
    const prevTabCount = React.Children.count(prevProps.children)
    const tabCount = React.Children.count(this.props.children)

    if (prevProps.activeTab !== this.props.activeTab || prevTabCount !== tabCount) {
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
      <Container ref={this._setRoot} className={this.props.className}>
        <WindowListener event='resize' listener={this._calcIndicatorPosition} />
        {tabs}
        {this.props.bottomDivider ? <BottomDivider /> : null}
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
