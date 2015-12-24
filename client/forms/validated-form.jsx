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

  render() {
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

    const fieldsClassName = classnames(styles.fields, this.props.fieldsClassName)
    const errorsClassName = classnames(styles.errors, this.props.errorsClassName)
    const buttonsClassName = classnames(styles.buttons, this.props.buttonsClassName)

    const title = this.props.formTitle ? (<h3>{this.props.formTitle}</h3>) : undefined
    const errorText = this.props.errorText ?
        (<span className={errorsClassName}>{this.props.errorText}</span>) : undefined
    const buttons = this.props.buttons ?
        (<div className={buttonsClassName}>{this.props.buttons}</div>) : undefined


    return (
      <form {...this.props} noValidate={true}>
        {title}
        <div className={fieldsClassName}>
          {errorText}
          {children}
        </div>
        {buttons}
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
