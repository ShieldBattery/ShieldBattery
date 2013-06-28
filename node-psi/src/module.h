#ifndef NODE_PSI_SRC_MODULE_H_
#define NODE_PSI_SRC_MODULE_H_

#include <v8.h>
#include <string>

// TODO(tec27): move to common v8 helper library
std::wstring* ToWstring(const v8::Handle<v8::String>& v8_str);

#endif  // NODE_PSI_SRC_MODULE_H_