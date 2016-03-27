import React from 'react'
import { connect } from 'react-redux'
import FlatButton from '../material/flat-button.jsx'
import Option from '../material/select/option.jsx'
import ValidatedForm from '../forms/validated-form.jsx'
import ValidatedCheckbox from '../forms/validated-checkbox.jsx'
import ValidatedSelect from '../forms/validated-select.jsx'
import ValidatedSlider from '../forms/validated-slider.jsx'
import ValidatedText from '../forms/validated-text-input.jsx'
import numberRangeValidator from '../forms/number-range-validator'
import { PORT_MIN_NUMBER, PORT_MAX_NUMBER } from '../../shared/constants'
import { closeDialog } from '../dialogs/dialog-action-creator'
import { setLocalSettings } from './action-creators'
import { getResolution } from '../user-environment/action-creators'
import styles from '../material/dialog.css'

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

const portValidator = numberRangeValidator(PORT_MIN_NUMBER, PORT_MAX_NUMBER,
    'Network port must be a number between 0 and 65535')
const compareResolutions = (a, b) => a.width === b.width && a.height === b.height

@connect(state => ({ settings: state.settings, userEnvironment: state.userEnvironment }))
class Settings extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      displayModeValue: props.settings.local.displayMode,
    }
    this._focusTimeout = null

    this._onSettingsSavedClicked = ::this.handleSettingsSaved
    this._onSettingsCanceledClicked = ::this.handleSettingsCanceled
    this._onDisplayModeChanged = ::this.handleDisplayModeChange
    this._onSubmitted = ::this.handleFormSubmission
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
    const { local } = this.props.settings
    const { resolution } = this.props.userEnvironment

    // TODO(2Pac): Add button for 'Reset to default settings' option
    const buttons = [
      <FlatButton label='Cancel' key='cancel' color='accent'
          onClick={this._onSettingsCanceledClicked} />,
      <FlatButton ref='save' label='Save' key='save' color='accent'
          onClick={this._onSettingsSavedClicked} />
    ]


    const defaultWindowSizeValue = this.getDefaultWindowSizeValue(local, resolution)
    return (
      <div role='dialog' className={styles.contents}>
        <div className={styles.body}>
          <ValidatedForm formTitle='Settings' ref='form' buttons={buttons}
              titleClassName={styles.title} buttonsClassName={styles.actions}
              onSubmitted={this._onSubmitted}>
            <ValidatedText label='Network port' floatingLabel={true} name='port' tabIndex={0}
                defaultValue={local.bwPort} autoCapitalize='off' autoCorrect='off'
                spellCheck={false} required={true} requiredMessage='Enter a port number'
                validator={portValidator}
                onEnterKeyDown={e => this.handleSettingsSaved()}/>
            <ValidatedSelect label='Display mode' name='displayMode' tabIndex={0}
                defaultValue={local.displayMode} onValueChanged={this._onDisplayModeChanged}>
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
          </ValidatedForm>
        </div>
      </div>
    )
  }

  handleSettingsSaved() {
    this.refs.form.trySubmit()
  }

  handleSettingsCanceled() {
    this.props.dispatch(closeDialog())
  }

  handleDisplayModeChange(value) {
    this.setState({ displayModeValue: value })
  }

  handleFormSubmission(values) {
    const windowSize = values.get('windowSize')
    const newSettings = {
      bwPort: parseInt(values.get('port'), 10),
      width: windowSize.width,
      height: windowSize.height,
      displayMode: values.get('displayMode'),
      mouseSensitivity: values.get('sensitivity'),
      maintainAspectRatio: values.get('aspectRatio'),
      renderer: values.get('renderer'),
    }
    this.props.dispatch(setLocalSettings(newSettings))
    this.props.dispatch(closeDialog())
  }
}

export default Settings
