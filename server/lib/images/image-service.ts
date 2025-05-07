import { ImageAnnotatorClient } from '@google-cloud/vision'
import { ChannelCredentials, ClientOptions } from 'google-gax'
import { container, inject, singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'

let imageAnnotatorClientOptions: ClientOptions | undefined

// NOTE(2Pac): These options are only really meant to be used for testing.
if (
  process.env.SB_USE_FAKE_GOOGLE_CLOUD === 'true' &&
  process.env.SB_GOOGLE_CLOUD_DOMAIN &&
  process.env.SB_GOOGLE_CLOUD_PORT
) {
  imageAnnotatorClientOptions = {
    apiEndpoint: process.env.SB_GOOGLE_CLOUD_DOMAIN,
    port: Number(process.env.SB_GOOGLE_CLOUD_PORT),
    sslCreds: ChannelCredentials.createInsecure(),
    universeDomain: 'FAKE_UNIVERSE_DOMAIN',
  }
}

/**
 * All possible likelihood values that Google can return for each safe search category.
 */
export enum GoogleLikelihood {
  Unknown = 'UNKNOWN',
  VeryUnlikely = 'VERY_UNLIKELY',
  Unlikely = 'UNLIKELY',
  Possible = 'POSSIBLE',
  Likely = 'LIKELY',
  VeryLikely = 'VERY_LIKELY',
}

const ALL_GOOGLE_LIKELIHOODS: ReadonlyArray<GoogleLikelihood> = Object.values(GoogleLikelihood)

/**
 * The ordered version of all possible likelihood values.
 */
enum OrderedLikelihood {
  Unknown = 0,
  VeryUnlikely,
  Unlikely,
  Possible,
  Likely,
  VeryLikely,
}

/**
 * A mapper function between Google's values for likelihood and our own, ordered version of the
 * same.
 */
function googleLikelihoodToOrdered(likelihood: GoogleLikelihood): OrderedLikelihood {
  switch (likelihood) {
    case GoogleLikelihood.Unknown:
      return OrderedLikelihood.Unknown
    case GoogleLikelihood.VeryUnlikely:
      return OrderedLikelihood.VeryUnlikely
    case GoogleLikelihood.Unlikely:
      return OrderedLikelihood.Unlikely
    case GoogleLikelihood.Possible:
      return OrderedLikelihood.Possible
    case GoogleLikelihood.Likely:
      return OrderedLikelihood.Likely
    case GoogleLikelihood.VeryLikely:
      return OrderedLikelihood.VeryLikely
    default:
      return assertUnreachable(likelihood)
  }
}

enum SafeSearchCategory {
  Adult = 'adult',
  Spoof = 'spoof',
  Medical = 'medical',
  Violence = 'violence',
  Racy = 'racy',
}

const ALL_SAFE_SEARCH_CATEGORIES: ReadonlyArray<SafeSearchCategory> =
  Object.values(SafeSearchCategory)

/**
 * Returns maximum allowed likelihood for each safe search category.
 */
function categoryToMaxLikelihood(category: SafeSearchCategory): OrderedLikelihood {
  switch (category) {
    case SafeSearchCategory.Adult:
      return OrderedLikelihood.Possible
    case SafeSearchCategory.Spoof:
      return OrderedLikelihood.VeryLikely
    case SafeSearchCategory.Medical:
      return OrderedLikelihood.Likely
    case SafeSearchCategory.Violence:
      return OrderedLikelihood.Likely
    case SafeSearchCategory.Racy:
      return OrderedLikelihood.VeryLikely
    default:
      return assertUnreachable(category)
  }
}

const IMAGE_ANNOTATOR_CLIENT = 'ImageAnnotatorClient'

// Only create the client if we have credentials, otherwise it will print a very cryptic
// warning:
// MetadataLookupWarning: received unexpected error = All promises were rejected code = UNKNOWN
if (imageAnnotatorClientOptions || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  container.register(IMAGE_ANNOTATOR_CLIENT, {
    useFactory: () =>
      // NOTE(tec27): Seems to be some issue with the typings on options between libraries (maybe
      // multiple versions being pulled in?) so the `any` case is needed).
      new ImageAnnotatorClient(imageAnnotatorClientOptions as any),
  })
}

@singleton()
export class ImageService {
  constructor(
    @inject(IMAGE_ANNOTATOR_CLIENT, { isOptional: true })
    private visionClient?: ImageAnnotatorClient,
  ) {
    if (process.env.NODE_ENV === 'production' && !this.visionClient) {
      throw new Error('Google Cloud Vision client not initialized')
    }
  }

  /**
   * Checks the given image (either as a filename, URL, or a buffer) for our safety standards. If
   * the image couldn't be checked for whatever reason, we consider it safe by default.
   *
   * @returns true if the image is safe to be used on our platform, false otherwise.
   */
  async isImageSafe(image: string | Buffer): Promise<boolean> {
    if (!this.visionClient) {
      // Just always let images through in dev if we don't have an API to ask, the prod case will
      // be handled in the constructor
      return true
    }

    const result = await this.visionClient.safeSearchDetection(image)
    const detections = result[0]?.safeSearchAnnotation
    if (!detections) {
      return true
    }

    return ALL_SAFE_SEARCH_CATEGORIES.every(c => {
      const likelihood = detections[c] as GoogleLikelihood
      if (!likelihood || !ALL_GOOGLE_LIKELIHOODS.includes(likelihood)) {
        return true
      }

      return googleLikelihoodToOrdered(likelihood) <= categoryToMaxLikelihood(c)
    })
  }
}
