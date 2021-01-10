import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import CheckBox from '../material/check-box'
import form from '../forms/form'
import SubmitOnEnter from '../forms/submit-on-enter'
import Slider from '../material/slider'
import { FormContainer } from './settings-content'

const MusicVolumeSlider = styled(Slider)`
  margin-bottom: 40px;
`

@form()
class SoundRemasteredForm extends React.Component {
  render() {
    const { bindCheckable, bindCustom, onSubmit } = this.props

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <FormContainer>
          <div>
            <CheckBox {...bindCheckable('musicOn')} label='Music' inputProps={{ tabIndex: 0 }} />
            <MusicVolumeSlider
              {...bindCustom('musicVolume')}
              label='Music volume'
              tabIndex={0}
              min={0}
              max={100}
              step={5}
              disabled={!this.props.getInputValue('musicOn')}
              showTicks={false}
            />
            <CheckBox
              {...bindCheckable('soundOn')}
              label='Game sounds'
              inputProps={{ tabIndex: 0 }}
            />
            <Slider
              {...bindCustom('soundVolume')}
              label='Sound volume'
              tabIndex={0}
              min={0}
              max={100}
              step={5}
              disabled={!this.props.getInputValue('soundOn')}
              showTicks={false}
            />
          </div>
          <div>
            <CheckBox
              {...bindCheckable('unitSpeechOn')}
              label='Unit speech'
              inputProps={{ tabIndex: 0 }}
            />
            <CheckBox
              {...bindCheckable('unitAcknowledgementsOn')}
              label='Unit acknowledgements'
              inputProps={{ tabIndex: 0 }}
            />
            <CheckBox
              {...bindCheckable('backgroundSoundsOn')}
              label='Sound plays while in background'
              inputProps={{ tabIndex: 0 }}
            />
            <CheckBox
              {...bindCheckable('buildingSoundsOn')}
              label='Building sounds'
              inputProps={{ tabIndex: 0 }}
            />
            <CheckBox
              {...bindCheckable('gameSubtitlesOn')}
              label='Game subtitles'
              inputProps={{ tabIndex: 0 }}
            />
            <CheckBox
              {...bindCheckable('cinematicSubtitlesOn')}
              label='Cinematic subtitles'
              inputProps={{ tabIndex: 0 }}
            />
            <CheckBox
              {...bindCheckable('originalVoiceOversOn')}
              label='Original unit voice overs'
              inputProps={{ tabIndex: 0 }}
            />
          </div>
        </FormContainer>
      </form>
    )
  }
}

export default class SoundSettings extends React.Component {
  static propTypes = {
    localSettings: PropTypes.object.isRequired,
    scrSettings: PropTypes.object.isRequired,
    formRef: PropTypes.object.isRequired,
    isRemastered: PropTypes.bool,
    onChange: PropTypes.func.isRequired,
    onSubmit: PropTypes.func.isRequired,
  }

  render() {
    const { scrSettings, formRef, isRemastered } = this.props

    if (!isRemastered) {
      // We don't have yet any sound-related settings for 1.16.1
      return null
    }

    const formScrModel = { ...scrSettings.toJS() }

    return (
      <SoundRemasteredForm
        ref={formRef}
        model={formScrModel}
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
