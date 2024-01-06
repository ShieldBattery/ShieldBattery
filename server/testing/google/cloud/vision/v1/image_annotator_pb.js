// source: google/cloud/vision/v1/image_annotator.proto
/**
 * @fileoverview
 * @enhanceable
 * @suppress {missingRequire} reports error on implicit type usages.
 * @suppress {messageConventions} JS Compiler reports an error if a variable or
 *     field starts with 'MSG_' and isn't a translatable message.
 * @public
 */
// GENERATED CODE -- DO NOT EDIT!
/* eslint-disable */
// @ts-nocheck

var jspb = require('google-protobuf');
var goog = jspb;
var global =
    (typeof globalThis !== 'undefined' && globalThis) ||
    (typeof window !== 'undefined' && window) ||
    (typeof global !== 'undefined' && global) ||
    (typeof self !== 'undefined' && self) ||
    (function () { return this; }).call(null) ||
    Function('return this')();

var google_api_annotations_pb = require('../../../../google/api/annotations_pb.js');
goog.object.extend(proto, google_api_annotations_pb);
var google_api_client_pb = require('../../../../google/api/client_pb.js');
goog.object.extend(proto, google_api_client_pb);
var google_api_field_behavior_pb = require('../../../../google/api/field_behavior_pb.js');
goog.object.extend(proto, google_api_field_behavior_pb);
var google_cloud_vision_v1_geometry_pb = require('../../../../google/cloud/vision/v1/geometry_pb.js');
goog.object.extend(proto, google_cloud_vision_v1_geometry_pb);
var google_cloud_vision_v1_product_search_pb = require('../../../../google/cloud/vision/v1/product_search_pb.js');
goog.object.extend(proto, google_cloud_vision_v1_product_search_pb);
var google_cloud_vision_v1_text_annotation_pb = require('../../../../google/cloud/vision/v1/text_annotation_pb.js');
goog.object.extend(proto, google_cloud_vision_v1_text_annotation_pb);
var google_cloud_vision_v1_web_detection_pb = require('../../../../google/cloud/vision/v1/web_detection_pb.js');
goog.object.extend(proto, google_cloud_vision_v1_web_detection_pb);
var google_longrunning_operations_pb = require('../../../../google/longrunning/operations_pb.js');
goog.object.extend(proto, google_longrunning_operations_pb);
var google_protobuf_timestamp_pb = require('google-protobuf/google/protobuf/timestamp_pb.js');
goog.object.extend(proto, google_protobuf_timestamp_pb);
var google_rpc_status_pb = require('../../../../google/rpc/status_pb.js');
goog.object.extend(proto, google_rpc_status_pb);
var google_type_color_pb = require('../../../../google/type/color_pb.js');
goog.object.extend(proto, google_type_color_pb);
var google_type_latlng_pb = require('../../../../google/type/latlng_pb.js');
goog.object.extend(proto, google_type_latlng_pb);
goog.exportSymbol('proto.google.cloud.vision.v1.AnnotateFileRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.AnnotateFileResponse', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.AnnotateImageRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.AnnotateImageResponse', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.AsyncAnnotateFileRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.AsyncAnnotateFileResponse', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.BatchAnnotateFilesRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.BatchAnnotateFilesResponse', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.BatchAnnotateImagesRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.BatchAnnotateImagesResponse', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ColorInfo', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.CropHint', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.CropHintsAnnotation', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.CropHintsParams', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.DominantColorsAnnotation', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.EntityAnnotation', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.FaceAnnotation', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.FaceAnnotation.Landmark', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.FaceAnnotation.Landmark.Type', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.Feature', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.Feature.Type', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.GcsDestination', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.GcsSource', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.Image', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ImageAnnotationContext', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ImageContext', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ImageProperties', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ImageSource', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.InputConfig', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.LatLongRect', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.Likelihood', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.LocalizedObjectAnnotation', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.LocationInfo', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.OperationMetadata', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.OperationMetadata.State', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.OutputConfig', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.Property', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.SafeSearchAnnotation', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.TextDetectionParams', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.WebDetectionParams', null, global);
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.Feature = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.Feature, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.Feature.displayName = 'proto.google.cloud.vision.v1.Feature';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.ImageSource = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.ImageSource, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ImageSource.displayName = 'proto.google.cloud.vision.v1.ImageSource';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.Image = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.Image, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.Image.displayName = 'proto.google.cloud.vision.v1.Image';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.FaceAnnotation = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.FaceAnnotation.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.FaceAnnotation, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.FaceAnnotation.displayName = 'proto.google.cloud.vision.v1.FaceAnnotation';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.FaceAnnotation.Landmark = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.FaceAnnotation.Landmark, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.FaceAnnotation.Landmark.displayName = 'proto.google.cloud.vision.v1.FaceAnnotation.Landmark';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.LocationInfo = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.LocationInfo, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.LocationInfo.displayName = 'proto.google.cloud.vision.v1.LocationInfo';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.Property = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.Property, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.Property.displayName = 'proto.google.cloud.vision.v1.Property';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.EntityAnnotation = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.EntityAnnotation.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.EntityAnnotation, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.EntityAnnotation.displayName = 'proto.google.cloud.vision.v1.EntityAnnotation';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.LocalizedObjectAnnotation, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.LocalizedObjectAnnotation.displayName = 'proto.google.cloud.vision.v1.LocalizedObjectAnnotation';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.SafeSearchAnnotation, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.SafeSearchAnnotation.displayName = 'proto.google.cloud.vision.v1.SafeSearchAnnotation';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.LatLongRect = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.LatLongRect, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.LatLongRect.displayName = 'proto.google.cloud.vision.v1.LatLongRect';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.ColorInfo = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.ColorInfo, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ColorInfo.displayName = 'proto.google.cloud.vision.v1.ColorInfo';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.DominantColorsAnnotation = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.DominantColorsAnnotation.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.DominantColorsAnnotation, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.DominantColorsAnnotation.displayName = 'proto.google.cloud.vision.v1.DominantColorsAnnotation';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.ImageProperties = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.ImageProperties, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ImageProperties.displayName = 'proto.google.cloud.vision.v1.ImageProperties';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.CropHint = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.CropHint, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.CropHint.displayName = 'proto.google.cloud.vision.v1.CropHint';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.CropHintsAnnotation = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.CropHintsAnnotation.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.CropHintsAnnotation, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.CropHintsAnnotation.displayName = 'proto.google.cloud.vision.v1.CropHintsAnnotation';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.CropHintsParams = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.CropHintsParams.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.CropHintsParams, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.CropHintsParams.displayName = 'proto.google.cloud.vision.v1.CropHintsParams';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.WebDetectionParams = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.WebDetectionParams, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.WebDetectionParams.displayName = 'proto.google.cloud.vision.v1.WebDetectionParams';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.TextDetectionParams = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.TextDetectionParams.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.TextDetectionParams, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.TextDetectionParams.displayName = 'proto.google.cloud.vision.v1.TextDetectionParams';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.ImageContext = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.ImageContext.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.ImageContext, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ImageContext.displayName = 'proto.google.cloud.vision.v1.ImageContext';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.AnnotateImageRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.AnnotateImageRequest.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.AnnotateImageRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.AnnotateImageRequest.displayName = 'proto.google.cloud.vision.v1.AnnotateImageRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.ImageAnnotationContext = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.ImageAnnotationContext, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ImageAnnotationContext.displayName = 'proto.google.cloud.vision.v1.ImageAnnotationContext';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.AnnotateImageResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.AnnotateImageResponse.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.AnnotateImageResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.AnnotateImageResponse.displayName = 'proto.google.cloud.vision.v1.AnnotateImageResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.BatchAnnotateImagesRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.displayName = 'proto.google.cloud.vision.v1.BatchAnnotateImagesRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.BatchAnnotateImagesResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.displayName = 'proto.google.cloud.vision.v1.BatchAnnotateImagesResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.AnnotateFileRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.AnnotateFileRequest.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.AnnotateFileRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.AnnotateFileRequest.displayName = 'proto.google.cloud.vision.v1.AnnotateFileRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.AnnotateFileResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.AnnotateFileResponse.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.AnnotateFileResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.AnnotateFileResponse.displayName = 'proto.google.cloud.vision.v1.AnnotateFileResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.BatchAnnotateFilesRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.displayName = 'proto.google.cloud.vision.v1.BatchAnnotateFilesRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.BatchAnnotateFilesResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.displayName = 'proto.google.cloud.vision.v1.BatchAnnotateFilesResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.AsyncAnnotateFileRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.displayName = 'proto.google.cloud.vision.v1.AsyncAnnotateFileRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.AsyncAnnotateFileResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.displayName = 'proto.google.cloud.vision.v1.AsyncAnnotateFileResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.displayName = 'proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse.displayName = 'proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.displayName = 'proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.displayName = 'proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.InputConfig = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.InputConfig, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.InputConfig.displayName = 'proto.google.cloud.vision.v1.InputConfig';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.OutputConfig = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.OutputConfig, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.OutputConfig.displayName = 'proto.google.cloud.vision.v1.OutputConfig';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.GcsSource = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.GcsSource, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.GcsSource.displayName = 'proto.google.cloud.vision.v1.GcsSource';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.GcsDestination = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.GcsDestination, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.GcsDestination.displayName = 'proto.google.cloud.vision.v1.GcsDestination';
}
/**
 * Generated by JsPbCodeGenerator.
 * @param {Array=} opt_data Optional initial data array, typically from a
 * server response, or constructed directly in Javascript. The array is used
 * in place and becomes part of the constructed object. It is not cloned.
 * If no data is provided, the constructed object will be empty, but still
 * valid.
 * @extends {jspb.Message}
 * @constructor
 */
proto.google.cloud.vision.v1.OperationMetadata = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.OperationMetadata, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.OperationMetadata.displayName = 'proto.google.cloud.vision.v1.OperationMetadata';
}



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.Feature.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.Feature.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.Feature} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.Feature.toObject = function(includeInstance, msg) {
  var f, obj = {
    type: jspb.Message.getFieldWithDefault(msg, 1, 0),
    maxResults: jspb.Message.getFieldWithDefault(msg, 2, 0),
    model: jspb.Message.getFieldWithDefault(msg, 3, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.Feature}
 */
proto.google.cloud.vision.v1.Feature.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.Feature;
  return proto.google.cloud.vision.v1.Feature.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.Feature} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.Feature}
 */
proto.google.cloud.vision.v1.Feature.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {!proto.google.cloud.vision.v1.Feature.Type} */ (reader.readEnum());
      msg.setType(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt32());
      msg.setMaxResults(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setModel(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.Feature.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.Feature.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.Feature} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.Feature.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getType();
  if (f !== 0.0) {
    writer.writeEnum(
      1,
      f
    );
  }
  f = message.getMaxResults();
  if (f !== 0) {
    writer.writeInt32(
      2,
      f
    );
  }
  f = message.getModel();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
};


/**
 * @enum {number}
 */
proto.google.cloud.vision.v1.Feature.Type = {
  TYPE_UNSPECIFIED: 0,
  FACE_DETECTION: 1,
  LANDMARK_DETECTION: 2,
  LOGO_DETECTION: 3,
  LABEL_DETECTION: 4,
  TEXT_DETECTION: 5,
  DOCUMENT_TEXT_DETECTION: 11,
  SAFE_SEARCH_DETECTION: 6,
  IMAGE_PROPERTIES: 7,
  CROP_HINTS: 9,
  WEB_DETECTION: 10,
  PRODUCT_SEARCH: 12,
  OBJECT_LOCALIZATION: 19
};

/**
 * optional Type type = 1;
 * @return {!proto.google.cloud.vision.v1.Feature.Type}
 */
proto.google.cloud.vision.v1.Feature.prototype.getType = function() {
  return /** @type {!proto.google.cloud.vision.v1.Feature.Type} */ (jspb.Message.getFieldWithDefault(this, 1, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.Feature.Type} value
 * @return {!proto.google.cloud.vision.v1.Feature} returns this
 */
proto.google.cloud.vision.v1.Feature.prototype.setType = function(value) {
  return jspb.Message.setProto3EnumField(this, 1, value);
};


/**
 * optional int32 max_results = 2;
 * @return {number}
 */
proto.google.cloud.vision.v1.Feature.prototype.getMaxResults = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.Feature} returns this
 */
proto.google.cloud.vision.v1.Feature.prototype.setMaxResults = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional string model = 3;
 * @return {string}
 */
proto.google.cloud.vision.v1.Feature.prototype.getModel = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.Feature} returns this
 */
proto.google.cloud.vision.v1.Feature.prototype.setModel = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.ImageSource.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ImageSource.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ImageSource} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImageSource.toObject = function(includeInstance, msg) {
  var f, obj = {
    gcsImageUri: jspb.Message.getFieldWithDefault(msg, 1, ""),
    imageUri: jspb.Message.getFieldWithDefault(msg, 2, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.ImageSource}
 */
proto.google.cloud.vision.v1.ImageSource.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ImageSource;
  return proto.google.cloud.vision.v1.ImageSource.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ImageSource} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ImageSource}
 */
proto.google.cloud.vision.v1.ImageSource.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setGcsImageUri(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setImageUri(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.ImageSource.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ImageSource.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ImageSource} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImageSource.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getGcsImageUri();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getImageUri();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
};


/**
 * optional string gcs_image_uri = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.ImageSource.prototype.getGcsImageUri = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ImageSource} returns this
 */
proto.google.cloud.vision.v1.ImageSource.prototype.setGcsImageUri = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string image_uri = 2;
 * @return {string}
 */
proto.google.cloud.vision.v1.ImageSource.prototype.getImageUri = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ImageSource} returns this
 */
proto.google.cloud.vision.v1.ImageSource.prototype.setImageUri = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.Image.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.Image.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.Image} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.Image.toObject = function(includeInstance, msg) {
  var f, obj = {
    content: msg.getContent_asB64(),
    source: (f = msg.getSource()) && proto.google.cloud.vision.v1.ImageSource.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.Image}
 */
proto.google.cloud.vision.v1.Image.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.Image;
  return proto.google.cloud.vision.v1.Image.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.Image} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.Image}
 */
proto.google.cloud.vision.v1.Image.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {!Uint8Array} */ (reader.readBytes());
      msg.setContent(value);
      break;
    case 2:
      var value = new proto.google.cloud.vision.v1.ImageSource;
      reader.readMessage(value,proto.google.cloud.vision.v1.ImageSource.deserializeBinaryFromReader);
      msg.setSource(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.Image.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.Image.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.Image} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.Image.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getContent_asU8();
  if (f.length > 0) {
    writer.writeBytes(
      1,
      f
    );
  }
  f = message.getSource();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.google.cloud.vision.v1.ImageSource.serializeBinaryToWriter
    );
  }
};


/**
 * optional bytes content = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.Image.prototype.getContent = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * optional bytes content = 1;
 * This is a type-conversion wrapper around `getContent()`
 * @return {string}
 */
proto.google.cloud.vision.v1.Image.prototype.getContent_asB64 = function() {
  return /** @type {string} */ (jspb.Message.bytesAsB64(
      this.getContent()));
};


/**
 * optional bytes content = 1;
 * Note that Uint8Array is not supported on all browsers.
 * @see http://caniuse.com/Uint8Array
 * This is a type-conversion wrapper around `getContent()`
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.Image.prototype.getContent_asU8 = function() {
  return /** @type {!Uint8Array} */ (jspb.Message.bytesAsU8(
      this.getContent()));
};


/**
 * @param {!(string|Uint8Array)} value
 * @return {!proto.google.cloud.vision.v1.Image} returns this
 */
proto.google.cloud.vision.v1.Image.prototype.setContent = function(value) {
  return jspb.Message.setProto3BytesField(this, 1, value);
};


/**
 * optional ImageSource source = 2;
 * @return {?proto.google.cloud.vision.v1.ImageSource}
 */
proto.google.cloud.vision.v1.Image.prototype.getSource = function() {
  return /** @type{?proto.google.cloud.vision.v1.ImageSource} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.ImageSource, 2));
};


/**
 * @param {?proto.google.cloud.vision.v1.ImageSource|undefined} value
 * @return {!proto.google.cloud.vision.v1.Image} returns this
*/
proto.google.cloud.vision.v1.Image.prototype.setSource = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.Image} returns this
 */
