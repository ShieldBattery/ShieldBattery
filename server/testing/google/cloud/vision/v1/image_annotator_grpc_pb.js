// GENERATED CODE -- DO NOT EDIT!

// Original file comments:
// Copyright 2022 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
'use strict';
var grpc = require('@grpc/grpc-js');
var google_cloud_vision_v1_image_annotator_pb = require('../../../../google/cloud/vision/v1/image_annotator_pb.js');
var google_api_annotations_pb = require('../../../../google/api/annotations_pb.js');
var google_api_client_pb = require('../../../../google/api/client_pb.js');
var google_api_field_behavior_pb = require('../../../../google/api/field_behavior_pb.js');
var google_cloud_vision_v1_geometry_pb = require('../../../../google/cloud/vision/v1/geometry_pb.js');
var google_cloud_vision_v1_product_search_pb = require('../../../../google/cloud/vision/v1/product_search_pb.js');
var google_cloud_vision_v1_text_annotation_pb = require('../../../../google/cloud/vision/v1/text_annotation_pb.js');
var google_cloud_vision_v1_web_detection_pb = require('../../../../google/cloud/vision/v1/web_detection_pb.js');
var google_longrunning_operations_pb = require('../../../../google/longrunning/operations_pb.js');
var google_protobuf_timestamp_pb = require('google-protobuf/google/protobuf/timestamp_pb.js');
var google_rpc_status_pb = require('../../../../google/rpc/status_pb.js');
var google_type_color_pb = require('../../../../google/type/color_pb.js');
var google_type_latlng_pb = require('../../../../google/type/latlng_pb.js');

