import React from 'react'
import PropTypes from 'prop-types'

import CheckBox from '../material/check-box.jsx'
import form from '../forms/form.jsx'
import Option from '../material/select/option.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'
import Select from '../material/select/select.jsx'
import Slider from '../material/slider.jsx'

const SUPPORTED_WINDOW_SIZES = [
  { width: 640, height: 480 },
  { width: 800, height: 600 },
  { width: 1024, height: 768 },
  { width: 1152, height: 864 },
  { width: 1280, height: 960 },
  { width: 1400, height: 1050 },
  { width: 1600, height: 1200 },
  { width: 2048, height: 1536 },
  { width: 3200, height: 2400 },
  { width: 4000, height: 3000 },
  { width: 6400, height: 4800 },
]

function filterWindowSizes(width, height) {
  return SUPPORTED_WINDOW_SIZES.filter(r => r.width <= width && r.height <= height)
}

const compareResolutions = (a, b) => a.width === b.width && a.height === b.height

@form()
class SettingsRemasteredForm extends React.Component {
  render() {
    const { bindCustom, onSubmit } = this.props

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <Select {...bindCustom('displayMode')} label='Display mode' tabIndex={0}>
          <Option value={0} text='Fullscreen' />
          <Option value={1} text='Borderless Window' />
          <Option value={2} text='Windowed' />
        </Select>
      </form>
    )
  }
}

@form()
class Settings1161Form extends React.Component {
  isFullscreen() {
    return this.props.getInputValue('displayMode') === 0
  }

  renderWindowSizeOptions(resolution) {
    const { width, height } = resolution
    if (this.isFullscreen()) {
      return <Option value={{ width, height }} text={`${width}x${height}`} />
    }

    return filterWindowSizes(width, height).map((size, i) => {
      return (
        <Option
          key={i}
          value={{ width: size.width, height: size.height }}
          text={`${size.width}x${size.height}`}
        />
      )
    })
  }

  render() {
    const { bindCheckable, bindCustom, onSubmit, resolution } = this.props

    const windowSizeProps = this.isFullscreen()
      ? {
          value: { width: resolution.width, height: resolution.height },
          disabled: true,
        }
      : {
          ...bindCustom('windowSize'),
        }

    return (
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />
        <Select {...bindCustom('displayMode')} label='Display mode' tabIndex={0}>
          <Option value={0} text='Fullscreen' />
          <Option value={1} text='Borderless Window' />
          <Option value={2} text='Windowed' />
        </Select>
        <Select
          {...windowSizeProps}
          label='Window size'
          tabIndex={0}
          compareValues={compareResolutions}>
          {this.renderWindowSizeOptions(resolution)}
        </Select>
        <CheckBox
          {...bindCheckable('maintainAspectRatio')}
          label='Maintain aspect ratio'
          disabled={!this.isFullscreen()}
          inputProps={{ tabIndex: 0 }}
        />
        <Slider
          {...bindCustom('sensitivity')}
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

export default class GameSettings extends React.Component {
  static propTypes = {
    localSettings: PropTypes.object.isRequired,
    resolution: PropTypes.object.isRequired,
    formRef: PropTypes.object.isRequired,
    isRemastered: PropTypes.bool,
    onSubmit: PropTypes.func.isRequired,
  }

  getDefaultWindowSizeValue(localSettings) {
    const { width, height } = this.props.resolution
    const filteredSizes = filterWindowSizes(width, height)
    for (const size of filteredSizes) {
      if (size.width === localSettings.width && size.height === localSettings.height) {
        return { width: size.width, height: size.height }
      }
    }

    // This case can happen when going from fullscreen resolution (which is not in our supported
    // window sizes) to a windowed mode. We return the highest possible window size
    const highest = filteredSizes[filteredSizes.length - 1]
    return { width: highest.width, height: highest.height }
  }

  render() {
    const { localSettings, resolution, formRef, isRemastered } = this.props

    const formModel = {
      displayMode: localSettings.displayMode,
      maintainAspectRatio: localSettings.maintainAspectRatio,
      sensitivity: localSettings.mouseSensitivity,
      windowSize: this.getDefaultWindowSizeValue(localSettings),
    }

    const defaultWindowSize = this.getDefaultWindowSizeValue(localSettings)
    return isRemastered ? (
      <SettingsRemasteredForm ref={formRef} model={formModel} onSubmit={this.onSubmit} />
    ) : (
      <Settings1161Form
        ref={formRef}
        resolution={resolution}
        defaultWindowSize={defaultWindowSize}
        model={formModel}
        onSubmit={this.onSubmit}
      />
    )
  }

  onSubmit = () => {
    const values = this.props.formRef.current.getModel()
    const windowSize = values.windowSize || {}
    const newSettings = {
      width: windowSize.width,
      height: windowSize.height,
      displayMode: values.displayMode,
      mouseSensitivity: values.sensitivity,
      maintainAspectRatio: values.maintainAspectRatio,
    }

    this.props.onSubmit(newSettings)
  }
}