proto.google.cloud.vision.v1.Image.prototype.clearSource = function() {
  return this.setSource(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.Image.prototype.hasSource = function() {
  return jspb.Message.getField(this, 2) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.FaceAnnotation.repeatedFields_ = [3];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.FaceAnnotation.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.FaceAnnotation} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.FaceAnnotation.toObject = function(includeInstance, msg) {
  var f, obj = {
    boundingPoly: (f = msg.getBoundingPoly()) && google_cloud_vision_v1_geometry_pb.BoundingPoly.toObject(includeInstance, f),
    fdBoundingPoly: (f = msg.getFdBoundingPoly()) && google_cloud_vision_v1_geometry_pb.BoundingPoly.toObject(includeInstance, f),
    landmarksList: jspb.Message.toObjectList(msg.getLandmarksList(),
    proto.google.cloud.vision.v1.FaceAnnotation.Landmark.toObject, includeInstance),
    rollAngle: jspb.Message.getFloatingPointFieldWithDefault(msg, 4, 0.0),
    panAngle: jspb.Message.getFloatingPointFieldWithDefault(msg, 5, 0.0),
    tiltAngle: jspb.Message.getFloatingPointFieldWithDefault(msg, 6, 0.0),
    detectionConfidence: jspb.Message.getFloatingPointFieldWithDefault(msg, 7, 0.0),
    landmarkingConfidence: jspb.Message.getFloatingPointFieldWithDefault(msg, 8, 0.0),
    joyLikelihood: jspb.Message.getFieldWithDefault(msg, 9, 0),
    sorrowLikelihood: jspb.Message.getFieldWithDefault(msg, 10, 0),
    angerLikelihood: jspb.Message.getFieldWithDefault(msg, 11, 0),
    surpriseLikelihood: jspb.Message.getFieldWithDefault(msg, 12, 0),
    underExposedLikelihood: jspb.Message.getFieldWithDefault(msg, 13, 0),
    blurredLikelihood: jspb.Message.getFieldWithDefault(msg, 14, 0),
    headwearLikelihood: jspb.Message.getFieldWithDefault(msg, 15, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation}
 */
proto.google.cloud.vision.v1.FaceAnnotation.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.FaceAnnotation;
  return proto.google.cloud.vision.v1.FaceAnnotation.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.FaceAnnotation} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation}
 */
proto.google.cloud.vision.v1.FaceAnnotation.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new google_cloud_vision_v1_geometry_pb.BoundingPoly;
      reader.readMessage(value,google_cloud_vision_v1_geometry_pb.BoundingPoly.deserializeBinaryFromReader);
      msg.setBoundingPoly(value);
      break;
    case 2:
      var value = new google_cloud_vision_v1_geometry_pb.BoundingPoly;
      reader.readMessage(value,google_cloud_vision_v1_geometry_pb.BoundingPoly.deserializeBinaryFromReader);
      msg.setFdBoundingPoly(value);
      break;
    case 3:
      var value = new proto.google.cloud.vision.v1.FaceAnnotation.Landmark;
      reader.readMessage(value,proto.google.cloud.vision.v1.FaceAnnotation.Landmark.deserializeBinaryFromReader);
      msg.addLandmarks(value);
      break;
    case 4:
      var value = /** @type {number} */ (reader.readFloat());
      msg.setRollAngle(value);
      break;
    case 5:
      var value = /** @type {number} */ (reader.readFloat());
      msg.setPanAngle(value);
      break;
    case 6:
      var value = /** @type {number} */ (reader.readFloat());
      msg.setTiltAngle(value);
      break;
    case 7:
      var value = /** @type {number} */ (reader.readFloat());
      msg.setDetectionConfidence(value);
      break;
    case 8:
      var value = /** @type {number} */ (reader.readFloat());
      msg.setLandmarkingConfidence(value);
      break;
    case 9:
      var value = /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (reader.readEnum());
      msg.setJoyLikelihood(value);
      break;
    case 10:
      var value = /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (reader.readEnum());
      msg.setSorrowLikelihood(value);
      break;
    case 11:
      var value = /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (reader.readEnum());
      msg.setAngerLikelihood(value);
      break;
    case 12:
      var value = /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (reader.readEnum());
      msg.setSurpriseLikelihood(value);
      break;
    case 13:
      var value = /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (reader.readEnum());
      msg.setUnderExposedLikelihood(value);
      break;
    case 14:
      var value = /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (reader.readEnum());
      msg.setBlurredLikelihood(value);
      break;
    case 15:
      var value = /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (reader.readEnum());
      msg.setHeadwearLikelihood(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.FaceAnnotation.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.FaceAnnotation} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.FaceAnnotation.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getBoundingPoly();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      google_cloud_vision_v1_geometry_pb.BoundingPoly.serializeBinaryToWriter
    );
  }
  f = message.getFdBoundingPoly();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      google_cloud_vision_v1_geometry_pb.BoundingPoly.serializeBinaryToWriter
    );
  }
  f = message.getLandmarksList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      3,
      f,
      proto.google.cloud.vision.v1.FaceAnnotation.Landmark.serializeBinaryToWriter
    );
  }
  f = message.getRollAngle();
  if (f !== 0.0) {
    writer.writeFloat(
      4,
      f
    );
  }
  f = message.getPanAngle();
  if (f !== 0.0) {
    writer.writeFloat(
      5,
      f
    );
  }
  f = message.getTiltAngle();
  if (f !== 0.0) {
    writer.writeFloat(
      6,
      f
    );
  }
  f = message.getDetectionConfidence();
  if (f !== 0.0) {
    writer.writeFloat(
      7,
      f
    );
  }
  f = message.getLandmarkingConfidence();
  if (f !== 0.0) {
    writer.writeFloat(
      8,
      f
    );
  }
  f = message.getJoyLikelihood();
  if (f !== 0.0) {
    writer.writeEnum(
      9,
      f
    );
  }
  f = message.getSorrowLikelihood();
  if (f !== 0.0) {
    writer.writeEnum(
      10,
      f
    );
  }
  f = message.getAngerLikelihood();
  if (f !== 0.0) {
    writer.writeEnum(
      11,
      f
    );
  }
  f = message.getSurpriseLikelihood();
  if (f !== 0.0) {
    writer.writeEnum(
      12,
      f
    );
  }
  f = message.getUnderExposedLikelihood();
  if (f !== 0.0) {
    writer.writeEnum(
      13,
      f
    );
  }
  f = message.getBlurredLikelihood();
  if (f !== 0.0) {
    writer.writeEnum(
      14,
      f
    );
  }
  f = message.getHeadwearLikelihood();
  if (f !== 0.0) {
    writer.writeEnum(
      15,
      f
    );
  }
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.FaceAnnotation.Landmark.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.FaceAnnotation.Landmark.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.FaceAnnotation.Landmark} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.FaceAnnotation.Landmark.toObject = function(includeInstance, msg) {
  var f, obj = {
    type: jspb.Message.getFieldWithDefault(msg, 3, 0),
    position: (f = msg.getPosition()) && google_cloud_vision_v1_geometry_pb.Position.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation.Landmark}
 */
proto.google.cloud.vision.v1.FaceAnnotation.Landmark.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.FaceAnnotation.Landmark;
  return proto.google.cloud.vision.v1.FaceAnnotation.Landmark.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.FaceAnnotation.Landmark} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation.Landmark}
 */
proto.google.cloud.vision.v1.FaceAnnotation.Landmark.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 3:
      var value = /** @type {!proto.google.cloud.vision.v1.FaceAnnotation.Landmark.Type} */ (reader.readEnum());
      msg.setType(value);
      break;
    case 4:
      var value = new google_cloud_vision_v1_geometry_pb.Position;
      reader.readMessage(value,google_cloud_vision_v1_geometry_pb.Position.deserializeBinaryFromReader);
      msg.setPosition(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.FaceAnnotation.Landmark.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.FaceAnnotation.Landmark.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.FaceAnnotation.Landmark} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.FaceAnnotation.Landmark.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getType();
  if (f !== 0.0) {
    writer.writeEnum(
      3,
      f
    );
  }
  f = message.getPosition();
  if (f != null) {
    writer.writeMessage(
      4,
      f,
      google_cloud_vision_v1_geometry_pb.Position.serializeBinaryToWriter
    );
  }
};


/**
 * @enum {number}
 */
proto.google.cloud.vision.v1.FaceAnnotation.Landmark.Type = {
  UNKNOWN_LANDMARK: 0,
  LEFT_EYE: 1,
  RIGHT_EYE: 2,
  LEFT_OF_LEFT_EYEBROW: 3,
  RIGHT_OF_LEFT_EYEBROW: 4,
  LEFT_OF_RIGHT_EYEBROW: 5,
  RIGHT_OF_RIGHT_EYEBROW: 6,
  MIDPOINT_BETWEEN_EYES: 7,
  NOSE_TIP: 8,
  UPPER_LIP: 9,
  LOWER_LIP: 10,
  MOUTH_LEFT: 11,
  MOUTH_RIGHT: 12,
  MOUTH_CENTER: 13,
  NOSE_BOTTOM_RIGHT: 14,
  NOSE_BOTTOM_LEFT: 15,
  NOSE_BOTTOM_CENTER: 16,
  LEFT_EYE_TOP_BOUNDARY: 17,
  LEFT_EYE_RIGHT_CORNER: 18,
  LEFT_EYE_BOTTOM_BOUNDARY: 19,
  LEFT_EYE_LEFT_CORNER: 20,
  RIGHT_EYE_TOP_BOUNDARY: 21,
  RIGHT_EYE_RIGHT_CORNER: 22,
  RIGHT_EYE_BOTTOM_BOUNDARY: 23,
  RIGHT_EYE_LEFT_CORNER: 24,
  LEFT_EYEBROW_UPPER_MIDPOINT: 25,
  RIGHT_EYEBROW_UPPER_MIDPOINT: 26,
  LEFT_EAR_TRAGION: 27,
  RIGHT_EAR_TRAGION: 28,
  LEFT_EYE_PUPIL: 29,
  RIGHT_EYE_PUPIL: 30,
  FOREHEAD_GLABELLA: 31,
  CHIN_GNATHION: 32,
  CHIN_LEFT_GONION: 33,
  CHIN_RIGHT_GONION: 34,
  LEFT_CHEEK_CENTER: 35,
  RIGHT_CHEEK_CENTER: 36
};

/**
 * optional Type type = 3;
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation.Landmark.Type}
 */
proto.google.cloud.vision.v1.FaceAnnotation.Landmark.prototype.getType = function() {
  return /** @type {!proto.google.cloud.vision.v1.FaceAnnotation.Landmark.Type} */ (jspb.Message.getFieldWithDefault(this, 3, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.FaceAnnotation.Landmark.Type} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation.Landmark} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.Landmark.prototype.setType = function(value) {
  return jspb.Message.setProto3EnumField(this, 3, value);
};


/**
 * optional Position position = 4;
 * @return {?proto.google.cloud.vision.v1.Position}
 */
proto.google.cloud.vision.v1.FaceAnnotation.Landmark.prototype.getPosition = function() {
  return /** @type{?proto.google.cloud.vision.v1.Position} */ (
    jspb.Message.getWrapperField(this, google_cloud_vision_v1_geometry_pb.Position, 4));
};


/**
 * @param {?proto.google.cloud.vision.v1.Position|undefined} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation.Landmark} returns this
*/
proto.google.cloud.vision.v1.FaceAnnotation.Landmark.prototype.setPosition = function(value) {
  return jspb.Message.setWrapperField(this, 4, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation.Landmark} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.Landmark.prototype.clearPosition = function() {
  return this.setPosition(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.FaceAnnotation.Landmark.prototype.hasPosition = function() {
  return jspb.Message.getField(this, 4) != null;
};


/**
 * optional BoundingPoly bounding_poly = 1;
 * @return {?proto.google.cloud.vision.v1.BoundingPoly}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.getBoundingPoly = function() {
  return /** @type{?proto.google.cloud.vision.v1.BoundingPoly} */ (
    jspb.Message.getWrapperField(this, google_cloud_vision_v1_geometry_pb.BoundingPoly, 1));
};


/**
 * @param {?proto.google.cloud.vision.v1.BoundingPoly|undefined} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
*/
proto.google.cloud.vision.v1.FaceAnnotation.prototype.setBoundingPoly = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.clearBoundingPoly = function() {
  return this.setBoundingPoly(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.hasBoundingPoly = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional BoundingPoly fd_bounding_poly = 2;
 * @return {?proto.google.cloud.vision.v1.BoundingPoly}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.getFdBoundingPoly = function() {
  return /** @type{?proto.google.cloud.vision.v1.BoundingPoly} */ (
    jspb.Message.getWrapperField(this, google_cloud_vision_v1_geometry_pb.BoundingPoly, 2));
};


/**
 * @param {?proto.google.cloud.vision.v1.BoundingPoly|undefined} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
*/
proto.google.cloud.vision.v1.FaceAnnotation.prototype.setFdBoundingPoly = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.clearFdBoundingPoly = function() {
  return this.setFdBoundingPoly(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.hasFdBoundingPoly = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * repeated Landmark landmarks = 3;
 * @return {!Array<!proto.google.cloud.vision.v1.FaceAnnotation.Landmark>}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.getLandmarksList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.FaceAnnotation.Landmark>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.FaceAnnotation.Landmark, 3));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.FaceAnnotation.Landmark>} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
*/
proto.google.cloud.vision.v1.FaceAnnotation.prototype.setLandmarksList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 3, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.FaceAnnotation.Landmark=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation.Landmark}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.addLandmarks = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 3, opt_value, proto.google.cloud.vision.v1.FaceAnnotation.Landmark, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.clearLandmarksList = function() {
  return this.setLandmarksList([]);
};


/**
 * optional float roll_angle = 4;
 * @return {number}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.getRollAngle = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 4, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.setRollAngle = function(value) {
  return jspb.Message.setProto3FloatField(this, 4, value);
};


/**
 * optional float pan_angle = 5;
 * @return {number}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.getPanAngle = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 5, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.setPanAngle = function(value) {
  return jspb.Message.setProto3FloatField(this, 5, value);
};


/**
 * optional float tilt_angle = 6;
 * @return {number}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.getTiltAngle = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 6, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.setTiltAngle = function(value) {
  return jspb.Message.setProto3FloatField(this, 6, value);
};


/**
 * optional float detection_confidence = 7;
 * @return {number}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.getDetectionConfidence = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 7, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.setDetectionConfidence = function(value) {
  return jspb.Message.setProto3FloatField(this, 7, value);
};


/**
 * optional float landmarking_confidence = 8;
 * @return {number}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.getLandmarkingConfidence = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 8, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.setLandmarkingConfidence = function(value) {
  return jspb.Message.setProto3FloatField(this, 8, value);
};


/**
 * optional Likelihood joy_likelihood = 9;
 * @return {!proto.google.cloud.vision.v1.Likelihood}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.getJoyLikelihood = function() {
  return /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (jspb.Message.getFieldWithDefault(this, 9, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.Likelihood} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.setJoyLikelihood = function(value) {
  return jspb.Message.setProto3EnumField(this, 9, value);
};


/**
 * optional Likelihood sorrow_likelihood = 10;
 * @return {!proto.google.cloud.vision.v1.Likelihood}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.getSorrowLikelihood = function() {
  return /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (jspb.Message.getFieldWithDefault(this, 10, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.Likelihood} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.setSorrowLikelihood = function(value) {
  return jspb.Message.setProto3EnumField(this, 10, value);
};


/**
 * optional Likelihood anger_likelihood = 11;
 * @return {!proto.google.cloud.vision.v1.Likelihood}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.getAngerLikelihood = function() {
  return /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (jspb.Message.getFieldWithDefault(this, 11, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.Likelihood} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.setAngerLikelihood = function(value) {
  return jspb.Message.setProto3EnumField(this, 11, value);
};


/**
 * optional Likelihood surprise_likelihood = 12;
 * @return {!proto.google.cloud.vision.v1.Likelihood}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.getSurpriseLikelihood = function() {
  return /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (jspb.Message.getFieldWithDefault(this, 12, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.Likelihood} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.setSurpriseLikelihood = function(value) {
  return jspb.Message.setProto3EnumField(this, 12, value);
};


/**
 * optional Likelihood under_exposed_likelihood = 13;
 * @return {!proto.google.cloud.vision.v1.Likelihood}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.getUnderExposedLikelihood = function() {
  return /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (jspb.Message.getFieldWithDefault(this, 13, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.Likelihood} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.setUnderExposedLikelihood = function(value) {
  return jspb.Message.setProto3EnumField(this, 13, value);
};


/**
 * optional Likelihood blurred_likelihood = 14;
 * @return {!proto.google.cloud.vision.v1.Likelihood}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.getBlurredLikelihood = function() {
  return /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (jspb.Message.getFieldWithDefault(this, 14, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.Likelihood} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.setBlurredLikelihood = function(value) {
  return jspb.Message.setProto3EnumField(this, 14, value);
};


/**
 * optional Likelihood headwear_likelihood = 15;
 * @return {!proto.google.cloud.vision.v1.Likelihood}
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.getHeadwearLikelihood = function() {
  return /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (jspb.Message.getFieldWithDefault(this, 15, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.Likelihood} value
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation} returns this
 */
proto.google.cloud.vision.v1.FaceAnnotation.prototype.setHeadwearLikelihood = function(value) {
  return jspb.Message.setProto3EnumField(this, 15, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.LocationInfo.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.LocationInfo.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.LocationInfo} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.LocationInfo.toObject = function(includeInstance, msg) {
  var f, obj = {
    latLng: (f = msg.getLatLng()) && google_type_latlng_pb.LatLng.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.LocationInfo}
 */
proto.google.cloud.vision.v1.LocationInfo.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.LocationInfo;
  return proto.google.cloud.vision.v1.LocationInfo.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.LocationInfo} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.LocationInfo}
 */
proto.google.cloud.vision.v1.LocationInfo.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new google_type_latlng_pb.LatLng;
      reader.readMessage(value,google_type_latlng_pb.LatLng.deserializeBinaryFromReader);
      msg.setLatLng(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.LocationInfo.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.LocationInfo.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.LocationInfo} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.LocationInfo.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getLatLng();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      google_type_latlng_pb.LatLng.serializeBinaryToWriter
    );
  }
};


/**
 * optional google.type.LatLng lat_lng = 1;
 * @return {?proto.google.type.LatLng}
 */
proto.google.cloud.vision.v1.LocationInfo.prototype.getLatLng = function() {
  return /** @type{?proto.google.type.LatLng} */ (
    jspb.Message.getWrapperField(this, google_type_latlng_pb.LatLng, 1));
};


/**
 * @param {?proto.google.type.LatLng|undefined} value
 * @return {!proto.google.cloud.vision.v1.LocationInfo} returns this
*/
proto.google.cloud.vision.v1.LocationInfo.prototype.setLatLng = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.LocationInfo} returns this
 */
