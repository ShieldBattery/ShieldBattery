import { PLUTO_V2_MODEL_DOWNLOAD_BYTES } from './bot-catalog'

/** Original release required by Pluto v2 legacy operand bindings. */
export const PLUTO_V2_RELEASE = {
  tag: 'v2.0',
  releasePage: 'https://github.com/tscmoo/pluto/releases/tag/v2.0',
  url: 'https://github.com/tscmoo/pluto/releases/download/v2.0/pluto-v2.0.zip',
  sha256: '17544fc3ab32e3e2823646887e021cf998362348d73740817e94d1a78aa6209d',
  sizeBytes: PLUTO_V2_MODEL_DOWNLOAD_BYTES,
  files: {
    'README.txt': {
      sha256: '183ae100d75a583732b60fcf67514a1200ddd16cdb94af0f1c01f66530b71f31',
      sizeBytes: 5811,
    },
    'pluto.dll': {
      sha256: '603fea2f77a4b652f29b832c2977cf5bc9d83bbcb927febd04499220020ce3bc',
      sizeBytes: 472590,
    },
    'pluto/pluto_infer.exe': {
      sha256: '3f2814a51034b9817b396e52b38d30341ede506a2baedc7cbc11cb6ebcece2cc',
      sizeBytes: 1682944,
    },
    'pluto/pluto_weights.bin': {
      sha256: 'c53a559b4910777dc0e1c561c0d89d243091f465d8e9fc0f5f72e56597067d86',
      sizeBytes: 347935248,
    },
  },
} as const
