#include "node-bw/immediate.h"

#include <node.h>
#include <uv.h>
#include <list>
#include "logger/logger.h"

using std::list;

namespace sbat {
namespace bw {

struct ImmediateCallbackInfo {
  ImmediateCallback callback;
  void* arg;
};

static uv_mutex_t mutex;
static uv_async_t async;
static std::list<ImmediateCallbackInfo> callbacks;

static void CheckImmediate(uv_async_t* handle) {
  assert(handle == &async);

  uv_mutex_lock(&mutex);
  while (!callbacks.empty()) {
    ImmediateCallbackInfo info = callbacks.front();
    callbacks.pop_front();
    uv_mutex_unlock(&mutex);

    info.callback(info.arg);
    uv_mutex_lock(&mutex);
  }
  uv_mutex_unlock(&mutex);
}

void InitImmediate() {
  uv_mutex_init(&mutex);
  uv_async_init(uv_default_loop(), &async, CheckImmediate);
}

void FreeImmediate() {
  uv_mutex_destroy(&mutex);
  uv_close(reinterpret_cast<uv_handle_t*>(&async), NULL);
  callbacks.clear();
}

void AddImmediateCallback(ImmediateCallback callback, void* arg) {
  ImmediateCallbackInfo info;
  info.callback = callback;
  info.arg = arg;

  uv_mutex_lock(&mutex);
  callbacks.push_back(info);
  uv_async_send(&async);
  uv_mutex_unlock(&mutex);
}

}  // namespace bw
}  // namespace sbat