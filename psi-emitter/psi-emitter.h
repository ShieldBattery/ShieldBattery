#pragma once

#include <Windows.h>

#include "common/types.h"

namespace sbat {
namespace psiemitter {

HANDLE OpenSlot(wchar_t* slot_name);
bool WriteResolution(HANDLE slot_handle, uint32 width, uint32 height);

}  // namespace psiemitter
}  // namespace sbat
