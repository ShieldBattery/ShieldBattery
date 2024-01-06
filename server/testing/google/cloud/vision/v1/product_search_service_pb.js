// source: google/cloud/vision/v1/product_search_service.proto
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
var google_api_resource_pb = require('../../../../google/api/resource_pb.js');
goog.object.extend(proto, google_api_resource_pb);
var google_cloud_vision_v1_geometry_pb = require('../../../../google/cloud/vision/v1/geometry_pb.js');
goog.object.extend(proto, google_cloud_vision_v1_geometry_pb);
var google_longrunning_operations_pb = require('../../../../google/longrunning/operations_pb.js');
goog.object.extend(proto, google_longrunning_operations_pb);
var google_protobuf_empty_pb = require('google-protobuf/google/protobuf/empty_pb.js');
goog.object.extend(proto, google_protobuf_empty_pb);
var google_protobuf_field_mask_pb = require('google-protobuf/google/protobuf/field_mask_pb.js');
goog.object.extend(proto, google_protobuf_field_mask_pb);
var google_protobuf_timestamp_pb = require('google-protobuf/google/protobuf/timestamp_pb.js');
goog.object.extend(proto, google_protobuf_timestamp_pb);
var google_rpc_status_pb = require('../../../../google/rpc/status_pb.js');
goog.object.extend(proto, google_rpc_status_pb);
goog.exportSymbol('proto.google.cloud.vision.v1.AddProductToProductSetRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.BatchOperationMetadata', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.BatchOperationMetadata.State', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.CreateProductRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.CreateProductSetRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.CreateReferenceImageRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.DeleteProductRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.DeleteProductSetRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.DeleteReferenceImageRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.GetProductRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.GetProductSetRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.GetReferenceImageRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ImportProductSetsGcsSource', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ImportProductSetsInputConfig', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ImportProductSetsInputConfig.SourceCase', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ImportProductSetsRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ImportProductSetsResponse', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ListProductSetsRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ListProductSetsResponse', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ListProductsInProductSetRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ListProductsInProductSetResponse', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ListProductsRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ListProductsResponse', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ListReferenceImagesRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ListReferenceImagesResponse', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.Product', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.Product.KeyValue', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ProductSet', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ProductSetPurgeConfig', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.PurgeProductsRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.PurgeProductsRequest.TargetCase', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.ReferenceImage', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.UpdateProductRequest', null, global);
goog.exportSymbol('proto.google.cloud.vision.v1.UpdateProductSetRequest', null, global);
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
proto.google.cloud.vision.v1.Product = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.Product.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.Product, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.Product.displayName = 'proto.google.cloud.vision.v1.Product';
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
proto.google.cloud.vision.v1.Product.KeyValue = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.Product.KeyValue, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.Product.KeyValue.displayName = 'proto.google.cloud.vision.v1.Product.KeyValue';
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
proto.google.cloud.vision.v1.ProductSet = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.ProductSet, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ProductSet.displayName = 'proto.google.cloud.vision.v1.ProductSet';
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
proto.google.cloud.vision.v1.ReferenceImage = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.ReferenceImage.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.ReferenceImage, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ReferenceImage.displayName = 'proto.google.cloud.vision.v1.ReferenceImage';
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
proto.google.cloud.vision.v1.CreateProductRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.CreateProductRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.CreateProductRequest.displayName = 'proto.google.cloud.vision.v1.CreateProductRequest';
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
proto.google.cloud.vision.v1.ListProductsRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.ListProductsRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ListProductsRequest.displayName = 'proto.google.cloud.vision.v1.ListProductsRequest';
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
proto.google.cloud.vision.v1.ListProductsResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.ListProductsResponse.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.ListProductsResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ListProductsResponse.displayName = 'proto.google.cloud.vision.v1.ListProductsResponse';
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
proto.google.cloud.vision.v1.GetProductRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.GetProductRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.GetProductRequest.displayName = 'proto.google.cloud.vision.v1.GetProductRequest';
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
proto.google.cloud.vision.v1.UpdateProductRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.UpdateProductRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.UpdateProductRequest.displayName = 'proto.google.cloud.vision.v1.UpdateProductRequest';
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
proto.google.cloud.vision.v1.DeleteProductRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.DeleteProductRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.DeleteProductRequest.displayName = 'proto.google.cloud.vision.v1.DeleteProductRequest';
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
proto.google.cloud.vision.v1.CreateProductSetRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.CreateProductSetRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.CreateProductSetRequest.displayName = 'proto.google.cloud.vision.v1.CreateProductSetRequest';
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
proto.google.cloud.vision.v1.ListProductSetsRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.ListProductSetsRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ListProductSetsRequest.displayName = 'proto.google.cloud.vision.v1.ListProductSetsRequest';
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
proto.google.cloud.vision.v1.ListProductSetsResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.ListProductSetsResponse.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.ListProductSetsResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ListProductSetsResponse.displayName = 'proto.google.cloud.vision.v1.ListProductSetsResponse';
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
proto.google.cloud.vision.v1.GetProductSetRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.GetProductSetRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.GetProductSetRequest.displayName = 'proto.google.cloud.vision.v1.GetProductSetRequest';
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
proto.google.cloud.vision.v1.UpdateProductSetRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.UpdateProductSetRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.UpdateProductSetRequest.displayName = 'proto.google.cloud.vision.v1.UpdateProductSetRequest';
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
proto.google.cloud.vision.v1.DeleteProductSetRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.DeleteProductSetRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.DeleteProductSetRequest.displayName = 'proto.google.cloud.vision.v1.DeleteProductSetRequest';
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
proto.google.cloud.vision.v1.CreateReferenceImageRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.CreateReferenceImageRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.CreateReferenceImageRequest.displayName = 'proto.google.cloud.vision.v1.CreateReferenceImageRequest';
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
proto.google.cloud.vision.v1.ListReferenceImagesRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.ListReferenceImagesRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ListReferenceImagesRequest.displayName = 'proto.google.cloud.vision.v1.ListReferenceImagesRequest';
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
proto.google.cloud.vision.v1.ListReferenceImagesResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.ListReferenceImagesResponse.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.ListReferenceImagesResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ListReferenceImagesResponse.displayName = 'proto.google.cloud.vision.v1.ListReferenceImagesResponse';
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
proto.google.cloud.vision.v1.GetReferenceImageRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.GetReferenceImageRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.GetReferenceImageRequest.displayName = 'proto.google.cloud.vision.v1.GetReferenceImageRequest';
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
proto.google.cloud.vision.v1.DeleteReferenceImageRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.DeleteReferenceImageRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.DeleteReferenceImageRequest.displayName = 'proto.google.cloud.vision.v1.DeleteReferenceImageRequest';
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
proto.google.cloud.vision.v1.AddProductToProductSetRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.AddProductToProductSetRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.AddProductToProductSetRequest.displayName = 'proto.google.cloud.vision.v1.AddProductToProductSetRequest';
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
proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest.displayName = 'proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest';
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
proto.google.cloud.vision.v1.ListProductsInProductSetRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.ListProductsInProductSetRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ListProductsInProductSetRequest.displayName = 'proto.google.cloud.vision.v1.ListProductsInProductSetRequest';
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
proto.google.cloud.vision.v1.ListProductsInProductSetResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.ListProductsInProductSetResponse.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.ListProductsInProductSetResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ListProductsInProductSetResponse.displayName = 'proto.google.cloud.vision.v1.ListProductsInProductSetResponse';
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
proto.google.cloud.vision.v1.ImportProductSetsGcsSource = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.ImportProductSetsGcsSource, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ImportProductSetsGcsSource.displayName = 'proto.google.cloud.vision.v1.ImportProductSetsGcsSource';
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
proto.google.cloud.vision.v1.ImportProductSetsInputConfig = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, proto.google.cloud.vision.v1.ImportProductSetsInputConfig.oneofGroups_);
};
goog.inherits(proto.google.cloud.vision.v1.ImportProductSetsInputConfig, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ImportProductSetsInputConfig.displayName = 'proto.google.cloud.vision.v1.ImportProductSetsInputConfig';
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
proto.google.cloud.vision.v1.ImportProductSetsRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.ImportProductSetsRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ImportProductSetsRequest.displayName = 'proto.google.cloud.vision.v1.ImportProductSetsRequest';
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
proto.google.cloud.vision.v1.ImportProductSetsResponse = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, proto.google.cloud.vision.v1.ImportProductSetsResponse.repeatedFields_, null);
};
goog.inherits(proto.google.cloud.vision.v1.ImportProductSetsResponse, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ImportProductSetsResponse.displayName = 'proto.google.cloud.vision.v1.ImportProductSetsResponse';
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
proto.google.cloud.vision.v1.BatchOperationMetadata = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.BatchOperationMetadata, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.BatchOperationMetadata.displayName = 'proto.google.cloud.vision.v1.BatchOperationMetadata';
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
proto.google.cloud.vision.v1.ProductSetPurgeConfig = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, null);
};
goog.inherits(proto.google.cloud.vision.v1.ProductSetPurgeConfig, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.ProductSetPurgeConfig.displayName = 'proto.google.cloud.vision.v1.ProductSetPurgeConfig';
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
proto.google.cloud.vision.v1.PurgeProductsRequest = function(opt_data) {
  jspb.Message.initialize(this, opt_data, 0, -1, null, proto.google.cloud.vision.v1.PurgeProductsRequest.oneofGroups_);
};
goog.inherits(proto.google.cloud.vision.v1.PurgeProductsRequest, jspb.Message);
if (goog.DEBUG && !COMPILED) {
  /**
   * @public
   * @override
   */
  proto.google.cloud.vision.v1.PurgeProductsRequest.displayName = 'proto.google.cloud.vision.v1.PurgeProductsRequest';
}

/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.Product.repeatedFields_ = [5];



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
proto.google.cloud.vision.v1.Product.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.Product.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.Product} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.Product.toObject = function(includeInstance, msg) {
  var f, obj = {
    name: jspb.Message.getFieldWithDefault(msg, 1, ""),
    displayName: jspb.Message.getFieldWithDefault(msg, 2, ""),
    description: jspb.Message.getFieldWithDefault(msg, 3, ""),
    productCategory: jspb.Message.getFieldWithDefault(msg, 4, ""),
    productLabelsList: jspb.Message.toObjectList(msg.getProductLabelsList(),
    proto.google.cloud.vision.v1.Product.KeyValue.toObject, includeInstance)
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
 * @return {!proto.google.cloud.vision.v1.Product}
 */
proto.google.cloud.vision.v1.Product.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.Product;
  return proto.google.cloud.vision.v1.Product.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.Product} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.Product}
 */