proto.google.cloud.vision.v1.LocationInfo.prototype.clearLatLng = function() {
  return this.setLatLng(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.LocationInfo.prototype.hasLatLng = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.Property.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.Property.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.Property} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.Property.toObject = function(includeInstance, msg) {
  var f, obj = {
    name: jspb.Message.getFieldWithDefault(msg, 1, ""),
    value: jspb.Message.getFieldWithDefault(msg, 2, ""),
    uint64Value: jspb.Message.getFieldWithDefault(msg, 3, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.Property}
 */
proto.google.cloud.vision.v1.Property.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.Property;
  return proto.google.cloud.vision.v1.Property.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.Property} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.Property}
 */
proto.google.cloud.vision.v1.Property.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setName(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setValue(value);
      break;
    case 3:
      var value = /** @type {number} */ (reader.readUint64());
      msg.setUint64Value(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.Property.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.Property.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.Property} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.Property.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getValue();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getUint64Value();
  if (f !== 0) {
    writer.writeUint64(
      3,
      f
    );
  }
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.Property.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.Property} returns this
 */
proto.google.cloud.vision.v1.Property.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string value = 2;
 * @return {string}
 */
proto.google.cloud.vision.v1.Property.prototype.getValue = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.Property} returns this
 */
proto.google.cloud.vision.v1.Property.prototype.setValue = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional uint64 uint64_value = 3;
 * @return {number}
 */
proto.google.cloud.vision.v1.Property.prototype.getUint64Value = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 3, 0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.Property} returns this
 */
proto.google.cloud.vision.v1.Property.prototype.setUint64Value = function(value) {
  return jspb.Message.setProto3IntField(this, 3, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.EntityAnnotation.repeatedFields_ = [8,9];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.EntityAnnotation.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.EntityAnnotation} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.EntityAnnotation.toObject = function(includeInstance, msg) {
  var f, obj = {
    mid: jspb.Message.getFieldWithDefault(msg, 1, ""),
    locale: jspb.Message.getFieldWithDefault(msg, 2, ""),
    description: jspb.Message.getFieldWithDefault(msg, 3, ""),
    score: jspb.Message.getFloatingPointFieldWithDefault(msg, 4, 0.0),
    confidence: jspb.Message.getFloatingPointFieldWithDefault(msg, 5, 0.0),
    topicality: jspb.Message.getFloatingPointFieldWithDefault(msg, 6, 0.0),
    boundingPoly: (f = msg.getBoundingPoly()) && google_cloud_vision_v1_geometry_pb.BoundingPoly.toObject(includeInstance, f),
    locationsList: jspb.Message.toObjectList(msg.getLocationsList(),
    proto.google.cloud.vision.v1.LocationInfo.toObject, includeInstance),
    propertiesList: jspb.Message.toObjectList(msg.getPropertiesList(),
    proto.google.cloud.vision.v1.Property.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation}
 */
proto.google.cloud.vision.v1.EntityAnnotation.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.EntityAnnotation;
  return proto.google.cloud.vision.v1.EntityAnnotation.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.EntityAnnotation} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation}
 */
proto.google.cloud.vision.v1.EntityAnnotation.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setMid(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setLocale(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setDescription(value);
      break;
    case 4:
      var value = /** @type {number} */ (reader.readFloat());
      msg.setScore(value);
      break;
    case 5:
      var value = /** @type {number} */ (reader.readFloat());
      msg.setConfidence(value);
      break;
    case 6:
      var value = /** @type {number} */ (reader.readFloat());
      msg.setTopicality(value);
      break;
    case 7:
      var value = new google_cloud_vision_v1_geometry_pb.BoundingPoly;
      reader.readMessage(value,google_cloud_vision_v1_geometry_pb.BoundingPoly.deserializeBinaryFromReader);
      msg.setBoundingPoly(value);
      break;
    case 8:
      var value = new proto.google.cloud.vision.v1.LocationInfo;
      reader.readMessage(value,proto.google.cloud.vision.v1.LocationInfo.deserializeBinaryFromReader);
      msg.addLocations(value);
      break;
    case 9:
      var value = new proto.google.cloud.vision.v1.Property;
      reader.readMessage(value,proto.google.cloud.vision.v1.Property.deserializeBinaryFromReader);
      msg.addProperties(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.EntityAnnotation.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.EntityAnnotation} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.EntityAnnotation.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMid();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getLocale();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getDescription();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getScore();
  if (f !== 0.0) {
    writer.writeFloat(
      4,
      f
    );
  }
  f = message.getConfidence();
  if (f !== 0.0) {
    writer.writeFloat(
      5,
      f
    );
  }
  f = message.getTopicality();
  if (f !== 0.0) {
    writer.writeFloat(
      6,
      f
    );
  }
  f = message.getBoundingPoly();
  if (f != null) {
    writer.writeMessage(
      7,
      f,
      google_cloud_vision_v1_geometry_pb.BoundingPoly.serializeBinaryToWriter
    );
  }
  f = message.getLocationsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      8,
      f,
      proto.google.cloud.vision.v1.LocationInfo.serializeBinaryToWriter
    );
  }
  f = message.getPropertiesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      9,
      f,
      proto.google.cloud.vision.v1.Property.serializeBinaryToWriter
    );
  }
};


/**
 * optional string mid = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.getMid = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation} returns this
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.setMid = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string locale = 2;
 * @return {string}
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.getLocale = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation} returns this
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.setLocale = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string description = 3;
 * @return {string}
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.getDescription = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation} returns this
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.setDescription = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional float score = 4;
 * @return {number}
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.getScore = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 4, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation} returns this
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.setScore = function(value) {
  return jspb.Message.setProto3FloatField(this, 4, value);
};


/**
 * optional float confidence = 5;
 * @return {number}
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.getConfidence = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 5, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation} returns this
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.setConfidence = function(value) {
  return jspb.Message.setProto3FloatField(this, 5, value);
};


/**
 * optional float topicality = 6;
 * @return {number}
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.getTopicality = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 6, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation} returns this
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.setTopicality = function(value) {
  return jspb.Message.setProto3FloatField(this, 6, value);
};


/**
 * optional BoundingPoly bounding_poly = 7;
 * @return {?proto.google.cloud.vision.v1.BoundingPoly}
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.getBoundingPoly = function() {
  return /** @type{?proto.google.cloud.vision.v1.BoundingPoly} */ (
    jspb.Message.getWrapperField(this, google_cloud_vision_v1_geometry_pb.BoundingPoly, 7));
};


/**
 * @param {?proto.google.cloud.vision.v1.BoundingPoly|undefined} value
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation} returns this
*/
proto.google.cloud.vision.v1.EntityAnnotation.prototype.setBoundingPoly = function(value) {
  return jspb.Message.setWrapperField(this, 7, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation} returns this
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.clearBoundingPoly = function() {
  return this.setBoundingPoly(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.hasBoundingPoly = function() {
  return jspb.Message.getField(this, 7) != null;
};


/**
 * repeated LocationInfo locations = 8;
 * @return {!Array<!proto.google.cloud.vision.v1.LocationInfo>}
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.getLocationsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.LocationInfo>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.LocationInfo, 8));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.LocationInfo>} value
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation} returns this
*/
proto.google.cloud.vision.v1.EntityAnnotation.prototype.setLocationsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 8, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.LocationInfo=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.LocationInfo}
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.addLocations = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 8, opt_value, proto.google.cloud.vision.v1.LocationInfo, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation} returns this
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.clearLocationsList = function() {
  return this.setLocationsList([]);
};


/**
 * repeated Property properties = 9;
 * @return {!Array<!proto.google.cloud.vision.v1.Property>}
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.getPropertiesList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.Property>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.Property, 9));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.Property>} value
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation} returns this
*/
proto.google.cloud.vision.v1.EntityAnnotation.prototype.setPropertiesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 9, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.Property=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.Property}
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.addProperties = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 9, opt_value, proto.google.cloud.vision.v1.Property, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation} returns this
 */
proto.google.cloud.vision.v1.EntityAnnotation.prototype.clearPropertiesList = function() {
  return this.setPropertiesList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.LocalizedObjectAnnotation.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.LocalizedObjectAnnotation} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.toObject = function(includeInstance, msg) {
  var f, obj = {
    mid: jspb.Message.getFieldWithDefault(msg, 1, ""),
    languageCode: jspb.Message.getFieldWithDefault(msg, 2, ""),
    name: jspb.Message.getFieldWithDefault(msg, 3, ""),
    score: jspb.Message.getFloatingPointFieldWithDefault(msg, 4, 0.0),
    boundingPoly: (f = msg.getBoundingPoly()) && google_cloud_vision_v1_geometry_pb.BoundingPoly.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.LocalizedObjectAnnotation}
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.LocalizedObjectAnnotation;
  return proto.google.cloud.vision.v1.LocalizedObjectAnnotation.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.LocalizedObjectAnnotation} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.LocalizedObjectAnnotation}
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setMid(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setLanguageCode(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setName(value);
      break;
    case 4:
      var value = /** @type {number} */ (reader.readFloat());
      msg.setScore(value);
      break;
    case 5:
      var value = new google_cloud_vision_v1_geometry_pb.BoundingPoly;
      reader.readMessage(value,google_cloud_vision_v1_geometry_pb.BoundingPoly.deserializeBinaryFromReader);
      msg.setBoundingPoly(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.LocalizedObjectAnnotation.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.LocalizedObjectAnnotation} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMid();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getLanguageCode();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
  f = message.getScore();
  if (f !== 0.0) {
    writer.writeFloat(
      4,
      f
    );
  }
  f = message.getBoundingPoly();
  if (f != null) {
    writer.writeMessage(
      5,
      f,
      google_cloud_vision_v1_geometry_pb.BoundingPoly.serializeBinaryToWriter
    );
  }
};


/**
 * optional string mid = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.prototype.getMid = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.LocalizedObjectAnnotation} returns this
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.prototype.setMid = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string language_code = 2;
 * @return {string}
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.prototype.getLanguageCode = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.LocalizedObjectAnnotation} returns this
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.prototype.setLanguageCode = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string name = 3;
 * @return {string}
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.LocalizedObjectAnnotation} returns this
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional float score = 4;
 * @return {number}
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.prototype.getScore = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 4, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.LocalizedObjectAnnotation} returns this
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.prototype.setScore = function(value) {
  return jspb.Message.setProto3FloatField(this, 4, value);
};


/**
 * optional BoundingPoly bounding_poly = 5;
 * @return {?proto.google.cloud.vision.v1.BoundingPoly}
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.prototype.getBoundingPoly = function() {
  return /** @type{?proto.google.cloud.vision.v1.BoundingPoly} */ (
    jspb.Message.getWrapperField(this, google_cloud_vision_v1_geometry_pb.BoundingPoly, 5));
};


/**
 * @param {?proto.google.cloud.vision.v1.BoundingPoly|undefined} value
 * @return {!proto.google.cloud.vision.v1.LocalizedObjectAnnotation} returns this
*/
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.prototype.setBoundingPoly = function(value) {
  return jspb.Message.setWrapperField(this, 5, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.LocalizedObjectAnnotation} returns this
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.prototype.clearBoundingPoly = function() {
  return this.setBoundingPoly(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.LocalizedObjectAnnotation.prototype.hasBoundingPoly = function() {
  return jspb.Message.getField(this, 5) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.SafeSearchAnnotation.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.SafeSearchAnnotation} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.toObject = function(includeInstance, msg) {
  var f, obj = {
    adult: jspb.Message.getFieldWithDefault(msg, 1, 0),
    spoof: jspb.Message.getFieldWithDefault(msg, 2, 0),
    medical: jspb.Message.getFieldWithDefault(msg, 3, 0),
    violence: jspb.Message.getFieldWithDefault(msg, 4, 0),
    racy: jspb.Message.getFieldWithDefault(msg, 9, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.SafeSearchAnnotation}
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.SafeSearchAnnotation;
  return proto.google.cloud.vision.v1.SafeSearchAnnotation.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.SafeSearchAnnotation} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.SafeSearchAnnotation}
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (reader.readEnum());
      msg.setAdult(value);
      break;
    case 2:
      var value = /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (reader.readEnum());
      msg.setSpoof(value);
      break;
    case 3:
      var value = /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (reader.readEnum());
      msg.setMedical(value);
      break;
    case 4:
      var value = /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (reader.readEnum());
      msg.setViolence(value);
      break;
    case 9:
      var value = /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (reader.readEnum());
      msg.setRacy(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.SafeSearchAnnotation.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.SafeSearchAnnotation} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getAdult();
  if (f !== 0.0) {
    writer.writeEnum(
      1,
      f
    );
  }
  f = message.getSpoof();
  if (f !== 0.0) {
    writer.writeEnum(
      2,
      f
    );
  }
  f = message.getMedical();
  if (f !== 0.0) {
    writer.writeEnum(
      3,
      f
    );
  }
  f = message.getViolence();
  if (f !== 0.0) {
    writer.writeEnum(
      4,
      f
    );
  }
  f = message.getRacy();
  if (f !== 0.0) {
    writer.writeEnum(
      9,
      f
    );
  }
};


/**
 * optional Likelihood adult = 1;
 * @return {!proto.google.cloud.vision.v1.Likelihood}
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.prototype.getAdult = function() {
  return /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (jspb.Message.getFieldWithDefault(this, 1, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.Likelihood} value
 * @return {!proto.google.cloud.vision.v1.SafeSearchAnnotation} returns this
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.prototype.setAdult = function(value) {
  return jspb.Message.setProto3EnumField(this, 1, value);
};


/**
 * optional Likelihood spoof = 2;
 * @return {!proto.google.cloud.vision.v1.Likelihood}
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.prototype.getSpoof = function() {
  return /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.Likelihood} value
 * @return {!proto.google.cloud.vision.v1.SafeSearchAnnotation} returns this
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.prototype.setSpoof = function(value) {
  return jspb.Message.setProto3EnumField(this, 2, value);
};


/**
 * optional Likelihood medical = 3;
 * @return {!proto.google.cloud.vision.v1.Likelihood}
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.prototype.getMedical = function() {
  return /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (jspb.Message.getFieldWithDefault(this, 3, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.Likelihood} value
 * @return {!proto.google.cloud.vision.v1.SafeSearchAnnotation} returns this
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.prototype.setMedical = function(value) {
  return jspb.Message.setProto3EnumField(this, 3, value);
};


/**
 * optional Likelihood violence = 4;
 * @return {!proto.google.cloud.vision.v1.Likelihood}
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.prototype.getViolence = function() {
  return /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (jspb.Message.getFieldWithDefault(this, 4, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.Likelihood} value
 * @return {!proto.google.cloud.vision.v1.SafeSearchAnnotation} returns this
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.prototype.setViolence = function(value) {
  return jspb.Message.setProto3EnumField(this, 4, value);
};


/**
 * optional Likelihood racy = 9;
 * @return {!proto.google.cloud.vision.v1.Likelihood}
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.prototype.getRacy = function() {
  return /** @type {!proto.google.cloud.vision.v1.Likelihood} */ (jspb.Message.getFieldWithDefault(this, 9, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.Likelihood} value
 * @return {!proto.google.cloud.vision.v1.SafeSearchAnnotation} returns this
 */
proto.google.cloud.vision.v1.SafeSearchAnnotation.prototype.setRacy = function(value) {
  return jspb.Message.setProto3EnumField(this, 9, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.LatLongRect.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.LatLongRect.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.LatLongRect} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.LatLongRect.toObject = function(includeInstance, msg) {
  var f, obj = {
    minLatLng: (f = msg.getMinLatLng()) && google_type_latlng_pb.LatLng.toObject(includeInstance, f),
    maxLatLng: (f = msg.getMaxLatLng()) && google_type_latlng_pb.LatLng.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.LatLongRect}
 */
proto.google.cloud.vision.v1.LatLongRect.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.LatLongRect;
  return proto.google.cloud.vision.v1.LatLongRect.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.LatLongRect} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.LatLongRect}
 */
proto.google.cloud.vision.v1.LatLongRect.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new google_type_latlng_pb.LatLng;
      reader.readMessage(value,google_type_latlng_pb.LatLng.deserializeBinaryFromReader);
      msg.setMinLatLng(value);
      break;
    case 2:
      var value = new google_type_latlng_pb.LatLng;
      reader.readMessage(value,google_type_latlng_pb.LatLng.deserializeBinaryFromReader);
      msg.setMaxLatLng(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.LatLongRect.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.LatLongRect.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.LatLongRect} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.LatLongRect.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getMinLatLng();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      google_type_latlng_pb.LatLng.serializeBinaryToWriter
    );
  }
  f = message.getMaxLatLng();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      google_type_latlng_pb.LatLng.serializeBinaryToWriter
    );
  }
};


/**
 * optional google.type.LatLng min_lat_lng = 1;
 * @return {?proto.google.type.LatLng}
 */
proto.google.cloud.vision.v1.LatLongRect.prototype.getMinLatLng = function() {
  return /** @type{?proto.google.type.LatLng} */ (
    jspb.Message.getWrapperField(this, google_type_latlng_pb.LatLng, 1));
};


/**
 * @param {?proto.google.type.LatLng|undefined} value
 * @return {!proto.google.cloud.vision.v1.LatLongRect} returns this
*/
proto.google.cloud.vision.v1.LatLongRect.prototype.setMinLatLng = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.LatLongRect} returns this
 */
