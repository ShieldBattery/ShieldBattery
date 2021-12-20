/**
 * Interface exposed by forms in the Settings dialog (as an imperative handle), so they can be
 * submitted when needed.
 */
export interface SettingsFormHandle {
  submit: () => void
}
