import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import { Subheading, singleLine } from '../../styles/typography'

const Item = styled.div`
  display: flex;
  align-items: center;
  position: relative;
  width: auto;
  height: ${props => (props.dense ? '32px' : '48px')};
  padding: 0 12px;
  cursor: pointer;

  &:hover {
    background-color: ${props =>
      props.focused ? 'rgba(255, 255, 255, 0.24)' : 'rgba(255, 255, 255, 0.08)'};
  }

  &:active {
    background-color: rgba(255, 255, 255, 0.24);
  }

  ${props => (props.focused ? 'background-color: rgba(255, 255, 255, 0.24)' : '')};
`

const ItemText = styled(Subheading)`
  flex-grow: 1;
  ${singleLine};
`

const ItemIcon = styled.span`
  flex-shrink: 0;
  display: flex;
  align-items: center;
  width: 24px;
  margin-right: 16px;
  overflow: hidden;
`

export default class MenuItem extends React.Component {
  static propTypes = {
    text: PropTypes.string.isRequired,
    icon: PropTypes.node,
    focused: PropTypes.bool,
    dense: PropTypes.bool,
    onClick: PropTypes.func,
  }

  render() {
    const { text, icon, focused, dense, onClick } = this.props
    return (
      <Item className={this.props.className} focused={focused} dense={dense} onClick={onClick}>
        {icon ? <ItemIcon>{icon}</ItemIcon> : null}
        <ItemText as='span'>{text}</ItemText>
      </Item>
    )
  }
}
