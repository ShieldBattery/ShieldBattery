// source: google/api/launch_stage.proto
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

goog.exportSymbol('proto.google.api.LaunchStage', null, global);
/**
 * @enum {number}
 */
proto.google.api.LaunchStage = {
  LAUNCH_STAGE_UNSPECIFIED: 0,
  UNIMPLEMENTED: 6,
  PRELAUNCH: 7,
  EARLY_ACCESS: 1,
  ALPHA: 2,
  BETA: 3,
  GA: 4,
  DEPRECATED: 5
};

goog.object.extend(exports, proto.google.api);
