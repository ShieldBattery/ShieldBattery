import React from 'react'
import { connect } from 'react-redux'
import Dialog from '../material/dialog.jsx'
import FlatButton from '../material/flat-button.jsx'
import Option from '../material/select/option.jsx'
import form from '../forms/form.jsx'
import SubmitOnEnter from '../forms/submit-on-enter.jsx'
import CheckBox from '../material/check-box.jsx'
import Select from '../material/select/select.jsx'
import Slider from '../material/slider.jsx'
import TextField from '../material/text-field.jsx'
import { minLength } from '../forms/validators'
import { closeDialog } from '../dialogs/dialog-action-creator'
import { mergeLocalSettings } from './action-creators'
import { getResolution } from '../user-environment/action-creators'

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

@form({
  path: minLength(1, 'StarCraft path is required'),
})
class SettingsForm extends React.Component {
  isFullscreen() {
    return this.props.getInputValue('displayMode') === 0
  }

  renderWindowSizeOptions(resolution) {
    const { width, height } = resolution
    if (this.isFullscreen()) {
      return <Option value={{width, height}} text={`${width}x${height}`} />
    }

    return filterWindowSizes(width, height).map((size, i) => {
      return (<Option key={i} value={{ width: size.width, height: size.height }}
          text={`${size.width}x${size.height}`}/>)
    })
  }

  render() {
    const {
      resolution,
      bindCheckable,
      bindCustom,
      bindInput,
      onSubmit,
    } = this.props

    const windowSizeProps = this.isFullscreen() ? {
      value: { width: resolution.width, height: resolution.height },
      disabled: true,
    } : {
      ...bindCustom('windowSize'),
    }

    return (<form noValidate={true} onSubmit={onSubmit}>
      <SubmitOnEnter/>
      <Select {...bindCustom('displayMode')} label='Display mode' tabIndex={0}>
        <Option value={0} text='Fullscreen' />
        <Option value={1} text='Borderless Window' />
        <Option value={2} text='Windowed' />
      </Select>
      <Select {...windowSizeProps} label='Window size' tabIndex={0}
          compareValues={compareResolutions}>
        { this.renderWindowSizeOptions(resolution) }
      </Select>
      <CheckBox {...bindCheckable('maintainAspectRatio')} label='Maintain aspect ratio'
          disabled={!this.isFullscreen()} inputProps={{ tabIndex: 0 }}/>
      <Select {...bindCustom('renderer')} label='Renderer' tabIndex={0}>
        <Option value={0} text='DirectX' />
        <Option value={1} text='OpenGL' />
      </Select>
      <Slider {...bindCustom('sensitivity')} label='Mouse sensitivity' tabIndex={0}
          min={0} max={10} step={1} />
      <TextField {...bindInput('path')} label='StarCraft folder path' floatingLabel={true}
          inputProps={{
            tabIndex: 0,
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false
          }}/>
    </form>)
  }
}

@connect(state => ({ settings: state.settings, userEnvironment: state.userEnvironment }))
export default class Settings extends React.Component {
  _focusTimeout = null;
  _form = null;
  _setForm = elem => { this._form = elem };

  componentDidMount() {
    this.props.dispatch(getResolution())
    this._focusTimeout = setTimeout(() => {
      this.refs.save.focus()
      this._focusTimeout = null
    }, 0)
  }

  componentWillUnmount() {
    if (this._focusTimeout) {
      clearTimeout(this._focusTimeout)
    }
  }

  getDefaultWindowSizeValue(localSettings, resolution) {
    const { width, height } = resolution
    // Happens in initial render when width and height have default values (-1x-1)
    if (width === -1 || height === -1) return null

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
    const { onCancel } = this.props
    const { local } = this.props.settings
    const { resolution } = this.props.userEnvironment

    const formModel = {
      displayMode: local.displayMode,
      maintainAspectRatio: local.maintainAspectRatio,
      path: local.starcraftPath,
      renderer: local.renderer,
      sensitivity: local.mouseSensitivity,
      windowSize: this.getDefaultWindowSizeValue(local, resolution)
    }

    const buttons = [
      <FlatButton label='Cancel' key='cancel' color='accent'
          onClick={this.onSettingsCancel} />,
      <FlatButton ref='save' label='Save' key='save' color='accent'
          onClick={this.onSettingsSave} />
    ]

    const defaultWindowSize = this.getDefaultWindowSizeValue(local, resolution)
    return (<Dialog title={'Settings'} buttons={buttons} onCancel={onCancel}>
      <SettingsForm
          ref={this._setForm}
          resolution={resolution}
          defaultWindowSize={defaultWindowSize}
          model={formModel}
          onSubmit={this.onSubmit}/>
    </Dialog>)
  }

  onSettingsSave = () => {
    this._form.submit()
  };

  onSettingsCancel = () => {
    this.props.dispatch(closeDialog())
  };

  onSubmit = () => {
    const values = this._form.getModel()
    const windowSize = values.windowSize || {}
    let starcraftPath = values.path
    if (starcraftPath.endsWith('.exe')) {
      starcraftPath = starcraftPath.slice(0, starcraftPath.lastIndexOf('\\'))
    }
    const newSettings = {
      width: windowSize.width,
      height: windowSize.height,
      displayMode: values.displayMode,
      mouseSensitivity: values.sensitivity,
      maintainAspectRatio: values.maintainAspectRatio,
      renderer: values.renderer,
      starcraftPath,
    }
    this.props.dispatch(mergeLocalSettings(newSettings))
    this.props.dispatch(closeDialog())
  };


}
