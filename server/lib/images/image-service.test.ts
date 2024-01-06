import { GoogleLikelihood, ImageService } from './image-service'

const mockSafeSearchDetection = jest.fn().mockResolvedValue([])
jest.mock('@google-cloud/vision', () => {
  return {
    ImageAnnotatorClient: jest.fn().mockImplementation(() => ({
      safeSearchDetection: mockSafeSearchDetection,
    })),
  }
})

describe('images/image-service', () => {
  let imageService: ImageService

  beforeEach(() => {
    imageService = new ImageService()

    mockSafeSearchDetection.mockClear()
  })

  describe('isImageSafe', () => {
    test("returns `true` if safe search detection doesn't return any results", async () => {
      const result = await imageService.isImageSafe('IMAGE')

      expect(result).toBe(true)
    })

    test('returns `true` if safe search annotations are empty', async () => {
      mockSafeSearchDetection.mockResolvedValue([{ safeSearchAnnotation: undefined }])

      const result = await imageService.isImageSafe('IMAGE')

      expect(result).toBe(true)
    })

    test('returns `true` if all categories are safe', async () => {
      mockSafeSearchDetection.mockResolvedValue([
        {
          safeSearchAnnotation: {
            adult: GoogleLikelihood.VeryUnlikely,
            spoof: GoogleLikelihood.VeryUnlikely,
            medical: GoogleLikelihood.VeryUnlikely,
            violence: GoogleLikelihood.VeryUnlikely,
            racy: GoogleLikelihood.VeryUnlikely,
          },
        },
      ])

      const result = await imageService.isImageSafe('IMAGE')

      expect(result).toBe(true)
    })

    test('returns `false` if one category is not safe', async () => {
      mockSafeSearchDetection.mockResolvedValue([
        {
          safeSearchAnnotation: {
            adult: GoogleLikelihood.VeryLikely,
            spoof: GoogleLikelihood.VeryUnlikely,
            medical: GoogleLikelihood.VeryUnlikely,
            violence: GoogleLikelihood.VeryUnlikely,
            racy: GoogleLikelihood.VeryUnlikely,
          },
        },
      ])

      const result = await imageService.isImageSafe('IMAGE')

      expect(result).toBe(false)
    })

    describe('adult', () => {
      test("returns `true` if likelihood doesn't exist", async () => {
        mockSafeSearchDetection.mockResolvedValue([{ safeSearchAnnotation: { adult: 'INVALID' } }])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is UNKNOWN', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { adult: GoogleLikelihood.Unknown } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is VERY_UNLIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { adult: GoogleLikelihood.VeryUnlikely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is UNLIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { adult: GoogleLikelihood.Unlikely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is POSSIBLE', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { adult: GoogleLikelihood.Possible } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `false` if likelihood is LIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { adult: GoogleLikelihood.Likely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(false)
      })

      test('returns `false` if likelihood is VERY_LIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { adult: GoogleLikelihood.VeryLikely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(false)
      })
    })

    describe('spoof', () => {
      test("returns `true` if likelihood doesn't exist", async () => {
        mockSafeSearchDetection.mockResolvedValue([{ safeSearchAnnotation: { spoof: 'INVALID' } }])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is UNKNOWN', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { spoof: GoogleLikelihood.Unknown } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is VERY_UNLIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { spoof: GoogleLikelihood.VeryUnlikely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is UNLIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { spoof: GoogleLikelihood.Unlikely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is POSSIBLE', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { spoof: GoogleLikelihood.Possible } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is LIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { spoof: GoogleLikelihood.Likely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is VERY_LIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { spoof: GoogleLikelihood.VeryLikely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })
    })

    describe('medical', () => {
      test("returns `true` if likelihood doesn't exist", async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { medical: 'INVALID' } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is UNKNOWN', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { medical: GoogleLikelihood.Unknown } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is VERY_UNLIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { medical: GoogleLikelihood.VeryUnlikely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is UNLIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { medical: GoogleLikelihood.Unlikely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is POSSIBLE', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { medical: GoogleLikelihood.Possible } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is LIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { medical: GoogleLikelihood.Likely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `false` if likelihood is VERY_LIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { medical: GoogleLikelihood.VeryLikely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(false)
      })
    })

    describe('violence', () => {
      test("returns `true` if likelihood doesn't exist", async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { violence: 'INVALID' } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is UNKNOWN', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { violence: GoogleLikelihood.Unknown } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is VERY_UNLIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { violence: GoogleLikelihood.VeryUnlikely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is UNLIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { violence: GoogleLikelihood.Unlikely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is POSSIBLE', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { violence: GoogleLikelihood.Possible } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is LIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { violence: GoogleLikelihood.Likely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `false` if likelihood is VERY_LIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { violence: GoogleLikelihood.VeryLikely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(false)
      })
    })

    describe('racy', () => {
      test("returns `true` if likelihood doesn't exist", async () => {
        mockSafeSearchDetection.mockResolvedValue([{ safeSearchAnnotation: { racy: 'INVALID' } }])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is UNKNOWN', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { racy: GoogleLikelihood.Unknown } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is VERY_UNLIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { racy: GoogleLikelihood.VeryUnlikely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is UNLIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { racy: GoogleLikelihood.Unlikely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is POSSIBLE', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { racy: GoogleLikelihood.Possible } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is LIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { racy: GoogleLikelihood.Likely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })

      test('returns `true` if likelihood is VERY_LIKELY', async () => {
        mockSafeSearchDetection.mockResolvedValue([
          { safeSearchAnnotation: { racy: GoogleLikelihood.VeryLikely } },
        ])

        const result = await imageService.isImageSafe('IMAGE')

        expect(result).toBe(true)
      })
    })
  })
})
