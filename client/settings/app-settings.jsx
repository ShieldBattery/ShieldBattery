import React from 'react'
import PropTypes from 'prop-types'
import audioManager, { SOUNDS } from '../audio/audio-manager-instance'
import styled from 'styled-components'

import FlatButton from '../material/flat-button.jsx'
import form from '../forms/form.jsx'
import { Label } from '../material/button.jsx'
import Slider from '../material/slider.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'

import PlayIcon from '../icons/material/play_arrow-24px.svg'
import StopIcon from '../icons/material/stop-24px.svg'

import { colorTextSecondary } from '../styles/colors'

const VolumeSettings = styled.div`
  display: flex;
  align-items: flex-end;
  width: 100%;
`

const StyledSlider = styled(Slider)`
  flex-grow: 1;
  margin-bottom: 8px;
`

const TestSoundButton = styled(FlatButton)`
  min-width: 104px;
  margin-left: 16px;

  & ${Label} {
    color: ${colorTextSecondary};
    font-weight: 400;

    svg {
      margin-right: 8px;
    }
  }
`

@form()
class AppForm extends React.Component {
  static propTypes = {
    isPlayingTestSound: PropTypes.bool,
    onMasterVolumeChange: PropTypes.func.isRequired,
    onTestSoundClick: PropTypes.func.isRequired,
  }

  render() {
    const { bindCustom, isPlayingTestSound, onTestSoundClick, onSubmit } = this.props
    const testSoundLabel = isPlayingTestSound ? (
      <>
        <StopIcon />
        <span>Stop</span>
      </>
    ) : (
      <>
        <PlayIcon />
        <span>Test</span>
      </>
    )

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <VolumeSettings>
          <StyledSlider
            {...bindCustom('masterVolume')}
            label='Master volume'
            tabIndex={0}
            min={0}
            max={100}
            step={1}
            showTicks={false}
            onChange={this.onMasterVolumeChange}
          />
          <TestSoundButton label={testSoundLabel} onClick={onTestSoundClick} />
        </VolumeSettings>
      </form>
    )
  }

  onMasterVolumeChange = value => {
    this.props.setInputValue('masterVolume', value)
    this.props.onMasterVolumeChange(value)
  }
}

export default class AppSettings extends React.Component {
  static propTypes = {
    localSettings: PropTypes.object.isRequired,
    formRef: PropTypes.object.isRequired,
    onSubmit: PropTypes.func.isRequired,
  }

  state = {
    isPlayingTestSound: false,
  }

  _sound = null
  _hasSavedSettings = false

  componentWillUnmount() {
    this._cleanup()

    if (!this._hasSavedSettings) {
      // Reset the master volume to what it was
      audioManager.setMasterVolume(this.props.localSettings.masterVolume)
    }
  }

  _cleanup = () => {
    if (this._sound) {
      this.setState({ isPlayingTestSound: false })
      this._sound.stop()
      this._sound = null
    }
  }

  render() {
    const { localSettings, formRef } = this.props
    const { isPlayingTestSound } = this.state
    const formModel = {
      masterVolume: localSettings.masterVolume,
    }

    return (
      <AppForm
        ref={formRef}
        model={formModel}
        isPlayingTestSound={isPlayingTestSound}
        onMasterVolumeChange={this.onMasterVolumeChange}
        onTestSoundClick={this.onTestSoundClick}
        onSubmit={this.onSubmit}
      />
    )
  }

  onMasterVolumeChange = volume => {
    audioManager.setMasterVolume(volume)
  }

  onTestSoundClick = () => {
    if (this._sound) {
      this._cleanup()
      return
    }

    this.setState({ isPlayingTestSound: true })
    // TODO(2Pac): Have some more appropriate sound to test here?
    this._sound = audioManager.playSound(SOUNDS.COUNTDOWN)
    this._sound.onended = this._cleanup
  }

  onSubmit = () => {
    this._hasSavedSettings = true
    const values = this.props.formRef.current.getModel()

    this.props.onSubmit(values)
  }
}
