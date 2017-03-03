#pragma once

namespace sbat {
namespace forge {

template<typename ComType>
void ReleaseCom(ComType* obj) {
  if (obj) {
    obj->Release();
  }
}

struct ComDeleter {
public:
  template<typename T>
  void operator()(T* obj) {
    obj->Release();
  }
};

template<typename ComType>
std::unique_ptr<ComType, ComDeleter> WrapComVoid(void* output_ptr) {
  return std::unique_ptr<ComType, ComDeleter>(reinterpret_cast<ComType*>(output_ptr));
}

template<typename ComType>
ComType* AddComRef(ComType* ptr) {
  ptr->AddRef();
  return ptr;
}

template<typename ComType>
ComType* SafeAddComRef(ComType* ptr) {
  if (ptr) {
    ptr->AddRef();
  }
  return ptr;
}

template<typename ComType>
class BlockComRef : public ComType {
private:
  virtual ULONG __stdcall AddRef(void) = 0;
  virtual ULONG __stdcall Release(void) = 0;
};

// A generic wrapper for COM pointers that properly deals with Release when necessary and
// allows access to the underlying object's methods. If you need to add a ref to the object (very
// common for things passed between methods/to constructors), use AddComRef when initializing a
// SafeComPtr.
template<typename ComType>
class SafeComPtr {
public:
  explicit SafeComPtr(ComType* ptr = nullptr)
    : ptr_(ptr) {
  }

  // Copy constructor
  SafeComPtr(const SafeComPtr& that)
    : ptr_(that.ptr_) {
    if (ptr_) {
      ptr_->AddRef();
    }
  }

  // Move constructor
  SafeComPtr(SafeComPtr&& that)
    : ptr_(that.Relinquish()) {
  }

  ~SafeComPtr() {
    Reset();
  }

  // Releases the underlying object and resets this wrapper to an empty state.
  void Reset() {
    if (ptr_ != nullptr) {
      ptr_->Release();
      ptr_ = nullptr;
    }
  }

  // Swaps objects between two SafeComPtrs.
  void Swap(SafeComPtr<ComType>& that) {
    ComType* temp = ptr_;
    ptr_ = that.ptr_;
    that.ptr_ = temp;
  }

  // Returns the underlying object (without releasing a ref) and returns this wrapper to an empty
  // state.
  ComType* Relinquish() {
    ComType* temp = ptr_;
    ptr_ = nullptr;
    return temp;
  }

  ComType* get() const {
    return ptr_;
  }

  // Allows calling functions on the underlying COM object with the -> operator
  BlockComRef<ComType>* operator->() const {
    return static_cast<BlockComRef<ComType>*>(ptr_);
  }

  // Returns a reference to the underlying COM object.
  ComType& operator*() const {
    assert(ptr_ != nullptr);
    return *ptr_;
  }

  // Returns the address of the underlying pointer. Dangerous because it breaks the encapsulation
  // this provides (and prevents releasing any already-owned resources), so this should ONLY be used
  // to initialize a SafeComPtr for the first time (when ptr_ is null).
  ComType** operator&() {
    assert(ptr_ == nullptr);
    return &ptr_;
  }

  // Copy assignment operator
  SafeComPtr& operator=(const SafeComPtr& that) {
    Swap(that);
  }

  // Move assignment operator
  SafeComPtr& operator=(SafeComPtr&& that) {
    Reset();
    ptr_ = that.Relinquish();
  }

private:
  ComType* ptr_;
};

}  // namespace forge
}  // namespace sbat