proto.google.cloud.vision.v1.Product.deserializeBinaryFromReader = function(msg, reader) {
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
      msg.setDisplayName(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setDescription(value);
      break;
    case 4:
      var value = /** @type {string} */ (reader.readString());
      msg.setProductCategory(value);
      break;
    case 5:
      var value = new proto.google.cloud.vision.v1.Product.KeyValue;
      reader.readMessage(value,proto.google.cloud.vision.v1.Product.KeyValue.deserializeBinaryFromReader);
      msg.addProductLabels(value);
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
proto.google.cloud.vision.v1.Product.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.Product.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.Product} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.Product.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getDisplayName();
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
  f = message.getProductCategory();
  if (f.length > 0) {
    writer.writeString(
      4,
      f
    );
  }
  f = message.getProductLabelsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      5,
      f,
      proto.google.cloud.vision.v1.Product.KeyValue.serializeBinaryToWriter
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
proto.google.cloud.vision.v1.Product.KeyValue.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.Product.KeyValue.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.Product.KeyValue} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.Product.KeyValue.toObject = function(includeInstance, msg) {
  var f, obj = {
    key: jspb.Message.getFieldWithDefault(msg, 1, ""),
    value: jspb.Message.getFieldWithDefault(msg, 2, "")
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
 * @return {!proto.google.cloud.vision.v1.Product.KeyValue}
 */
proto.google.cloud.vision.v1.Product.KeyValue.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.Product.KeyValue;
  return proto.google.cloud.vision.v1.Product.KeyValue.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.Product.KeyValue} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.Product.KeyValue}
 */
proto.google.cloud.vision.v1.Product.KeyValue.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setKey(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setValue(value);
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
proto.google.cloud.vision.v1.Product.KeyValue.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.Product.KeyValue.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.Product.KeyValue} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.Product.KeyValue.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getKey();
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
};


/**
 * optional string key = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.Product.KeyValue.prototype.getKey = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.Product.KeyValue} returns this
 */
proto.google.cloud.vision.v1.Product.KeyValue.prototype.setKey = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string value = 2;
 * @return {string}
 */
proto.google.cloud.vision.v1.Product.KeyValue.prototype.getValue = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.Product.KeyValue} returns this
 */
proto.google.cloud.vision.v1.Product.KeyValue.prototype.setValue = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.Product.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.Product} returns this
 */
proto.google.cloud.vision.v1.Product.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string display_name = 2;
 * @return {string}
 */
proto.google.cloud.vision.v1.Product.prototype.getDisplayName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.Product} returns this
 */
proto.google.cloud.vision.v1.Product.prototype.setDisplayName = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional string description = 3;
 * @return {string}
 */
proto.google.cloud.vision.v1.Product.prototype.getDescription = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.Product} returns this
 */
proto.google.cloud.vision.v1.Product.prototype.setDescription = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};


/**
 * optional string product_category = 4;
 * @return {string}
 */
proto.google.cloud.vision.v1.Product.prototype.getProductCategory = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 4, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.Product} returns this
 */
proto.google.cloud.vision.v1.Product.prototype.setProductCategory = function(value) {
  return jspb.Message.setProto3StringField(this, 4, value);
};


/**
 * repeated KeyValue product_labels = 5;
 * @return {!Array<!proto.google.cloud.vision.v1.Product.KeyValue>}
 */
proto.google.cloud.vision.v1.Product.prototype.getProductLabelsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.Product.KeyValue>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.Product.KeyValue, 5));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.Product.KeyValue>} value
 * @return {!proto.google.cloud.vision.v1.Product} returns this
*/
proto.google.cloud.vision.v1.Product.prototype.setProductLabelsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 5, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.Product.KeyValue=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.Product.KeyValue}
 */
proto.google.cloud.vision.v1.Product.prototype.addProductLabels = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 5, opt_value, proto.google.cloud.vision.v1.Product.KeyValue, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.Product} returns this
 */
proto.google.cloud.vision.v1.Product.prototype.clearProductLabelsList = function() {
  return this.setProductLabelsList([]);
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
proto.google.cloud.vision.v1.ProductSet.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ProductSet.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ProductSet} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ProductSet.toObject = function(includeInstance, msg) {
  var f, obj = {
    name: jspb.Message.getFieldWithDefault(msg, 1, ""),
    displayName: jspb.Message.getFieldWithDefault(msg, 2, ""),
    indexTime: (f = msg.getIndexTime()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
    indexError: (f = msg.getIndexError()) && google_rpc_status_pb.Status.toObject(includeInstance, f)
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
 * @return {!proto.google.cloud.vision.v1.ProductSet}
 */
proto.google.cloud.vision.v1.ProductSet.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ProductSet;
  return proto.google.cloud.vision.v1.ProductSet.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ProductSet} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ProductSet}
 */
proto.google.cloud.vision.v1.ProductSet.deserializeBinaryFromReader = function(msg, reader) {
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
      msg.setDisplayName(value);
      break;
    case 3:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setIndexTime(value);
      break;
    case 4:
      var value = new google_rpc_status_pb.Status;
      reader.readMessage(value,google_rpc_status_pb.Status.deserializeBinaryFromReader);
      msg.setIndexError(value);
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
proto.google.cloud.vision.v1.ProductSet.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ProductSet.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ProductSet} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ProductSet.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getDisplayName();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getIndexTime();
  if (f != null) {
    writer.writeMessage(
      3,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getIndexError();
  if (f != null) {
    writer.writeMessage(
      4,
      f,
      google_rpc_status_pb.Status.serializeBinaryToWriter
    );
  }
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.ProductSet.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ProductSet} returns this
 */
proto.google.cloud.vision.v1.ProductSet.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string display_name = 2;
 * @return {string}
 */
proto.google.cloud.vision.v1.ProductSet.prototype.getDisplayName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ProductSet} returns this
 */
proto.google.cloud.vision.v1.ProductSet.prototype.setDisplayName = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * optional google.protobuf.Timestamp index_time = 3;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.google.cloud.vision.v1.ProductSet.prototype.getIndexTime = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 3));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.google.cloud.vision.v1.ProductSet} returns this
*/
proto.google.cloud.vision.v1.ProductSet.prototype.setIndexTime = function(value) {
  return jspb.Message.setWrapperField(this, 3, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.ProductSet} returns this
 */
proto.google.cloud.vision.v1.ProductSet.prototype.clearIndexTime = function() {
  return this.setIndexTime(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.ProductSet.prototype.hasIndexTime = function() {
  return jspb.Message.getField(this, 3) != null;
};


/**
 * optional google.rpc.Status index_error = 4;
 * @return {?proto.google.rpc.Status}
 */
proto.google.cloud.vision.v1.ProductSet.prototype.getIndexError = function() {
  return /** @type{?proto.google.rpc.Status} */ (
    jspb.Message.getWrapperField(this, google_rpc_status_pb.Status, 4));
};


/**
 * @param {?proto.google.rpc.Status|undefined} value
 * @return {!proto.google.cloud.vision.v1.ProductSet} returns this
*/
proto.google.cloud.vision.v1.ProductSet.prototype.setIndexError = function(value) {
  return jspb.Message.setWrapperField(this, 4, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.ProductSet} returns this
 */
proto.google.cloud.vision.v1.ProductSet.prototype.clearIndexError = function() {
  return this.setIndexError(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.ProductSet.prototype.hasIndexError = function() {
  return jspb.Message.getField(this, 4) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.ReferenceImage.repeatedFields_ = [3];



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
proto.google.cloud.vision.v1.ReferenceImage.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ReferenceImage.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ReferenceImage} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ReferenceImage.toObject = function(includeInstance, msg) {
  var f, obj = {
    name: jspb.Message.getFieldWithDefault(msg, 1, ""),
    uri: jspb.Message.getFieldWithDefault(msg, 2, ""),
    boundingPolysList: jspb.Message.toObjectList(msg.getBoundingPolysList(),
    google_cloud_vision_v1_geometry_pb.BoundingPoly.toObject, includeInstance)
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
 * @return {!proto.google.cloud.vision.v1.ReferenceImage}
 */
proto.google.cloud.vision.v1.ReferenceImage.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ReferenceImage;
  return proto.google.cloud.vision.v1.ReferenceImage.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ReferenceImage} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ReferenceImage}
 */
proto.google.cloud.vision.v1.ReferenceImage.deserializeBinaryFromReader = function(msg, reader) {
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
      msg.setUri(value);
      break;
    case 3:
      var value = new google_cloud_vision_v1_geometry_pb.BoundingPoly;
      reader.readMessage(value,google_cloud_vision_v1_geometry_pb.BoundingPoly.deserializeBinaryFromReader);
      msg.addBoundingPolys(value);
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
proto.google.cloud.vision.v1.ReferenceImage.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ReferenceImage.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ReferenceImage} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ReferenceImage.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getUri();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
  f = message.getBoundingPolysList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      3,
      f,
      google_cloud_vision_v1_geometry_pb.BoundingPoly.serializeBinaryToWriter
    );
  }
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.ReferenceImage.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ReferenceImage} returns this
 */
proto.google.cloud.vision.v1.ReferenceImage.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string uri = 2;
 * @return {string}
 */
proto.google.cloud.vision.v1.ReferenceImage.prototype.getUri = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ReferenceImage} returns this
 */
proto.google.cloud.vision.v1.ReferenceImage.prototype.setUri = function(value) {
  return jspb.Message.setProto3StringField(this, 2, value);
};


/**
 * repeated BoundingPoly bounding_polys = 3;
 * @return {!Array<!proto.google.cloud.vision.v1.BoundingPoly>}
 */
proto.google.cloud.vision.v1.ReferenceImage.prototype.getBoundingPolysList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.BoundingPoly>} */ (
    jspb.Message.getRepeatedWrapperField(this, google_cloud_vision_v1_geometry_pb.BoundingPoly, 3));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.BoundingPoly>} value
 * @return {!proto.google.cloud.vision.v1.ReferenceImage} returns this
*/
proto.google.cloud.vision.v1.ReferenceImage.prototype.setBoundingPolysList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 3, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.BoundingPoly=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.BoundingPoly}
 */
proto.google.cloud.vision.v1.ReferenceImage.prototype.addBoundingPolys = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 3, opt_value, proto.google.cloud.vision.v1.BoundingPoly, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.ReferenceImage} returns this
 */
proto.google.cloud.vision.v1.ReferenceImage.prototype.clearBoundingPolysList = function() {
  return this.setBoundingPolysList([]);
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
proto.google.cloud.vision.v1.CreateProductRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.CreateProductRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.CreateProductRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.CreateProductRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    parent: jspb.Message.getFieldWithDefault(msg, 1, ""),
    product: (f = msg.getProduct()) && proto.google.cloud.vision.v1.Product.toObject(includeInstance, f),
    productId: jspb.Message.getFieldWithDefault(msg, 3, "")
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
 * @return {!proto.google.cloud.vision.v1.CreateProductRequest}
 */
proto.google.cloud.vision.v1.CreateProductRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.CreateProductRequest;
  return proto.google.cloud.vision.v1.CreateProductRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.CreateProductRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.CreateProductRequest}
 */
proto.google.cloud.vision.v1.CreateProductRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setParent(value);
      break;
    case 2:
      var value = new proto.google.cloud.vision.v1.Product;
      reader.readMessage(value,proto.google.cloud.vision.v1.Product.deserializeBinaryFromReader);
      msg.setProduct(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setProductId(value);
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
proto.google.cloud.vision.v1.CreateProductRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.CreateProductRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.CreateProductRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.CreateProductRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getParent();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getProduct();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.google.cloud.vision.v1.Product.serializeBinaryToWriter
    );
  }
  f = message.getProductId();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
};


