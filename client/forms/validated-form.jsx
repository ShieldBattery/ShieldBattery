import React from 'react'

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
    let children = React.Children.map(this.props.children, child => {
      if (!child.props.name) {
        // Children without names just won't be validated
        return child
      }
      return React.addons.cloneWithProps(child, {
        ref: child.props.name,
        onChange: this._onInputChange,
        validationError: this.state.errors && this.state.errors.get(child.props.name)
      })
    })

    let title = this.props.formTitle ? (<h3>{this.props.formTitle}</h3>) : undefined
    let errorText = this.props.errorText ? (<span>{this.props.errorText}</span>) : undefined
    let buttons = this.props.buttons ?
        (<div className='button-area'>{this.props.buttons}</div>) : undefined

    return (
      <form {...this.props}>
        <div className='fields'>
          {title}
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
    let errors = new Map()
    for (let refName of Object.keys(this.refs)) {
      let elem = this.refs[refName]
      if (dirtyElements && !dirtyElements.has(elem)) {
        continue
      }

      let error = elem.validate(this)
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

    let errors = this.validate()
    if (errors) return errors

    if (this.props.onSubmitted) {
      this.props.onSubmitted(new Map(Object.keys(this.refs).map(key => {
        let ref = this.refs[key]
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
}

export default ValidatedForm
