#include "v8-helpers/helpers.h"

#include <nan.h>
#include <v8.h>
#include <memory>
#include <string>
#include <vector>

using std::shared_ptr;
using std::string;
using std::unique_ptr;
using std::vector;
using std::wstring;
using v8::Array;
using v8::Local;
using v8::Integer;
using v8::Int32;
using v8::String;
using v8::Uint32;
using v8::Value;

namespace sbat {

unique_ptr<wstring> ToWstring(const Local<String>& v8_str) {
  unique_ptr<wstring> result(new wstring());
  result->resize(v8_str->Length());
  v8_str->Write(reinterpret_cast<uint16_t*>(&(*result)[0]));
  return result;
}

ScopelessValue::~ScopelessValue() {
}

ScopelessSigned* ScopelessInteger::New(int32_t value) {
  return new ScopelessSigned(value);
}

ScopelessUnsigned* ScopelessInteger::NewFromUnsigned(uint32_t value) {
  return new ScopelessUnsigned(value);
}

ScopelessSigned::ScopelessSigned(int32_t value)
    : value_(value) {
}

ScopelessSigned::~ScopelessSigned() { }

ScopelessUnsigned::ScopelessUnsigned(uint32_t value)
  : value_(value) {
}

ScopelessUnsigned::~ScopelessUnsigned() { }

Local<Value> ScopelessSigned::ApplyCurrentScope() const {
    return Nan::New(value_);
}

Local<Value> ScopelessUnsigned::ApplyCurrentScope() const {
    return Nan::New(value_);
}

ScopelessArray::ScopelessArray(int length) : items_(length) {
}

ScopelessArray::~ScopelessArray() {
}

ScopelessArray* ScopelessArray::New(int length) {
  return new ScopelessArray(length);
}

Local<Value> ScopelessArray::ApplyCurrentScope() const {
  Local<Array> result = Nan::New<Array>(items_.size());
  for (size_t i = 0; i < items_.size(); ++i) {
    result->Set(i, items_[i]->ApplyCurrentScope());
  }
  return result;
}

void ScopelessArray::Set(uint32_t index, shared_ptr<ScopelessValue> value) {
  items_[index] = value;
}

ScopelessString::ScopelessString(const string& value) : value_(value) {
}

ScopelessString::~ScopelessString() {
}

ScopelessString* ScopelessString::New(const string& value) {
  return new ScopelessString(value);
}

Local<Value> ScopelessString::ApplyCurrentScope() const {
  return Nan::New(value_.c_str()).ToLocalChecked();
}

}  // namespace sbat