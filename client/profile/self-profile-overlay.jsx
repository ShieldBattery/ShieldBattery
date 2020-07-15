import React from 'react'
import PropTypes from 'prop-types'
import { CSSTransition } from 'react-transition-group'
import styled from 'styled-components'

import Avatar from '../avatars/avatar.jsx'
import Popover from '../material/popover.jsx'
import { fastOutSlowIn } from '../material/curve-constants.js'
import { Title, singleLine } from '../styles/typography'

const transitionNames = {
  appear: 'enter',
  appearActive: 'enterActive',
  enter: 'enter',
  enterActive: 'enterActive',
  exit: 'exit',
  exitActive: 'exitActive',
}

const Contents = styled.div`
  min-width: 256px;
`

const Header = styled.div`
  position: relative;
  padding-top: 24px;
  text-align: center;

  .enter & {
    opacity: 0;
    transform: translateY(-16px);
    transition-property: all;
    /* TODO(tec27): this should be linear for opacity, and probably linearOutSlowIn for
       translation? */
    transition-timing-function: ${fastOutSlowIn};
  }

  .enterActive & {
    opacity: 1;
    transform: translateY(0px);
    pointer-events: none;
  }

  .exit & {
    opacity: 1;
    transition-property: opacity;
    transition-timing-function: linear;
  }

  .exitActive & {
    opacity: 0;
    pointer-events: none;
  }
`

const StyledAvatar = styled(Avatar)`
  width: 64px;
  height: 64px;
  margin-bottom: 16px;
`

const Username = styled(Title)`
  margin-top: 0;
  margin-bottom: 0;
  ${singleLine};
`

const Actions = styled.div`
  position: relative;
  padding-top: 8px;
  padding-bottom: 8px;

  .enter & {
    opacity: 0;
    transform: translateY(-16px);
    transition-property: all;
    /* TODO(tec27): this should be linear for opacity, and probably linearOutSlowIn for
       translation? */
    transition-timing-function: ${fastOutSlowIn};
  }

  .enterActive & {
    opacity: 1;
    transform: translateY(0);
    pointer-events: none;
  }

  .exit & {
    opacity: 1;
    transition-property: opacity;
    transition-timing-function: linear;
  }

  .exitActive & {
    opacity: 0;
    pointer-events: none;
  }
`

export default class SelfProfileOverlay extends React.Component {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    user: PropTypes.string.isRequired,
    onDismiss: PropTypes.func.isRequired,
    anchor: PropTypes.object,
  }

  render() {
    const { user, children, open, onDismiss, anchor } = this.props

    return (
      <Popover
        open={open}
        onDismiss={onDismiss}
        anchor={anchor}
        anchorOriginVertical='bottom'
        anchorOriginHorizontal='left'
        popoverOriginVertical='bottom'
        popoverOriginHorizontal='left'>
        {(state, timings) => {
          const { openDelay, openDuration, closeDuration } = timings
          let style
          // TODO(tec27): We could probably use CSS custom properties for this instead of passing
          // this style down
          if (state === 'opening') {
            style = {
              transitionDuration: `${openDuration}ms`,
              transitionDelay: `${openDelay}ms`,
            }
          } else if (state === 'opened') {
            style = {
              transitionDuration: `${closeDuration}ms`,
            }
          }

          return (
            <CSSTransition
              in={state === 'opening' || state === 'opened'}
              classNames={transitionNames}
              appear={true}
              timeout={{
                appear: openDelay + openDuration,
                enter: openDuration,
                exit: closeDuration,
              }}>
              <Contents key='contents'>
                <Header style={style}>
                  <StyledAvatar user={user} />
                  <Username>{user}</Username>
                </Header>
                <Actions style={style}>{children}</Actions>
              </Contents>
            </CSSTransition>
          )
        }}
      </Popover>
    )
  }
}