function serialize_google_cloud_vision_v1_AsyncBatchAnnotateFilesRequest(arg) {
  if (!(arg instanceof google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateFilesRequest)) {
    throw new Error('Expected argument of type google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_google_cloud_vision_v1_AsyncBatchAnnotateFilesRequest(buffer_arg) {
  return google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateFilesRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_google_cloud_vision_v1_AsyncBatchAnnotateImagesRequest(arg) {
  if (!(arg instanceof google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateImagesRequest)) {
    throw new Error('Expected argument of type google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_google_cloud_vision_v1_AsyncBatchAnnotateImagesRequest(buffer_arg) {
  return google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateImagesRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_google_cloud_vision_v1_BatchAnnotateFilesRequest(arg) {
  if (!(arg instanceof google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesRequest)) {
    throw new Error('Expected argument of type google.cloud.vision.v1.BatchAnnotateFilesRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_google_cloud_vision_v1_BatchAnnotateFilesRequest(buffer_arg) {
  return google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_google_cloud_vision_v1_BatchAnnotateFilesResponse(arg) {
  if (!(arg instanceof google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesResponse)) {
    throw new Error('Expected argument of type google.cloud.vision.v1.BatchAnnotateFilesResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_google_cloud_vision_v1_BatchAnnotateFilesResponse(buffer_arg) {
  return google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_google_cloud_vision_v1_BatchAnnotateImagesRequest(arg) {
  if (!(arg instanceof google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesRequest)) {
    throw new Error('Expected argument of type google.cloud.vision.v1.BatchAnnotateImagesRequest');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_google_cloud_vision_v1_BatchAnnotateImagesRequest(buffer_arg) {
  return google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesRequest.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_google_cloud_vision_v1_BatchAnnotateImagesResponse(arg) {
  if (!(arg instanceof google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesResponse)) {
    throw new Error('Expected argument of type google.cloud.vision.v1.BatchAnnotateImagesResponse');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_google_cloud_vision_v1_BatchAnnotateImagesResponse(buffer_arg) {
  return google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesResponse.deserializeBinary(new Uint8Array(buffer_arg));
}

function serialize_google_longrunning_Operation(arg) {
  if (!(arg instanceof google_longrunning_operations_pb.Operation)) {
    throw new Error('Expected argument of type google.longrunning.Operation');
  }
  return Buffer.from(arg.serializeBinary());
}

function deserialize_google_longrunning_Operation(buffer_arg) {
  return google_longrunning_operations_pb.Operation.deserializeBinary(new Uint8Array(buffer_arg));
}


// Service that performs Google Cloud Vision API detection tasks over client
// images, such as face, landmark, logo, label, and text detection. The
// ImageAnnotator service returns detected entities from the images.
var ImageAnnotatorService = exports.ImageAnnotatorService = {
  // Run image detection and annotation for a batch of images.
batchAnnotateImages: {
    path: '/google.cloud.vision.v1.ImageAnnotator/BatchAnnotateImages',
    requestStream: false,
    responseStream: false,
    requestType: google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesRequest,
    responseType: google_cloud_vision_v1_image_annotator_pb.BatchAnnotateImagesResponse,
    requestSerialize: serialize_google_cloud_vision_v1_BatchAnnotateImagesRequest,
    requestDeserialize: deserialize_google_cloud_vision_v1_BatchAnnotateImagesRequest,
    responseSerialize: serialize_google_cloud_vision_v1_BatchAnnotateImagesResponse,
    responseDeserialize: deserialize_google_cloud_vision_v1_BatchAnnotateImagesResponse,
  },
  // Service that performs image detection and annotation for a batch of files.
// Now only "application/pdf", "image/tiff" and "image/gif" are supported.
//
// This service will extract at most 5 (customers can specify which 5 in
// AnnotateFileRequest.pages) frames (gif) or pages (pdf or tiff) from each
// file provided and perform detection and annotation for each image
// extracted.
batchAnnotateFiles: {
    path: '/google.cloud.vision.v1.ImageAnnotator/BatchAnnotateFiles',
    requestStream: false,
    responseStream: false,
    requestType: google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesRequest,
    responseType: google_cloud_vision_v1_image_annotator_pb.BatchAnnotateFilesResponse,
    requestSerialize: serialize_google_cloud_vision_v1_BatchAnnotateFilesRequest,
    requestDeserialize: deserialize_google_cloud_vision_v1_BatchAnnotateFilesRequest,
    responseSerialize: serialize_google_cloud_vision_v1_BatchAnnotateFilesResponse,
    responseDeserialize: deserialize_google_cloud_vision_v1_BatchAnnotateFilesResponse,
  },
  // Run asynchronous image detection and annotation for a list of images.
//
// Progress and results can be retrieved through the
// `google.longrunning.Operations` interface.
// `Operation.metadata` contains `OperationMetadata` (metadata).
// `Operation.response` contains `AsyncBatchAnnotateImagesResponse` (results).
//
// This service will write image annotation outputs to json files in customer
// GCS bucket, each json file containing BatchAnnotateImagesResponse proto.
asyncBatchAnnotateImages: {
    path: '/google.cloud.vision.v1.ImageAnnotator/AsyncBatchAnnotateImages',
    requestStream: false,
    responseStream: false,
    requestType: google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateImagesRequest,
    responseType: google_longrunning_operations_pb.Operation,
    requestSerialize: serialize_google_cloud_vision_v1_AsyncBatchAnnotateImagesRequest,
    requestDeserialize: deserialize_google_cloud_vision_v1_AsyncBatchAnnotateImagesRequest,
    responseSerialize: serialize_google_longrunning_Operation,
    responseDeserialize: deserialize_google_longrunning_Operation,
  },
  // Run asynchronous image detection and annotation for a list of generic
// files, such as PDF files, which may contain multiple pages and multiple
// images per page. Progress and results can be retrieved through the
// `google.longrunning.Operations` interface.
// `Operation.metadata` contains `OperationMetadata` (metadata).
// `Operation.response` contains `AsyncBatchAnnotateFilesResponse` (results).
asyncBatchAnnotateFiles: {
    path: '/google.cloud.vision.v1.ImageAnnotator/AsyncBatchAnnotateFiles',
    requestStream: false,
    responseStream: false,
    requestType: google_cloud_vision_v1_image_annotator_pb.AsyncBatchAnnotateFilesRequest,
    responseType: google_longrunning_operations_pb.Operation,
    requestSerialize: serialize_google_cloud_vision_v1_AsyncBatchAnnotateFilesRequest,
    requestDeserialize: deserialize_google_cloud_vision_v1_AsyncBatchAnnotateFilesRequest,
    responseSerialize: serialize_google_longrunning_Operation,
    responseDeserialize: deserialize_google_longrunning_Operation,
  },
};

exports.ImageAnnotatorClient = grpc.makeGenericClientConstructor(ImageAnnotatorService);
