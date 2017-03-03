#include "forge/fonts.h"

#include <node.h>
#include <Windows.h>
#include <dwrite_2.h>
#include <memory>

#include "forge/com_utils.h"

using std::unique_ptr;

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

DirectWriteManager::DirectWriteManager(IDWriteFactory* factory)
  : factory_(AddComRef(factory)) {
}

}  // namespace forge
}  // namespace sbat