proto.google.cloud.vision.v1.LatLongRect.prototype.clearMinLatLng = function() {
  return this.setMinLatLng(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.LatLongRect.prototype.hasMinLatLng = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional google.type.LatLng max_lat_lng = 2;
 * @return {?proto.google.type.LatLng}
 */
proto.google.cloud.vision.v1.LatLongRect.prototype.getMaxLatLng = function() {
  return /** @type{?proto.google.type.LatLng} */ (
    jspb.Message.getWrapperField(this, google_type_latlng_pb.LatLng, 2));
};


/**
 * @param {?proto.google.type.LatLng|undefined} value
 * @return {!proto.google.cloud.vision.v1.LatLongRect} returns this
*/
proto.google.cloud.vision.v1.LatLongRect.prototype.setMaxLatLng = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.LatLongRect} returns this
 */
proto.google.cloud.vision.v1.LatLongRect.prototype.clearMaxLatLng = function() {
  return this.setMaxLatLng(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.LatLongRect.prototype.hasMaxLatLng = function() {
  return jspb.Message.getField(this, 2) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.ColorInfo.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ColorInfo.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ColorInfo} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ColorInfo.toObject = function(includeInstance, msg) {
  var f, obj = {
    color: (f = msg.getColor()) && google_type_color_pb.Color.toObject(includeInstance, f),
    score: jspb.Message.getFloatingPointFieldWithDefault(msg, 2, 0.0),
    pixelFraction: jspb.Message.getFloatingPointFieldWithDefault(msg, 3, 0.0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.ColorInfo}
 */
proto.google.cloud.vision.v1.ColorInfo.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ColorInfo;
  return proto.google.cloud.vision.v1.ColorInfo.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ColorInfo} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ColorInfo}
 */
proto.google.cloud.vision.v1.ColorInfo.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new google_type_color_pb.Color;
      reader.readMessage(value,google_type_color_pb.Color.deserializeBinaryFromReader);
      msg.setColor(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readFloat());
      msg.setScore(value);
      break;
    case 3:
      var value = /** @type {number} */ (reader.readFloat());
      msg.setPixelFraction(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.ColorInfo.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ColorInfo.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ColorInfo} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ColorInfo.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getColor();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      google_type_color_pb.Color.serializeBinaryToWriter
    );
  }
  f = message.getScore();
  if (f !== 0.0) {
    writer.writeFloat(
      2,
      f
    );
  }
  f = message.getPixelFraction();
  if (f !== 0.0) {
    writer.writeFloat(
      3,
      f
    );
  }
};


/**
 * optional google.type.Color color = 1;
 * @return {?proto.google.type.Color}
 */
proto.google.cloud.vision.v1.ColorInfo.prototype.getColor = function() {
  return /** @type{?proto.google.type.Color} */ (
    jspb.Message.getWrapperField(this, google_type_color_pb.Color, 1));
};


/**
 * @param {?proto.google.type.Color|undefined} value
 * @return {!proto.google.cloud.vision.v1.ColorInfo} returns this
*/
proto.google.cloud.vision.v1.ColorInfo.prototype.setColor = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.ColorInfo} returns this
 */
proto.google.cloud.vision.v1.ColorInfo.prototype.clearColor = function() {
  return this.setColor(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.ColorInfo.prototype.hasColor = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional float score = 2;
 * @return {number}
 */
proto.google.cloud.vision.v1.ColorInfo.prototype.getScore = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 2, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.ColorInfo} returns this
 */
proto.google.cloud.vision.v1.ColorInfo.prototype.setScore = function(value) {
  return jspb.Message.setProto3FloatField(this, 2, value);
};


/**
 * optional float pixel_fraction = 3;
 * @return {number}
 */
proto.google.cloud.vision.v1.ColorInfo.prototype.getPixelFraction = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 3, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.ColorInfo} returns this
 */
proto.google.cloud.vision.v1.ColorInfo.prototype.setPixelFraction = function(value) {
  return jspb.Message.setProto3FloatField(this, 3, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.DominantColorsAnnotation.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.DominantColorsAnnotation.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.DominantColorsAnnotation.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.DominantColorsAnnotation} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.DominantColorsAnnotation.toObject = function(includeInstance, msg) {
  var f, obj = {
    colorsList: jspb.Message.toObjectList(msg.getColorsList(),
    proto.google.cloud.vision.v1.ColorInfo.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.DominantColorsAnnotation}
 */
proto.google.cloud.vision.v1.DominantColorsAnnotation.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.DominantColorsAnnotation;
  return proto.google.cloud.vision.v1.DominantColorsAnnotation.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.DominantColorsAnnotation} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.DominantColorsAnnotation}
 */
proto.google.cloud.vision.v1.DominantColorsAnnotation.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.ColorInfo;
      reader.readMessage(value,proto.google.cloud.vision.v1.ColorInfo.deserializeBinaryFromReader);
      msg.addColors(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.DominantColorsAnnotation.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.DominantColorsAnnotation.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.DominantColorsAnnotation} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.DominantColorsAnnotation.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getColorsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.google.cloud.vision.v1.ColorInfo.serializeBinaryToWriter
    );
  }
};


/**
 * repeated ColorInfo colors = 1;
 * @return {!Array<!proto.google.cloud.vision.v1.ColorInfo>}
 */
proto.google.cloud.vision.v1.DominantColorsAnnotation.prototype.getColorsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.ColorInfo>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.ColorInfo, 1));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.ColorInfo>} value
 * @return {!proto.google.cloud.vision.v1.DominantColorsAnnotation} returns this
*/
proto.google.cloud.vision.v1.DominantColorsAnnotation.prototype.setColorsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.ColorInfo=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.ColorInfo}
 */
proto.google.cloud.vision.v1.DominantColorsAnnotation.prototype.addColors = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.google.cloud.vision.v1.ColorInfo, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.DominantColorsAnnotation} returns this
 */
proto.google.cloud.vision.v1.DominantColorsAnnotation.prototype.clearColorsList = function() {
  return this.setColorsList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.ImageProperties.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ImageProperties.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ImageProperties} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImageProperties.toObject = function(includeInstance, msg) {
  var f, obj = {
    dominantColors: (f = msg.getDominantColors()) && proto.google.cloud.vision.v1.DominantColorsAnnotation.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.ImageProperties}
 */
proto.google.cloud.vision.v1.ImageProperties.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ImageProperties;
  return proto.google.cloud.vision.v1.ImageProperties.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ImageProperties} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ImageProperties}
 */
proto.google.cloud.vision.v1.ImageProperties.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.DominantColorsAnnotation;
      reader.readMessage(value,proto.google.cloud.vision.v1.DominantColorsAnnotation.deserializeBinaryFromReader);
      msg.setDominantColors(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.ImageProperties.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ImageProperties.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ImageProperties} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImageProperties.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getDominantColors();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.google.cloud.vision.v1.DominantColorsAnnotation.serializeBinaryToWriter
    );
  }
};


/**
 * optional DominantColorsAnnotation dominant_colors = 1;
 * @return {?proto.google.cloud.vision.v1.DominantColorsAnnotation}
 */
proto.google.cloud.vision.v1.ImageProperties.prototype.getDominantColors = function() {
  return /** @type{?proto.google.cloud.vision.v1.DominantColorsAnnotation} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.DominantColorsAnnotation, 1));
};


/**
 * @param {?proto.google.cloud.vision.v1.DominantColorsAnnotation|undefined} value
 * @return {!proto.google.cloud.vision.v1.ImageProperties} returns this
*/
proto.google.cloud.vision.v1.ImageProperties.prototype.setDominantColors = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.ImageProperties} returns this
 */
proto.google.cloud.vision.v1.ImageProperties.prototype.clearDominantColors = function() {
  return this.setDominantColors(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.ImageProperties.prototype.hasDominantColors = function() {
  return jspb.Message.getField(this, 1) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.CropHint.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.CropHint.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.CropHint} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.CropHint.toObject = function(includeInstance, msg) {
  var f, obj = {
    boundingPoly: (f = msg.getBoundingPoly()) && google_cloud_vision_v1_geometry_pb.BoundingPoly.toObject(includeInstance, f),
    confidence: jspb.Message.getFloatingPointFieldWithDefault(msg, 2, 0.0),
    importanceFraction: jspb.Message.getFloatingPointFieldWithDefault(msg, 3, 0.0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.CropHint}
 */
proto.google.cloud.vision.v1.CropHint.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.CropHint;
  return proto.google.cloud.vision.v1.CropHint.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.CropHint} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.CropHint}
 */
proto.google.cloud.vision.v1.CropHint.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new google_cloud_vision_v1_geometry_pb.BoundingPoly;
      reader.readMessage(value,google_cloud_vision_v1_geometry_pb.BoundingPoly.deserializeBinaryFromReader);
      msg.setBoundingPoly(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readFloat());
      msg.setConfidence(value);
      break;
    case 3:
      var value = /** @type {number} */ (reader.readFloat());
      msg.setImportanceFraction(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.CropHint.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.CropHint.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.CropHint} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.CropHint.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getBoundingPoly();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      google_cloud_vision_v1_geometry_pb.BoundingPoly.serializeBinaryToWriter
    );
  }
  f = message.getConfidence();
  if (f !== 0.0) {
    writer.writeFloat(
      2,
      f
    );
  }
  f = message.getImportanceFraction();
  if (f !== 0.0) {
    writer.writeFloat(
      3,
      f
    );
  }
};


/**
 * optional BoundingPoly bounding_poly = 1;
 * @return {?proto.google.cloud.vision.v1.BoundingPoly}
 */
proto.google.cloud.vision.v1.CropHint.prototype.getBoundingPoly = function() {
  return /** @type{?proto.google.cloud.vision.v1.BoundingPoly} */ (
    jspb.Message.getWrapperField(this, google_cloud_vision_v1_geometry_pb.BoundingPoly, 1));
};


/**
 * @param {?proto.google.cloud.vision.v1.BoundingPoly|undefined} value
 * @return {!proto.google.cloud.vision.v1.CropHint} returns this
*/
proto.google.cloud.vision.v1.CropHint.prototype.setBoundingPoly = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.CropHint} returns this
 */
proto.google.cloud.vision.v1.CropHint.prototype.clearBoundingPoly = function() {
  return this.setBoundingPoly(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.CropHint.prototype.hasBoundingPoly = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional float confidence = 2;
 * @return {number}
 */
proto.google.cloud.vision.v1.CropHint.prototype.getConfidence = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 2, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.CropHint} returns this
 */
proto.google.cloud.vision.v1.CropHint.prototype.setConfidence = function(value) {
  return jspb.Message.setProto3FloatField(this, 2, value);
};


/**
 * optional float importance_fraction = 3;
 * @return {number}
 */
proto.google.cloud.vision.v1.CropHint.prototype.getImportanceFraction = function() {
  return /** @type {number} */ (jspb.Message.getFloatingPointFieldWithDefault(this, 3, 0.0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.CropHint} returns this
 */
proto.google.cloud.vision.v1.CropHint.prototype.setImportanceFraction = function(value) {
  return jspb.Message.setProto3FloatField(this, 3, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.CropHintsAnnotation.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.CropHintsAnnotation.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.CropHintsAnnotation.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.CropHintsAnnotation} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.CropHintsAnnotation.toObject = function(includeInstance, msg) {
  var f, obj = {
    cropHintsList: jspb.Message.toObjectList(msg.getCropHintsList(),
    proto.google.cloud.vision.v1.CropHint.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.CropHintsAnnotation}
 */
proto.google.cloud.vision.v1.CropHintsAnnotation.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.CropHintsAnnotation;
  return proto.google.cloud.vision.v1.CropHintsAnnotation.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.CropHintsAnnotation} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.CropHintsAnnotation}
 */
proto.google.cloud.vision.v1.CropHintsAnnotation.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.CropHint;
      reader.readMessage(value,proto.google.cloud.vision.v1.CropHint.deserializeBinaryFromReader);
      msg.addCropHints(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.CropHintsAnnotation.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.CropHintsAnnotation.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.CropHintsAnnotation} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.CropHintsAnnotation.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getCropHintsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.google.cloud.vision.v1.CropHint.serializeBinaryToWriter
    );
  }
};


/**
 * repeated CropHint crop_hints = 1;
 * @return {!Array<!proto.google.cloud.vision.v1.CropHint>}
 */
proto.google.cloud.vision.v1.CropHintsAnnotation.prototype.getCropHintsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.CropHint>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.CropHint, 1));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.CropHint>} value
 * @return {!proto.google.cloud.vision.v1.CropHintsAnnotation} returns this
*/
proto.google.cloud.vision.v1.CropHintsAnnotation.prototype.setCropHintsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.CropHint=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.CropHint}
 */
proto.google.cloud.vision.v1.CropHintsAnnotation.prototype.addCropHints = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.google.cloud.vision.v1.CropHint, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.CropHintsAnnotation} returns this
 */
proto.google.cloud.vision.v1.CropHintsAnnotation.prototype.clearCropHintsList = function() {
  return this.setCropHintsList([]);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.CropHintsParams.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.CropHintsParams.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.CropHintsParams.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.CropHintsParams} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.CropHintsParams.toObject = function(includeInstance, msg) {
  var f, obj = {
    aspectRatiosList: (f = jspb.Message.getRepeatedFloatingPointField(msg, 1)) == null ? undefined : f
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.CropHintsParams}
 */
proto.google.cloud.vision.v1.CropHintsParams.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.CropHintsParams;
  return proto.google.cloud.vision.v1.CropHintsParams.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.CropHintsParams} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.CropHintsParams}
 */
proto.google.cloud.vision.v1.CropHintsParams.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var values = /** @type {!Array<number>} */ (reader.isDelimited() ? reader.readPackedFloat() : [reader.readFloat()]);
      for (var i = 0; i < values.length; i++) {
        msg.addAspectRatios(values[i]);
      }
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.CropHintsParams.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.CropHintsParams.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.CropHintsParams} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.CropHintsParams.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getAspectRatiosList();
  if (f.length > 0) {
    writer.writePackedFloat(
      1,
      f
    );
  }
};


/**
 * repeated float aspect_ratios = 1;
 * @return {!Array<number>}
 */
proto.google.cloud.vision.v1.CropHintsParams.prototype.getAspectRatiosList = function() {
  return /** @type {!Array<number>} */ (jspb.Message.getRepeatedFloatingPointField(this, 1));
};


/**
 * @param {!Array<number>} value
 * @return {!proto.google.cloud.vision.v1.CropHintsParams} returns this
 */
proto.google.cloud.vision.v1.CropHintsParams.prototype.setAspectRatiosList = function(value) {
  return jspb.Message.setField(this, 1, value || []);
};


/**
 * @param {number} value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.CropHintsParams} returns this
 */
proto.google.cloud.vision.v1.CropHintsParams.prototype.addAspectRatios = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 1, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.CropHintsParams} returns this
 */
proto.google.cloud.vision.v1.CropHintsParams.prototype.clearAspectRatiosList = function() {
  return this.setAspectRatiosList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.WebDetectionParams.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.WebDetectionParams.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.WebDetectionParams} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.WebDetectionParams.toObject = function(includeInstance, msg) {
  var f, obj = {
    includeGeoResults: jspb.Message.getBooleanFieldWithDefault(msg, 2, false)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.WebDetectionParams}
 */
proto.google.cloud.vision.v1.WebDetectionParams.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.WebDetectionParams;
  return proto.google.cloud.vision.v1.WebDetectionParams.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.WebDetectionParams} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.WebDetectionParams}
 */
proto.google.cloud.vision.v1.WebDetectionParams.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 2:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setIncludeGeoResults(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.WebDetectionParams.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.WebDetectionParams.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.WebDetectionParams} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.WebDetectionParams.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getIncludeGeoResults();
  if (f) {
    writer.writeBool(
      2,
      f
    );
  }
};


/**
 * optional bool include_geo_results = 2;
 * @return {boolean}
 */
proto.google.cloud.vision.v1.WebDetectionParams.prototype.getIncludeGeoResults = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 2, false));
};


/**
 * @param {boolean} value
 * @return {!proto.google.cloud.vision.v1.WebDetectionParams} returns this
 */
proto.google.cloud.vision.v1.WebDetectionParams.prototype.setIncludeGeoResults = function(value) {
  return jspb.Message.setProto3BooleanField(this, 2, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.TextDetectionParams.repeatedFields_ = [11];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.TextDetectionParams.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.TextDetectionParams.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.TextDetectionParams} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.TextDetectionParams.toObject = function(includeInstance, msg) {
  var f, obj = {
    enableTextDetectionConfidenceScore: jspb.Message.getBooleanFieldWithDefault(msg, 9, false),
    advancedOcrOptionsList: (f = jspb.Message.getRepeatedField(msg, 11)) == null ? undefined : f
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.TextDetectionParams}
 */
proto.google.cloud.vision.v1.TextDetectionParams.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.TextDetectionParams;
  return proto.google.cloud.vision.v1.TextDetectionParams.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.TextDetectionParams} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.TextDetectionParams}
 */
proto.google.cloud.vision.v1.TextDetectionParams.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 9:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setEnableTextDetectionConfidenceScore(value);
      break;
    case 11:
      var value = /** @type {string} */ (reader.readString());
      msg.addAdvancedOcrOptions(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.TextDetectionParams.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.TextDetectionParams.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.TextDetectionParams} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.TextDetectionParams.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getEnableTextDetectionConfidenceScore();
  if (f) {
    writer.writeBool(
      9,
      f
    );
  }
  f = message.getAdvancedOcrOptionsList();
  if (f.length > 0) {
    writer.writeRepeatedString(
      11,
      f
    );
  }
};


/**
 * optional bool enable_text_detection_confidence_score = 9;
 * @return {boolean}
 */
proto.google.cloud.vision.v1.TextDetectionParams.prototype.getEnableTextDetectionConfidenceScore = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 9, false));
};


/**
 * @param {boolean} value
 * @return {!proto.google.cloud.vision.v1.TextDetectionParams} returns this
 */
proto.google.cloud.vision.v1.TextDetectionParams.prototype.setEnableTextDetectionConfidenceScore = function(value) {
  return jspb.Message.setProto3BooleanField(this, 9, value);
};


/**
 * repeated string advanced_ocr_options = 11;
 * @return {!Array<string>}
 */
proto.google.cloud.vision.v1.TextDetectionParams.prototype.getAdvancedOcrOptionsList = function() {
  return /** @type {!Array<string>} */ (jspb.Message.getRepeatedField(this, 11));
};