/**
 * optional string parent = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.CreateProductRequest.prototype.getParent = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.CreateProductRequest} returns this
 */
proto.google.cloud.vision.v1.CreateProductRequest.prototype.setParent = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional Product product = 2;
 * @return {?proto.google.cloud.vision.v1.Product}
 */
proto.google.cloud.vision.v1.CreateProductRequest.prototype.getProduct = function() {
  return /** @type{?proto.google.cloud.vision.v1.Product} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.Product, 2));
};


/**
 * @param {?proto.google.cloud.vision.v1.Product|undefined} value
 * @return {!proto.google.cloud.vision.v1.CreateProductRequest} returns this
*/
proto.google.cloud.vision.v1.CreateProductRequest.prototype.setProduct = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.CreateProductRequest} returns this
 */
proto.google.cloud.vision.v1.CreateProductRequest.prototype.clearProduct = function() {
  return this.setProduct(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.CreateProductRequest.prototype.hasProduct = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional string product_id = 3;
 * @return {string}
 */
proto.google.cloud.vision.v1.CreateProductRequest.prototype.getProductId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.CreateProductRequest} returns this
 */
proto.google.cloud.vision.v1.CreateProductRequest.prototype.setProductId = function(value) {
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
proto.google.cloud.vision.v1.ListProductsRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ListProductsRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ListProductsRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListProductsRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    parent: jspb.Message.getFieldWithDefault(msg, 1, ""),
    pageSize: jspb.Message.getFieldWithDefault(msg, 2, 0),
    pageToken: jspb.Message.getFieldWithDefault(msg, 3, "")
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
 * @return {!proto.google.cloud.vision.v1.ListProductsRequest}
 */
proto.google.cloud.vision.v1.ListProductsRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ListProductsRequest;
  return proto.google.cloud.vision.v1.ListProductsRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ListProductsRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ListProductsRequest}
 */
proto.google.cloud.vision.v1.ListProductsRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setParent(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt32());
      msg.setPageSize(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setPageToken(value);
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
proto.google.cloud.vision.v1.ListProductsRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ListProductsRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ListProductsRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListProductsRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getParent();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getPageSize();
  if (f !== 0) {
    writer.writeInt32(
      2,
      f
    );
  }
  f = message.getPageToken();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
};


/**
 * optional string parent = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.ListProductsRequest.prototype.getParent = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ListProductsRequest} returns this
 */
proto.google.cloud.vision.v1.ListProductsRequest.prototype.setParent = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int32 page_size = 2;
 * @return {number}
 */
proto.google.cloud.vision.v1.ListProductsRequest.prototype.getPageSize = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.ListProductsRequest} returns this
 */
proto.google.cloud.vision.v1.ListProductsRequest.prototype.setPageSize = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional string page_token = 3;
 * @return {string}
 */
proto.google.cloud.vision.v1.ListProductsRequest.prototype.getPageToken = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ListProductsRequest} returns this
 */
proto.google.cloud.vision.v1.ListProductsRequest.prototype.setPageToken = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.ListProductsResponse.repeatedFields_ = [1];



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
proto.google.cloud.vision.v1.ListProductsResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ListProductsResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ListProductsResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListProductsResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    productsList: jspb.Message.toObjectList(msg.getProductsList(),
    proto.google.cloud.vision.v1.Product.toObject, includeInstance),
    nextPageToken: jspb.Message.getFieldWithDefault(msg, 2, "")
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
 * @return {!proto.google.cloud.vision.v1.ListProductsResponse}
 */
proto.google.cloud.vision.v1.ListProductsResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ListProductsResponse;
  return proto.google.cloud.vision.v1.ListProductsResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ListProductsResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ListProductsResponse}
 */
proto.google.cloud.vision.v1.ListProductsResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.Product;
      reader.readMessage(value,proto.google.cloud.vision.v1.Product.deserializeBinaryFromReader);
      msg.addProducts(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setNextPageToken(value);
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
proto.google.cloud.vision.v1.ListProductsResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ListProductsResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ListProductsResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListProductsResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProductsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.google.cloud.vision.v1.Product.serializeBinaryToWriter
    );
  }
  f = message.getNextPageToken();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
};


/**
 * repeated Product products = 1;
 * @return {!Array<!proto.google.cloud.vision.v1.Product>}
 */
proto.google.cloud.vision.v1.ListProductsResponse.prototype.getProductsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.Product>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.Product, 1));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.Product>} value
 * @return {!proto.google.cloud.vision.v1.ListProductsResponse} returns this
*/
proto.google.cloud.vision.v1.ListProductsResponse.prototype.setProductsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.Product=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.Product}
 */
proto.google.cloud.vision.v1.ListProductsResponse.prototype.addProducts = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.google.cloud.vision.v1.Product, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.ListProductsResponse} returns this
 */
proto.google.cloud.vision.v1.ListProductsResponse.prototype.clearProductsList = function() {
  return this.setProductsList([]);
};


/**
 * optional string next_page_token = 2;
 * @return {string}
 */
proto.google.cloud.vision.v1.ListProductsResponse.prototype.getNextPageToken = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ListProductsResponse} returns this
 */
proto.google.cloud.vision.v1.ListProductsResponse.prototype.setNextPageToken = function(value) {
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
proto.google.cloud.vision.v1.GetProductRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.GetProductRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.GetProductRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.GetProductRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    name: jspb.Message.getFieldWithDefault(msg, 1, "")
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
 * @return {!proto.google.cloud.vision.v1.GetProductRequest}
 */
proto.google.cloud.vision.v1.GetProductRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.GetProductRequest;
  return proto.google.cloud.vision.v1.GetProductRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.GetProductRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.GetProductRequest}
 */
proto.google.cloud.vision.v1.GetProductRequest.deserializeBinaryFromReader = function(msg, reader) {
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
proto.google.cloud.vision.v1.GetProductRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.GetProductRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.GetProductRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.GetProductRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.GetProductRequest.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.GetProductRequest} returns this
 */
proto.google.cloud.vision.v1.GetProductRequest.prototype.setName = function(value) {
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
proto.google.cloud.vision.v1.UpdateProductRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.UpdateProductRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.UpdateProductRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.UpdateProductRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    product: (f = msg.getProduct()) && proto.google.cloud.vision.v1.Product.toObject(includeInstance, f),
    updateMask: (f = msg.getUpdateMask()) && google_protobuf_field_mask_pb.FieldMask.toObject(includeInstance, f)
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
 * @return {!proto.google.cloud.vision.v1.UpdateProductRequest}
 */
proto.google.cloud.vision.v1.UpdateProductRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.UpdateProductRequest;
  return proto.google.cloud.vision.v1.UpdateProductRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.UpdateProductRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.UpdateProductRequest}
 */
proto.google.cloud.vision.v1.UpdateProductRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.Product;
      reader.readMessage(value,proto.google.cloud.vision.v1.Product.deserializeBinaryFromReader);
      msg.setProduct(value);
      break;
    case 2:
      var value = new google_protobuf_field_mask_pb.FieldMask;
      reader.readMessage(value,google_protobuf_field_mask_pb.FieldMask.deserializeBinaryFromReader);
      msg.setUpdateMask(value);
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
proto.google.cloud.vision.v1.UpdateProductRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.UpdateProductRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.UpdateProductRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.UpdateProductRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProduct();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.google.cloud.vision.v1.Product.serializeBinaryToWriter
    );
  }
  f = message.getUpdateMask();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      google_protobuf_field_mask_pb.FieldMask.serializeBinaryToWriter
    );
  }
};


/**
 * optional Product product = 1;
 * @return {?proto.google.cloud.vision.v1.Product}
 */
proto.google.cloud.vision.v1.UpdateProductRequest.prototype.getProduct = function() {
  return /** @type{?proto.google.cloud.vision.v1.Product} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.Product, 1));
};


/**
 * @param {?proto.google.cloud.vision.v1.Product|undefined} value
 * @return {!proto.google.cloud.vision.v1.UpdateProductRequest} returns this
*/
proto.google.cloud.vision.v1.UpdateProductRequest.prototype.setProduct = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.UpdateProductRequest} returns this
 */
