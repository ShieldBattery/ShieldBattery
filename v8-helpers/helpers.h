#ifndef V8_HELPERS_HELPERS_H_
#define V8_HELPERS_HELPERS_H_

#include <memory>
#include <string>
#include <vector>

namespace v8 {
template <class T> class Local;
class String;
class Value;
}

namespace sbat {

std::unique_ptr<std::wstring> ToWstring(const v8::Local<v8::String>& v8_str);

// Values that are constructed without a scope, and can have a scope "applied" to them afterwards
// so that we can allocate v8 values from other threads and give them a context later
class ScopelessValue {
public:
  virtual ~ScopelessValue() = 0;
  virtual v8::Local<v8::Value> ApplyCurrentScope() const = 0;
};

class ScopelessSigned;
class ScopelessUnsigned;

class ScopelessInteger : public ScopelessValue {
public:
  static ScopelessSigned* New(int32_t value);
  static ScopelessUnsigned* NewFromUnsigned(uint32_t value);
};

class ScopelessSigned : public ScopelessInteger {
public:
  virtual ~ScopelessSigned();
  virtual v8::Local<v8::Value> ApplyCurrentScope() const;
private:
  explicit ScopelessSigned(int32_t value);
  int32_t value_;
  friend ScopelessInteger;
};

class ScopelessUnsigned : public ScopelessInteger {
public:
  virtual ~ScopelessUnsigned();
  virtual v8::Local<v8::Value> ApplyCurrentScope() const;
private:
  explicit ScopelessUnsigned(uint32_t value);
  uint32_t value_;
  friend ScopelessInteger;
};

// For simplicity, this type assumes you have an exact length in mind that will not change through
// the lifetime of the array. If we have code that needs something more complex, we can implement it
// then.
class ScopelessArray : public ScopelessValue {
public:
  virtual ~ScopelessArray();
  virtual v8::Local<v8::Value> ApplyCurrentScope() const;
  void Set(uint32_t index, std::shared_ptr<ScopelessValue> value);

  static ScopelessArray* New(int length);
private:
  explicit ScopelessArray(int length);
  std::vector<std::shared_ptr<ScopelessValue>> items_;
};

class ScopelessString : public ScopelessValue {
public:
  virtual ~ScopelessString();
  virtual v8::Local<v8::Value> ApplyCurrentScope() const;

  static ScopelessString* New(const std::string& value);
private:
  explicit ScopelessString(const std::string& value);
  std::string value_;
};

}  // namespace sbat

#endif  // V8_HELPERS_HELPERS_H_