#include "shieldbattery/shieldbattery.h"

#include <conio.h>
#include <fcntl.h>
#include <io.h>
#include <Windows.h>

#include <queue>
#include <string>

#include "deps/node/src/node.h"
#include "common/func_hook.h"
#include "common/types.h"
#include "common/win_helpers.h"

namespace sbat {
struct WorkRequest {
  void* data;
  WorkRequestWorkerFunc worker_func;
  WorkRequestAfterFunc after_cb;
  uv_async_t async;
};

// These will be initialized in our dll initialization functions. As long as they run prior to
// NodeJS execution beginning, there should be no chance of a race
static uv_mutex_t work_queue_mutex;
static uv_cond_t work_queue_cond;
static bool terminated;
static std::queue<WorkRequest*>* work_queue;

void MainThreadWorker() {
  while (true) {
    WorkRequest* req = nullptr;

    uv_mutex_lock(&work_queue_mutex);
    if (terminated) {
      uv_mutex_unlock(&work_queue_mutex);
      break;
    }
    if (work_queue->empty()) {
      // wait for it to be non-empty
      uv_cond_wait(&work_queue_cond, &work_queue_mutex);
    }

    if (terminated) {
      uv_mutex_unlock(&work_queue_mutex);
      break;
    }

    // uv_cond_wait can return spuriously, ensure we actually have items
    if (!work_queue->empty()) {
      req = work_queue->front();
      work_queue->pop();
    }
    uv_mutex_unlock(&work_queue_mutex);

    if (req != nullptr) {
      req->worker_func(req->data);
      uv_async_send(&req->async);
    }
  }
}

void MainThreadAfterClose(uv_handle_t* closed) {
  WorkRequest* req = reinterpret_cast<WorkRequest*>(closed->data);
  delete req;
}

void MainThreadWorkCompleted(uv_async_t* async, int status) {
  WorkRequest* req = reinterpret_cast<WorkRequest*>(async->data);
  req->after_cb(req->data);
  uv_close(reinterpret_cast<uv_handle_t*>(async), MainThreadAfterClose);
}

void TerminateMainThread() {
  if (terminated) {
    return;
  }

  uv_mutex_lock(&work_queue_mutex);
  terminated = true;
  uv_cond_signal(&work_queue_cond);
  uv_mutex_unlock(&work_queue_mutex);
}

// Queues work to run on the main thread. Should be used for things that have affinity for the main
// thread rather than the v8 thread/threadpool (e.g. things that will be processing Windows
// messages)
NODE_EXTERN void QueueWorkForMainThread(void* arg,
    WorkRequestWorkerFunc worker_func, WorkRequestAfterFunc after_cb) {
  WorkRequest* req = new WorkRequest();
  req->data = arg;
  req->worker_func = worker_func;
  req->after_cb = after_cb;
  req->async.data = req;

  if (terminated) {
    delete req;
    return;
  }

  uv_mutex_lock(&work_queue_mutex);
  if (terminated) {
    delete req;
    return;
  }
  uv_async_init(uv_default_loop(), &req->async, MainThreadWorkCompleted);
  work_queue->push(req);
  uv_cond_signal(&work_queue_cond);
  uv_mutex_unlock(&work_queue_mutex);
}



void StartNode(void* arg) {
  HMODULE module_handle;
  char path[MAX_PATH];
  GetModuleHandleExA(
      GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
      reinterpret_cast<LPCSTR>(&StartNode), &module_handle);
  GetModuleFileNameA(module_handle, path, sizeof(path));

  char** argv = new char*[1];
  argv[0] = path;
  node::Start(1, argv);

  TerminateMainThread();
}



typedef void (*GameInitFunc)();
sbat::FuncHook<GameInitFunc>* gameInitHook;
void HOOK_gameInit() {
  if (AllocConsole()) {
    // correct stdout/stderr/stdin to point to new console
    FILE* fp;
    freopen_s(&fp, "CONOUT$", "w", stdout);
    freopen_s(&fp, "CONOUT$", "w", stderr);
    freopen_s(&fp, "CONIN$", "r", stdin);
  }

  uv_mutex_init(&work_queue_mutex);
  uv_cond_init(&work_queue_cond);
  terminated = false;
  work_queue = new std::queue<WorkRequest*>();

  uv_thread_t node_thread;
  uv_thread_create(&node_thread, StartNode, nullptr);

  MainThreadWorker();

  uv_mutex_destroy(&work_queue_mutex);
  uv_cond_destroy(&work_queue_cond);
  while (!work_queue->empty()) {
    WorkRequest* req = work_queue->front();
    work_queue->pop();
    uv_close(reinterpret_cast<uv_handle_t*>(&req->async), MainThreadAfterClose);
  }
  delete work_queue;

  delete gameInitHook;
  gameInitHook = nullptr;
}

extern "C" __declspec(dllexport) void scout_onInject() {
  gameInitHook = new sbat::FuncHook<GameInitFunc>(reinterpret_cast<GameInitFunc>(0x004E08A5),
      HOOK_gameInit);
  gameInitHook->Inject();
}


}  // namespace sbat