proto.google.cloud.vision.v1.UpdateProductRequest.prototype.clearProduct = function() {
  return this.setProduct(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.UpdateProductRequest.prototype.hasProduct = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional google.protobuf.FieldMask update_mask = 2;
 * @return {?proto.google.protobuf.FieldMask}
 */
proto.google.cloud.vision.v1.UpdateProductRequest.prototype.getUpdateMask = function() {
  return /** @type{?proto.google.protobuf.FieldMask} */ (
    jspb.Message.getWrapperField(this, google_protobuf_field_mask_pb.FieldMask, 2));
};


/**
 * @param {?proto.google.protobuf.FieldMask|undefined} value
 * @return {!proto.google.cloud.vision.v1.UpdateProductRequest} returns this
*/
proto.google.cloud.vision.v1.UpdateProductRequest.prototype.setUpdateMask = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.UpdateProductRequest} returns this
 */
proto.google.cloud.vision.v1.UpdateProductRequest.prototype.clearUpdateMask = function() {
  return this.setUpdateMask(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.UpdateProductRequest.prototype.hasUpdateMask = function() {
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
proto.google.cloud.vision.v1.DeleteProductRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.DeleteProductRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.DeleteProductRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.DeleteProductRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    name: jspb.Message.getFieldWithDefault(msg, 1, "")
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
 * @return {!proto.google.cloud.vision.v1.DeleteProductRequest}
 */
proto.google.cloud.vision.v1.DeleteProductRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.DeleteProductRequest;
  return proto.google.cloud.vision.v1.DeleteProductRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.DeleteProductRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.DeleteProductRequest}
 */
proto.google.cloud.vision.v1.DeleteProductRequest.deserializeBinaryFromReader = function(msg, reader) {
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
proto.google.cloud.vision.v1.DeleteProductRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.DeleteProductRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.DeleteProductRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.DeleteProductRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.DeleteProductRequest.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.DeleteProductRequest} returns this
 */
proto.google.cloud.vision.v1.DeleteProductRequest.prototype.setName = function(value) {
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
proto.google.cloud.vision.v1.CreateProductSetRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.CreateProductSetRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.CreateProductSetRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.CreateProductSetRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    parent: jspb.Message.getFieldWithDefault(msg, 1, ""),
    productSet: (f = msg.getProductSet()) && proto.google.cloud.vision.v1.ProductSet.toObject(includeInstance, f),
    productSetId: jspb.Message.getFieldWithDefault(msg, 3, "")
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
 * @return {!proto.google.cloud.vision.v1.CreateProductSetRequest}
 */
proto.google.cloud.vision.v1.CreateProductSetRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.CreateProductSetRequest;
  return proto.google.cloud.vision.v1.CreateProductSetRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.CreateProductSetRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.CreateProductSetRequest}
 */
proto.google.cloud.vision.v1.CreateProductSetRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setParent(value);
      break;
    case 2:
      var value = new proto.google.cloud.vision.v1.ProductSet;
      reader.readMessage(value,proto.google.cloud.vision.v1.ProductSet.deserializeBinaryFromReader);
      msg.setProductSet(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setProductSetId(value);
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
proto.google.cloud.vision.v1.CreateProductSetRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.CreateProductSetRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.CreateProductSetRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.CreateProductSetRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getParent();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getProductSet();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.google.cloud.vision.v1.ProductSet.serializeBinaryToWriter
    );
  }
  f = message.getProductSetId();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
};


/**
 * optional string parent = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.CreateProductSetRequest.prototype.getParent = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.CreateProductSetRequest} returns this
 */
proto.google.cloud.vision.v1.CreateProductSetRequest.prototype.setParent = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional ProductSet product_set = 2;
 * @return {?proto.google.cloud.vision.v1.ProductSet}
 */
proto.google.cloud.vision.v1.CreateProductSetRequest.prototype.getProductSet = function() {
  return /** @type{?proto.google.cloud.vision.v1.ProductSet} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.ProductSet, 2));
};


/**
 * @param {?proto.google.cloud.vision.v1.ProductSet|undefined} value
 * @return {!proto.google.cloud.vision.v1.CreateProductSetRequest} returns this
*/
proto.google.cloud.vision.v1.CreateProductSetRequest.prototype.setProductSet = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.CreateProductSetRequest} returns this
 */
proto.google.cloud.vision.v1.CreateProductSetRequest.prototype.clearProductSet = function() {
  return this.setProductSet(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.CreateProductSetRequest.prototype.hasProductSet = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional string product_set_id = 3;
 * @return {string}
 */
proto.google.cloud.vision.v1.CreateProductSetRequest.prototype.getProductSetId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.CreateProductSetRequest} returns this
 */
proto.google.cloud.vision.v1.CreateProductSetRequest.prototype.setProductSetId = function(value) {
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
proto.google.cloud.vision.v1.ListProductSetsRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ListProductSetsRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ListProductSetsRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListProductSetsRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    parent: jspb.Message.getFieldWithDefault(msg, 1, ""),
    pageSize: jspb.Message.getFieldWithDefault(msg, 2, 0),
    pageToken: jspb.Message.getFieldWithDefault(msg, 3, "")
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
 * @return {!proto.google.cloud.vision.v1.ListProductSetsRequest}
 */
proto.google.cloud.vision.v1.ListProductSetsRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ListProductSetsRequest;
  return proto.google.cloud.vision.v1.ListProductSetsRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ListProductSetsRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ListProductSetsRequest}
 */
proto.google.cloud.vision.v1.ListProductSetsRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setParent(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt32());
      msg.setPageSize(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setPageToken(value);
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
proto.google.cloud.vision.v1.ListProductSetsRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ListProductSetsRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ListProductSetsRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListProductSetsRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getParent();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getPageSize();
  if (f !== 0) {
    writer.writeInt32(
      2,
      f
    );
  }
  f = message.getPageToken();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
};


/**
 * optional string parent = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.ListProductSetsRequest.prototype.getParent = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ListProductSetsRequest} returns this
 */
proto.google.cloud.vision.v1.ListProductSetsRequest.prototype.setParent = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int32 page_size = 2;
 * @return {number}
 */
proto.google.cloud.vision.v1.ListProductSetsRequest.prototype.getPageSize = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.ListProductSetsRequest} returns this
 */
proto.google.cloud.vision.v1.ListProductSetsRequest.prototype.setPageSize = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional string page_token = 3;
 * @return {string}
 */
proto.google.cloud.vision.v1.ListProductSetsRequest.prototype.getPageToken = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ListProductSetsRequest} returns this
 */
proto.google.cloud.vision.v1.ListProductSetsRequest.prototype.setPageToken = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.ListProductSetsResponse.repeatedFields_ = [1];



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
proto.google.cloud.vision.v1.ListProductSetsResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ListProductSetsResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ListProductSetsResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListProductSetsResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    productSetsList: jspb.Message.toObjectList(msg.getProductSetsList(),
    proto.google.cloud.vision.v1.ProductSet.toObject, includeInstance),
    nextPageToken: jspb.Message.getFieldWithDefault(msg, 2, "")
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
 * @return {!proto.google.cloud.vision.v1.ListProductSetsResponse}
 */
proto.google.cloud.vision.v1.ListProductSetsResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ListProductSetsResponse;
  return proto.google.cloud.vision.v1.ListProductSetsResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ListProductSetsResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ListProductSetsResponse}
 */
proto.google.cloud.vision.v1.ListProductSetsResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.ProductSet;
      reader.readMessage(value,proto.google.cloud.vision.v1.ProductSet.deserializeBinaryFromReader);
      msg.addProductSets(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setNextPageToken(value);
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
proto.google.cloud.vision.v1.ListProductSetsResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ListProductSetsResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ListProductSetsResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListProductSetsResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProductSetsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.google.cloud.vision.v1.ProductSet.serializeBinaryToWriter
    );
  }
  f = message.getNextPageToken();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
};


/**
 * repeated ProductSet product_sets = 1;
 * @return {!Array<!proto.google.cloud.vision.v1.ProductSet>}
 */
proto.google.cloud.vision.v1.ListProductSetsResponse.prototype.getProductSetsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.ProductSet>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.ProductSet, 1));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.ProductSet>} value
 * @return {!proto.google.cloud.vision.v1.ListProductSetsResponse} returns this
*/
proto.google.cloud.vision.v1.ListProductSetsResponse.prototype.setProductSetsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.ProductSet=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.ProductSet}
 */
proto.google.cloud.vision.v1.ListProductSetsResponse.prototype.addProductSets = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.google.cloud.vision.v1.ProductSet, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.ListProductSetsResponse} returns this
 */
proto.google.cloud.vision.v1.ListProductSetsResponse.prototype.clearProductSetsList = function() {
  return this.setProductSetsList([]);
};


/**
 * optional string next_page_token = 2;
 * @return {string}
 */
proto.google.cloud.vision.v1.ListProductSetsResponse.prototype.getNextPageToken = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ListProductSetsResponse} returns this
 */
proto.google.cloud.vision.v1.ListProductSetsResponse.prototype.setNextPageToken = function(value) {
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
proto.google.cloud.vision.v1.GetProductSetRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.GetProductSetRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.GetProductSetRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.GetProductSetRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    name: jspb.Message.getFieldWithDefault(msg, 1, "")
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
 * @return {!proto.google.cloud.vision.v1.GetProductSetRequest}
 */
proto.google.cloud.vision.v1.GetProductSetRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.GetProductSetRequest;
  return proto.google.cloud.vision.v1.GetProductSetRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.GetProductSetRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.GetProductSetRequest}
 */
proto.google.cloud.vision.v1.GetProductSetRequest.deserializeBinaryFromReader = function(msg, reader) {
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
proto.google.cloud.vision.v1.GetProductSetRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.GetProductSetRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.GetProductSetRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.GetProductSetRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.GetProductSetRequest.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.GetProductSetRequest} returns this
 */
proto.google.cloud.vision.v1.GetProductSetRequest.prototype.setName = function(value) {
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
proto.google.cloud.vision.v1.UpdateProductSetRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.UpdateProductSetRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.UpdateProductSetRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.UpdateProductSetRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    productSet: (f = msg.getProductSet()) && proto.google.cloud.vision.v1.ProductSet.toObject(includeInstance, f),
    updateMask: (f = msg.getUpdateMask()) && google_protobuf_field_mask_pb.FieldMask.toObject(includeInstance, f)
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
 * @return {!proto.google.cloud.vision.v1.UpdateProductSetRequest}
 */
proto.google.cloud.vision.v1.UpdateProductSetRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.UpdateProductSetRequest;
  return proto.google.cloud.vision.v1.UpdateProductSetRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.UpdateProductSetRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.UpdateProductSetRequest}
 */
proto.google.cloud.vision.v1.UpdateProductSetRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.ProductSet;
      reader.readMessage(value,proto.google.cloud.vision.v1.ProductSet.deserializeBinaryFromReader);
      msg.setProductSet(value);
      break;
    case 2:
      var value = new google_protobuf_field_mask_pb.FieldMask;
      reader.readMessage(value,google_protobuf_field_mask_pb.FieldMask.deserializeBinaryFromReader);
      msg.setUpdateMask(value);
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
proto.google.cloud.vision.v1.UpdateProductSetRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.UpdateProductSetRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.UpdateProductSetRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.UpdateProductSetRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProductSet();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.google.cloud.vision.v1.ProductSet.serializeBinaryToWriter
    );
  }
  f = message.getUpdateMask();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      google_protobuf_field_mask_pb.FieldMask.serializeBinaryToWriter
    );
  }
};


/**
 * optional ProductSet product_set = 1;
 * @return {?proto.google.cloud.vision.v1.ProductSet}
 */