/**
 * @param {!Array<string>} value
 * @return {!proto.google.cloud.vision.v1.TextDetectionParams} returns this
 */
proto.google.cloud.vision.v1.TextDetectionParams.prototype.setAdvancedOcrOptionsList = function(value) {
  return jspb.Message.setField(this, 11, value || []);
};


/**
 * @param {string} value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.TextDetectionParams} returns this
 */
proto.google.cloud.vision.v1.TextDetectionParams.prototype.addAdvancedOcrOptions = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 11, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.TextDetectionParams} returns this
 */
proto.google.cloud.vision.v1.TextDetectionParams.prototype.clearAdvancedOcrOptionsList = function() {
  return this.setAdvancedOcrOptionsList([]);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.ImageContext.repeatedFields_ = [2];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.ImageContext.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ImageContext.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ImageContext} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImageContext.toObject = function(includeInstance, msg) {
  var f, obj = {
    latLongRect: (f = msg.getLatLongRect()) && proto.google.cloud.vision.v1.LatLongRect.toObject(includeInstance, f),
    languageHintsList: (f = jspb.Message.getRepeatedField(msg, 2)) == null ? undefined : f,
    cropHintsParams: (f = msg.getCropHintsParams()) && proto.google.cloud.vision.v1.CropHintsParams.toObject(includeInstance, f),
    productSearchParams: (f = msg.getProductSearchParams()) && google_cloud_vision_v1_product_search_pb.ProductSearchParams.toObject(includeInstance, f),
    webDetectionParams: (f = msg.getWebDetectionParams()) && proto.google.cloud.vision.v1.WebDetectionParams.toObject(includeInstance, f),
    textDetectionParams: (f = msg.getTextDetectionParams()) && proto.google.cloud.vision.v1.TextDetectionParams.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.ImageContext}
 */
proto.google.cloud.vision.v1.ImageContext.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ImageContext;
  return proto.google.cloud.vision.v1.ImageContext.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ImageContext} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ImageContext}
 */
proto.google.cloud.vision.v1.ImageContext.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.LatLongRect;
      reader.readMessage(value,proto.google.cloud.vision.v1.LatLongRect.deserializeBinaryFromReader);
      msg.setLatLongRect(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.addLanguageHints(value);
      break;
    case 4:
      var value = new proto.google.cloud.vision.v1.CropHintsParams;
      reader.readMessage(value,proto.google.cloud.vision.v1.CropHintsParams.deserializeBinaryFromReader);
      msg.setCropHintsParams(value);
      break;
    case 5:
      var value = new google_cloud_vision_v1_product_search_pb.ProductSearchParams;
      reader.readMessage(value,google_cloud_vision_v1_product_search_pb.ProductSearchParams.deserializeBinaryFromReader);
      msg.setProductSearchParams(value);
      break;
    case 6:
      var value = new proto.google.cloud.vision.v1.WebDetectionParams;
      reader.readMessage(value,proto.google.cloud.vision.v1.WebDetectionParams.deserializeBinaryFromReader);
      msg.setWebDetectionParams(value);
      break;
    case 12:
      var value = new proto.google.cloud.vision.v1.TextDetectionParams;
      reader.readMessage(value,proto.google.cloud.vision.v1.TextDetectionParams.deserializeBinaryFromReader);
      msg.setTextDetectionParams(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.ImageContext.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ImageContext.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ImageContext} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImageContext.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getLatLongRect();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.google.cloud.vision.v1.LatLongRect.serializeBinaryToWriter
    );
  }
  f = message.getLanguageHintsList();
  if (f.length > 0) {
    writer.writeRepeatedString(
      2,
      f
    );
  }
  f = message.getCropHintsParams();
  if (f != null) {
    writer.writeMessage(
      4,
      f,
      proto.google.cloud.vision.v1.CropHintsParams.serializeBinaryToWriter
    );
  }
  f = message.getProductSearchParams();
  if (f != null) {
    writer.writeMessage(
      5,
      f,
      google_cloud_vision_v1_product_search_pb.ProductSearchParams.serializeBinaryToWriter
    );
  }
  f = message.getWebDetectionParams();
  if (f != null) {
    writer.writeMessage(
      6,
      f,
      proto.google.cloud.vision.v1.WebDetectionParams.serializeBinaryToWriter
    );
  }
  f = message.getTextDetectionParams();
  if (f != null) {
    writer.writeMessage(
      12,
      f,
      proto.google.cloud.vision.v1.TextDetectionParams.serializeBinaryToWriter
    );
  }
};


/**
 * optional LatLongRect lat_long_rect = 1;
 * @return {?proto.google.cloud.vision.v1.LatLongRect}
 */
proto.google.cloud.vision.v1.ImageContext.prototype.getLatLongRect = function() {
  return /** @type{?proto.google.cloud.vision.v1.LatLongRect} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.LatLongRect, 1));
};


/**
 * @param {?proto.google.cloud.vision.v1.LatLongRect|undefined} value
 * @return {!proto.google.cloud.vision.v1.ImageContext} returns this
*/
proto.google.cloud.vision.v1.ImageContext.prototype.setLatLongRect = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.ImageContext} returns this
 */
proto.google.cloud.vision.v1.ImageContext.prototype.clearLatLongRect = function() {
  return this.setLatLongRect(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.ImageContext.prototype.hasLatLongRect = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * repeated string language_hints = 2;
 * @return {!Array<string>}
 */
proto.google.cloud.vision.v1.ImageContext.prototype.getLanguageHintsList = function() {
  return /** @type {!Array<string>} */ (jspb.Message.getRepeatedField(this, 2));
};


/**
 * @param {!Array<string>} value
 * @return {!proto.google.cloud.vision.v1.ImageContext} returns this
 */
proto.google.cloud.vision.v1.ImageContext.prototype.setLanguageHintsList = function(value) {
  return jspb.Message.setField(this, 2, value || []);
};


/**
 * @param {string} value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.ImageContext} returns this
 */
proto.google.cloud.vision.v1.ImageContext.prototype.addLanguageHints = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 2, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.ImageContext} returns this
 */
proto.google.cloud.vision.v1.ImageContext.prototype.clearLanguageHintsList = function() {
  return this.setLanguageHintsList([]);
};


/**
 * optional CropHintsParams crop_hints_params = 4;
 * @return {?proto.google.cloud.vision.v1.CropHintsParams}
 */
proto.google.cloud.vision.v1.ImageContext.prototype.getCropHintsParams = function() {
  return /** @type{?proto.google.cloud.vision.v1.CropHintsParams} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.CropHintsParams, 4));
};


/**
 * @param {?proto.google.cloud.vision.v1.CropHintsParams|undefined} value
 * @return {!proto.google.cloud.vision.v1.ImageContext} returns this
*/
proto.google.cloud.vision.v1.ImageContext.prototype.setCropHintsParams = function(value) {
  return jspb.Message.setWrapperField(this, 4, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.ImageContext} returns this
 */
proto.google.cloud.vision.v1.ImageContext.prototype.clearCropHintsParams = function() {
  return this.setCropHintsParams(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.ImageContext.prototype.hasCropHintsParams = function() {
  return jspb.Message.getField(this, 4) != null;
};


/**
 * optional ProductSearchParams product_search_params = 5;
 * @return {?proto.google.cloud.vision.v1.ProductSearchParams}
 */
proto.google.cloud.vision.v1.ImageContext.prototype.getProductSearchParams = function() {
  return /** @type{?proto.google.cloud.vision.v1.ProductSearchParams} */ (
    jspb.Message.getWrapperField(this, google_cloud_vision_v1_product_search_pb.ProductSearchParams, 5));
};


/**
 * @param {?proto.google.cloud.vision.v1.ProductSearchParams|undefined} value
 * @return {!proto.google.cloud.vision.v1.ImageContext} returns this
*/
proto.google.cloud.vision.v1.ImageContext.prototype.setProductSearchParams = function(value) {
  return jspb.Message.setWrapperField(this, 5, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.ImageContext} returns this
 */
proto.google.cloud.vision.v1.ImageContext.prototype.clearProductSearchParams = function() {
  return this.setProductSearchParams(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.ImageContext.prototype.hasProductSearchParams = function() {
  return jspb.Message.getField(this, 5) != null;
};


/**
 * optional WebDetectionParams web_detection_params = 6;
 * @return {?proto.google.cloud.vision.v1.WebDetectionParams}
 */
proto.google.cloud.vision.v1.ImageContext.prototype.getWebDetectionParams = function() {
  return /** @type{?proto.google.cloud.vision.v1.WebDetectionParams} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.WebDetectionParams, 6));
};


/**
 * @param {?proto.google.cloud.vision.v1.WebDetectionParams|undefined} value
 * @return {!proto.google.cloud.vision.v1.ImageContext} returns this
*/
proto.google.cloud.vision.v1.ImageContext.prototype.setWebDetectionParams = function(value) {
  return jspb.Message.setWrapperField(this, 6, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.ImageContext} returns this
 */
proto.google.cloud.vision.v1.ImageContext.prototype.clearWebDetectionParams = function() {
  return this.setWebDetectionParams(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.ImageContext.prototype.hasWebDetectionParams = function() {
  return jspb.Message.getField(this, 6) != null;
};


/**
 * optional TextDetectionParams text_detection_params = 12;
 * @return {?proto.google.cloud.vision.v1.TextDetectionParams}
 */
proto.google.cloud.vision.v1.ImageContext.prototype.getTextDetectionParams = function() {
  return /** @type{?proto.google.cloud.vision.v1.TextDetectionParams} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.TextDetectionParams, 12));
};


/**
 * @param {?proto.google.cloud.vision.v1.TextDetectionParams|undefined} value
 * @return {!proto.google.cloud.vision.v1.ImageContext} returns this
*/
proto.google.cloud.vision.v1.ImageContext.prototype.setTextDetectionParams = function(value) {
  return jspb.Message.setWrapperField(this, 12, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.ImageContext} returns this
 */
proto.google.cloud.vision.v1.ImageContext.prototype.clearTextDetectionParams = function() {
  return this.setTextDetectionParams(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.ImageContext.prototype.hasTextDetectionParams = function() {
  return jspb.Message.getField(this, 12) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.repeatedFields_ = [2];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.AnnotateImageRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.AnnotateImageRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    image: (f = msg.getImage()) && proto.google.cloud.vision.v1.Image.toObject(includeInstance, f),
    featuresList: jspb.Message.toObjectList(msg.getFeaturesList(),
    proto.google.cloud.vision.v1.Feature.toObject, includeInstance),
    imageContext: (f = msg.getImageContext()) && proto.google.cloud.vision.v1.ImageContext.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageRequest}
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.AnnotateImageRequest;
  return proto.google.cloud.vision.v1.AnnotateImageRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.AnnotateImageRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageRequest}
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.Image;
      reader.readMessage(value,proto.google.cloud.vision.v1.Image.deserializeBinaryFromReader);
      msg.setImage(value);
      break;
    case 2:
      var value = new proto.google.cloud.vision.v1.Feature;
      reader.readMessage(value,proto.google.cloud.vision.v1.Feature.deserializeBinaryFromReader);
      msg.addFeatures(value);
      break;
    case 3:
      var value = new proto.google.cloud.vision.v1.ImageContext;
      reader.readMessage(value,proto.google.cloud.vision.v1.ImageContext.deserializeBinaryFromReader);
      msg.setImageContext(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.AnnotateImageRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.AnnotateImageRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getImage();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.google.cloud.vision.v1.Image.serializeBinaryToWriter
    );
  }
  f = message.getFeaturesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      2,
      f,
      proto.google.cloud.vision.v1.Feature.serializeBinaryToWriter
    );
  }
  f = message.getImageContext();
  if (f != null) {
    writer.writeMessage(
      3,
      f,
      proto.google.cloud.vision.v1.ImageContext.serializeBinaryToWriter
    );
  }
};


/**
 * optional Image image = 1;
 * @return {?proto.google.cloud.vision.v1.Image}
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.prototype.getImage = function() {
  return /** @type{?proto.google.cloud.vision.v1.Image} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.Image, 1));
};


/**
 * @param {?proto.google.cloud.vision.v1.Image|undefined} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageRequest} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageRequest.prototype.setImage = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageRequest} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.prototype.clearImage = function() {
  return this.setImage(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.prototype.hasImage = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * repeated Feature features = 2;
 * @return {!Array<!proto.google.cloud.vision.v1.Feature>}
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.prototype.getFeaturesList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.Feature>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.Feature, 2));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.Feature>} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageRequest} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageRequest.prototype.setFeaturesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 2, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.Feature=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.Feature}
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.prototype.addFeatures = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 2, opt_value, proto.google.cloud.vision.v1.Feature, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageRequest} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.prototype.clearFeaturesList = function() {
  return this.setFeaturesList([]);
};


/**
 * optional ImageContext image_context = 3;
 * @return {?proto.google.cloud.vision.v1.ImageContext}
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.prototype.getImageContext = function() {
  return /** @type{?proto.google.cloud.vision.v1.ImageContext} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.ImageContext, 3));
};


/**
 * @param {?proto.google.cloud.vision.v1.ImageContext|undefined} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageRequest} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageRequest.prototype.setImageContext = function(value) {
  return jspb.Message.setWrapperField(this, 3, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageRequest} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.prototype.clearImageContext = function() {
  return this.setImageContext(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AnnotateImageRequest.prototype.hasImageContext = function() {
  return jspb.Message.getField(this, 3) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.ImageAnnotationContext.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ImageAnnotationContext.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ImageAnnotationContext} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImageAnnotationContext.toObject = function(includeInstance, msg) {
  var f, obj = {
    uri: jspb.Message.getFieldWithDefault(msg, 1, ""),
    pageNumber: jspb.Message.getFieldWithDefault(msg, 2, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.ImageAnnotationContext}
 */
proto.google.cloud.vision.v1.ImageAnnotationContext.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ImageAnnotationContext;
  return proto.google.cloud.vision.v1.ImageAnnotationContext.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ImageAnnotationContext} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ImageAnnotationContext}
 */
proto.google.cloud.vision.v1.ImageAnnotationContext.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setUri(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt32());
      msg.setPageNumber(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.ImageAnnotationContext.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ImageAnnotationContext.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ImageAnnotationContext} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImageAnnotationContext.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getUri();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getPageNumber();
  if (f !== 0) {
    writer.writeInt32(
      2,
      f
    );
  }
};


/**
 * optional string uri = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.ImageAnnotationContext.prototype.getUri = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ImageAnnotationContext} returns this
 */
proto.google.cloud.vision.v1.ImageAnnotationContext.prototype.setUri = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int32 page_number = 2;
 * @return {number}
 */
proto.google.cloud.vision.v1.ImageAnnotationContext.prototype.getPageNumber = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.ImageAnnotationContext} returns this
 */
proto.google.cloud.vision.v1.ImageAnnotationContext.prototype.setPageNumber = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.repeatedFields_ = [1,2,3,4,22,5];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.AnnotateImageResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.AnnotateImageResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    faceAnnotationsList: jspb.Message.toObjectList(msg.getFaceAnnotationsList(),
    proto.google.cloud.vision.v1.FaceAnnotation.toObject, includeInstance),
    landmarkAnnotationsList: jspb.Message.toObjectList(msg.getLandmarkAnnotationsList(),
    proto.google.cloud.vision.v1.EntityAnnotation.toObject, includeInstance),
    logoAnnotationsList: jspb.Message.toObjectList(msg.getLogoAnnotationsList(),
    proto.google.cloud.vision.v1.EntityAnnotation.toObject, includeInstance),
    labelAnnotationsList: jspb.Message.toObjectList(msg.getLabelAnnotationsList(),
    proto.google.cloud.vision.v1.EntityAnnotation.toObject, includeInstance),
    localizedObjectAnnotationsList: jspb.Message.toObjectList(msg.getLocalizedObjectAnnotationsList(),
    proto.google.cloud.vision.v1.LocalizedObjectAnnotation.toObject, includeInstance),
    textAnnotationsList: jspb.Message.toObjectList(msg.getTextAnnotationsList(),
    proto.google.cloud.vision.v1.EntityAnnotation.toObject, includeInstance),
    fullTextAnnotation: (f = msg.getFullTextAnnotation()) && google_cloud_vision_v1_text_annotation_pb.TextAnnotation.toObject(includeInstance, f),
    safeSearchAnnotation: (f = msg.getSafeSearchAnnotation()) && proto.google.cloud.vision.v1.SafeSearchAnnotation.toObject(includeInstance, f),
    imagePropertiesAnnotation: (f = msg.getImagePropertiesAnnotation()) && proto.google.cloud.vision.v1.ImageProperties.toObject(includeInstance, f),
    cropHintsAnnotation: (f = msg.getCropHintsAnnotation()) && proto.google.cloud.vision.v1.CropHintsAnnotation.toObject(includeInstance, f),
    webDetection: (f = msg.getWebDetection()) && google_cloud_vision_v1_web_detection_pb.WebDetection.toObject(includeInstance, f),
    productSearchResults: (f = msg.getProductSearchResults()) && google_cloud_vision_v1_product_search_pb.ProductSearchResults.toObject(includeInstance, f),
    error: (f = msg.getError()) && google_rpc_status_pb.Status.toObject(includeInstance, f),
    context: (f = msg.getContext()) && proto.google.cloud.vision.v1.ImageAnnotationContext.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.AnnotateImageResponse;
  return proto.google.cloud.vision.v1.AnnotateImageResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.AnnotateImageResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.FaceAnnotation;
      reader.readMessage(value,proto.google.cloud.vision.v1.FaceAnnotation.deserializeBinaryFromReader);
      msg.addFaceAnnotations(value);
      break;
    case 2:
      var value = new proto.google.cloud.vision.v1.EntityAnnotation;
      reader.readMessage(value,proto.google.cloud.vision.v1.EntityAnnotation.deserializeBinaryFromReader);
      msg.addLandmarkAnnotations(value);
      break;
    case 3:
      var value = new proto.google.cloud.vision.v1.EntityAnnotation;
      reader.readMessage(value,proto.google.cloud.vision.v1.EntityAnnotation.deserializeBinaryFromReader);
      msg.addLogoAnnotations(value);
      break;
    case 4:
      var value = new proto.google.cloud.vision.v1.EntityAnnotation;
      reader.readMessage(value,proto.google.cloud.vision.v1.EntityAnnotation.deserializeBinaryFromReader);
      msg.addLabelAnnotations(value);
      break;
    case 22:
      var value = new proto.google.cloud.vision.v1.LocalizedObjectAnnotation;
      reader.readMessage(value,proto.google.cloud.vision.v1.LocalizedObjectAnnotation.deserializeBinaryFromReader);
      msg.addLocalizedObjectAnnotations(value);
      break;
    case 5:
      var value = new proto.google.cloud.vision.v1.EntityAnnotation;
      reader.readMessage(value,proto.google.cloud.vision.v1.EntityAnnotation.deserializeBinaryFromReader);
      msg.addTextAnnotations(value);
      break;
    case 12:
      var value = new google_cloud_vision_v1_text_annotation_pb.TextAnnotation;
      reader.readMessage(value,google_cloud_vision_v1_text_annotation_pb.TextAnnotation.deserializeBinaryFromReader);
      msg.setFullTextAnnotation(value);
      break;
    case 6:
      var value = new proto.google.cloud.vision.v1.SafeSearchAnnotation;
      reader.readMessage(value,proto.google.cloud.vision.v1.SafeSearchAnnotation.deserializeBinaryFromReader);
      msg.setSafeSearchAnnotation(value);
      break;
    case 8:
      var value = new proto.google.cloud.vision.v1.ImageProperties;
      reader.readMessage(value,proto.google.cloud.vision.v1.ImageProperties.deserializeBinaryFromReader);
      msg.setImagePropertiesAnnotation(value);
      break;
    case 11:
      var value = new proto.google.cloud.vision.v1.CropHintsAnnotation;
      reader.readMessage(value,proto.google.cloud.vision.v1.CropHintsAnnotation.deserializeBinaryFromReader);
      msg.setCropHintsAnnotation(value);
      break;
    case 13:
      var value = new google_cloud_vision_v1_web_detection_pb.WebDetection;
      reader.readMessage(value,google_cloud_vision_v1_web_detection_pb.WebDetection.deserializeBinaryFromReader);
      msg.setWebDetection(value);
      break;
    case 14:
      var value = new google_cloud_vision_v1_product_search_pb.ProductSearchResults;
      reader.readMessage(value,google_cloud_vision_v1_product_search_pb.ProductSearchResults.deserializeBinaryFromReader);
      msg.setProductSearchResults(value);
      break;
    case 9:
      var value = new google_rpc_status_pb.Status;
      reader.readMessage(value,google_rpc_status_pb.Status.deserializeBinaryFromReader);
      msg.setError(value);
      break;
    case 21:
      var value = new proto.google.cloud.vision.v1.ImageAnnotationContext;
      reader.readMessage(value,proto.google.cloud.vision.v1.ImageAnnotationContext.deserializeBinaryFromReader);
      msg.setContext(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.AnnotateImageResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.AnnotateImageResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getFaceAnnotationsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.google.cloud.vision.v1.FaceAnnotation.serializeBinaryToWriter
    );
  }
  f = message.getLandmarkAnnotationsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      2,
      f,
      proto.google.cloud.vision.v1.EntityAnnotation.serializeBinaryToWriter
    );
  }
  f = message.getLogoAnnotationsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      3,
      f,
      proto.google.cloud.vision.v1.EntityAnnotation.serializeBinaryToWriter
    );
  }
  f = message.getLabelAnnotationsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      4,
      f,
      proto.google.cloud.vision.v1.EntityAnnotation.serializeBinaryToWriter
    );
  }
  f = message.getLocalizedObjectAnnotationsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      22,
      f,
      proto.google.cloud.vision.v1.LocalizedObjectAnnotation.serializeBinaryToWriter
    );
  }
  f = message.getTextAnnotationsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      5,
      f,
      proto.google.cloud.vision.v1.EntityAnnotation.serializeBinaryToWriter
    );
  }
  f = message.getFullTextAnnotation();
  if (f != null) {
    writer.writeMessage(
      12,
      f,
      google_cloud_vision_v1_text_annotation_pb.TextAnnotation.serializeBinaryToWriter
    );
  }
  f = message.getSafeSearchAnnotation();
  if (f != null) {
    writer.writeMessage(
      6,
      f,
      proto.google.cloud.vision.v1.SafeSearchAnnotation.serializeBinaryToWriter
    );
  }
  f = message.getImagePropertiesAnnotation();
  if (f != null) {
    writer.writeMessage(
      8,
      f,
      proto.google.cloud.vision.v1.ImageProperties.serializeBinaryToWriter
    );
  }
  f = message.getCropHintsAnnotation();
  if (f != null) {
    writer.writeMessage(
      11,
      f,
      proto.google.cloud.vision.v1.CropHintsAnnotation.serializeBinaryToWriter
    );
  }
  f = message.getWebDetection();
  if (f != null) {
    writer.writeMessage(
      13,
      f,
      google_cloud_vision_v1_web_detection_pb.WebDetection.serializeBinaryToWriter
    );
  }
  f = message.getProductSearchResults();
  if (f != null) {
    writer.writeMessage(
      14,
      f,
      google_cloud_vision_v1_product_search_pb.ProductSearchResults.serializeBinaryToWriter
    );
  }
  f = message.getError();
  if (f != null) {
    writer.writeMessage(
      9,
      f,
      google_rpc_status_pb.Status.serializeBinaryToWriter
    );
  }
  f = message.getContext();
  if (f != null) {
    writer.writeMessage(
      21,
      f,
      proto.google.cloud.vision.v1.ImageAnnotationContext.serializeBinaryToWriter
    );
  }
};


