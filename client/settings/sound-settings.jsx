import React from 'react'
import PropTypes from 'prop-types'

import CheckBox from '../material/check-box.jsx'
import form from '../forms/form.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'
import Slider from '../material/slider.jsx'

@form()
class SoundRemasteredForm extends React.Component {
  render() {
    const { bindCheckable, bindCustom, onSubmit } = this.props

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <CheckBox
          {...bindCheckable('musicOn')}
          label='Turn Music On'
          inputProps={{ tabIndex: 0 }}
        />
        <Slider
          {...bindCustom('musicVolume')}
          label='Music Volume'
          tabIndex={0}
          min={0}
          max={100}
          step={5}
          disabled={!this.props.getInputValue('musicOn')}
          showTicks={false}
        />
        <CheckBox
          {...bindCheckable('soundOn')}
          label='Turn Digital Sounds On'
          inputProps={{ tabIndex: 0 }}
        />
        <Slider
          {...bindCustom('soundVolume')}
          label='Digital Volume'
          tabIndex={0}
          min={0}
          max={100}
          step={5}
          disabled={!this.props.getInputValue('soundOn')}
          showTicks={false}
        />
        <CheckBox
          {...bindCheckable('unitSpeechOn')}
          label='Unit Speech'
          inputProps={{ tabIndex: 0 }}
        />
        <CheckBox
          {...bindCheckable('unitAcknowledgementsOn')}
          label='Unit Acknowledgements'
          inputProps={{ tabIndex: 0 }}
        />
        <CheckBox
          {...bindCheckable('backgroundSoundsOn')}
          label='Sound Plays While In Background'
          inputProps={{ tabIndex: 0 }}
        />
        <CheckBox
          {...bindCheckable('buildingSoundsOn')}
          label='Building Sounds'
          inputProps={{ tabIndex: 0 }}
        />
        <CheckBox
          {...bindCheckable('gameSubtitlesOn')}
          label='Game Subtitles'
          inputProps={{ tabIndex: 0 }}
        />
        <CheckBox
          {...bindCheckable('cinematicSubtitlesOn')}
          label='Cinematic Subtitles'
          inputProps={{ tabIndex: 0 }}
        />
        <CheckBox
          {...bindCheckable('originalVoiceOversOn')}
          label='Original Unit Voice Overs'
          inputProps={{ tabIndex: 0 }}
        />
        <CheckBox
          {...bindCheckable('original1998CampaignOn')}
          label='Original 1998 Campaign'
          inputProps={{ tabIndex: 0 }}
        />
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