proto.google.cloud.vision.v1.UpdateProductSetRequest.prototype.getProductSet = function() {
  return /** @type{?proto.google.cloud.vision.v1.ProductSet} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.ProductSet, 1));
};


/**
 * @param {?proto.google.cloud.vision.v1.ProductSet|undefined} value
 * @return {!proto.google.cloud.vision.v1.UpdateProductSetRequest} returns this
*/
proto.google.cloud.vision.v1.UpdateProductSetRequest.prototype.setProductSet = function(value) {
  return jspb.Message.setWrapperField(this, 1, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.UpdateProductSetRequest} returns this
 */
proto.google.cloud.vision.v1.UpdateProductSetRequest.prototype.clearProductSet = function() {
  return this.setProductSet(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.UpdateProductSetRequest.prototype.hasProductSet = function() {
  return jspb.Message.getField(this, 1) != null;
};


/**
 * optional google.protobuf.FieldMask update_mask = 2;
 * @return {?proto.google.protobuf.FieldMask}
 */
proto.google.cloud.vision.v1.UpdateProductSetRequest.prototype.getUpdateMask = function() {
  return /** @type{?proto.google.protobuf.FieldMask} */ (
    jspb.Message.getWrapperField(this, google_protobuf_field_mask_pb.FieldMask, 2));
};


/**
 * @param {?proto.google.protobuf.FieldMask|undefined} value
 * @return {!proto.google.cloud.vision.v1.UpdateProductSetRequest} returns this
*/
proto.google.cloud.vision.v1.UpdateProductSetRequest.prototype.setUpdateMask = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.UpdateProductSetRequest} returns this
 */
proto.google.cloud.vision.v1.UpdateProductSetRequest.prototype.clearUpdateMask = function() {
  return this.setUpdateMask(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.UpdateProductSetRequest.prototype.hasUpdateMask = function() {
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
proto.google.cloud.vision.v1.DeleteProductSetRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.DeleteProductSetRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.DeleteProductSetRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.DeleteProductSetRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    name: jspb.Message.getFieldWithDefault(msg, 1, "")
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
 * @return {!proto.google.cloud.vision.v1.DeleteProductSetRequest}
 */
proto.google.cloud.vision.v1.DeleteProductSetRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.DeleteProductSetRequest;
  return proto.google.cloud.vision.v1.DeleteProductSetRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.DeleteProductSetRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.DeleteProductSetRequest}
 */
proto.google.cloud.vision.v1.DeleteProductSetRequest.deserializeBinaryFromReader = function(msg, reader) {
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
proto.google.cloud.vision.v1.DeleteProductSetRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.DeleteProductSetRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.DeleteProductSetRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.DeleteProductSetRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.DeleteProductSetRequest.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.DeleteProductSetRequest} returns this
 */
proto.google.cloud.vision.v1.DeleteProductSetRequest.prototype.setName = function(value) {
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
proto.google.cloud.vision.v1.CreateReferenceImageRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.CreateReferenceImageRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.CreateReferenceImageRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.CreateReferenceImageRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    parent: jspb.Message.getFieldWithDefault(msg, 1, ""),
    referenceImage: (f = msg.getReferenceImage()) && proto.google.cloud.vision.v1.ReferenceImage.toObject(includeInstance, f),
    referenceImageId: jspb.Message.getFieldWithDefault(msg, 3, "")
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
 * @return {!proto.google.cloud.vision.v1.CreateReferenceImageRequest}
 */
proto.google.cloud.vision.v1.CreateReferenceImageRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.CreateReferenceImageRequest;
  return proto.google.cloud.vision.v1.CreateReferenceImageRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.CreateReferenceImageRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.CreateReferenceImageRequest}
 */
proto.google.cloud.vision.v1.CreateReferenceImageRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setParent(value);
      break;
    case 2:
      var value = new proto.google.cloud.vision.v1.ReferenceImage;
      reader.readMessage(value,proto.google.cloud.vision.v1.ReferenceImage.deserializeBinaryFromReader);
      msg.setReferenceImage(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setReferenceImageId(value);
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
proto.google.cloud.vision.v1.CreateReferenceImageRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.CreateReferenceImageRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.CreateReferenceImageRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.CreateReferenceImageRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getParent();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getReferenceImage();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.google.cloud.vision.v1.ReferenceImage.serializeBinaryToWriter
    );
  }
  f = message.getReferenceImageId();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
};


/**
 * optional string parent = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.CreateReferenceImageRequest.prototype.getParent = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.CreateReferenceImageRequest} returns this
 */
proto.google.cloud.vision.v1.CreateReferenceImageRequest.prototype.setParent = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional ReferenceImage reference_image = 2;
 * @return {?proto.google.cloud.vision.v1.ReferenceImage}
 */
proto.google.cloud.vision.v1.CreateReferenceImageRequest.prototype.getReferenceImage = function() {
  return /** @type{?proto.google.cloud.vision.v1.ReferenceImage} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.ReferenceImage, 2));
};


/**
 * @param {?proto.google.cloud.vision.v1.ReferenceImage|undefined} value
 * @return {!proto.google.cloud.vision.v1.CreateReferenceImageRequest} returns this
*/
proto.google.cloud.vision.v1.CreateReferenceImageRequest.prototype.setReferenceImage = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.CreateReferenceImageRequest} returns this
 */
proto.google.cloud.vision.v1.CreateReferenceImageRequest.prototype.clearReferenceImage = function() {
  return this.setReferenceImage(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.CreateReferenceImageRequest.prototype.hasReferenceImage = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional string reference_image_id = 3;
 * @return {string}
 */
proto.google.cloud.vision.v1.CreateReferenceImageRequest.prototype.getReferenceImageId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.CreateReferenceImageRequest} returns this
 */
proto.google.cloud.vision.v1.CreateReferenceImageRequest.prototype.setReferenceImageId = function(value) {
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
proto.google.cloud.vision.v1.ListReferenceImagesRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ListReferenceImagesRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ListReferenceImagesRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListReferenceImagesRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    parent: jspb.Message.getFieldWithDefault(msg, 1, ""),
    pageSize: jspb.Message.getFieldWithDefault(msg, 2, 0),
    pageToken: jspb.Message.getFieldWithDefault(msg, 3, "")
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
 * @return {!proto.google.cloud.vision.v1.ListReferenceImagesRequest}
 */
proto.google.cloud.vision.v1.ListReferenceImagesRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ListReferenceImagesRequest;
  return proto.google.cloud.vision.v1.ListReferenceImagesRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ListReferenceImagesRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ListReferenceImagesRequest}
 */
proto.google.cloud.vision.v1.ListReferenceImagesRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setParent(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt32());
      msg.setPageSize(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setPageToken(value);
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
proto.google.cloud.vision.v1.ListReferenceImagesRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ListReferenceImagesRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ListReferenceImagesRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListReferenceImagesRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getParent();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getPageSize();
  if (f !== 0) {
    writer.writeInt32(
      2,
      f
    );
  }
  f = message.getPageToken();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
};


/**
 * optional string parent = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.ListReferenceImagesRequest.prototype.getParent = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ListReferenceImagesRequest} returns this
 */
proto.google.cloud.vision.v1.ListReferenceImagesRequest.prototype.setParent = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int32 page_size = 2;
 * @return {number}
 */
proto.google.cloud.vision.v1.ListReferenceImagesRequest.prototype.getPageSize = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.ListReferenceImagesRequest} returns this
 */
proto.google.cloud.vision.v1.ListReferenceImagesRequest.prototype.setPageSize = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional string page_token = 3;
 * @return {string}
 */
proto.google.cloud.vision.v1.ListReferenceImagesRequest.prototype.getPageToken = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ListReferenceImagesRequest} returns this
 */
proto.google.cloud.vision.v1.ListReferenceImagesRequest.prototype.setPageToken = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.ListReferenceImagesResponse.repeatedFields_ = [1];



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
proto.google.cloud.vision.v1.ListReferenceImagesResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ListReferenceImagesResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ListReferenceImagesResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListReferenceImagesResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    referenceImagesList: jspb.Message.toObjectList(msg.getReferenceImagesList(),
    proto.google.cloud.vision.v1.ReferenceImage.toObject, includeInstance),
    pageSize: jspb.Message.getFieldWithDefault(msg, 2, 0),
    nextPageToken: jspb.Message.getFieldWithDefault(msg, 3, "")
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
 * @return {!proto.google.cloud.vision.v1.ListReferenceImagesResponse}
 */
proto.google.cloud.vision.v1.ListReferenceImagesResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ListReferenceImagesResponse;
  return proto.google.cloud.vision.v1.ListReferenceImagesResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ListReferenceImagesResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ListReferenceImagesResponse}
 */
proto.google.cloud.vision.v1.ListReferenceImagesResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.ReferenceImage;
      reader.readMessage(value,proto.google.cloud.vision.v1.ReferenceImage.deserializeBinaryFromReader);
      msg.addReferenceImages(value);
      break;
    case 2:
      var value = /** @type {number} */ (reader.readInt32());
      msg.setPageSize(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setNextPageToken(value);
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
proto.google.cloud.vision.v1.ListReferenceImagesResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ListReferenceImagesResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ListReferenceImagesResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListReferenceImagesResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getReferenceImagesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.google.cloud.vision.v1.ReferenceImage.serializeBinaryToWriter
    );
  }
  f = message.getPageSize();
  if (f !== 0) {
    writer.writeInt32(
      2,
      f
    );
  }
  f = message.getNextPageToken();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
};


/**
 * repeated ReferenceImage reference_images = 1;
 * @return {!Array<!proto.google.cloud.vision.v1.ReferenceImage>}
 */
proto.google.cloud.vision.v1.ListReferenceImagesResponse.prototype.getReferenceImagesList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.ReferenceImage>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.ReferenceImage, 1));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.ReferenceImage>} value
 * @return {!proto.google.cloud.vision.v1.ListReferenceImagesResponse} returns this
*/
proto.google.cloud.vision.v1.ListReferenceImagesResponse.prototype.setReferenceImagesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.ReferenceImage=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.ReferenceImage}
 */
proto.google.cloud.vision.v1.ListReferenceImagesResponse.prototype.addReferenceImages = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.google.cloud.vision.v1.ReferenceImage, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.ListReferenceImagesResponse} returns this
 */
proto.google.cloud.vision.v1.ListReferenceImagesResponse.prototype.clearReferenceImagesList = function() {
  return this.setReferenceImagesList([]);
};


/**
 * optional int32 page_size = 2;
 * @return {number}
 */
proto.google.cloud.vision.v1.ListReferenceImagesResponse.prototype.getPageSize = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.ListReferenceImagesResponse} returns this
 */
proto.google.cloud.vision.v1.ListReferenceImagesResponse.prototype.setPageSize = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional string next_page_token = 3;
 * @return {string}
 */
proto.google.cloud.vision.v1.ListReferenceImagesResponse.prototype.getNextPageToken = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ListReferenceImagesResponse} returns this
 */
proto.google.cloud.vision.v1.ListReferenceImagesResponse.prototype.setNextPageToken = function(value) {
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
proto.google.cloud.vision.v1.GetReferenceImageRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.GetReferenceImageRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.GetReferenceImageRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.GetReferenceImageRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    name: jspb.Message.getFieldWithDefault(msg, 1, "")
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
 * @return {!proto.google.cloud.vision.v1.GetReferenceImageRequest}
 */
proto.google.cloud.vision.v1.GetReferenceImageRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.GetReferenceImageRequest;
  return proto.google.cloud.vision.v1.GetReferenceImageRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.GetReferenceImageRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.GetReferenceImageRequest}
 */
proto.google.cloud.vision.v1.GetReferenceImageRequest.deserializeBinaryFromReader = function(msg, reader) {
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
proto.google.cloud.vision.v1.GetReferenceImageRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.GetReferenceImageRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.GetReferenceImageRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.GetReferenceImageRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.GetReferenceImageRequest.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.GetReferenceImageRequest} returns this
 */
proto.google.cloud.vision.v1.GetReferenceImageRequest.prototype.setName = function(value) {
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
proto.google.cloud.vision.v1.DeleteReferenceImageRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.DeleteReferenceImageRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.DeleteReferenceImageRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.DeleteReferenceImageRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    name: jspb.Message.getFieldWithDefault(msg, 1, "")
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
 * @return {!proto.google.cloud.vision.v1.DeleteReferenceImageRequest}
 */
proto.google.cloud.vision.v1.DeleteReferenceImageRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.DeleteReferenceImageRequest;
  return proto.google.cloud.vision.v1.DeleteReferenceImageRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.DeleteReferenceImageRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.DeleteReferenceImageRequest}
 */
proto.google.cloud.vision.v1.DeleteReferenceImageRequest.deserializeBinaryFromReader = function(msg, reader) {
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
proto.google.cloud.vision.v1.DeleteReferenceImageRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.DeleteReferenceImageRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.DeleteReferenceImageRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.DeleteReferenceImageRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.DeleteReferenceImageRequest.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.DeleteReferenceImageRequest} returns this
 */
