// An extremely basic implementation of the Google Cloud Vision API (well, the parts we actually
// use) that allows us to run integration tests.
import * as grpc from '@grpc/grpc-js'
import {
  IImageAnnotatorServer,
  ImageAnnotatorService,
} from './google/cloud/vision/v1/image_annotator_grpc_pb.js'
import {
  AnnotateImageResponse,
  BatchAnnotateImagesRequest,
  BatchAnnotateImagesResponse,
  Likelihood,
  SafeSearchAnnotation,
} from './google/cloud/vision/v1/image_annotator_pb.js'

const port = Number(process.env.FAKE_GOOGLE_CLOUD_PORT ?? 5530)

// NOTE(2Pac): These values are the file sizes of images we use in integration tests and want to run
// special logic for.

const IMAGE_INAPPROPRIATE_LENGTH = 22704

const fakeServer: IImageAnnotatorServer = {
  batchAnnotateImages(
    call: grpc.ServerUnaryCall<BatchAnnotateImagesRequest, BatchAnnotateImagesResponse>,
    callback: grpc.sendUnaryData<BatchAnnotateImagesResponse>,
  ) {
    const imageLength = call.request.getRequestsList()[0]?.getImage()?.getContent().length

    const safeSearchAnnotation = new SafeSearchAnnotation()
    if (imageLength === IMAGE_INAPPROPRIATE_LENGTH) {
      safeSearchAnnotation.setAdult(Likelihood.VERY_LIKELY)
    }

    const annotateResponse = new AnnotateImageResponse()
    annotateResponse.setSafeSearchAnnotation(safeSearchAnnotation)

    const response = new BatchAnnotateImagesResponse()
    response.addResponses(annotateResponse, 0)

    callback(null, response)
  },
  // TODO(2Pac): Implement if/when needed
  batchAnnotateFiles() {},
  // TODO(2Pac): Implement if/when needed
  asyncBatchAnnotateImages() {},
  // TODO(2Pac): Implement if/when needed
  asyncBatchAnnotateFiles() {},
}

const server = new grpc.Server()
server.addService(ImageAnnotatorService, fakeServer)

server.bindAsync(
  `0.0.0.0:${port}`,
  grpc.ServerCredentials.createInsecure(),
  (err: Error | null, port: number) => {
    if (err) {
      console.error(err)
      process.exit(1)
    } else {
      console.log(`Fake google cloud server listening on ${port}`)
      server.start()
    }
  },
)
