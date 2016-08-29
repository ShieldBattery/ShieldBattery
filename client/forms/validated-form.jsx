import React from 'react'
import classnames from 'classnames'
import styles from './forms.css'

class ValidatedForm extends React.Component {
  constructor() {
    super()

    this._onInputChange = e => this._handleInputChange(e)

    this.state = {
      dirtyElements: new Set(),
      errors: null,
      notSubmitted: true,
    }
  }

  getInputRef(name) {
    return this.refs[name]
  }

  render() {
    const {
      formTitle,
      errorText,
      buttons,
      onSubmitted, // eslint-disable-line no-unused-vars
      titleClassName,
      errorsClassName,
      fieldsClassName,
      buttonsClassName,
      ...otherProps,
    } = this.props
    const children = React.Children.map(this.props.children, child => {
      if (!child.props.name) {
        // Children without names just won't be validated
        return child
      }
      return React.cloneElement(child, {
        key: child.props.name,
        ref: child.props.name,
        onChange: this._onInputChange,
        validationError: this.state.errors && this.state.errors.get(child.props.name)
      })
    })

    const titleClass = classnames(styles.title, titleClassName)
    const fieldsClass = classnames(styles.fields, fieldsClassName)
    const errorsClass = classnames(styles.errors, errorsClassName)
    const buttonsClass = classnames(styles.buttons, buttonsClassName)

    const title = formTitle ? (<h3 className={titleClass}>{formTitle}</h3>) : undefined
    const error = errorText ? (<span className={errorsClass}>{errorText}</span>) : undefined
    const formButtons = buttons ? (<div className={buttonsClass}>{buttons}</div>) : undefined

    return (
      <form {...otherProps} noValidate={true}>
        {title}
        <div className={fieldsClass}>
          {error}
          {children}
        </div>
        {formButtons}
      </form>
    )
  }

  getValueOf(name) {
    return this.refs[name].getValue()
  }

  validate(dirtyElements = null) {
    const errors = new Map()
    for (const refName of Object.keys(this.refs)) {
      const elem = this.refs[refName]
      if (dirtyElements && !dirtyElements.has(elem)) {
        continue
      }

      const error = elem.validate(this)
      if (error) {
        errors.set(refName, error)
      }
    }

    if (errors.size) {
      this.setState({
        errors
      })
      return errors
    } else {
      this.setState({
        errors: null
      })
      return null
    }
  }

  trySubmit() {
    this.setState({
      dirtyElements: null,
      notSubmitted: false,
    })

    const errors = this.validate()
    if (errors) return errors

    if (this.props.onSubmitted) {
      this.props.onSubmitted(new Map(Object.keys(this.refs).map(key => {
        const ref = this.refs[key]
        return [ ref.props.name, ref.getValue() ]
      })))
    }

    return undefined
  }

  _handleInputChange(elem) {
    let dirty
    if (this.state.notSubmitted && !this.state.dirtyElements.has(elem)) {
      dirty = new Set(this.state.dirtyElements)
      dirty.add(elem)
      this.setState({
        dirtyElements: dirty
      })
    } else if (this.state.notSubmitted) {
      dirty = this.state.dirtyElements
    }

    this.validate(dirty)
  }
}

ValidatedForm.propTypes = {
  formTitle: React.PropTypes.string,
  errorText: React.PropTypes.string,
  buttons: React.PropTypes.node,
  onSubmitted: React.PropTypes.func,
  titleClassName: React.PropTypes.oneOfType([
    React.PropTypes.string,
    React.PropTypes.array,
    React.PropTypes.object,
  ]),
  errorsClassName: React.PropTypes.oneOfType([
    React.PropTypes.string,
    React.PropTypes.array,
    React.PropTypes.object,
  ]),
  fieldsClassName: React.PropTypes.oneOfType([
    React.PropTypes.string,
    React.PropTypes.array,
    React.PropTypes.object,
  ]),
  buttonsClassName: React.PropTypes.oneOfType([
    React.PropTypes.string,
    React.PropTypes.array,
    React.PropTypes.object,
  ]),
}

export default ValidatedForm
