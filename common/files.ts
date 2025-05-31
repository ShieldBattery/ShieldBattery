/**
 * The default maximum file size for uploads. This is used for all uploads that don't specify a
 * maximum file size. This size is left intentionally conservative, so we don't accidentally allow
 * huge files for stuff that don't need it.
 */
export const DEFAULT_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

export enum FilesErrorCode {
  MaxFileSizeExceeded = 'MaxFileSizeExceeded',
}
