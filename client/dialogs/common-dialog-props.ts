export interface CommonDialogProps {
  /**
   * A cancel handler to pass to any buttons/hotkeys/etc. that would cancel the current dialog. In
   * modal dialogs, this is a no-op.
   */
  onCancel: () => void
  /** A function that will close this dialog (even if it is a modal). */
  close: () => void
}
