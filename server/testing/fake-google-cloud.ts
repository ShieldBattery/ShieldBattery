// An extremely basic implementation of the Google Cloud Vision API (well, the parts we actually
// use) that allows us to run integration tests.
import * as grpc from '@grpc/grpc-js'
import {
  IImageAnnotatorServer,
  ImageAnnotatorService,
} from './google/cloud/vision/v1/image_annotator_grpc_pb'
import {
  BatchAnnotateImagesRequest,
  BatchAnnotateImagesResponse,
} from './google/cloud/vision/v1/image_annotator_pb'

const port = Number(process.env.FAKE_GOOGLE_CLOUD_PORT ?? 5530)

const fakeServer: IImageAnnotatorServer = {
  batchAnnotateImages(
    call: grpc.ServerUnaryCall<BatchAnnotateImagesRequest, BatchAnnotateImagesResponse>,
    callback: grpc.sendUnaryData<BatchAnnotateImagesResponse>,
  ) {
    const response = new BatchAnnotateImagesResponse()
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