/**
 * repeated FaceAnnotation face_annotations = 1;
 * @return {!Array<!proto.google.cloud.vision.v1.FaceAnnotation>}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.getFaceAnnotationsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.FaceAnnotation>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.FaceAnnotation, 1));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.FaceAnnotation>} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.setFaceAnnotationsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.FaceAnnotation=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.FaceAnnotation}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.addFaceAnnotations = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.google.cloud.vision.v1.FaceAnnotation, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.clearFaceAnnotationsList = function() {
  return this.setFaceAnnotationsList([]);
};


/**
 * repeated EntityAnnotation landmark_annotations = 2;
 * @return {!Array<!proto.google.cloud.vision.v1.EntityAnnotation>}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.getLandmarkAnnotationsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.EntityAnnotation>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.EntityAnnotation, 2));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.EntityAnnotation>} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.setLandmarkAnnotationsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 2, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.EntityAnnotation=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.addLandmarkAnnotations = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 2, opt_value, proto.google.cloud.vision.v1.EntityAnnotation, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.clearLandmarkAnnotationsList = function() {
  return this.setLandmarkAnnotationsList([]);
};


/**
 * repeated EntityAnnotation logo_annotations = 3;
 * @return {!Array<!proto.google.cloud.vision.v1.EntityAnnotation>}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.getLogoAnnotationsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.EntityAnnotation>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.EntityAnnotation, 3));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.EntityAnnotation>} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.setLogoAnnotationsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 3, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.EntityAnnotation=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.addLogoAnnotations = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 3, opt_value, proto.google.cloud.vision.v1.EntityAnnotation, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.clearLogoAnnotationsList = function() {
  return this.setLogoAnnotationsList([]);
};


/**
 * repeated EntityAnnotation label_annotations = 4;
 * @return {!Array<!proto.google.cloud.vision.v1.EntityAnnotation>}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.getLabelAnnotationsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.EntityAnnotation>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.EntityAnnotation, 4));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.EntityAnnotation>} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.setLabelAnnotationsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 4, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.EntityAnnotation=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.addLabelAnnotations = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 4, opt_value, proto.google.cloud.vision.v1.EntityAnnotation, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.clearLabelAnnotationsList = function() {
  return this.setLabelAnnotationsList([]);
};


/**
 * repeated LocalizedObjectAnnotation localized_object_annotations = 22;
 * @return {!Array<!proto.google.cloud.vision.v1.LocalizedObjectAnnotation>}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.getLocalizedObjectAnnotationsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.LocalizedObjectAnnotation>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.LocalizedObjectAnnotation, 22));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.LocalizedObjectAnnotation>} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.setLocalizedObjectAnnotationsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 22, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.LocalizedObjectAnnotation=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.LocalizedObjectAnnotation}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.addLocalizedObjectAnnotations = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 22, opt_value, proto.google.cloud.vision.v1.LocalizedObjectAnnotation, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.clearLocalizedObjectAnnotationsList = function() {
  return this.setLocalizedObjectAnnotationsList([]);
};


/**
 * repeated EntityAnnotation text_annotations = 5;
 * @return {!Array<!proto.google.cloud.vision.v1.EntityAnnotation>}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.getTextAnnotationsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.EntityAnnotation>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.EntityAnnotation, 5));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.EntityAnnotation>} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.setTextAnnotationsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 5, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.EntityAnnotation=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.EntityAnnotation}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.addTextAnnotations = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 5, opt_value, proto.google.cloud.vision.v1.EntityAnnotation, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.clearTextAnnotationsList = function() {
  return this.setTextAnnotationsList([]);
};


/**
 * optional TextAnnotation full_text_annotation = 12;
 * @return {?proto.google.cloud.vision.v1.TextAnnotation}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.getFullTextAnnotation = function() {
  return /** @type{?proto.google.cloud.vision.v1.TextAnnotation} */ (
    jspb.Message.getWrapperField(this, google_cloud_vision_v1_text_annotation_pb.TextAnnotation, 12));
};


/**
 * @param {?proto.google.cloud.vision.v1.TextAnnotation|undefined} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.setFullTextAnnotation = function(value) {
  return jspb.Message.setWrapperField(this, 12, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.clearFullTextAnnotation = function() {
  return this.setFullTextAnnotation(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.hasFullTextAnnotation = function() {
  return jspb.Message.getField(this, 12) != null;
};


/**
 * optional SafeSearchAnnotation safe_search_annotation = 6;
 * @return {?proto.google.cloud.vision.v1.SafeSearchAnnotation}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.getSafeSearchAnnotation = function() {
  return /** @type{?proto.google.cloud.vision.v1.SafeSearchAnnotation} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.SafeSearchAnnotation, 6));
};


/**
 * @param {?proto.google.cloud.vision.v1.SafeSearchAnnotation|undefined} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.setSafeSearchAnnotation = function(value) {
  return jspb.Message.setWrapperField(this, 6, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.clearSafeSearchAnnotation = function() {
  return this.setSafeSearchAnnotation(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.hasSafeSearchAnnotation = function() {
  return jspb.Message.getField(this, 6) != null;
};


/**
 * optional ImageProperties image_properties_annotation = 8;
 * @return {?proto.google.cloud.vision.v1.ImageProperties}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.getImagePropertiesAnnotation = function() {
  return /** @type{?proto.google.cloud.vision.v1.ImageProperties} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.ImageProperties, 8));
};


/**
 * @param {?proto.google.cloud.vision.v1.ImageProperties|undefined} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.setImagePropertiesAnnotation = function(value) {
  return jspb.Message.setWrapperField(this, 8, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.clearImagePropertiesAnnotation = function() {
  return this.setImagePropertiesAnnotation(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.hasImagePropertiesAnnotation = function() {
  return jspb.Message.getField(this, 8) != null;
};


/**
 * optional CropHintsAnnotation crop_hints_annotation = 11;
 * @return {?proto.google.cloud.vision.v1.CropHintsAnnotation}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.getCropHintsAnnotation = function() {
  return /** @type{?proto.google.cloud.vision.v1.CropHintsAnnotation} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.CropHintsAnnotation, 11));
};


/**
 * @param {?proto.google.cloud.vision.v1.CropHintsAnnotation|undefined} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.setCropHintsAnnotation = function(value) {
  return jspb.Message.setWrapperField(this, 11, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.clearCropHintsAnnotation = function() {
  return this.setCropHintsAnnotation(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.hasCropHintsAnnotation = function() {
  return jspb.Message.getField(this, 11) != null;
};


/**
 * optional WebDetection web_detection = 13;
 * @return {?proto.google.cloud.vision.v1.WebDetection}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.getWebDetection = function() {
  return /** @type{?proto.google.cloud.vision.v1.WebDetection} */ (
    jspb.Message.getWrapperField(this, google_cloud_vision_v1_web_detection_pb.WebDetection, 13));
};


/**
 * @param {?proto.google.cloud.vision.v1.WebDetection|undefined} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.setWebDetection = function(value) {
  return jspb.Message.setWrapperField(this, 13, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.clearWebDetection = function() {
  return this.setWebDetection(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.hasWebDetection = function() {
  return jspb.Message.getField(this, 13) != null;
};


/**
 * optional ProductSearchResults product_search_results = 14;
 * @return {?proto.google.cloud.vision.v1.ProductSearchResults}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.getProductSearchResults = function() {
  return /** @type{?proto.google.cloud.vision.v1.ProductSearchResults} */ (
    jspb.Message.getWrapperField(this, google_cloud_vision_v1_product_search_pb.ProductSearchResults, 14));
};


/**
 * @param {?proto.google.cloud.vision.v1.ProductSearchResults|undefined} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.setProductSearchResults = function(value) {
  return jspb.Message.setWrapperField(this, 14, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.clearProductSearchResults = function() {
  return this.setProductSearchResults(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.hasProductSearchResults = function() {
  return jspb.Message.getField(this, 14) != null;
};


/**
 * optional google.rpc.Status error = 9;
 * @return {?proto.google.rpc.Status}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.getError = function() {
  return /** @type{?proto.google.rpc.Status} */ (
    jspb.Message.getWrapperField(this, google_rpc_status_pb.Status, 9));
};


/**
 * @param {?proto.google.rpc.Status|undefined} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.setError = function(value) {
  return jspb.Message.setWrapperField(this, 9, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.clearError = function() {
  return this.setError(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.hasError = function() {
  return jspb.Message.getField(this, 9) != null;
};


/**
 * optional ImageAnnotationContext context = 21;
 * @return {?proto.google.cloud.vision.v1.ImageAnnotationContext}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.getContext = function() {
  return /** @type{?proto.google.cloud.vision.v1.ImageAnnotationContext} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.ImageAnnotationContext, 21));
};


/**
 * @param {?proto.google.cloud.vision.v1.ImageAnnotationContext|undefined} value
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.setContext = function(value) {
  return jspb.Message.setWrapperField(this, 21, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.clearContext = function() {
  return this.setContext(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AnnotateImageResponse.prototype.hasContext = function() {
  return jspb.Message.getField(this, 21) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.BatchAnnotateImagesRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    requestsList: jspb.Message.toObjectList(msg.getRequestsList(),
    proto.google.cloud.vision.v1.AnnotateImageRequest.toObject, includeInstance),
    parent: jspb.Message.getFieldWithDefault(msg, 4, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateImagesRequest}
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.BatchAnnotateImagesRequest;
  return proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.BatchAnnotateImagesRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateImagesRequest}
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.AnnotateImageRequest;
      reader.readMessage(value,proto.google.cloud.vision.v1.AnnotateImageRequest.deserializeBinaryFromReader);
      msg.addRequests(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setParent(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.BatchAnnotateImagesRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getRequestsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.google.cloud.vision.v1.AnnotateImageRequest.serializeBinaryToWriter
    );
  }
  f = message.getParent();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
};


/**
 * repeated AnnotateImageRequest requests = 1;
 * @return {!Array<!proto.google.cloud.vision.v1.AnnotateImageRequest>}
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.prototype.getRequestsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.AnnotateImageRequest>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.AnnotateImageRequest, 1));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.AnnotateImageRequest>} value
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateImagesRequest} returns this
*/
proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.prototype.setRequestsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.AnnotateImageRequest=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.AnnotateImageRequest}
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.prototype.addRequests = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.google.cloud.vision.v1.AnnotateImageRequest, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateImagesRequest} returns this
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.prototype.clearRequestsList = function() {
  return this.setRequestsList([]);
};


/**
 * optional string parent = 4;
 * @return {string}
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.prototype.getParent = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateImagesRequest} returns this
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesRequest.prototype.setParent = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.BatchAnnotateImagesResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    responsesList: jspb.Message.toObjectList(msg.getResponsesList(),
    proto.google.cloud.vision.v1.AnnotateImageResponse.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateImagesResponse}
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.BatchAnnotateImagesResponse;
  return proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.BatchAnnotateImagesResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateImagesResponse}
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.AnnotateImageResponse;
      reader.readMessage(value,proto.google.cloud.vision.v1.AnnotateImageResponse.deserializeBinaryFromReader);
      msg.addResponses(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.BatchAnnotateImagesResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getResponsesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.google.cloud.vision.v1.AnnotateImageResponse.serializeBinaryToWriter
    );
  }
};


/**
 * repeated AnnotateImageResponse responses = 1;
 * @return {!Array<!proto.google.cloud.vision.v1.AnnotateImageResponse>}
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.prototype.getResponsesList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.AnnotateImageResponse>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.AnnotateImageResponse, 1));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.AnnotateImageResponse>} value
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateImagesResponse} returns this
*/
proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.prototype.setResponsesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.AnnotateImageResponse=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse}
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.prototype.addResponses = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.google.cloud.vision.v1.AnnotateImageResponse, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateImagesResponse} returns this
 */
