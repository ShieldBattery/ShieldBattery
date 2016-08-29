import React from 'react'
import { connect } from 'react-redux'
import Dialog from '../material/dialog.jsx'
import FlatButton from '../material/flat-button.jsx'
import Option from '../material/select/option.jsx'
import ValidatedForm from '../forms/validated-form.jsx'
import ValidatedCheckbox from '../forms/validated-checkbox.jsx'
import ValidatedSelect from '../forms/validated-select.jsx'
import ValidatedSlider from '../forms/validated-slider.jsx'
import ValidatedText from '../forms/validated-text-input.jsx'
import { closeDialog } from '../dialogs/dialog-action-creator'
import { setLocalSettings } from './action-creators'
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

const compareResolutions = (a, b) => a.width === b.width && a.height === b.height

@connect(state => ({ settings: state.settings, userEnvironment: state.userEnvironment }))
class Settings extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      displayModeValue: props.settings.local.displayMode,
    }
    this._focusTimeout = null
  }

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

  isFullscreen() {
    return this.state.displayModeValue === 0
  }

  filterWindowSizes(width, height) {
    return SUPPORTED_WINDOW_SIZES.filter(r => r.width <= width && r.height <= height)
  }

  renderWindowSizeOptions(resolution) {
    const { width, height } = resolution
    if (this.isFullscreen()) {
      return <Option value={{width, height}} text={`${width}x${height}`} />
    }

    return this.filterWindowSizes(width, height).map((size, i) => {
      return (<Option key={i} value={{ width: size.width, height: size.height }}
          text={`${size.width}x${size.height}`}/>)
    })
  }

  getDefaultWindowSizeValue(localSettings, resolution) {
    const { width, height } = resolution
    // Happens in initial render when width and height have default values (-1x-1)
    if (width === -1 || height === -1) return null
    if (this.isFullscreen()) return { width, height }

    const filteredSizes = this.filterWindowSizes(width, height)
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

    const buttons = [
      <FlatButton label='Cancel' key='cancel' color='accent'
          onClick={this.onSettingsCanceled} />,
      <FlatButton ref='save' label='Save' key='save' color='accent'
          onClick={this.onSettingsSaved} />
    ]

    const defaultWindowSizeValue = this.getDefaultWindowSizeValue(local, resolution)
    return (<Dialog title={'Settings'} buttons={buttons} onCancel={onCancel}>
      <ValidatedForm ref='form' onSubmitted={this.onFormSubmission}>
        <ValidatedSelect label='Display mode' name='displayMode' tabIndex={0}
            defaultValue={local.displayMode} onValueChanged={this.onDisplayModeChanged}>
          <Option value={0} text='Fullscreen' />
          <Option value={1} text='Borderless Window' />
          <Option value={2} text='Windowed' />
        </ValidatedSelect>
        <ValidatedSelect label='Window size' name='windowSize' tabIndex={0}
            defaultValue={defaultWindowSizeValue} disabled={this.isFullscreen()}
            compareValues={compareResolutions}>
          { this.renderWindowSizeOptions(resolution) }
        </ValidatedSelect>
        <ValidatedCheckbox label='Maintain aspect ratio' name='aspectRatio' tabIndex={0}
            defaultChecked={local.maintainAspectRatio} disabled={!this.isFullscreen()} />
        <ValidatedSelect label='Renderer' name='renderer' tabIndex={0}
            defaultValue={local.renderer}>
          <Option value={0} text='DirectX' />
          <Option value={1} text='OpenGL' />
        </ValidatedSelect>
        <ValidatedSlider label='Mouse sensitivity' name='sensitivity' tabIndex={0}
            min={0} max={4} defaultValue={local.mouseSensitivity} step={1} />
        <ValidatedText label='Starcraft folder path' floatingLabel={true} name='path'
            tabIndex={0} defaultValue={local.starcraftPath} autoCapitalize='off'
            autoCorrect='off' spellCheck={false} required={false}
            onEnterKeyDown={e => this.handleSettingsSaved()}/>
        </ValidatedForm>
    </Dialog>)
  }

  onSettingsSaved = () => {
    this.refs.form.trySubmit()
  };

  onSettingsCanceled = () => {
    this.props.dispatch(closeDialog())
  };

  onDisplayModeChanged = value => {
    this.setState({ displayModeValue: value })
  };

  onFormSubmission = values => {
    const windowSize = values.get('windowSize')
    let starcraftPath = values.get('path')
    if (starcraftPath.endsWith('.exe')) {
      starcraftPath = starcraftPath.slice(0, starcraftPath.lastIndexOf('\\'))
    }
    const newSettings = {
      width: windowSize.width,
      height: windowSize.height,
      displayMode: values.get('displayMode'),
      mouseSensitivity: values.get('sensitivity'),
      maintainAspectRatio: values.get('aspectRatio'),
      renderer: values.get('renderer'),
      starcraftPath,
    }
    this.props.dispatch(setLocalSettings(newSettings))
    this.props.dispatch(closeDialog())
  };
}

export default Settings
