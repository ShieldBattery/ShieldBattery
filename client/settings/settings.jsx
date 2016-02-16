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
import constants from '../../shared/constants'
import { closeDialog } from '../dialogs/dialog-action-creator'
import { getResolution, setLocalSettings } from './action-creators'
import styles from '../material/dialog.css'

@connect(state => ({ settings: state.settings }))
class Settings extends React.Component {
  static contextTypes = {
    store: React.PropTypes.object.isRequired,
  };

  constructor(props) {
    super(props)
    this.state = {
      displayModeValue: props.settings.local.displayMode,
    }
    this._focusTimeout = null

    this._onSettingsSavedClicked = ::this.handleSettingsSaved
    this._onSettingsCanceledClicked = ::this.handleSettingsCanceled
    this._onDisplayModeChanged = ::this.handleDisplayModeChange

    this.supportedWindowSizes = [
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
  }

  componentWillMount() {
    this.context.store.dispatch(getResolution())
  }

  componentDidMount() {
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
    return this.supportedWindowSizes.filter(r => r.width <= width && r.height <= height)
  }

  renderWindowSizeOptions(resolution) {
    const { width, height } = resolution
    const windowSizeOptions = []
    if (this.isFullscreen()) {
      return <Option value={`${width}x${height}`} text={`${width}x${height}`} />
    } else {
      const filteredSizes = this.filterWindowSizes(width, height)

      for (let i = 0; i < filteredSizes.length; i++) {
        windowSizeOptions.push(<Option key={i}
            value={`${filteredSizes[i].width}x${filteredSizes[i].height}`}
            text={`${filteredSizes[i].width}x${filteredSizes[i].height}`} />)
      }
    }

    return windowSizeOptions
  }

  getDefaultWindowSizeValue(localSettings, resolution) {
    const { width, height } = resolution
    if (this.isFullscreen()) return `${width}x${height}`

    const filteredSizes = this.filterWindowSizes(width, height)
    for (let i = 0; i < filteredSizes.length; i++) {
      if (filteredSizes[i].width === localSettings.width &&
          filteredSizes[i].height === localSettings.height) {
        return `${filteredSizes[i].width}x${filteredSizes[i].height}`
      }
    }

    // This case can happen when going from fullscreen resolution (which is not in our supported
    // window sizes) to a windowed mode. We return the highest possible window size
    const highestFilteredSize = filteredSizes[filteredSizes.length - 1]
    return `${highestFilteredSize.width}x${highestFilteredSize.height}`
  }

  render() {
    const { local, resolution } = this.props.settings

    // TODO(2Pac): Add button for 'Reset to default settings' option
    const buttons = [
      <FlatButton label='Cancel' key='cancel' color='accent'
          onClick={this._onSettingsCanceledClicked} />,
      <FlatButton ref='save' label='Save' key='save' color='accent'
          onClick={this._onSettingsSavedClicked} />
    ]

    const portValidator = numberRangeValidator(constants.PORT_MIN_NUMBER, constants.PORT_MAX_NUMBER,
        'Please use 0 - 65535 as a port number')

    const defaultWindowSizeValue = this.getDefaultWindowSizeValue(local, resolution)
    return (
      <div role='dialog' className={styles.contents}>
        <div className={styles.body}>
          <ValidatedForm formTitle='Settings' ref='form' buttons={buttons}
              titleClassName={styles.title} fieldsClassName={styles.body}
              buttonsClassName={styles.actions} onSubmitted={values => this.onSubmitted(values)}>
            {/* TODO(2Pac): Replace this with Number component */}
            <ValidatedText label='Port' floatingLabel={true} name='port' tabIndex={1}
                defaultValue={local.bwPort} autoCapitalize='off' autoCorrect='off'
                spellCheck={false} required={true} requiredMessage='Enter a port number'
                validator={portValidator}
                onEnterKeyDown={e => this.handleSettingsSaved()}/>
            <ValidatedSelect label='Display mode' name='displayMode' tabIndex={1}
                defaultValue={local.displayMode} onValueChanged={this._onDisplayModeChanged}>
              <Option value={0} text='Fullscreen' />
              <Option value={1} text='Borderless Window' />
              <Option value={2} text='Windowed' />
            </ValidatedSelect>
            <ValidatedSelect label='Window size' name='windowSize' tabIndex={1}
                defaultValue={defaultWindowSizeValue} disabled={this.isFullscreen()}>
              { this.renderWindowSizeOptions(resolution) }
            </ValidatedSelect>
            <ValidatedCheckbox label='Maintain aspect ratio' name='aspectRatio' tabIndex={1}
                defaultChecked={local.maintainAspectRatio} />
            <ValidatedSelect label='Renderer' name='renderer' tabIndex={1}
                defaultValue={local.renderer}>
              <Option value={0} text='DirectX' />
              <Option value={1} text='OpenGL' />
            </ValidatedSelect>
            <ValidatedSlider label='Mouse sensitivity' name='sensitivity' tabIndex={1}
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
    this.context.store.dispatch(closeDialog())
  }

  handleDisplayModeChange(value) {
    this.setState({ displayModeValue: value })
  }

  onSubmitted(values) {
    const windowSize = values.get('windowSize')
    const index = windowSize.indexOf('x')
    const width = parseInt(windowSize.slice(0, index), 10)
    const height = parseInt(windowSize.slice(index + 1, windowSize.length), 10)
    const newSettings = {
      bwPort: parseInt(values.get('port'), 10),
      width,
      height,
      displayMode: values.get('displayMode'),
      mouseSensitivity: values.get('sensitivity'),
      maintainAspectRatio: values.get('aspectRatio'),
      renderer: values.get('renderer'),
    }
    this.context.store.dispatch(setLocalSettings(newSettings))
    this.context.store.dispatch(closeDialog())
  }
}

export default Settings