proto.google.cloud.vision.v1.BatchAnnotateImagesResponse.prototype.clearResponsesList = function() {
  return this.setResponsesList([]);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.repeatedFields_ = [2,4];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.AnnotateFileRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.AnnotateFileRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    inputConfig: (f = msg.getInputConfig()) && proto.google.cloud.vision.v1.InputConfig.toObject(includeInstance, f),
    featuresList: jspb.Message.toObjectList(msg.getFeaturesList(),
    proto.google.cloud.vision.v1.Feature.toObject, includeInstance),
    imageContext: (f = msg.getImageContext()) && proto.google.cloud.vision.v1.ImageContext.toObject(includeInstance, f),
    pagesList: (f = jspb.Message.getRepeatedField(msg, 4)) == null ? undefined : f
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.AnnotateFileRequest}
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.AnnotateFileRequest;
  return proto.google.cloud.vision.v1.AnnotateFileRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.AnnotateFileRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.AnnotateFileRequest}
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.InputConfig;
      reader.readMessage(value,proto.google.cloud.vision.v1.InputConfig.deserializeBinaryFromReader);
      msg.setInputConfig(value);
      break;
    case 2:
      var value = new proto.google.cloud.vision.v1.Feature;
      reader.readMessage(value,proto.google.cloud.vision.v1.Feature.deserializeBinaryFromReader);
      msg.addFeatures(value);
      break;
    case 3:
      var value = new proto.google.cloud.vision.v1.ImageContext;
      reader.readMessage(value,proto.google.cloud.vision.v1.ImageContext.deserializeBinaryFromReader);
      msg.setImageContext(value);
      break;
    case 4:
      var values = /** @type {!Array<number>} */ (reader.isDelimited() ? reader.readPackedInt32() : [reader.readInt32()]);
      for (var i = 0; i < values.length; i++) {
        msg.addPages(values[i]);
      }
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.AnnotateFileRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.AnnotateFileRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getInputConfig();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.google.cloud.vision.v1.InputConfig.serializeBinaryToWriter
    );
  }
  f = message.getFeaturesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      2,
      f,
      proto.google.cloud.vision.v1.Feature.serializeBinaryToWriter
    );
  }
  f = message.getImageContext();
  if (f != null) {
    writer.writeMessage(
      3,
      f,
      proto.google.cloud.vision.v1.ImageContext.serializeBinaryToWriter
    );
  }
  f = message.getPagesList();
  if (f.length > 0) {
    writer.writePackedInt32(
      4,
      f
    );
  }
};


/**
 * optional InputConfig input_config = 1;
 * @return {?proto.google.cloud.vision.v1.InputConfig}
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.getInputConfig = function() {
  return /** @type{?proto.google.cloud.vision.v1.InputConfig} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.InputConfig, 1));
};


/**
 * @param {?proto.google.cloud.vision.v1.InputConfig|undefined} value
 * @return {!proto.google.cloud.vision.v1.AnnotateFileRequest} returns this
*/
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.setInputConfig = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AnnotateFileRequest} returns this
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.clearInputConfig = function() {
  return this.setInputConfig(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.hasInputConfig = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * repeated Feature features = 2;
 * @return {!Array<!proto.google.cloud.vision.v1.Feature>}
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.getFeaturesList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.Feature>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.Feature, 2));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.Feature>} value
 * @return {!proto.google.cloud.vision.v1.AnnotateFileRequest} returns this
*/
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.setFeaturesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 2, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.Feature=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.Feature}
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.addFeatures = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 2, opt_value, proto.google.cloud.vision.v1.Feature, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.AnnotateFileRequest} returns this
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.clearFeaturesList = function() {
  return this.setFeaturesList([]);
};


/**
 * optional ImageContext image_context = 3;
 * @return {?proto.google.cloud.vision.v1.ImageContext}
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.getImageContext = function() {
  return /** @type{?proto.google.cloud.vision.v1.ImageContext} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.ImageContext, 3));
};


/**
 * @param {?proto.google.cloud.vision.v1.ImageContext|undefined} value
 * @return {!proto.google.cloud.vision.v1.AnnotateFileRequest} returns this
*/
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.setImageContext = function(value) {
  return jspb.Message.setWrapperField(this, 3, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AnnotateFileRequest} returns this
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.clearImageContext = function() {
  return this.setImageContext(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.hasImageContext = function() {
  return jspb.Message.getField(this, 3) != null;
};


/**
 * repeated int32 pages = 4;
 * @return {!Array<number>}
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.getPagesList = function() {
  return /** @type {!Array<number>} */ (jspb.Message.getRepeatedField(this, 4));
};


/**
 * @param {!Array<number>} value
 * @return {!proto.google.cloud.vision.v1.AnnotateFileRequest} returns this
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.setPagesList = function(value) {
  return jspb.Message.setField(this, 4, value || []);
};


/**
 * @param {number} value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.AnnotateFileRequest} returns this
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.addPages = function(value, opt_index) {
  return jspb.Message.addToRepeatedField(this, 4, value, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.AnnotateFileRequest} returns this
 */
proto.google.cloud.vision.v1.AnnotateFileRequest.prototype.clearPagesList = function() {
  return this.setPagesList([]);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.repeatedFields_ = [2];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.AnnotateFileResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.AnnotateFileResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    inputConfig: (f = msg.getInputConfig()) && proto.google.cloud.vision.v1.InputConfig.toObject(includeInstance, f),
    responsesList: jspb.Message.toObjectList(msg.getResponsesList(),
    proto.google.cloud.vision.v1.AnnotateImageResponse.toObject, includeInstance),
    totalPages: jspb.Message.getFieldWithDefault(msg, 3, 0),
    error: (f = msg.getError()) && google_rpc_status_pb.Status.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.AnnotateFileResponse}
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.AnnotateFileResponse;
  return proto.google.cloud.vision.v1.AnnotateFileResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.AnnotateFileResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.AnnotateFileResponse}
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.InputConfig;
      reader.readMessage(value,proto.google.cloud.vision.v1.InputConfig.deserializeBinaryFromReader);
      msg.setInputConfig(value);
      break;
    case 2:
      var value = new proto.google.cloud.vision.v1.AnnotateImageResponse;
      reader.readMessage(value,proto.google.cloud.vision.v1.AnnotateImageResponse.deserializeBinaryFromReader);
      msg.addResponses(value);
      break;
    case 3:
      var value = /** @type {number} */ (reader.readInt32());
      msg.setTotalPages(value);
      break;
    case 4:
      var value = new google_rpc_status_pb.Status;
      reader.readMessage(value,google_rpc_status_pb.Status.deserializeBinaryFromReader);
      msg.setError(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.AnnotateFileResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.AnnotateFileResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getInputConfig();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.google.cloud.vision.v1.InputConfig.serializeBinaryToWriter
    );
  }
  f = message.getResponsesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      2,
      f,
      proto.google.cloud.vision.v1.AnnotateImageResponse.serializeBinaryToWriter
    );
  }
  f = message.getTotalPages();
  if (f !== 0) {
    writer.writeInt32(
      3,
      f
    );
  }
  f = message.getError();
  if (f != null) {
    writer.writeMessage(
      4,
      f,
      google_rpc_status_pb.Status.serializeBinaryToWriter
    );
  }
};


/**
 * optional InputConfig input_config = 1;
 * @return {?proto.google.cloud.vision.v1.InputConfig}
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.getInputConfig = function() {
  return /** @type{?proto.google.cloud.vision.v1.InputConfig} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.InputConfig, 1));
};


/**
 * @param {?proto.google.cloud.vision.v1.InputConfig|undefined} value
 * @return {!proto.google.cloud.vision.v1.AnnotateFileResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.setInputConfig = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AnnotateFileResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.clearInputConfig = function() {
  return this.setInputConfig(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.hasInputConfig = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * repeated AnnotateImageResponse responses = 2;
 * @return {!Array<!proto.google.cloud.vision.v1.AnnotateImageResponse>}
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.getResponsesList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.AnnotateImageResponse>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.AnnotateImageResponse, 2));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.AnnotateImageResponse>} value
 * @return {!proto.google.cloud.vision.v1.AnnotateFileResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.setResponsesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 2, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.AnnotateImageResponse=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.AnnotateImageResponse}
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.addResponses = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 2, opt_value, proto.google.cloud.vision.v1.AnnotateImageResponse, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.AnnotateFileResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.clearResponsesList = function() {
  return this.setResponsesList([]);
};


/**
 * optional int32 total_pages = 3;
 * @return {number}
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.getTotalPages = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 3, 0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.AnnotateFileResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.setTotalPages = function(value) {
  return jspb.Message.setProto3IntField(this, 3, value);
};


/**
 * optional google.rpc.Status error = 4;
 * @return {?proto.google.rpc.Status}
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.getError = function() {
  return /** @type{?proto.google.rpc.Status} */ (
    jspb.Message.getWrapperField(this, google_rpc_status_pb.Status, 4));
};


/**
 * @param {?proto.google.rpc.Status|undefined} value
 * @return {!proto.google.cloud.vision.v1.AnnotateFileResponse} returns this
*/
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.setError = function(value) {
  return jspb.Message.setWrapperField(this, 4, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AnnotateFileResponse} returns this
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.clearError = function() {
  return this.setError(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AnnotateFileResponse.prototype.hasError = function() {
  return jspb.Message.getField(this, 4) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.BatchAnnotateFilesRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    requestsList: jspb.Message.toObjectList(msg.getRequestsList(),
    proto.google.cloud.vision.v1.AnnotateFileRequest.toObject, includeInstance),
    parent: jspb.Message.getFieldWithDefault(msg, 3, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateFilesRequest}
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.BatchAnnotateFilesRequest;
  return proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.BatchAnnotateFilesRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateFilesRequest}
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.AnnotateFileRequest;
      reader.readMessage(value,proto.google.cloud.vision.v1.AnnotateFileRequest.deserializeBinaryFromReader);
      msg.addRequests(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setParent(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.BatchAnnotateFilesRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getRequestsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.google.cloud.vision.v1.AnnotateFileRequest.serializeBinaryToWriter
    );
  }
  f = message.getParent();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
};


/**
 * repeated AnnotateFileRequest requests = 1;
 * @return {!Array<!proto.google.cloud.vision.v1.AnnotateFileRequest>}
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.prototype.getRequestsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.AnnotateFileRequest>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.AnnotateFileRequest, 1));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.AnnotateFileRequest>} value
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateFilesRequest} returns this
*/
proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.prototype.setRequestsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.AnnotateFileRequest=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.AnnotateFileRequest}
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.prototype.addRequests = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.google.cloud.vision.v1.AnnotateFileRequest, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateFilesRequest} returns this
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.prototype.clearRequestsList = function() {
  return this.setRequestsList([]);
};


/**
 * optional string parent = 3;
 * @return {string}
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.prototype.getParent = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateFilesRequest} returns this
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesRequest.prototype.setParent = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.BatchAnnotateFilesResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    responsesList: jspb.Message.toObjectList(msg.getResponsesList(),
    proto.google.cloud.vision.v1.AnnotateFileResponse.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateFilesResponse}
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.BatchAnnotateFilesResponse;
  return proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.BatchAnnotateFilesResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateFilesResponse}
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.AnnotateFileResponse;
      reader.readMessage(value,proto.google.cloud.vision.v1.AnnotateFileResponse.deserializeBinaryFromReader);
      msg.addResponses(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.BatchAnnotateFilesResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getResponsesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.google.cloud.vision.v1.AnnotateFileResponse.serializeBinaryToWriter
    );
  }
};


/**
 * repeated AnnotateFileResponse responses = 1;
 * @return {!Array<!proto.google.cloud.vision.v1.AnnotateFileResponse>}
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.prototype.getResponsesList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.AnnotateFileResponse>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.AnnotateFileResponse, 1));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.AnnotateFileResponse>} value
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateFilesResponse} returns this
*/
proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.prototype.setResponsesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.AnnotateFileResponse=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.AnnotateFileResponse}
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.prototype.addResponses = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.google.cloud.vision.v1.AnnotateFileResponse, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.BatchAnnotateFilesResponse} returns this
 */
proto.google.cloud.vision.v1.BatchAnnotateFilesResponse.prototype.clearResponsesList = function() {
  return this.setResponsesList([]);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.repeatedFields_ = [2];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    inputConfig: (f = msg.getInputConfig()) && proto.google.cloud.vision.v1.InputConfig.toObject(includeInstance, f),
    featuresList: jspb.Message.toObjectList(msg.getFeaturesList(),
    proto.google.cloud.vision.v1.Feature.toObject, includeInstance),
    imageContext: (f = msg.getImageContext()) && proto.google.cloud.vision.v1.ImageContext.toObject(includeInstance, f),
    outputConfig: (f = msg.getOutputConfig()) && proto.google.cloud.vision.v1.OutputConfig.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.AsyncAnnotateFileRequest;
  return proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.InputConfig;
      reader.readMessage(value,proto.google.cloud.vision.v1.InputConfig.deserializeBinaryFromReader);
      msg.setInputConfig(value);
      break;
    case 2:
      var value = new proto.google.cloud.vision.v1.Feature;
      reader.readMessage(value,proto.google.cloud.vision.v1.Feature.deserializeBinaryFromReader);
      msg.addFeatures(value);
      break;
    case 3:
      var value = new proto.google.cloud.vision.v1.ImageContext;
      reader.readMessage(value,proto.google.cloud.vision.v1.ImageContext.deserializeBinaryFromReader);
      msg.setImageContext(value);
      break;
    case 4:
      var value = new proto.google.cloud.vision.v1.OutputConfig;
      reader.readMessage(value,proto.google.cloud.vision.v1.OutputConfig.deserializeBinaryFromReader);
      msg.setOutputConfig(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getInputConfig();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.google.cloud.vision.v1.InputConfig.serializeBinaryToWriter
    );
  }
  f = message.getFeaturesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      2,
      f,
      proto.google.cloud.vision.v1.Feature.serializeBinaryToWriter
    );
  }
  f = message.getImageContext();
  if (f != null) {
    writer.writeMessage(
      3,
      f,
      proto.google.cloud.vision.v1.ImageContext.serializeBinaryToWriter
    );
  }
  f = message.getOutputConfig();
  if (f != null) {
    writer.writeMessage(
      4,
      f,
      proto.google.cloud.vision.v1.OutputConfig.serializeBinaryToWriter
    );
  }
};


/**
 * optional InputConfig input_config = 1;
 * @return {?proto.google.cloud.vision.v1.InputConfig}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.getInputConfig = function() {
  return /** @type{?proto.google.cloud.vision.v1.InputConfig} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.InputConfig, 1));
};


/**
 * @param {?proto.google.cloud.vision.v1.InputConfig|undefined} value
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest} returns this
*/
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.setInputConfig = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest} returns this
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.clearInputConfig = function() {
  return this.setInputConfig(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.hasInputConfig = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * repeated Feature features = 2;
 * @return {!Array<!proto.google.cloud.vision.v1.Feature>}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.getFeaturesList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.Feature>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.Feature, 2));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.Feature>} value
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest} returns this
*/
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.setFeaturesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 2, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.Feature=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.Feature}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.addFeatures = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 2, opt_value, proto.google.cloud.vision.v1.Feature, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest} returns this
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.clearFeaturesList = function() {
  return this.setFeaturesList([]);
};


