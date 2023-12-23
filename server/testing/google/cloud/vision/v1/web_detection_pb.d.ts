// package: google.cloud.vision.v1
// file: google/cloud/vision/v1/web_detection.proto

import * as jspb from "google-protobuf";

export class WebDetection extends jspb.Message {
  clearWebEntitiesList(): void;
  getWebEntitiesList(): Array<WebDetection.WebEntity>;
  setWebEntitiesList(value: Array<WebDetection.WebEntity>): void;
  addWebEntities(value?: WebDetection.WebEntity, index?: number): WebDetection.WebEntity;

  clearFullMatchingImagesList(): void;
  getFullMatchingImagesList(): Array<WebDetection.WebImage>;
  setFullMatchingImagesList(value: Array<WebDetection.WebImage>): void;
  addFullMatchingImages(value?: WebDetection.WebImage, index?: number): WebDetection.WebImage;

  clearPartialMatchingImagesList(): void;
  getPartialMatchingImagesList(): Array<WebDetection.WebImage>;
  setPartialMatchingImagesList(value: Array<WebDetection.WebImage>): void;
  addPartialMatchingImages(value?: WebDetection.WebImage, index?: number): WebDetection.WebImage;

  clearPagesWithMatchingImagesList(): void;
  getPagesWithMatchingImagesList(): Array<WebDetection.WebPage>;
  setPagesWithMatchingImagesList(value: Array<WebDetection.WebPage>): void;
  addPagesWithMatchingImages(value?: WebDetection.WebPage, index?: number): WebDetection.WebPage;

  clearVisuallySimilarImagesList(): void;
  getVisuallySimilarImagesList(): Array<WebDetection.WebImage>;
  setVisuallySimilarImagesList(value: Array<WebDetection.WebImage>): void;
  addVisuallySimilarImages(value?: WebDetection.WebImage, index?: number): WebDetection.WebImage;

  clearBestGuessLabelsList(): void;
  getBestGuessLabelsList(): Array<WebDetection.WebLabel>;
  setBestGuessLabelsList(value: Array<WebDetection.WebLabel>): void;
  addBestGuessLabels(value?: WebDetection.WebLabel, index?: number): WebDetection.WebLabel;

  serializeBinary(): Uint8Array;
  toObject(includeInstance?: boolean): WebDetection.AsObject;
  static toObject(includeInstance: boolean, msg: WebDetection): WebDetection.AsObject;
  static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
  static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
  static serializeBinaryToWriter(message: WebDetection, writer: jspb.BinaryWriter): void;
  static deserializeBinary(bytes: Uint8Array): WebDetection;
  static deserializeBinaryFromReader(message: WebDetection, reader: jspb.BinaryReader): WebDetection;
}

export namespace WebDetection {
  export type AsObject = {
    webEntitiesList: Array<WebDetection.WebEntity.AsObject>,
    fullMatchingImagesList: Array<WebDetection.WebImage.AsObject>,
    partialMatchingImagesList: Array<WebDetection.WebImage.AsObject>,
    pagesWithMatchingImagesList: Array<WebDetection.WebPage.AsObject>,
    visuallySimilarImagesList: Array<WebDetection.WebImage.AsObject>,
    bestGuessLabelsList: Array<WebDetection.WebLabel.AsObject>,
  }

  export class WebEntity extends jspb.Message {
    getEntityId(): string;
    setEntityId(value: string): void;

    getScore(): number;
    setScore(value: number): void;

    getDescription(): string;
    setDescription(value: string): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): WebEntity.AsObject;
    static toObject(includeInstance: boolean, msg: WebEntity): WebEntity.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: WebEntity, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): WebEntity;
    static deserializeBinaryFromReader(message: WebEntity, reader: jspb.BinaryReader): WebEntity;
  }

  export namespace WebEntity {
    export type AsObject = {
      entityId: string,
      score: number,
      description: string,
    }
  }

  export class WebImage extends jspb.Message {
    getUrl(): string;
    setUrl(value: string): void;

    getScore(): number;
    setScore(value: number): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): WebImage.AsObject;
    static toObject(includeInstance: boolean, msg: WebImage): WebImage.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: WebImage, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): WebImage;
    static deserializeBinaryFromReader(message: WebImage, reader: jspb.BinaryReader): WebImage;
  }

  export namespace WebImage {
    export type AsObject = {
      url: string,
      score: number,
    }
  }

  export class WebPage extends jspb.Message {
    getUrl(): string;
    setUrl(value: string): void;

    getScore(): number;
    setScore(value: number): void;

    getPageTitle(): string;
    setPageTitle(value: string): void;

    clearFullMatchingImagesList(): void;
    getFullMatchingImagesList(): Array<WebDetection.WebImage>;
    setFullMatchingImagesList(value: Array<WebDetection.WebImage>): void;
    addFullMatchingImages(value?: WebDetection.WebImage, index?: number): WebDetection.WebImage;

    clearPartialMatchingImagesList(): void;
    getPartialMatchingImagesList(): Array<WebDetection.WebImage>;
    setPartialMatchingImagesList(value: Array<WebDetection.WebImage>): void;
    addPartialMatchingImages(value?: WebDetection.WebImage, index?: number): WebDetection.WebImage;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): WebPage.AsObject;
    static toObject(includeInstance: boolean, msg: WebPage): WebPage.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: WebPage, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): WebPage;
    static deserializeBinaryFromReader(message: WebPage, reader: jspb.BinaryReader): WebPage;
  }

  export namespace WebPage {
    export type AsObject = {
      url: string,
      score: number,
      pageTitle: string,
      fullMatchingImagesList: Array<WebDetection.WebImage.AsObject>,
      partialMatchingImagesList: Array<WebDetection.WebImage.AsObject>,
    }
  }

  export class WebLabel extends jspb.Message {
    getLabel(): string;
    setLabel(value: string): void;

    getLanguageCode(): string;
    setLanguageCode(value: string): void;

    serializeBinary(): Uint8Array;
    toObject(includeInstance?: boolean): WebLabel.AsObject;
    static toObject(includeInstance: boolean, msg: WebLabel): WebLabel.AsObject;
    static extensions: {[key: number]: jspb.ExtensionFieldInfo<jspb.Message>};
    static extensionsBinary: {[key: number]: jspb.ExtensionFieldBinaryInfo<jspb.Message>};
    static serializeBinaryToWriter(message: WebLabel, writer: jspb.BinaryWriter): void;
    static deserializeBinary(bytes: Uint8Array): WebLabel;
    static deserializeBinaryFromReader(message: WebLabel, reader: jspb.BinaryReader): WebLabel;
  }

  export namespace WebLabel {
    export type AsObject = {
      label: string,
      languageCode: string,
    }
  }
}

