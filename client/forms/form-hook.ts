import { TFunction } from 'i18next'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConditionalKeys } from 'type-fest'
import createDeferred, { Deferred } from '../../common/async/deferred.js'
import shallowEquals from '../../common/shallow-equals.js'

export interface FormHook<ModelType> {
  /**
   * Event handler that should be attached to the `form` element's onSubmit prop. This can also be
   * called directly if you want to start a form submission because of some other event.
   */
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
  bindCheckable: <K extends OptionalConditionalKeys<ModelType, boolean>>(
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
}

export type SyncValidator<ValueType, ModelType> = (
  value: Readonly<ValueType>,
  model: Readonly<ModelType>,
  dirty: ReadonlyMap<keyof ModelType, boolean>,
  t: TFunction,
) => string | undefined
export type AsyncValidator<ValueType, ModelType> = (
  value: Readonly<ValueType>,
  model: Readonly<ModelType>,
  dirty: ReadonlyMap<keyof ModelType, boolean>,
  t: TFunction,
) => Promise<string | undefined>

export type Validator<ValueType, ModelType> =
  | SyncValidator<ValueType, ModelType>
  | AsyncValidator<ValueType, ModelType>

export type ValidatorMap<ModelType> = Partial<{
  [K in keyof ModelType]: Validator<ModelType[K], ModelType>
}>

/**
 * React hook that provides methods for binding form inputs to update an underlying model and run
 * sync or async validations.
 *
 * @param model The initial values for the form. This object will not be re-checked after initial
 *   render (similar semantics to `useState`).
 * @param validations A mapping of name -> a function to validate a value for that form input. Any
 *   missing names will be assumed to be valid at all times.
 * @param callbacks A set of callbacks which will be called during various phases of the form.
 */
export function useForm<ModelType>(
  model: Readonly<ModelType>,
  validations: Readonly<ValidatorMap<ModelType>>,
  callbacks: {
    /** Called when the form has been submitted and the model is free of validation errors. */
    onSubmit?: (model: Readonly<ModelType>) => void
    /** Called when the form's model has changed (may not be valid). */
    onChange?: (model: Readonly<ModelType>) => void
    /**
     * Called when the form's model has changed and the data *that has been modified* is valid.
     * Inputs that have not been modified will not be validated, so if e.g. your form has a required
     * field, it may not be present in the model passed to this callback.
     *
     * NOTE: This can be somewhat spammy, if you're using it to save things, it should probably be
     * debounced.
     */
    onValidatedChange?: (model: Readonly<ModelType>) => void
  } = {},
): FormHook<ModelType> {
  const { t } = useTranslation()
  const [modelValue, setModelValue] = useState(model)
  const stateModelRef = useRef(modelValue)
  const callbacksRef = useRef(callbacks)

  const [validationErrors, setValidationErrors] = useState<
    Partial<Record<keyof ModelType, string>>
  >(Object.create(null))
  // NOTE(tec27): This always just gets updated with the latest state value, so that we can check
  // it when needed (e.g. when submitting the form, after async validations come back)
  const validationErrorsRef = useRef(validationErrors)

  const dirtyFieldsRef = useRef(new Map<keyof ModelType, boolean>())
  const validationPromisesRef = useRef(new Map<keyof ModelType, Promise<void>>())
  const notifyValidationRef = useRef<Array<Deferred<void>>>([])

  const validate = useCallback(
    (name: keyof ModelType) => {
      if (!Object.hasOwn(validations, name)) {
        return
      }

      const resultPromise = Promise.resolve(
        validations[name]!(
          stateModelRef.current[name],
          stateModelRef.current,
          dirtyFieldsRef.current,
          t,
        ),
      ).then(errorMsg => {
        if (validationPromisesRef.current.get(name) !== resultPromise) {
          // A newer validation is running on this input, ignore this result
          return
        }

        validationPromisesRef.current.delete(name)
        setValidationErrors(validationErrors => ({
          ...validationErrors,
          [name]: errorMsg,
        }))
      })

      validationPromisesRef.current.set(name, resultPromise)

      // Wake up all the things waiting for validations to complete to tell them there is a new
      // validation promise
      for (const deferred of notifyValidationRef.current) {
        deferred.resolve()
      }
      notifyValidationRef.current.length = 0
    },
    [t, validations],
  )

  const handleSubmit = useCallback(
    (event?: React.FormEvent) => {
      // Don't actually submit the form over HTTP
      event?.preventDefault()

      // Run validations against everything that's not dirty to double-check their validity.
      for (const name of Object.keys(validations)) {
        if (!dirtyFieldsRef.current.get(name as keyof ModelType)) {
          validate(name as keyof ModelType)
        }
      }

      const checkValidations = () => {
        if (Object.values(validationErrorsRef.current).some(v => !!v)) {
          // Form isn't valid, don't submit
          // TODO(tec27): focus first invalid field?
          return
        }

        if (!validationPromisesRef.current.size) {
          // Form is valid and we're not waiting on any validations, submit!
          if (callbacksRef.current.onSubmit) {
            callbacksRef.current.onSubmit(stateModelRef.current)
          }
        } else {
          // Wait for any validations to finish, or for a new validation request to occur. When
          // either of those things happen, we re-check the validations
          const interrupt = createDeferred<void>()
          notifyValidationRef.current.push(interrupt)
          Promise.race(
            Array.from<Promise<any>>(validationPromisesRef.current.values()).concat(interrupt),
          )
            .catch(() => {
              /* not our job to deal with these errors */
            })
            .finally(checkValidations)
        }
      }

      checkValidations()
    },
    [validate, validations],
  )

  validationErrorsRef.current = validationErrors
  callbacksRef.current = callbacks

  const lastModelValue = stateModelRef.current
  stateModelRef.current = modelValue

  useEffect(() => {
    if (!shallowEquals(lastModelValue, modelValue)) {
      for (const [name, dirty] of dirtyFieldsRef.current.entries()) {
        // TODO(tec27): Ideally this would only re-validate things that changed in the model,
        // but we can't really do that because the full understanding of dependencies aren't
        // noted (e.g. if you validate that a field matches another one, you need to re-run
        // that validation if *either* field changes).
        if (dirty) {
          validate(name)
        }
      }

      if (callbacksRef.current.onChange) {
        callbacksRef.current.onChange(modelValue)
      }

      if (callbacksRef.current.onValidatedChange) {
        const checkValidations = () => {
          if (!callbacksRef.current.onValidatedChange) {
            // Callback was removed while we were waiting
            return
          }

          const validationsOutstanding = validationPromisesRef.current.size > 0
          if (!validationsOutstanding) {
            if (Object.values(validationErrorsRef.current).some(v => !!v)) {
              // Form isn't valid, no need to call onValidatedChange
              return
            } else {
              // Form is valid and we're not waiting on any validations, can notify!
              callbacksRef.current.onValidatedChange(stateModelRef.current)
            }
          } else {
            // Wait for any validations to finish, or for a new validation request to occur. When
            // either of those things happen, we re-check the validations
            const interrupt = createDeferred<void>()
            notifyValidationRef.current.push(interrupt)
            Promise.race(
              Array.from<Promise<any>>(validationPromisesRef.current.values()).concat(interrupt),
            )
              .catch(() => {
                /* not our job to deal with these errors */
              })
              .finally(checkValidations)
          }
        }

        checkValidations()
      }
    }
  }, [lastModelValue, modelValue, validate])

  useEffect(() => {
    return () => {
      // Ensure that validations do nothing once unmounted
      // Disabling lint because it's fine if the value of this ref has changed at this point
      // eslint-disable-next-line react-hooks/exhaustive-deps
      validationPromisesRef.current.clear()
      callbacksRef.current = {}
    }
  }, [])

  // TODO(tec27): Impelement a way to reset the form (can probably be done similarly to
  // useRefreshToken?)

  const formGetterSetters = useFormGetterSetters({
    stateModelRef,
    dirtyFieldsRef,
    validationErrorsRef,
    setModelValue,
    setValidationErrors,
  })

  return {
    ...formGetterSetters,
    onSubmit: handleSubmit,
  }
}

type StateSetter<T> = React.Dispatch<React.SetStateAction<T>>
type OptionalConditionalKeys<T, MatchType> = ConditionalKeys<T, MatchType | undefined>
type CustomChangeHandler = (newValue: any) => void

function useFormGetterSetters<ModelType>({
  stateModelRef,
  dirtyFieldsRef,
  validationErrorsRef,
  setModelValue,
  setValidationErrors,
}: {
  stateModelRef: React.MutableRefObject<Readonly<ModelType>>
  dirtyFieldsRef: React.MutableRefObject<Map<keyof ModelType, boolean>>
  validationErrorsRef: React.MutableRefObject<Partial<Record<keyof ModelType, string>>>
  setModelValue: StateSetter<Readonly<ModelType>>
  setValidationErrors: StateSetter<Partial<Record<keyof ModelType, string>>>
}) {
  const customChangeHandlersRef = useRef(new Map<keyof ModelType, CustomChangeHandler>())

  const getInputValue = useCallback(
    <K extends keyof ModelType>(name: K) => stateModelRef.current[name],
    [stateModelRef],
  )
  const setInputValue = useCallback(
    <K extends keyof ModelType>(name: K, value: ModelType[K]) => {
      dirtyFieldsRef.current.set(name, true)
      setModelValue(model => ({
        ...model,
        [name]: value,
      }))
    },
    [dirtyFieldsRef, setModelValue],
  )
  const setInputError = useCallback(
    (name: keyof ModelType, errorMsg?: string) => {
      setValidationErrors(validationErrors => ({
        ...validationErrors,
        [name]: errorMsg,
      }))
    },
    [setValidationErrors],
  )

  const onInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const { name, value } = event.target
      setInputValue(name as keyof ModelType, value as any)
    },
    [setInputValue],
  )
  const onCheckableChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const { name, checked } = event.target
      setInputValue(name as keyof ModelType, checked as any)
    },
    [setInputValue],
  )
  const onCustomChange = useCallback(
    <K extends keyof ModelType>(name: K, newValue: ModelType[K]) => {
      setInputValue(name, newValue)
    },
    [setInputValue],
  )

  const bindInput = useCallback(
    <K extends OptionalConditionalKeys<ModelType, string>>(name: K) => {
      // NOTE(tec27): The K param here guarantees this will be a string but TS can't quite convince
      // itself of that, so we have to help it along
      const value = (stateModelRef.current[name] ?? '') as string
      return {
        name,
        onChange: onInputChange,
        value,
        errorText: validationErrorsRef.current[name],
      }
    },
    [onInputChange, stateModelRef, validationErrorsRef],
  )
  const bindCheckable = useCallback(
    <K extends OptionalConditionalKeys<ModelType, boolean>>(name: K) => {
      return {
        name,
        onChange: onCheckableChange,
        checked: !!stateModelRef.current[name],
        errorText: validationErrorsRef.current[name],
      }
    },
    [onCheckableChange, stateModelRef, validationErrorsRef],
  )
  const bindCustom = useCallback(
    <K extends keyof ModelType>(name: K) => {
      if (!customChangeHandlersRef.current.has(name)) {
        customChangeHandlersRef.current.set(name, (newValue: ModelType[K]) =>
          onCustomChange(name, newValue),
        )
      }

      return {
        name,
        onChange: customChangeHandlersRef.current.get(name)!,
        value: stateModelRef.current[name],
        errorText: validationErrorsRef.current[name],
      }
    },
    [onCustomChange, stateModelRef, validationErrorsRef],
  )

  return {
    getInputValue,
    setInputValue,
    setInputError,
    bindInput,
    bindCheckable,
    bindCustom,
  }
}
