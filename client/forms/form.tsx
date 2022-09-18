import hoistNonReactStatics from 'hoist-non-react-statics'
import React from 'react'
import { ConditionalKeys } from 'type-fest'
import createDeferred, { Deferred } from '../../common/async/deferred'
import shallowEquals from '../../common/shallow-equals'

function getDisplayName(WrappedComponent: React.ComponentType<any>): string {
  return (WrappedComponent as any).displayName || (WrappedComponent as any).name || 'Component'
}

export type SyncValidator<ValueType, ModelType> = (
  value: ValueType,
  model: ModelType,
  dirty: Partial<Record<keyof ModelType, boolean>>,
) => string | false | null | undefined
export type AsyncValidator<ValueType, ModelType> = (
  value: ValueType,
  model: ModelType,
  dirty: Partial<Record<keyof ModelType, boolean>>,
) => Promise<string | false | null | undefined>

export type Validator<ValueType, ModelType> =
  | SyncValidator<ValueType, ModelType>
  | AsyncValidator<ValueType, ModelType>

export type ValidatorMap<ModelType> = Partial<{
  [K in keyof ModelType]: Validator<ModelType[K], ModelType>
}>

export interface FormWrapper<ModelType> {
  getModel(): ModelType
  reset(): void
  submit(): void
  forceValidations(): void
  isValid(): boolean
}

export interface FormWrapperProps<ModelType> {
  model: ModelType
  onSubmit: (formWrapper: FormWrapper<ModelType>) => void
  onChange?: (formWrapper: FormWrapper<ModelType>) => void
}

interface FormWrapperState<ModelType> {
  model: ModelType
  dirty: Partial<Record<keyof ModelType, boolean>>
  validationErrors: Partial<Record<keyof ModelType, string>>
}

export type NullableConditionalKeys<T, MatchType> = ConditionalKeys<T, MatchType> &
  ConditionalKeys<T, MatchType | null> &
  ConditionalKeys<T, MatchType | undefined> &
  ConditionalKeys<T, MatchType | null | undefined>

export interface FormChildProps<ModelType> {
  /** Event handler that should be attached to the `form` element's onSubmit prop. */
  onSubmit: (event?: React.FormEvent) => void
  /**
   * Returns a list of props that bind a checkbox or checkbox-like element to the form wrapper,
   * such that validations can run on it when it changes and error messages will be displayed.
   *
   * Example:
   *
   * ```
   * <CheckBox
   *   {...bindCheckable('myCoolValue')}
   *   label='Cool value'
   * />
   * ```
   */
  bindCheckable: (name: NullableConditionalKeys<ModelType, boolean>) => {
    name: NullableConditionalKeys<ModelType, boolean>
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
    checked: boolean
    errorText: string | undefined
  }
  /**
   * Returns a list of props that bind a custom (non-HTMLInputElement-based) element to the form
   * wrapper, such that validations can run on it when it changes and error messages will be
   * displayed.
   *
   * Example:
   *
   * ```
   * <NumberTextField
   *   {...bindCustom('myCustomValue')}
   *   label={'Custom value'}
   * />
   * ```
   */
  bindCustom: <K extends keyof ModelType>(
    name: K,
  ) => {
    name: K
    onChange: (newValue: ModelType[K]) => void
    // TODO(tec27): Probably this should be encapsulated in the ModelType instead of doing this
    // conversion?
    value: ModelType[K] | null
    errorText: string | undefined
  }
  /**
   * Returns a list of props to bind an input (with a string value) element to the form wrapper,
   * such that validations can run on it when it changes and error messages will be displayed.
   *
   * Example:
   *
   * ```
   * <TextField
   *   {...bindInput('myInput')}
   *   label={'Input something'}
   * />
   * ```
   */
  bindInput: (name: NullableConditionalKeys<ModelType, string>) => {
    name: NullableConditionalKeys<ModelType, string>
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void
    value: string
    errorText: string | undefined
  }
  /**
   * Returns the current value for form input `name` in the model.
   */
  getInputValue: <K extends keyof ModelType>(name: K) => ModelType[K]
  /**
   * Sets the current value for form input `name` in the model.
   */
  setInputValue: <K extends keyof ModelType>(name: K, value: ModelType[K]) => void
  /**
   * Sets the current error for form input `name` in the model. Can be `undefined` to clear
   * existing errors.
   */
  setInputError: (name: keyof ModelType, errorMsg: string | undefined) => void
}