/**
 * optional ImageContext image_context = 3;
 * @return {?proto.google.cloud.vision.v1.ImageContext}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.getImageContext = function() {
  return /** @type{?proto.google.cloud.vision.v1.ImageContext} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.ImageContext, 3));
};


/**
 * @param {?proto.google.cloud.vision.v1.ImageContext|undefined} value
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest} returns this
*/
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.setImageContext = function(value) {
  return jspb.Message.setWrapperField(this, 3, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest} returns this
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.clearImageContext = function() {
  return this.setImageContext(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.hasImageContext = function() {
  return jspb.Message.getField(this, 3) != null;
};


/**
 * optional OutputConfig output_config = 4;
 * @return {?proto.google.cloud.vision.v1.OutputConfig}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.getOutputConfig = function() {
  return /** @type{?proto.google.cloud.vision.v1.OutputConfig} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.OutputConfig, 4));
};


/**
 * @param {?proto.google.cloud.vision.v1.OutputConfig|undefined} value
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest} returns this
*/
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.setOutputConfig = function(value) {
  return jspb.Message.setWrapperField(this, 4, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest} returns this
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.clearOutputConfig = function() {
  return this.setOutputConfig(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.prototype.hasOutputConfig = function() {
  return jspb.Message.getField(this, 4) != null;
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.AsyncAnnotateFileResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    outputConfig: (f = msg.getOutputConfig()) && proto.google.cloud.vision.v1.OutputConfig.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileResponse}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.AsyncAnnotateFileResponse;
  return proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.AsyncAnnotateFileResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileResponse}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.OutputConfig;
      reader.readMessage(value,proto.google.cloud.vision.v1.OutputConfig.deserializeBinaryFromReader);
      msg.setOutputConfig(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.AsyncAnnotateFileResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getOutputConfig();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.google.cloud.vision.v1.OutputConfig.serializeBinaryToWriter
    );
  }
};


/**
 * optional OutputConfig output_config = 1;
 * @return {?proto.google.cloud.vision.v1.OutputConfig}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.prototype.getOutputConfig = function() {
  return /** @type{?proto.google.cloud.vision.v1.OutputConfig} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.OutputConfig, 1));
};


/**
 * @param {?proto.google.cloud.vision.v1.OutputConfig|undefined} value
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileResponse} returns this
*/
proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.prototype.setOutputConfig = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileResponse} returns this
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.prototype.clearOutputConfig = function() {
  return this.setOutputConfig(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.prototype.hasOutputConfig = function() {
  return jspb.Message.getField(this, 1) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    requestsList: jspb.Message.toObjectList(msg.getRequestsList(),
    proto.google.cloud.vision.v1.AnnotateImageRequest.toObject, includeInstance),
    outputConfig: (f = msg.getOutputConfig()) && proto.google.cloud.vision.v1.OutputConfig.toObject(includeInstance, f),
    parent: jspb.Message.getFieldWithDefault(msg, 4, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest;
  return proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.AnnotateImageRequest;
      reader.readMessage(value,proto.google.cloud.vision.v1.AnnotateImageRequest.deserializeBinaryFromReader);
      msg.addRequests(value);
      break;
    case 2:
      var value = new proto.google.cloud.vision.v1.OutputConfig;
      reader.readMessage(value,proto.google.cloud.vision.v1.OutputConfig.deserializeBinaryFromReader);
      msg.setOutputConfig(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setParent(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getRequestsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.google.cloud.vision.v1.AnnotateImageRequest.serializeBinaryToWriter
    );
  }
  f = message.getOutputConfig();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.google.cloud.vision.v1.OutputConfig.serializeBinaryToWriter
    );
  }
  f = message.getParent();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
};


/**
 * repeated AnnotateImageRequest requests = 1;
 * @return {!Array<!proto.google.cloud.vision.v1.AnnotateImageRequest>}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.prototype.getRequestsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.AnnotateImageRequest>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.AnnotateImageRequest, 1));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.AnnotateImageRequest>} value
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest} returns this
*/
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.prototype.setRequestsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.AnnotateImageRequest=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.AnnotateImageRequest}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.prototype.addRequests = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.google.cloud.vision.v1.AnnotateImageRequest, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest} returns this
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.prototype.clearRequestsList = function() {
  return this.setRequestsList([]);
};


/**
 * optional OutputConfig output_config = 2;
 * @return {?proto.google.cloud.vision.v1.OutputConfig}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.prototype.getOutputConfig = function() {
  return /** @type{?proto.google.cloud.vision.v1.OutputConfig} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.OutputConfig, 2));
};


/**
 * @param {?proto.google.cloud.vision.v1.OutputConfig|undefined} value
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest} returns this
*/
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.prototype.setOutputConfig = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest} returns this
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.prototype.clearOutputConfig = function() {
  return this.setOutputConfig(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.prototype.hasOutputConfig = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional string parent = 4;
 * @return {string}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.prototype.getParent = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest} returns this
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesRequest.prototype.setParent = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    outputConfig: (f = msg.getOutputConfig()) && proto.google.cloud.vision.v1.OutputConfig.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse;
  return proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.OutputConfig;
      reader.readMessage(value,proto.google.cloud.vision.v1.OutputConfig.deserializeBinaryFromReader);
      msg.setOutputConfig(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getOutputConfig();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.google.cloud.vision.v1.OutputConfig.serializeBinaryToWriter
    );
  }
};


/**
 * optional OutputConfig output_config = 1;
 * @return {?proto.google.cloud.vision.v1.OutputConfig}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse.prototype.getOutputConfig = function() {
  return /** @type{?proto.google.cloud.vision.v1.OutputConfig} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.OutputConfig, 1));
};


/**
 * @param {?proto.google.cloud.vision.v1.OutputConfig|undefined} value
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse} returns this
*/
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse.prototype.setOutputConfig = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse} returns this
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse.prototype.clearOutputConfig = function() {
  return this.setOutputConfig(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateImagesResponse.prototype.hasOutputConfig = function() {
  return jspb.Message.getField(this, 1) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    requestsList: jspb.Message.toObjectList(msg.getRequestsList(),
    proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.toObject, includeInstance),
    parent: jspb.Message.getFieldWithDefault(msg, 4, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest;
  return proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.AsyncAnnotateFileRequest;
      reader.readMessage(value,proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.deserializeBinaryFromReader);
      msg.addRequests(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setParent(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getRequestsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.google.cloud.vision.v1.AsyncAnnotateFileRequest.serializeBinaryToWriter
    );
  }
  f = message.getParent();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
};


/**
 * repeated AsyncAnnotateFileRequest requests = 1;
 * @return {!Array<!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest>}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.prototype.getRequestsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.AsyncAnnotateFileRequest, 1));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest>} value
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest} returns this
*/
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.prototype.setRequestsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileRequest}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.prototype.addRequests = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.google.cloud.vision.v1.AsyncAnnotateFileRequest, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest} returns this
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.prototype.clearRequestsList = function() {
  return this.setRequestsList([]);
};


/**
 * optional string parent = 4;
 * @return {string}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.prototype.getParent = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest} returns this
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesRequest.prototype.setParent = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.repeatedFields_ = [1];



if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    responsesList: jspb.Message.toObjectList(msg.getResponsesList(),
    proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.toObject, includeInstance)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse;
  return proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.AsyncAnnotateFileResponse;
      reader.readMessage(value,proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.deserializeBinaryFromReader);
      msg.addResponses(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getResponsesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.google.cloud.vision.v1.AsyncAnnotateFileResponse.serializeBinaryToWriter
    );
  }
};


/**
 * repeated AsyncAnnotateFileResponse responses = 1;
 * @return {!Array<!proto.google.cloud.vision.v1.AsyncAnnotateFileResponse>}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.prototype.getResponsesList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.AsyncAnnotateFileResponse>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.AsyncAnnotateFileResponse, 1));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.AsyncAnnotateFileResponse>} value
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse} returns this
*/
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.prototype.setResponsesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.AsyncAnnotateFileResponse=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.AsyncAnnotateFileResponse}
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.prototype.addResponses = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.google.cloud.vision.v1.AsyncAnnotateFileResponse, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse} returns this
 */
proto.google.cloud.vision.v1.AsyncBatchAnnotateFilesResponse.prototype.clearResponsesList = function() {
  return this.setResponsesList([]);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.InputConfig.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.InputConfig.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.InputConfig} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.InputConfig.toObject = function(includeInstance, msg) {
  var f, obj = {
    gcsSource: (f = msg.getGcsSource()) && proto.google.cloud.vision.v1.GcsSource.toObject(includeInstance, f),
    content: msg.getContent_asB64(),
    mimeType: jspb.Message.getFieldWithDefault(msg, 2, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.InputConfig}
 */
proto.google.cloud.vision.v1.InputConfig.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.InputConfig;
  return proto.google.cloud.vision.v1.InputConfig.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.InputConfig} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.InputConfig}
 */
proto.google.cloud.vision.v1.InputConfig.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.GcsSource;
      reader.readMessage(value,proto.google.cloud.vision.v1.GcsSource.deserializeBinaryFromReader);
      msg.setGcsSource(value);
      break;
    case 3:
      var value = /** @type {!Uint8Array} */ (reader.readBytes());
      msg.setContent(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setMimeType(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.InputConfig.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.InputConfig.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.InputConfig} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.InputConfig.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getGcsSource();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.google.cloud.vision.v1.GcsSource.serializeBinaryToWriter
    );
  }
  f = message.getContent_asU8();
  if (f.length > 0) {
    writer.writeBytes(
      3,
      f
    );
  }
  f = message.getMimeType();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
};


/**
 * optional GcsSource gcs_source = 1;
 * @return {?proto.google.cloud.vision.v1.GcsSource}
 */
proto.google.cloud.vision.v1.InputConfig.prototype.getGcsSource = function() {
  return /** @type{?proto.google.cloud.vision.v1.GcsSource} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.GcsSource, 1));
};


/**
 * @param {?proto.google.cloud.vision.v1.GcsSource|undefined} value
 * @return {!proto.google.cloud.vision.v1.InputConfig} returns this
*/
proto.google.cloud.vision.v1.InputConfig.prototype.setGcsSource = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.InputConfig} returns this
 */
proto.google.cloud.vision.v1.InputConfig.prototype.clearGcsSource = function() {
  return this.setGcsSource(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.InputConfig.prototype.hasGcsSource = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional bytes content = 3;
 * @return {string}
 */
proto.google.cloud.vision.v1.InputConfig.prototype.getContent = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * optional bytes content = 3;
 * This is a type-conversion wrapper around `getContent()`
 * @return {string}
 */
proto.google.cloud.vision.v1.InputConfig.prototype.getContent_asB64 = function() {
  return /** @type {string} */ (jspb.Message.bytesAsB64(
      this.getContent()));
};


/**
 * optional bytes content = 3;
 * Note that Uint8Array is not supported on all browsers.
 * @see http://caniuse.com/Uint8Array
 * This is a type-conversion wrapper around `getContent()`
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.InputConfig.prototype.getContent_asU8 = function() {
  return /** @type {!Uint8Array} */ (jspb.Message.bytesAsU8(
      this.getContent()));
};


/**
 * @param {!(string|Uint8Array)} value
 * @return {!proto.google.cloud.vision.v1.InputConfig} returns this
 */
proto.google.cloud.vision.v1.InputConfig.prototype.setContent = function(value) {
  return jspb.Message.setProto3BytesField(this, 3, value);
};


/**
 * optional string mime_type = 2;
 * @return {string}
 */
proto.google.cloud.vision.v1.InputConfig.prototype.getMimeType = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.InputConfig} returns this
 */
proto.google.cloud.vision.v1.InputConfig.prototype.setMimeType = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.OutputConfig.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.OutputConfig.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.OutputConfig} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.OutputConfig.toObject = function(includeInstance, msg) {
  var f, obj = {
    gcsDestination: (f = msg.getGcsDestination()) && proto.google.cloud.vision.v1.GcsDestination.toObject(includeInstance, f),
    batchSize: jspb.Message.getFieldWithDefault(msg, 2, 0)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.OutputConfig}
 */
proto.google.cloud.vision.v1.OutputConfig.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.OutputConfig;
  return proto.google.cloud.vision.v1.OutputConfig.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.OutputConfig} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.OutputConfig}
 */
proto.google.cloud.vision.v1.OutputConfig.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.GcsDestination;
      reader.readMessage(value,proto.google.cloud.vision.v1.GcsDestination.deserializeBinaryFromReader);
      msg.setGcsDestination(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt32());
      msg.setBatchSize(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.OutputConfig.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.OutputConfig.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.OutputConfig} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.OutputConfig.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getGcsDestination();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.google.cloud.vision.v1.GcsDestination.serializeBinaryToWriter
    );
  }
  f = message.getBatchSize();
  if (f !== 0) {
    writer.writeInt32(
      2,
      f
    );
  }
};


/**
 * optional GcsDestination gcs_destination = 1;
 * @return {?proto.google.cloud.vision.v1.GcsDestination}
 */
proto.google.cloud.vision.v1.OutputConfig.prototype.getGcsDestination = function() {
  return /** @type{?proto.google.cloud.vision.v1.GcsDestination} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.GcsDestination, 1));
};


/**
 * @param {?proto.google.cloud.vision.v1.GcsDestination|undefined} value
 * @return {!proto.google.cloud.vision.v1.OutputConfig} returns this
*/
proto.google.cloud.vision.v1.OutputConfig.prototype.setGcsDestination = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.OutputConfig} returns this
 */
proto.google.cloud.vision.v1.OutputConfig.prototype.clearGcsDestination = function() {
  return this.setGcsDestination(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.OutputConfig.prototype.hasGcsDestination = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional int32 batch_size = 2;
 * @return {number}
 */
proto.google.cloud.vision.v1.OutputConfig.prototype.getBatchSize = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.OutputConfig} returns this
 */
proto.google.cloud.vision.v1.OutputConfig.prototype.setBatchSize = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.GcsSource.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.GcsSource.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.GcsSource} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.GcsSource.toObject = function(includeInstance, msg) {
  var f, obj = {
    uri: jspb.Message.getFieldWithDefault(msg, 1, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.GcsSource}
 */
proto.google.cloud.vision.v1.GcsSource.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.GcsSource;
  return proto.google.cloud.vision.v1.GcsSource.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.GcsSource} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.GcsSource}
 */
proto.google.cloud.vision.v1.GcsSource.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setUri(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.GcsSource.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.GcsSource.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.GcsSource} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.GcsSource.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getUri();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
};


/**
 * optional string uri = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.GcsSource.prototype.getUri = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.GcsSource} returns this
 */
proto.google.cloud.vision.v1.GcsSource.prototype.setUri = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.GcsDestination.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.GcsDestination.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.GcsDestination} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.GcsDestination.toObject = function(includeInstance, msg) {
  var f, obj = {
    uri: jspb.Message.getFieldWithDefault(msg, 1, "")
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.GcsDestination}
 */
proto.google.cloud.vision.v1.GcsDestination.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.GcsDestination;
  return proto.google.cloud.vision.v1.GcsDestination.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.GcsDestination} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.GcsDestination}
 */
proto.google.cloud.vision.v1.GcsDestination.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setUri(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.GcsDestination.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.GcsDestination.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.GcsDestination} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.GcsDestination.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getUri();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
};


/**
 * optional string uri = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.GcsDestination.prototype.getUri = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.GcsDestination} returns this
 */
proto.google.cloud.vision.v1.GcsDestination.prototype.setUri = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};





if (jspb.Message.GENERATE_TO_OBJECT) {
/**
 * Creates an object representation of this proto.
 * Field names that are reserved in JavaScript and will be renamed to pb_name.
 * Optional fields that are not set will be set to undefined.
 * To access a reserved field use, foo.pb_<name>, eg, foo.pb_default.
 * For the list of reserved names please see:
 *     net/proto2/compiler/js/internal/generator.cc#kKeyword.
 * @param {boolean=} opt_includeInstance Deprecated. whether to include the
 *     JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @return {!Object}
 */
proto.google.cloud.vision.v1.OperationMetadata.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.OperationMetadata.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.OperationMetadata} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.OperationMetadata.toObject = function(includeInstance, msg) {
  var f, obj = {
    state: jspb.Message.getFieldWithDefault(msg, 1, 0),
    createTime: (f = msg.getCreateTime()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
    updateTime: (f = msg.getUpdateTime()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f)
  };

  if (includeInstance) {
    obj.$jspbMessageInstance = msg;
  }
  return obj;
};
}


/**
 * Deserializes binary data (in protobuf wire format).
 * @param {jspb.ByteSource} bytes The bytes to deserialize.
 * @return {!proto.google.cloud.vision.v1.OperationMetadata}
 */
proto.google.cloud.vision.v1.OperationMetadata.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.OperationMetadata;
  return proto.google.cloud.vision.v1.OperationMetadata.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.OperationMetadata} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.OperationMetadata}
 */
proto.google.cloud.vision.v1.OperationMetadata.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {!proto.google.cloud.vision.v1.OperationMetadata.State} */ (reader.readEnum());
      msg.setState(value);
      break;
    case 5:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setCreateTime(value);
      break;
    case 6:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setUpdateTime(value);
      break;
    default:
      reader.skipField();
      break;
    }
  }
  return msg;
};


/**
 * Serializes the message to binary data (in protobuf wire format).
 * @return {!Uint8Array}
 */
proto.google.cloud.vision.v1.OperationMetadata.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.OperationMetadata.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.OperationMetadata} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.OperationMetadata.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getState();
  if (f !== 0.0) {
    writer.writeEnum(
      1,
      f
    );
  }
  f = message.getCreateTime();
  if (f != null) {
    writer.writeMessage(
      5,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getUpdateTime();
  if (f != null) {
    writer.writeMessage(
      6,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
};


/**
 * @enum {number}
 */
proto.google.cloud.vision.v1.OperationMetadata.State = {
  STATE_UNSPECIFIED: 0,
  CREATED: 1,
  RUNNING: 2,
  DONE: 3,
  CANCELLED: 4
};

/**
 * optional State state = 1;
 * @return {!proto.google.cloud.vision.v1.OperationMetadata.State}
 */
proto.google.cloud.vision.v1.OperationMetadata.prototype.getState = function() {
  return /** @type {!proto.google.cloud.vision.v1.OperationMetadata.State} */ (jspb.Message.getFieldWithDefault(this, 1, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.OperationMetadata.State} value
 * @return {!proto.google.cloud.vision.v1.OperationMetadata} returns this
 */
proto.google.cloud.vision.v1.OperationMetadata.prototype.setState = function(value) {
  return jspb.Message.setProto3EnumField(this, 1, value);
};


/**
 * optional google.protobuf.Timestamp create_time = 5;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.google.cloud.vision.v1.OperationMetadata.prototype.getCreateTime = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 5));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.google.cloud.vision.v1.OperationMetadata} returns this
*/
proto.google.cloud.vision.v1.OperationMetadata.prototype.setCreateTime = function(value) {
  return jspb.Message.setWrapperField(this, 5, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.OperationMetadata} returns this
 */
proto.google.cloud.vision.v1.OperationMetadata.prototype.clearCreateTime = function() {
  return this.setCreateTime(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.OperationMetadata.prototype.hasCreateTime = function() {
  return jspb.Message.getField(this, 5) != null;
};


/**
 * optional google.protobuf.Timestamp update_time = 6;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.google.cloud.vision.v1.OperationMetadata.prototype.getUpdateTime = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 6));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.google.cloud.vision.v1.OperationMetadata} returns this
*/
proto.google.cloud.vision.v1.OperationMetadata.prototype.setUpdateTime = function(value) {
  return jspb.Message.setWrapperField(this, 6, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.OperationMetadata} returns this
 */
proto.google.cloud.vision.v1.OperationMetadata.prototype.clearUpdateTime = function() {
  return this.setUpdateTime(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.OperationMetadata.prototype.hasUpdateTime = function() {
  return jspb.Message.getField(this, 6) != null;
};


/**
 * @enum {number}
 */
proto.google.cloud.vision.v1.Likelihood = {
  UNKNOWN: 0,
  VERY_UNLIKELY: 1,
  UNLIKELY: 2,
  POSSIBLE: 3,
  LIKELY: 4,
  VERY_LIKELY: 5
};

goog.object.extend(exports, proto.google.cloud.vision.v1);
