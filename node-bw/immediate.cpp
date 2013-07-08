#include "node-bw/immediate.h"

#include <node.h>
#include <uv.h>
#include <list>

using std::list;

namespace sbat {
namespace bw {

struct ImmediateCallbackInfo {
  ImmediateCallback callback;
  void* arg;
};

static uv_mutex_t mutex;
static uv_check_t check_watcher;
static std::list<ImmediateCallbackInfo> callbacks;

static void CheckImmediate(uv_check_t* handle, int status) {
  assert(handle == &check_watcher);
  assert(status == 0);

  uv_mutex_lock(&mutex);
  while (!callbacks.empty()) {
    ImmediateCallbackInfo info = callbacks.front();
    callbacks.pop_front();
    uv_mutex_unlock(&mutex);

    info.callback(info.arg);
    uv_mutex_lock(&mutex);
  }

  uv_check_stop(&check_watcher);
  uv_mutex_unlock(&mutex);
}

void InitImmediate() {
  uv_mutex_init(&mutex);
  uv_check_init(uv_default_loop(), &check_watcher);
}

void FreeImmediate() {
  uv_mutex_destroy(&mutex);
  callbacks.clear();
}

void AddImmediateCallback(ImmediateCallback callback, void* arg) {
  uv_mutex_lock(&mutex);
  bool start_check = callbacks.empty();
  ImmediateCallbackInfo info;
  info.callback = callback;
  info.arg = arg;
  callbacks.push_back(info);

  if (start_check) {
    uv_check_start(&check_watcher, CheckImmediate);
  }
  uv_mutex_unlock(&mutex);
}

}  // namespace bw
}  // namespace sbat