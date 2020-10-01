import React from 'react'
import hoistNonReactStatics from 'hoist-non-react-statics'
import shallowEquals from '../../common/shallow-equals'
import createDeferred from '../../common/async/deferred'

function getDisplayName(WrappedComponent) {
  return WrappedComponent.displayName || WrappedComponent.name || 'Component'
}

// `validations` is an object where keys are names to validate, and values are functions that return
// either a string or a falsy value (for synchronous validations) or a promise that returns a string
// or falsy value (for asynchronous). Promise errors are not handled, so if they should be converted
// to something, that chain must be handled/converted by the validator function.
//
// Validator functions receive (value, model).
export default (validations = {}) => Wrapped => {
  class FormWrapper extends React.Component {
    static displayName = `Form(${getDisplayName(Wrapped)})`

    // Allows us to cache bound functions to avoid causing unnecessary prop changes. Only gets
    // cleaned up when this component unmounts, but that generally shouldn't be an issue.
    _customChangeHandlers = Object.create(null)
    _validationPromises = Object.create(null)
    _notifyValidation = []
    _doOnSubmit = () => this.props.onSubmit(this)

    state = {
      model: this.props.model,
      dirty: Object.create(null),
      validationErrors: Object.create(null),
    }

    componentDidUpdate(oldProps, oldState) {
      if (!shallowEquals(oldProps.model, this.props.model)) {
        this.setState({
          model: this.props.model,
          dirty: Object.create(null),
          validationErrors: Object.create(null),
        })
      } else if (!shallowEquals(oldState.model, this.state.model)) {
        this.validateAll()
      }
    }

    componentWillUnmount() {
      // Ensure that validations do nothing once unmounted
      this._validationPromises = Object.create(null)
      this._doOnSubmit = null
    }

    onChange = () => {
      if (!this.props.onChange) return

      this.props.onChange()
    }

    onSubmit = event => {
      if (!this.props.onSubmit) return

      // Don't actually submit the form over HTTP
      if (event) {
        event.preventDefault()
      }
      this.forceValidations()

      const checkValidations = () => {
        // If the form isn't valid, we never submit
        if (!this.isValid()) {
          // TODO(tec27): focus first invalid field?
          return
        }

        // Check if we are currently waiting for any validations to finish
        const awaitingValidations = Object.keys(this._validationPromises)
          .map(k => this._validationPromises[k])
          .filter(v => !!v)
        // If we aren't, we can go ahead and submit
        if (!awaitingValidations.length) {
          this._doOnSubmit()
          return
        }

        // Otherwise, we wait for any of the validations to finish, or for a new validation request
        // to occur. When either of those things happen, we re-check the validations
        const interrupt = createDeferred()
        this._notifyValidation.push(interrupt)
        Promise.race(awaitingValidations.concat(interrupt)).then(checkValidations, checkValidations)
      }

      checkValidations()
    }

    validate(name) {
      if (validations.hasOwnProperty(name)) {
        const resultPromise = Promise.resolve(
          validations[name](this.state.model[name], this.state.model, this.state.dirty),
        )
        this._validationPromises[name] = resultPromise
        resultPromise.then(errorMsg => {
          if (this._validationPromises[name] === resultPromise) {
            if (this.state.validationErrors[name] !== errorMsg) {
              this.setState({
                validationErrors: {
                  ...this.state.validationErrors,
                  [name]: errorMsg,
                },
              })
            }
            this._validationPromises[name] = null
          }
        })

        // Wake up all the things waiting for validations to complete to tell them there is a new
        // validation promise
        for (const deferred of this._notifyValidation) {
          deferred.resolve()
          this._notifyValidation.length = 0
        }
      }
    }

    validateAll() {
      for (const name of Object.keys(this.state.dirty)) {
        this.validate(name)
      }
    }

    onInputChange = event => {
      const { name, value } = event.target
      this.setInputValue(name, value)
    }

    onCheckableChange = event => {
      const { name, checked } = event.target
      this.setInputValue(name, checked)
    }

    onCustomChange = (name, newValue) => {
      this.setInputValue(name, newValue)
    }

    // Binds a DOM input (`<input>` tag, etc.) to this form instance
    bindInput = name => {
      const value = this.state.model[name] != null ? this.state.model[name] : ''
      return {
        name,
        onChange: this.onInputChange,
        value,
        errorText: this.state.validationErrors[name],
      }
    }

    // Binds a DOM input that uses the `checked` attribute (e.g. `<input type="checkbox">`) to this
    // form instance
    bindCheckable = name => {
      return {
        name,
        onChange: this.onCheckableChange,
        checked: !!this.state.model[name],
        errorText: this.state.validationErrors[name],
      }
    }

    // Binds a custom form element (that doesn't use normal DOM input elements or have change events
    // that include a target with a value) to this form instance
    bindCustom = name => {
      if (!this._customChangeHandlers[name]) {
        this._customChangeHandlers[name] = newValue => this.onCustomChange(name, newValue)
      }
      const value = this.state.model[name] !== undefined ? this.state.model[name] : null
      return {
        name,
        onChange: this._customChangeHandlers[name],
        value,
        errorText: this.state.validationErrors[name],
      }
    }

    getInputValue = name => this.state.model[name]
    setInputValue = (name, value) => {
      this.setState(
        () => ({
          model: {
            ...this.state.model,
            [name]: value,
          },
          dirty: {
            ...this.state.dirty,
            [name]: true,
          },
        }),
        this.onChange,
      )
    }
    setInputError = (name, errorMsg) => {
      this.setState({
        validationErrors: {
          ...this.state.validationErrors,
          [name]: errorMsg,
        },
      })
    }

    getModel() {
      return this.state.model
    }

    isValid() {
      for (const name of Object.keys(this.state.validationErrors)) {
        if (this.state.validationErrors[name]) {
          return false
        }
      }

      return true
    }

    // Marks all elements as dirty and runs validations. For use during e.g. form submission.
    // Doesn't guarantee that async validations have finished when it returns.
    forceValidations() {
      for (const name of Object.keys(validations)) {
        // Only validate things that aren't dirty, since dirty elements have already had a
        // validation triggered
        if (!this.state.dirty[name]) {
          this.validate(name)
        }
      }
    }

    // Runs through all of the logic that happens during a normal form submission, up to and
    // including calling onSubmit.
    submit() {
      this.onSubmit()
    }

    // Resets the input values to the model passed in props
    reset() {
      this.setState({
        model: this.props.model,
        dirty: Object.create(null),
        validationErrors: Object.create(null),
      })
    }

    render() {
      const childProps = {
        ...this.props,
        model: undefined,
        onSubmit: this.onSubmit,
        bindCheckable: this.bindCheckable,
        bindCustom: this.bindCustom,
        bindInput: this.bindInput,
        getInputValue: this.getInputValue,
        setInputValue: this.setInputValue,
        setInputError: this.setInputError,
      }

      return <Wrapped {...childProps} />
    }
  }

  return hoistNonReactStatics(FormWrapper, Wrapped)
}
