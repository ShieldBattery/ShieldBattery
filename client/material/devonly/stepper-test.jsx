import { Set } from 'immutable'
import React from 'react'
import styled from 'styled-components'
import Card from '../card'
import CheckBox from '../check-box'
import FlatButton from '../flat-button'
import RaisedButton from '../raised-button'
import Stepper, { Step } from '../stepper'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px !important;
`

const StyledCard = styled(Card)`
  width: 100%;
  max-width: 640px;
`

export default class StepperTest extends React.Component {
  state = {
    activeStep: 0,
    alternativeLabel: false,
  }

  render() {
    return (
      <Container>
        <StyledCard>
          <CheckBox
            checked={this.state.alternativeLabel}
            label='Alternative label'
            onChange={this.onAlternativeLabelChange}
          />
          <Stepper
            activeStep={this.state.activeStep}
            alternativeLabel={this.state.alternativeLabel}>
            <Step text='First step' />
            <Step text='Second step' />
            <Step text='Third step' />
          </Stepper>
          <Stepper
            activeStep={this.state.activeStep}
            alternativeLabel={this.state.alternativeLabel}
            disabledSteps={new Set([1, 2])}>
            <Step text='First step' />
            <Step text='Disabled second step' />
            <Step text='Disabled third step' />
          </Stepper>
          <Stepper
            activeStep={this.state.activeStep}
            alternativeLabel={this.state.alternativeLabel}
            editableSteps={new Set([0])}>
            <Step text='First editable step' />
            <Step text='Second step' />
            <Step text='Third step' />
          </Stepper>
          <Stepper
            activeStep={this.state.activeStep}
            alternativeLabel={this.state.alternativeLabel}
            errorSteps={new Set([1])}>
            <Step text='First step' />
            <Step text='Error step' />
            <Step text='Third step' />
          </Stepper>
          <FlatButton
            label='Back'
            color='accent'
            disabled={this.state.activeStep === 0}
            onClick={this.onBackStepClick}
          />
          <RaisedButton
            label='Next'
            disabled={this.state.activeStep === 2}
            onClick={this.onNextStepClick}
          />
        </StyledCard>
      </Container>
    )
  }

  onAlternativeLabelChange = event => {
    this.setState({ alternativeLabel: event.target.checked })
  }

  onBackStepClick = () => {
    this.setState({ activeStep: this.state.activeStep - 1 })
  }

  onNextStepClick = () => {
    this.setState({ activeStep: this.state.activeStep + 1 })
  }
}
