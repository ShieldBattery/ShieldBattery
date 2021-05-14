import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import form from '../forms/form'
import SubmitOnEnter from '../forms/submit-on-enter'
import CheckBox from '../material/check-box'
import Slider from '../material/slider'
import { FormContainer } from './settings-content'

const MouseSensitivitySlider = styled(Slider)`
  margin-bottom: 40px;
`

@form()
class InputRemasteredForm extends React.Component {
  render() {
    const { bindCheckable, bindCustom, onSubmit } = this.props

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <FormContainer>
          <div>
            <Slider
              {...bindCustom('keyboardScrollSpeed')}
              label='Keyboard scroll speed'
              tabIndex={0}
              min={0}
              max={6}
              step={1}
            />
            <Slider
              {...bindCustom('mouseScrollSpeed')}
              label='Mouse scroll speed'
              tabIndex={0}
              min={0}
              max={6}
              step={1}
            />
          </div>
          <div>
            <CheckBox
              {...bindCheckable('mouseSensitivityOn')}
              label='Custom mouse sensitivity'
              inputProps={{ tabIndex: 0 }}
            />
            <MouseSensitivitySlider
              {...bindCustom('mouseSensitivity')}
              label='Mouse sensitivity'
              tabIndex={0}
              min={0}
              max={100}
              step={5}
              disabled={!this.props.getInputValue('mouseSensitivityOn')}
              showTicks={false}
            />
            <CheckBox
              {...bindCheckable('mouseScalingOn')}
              label='Use mouse scaling'
              inputProps={{ tabIndex: 0 }}
            />
            <CheckBox
              {...bindCheckable('hardwareCursorOn')}
              label='Hardware cursor'
              inputProps={{ tabIndex: 0 }}
            />
            <CheckBox
              {...bindCheckable('mouseConfineOn')}
              label='Lock cursor to window'
              inputProps={{ tabIndex: 0 }}
            />
          </div>
        </FormContainer>
      </form>
    )
  }
}

@form()
class Input1161Form extends React.Component {
  render() {
    const { bindCustom, onSubmit } = this.props

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <Slider
          {...bindCustom('v1161mouseSensitivity')}
          label='Mouse sensitivity'
          tabIndex={0}
          min={0}
          max={10}
          step={1}
        />
      </form>
    )
  }
}

export default class InputSettings extends React.Component {
  static propTypes = {
    localSettings: PropTypes.object.isRequired,
    scrSettings: PropTypes.object.isRequired,
    formRef: PropTypes.object.isRequired,
    isRemastered: PropTypes.bool,
    onChange: PropTypes.func.isRequired,
    onSubmit: PropTypes.func.isRequired,
  }

  render() {
    const { localSettings, scrSettings, formRef, isRemastered } = this.props

    const form1161Model = {
      v1161mouseSensitivity: localSettings.v1161mouseSensitivity,
    }
    const formScrModel = { ...scrSettings.toJS() }

    return isRemastered ? (
      <InputRemasteredForm
        ref={formRef}
        model={formScrModel}
        onChange={this.onChange}
        onSubmit={this.onSubmit}
      />
    ) : (
      <Input1161Form
        ref={formRef}
        model={form1161Model}
        onChange={this.onChange}
        onSubmit={this.onSubmit}
      />
    )
  }

  onChange = () => {
    const values = this.props.formRef.current.getModel()
    this.props.onChange(values)
  }

  onSubmit = () => {
    this.props.onSubmit()
  }
}
