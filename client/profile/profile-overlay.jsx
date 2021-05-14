import PropTypes from 'prop-types'
import React from 'react'
import { CSSTransition } from 'react-transition-group'
import styled from 'styled-components'
import { fastOutSlowIn } from '../material/curve-constants.js'
import { LegacyPopover } from '../material/legacy-popover'

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
  position: relative;

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

export default class ProfileOverlay extends React.Component {
  static propTypes = {
    popoverProps: PropTypes.object.isRequired,
  }

  render() {
    const { children, popoverProps } = this.props

    return (
      <LegacyPopover {...popoverProps}>
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
              <div>
                <Contents style={style}>{children}</Contents>
              </div>
            </CSSTransition>
          )
        }}
      </LegacyPopover>
    )
  }
}
