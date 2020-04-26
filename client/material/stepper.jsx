import React from 'react'
import PropTypes from 'prop-types'
import { Set } from 'immutable'
import styled from 'styled-components'

import EditIcon from '../icons/material/edit-24px.svg'
import ErrorIcon from '../icons/material/baseline-error-24px.svg'

import {
  amberA400,
  colorTextPrimary,
  colorTextSecondary,
  colorDividers,
  colorTextFaint,
  colorError,
} from '../styles/colors'

const Container = styled.ul`
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: ${props => (props.alternativeLabel ? '104px' : '72px')};
  margin: 0;
  padding: 24px;
  list-style: none;
`

const StepIcon = styled.svg`
  width: 24px;
  height: 24px;
  color: ${colorTextSecondary};

  text {
    color: #000;
  }
`

const StepTitle = styled.span`
  margin: 0 0 0 8px;
  color: ${colorTextSecondary};
`

const StepConnector = styled.div`
  flex: 1;
  height: 1px;
  background-color: ${colorDividers};
`

const StepContainer = styled.li`
  display: flex;
  align-items: center;
  padding: 0 8px;

  ${props => {
    if (props.alternativeLabel) {
      return `
        flex-grow: 1;
        flex-basis: 0;
        flex-direction: column;
        position: relative;

        ${StepTitle} {
          margin: 16px 0 0 0;
        }

        ${StepConnector} {
          position: absolute;
          top: 12px;
          left: calc(50% + 20px);
          right: calc(-50% + 20px);
        }
      `
    }

    return ''
  }}

  ${props => {
    if (!props.disabled && props.editable) {
      return `
        &:hover {
          cursor: pointer;
        }
      `
    }

    return ''
  }}

  ${props => {
    if (props.disabled) {
      return `
        ${StepIcon}, ${StepTitle} {
          color: ${colorTextFaint};
        }
      `
    }
    if (props.error) {
      return `
        ${StepIcon} {
          color: ${colorError};
        }
        ${StepTitle} {
          font-weight: ${props.active ? 500 : 400};
          color: ${colorError};
        }
      `
    }
    if (props.active) {
      return `
        ${StepIcon} {
          color: ${amberA400};
        }
        ${StepTitle} {
          font-weight: 500;
          color: ${colorTextPrimary};
        }
      `
    }
    if (props.completed) {
      return `
        ${StepIcon} {
          color: ${amberA400};
        }
        ${StepTitle} {
          color: ${colorTextPrimary};
        }
      `
    }

    return ''
  }}
`

export class Step extends React.Component {
  static propTypes = {
    value: PropTypes.number,
    text: PropTypes.string.isRequired,
    alternativeLabel: PropTypes.bool,
    active: PropTypes.bool,
    completed: PropTypes.bool,
    disabled: PropTypes.bool,
    editable: PropTypes.bool,
    error: PropTypes.bool,
    onClick: PropTypes.func,
  }

  render() {
    const {
      value,
      text,
      alternativeLabel,
      active,
      completed,
      disabled,
      editable,
      error,
    } = this.props
    let icon
    if (editable && completed) {
      icon = EditIcon
    } else if (error) {
      icon = ErrorIcon
    }

    return (
      <StepContainer
        alternativeLabel={alternativeLabel}
        active={active}
        completed={completed}
        disabled={disabled}
        editable={editable}
        error={error}
        onClick={this.onStepClick}>
        <StepIcon as={icon}>
          <circle cx='12' cy='12' r='10'></circle>
          <text x='12' y='17' textAnchor='middle'>
            {value + 1}
          </text>
        </StepIcon>
        <StepTitle>{text}</StepTitle>
        {this.props.children}
      </StepContainer>
    )
  }

  onStepClick = () => {
    if (!this.props.disabled && this.props.editable && !this.props.error && this.props.onClick) {
      this.props.onClick(this.props.value)
    }
  }
}

export default class Stepper extends React.Component {
  static propTypes = {
    activeStep: PropTypes.number.isRequired,
    alternativeLabel: PropTypes.bool,
    disabledSteps: PropTypes.instanceOf(Set),
    editableSteps: PropTypes.instanceOf(Set),
    errorSteps: PropTypes.instanceOf(Set),
    onChange: PropTypes.func,
  }

  render() {
    const { activeStep, alternativeLabel, disabledSteps, editableSteps, errorSteps } = this.props

    const steps = React.Children.map(this.props.children, (child, i) => {
      return React.cloneElement(child, {
        value: i,
        active: i === activeStep,
        completed: i < activeStep,
        disabled: disabledSteps && disabledSteps.has(i),
        editable: editableSteps && editableSteps.has(i),
        error: errorSteps && errorSteps.has(i),
        alternativeLabel,
        onClick: this.onStepChange,
      })
    })
    const elements = steps.reduce((acc, step, index) => {
      const stepElement = alternativeLabel
        ? React.cloneElement(step, { children: <StepConnector /> })
        : step

      return index < steps.length - 1
        ? [...acc, stepElement, alternativeLabel ? null : <StepConnector key={index} />]
        : [...acc, step]
    }, [])

    return <Container alternativeLabel={alternativeLabel}>{elements}</Container>
  }

  onStepChange = value => {
    if (this.props.onChange) {
      this.props.onChange(value)
    }
  }
}
