import { RouterContext } from '@koa/router'
import i18next from 'i18next'
import FsBackend from 'i18next-fs-backend'
import Joi from 'joi'
import { Next } from 'koa'
import {
  ALL_TRANSLATION_LANGUAGES,
  ALL_TRANSLATION_NAMESPACES,
  TranslationLanguages,
  TranslationNamespaces,
} from '../../../common/i18n'
import { validateRequest } from '../validation/joi-validator'

i18next.use(FsBackend).init({
  backend: {
    loadPath: './server/public/locales/{{lng}}/{{ns}}.json',
    addPath: './server/public/locales/{{lng}}/{{ns}}.json',
  },

  // NOTE(2Pac): We're only using i18next on backend to save the missing keys, so technically we're
  // not even using these options, but we still have to define them for the library to work properly
  lng: TranslationLanguages.English,
  ns: TranslationNamespaces.Translation,
})

export function handleMissingTranslationKeys(ctx: RouterContext, next: Next) {
  const {
    params: { lng, ns },
  } = validateRequest(ctx, {
    params: Joi.object<{ lng: TranslationLanguages; ns: TranslationNamespaces }>({
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
