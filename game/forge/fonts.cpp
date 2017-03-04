#include "forge/fonts.h"

#include <node.h>
#include <Windows.h>
#include <dwrite_2.h>
#include <algorithm>
#include <memory>
#include <vector>

#include "forge/com_utils.h"

using std::unique_ptr;
using std::vector;

namespace sbat {
namespace forge {

unique_ptr<DirectWriteManager> DirectWriteManager::Create() {
  SafeComPtr<IDWriteFactory> factory;
  HRESULT hr = DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory),
    reinterpret_cast<IUnknown**>(&factory));

  if (!SUCCEEDED(hr)) {
    return nullptr;
  }

  unique_ptr<DirectWriteManager> result(new DirectWriteManager(factory.get()));
  return result;
}

#pragma pack(push, 1)
struct SubpixelData {
  byte red;
  byte green;
  byte blue;
};
#pragma pack(pop)

DirectWriteManager::DirectWriteManager(IDWriteFactory* factory)
  : factory_(AddComRef(factory)),
    textureData(),
    textureWidth(0),
    textureHeight(0) {

  
  SafeComPtr<IDWriteFontFile> fontFile;
  if (!SUCCEEDED(factory_->CreateFontFileReference(L"C:\\Roboto-Regular.ttf", NULL, &fontFile))) {
    MessageBoxA(NULL, "Failed to create font file reference", "DirectWrite Error", MB_OK);
    exit(27);
  }

  IDWriteFontFile* fontFileArray[] = { fontFile.get() };
  SafeComPtr<IDWriteFontFace> fontFace;
  if (!SUCCEEDED(factory_->CreateFontFace(DWRITE_FONT_FACE_TYPE_TRUETYPE, 1, fontFileArray,
      0, DWRITE_FONT_SIMULATIONS_NONE, &fontFace))) {
    MessageBoxA(NULL, "Failed to create font face", "DirectWrite Error", MB_OK);
    exit(27);
  }

  uint32_t codePoints[] = {'R', 'r', 'R'};
  uint16_t glyphIndices[3];
  if (!SUCCEEDED(fontFace->GetGlyphIndices(codePoints, 3, glyphIndices))) {
    MessageBoxA(NULL, "Failed to get glyph index", "DirectWrite Error", MB_OK);
    exit(27);
  }

  DWRITE_GLYPH_RUN run = {0};
  run.fontEmSize = 48.f;
  run.fontFace = fontFace.get();
  run.glyphCount = 3;
  run.glyphIndices = glyphIndices;

  SafeComPtr<IDWriteGlyphRunAnalysis> analysis;
  if (!SUCCEEDED(factory_->CreateGlyphRunAnalysis(&run, 1.0f, nullptr,
      DWRITE_RENDERING_MODE_NATURAL_SYMMETRIC, DWRITE_MEASURING_MODE_NATURAL,
      2560.f / 2, 1440.f / 2, &analysis))) {
    MessageBoxA(NULL, "Failed to create run analysis", "DirectWrite Error", MB_OK);
    exit(27);
  }

  RECT textureBounds;
  if (!SUCCEEDED(analysis->GetAlphaTextureBounds(DWRITE_TEXTURE_CLEARTYPE_3x1, &textureBounds))) {
    MessageBoxA(NULL, "Failed to get texture bounds", "DirectWrite Error", MB_OK);
    exit(27);
  }

  textureWidth = textureBounds.right - textureBounds.left;
  textureHeight = textureBounds.bottom - textureBounds.top;
  uint32_t textureSize = textureWidth * textureHeight;
  vector<SubpixelData> subpixelData(textureSize);
  textureData.resize(textureSize);

  if (!SUCCEEDED(analysis->CreateAlphaTexture(DWRITE_TEXTURE_CLEARTYPE_3x1, &textureBounds,
    reinterpret_cast<byte*>(subpixelData.data()), subpixelData.size() * sizeof(SubpixelData)))) {
    MessageBoxA(NULL, "Failed to create alpha texture", "DirectWrite Error", MB_OK);
    exit(27);
  }

  std::transform(subpixelData.begin(), subpixelData.end(), textureData.begin(),
      [](const SubpixelData& data) -> uint32_t {
        /* subpixel rendering method -- doesn't look completely right to me atm
        if (data.red == 0 && data.green == 0 && data.blue == 0) {
          return 0;
        }
        return 0xFF000000 | (data.blue << 16) | (data.green << 8) | data.red;
        */

        // convert to a greyscale alpha value
        byte alpha = static_cast<byte>((static_cast<uint32_t>(data.red) +
            static_cast<uint32_t>(data.green) + static_cast<uint32_t>(data.blue)) / 3);
        return (alpha << 24) | 0xFFFFFF;
      });
}

}  // namespace forge
}  // namespace sbat