#ifndef PSI_EMITTER_PSI_EMITTER_H_
#define PSI_EMITTER_PSI_EMITTER_H_

#include <Windows.h>

#include "common/types.h"

namespace sbat {
namespace psiemitter {

HANDLE OpenSlot(wchar_t* slot_name);
bool WriteResolution(HANDLE slot_handle, uint32 width, uint32 height);

}  // namespace psiemitter
}  // namespace sbat

#endif  // PSI_EMITTER_PSI_EMITTER_H_