/**
 * A Higher Order Component decorator for implementing forms that have validation logic.
 *
 * `validations` is an object where keys are names to validate, and values are functions that return
 * either a string or a falsy value (for synchronous validations) or a promise that returns a string
 * or falsy value (for asynchronous). Promise errors are not handled, so if they should be converted
 * to something, that chain must be handled/converted by the validator function.
 *
 * Validator functions receive (value, model).
 */
export default function formDecorator<ModelType extends Record<string, any>, WrappedProps>(
  validations: ValidatorMap<ModelType> = {},
) {
  return (
    Wrapped: React.ComponentType<WrappedProps & FormChildProps<ModelType>>,
  ): React.ComponentClass<WrappedProps & FormWrapperProps<ModelType>> & FormWrapper<ModelType> => {
    class FormWrapperImpl
      extends React.Component<
        WrappedProps & FormWrapperProps<ModelType>,
        FormWrapperState<ModelType>
      >
      implements FormWrapper<ModelType>
    {
      static displayName = `Form(${getDisplayName(Wrapped)})`

      // Allows us to cache bound functions to avoid causing unnecessary prop changes. Only gets
      // cleaned up when this component unmounts, but that generally shouldn't be an issue.
      private customChangeHandlers: Partial<Record<keyof ModelType, (newValue: any) => void>> =
        Object.create(null)
      private validationPromises: Partial<
        Record<keyof ModelType, Promise<string | false | null | undefined>>
      > = Object.create(null)
      private notifyValidation: Array<Deferred<void>> = []
      private doOnSubmit: (() => void) | undefined = () => this.props.onSubmit(this)

      override state: FormWrapperState<ModelType> = {
        model: this.props.model,
        dirty: Object.create(null),
        validationErrors: Object.create(null),
      }

      override componentDidUpdate(
        oldProps: FormWrapperProps<ModelType>,
        oldState: FormWrapperState<ModelType>,
      ) {
        if (!shallowEquals(oldProps.model, this.props.model)) {
          this.setState({
            model: this.props.model,
            dirty: Object.create(null),
            validationErrors: Object.create(null),
          })
        } else if (!shallowEquals(oldState.model, this.state.model)) {
          // TODO(tec27): Ideally this would only re-validate things that changed in the model,
          // but we can't really do that because the full understanding of dependencies aren't
          // noted (e.g. if you validate that a field matches another one, you need to re-run
          // that validation if *either* field changes).
          this.validateAll()
        }
      }

      override componentWillUnmount() {
        // Ensure that validations do nothing once unmounted
        this.validationPromises = Object.create(null)
        this.doOnSubmit = undefined
      }

      onChange = () => {
        if (!this.props.onChange) return

        this.props.onChange(this)
      }

      onSubmit = (event?: React.FormEvent) => {
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
          const awaitingValidations = Object.keys(this.validationPromises)
            .map(k => this.validationPromises[k as keyof ModelType])
            .filter(v => !!v)
          // If we aren't, we can go ahead and submit
          if (!awaitingValidations.length) {
            if (this.doOnSubmit) {
              this.doOnSubmit()
            }
            return
          }

          // Otherwise, we wait for any of the validations to finish, or for a new validation
          // request to occur. When either of those things happen, we re-check the validations
          const interrupt = createDeferred<void>()
          this.notifyValidation.push(interrupt)
          Promise.race([...awaitingValidations, interrupt]).then(checkValidations, checkValidations)
        }

        checkValidations()
      }

      validate(name: keyof ModelType) {
        if (validations.hasOwnProperty(name)) {
          const resultPromise = Promise.resolve(
            validations[name]!(this.state.model[name], this.state.model, this.state.dirty),
          )
          this.validationPromises[name] = resultPromise
          resultPromise.then(errorMsg => {
            if (this.validationPromises[name] === resultPromise) {
              if (this.state.validationErrors[name] !== errorMsg) {
                this.setState({
                  validationErrors: {
                    ...this.state.validationErrors,
                    [name]: errorMsg,
                  },
                })
              }
              this.validationPromises[name] = undefined
            }
          })

          // Wake up all the things waiting for validations to complete to tell them there is a new
          // validation promise
          for (const deferred of this.notifyValidation) {
            deferred.resolve()
          }
          this.notifyValidation.length = 0
        }
      }

      validateAll() {
        for (const name of Object.keys(this.state.dirty)) {
          this.validate(name as keyof ModelType)
        }
      }

      onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = event.target
        this.setInputValue(name as keyof ModelType, value as any)
      }

      onCheckableChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { name, checked } = event.target
        this.setInputValue(name as keyof ModelType, checked as any)
      }

      onCustomChange = <K extends keyof ModelType>(name: K, newValue: ModelType[K]) => {
        this.setInputValue(name, newValue)
      }

      /** Binds a DOM input (`<input>` tag, etc.) to this form instance. */
      bindInput = (name: NullableConditionalKeys<ModelType, string>) => {
        const value = (this.state.model[name] != null ? this.state.model[name] : '') as string
        return {
          name,
          onChange: this.onInputChange,
          value,
          errorText: this.state.validationErrors[name],
        }
      }

      /**
       * Binds a DOM input that uses the `checked` attribute (e.g. `<input type="checkbox">`) to
       * this form instance.
       */
      bindCheckable = (name: NullableConditionalKeys<ModelType, boolean>) => {
        return {
          name,
          onChange: this.onCheckableChange,
          checked: !!this.state.model[name],
          errorText: this.state.validationErrors[name],
        }
      }

      /**
       * Binds a custom form element (that doesn't use normal DOM input elements or have change
       * events that include a target with a value) to this form instance.
       */
      bindCustom = <K extends keyof ModelType>(name: K) => {
        if (!this.customChangeHandlers[name]) {
          this.customChangeHandlers[name] = (newValue: ModelType[K]) =>
            this.onCustomChange(name, newValue)
        }
        const value = this.state.model[name] !== undefined ? this.state.model[name] : null
        return {
          name,
          onChange: this.customChangeHandlers[name]!,
          value,
          errorText: this.state.validationErrors[name],
        }
      }

      getInputValue = <K extends keyof ModelType>(name: K) => this.state.model[name]
      setInputValue = <K extends keyof ModelType>(name: K, value: ModelType[K]) => {
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
      setInputError = (name: keyof ModelType, errorMsg: string | undefined) => {
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
        return !Object.values(this.state.validationErrors).some(
          validationError => !!validationError,
        )
      }

      // Marks all elements as dirty and runs validations. For use during e.g. form submission.
      // Doesn't guarantee that async validations have finished when it returns.
      forceValidations() {
        for (const name of Object.keys(validations)) {
          // Only validate things that aren't dirty, since dirty elements have already had a
          // validation triggered
          if (!this.state.dirty[name as keyof ModelType]) {
            this.validate(name as keyof ModelType)
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

      override render() {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { model, onSubmit, onChange, ...propsToSpread } = this.props

        const childProps: FormChildProps<ModelType> = {
          onSubmit: this.onSubmit,
          bindCheckable: this.bindCheckable,
          bindCustom: this.bindCustom,
          bindInput: this.bindInput,
          getInputValue: this.getInputValue,
          setInputValue: this.setInputValue,
          setInputError: this.setInputError,
        }

        return <Wrapped {...(propsToSpread as unknown as WrappedProps)} {...childProps} />
      }
    }

    return hoistNonReactStatics(FormWrapperImpl, Wrapped) as any
  }
}
