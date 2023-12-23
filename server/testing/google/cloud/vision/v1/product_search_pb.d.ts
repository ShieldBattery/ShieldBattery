// package: google.cloud.vision.v1
// file: google/cloud/vision/v1/product_search.proto

import * as jspb from "google-protobuf";
import * as google_api_resource_pb from "../../../../google/api/resource_pb";
import * as google_cloud_vision_v1_geometry_pb from "../../../../google/cloud/vision/v1/geometry_pb";
import * as google_cloud_vision_v1_product_search_service_pb from "../../../../google/cloud/vision/v1/product_search_service_pb";
import * as google_protobuf_timestamp_pb from "google-protobuf/google/protobuf/timestamp_pb";

export class ProductSearchParams extends jspb.Message {
  hasBoundingPoly(): boolean;
  clearBoundingPoly(): void;
  getBoundingPoly(): google_cloud_vision_v1_geometry_pb.BoundingPoly | undefined;
  setBoundingPoly(value?: google_cloud_vision_v1_geometry_pb.BoundingPoly): void;

  getProductSet(): string;
  setProductSet(value: string): void;

  clearProductCategoriesList(): void;
  getProductCategoriesList(): Array<string>;
  setProductCategoriesList(value: Array<string>): void;
  addProductCategories(value: string, index?: number): string;

  getFilter(): string;
  setFilter(value: string): void;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ProductSearchParams.AsObject;
  static toObject(includeInstance: boolean, msg: ProductSearchParams): ProductSearchParams.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ProductSearchParams, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ProductSearchParams;
  static deserializeBinaryFromReader(message: ProductSearchParams, reader: jspb.BinaryReader): ProductSearchParams;
}

export namespace ProductSearchParams {
  export type AsObject = {
    boundingPoly?: google_cloud_vision_v1_geometry_pb.BoundingPoly.AsObject,
    productSet: string,
    productCategoriesList: Array<string>,
    filter: string,
  }
}

export class ProductSearchResults extends jspb.Message {
  hasIndexTime(): boolean;
  clearIndexTime(): void;
  getIndexTime(): google_protobuf_timestamp_pb.Timestamp | undefined;
  setIndexTime(value?: google_protobuf_timestamp_pb.Timestamp): void;

  clearResultsList(): void;
  getResultsList(): Array<ProductSearchResults.Result>;
  setResultsList(value: Array<ProductSearchResults.Result>): void;
  addResults(value?: ProductSearchResults.Result, index?: number): ProductSearchResults.Result;

  clearProductGroupedResultsList(): void;
  getProductGroupedResultsList(): Array<ProductSearchResults.GroupedResult>;
  setProductGroupedResultsList(value: Array<ProductSearchResults.GroupedResult>): void;
  addProductGroupedResults(value?: ProductSearchResults.GroupedResult, index?: number): ProductSearchResults.GroupedResult;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): ProductSearchResults.AsObject;
  static toObject(includeInstance: boolean, msg: ProductSearchResults): ProductSearchResults.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: ProductSearchResults, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): ProductSearchResults;
  static deserializeBinaryFromReader(message: ProductSearchResults, reader: jspb.BinaryReader): ProductSearchResults;
}

export namespace ProductSearchResults {
  export type AsObject = {
    indexTime?: google_protobuf_timestamp_pb.Timestamp.AsObject,
    resultsList: Array<ProductSearchResults.Result.AsObject>,
    productGroupedResultsList: Array<ProductSearchResults.GroupedResult.AsObject>,
  }

  export class Result extends jspb.Message {
    hasProduct(): boolean;
    clearProduct(): void;
    getProduct(): google_cloud_vision_v1_product_search_service_pb.Product | undefined;
    setProduct(value?: google_cloud_vision_v1_product_search_service_pb.Product): void;

    getScore(): number;
    setScore(value: number): void;

    getImage(): string;
    setImage(value: string): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): Result.AsObject;
    static toObject(includeInstance: boolean, msg: Result): Result.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: Result, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): Result;
    static deserializeBinaryFromReader(message: Result, reader: jspb.BinaryReader): Result;
  }

  export namespace Result {
    export type AsObject = {
      product?: google_cloud_vision_v1_product_search_service_pb.Product.AsObject,
      score: number,
      image: string,
    }
  }

  export class ObjectAnnotation extends jspb.Message {
    getMid(): string;
    setMid(value: string): void;

    getLanguageCode(): string;
    setLanguageCode(value: string): void;

    getName(): string;
    setName(value: string): void;

    getScore(): number;
    setScore(value: number): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): ObjectAnnotation.AsObject;
    static toObject(includeInstance: boolean, msg: ObjectAnnotation): ObjectAnnotation.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: ObjectAnnotation, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): ObjectAnnotation;
    static deserializeBinaryFromReader(message: ObjectAnnotation, reader: jspb.BinaryReader): ObjectAnnotation;
  }

  export namespace ObjectAnnotation {
    export type AsObject = {
      mid: string,
      languageCode: string,
      name: string,
      score: number,
    }
  }

  export class GroupedResult extends jspb.Message {
    hasBoundingPoly(): boolean;
    clearBoundingPoly(): void;
    getBoundingPoly(): google_cloud_vision_v1_geometry_pb.BoundingPoly | undefined;
    setBoundingPoly(value?: google_cloud_vision_v1_geometry_pb.BoundingPoly): void;

    clearResultsList(): void;
    getResultsList(): Array<ProductSearchResults.Result>;
    setResultsList(value: Array<ProductSearchResults.Result>): void;
    addResults(value?: ProductSearchResults.Result, index?: number): ProductSearchResults.Result;

    clearObjectAnnotationsList(): void;
    getObjectAnnotationsList(): Array<ProductSearchResults.ObjectAnnotation>;
    setObjectAnnotationsList(value: Array<ProductSearchResults.ObjectAnnotation>): void;
    addObjectAnnotations(value?: ProductSearchResults.ObjectAnnotation, index?: number): ProductSearchResults.ObjectAnnotation;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): GroupedResult.AsObject;
    static toObject(includeInstance: boolean, msg: GroupedResult): GroupedResult.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: GroupedResult, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): GroupedResult;
    static deserializeBinaryFromReader(message: GroupedResult, reader: jspb.BinaryReader): GroupedResult;
  }

  export namespace GroupedResult {
    export type AsObject = {
      boundingPoly?: google_cloud_vision_v1_geometry_pb.BoundingPoly.AsObject,
      resultsList: Array<ProductSearchResults.Result.AsObject>,
      objectAnnotationsList: Array<ProductSearchResults.ObjectAnnotation.AsObject>,
    }
  }
}

