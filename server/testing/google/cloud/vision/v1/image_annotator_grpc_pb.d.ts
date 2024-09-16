// GENERATED CODE -- DO NOT EDIT!

// package: google.cloud.vision.v1
// file: google/cloud/vision/v1/image_annotator.proto

import * as grpc from '@grpc/grpc-js'
import * as google_cloud_vision_v1_image_annotator_pb from '../../../../google/cloud/vision/v1/image_annotator_pb.js'
import * as google_longrunning_operations_pb from '../../../../google/longrunning/operations_pb.js'

interface IImageAnnotatorService extends grpc.ServiceDefinition<grpc.UntypedServiceImplementation> {
  batchAnnotateImages: grpc.MethodDefinition<
    google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesRequest,
    google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesResponse
  >
  batchAnnotateFiles: grpc.MethodDefinition<
    google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesRequest,
    google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesResponse
  >
  asyncBatchAnnotateImages: grpc.MethodDefinition<
    google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateImagesRequest,
    google_longrunning_operations_pb.Operation
  >
  asyncBatchAnnotateFiles: grpc.MethodDefinition<
    google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateFilesRequest,
    google_longrunning_operations_pb.Operation
  >
}

export const ImageAnnotatorService: IImageAnnotatorService

export interface IImageAnnotatorServer extends grpc.UntypedServiceImplementation {
  batchAnnotateImages: grpc.handleUnaryCall<
    google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesRequest,
    google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesResponse
  >
  batchAnnotateFiles: grpc.handleUnaryCall<
    google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesRequest,
    google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesResponse
  >
  asyncBatchAnnotateImages: grpc.handleUnaryCall<
    google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateImagesRequest,
    google_longrunning_operations_pb.Operation
  >
  asyncBatchAnnotateFiles: grpc.handleUnaryCall<
    google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateFilesRequest,
    google_longrunning_operations_pb.Operation
  >
}

export class ImageAnnotatorClient extends grpc.Client {
  constructor(address: string, credentials: grpc.ChannelCredentials, options?: object)
  batchAnnotateImages(
    argument: google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesRequest,
    callback: grpc.requestCallback<google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesResponse>,
  ): grpc.ClientUnaryCall
  batchAnnotateImages(
    argument: google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesRequest,
    metadataOrOptions: grpc.Metadata | grpc.CallOptions | null,
    callback: grpc.requestCallback<google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesResponse>,
  ): grpc.ClientUnaryCall
  batchAnnotateImages(
    argument: google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesRequest,
    metadata: grpc.Metadata | null,
    options: grpc.CallOptions | null,
    callback: grpc.requestCallback<google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesResponse>,
  ): grpc.ClientUnaryCall
  batchAnnotateFiles(
    argument: google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesRequest,
    callback: grpc.requestCallback<google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesResponse>,
  ): grpc.ClientUnaryCall
  batchAnnotateFiles(
    argument: google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesRequest,
    metadataOrOptions: grpc.Metadata | grpc.CallOptions | null,
    callback: grpc.requestCallback<google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesResponse>,
  ): grpc.ClientUnaryCall
  batchAnnotateFiles(
    argument: google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesRequest,
    metadata: grpc.Metadata | null,
    options: grpc.CallOptions | null,
    callback: grpc.requestCallback<google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesResponse>,
  ): grpc.ClientUnaryCall
  asyncBatchAnnotateImages(
    argument: google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateImagesRequest,
    callback: grpc.requestCallback<google_longrunning_operations_pb.Operation>,
  ): grpc.ClientUnaryCall
  asyncBatchAnnotateImages(
    argument: google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateImagesRequest,
    metadataOrOptions: grpc.Metadata | grpc.CallOptions | null,
    callback: grpc.requestCallback<google_longrunning_operations_pb.Operation>,
  ): grpc.ClientUnaryCall
  asyncBatchAnnotateImages(
    argument: google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateImagesRequest,
    metadata: grpc.Metadata | null,
    options: grpc.CallOptions | null,
    callback: grpc.requestCallback<google_longrunning_operations_pb.Operation>,
  ): grpc.ClientUnaryCall
  asyncBatchAnnotateFiles(
    argument: google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateFilesRequest,
    callback: grpc.requestCallback<google_longrunning_operations_pb.Operation>,
  ): grpc.ClientUnaryCall
  asyncBatchAnnotateFiles(
    argument: google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateFilesRequest,
    metadataOrOptions: grpc.Metadata | grpc.CallOptions | null,
    callback: grpc.requestCallback<google_longrunning_operations_pb.Operation>,
  ): grpc.ClientUnaryCall
  asyncBatchAnnotateFiles(
    argument: google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateFilesRequest,
    metadata: grpc.Metadata | null,
    options: grpc.CallOptions | null,
    callback: grpc.requestCallback<google_longrunning_operations_pb.Operation>,
  ): grpc.ClientUnaryCall
}