proto.google.cloud.vision.v1.DeleteReferenceImageRequest.prototype.setName = function(value) {
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
proto.google.cloud.vision.v1.AddProductToProductSetRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.AddProductToProductSetRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.AddProductToProductSetRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AddProductToProductSetRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    name: jspb.Message.getFieldWithDefault(msg, 1, ""),
    product: jspb.Message.getFieldWithDefault(msg, 2, "")
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
 * @return {!proto.google.cloud.vision.v1.AddProductToProductSetRequest}
 */
proto.google.cloud.vision.v1.AddProductToProductSetRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.AddProductToProductSetRequest;
  return proto.google.cloud.vision.v1.AddProductToProductSetRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.AddProductToProductSetRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.AddProductToProductSetRequest}
 */
proto.google.cloud.vision.v1.AddProductToProductSetRequest.deserializeBinaryFromReader = function(msg, reader) {
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
      msg.setProduct(value);
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
proto.google.cloud.vision.v1.AddProductToProductSetRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.AddProductToProductSetRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.AddProductToProductSetRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.AddProductToProductSetRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getProduct();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.AddProductToProductSetRequest.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.AddProductToProductSetRequest} returns this
 */
proto.google.cloud.vision.v1.AddProductToProductSetRequest.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string product = 2;
 * @return {string}
 */
proto.google.cloud.vision.v1.AddProductToProductSetRequest.prototype.getProduct = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.AddProductToProductSetRequest} returns this
 */
proto.google.cloud.vision.v1.AddProductToProductSetRequest.prototype.setProduct = function(value) {
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
proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    name: jspb.Message.getFieldWithDefault(msg, 1, ""),
    product: jspb.Message.getFieldWithDefault(msg, 2, "")
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
 * @return {!proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest}
 */
proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest;
  return proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest}
 */
proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest.deserializeBinaryFromReader = function(msg, reader) {
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
      msg.setProduct(value);
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
proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getProduct();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest} returns this
 */
proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional string product = 2;
 * @return {string}
 */
proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest.prototype.getProduct = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest} returns this
 */
proto.google.cloud.vision.v1.RemoveProductFromProductSetRequest.prototype.setProduct = function(value) {
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
proto.google.cloud.vision.v1.ListProductsInProductSetRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ListProductsInProductSetRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ListProductsInProductSetRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListProductsInProductSetRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    name: jspb.Message.getFieldWithDefault(msg, 1, ""),
    pageSize: jspb.Message.getFieldWithDefault(msg, 2, 0),
    pageToken: jspb.Message.getFieldWithDefault(msg, 3, "")
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
 * @return {!proto.google.cloud.vision.v1.ListProductsInProductSetRequest}
 */
proto.google.cloud.vision.v1.ListProductsInProductSetRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ListProductsInProductSetRequest;
  return proto.google.cloud.vision.v1.ListProductsInProductSetRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ListProductsInProductSetRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ListProductsInProductSetRequest}
 */
proto.google.cloud.vision.v1.ListProductsInProductSetRequest.deserializeBinaryFromReader = function(msg, reader) {
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
      var value = /** @type {number} */ (reader.readInt32());
      msg.setPageSize(value);
      break;
    case 3:
      var value = /** @type {string} */ (reader.readString());
      msg.setPageToken(value);
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
proto.google.cloud.vision.v1.ListProductsInProductSetRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ListProductsInProductSetRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ListProductsInProductSetRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListProductsInProductSetRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getName();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getPageSize();
  if (f !== 0) {
    writer.writeInt32(
      2,
      f
    );
  }
  f = message.getPageToken();
  if (f.length > 0) {
    writer.writeString(
      3,
      f
    );
  }
};


/**
 * optional string name = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.ListProductsInProductSetRequest.prototype.getName = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ListProductsInProductSetRequest} returns this
 */
proto.google.cloud.vision.v1.ListProductsInProductSetRequest.prototype.setName = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional int32 page_size = 2;
 * @return {number}
 */
proto.google.cloud.vision.v1.ListProductsInProductSetRequest.prototype.getPageSize = function() {
  return /** @type {number} */ (jspb.Message.getFieldWithDefault(this, 2, 0));
};


/**
 * @param {number} value
 * @return {!proto.google.cloud.vision.v1.ListProductsInProductSetRequest} returns this
 */
proto.google.cloud.vision.v1.ListProductsInProductSetRequest.prototype.setPageSize = function(value) {
  return jspb.Message.setProto3IntField(this, 2, value);
};


/**
 * optional string page_token = 3;
 * @return {string}
 */
proto.google.cloud.vision.v1.ListProductsInProductSetRequest.prototype.getPageToken = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 3, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ListProductsInProductSetRequest} returns this
 */
proto.google.cloud.vision.v1.ListProductsInProductSetRequest.prototype.setPageToken = function(value) {
  return jspb.Message.setProto3StringField(this, 3, value);
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.ListProductsInProductSetResponse.repeatedFields_ = [1];



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
proto.google.cloud.vision.v1.ListProductsInProductSetResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ListProductsInProductSetResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ListProductsInProductSetResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListProductsInProductSetResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    productsList: jspb.Message.toObjectList(msg.getProductsList(),
    proto.google.cloud.vision.v1.Product.toObject, includeInstance),
    nextPageToken: jspb.Message.getFieldWithDefault(msg, 2, "")
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
 * @return {!proto.google.cloud.vision.v1.ListProductsInProductSetResponse}
 */
proto.google.cloud.vision.v1.ListProductsInProductSetResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ListProductsInProductSetResponse;
  return proto.google.cloud.vision.v1.ListProductsInProductSetResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ListProductsInProductSetResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ListProductsInProductSetResponse}
 */
proto.google.cloud.vision.v1.ListProductsInProductSetResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.Product;
      reader.readMessage(value,proto.google.cloud.vision.v1.Product.deserializeBinaryFromReader);
      msg.addProducts(value);
      break;
    case 2:
      var value = /** @type {string} */ (reader.readString());
      msg.setNextPageToken(value);
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
proto.google.cloud.vision.v1.ListProductsInProductSetResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ListProductsInProductSetResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ListProductsInProductSetResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ListProductsInProductSetResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProductsList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.google.cloud.vision.v1.Product.serializeBinaryToWriter
    );
  }
  f = message.getNextPageToken();
  if (f.length > 0) {
    writer.writeString(
      2,
      f
    );
  }
};


/**
 * repeated Product products = 1;
 * @return {!Array<!proto.google.cloud.vision.v1.Product>}
 */
proto.google.cloud.vision.v1.ListProductsInProductSetResponse.prototype.getProductsList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.Product>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.Product, 1));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.Product>} value
 * @return {!proto.google.cloud.vision.v1.ListProductsInProductSetResponse} returns this
*/
proto.google.cloud.vision.v1.ListProductsInProductSetResponse.prototype.setProductsList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.Product=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.Product}
 */
proto.google.cloud.vision.v1.ListProductsInProductSetResponse.prototype.addProducts = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.google.cloud.vision.v1.Product, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.ListProductsInProductSetResponse} returns this
 */
proto.google.cloud.vision.v1.ListProductsInProductSetResponse.prototype.clearProductsList = function() {
  return this.setProductsList([]);
};


/**
 * optional string next_page_token = 2;
 * @return {string}
 */
proto.google.cloud.vision.v1.ListProductsInProductSetResponse.prototype.getNextPageToken = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 2, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ListProductsInProductSetResponse} returns this
 */
proto.google.cloud.vision.v1.ListProductsInProductSetResponse.prototype.setNextPageToken = function(value) {
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
proto.google.cloud.vision.v1.ImportProductSetsGcsSource.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ImportProductSetsGcsSource.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ImportProductSetsGcsSource} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImportProductSetsGcsSource.toObject = function(includeInstance, msg) {
  var f, obj = {
    csvFileUri: jspb.Message.getFieldWithDefault(msg, 1, "")
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
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsGcsSource}
 */
proto.google.cloud.vision.v1.ImportProductSetsGcsSource.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ImportProductSetsGcsSource;
  return proto.google.cloud.vision.v1.ImportProductSetsGcsSource.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ImportProductSetsGcsSource} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsGcsSource}
 */
proto.google.cloud.vision.v1.ImportProductSetsGcsSource.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setCsvFileUri(value);
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
proto.google.cloud.vision.v1.ImportProductSetsGcsSource.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ImportProductSetsGcsSource.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ImportProductSetsGcsSource} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImportProductSetsGcsSource.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getCsvFileUri();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
};


/**
 * optional string csv_file_uri = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.ImportProductSetsGcsSource.prototype.getCsvFileUri = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsGcsSource} returns this
 */
proto.google.cloud.vision.v1.ImportProductSetsGcsSource.prototype.setCsvFileUri = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};



/**
 * Oneof group definitions for this message. Each group defines the field
 * numbers belonging to that group. When of these fields' value is set, all
 * other fields in the group are cleared. During deserialization, if multiple
 * fields are encountered for a group, only the last value seen will be kept.
 * @private {!Array<!Array<number>>}
 * @const
 */
proto.google.cloud.vision.v1.ImportProductSetsInputConfig.oneofGroups_ = [[1]];

/**
 * @enum {number}
 */
proto.google.cloud.vision.v1.ImportProductSetsInputConfig.SourceCase = {
  SOURCE_NOT_SET: 0,
  GCS_SOURCE: 1
};

/**
 * @return {proto.google.cloud.vision.v1.ImportProductSetsInputConfig.SourceCase}
 */
proto.google.cloud.vision.v1.ImportProductSetsInputConfig.prototype.getSourceCase = function() {
  return /** @type {proto.google.cloud.vision.v1.ImportProductSetsInputConfig.SourceCase} */(jspb.Message.computeOneofCase(this, proto.google.cloud.vision.v1.ImportProductSetsInputConfig.oneofGroups_[0]));
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
proto.google.cloud.vision.v1.ImportProductSetsInputConfig.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ImportProductSetsInputConfig.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ImportProductSetsInputConfig} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImportProductSetsInputConfig.toObject = function(includeInstance, msg) {
  var f, obj = {
    gcsSource: (f = msg.getGcsSource()) && proto.google.cloud.vision.v1.ImportProductSetsGcsSource.toObject(includeInstance, f)
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
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsInputConfig}
 */
proto.google.cloud.vision.v1.ImportProductSetsInputConfig.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ImportProductSetsInputConfig;
  return proto.google.cloud.vision.v1.ImportProductSetsInputConfig.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ImportProductSetsInputConfig} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsInputConfig}
 */
proto.google.cloud.vision.v1.ImportProductSetsInputConfig.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.ImportProductSetsGcsSource;
      reader.readMessage(value,proto.google.cloud.vision.v1.ImportProductSetsGcsSource.deserializeBinaryFromReader);
      msg.setGcsSource(value);
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
proto.google.cloud.vision.v1.ImportProductSetsInputConfig.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ImportProductSetsInputConfig.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ImportProductSetsInputConfig} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImportProductSetsInputConfig.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getGcsSource();
  if (f != null) {
    writer.writeMessage(
      1,
      f,
      proto.google.cloud.vision.v1.ImportProductSetsGcsSource.serializeBinaryToWriter
    );
  }
};


