import { RouterContext } from '@koa/router'
import i18next from 'i18next'
import FsBackend, { FsBackendOptions } from 'i18next-fs-backend'
import Joi from 'joi'
import { Next } from 'koa'
import {
  ALL_TRANSLATION_LANGUAGES,
  ALL_TRANSLATION_NAMESPACES,
  TranslationLanguage,
  TranslationNamespace,
} from '../../../common/i18n'
import { validateRequest } from '../validation/joi-validator'

function orderedStringify(obj: Record<string, string>) {
  const allKeys = new Set<string>()
  JSON.stringify(obj, (key, value) => {
    allKeys.add(key)
    return value
  })
  return JSON.stringify(obj, Array.from(allKeys).sort(), 2) + '\n'
}

i18next.use(FsBackend).init<FsBackendOptions>({
  backend: {
    loadPath: './server/public/locales/{{lng}}/{{ns}}.json',
    addPath: './server/public/locales/{{lng}}/{{ns}}.json',
    stringify: orderedStringify,
  },

  // NOTE(2Pac): We're only using i18next on backend to save the missing keys, so technically we're
  // not even using these options, but we still have to define them for the library to work properly
  lng: TranslationLanguage.English,
  ns: TranslationNamespace.Global,
})

export function handleMissingTranslationKeys(ctx: RouterContext, next: Next) {
  const {
    params: { lng, ns },
  } = validateRequest(ctx, {
    params: Joi.object<{ lng: TranslationLanguage; ns: TranslationNamespace }>({
      lng: Joi.valid(...ALL_TRANSLATION_LANGUAGES).required(),
      ns: Joi.valid(...ALL_TRANSLATION_NAMESPACES).required(),
    }),
  })

  // TODO(2Pac): Figure out which type this is (it's typed as `any` in i18next types as far as I
  // can see).
  const connector = i18next.services.backendConnector
  if (connector) {
    for (const key in ctx.request.body) {
      connector.saveMissing([lng], ns, key, ctx.request.body[key])
    }
  }

  ctx.status = 200
}
