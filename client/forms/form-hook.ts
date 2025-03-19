import { TFunction } from 'i18next'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConditionalKeys, ReadonlyDeep } from 'type-fest'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getErrorStack } from '../../common/errors'
import logger from '../logging/logger'
import { useImmerState } from '../react/state-hooks'

export interface FormHook<ModelType extends Record<string, any>> {
  /**
   * Event handler that should be attached to the `form` element's onSubmit prop. This can also be
   * called directly if you want to start a form submission because of some other event.
   */
  submit: (event?: React.FormEvent) => void
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
  bindCheckable: <K extends OptionalConditionalKeys<ReadonlyDeep<ModelType>, boolean>>(
    name: K,
  ) => {
    name: K
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
    value: ModelType[K]
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
  bindInput: <K extends OptionalConditionalKeys<ModelType, string>>(
    name: K,
  ) => {
    name: K
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

  /**
   * An opaque value that can be passed to other hooks (such as `useFormCallbacks`) to add behavior
   * to the form.
   */
  form: React.RefObject<FormCallbackRegistry<ModelType>>
}

export type FormEventHandler<ModelType extends Record<string, any>> = (
  model: ReadonlyDeep<ModelType>,
) => void

export type SyncValidator<ValueType, ModelType> = (
  value: ReadonlyDeep<ValueType>,
  model: ReadonlyDeep<ModelType>,
  dirty: ReadonlyMap<keyof ModelType, boolean>,
  t: TFunction,
  signal: AbortSignal,
) => string | undefined
export type AsyncValidator<ValueType, ModelType> = (
  value: ReadonlyDeep<ValueType>,
  model: ReadonlyDeep<ModelType>,
  dirty: ReadonlyMap<keyof ModelType, boolean>,
  t: TFunction,
  signal: AbortSignal,
) => Promise<string | undefined>

export type Validator<ValueType, ModelType> =
  | SyncValidator<ValueType, ModelType>
  | AsyncValidator<ValueType, ModelType>

export type ValidatorMap<ModelType> = Partial<{
  [K in keyof ModelType]: Validator<ModelType[K], ModelType>
}>

type OptionalConditionalKeys<T, MatchType> = ConditionalKeys<T, MatchType | undefined>

/**
 * React hook that provides methods for binding form inputs to update an underlying model and run
 * sync or async validations.
 *
 * @param defaultModel The initial values for the form. This object will not be re-checked after initial
 *   render (similar semantics to `useState`).
 * @param validations A mapping of name -> a function to validate a value for that form input. Any
 *   missing names will be assumed to be valid at all times.
 * @param callbacks A set of callbacks which will be called during various phases of the form.
 */
export function useForm<ModelType extends Record<string, any>>(
  defaultModel: Readonly<ModelType>,
  validations: Readonly<ValidatorMap<ModelType>>,
): FormHook<ModelType> {
  const { t } = useTranslation()
  const [model, updateModel] = useImmerState(() => {
    const model: ModelType = { ...defaultModel }
    return model
  })
  const [validationErrors, updateValidationErrors] = useImmerState(
    () => new Map<keyof ModelType, string>(),
  )
  const [dirtyFields, updateDirtyFields] = useImmerState(() => new Map<keyof ModelType, boolean>())
  const validationPromisesRef = useRef(new Map<keyof ModelType, [Promise<void>, AbortController]>())
  const [validationsOutstanding, setValidationsOutstanding] = useState(0)

  const formCallbackRegistryRef = useRef(new FormCallbackRegistry<ModelType>())

  const setInputError = useCallback(
    (name: keyof ModelType, errorMsg: string | undefined) => {
      updateValidationErrors(draft => {
        if (errorMsg) {
          draft.set(name as any, errorMsg)
        } else {
          draft.delete(name as any)
        }
      })
    },
    [updateValidationErrors],
  )

  const validate = useCallback(
    (name: keyof ModelType) => {
      // NOTE(tec27): We abort regardless of whether validations are present for this key, because the
      // validations can potentially change between renders
      const [_, oldController] = validationPromisesRef.current.get(name) ?? []
      oldController?.abort()
      validationPromisesRef.current.delete(name)
      setValidationsOutstanding(validationPromisesRef.current.size)

      if (!Object.hasOwn(validations, name)) {
        return
      }

      const validator = validations[name]!
      const controller = new AbortController()
      const resultPromise = Promise.try(() =>
        validator(
          (model as ModelType)[name],
          model,
          dirtyFields as ReadonlyMap<keyof ModelType, boolean>,
          t,
          controller.signal,
        ),
      )
        .then(errorMsg => {
          if (
            controller.signal.aborted ||
            validationPromisesRef.current.get(name)?.[0] !== resultPromise
          ) {
            // A newer validation is running on this input, ignore this result
            return
          }

          validationPromisesRef.current.delete(name)
          setInputError(name, errorMsg)
        })
        .catch(err => {
          if (err.name === 'AbortError') {
            return
          }
          logger.error(`Error running form validation for ${String(name)}: ${getErrorStack(err)}`)

          if (validationPromisesRef.current.get(name)?.[0] === resultPromise) {
            validationPromisesRef.current.delete(name)
            setInputError(
              name,
              t(
                'common.validators.validatorError',
                'An unknown error occurred while validating this field',
              ),
            )
          }
        })
        .finally(() => {
          setValidationsOutstanding(validationPromisesRef.current.size)
        })

      controller.signal.addEventListener('abort', () => {
        if (validationPromisesRef.current.get(name)?.[0] === resultPromise) {
          validationPromisesRef.current.delete(name)
          setValidationsOutstanding(validationPromisesRef.current.size)
        }
      })

      validationPromisesRef.current.set(name, [resultPromise, controller])
      setValidationsOutstanding(validationPromisesRef.current.size)
    },
    [dirtyFields, model, setInputError, t, validations],
  )

  const setInputValue = (name: keyof ModelType, value: ModelType[keyof ModelType]) => {
    updateModel(model => {
      ;(model as ModelType)[name] = value
    })
    updateDirtyFields(dirtyFields => {
      ;(dirtyFields as Map<keyof ModelType, boolean>).set(name, true)
    })
  }

  const submit = (event?: React.FormEvent) => {
    // Don't actually submit the form over HTTP
    event?.preventDefault()

    // Run validations against everything that's not dirty to double-check their validity.
    for (const name of Object.keys(model)) {
      if (!dirtyFields.get(name as ReadonlyDeep<keyof ModelType>)) {
        validate(name as keyof ModelType)
      }
    }

    const promises = Array.from(validationPromisesRef.current.values(), ([p]) => p)
    Promise.all(promises)
      .then(() => {
        // NOTE(tec27): We need access to the latest state, so we use an updater but don't actually
        // mutate it. Kind of hacky but most options aren't great here, and since we don't mutate
        // the state it shouldn't generate another render.
        updateValidationErrors(draft => {
          let isValid = true
          // NOTE(tec27): Not using `iterator#every` here because it seems to not be available on
          // the immer proxy
          for (const validationError of draft.values()) {
            if (validationError) {
              isValid = false
              break
            }
          }

          if (isValid) {
            formCallbackRegistryRef.current._triggerOnSubmit(model)
          }
        })
      })
      .catch(swallowNonBuiltins) // This should never actually happen because these have a catch-all
  }

  useEffect(() => {
    // Trigger validations for any fields that are dirty whenever the model/dirty fields change
    for (const [name, dirty] of dirtyFields.entries()) {
      if (dirty) {
        validate(name as keyof ModelType)
      }
    }
  }, [model, dirtyFields, validate, validations])

  useEffect(() => {
    formCallbackRegistryRef.current._triggerOnChange(model)
  }, [model])

  useEffect(() => {
    if (validationErrors.size === 0 && validationsOutstanding === 0) {
      formCallbackRegistryRef.current._triggerOnValidatedChange(model)
    }
  }, [model, validationErrors, validationsOutstanding])

  useEffect(() => {
    // Abort any unfinished validations when the form unmounts
    const validationPromises = validationPromisesRef.current
    return () => {
      for (const [, [, controller]] of validationPromises) {
        controller.abort()
      }
    }
  }, [])

  return {
    submit,
    bindCheckable: name => ({
      name,
      onChange: event => {
        const { name, checked } = event.target
        setInputValue(name as keyof ModelType, checked as any)
      },
      checked: !!model[name],
      errorText: validationErrors.get(name as any),
    }),
    bindCustom: name => ({
      name,
      onChange: newValue => {
        setInputValue(name, newValue)
      },
      value: (model as ModelType)[name],
      errorText: validationErrors.get(name as any),
    }),
    bindInput: name => ({
      name,
      onChange: event => {
        const { name, value } = event.target
        setInputValue(name as keyof ModelType, value as any)
      },
      value: (model as ModelType)[name],
      errorText: validationErrors.get(name as any),
    }),
    getInputValue: name => {
      return (model as ModelType)[name]
    },
    setInputValue,
    setInputError,
    form: formCallbackRegistryRef,
  }
}

export interface FormCallbacks<ModelType extends Record<string, any>> {
  onSubmit: FormEventHandler<ModelType>
  onChange: FormEventHandler<ModelType>
  onValidatedChange: FormEventHandler<ModelType>
}

export class FormCallbackRegistry<ModelType extends Record<string, any>> {
  // NOTE(tec27): These start as undefined as a minor optimization to avoid creating empty arrays on
  // each render of the form
  private onSubmitHandlers: Array<FormEventHandler<ModelType>> | undefined = undefined
  private onChangeHandlers: Array<FormEventHandler<ModelType>> | undefined = undefined
  private onValidatedChangeHandlers: Array<FormEventHandler<ModelType>> | undefined = undefined

  registerListeners({ onSubmit, onChange, onValidatedChange }: Partial<FormCallbacks<ModelType>>) {
    if (onSubmit) {
      if (!this.onSubmitHandlers) {
        this.onSubmitHandlers = [onSubmit]
      } else {
        this.onSubmitHandlers.push(onSubmit)
      }
    }
    if (onChange) {
      if (!this.onChangeHandlers) {
        this.onChangeHandlers = [onChange]
      } else {
        this.onChangeHandlers.push(onChange)
      }
    }
    if (onValidatedChange) {
      if (!this.onValidatedChangeHandlers) {
        this.onValidatedChangeHandlers = [onValidatedChange]
      } else {
        this.onValidatedChangeHandlers.push(onValidatedChange)
      }
    }
  }

  unregisterListeners({
    onSubmit,
    onChange,
    onValidatedChange,
  }: Partial<FormCallbacks<ModelType>>) {
    if (onSubmit) {
      const index = this.onSubmitHandlers?.indexOf(onSubmit) ?? -1
      if (index !== -1) {
        this.onSubmitHandlers?.splice(index, 1)
      }
    }
    if (onChange) {
      const index = this.onChangeHandlers?.indexOf(onChange) ?? -1
      if (index !== -1) {
        this.onChangeHandlers?.splice(index, 1)
      }
    }
    if (onValidatedChange) {
      const index = this.onValidatedChangeHandlers?.indexOf(onValidatedChange) ?? -1
      if (index !== -1) {
        this.onValidatedChangeHandlers?.splice(index, 1)
      }
    }
  }

  _triggerOnSubmit(model: ReadonlyDeep<ModelType>) {
    if (!this.onSubmitHandlers) {
      return
    }

    for (const handler of this.onSubmitHandlers) {
      handler(model)
    }
  }

  _triggerOnChange(model: ReadonlyDeep<ModelType>) {
    if (!this.onChangeHandlers) {
      return
    }

    for (const handler of this.onChangeHandlers) {
      handler(model)
    }
  }

  _triggerOnValidatedChange(model: ReadonlyDeep<ModelType>) {
    if (!this.onValidatedChangeHandlers) {
      return
    }

    for (const handler of this.onValidatedChangeHandlers) {
      handler(model)
    }
  }
}

export function useFormCallbacks<ModelType extends Record<string, any>>(
  form: React.RefObject<FormCallbackRegistry<ModelType>>,
  formCallbacks: Partial<FormCallbacks<ModelType>>,
) {
  useEffect(() => {
    const _form = form.current

    _form.registerListeners(formCallbacks)
    return () => {
      _form.unregisterListeners(formCallbacks)
    }
  }, [form, formCallbacks])
}