/**
 * optional ImportProductSetsGcsSource gcs_source = 1;
 * @return {?proto.google.cloud.vision.v1.ImportProductSetsGcsSource}
 */
proto.google.cloud.vision.v1.ImportProductSetsInputConfig.prototype.getGcsSource = function() {
  return /** @type{?proto.google.cloud.vision.v1.ImportProductSetsGcsSource} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.ImportProductSetsGcsSource, 1));
};


/**
 * @param {?proto.google.cloud.vision.v1.ImportProductSetsGcsSource|undefined} value
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsInputConfig} returns this
*/
proto.google.cloud.vision.v1.ImportProductSetsInputConfig.prototype.setGcsSource = function(value) {
  return jspb.Message.setOneofWrapperField(this, 1, proto.google.cloud.vision.v1.ImportProductSetsInputConfig.oneofGroups_[0], value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsInputConfig} returns this
 */
proto.google.cloud.vision.v1.ImportProductSetsInputConfig.prototype.clearGcsSource = function() {
  return this.setGcsSource(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.ImportProductSetsInputConfig.prototype.hasGcsSource = function() {
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
proto.google.cloud.vision.v1.ImportProductSetsRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ImportProductSetsRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ImportProductSetsRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImportProductSetsRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    parent: jspb.Message.getFieldWithDefault(msg, 1, ""),
    inputConfig: (f = msg.getInputConfig()) && proto.google.cloud.vision.v1.ImportProductSetsInputConfig.toObject(includeInstance, f)
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
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsRequest}
 */
proto.google.cloud.vision.v1.ImportProductSetsRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ImportProductSetsRequest;
  return proto.google.cloud.vision.v1.ImportProductSetsRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ImportProductSetsRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsRequest}
 */
proto.google.cloud.vision.v1.ImportProductSetsRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setParent(value);
      break;
    case 2:
      var value = new proto.google.cloud.vision.v1.ImportProductSetsInputConfig;
      reader.readMessage(value,proto.google.cloud.vision.v1.ImportProductSetsInputConfig.deserializeBinaryFromReader);
      msg.setInputConfig(value);
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
proto.google.cloud.vision.v1.ImportProductSetsRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ImportProductSetsRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ImportProductSetsRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImportProductSetsRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getParent();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getInputConfig();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.google.cloud.vision.v1.ImportProductSetsInputConfig.serializeBinaryToWriter
    );
  }
};


/**
 * optional string parent = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.ImportProductSetsRequest.prototype.getParent = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsRequest} returns this
 */
proto.google.cloud.vision.v1.ImportProductSetsRequest.prototype.setParent = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional ImportProductSetsInputConfig input_config = 2;
 * @return {?proto.google.cloud.vision.v1.ImportProductSetsInputConfig}
 */
proto.google.cloud.vision.v1.ImportProductSetsRequest.prototype.getInputConfig = function() {
  return /** @type{?proto.google.cloud.vision.v1.ImportProductSetsInputConfig} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.ImportProductSetsInputConfig, 2));
};


/**
 * @param {?proto.google.cloud.vision.v1.ImportProductSetsInputConfig|undefined} value
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsRequest} returns this
*/
proto.google.cloud.vision.v1.ImportProductSetsRequest.prototype.setInputConfig = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsRequest} returns this
 */
proto.google.cloud.vision.v1.ImportProductSetsRequest.prototype.clearInputConfig = function() {
  return this.setInputConfig(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.ImportProductSetsRequest.prototype.hasInputConfig = function() {
  return jspb.Message.getField(this, 2) != null;
};



/**
 * List of repeated fields within this message type.
 * @private {!Array<number>}
 * @const
 */
proto.google.cloud.vision.v1.ImportProductSetsResponse.repeatedFields_ = [1,2];



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
proto.google.cloud.vision.v1.ImportProductSetsResponse.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ImportProductSetsResponse.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ImportProductSetsResponse} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImportProductSetsResponse.toObject = function(includeInstance, msg) {
  var f, obj = {
    referenceImagesList: jspb.Message.toObjectList(msg.getReferenceImagesList(),
    proto.google.cloud.vision.v1.ReferenceImage.toObject, includeInstance),
    statusesList: jspb.Message.toObjectList(msg.getStatusesList(),
    google_rpc_status_pb.Status.toObject, includeInstance)
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
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsResponse}
 */
proto.google.cloud.vision.v1.ImportProductSetsResponse.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ImportProductSetsResponse;
  return proto.google.cloud.vision.v1.ImportProductSetsResponse.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ImportProductSetsResponse} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsResponse}
 */
proto.google.cloud.vision.v1.ImportProductSetsResponse.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = new proto.google.cloud.vision.v1.ReferenceImage;
      reader.readMessage(value,proto.google.cloud.vision.v1.ReferenceImage.deserializeBinaryFromReader);
      msg.addReferenceImages(value);
      break;
    case 2:
      var value = new google_rpc_status_pb.Status;
      reader.readMessage(value,google_rpc_status_pb.Status.deserializeBinaryFromReader);
      msg.addStatuses(value);
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
proto.google.cloud.vision.v1.ImportProductSetsResponse.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ImportProductSetsResponse.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ImportProductSetsResponse} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ImportProductSetsResponse.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getReferenceImagesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      1,
      f,
      proto.google.cloud.vision.v1.ReferenceImage.serializeBinaryToWriter
    );
  }
  f = message.getStatusesList();
  if (f.length > 0) {
    writer.writeRepeatedMessage(
      2,
      f,
      google_rpc_status_pb.Status.serializeBinaryToWriter
    );
  }
};


/**
 * repeated ReferenceImage reference_images = 1;
 * @return {!Array<!proto.google.cloud.vision.v1.ReferenceImage>}
 */
proto.google.cloud.vision.v1.ImportProductSetsResponse.prototype.getReferenceImagesList = function() {
  return /** @type{!Array<!proto.google.cloud.vision.v1.ReferenceImage>} */ (
    jspb.Message.getRepeatedWrapperField(this, proto.google.cloud.vision.v1.ReferenceImage, 1));
};


/**
 * @param {!Array<!proto.google.cloud.vision.v1.ReferenceImage>} value
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsResponse} returns this
*/
proto.google.cloud.vision.v1.ImportProductSetsResponse.prototype.setReferenceImagesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 1, value);
};


/**
 * @param {!proto.google.cloud.vision.v1.ReferenceImage=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.cloud.vision.v1.ReferenceImage}
 */
proto.google.cloud.vision.v1.ImportProductSetsResponse.prototype.addReferenceImages = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 1, opt_value, proto.google.cloud.vision.v1.ReferenceImage, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsResponse} returns this
 */
proto.google.cloud.vision.v1.ImportProductSetsResponse.prototype.clearReferenceImagesList = function() {
  return this.setReferenceImagesList([]);
};


/**
 * repeated google.rpc.Status statuses = 2;
 * @return {!Array<!proto.google.rpc.Status>}
 */
proto.google.cloud.vision.v1.ImportProductSetsResponse.prototype.getStatusesList = function() {
  return /** @type{!Array<!proto.google.rpc.Status>} */ (
    jspb.Message.getRepeatedWrapperField(this, google_rpc_status_pb.Status, 2));
};


/**
 * @param {!Array<!proto.google.rpc.Status>} value
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsResponse} returns this
*/
proto.google.cloud.vision.v1.ImportProductSetsResponse.prototype.setStatusesList = function(value) {
  return jspb.Message.setRepeatedWrapperField(this, 2, value);
};


/**
 * @param {!proto.google.rpc.Status=} opt_value
 * @param {number=} opt_index
 * @return {!proto.google.rpc.Status}
 */
proto.google.cloud.vision.v1.ImportProductSetsResponse.prototype.addStatuses = function(opt_value, opt_index) {
  return jspb.Message.addToRepeatedWrapperField(this, 2, opt_value, proto.google.rpc.Status, opt_index);
};


/**
 * Clears the list making it empty but non-null.
 * @return {!proto.google.cloud.vision.v1.ImportProductSetsResponse} returns this
 */
proto.google.cloud.vision.v1.ImportProductSetsResponse.prototype.clearStatusesList = function() {
  return this.setStatusesList([]);
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
proto.google.cloud.vision.v1.BatchOperationMetadata.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.BatchOperationMetadata.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.BatchOperationMetadata} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.BatchOperationMetadata.toObject = function(includeInstance, msg) {
  var f, obj = {
    state: jspb.Message.getFieldWithDefault(msg, 1, 0),
    submitTime: (f = msg.getSubmitTime()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f),
    endTime: (f = msg.getEndTime()) && google_protobuf_timestamp_pb.Timestamp.toObject(includeInstance, f)
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
 * @return {!proto.google.cloud.vision.v1.BatchOperationMetadata}
 */
proto.google.cloud.vision.v1.BatchOperationMetadata.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.BatchOperationMetadata;
  return proto.google.cloud.vision.v1.BatchOperationMetadata.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.BatchOperationMetadata} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.BatchOperationMetadata}
 */
proto.google.cloud.vision.v1.BatchOperationMetadata.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {!proto.google.cloud.vision.v1.BatchOperationMetadata.State} */ (reader.readEnum());
      msg.setState(value);
      break;
    case 2:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setSubmitTime(value);
      break;
    case 3:
      var value = new google_protobuf_timestamp_pb.Timestamp;
      reader.readMessage(value,google_protobuf_timestamp_pb.Timestamp.deserializeBinaryFromReader);
      msg.setEndTime(value);
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
proto.google.cloud.vision.v1.BatchOperationMetadata.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.BatchOperationMetadata.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.BatchOperationMetadata} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.BatchOperationMetadata.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getState();
  if (f !== 0.0) {
    writer.writeEnum(
      1,
      f
    );
  }
  f = message.getSubmitTime();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
  f = message.getEndTime();
  if (f != null) {
    writer.writeMessage(
      3,
      f,
      google_protobuf_timestamp_pb.Timestamp.serializeBinaryToWriter
    );
  }
};


/**
 * @enum {number}
 */
proto.google.cloud.vision.v1.BatchOperationMetadata.State = {
  STATE_UNSPECIFIED: 0,
  PROCESSING: 1,
  SUCCESSFUL: 2,
  FAILED: 3,
  CANCELLED: 4
};

/**
 * optional State state = 1;
 * @return {!proto.google.cloud.vision.v1.BatchOperationMetadata.State}
 */
proto.google.cloud.vision.v1.BatchOperationMetadata.prototype.getState = function() {
  return /** @type {!proto.google.cloud.vision.v1.BatchOperationMetadata.State} */ (jspb.Message.getFieldWithDefault(this, 1, 0));
};


/**
 * @param {!proto.google.cloud.vision.v1.BatchOperationMetadata.State} value
 * @return {!proto.google.cloud.vision.v1.BatchOperationMetadata} returns this
 */
proto.google.cloud.vision.v1.BatchOperationMetadata.prototype.setState = function(value) {
  return jspb.Message.setProto3EnumField(this, 1, value);
};


