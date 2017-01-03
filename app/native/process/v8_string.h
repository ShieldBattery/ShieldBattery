#pragma once

#include <node.h>
#include <string>

namespace sbat {
namespace proc {

std::wstring ToWstring(const v8::Local<v8::String>& v8_str);

}  // namespace proc
}  // namespace sbat