/**
 * optional google.protobuf.Timestamp submit_time = 2;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.google.cloud.vision.v1.BatchOperationMetadata.prototype.getSubmitTime = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 2));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.google.cloud.vision.v1.BatchOperationMetadata} returns this
*/
proto.google.cloud.vision.v1.BatchOperationMetadata.prototype.setSubmitTime = function(value) {
  return jspb.Message.setWrapperField(this, 2, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.BatchOperationMetadata} returns this
 */
proto.google.cloud.vision.v1.BatchOperationMetadata.prototype.clearSubmitTime = function() {
  return this.setSubmitTime(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.BatchOperationMetadata.prototype.hasSubmitTime = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional google.protobuf.Timestamp end_time = 3;
 * @return {?proto.google.protobuf.Timestamp}
 */
proto.google.cloud.vision.v1.BatchOperationMetadata.prototype.getEndTime = function() {
  return /** @type{?proto.google.protobuf.Timestamp} */ (
    jspb.Message.getWrapperField(this, google_protobuf_timestamp_pb.Timestamp, 3));
};


/**
 * @param {?proto.google.protobuf.Timestamp|undefined} value
 * @return {!proto.google.cloud.vision.v1.BatchOperationMetadata} returns this
*/
proto.google.cloud.vision.v1.BatchOperationMetadata.prototype.setEndTime = function(value) {
  return jspb.Message.setWrapperField(this, 3, value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.BatchOperationMetadata} returns this
 */
proto.google.cloud.vision.v1.BatchOperationMetadata.prototype.clearEndTime = function() {
  return this.setEndTime(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.BatchOperationMetadata.prototype.hasEndTime = function() {
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
proto.google.cloud.vision.v1.ProductSetPurgeConfig.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.ProductSetPurgeConfig.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.ProductSetPurgeConfig} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ProductSetPurgeConfig.toObject = function(includeInstance, msg) {
  var f, obj = {
    productSetId: jspb.Message.getFieldWithDefault(msg, 1, "")
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
 * @return {!proto.google.cloud.vision.v1.ProductSetPurgeConfig}
 */
proto.google.cloud.vision.v1.ProductSetPurgeConfig.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.ProductSetPurgeConfig;
  return proto.google.cloud.vision.v1.ProductSetPurgeConfig.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.ProductSetPurgeConfig} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.ProductSetPurgeConfig}
 */
proto.google.cloud.vision.v1.ProductSetPurgeConfig.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setProductSetId(value);
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
proto.google.cloud.vision.v1.ProductSetPurgeConfig.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.ProductSetPurgeConfig.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.ProductSetPurgeConfig} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.ProductSetPurgeConfig.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProductSetId();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
};


/**
 * optional string product_set_id = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.ProductSetPurgeConfig.prototype.getProductSetId = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.ProductSetPurgeConfig} returns this
 */
proto.google.cloud.vision.v1.ProductSetPurgeConfig.prototype.setProductSetId = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};



/**
 * Oneof group definitions for this message. Each group defines the field
 * numbers belonging to that group. When of these fields' value is set, all
 * other fields in the group are cleared. During deserialization, if multiple
 * fields are encountered for a group, only the last value seen will be kept.
 * @private {!Array<!Array<number>>}
 * @const
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.oneofGroups_ = [[2,3]];

/**
 * @enum {number}
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.TargetCase = {
  TARGET_NOT_SET: 0,
  PRODUCT_SET_PURGE_CONFIG: 2,
  DELETE_ORPHAN_PRODUCTS: 3
};

/**
 * @return {proto.google.cloud.vision.v1.PurgeProductsRequest.TargetCase}
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.prototype.getTargetCase = function() {
  return /** @type {proto.google.cloud.vision.v1.PurgeProductsRequest.TargetCase} */(jspb.Message.computeOneofCase(this, proto.google.cloud.vision.v1.PurgeProductsRequest.oneofGroups_[0]));
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
proto.google.cloud.vision.v1.PurgeProductsRequest.prototype.toObject = function(opt_includeInstance) {
  return proto.google.cloud.vision.v1.PurgeProductsRequest.toObject(opt_includeInstance, this);
};


/**
 * Static version of the {@see toObject} method.
 * @param {boolean|undefined} includeInstance Deprecated. Whether to include
 *     the JSPB instance for transitional soy proto support:
 *     http://goto/soy-param-migration
 * @param {!proto.google.cloud.vision.v1.PurgeProductsRequest} msg The msg instance to transform.
 * @return {!Object}
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.toObject = function(includeInstance, msg) {
  var f, obj = {
    productSetPurgeConfig: (f = msg.getProductSetPurgeConfig()) && proto.google.cloud.vision.v1.ProductSetPurgeConfig.toObject(includeInstance, f),
    deleteOrphanProducts: jspb.Message.getBooleanFieldWithDefault(msg, 3, false),
    parent: jspb.Message.getFieldWithDefault(msg, 1, ""),
    force: jspb.Message.getBooleanFieldWithDefault(msg, 4, false)
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
 * @return {!proto.google.cloud.vision.v1.PurgeProductsRequest}
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.deserializeBinary = function(bytes) {
  var reader = new jspb.BinaryReader(bytes);
  var msg = new proto.google.cloud.vision.v1.PurgeProductsRequest;
  return proto.google.cloud.vision.v1.PurgeProductsRequest.deserializeBinaryFromReader(msg, reader);
};


/**
 * Deserializes binary data (in protobuf wire format) from the
 * given reader into the given message object.
 * @param {!proto.google.cloud.vision.v1.PurgeProductsRequest} msg The message object to deserialize into.
 * @param {!jspb.BinaryReader} reader The BinaryReader to use.
 * @return {!proto.google.cloud.vision.v1.PurgeProductsRequest}
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.deserializeBinaryFromReader = function(msg, reader) {
  while (reader.nextField()) {
    if (reader.isEndGroup()) {
      break;
    }
    var field = reader.getFieldNumber();
    switch (field) {
    case 2:
      var value = new proto.google.cloud.vision.v1.ProductSetPurgeConfig;
      reader.readMessage(value,proto.google.cloud.vision.v1.ProductSetPurgeConfig.deserializeBinaryFromReader);
      msg.setProductSetPurgeConfig(value);
      break;
    case 3:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setDeleteOrphanProducts(value);
      break;
    case 1:
      var value = /** @type {string} */ (reader.readString());
      msg.setParent(value);
      break;
    case 4:
      var value = /** @type {boolean} */ (reader.readBool());
      msg.setForce(value);
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
proto.google.cloud.vision.v1.PurgeProductsRequest.prototype.serializeBinary = function() {
  var writer = new jspb.BinaryWriter();
  proto.google.cloud.vision.v1.PurgeProductsRequest.serializeBinaryToWriter(this, writer);
  return writer.getResultBuffer();
};


/**
 * Serializes the given message to binary data (in protobuf wire
 * format), writing to the given BinaryWriter.
 * @param {!proto.google.cloud.vision.v1.PurgeProductsRequest} message
 * @param {!jspb.BinaryWriter} writer
 * @suppress {unusedLocalVariables} f is only used for nested messages
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.serializeBinaryToWriter = function(message, writer) {
  var f = undefined;
  f = message.getProductSetPurgeConfig();
  if (f != null) {
    writer.writeMessage(
      2,
      f,
      proto.google.cloud.vision.v1.ProductSetPurgeConfig.serializeBinaryToWriter
    );
  }
  f = /** @type {boolean} */ (jspb.Message.getField(message, 3));
  if (f != null) {
    writer.writeBool(
      3,
      f
    );
  }
  f = message.getParent();
  if (f.length > 0) {
    writer.writeString(
      1,
      f
    );
  }
  f = message.getForce();
  if (f) {
    writer.writeBool(
      4,
      f
    );
  }
};


/**
 * optional ProductSetPurgeConfig product_set_purge_config = 2;
 * @return {?proto.google.cloud.vision.v1.ProductSetPurgeConfig}
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.prototype.getProductSetPurgeConfig = function() {
  return /** @type{?proto.google.cloud.vision.v1.ProductSetPurgeConfig} */ (
    jspb.Message.getWrapperField(this, proto.google.cloud.vision.v1.ProductSetPurgeConfig, 2));
};


/**
 * @param {?proto.google.cloud.vision.v1.ProductSetPurgeConfig|undefined} value
 * @return {!proto.google.cloud.vision.v1.PurgeProductsRequest} returns this
*/
proto.google.cloud.vision.v1.PurgeProductsRequest.prototype.setProductSetPurgeConfig = function(value) {
  return jspb.Message.setOneofWrapperField(this, 2, proto.google.cloud.vision.v1.PurgeProductsRequest.oneofGroups_[0], value);
};


/**
 * Clears the message field making it undefined.
 * @return {!proto.google.cloud.vision.v1.PurgeProductsRequest} returns this
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.prototype.clearProductSetPurgeConfig = function() {
  return this.setProductSetPurgeConfig(undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.prototype.hasProductSetPurgeConfig = function() {
  return jspb.Message.getField(this, 2) != null;
};


/**
 * optional bool delete_orphan_products = 3;
 * @return {boolean}
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.prototype.getDeleteOrphanProducts = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 3, false));
};


/**
 * @param {boolean} value
 * @return {!proto.google.cloud.vision.v1.PurgeProductsRequest} returns this
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.prototype.setDeleteOrphanProducts = function(value) {
  return jspb.Message.setOneofField(this, 3, proto.google.cloud.vision.v1.PurgeProductsRequest.oneofGroups_[0], value);
};


/**
 * Clears the field making it undefined.
 * @return {!proto.google.cloud.vision.v1.PurgeProductsRequest} returns this
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.prototype.clearDeleteOrphanProducts = function() {
  return jspb.Message.setOneofField(this, 3, proto.google.cloud.vision.v1.PurgeProductsRequest.oneofGroups_[0], undefined);
};


/**
 * Returns whether this field is set.
 * @return {boolean}
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.prototype.hasDeleteOrphanProducts = function() {
  return jspb.Message.getField(this, 3) != null;
};


/**
 * optional string parent = 1;
 * @return {string}
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.prototype.getParent = function() {
  return /** @type {string} */ (jspb.Message.getFieldWithDefault(this, 1, ""));
};


/**
 * @param {string} value
 * @return {!proto.google.cloud.vision.v1.PurgeProductsRequest} returns this
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.prototype.setParent = function(value) {
  return jspb.Message.setProto3StringField(this, 1, value);
};


/**
 * optional bool force = 4;
 * @return {boolean}
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.prototype.getForce = function() {
  return /** @type {boolean} */ (jspb.Message.getBooleanFieldWithDefault(this, 4, false));
};


/**
 * @param {boolean} value
 * @return {!proto.google.cloud.vision.v1.PurgeProductsRequest} returns this
 */
proto.google.cloud.vision.v1.PurgeProductsRequest.prototype.setForce = function(value) {
  return jspb.Message.setProto3BooleanField(this, 4, value);
};


goog.object.extend(exports, proto.google.cloud.vision.v1);
