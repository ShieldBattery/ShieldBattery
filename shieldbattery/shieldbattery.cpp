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

static uv_mutex_t proc_init_mutex;
static uv_cond_t proc_init_cond;
static uv_mutex_t proc_initialized;

// These will be initialized in our dll initialization functions. As long as they run prior to
// NodeJS execution beginning, there should be no chance of a race
static uv_mutex_t work_queue_mutex;
static uv_cond_t work_queue_cond;
static bool terminated;
static std::queue<WorkRequest*>* work_queue;
static uv_thread_t node_thread;

void UiThreadWorker() {
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

void UiThreadAfterClose(uv_handle_t* closed) {
  WorkRequest* req = reinterpret_cast<WorkRequest*>(closed->data);
  delete req;
}

void UiThreadWorkCompleted(uv_async_t* async, int status) {
  WorkRequest* req = reinterpret_cast<WorkRequest*>(async->data);
  req->after_cb(req->data);
  uv_close(reinterpret_cast<uv_handle_t*>(async), UiThreadAfterClose);
}

void TerminateUiThread() {
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
NODE_EXTERN void QueueWorkForUiThread(void* arg,
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
  uv_async_init(uv_default_loop(), &req->async, UiThreadWorkCompleted);
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

  TerminateUiThread();
}

// EntryPoint and GameInit as essentially a single function done in 2 parts. When EntryPoint is hit,
// it waits on a condition being set by something in the Node space. Once set, it lets BW continue
// initializing itself, which will eventually result in GameInit being hooked, at which point our
// custom functionality continues and our UiThreadWorker can begin.

typedef int (*EntryPointFunc)(HMODULE module_handle);
sbat::FuncHook<EntryPointFunc>* entry_point_hook;
int HOOK_EntryPoint(HMODULE module_handle) {
  entry_point_hook->Restore();
  if (AllocConsole()) {
    // correct stdout/stderr/stdin to point to new console
    FILE* fp;
    freopen_s(&fp, "CONOUT$", "w", stdout);
    freopen_s(&fp, "CONOUT$", "w", stderr);
    freopen_s(&fp, "CONIN$", "r", stdin);
  }

  uv_cond_init(&proc_init_cond);
  uv_mutex_init(&proc_init_mutex);
  uv_mutex_init(&proc_initialized);

  uv_mutex_init(&work_queue_mutex);
  uv_cond_init(&work_queue_cond);
  terminated = false;
  work_queue = new std::queue<WorkRequest*>();

  uv_thread_create(&node_thread, StartNode, nullptr);
  
  uv_mutex_lock(&proc_init_mutex);
  uv_cond_wait(&proc_init_cond, &proc_init_mutex);
  uv_mutex_unlock(&proc_init_mutex);

  return entry_point_hook->callable()(module_handle);
}

typedef void (*GameInitFunc)();
sbat::FuncHook<GameInitFunc>* game_init_hook;
void HOOK_GameInit() {
  // This essentially just serves as a stopping point for "general initialization stuff" BW does
  // after its entry point
  delete game_init_hook;
  game_init_hook = nullptr;

  UiThreadWorker();

  uv_mutex_destroy(&work_queue_mutex);
  uv_cond_destroy(&work_queue_cond);
  while (!work_queue->empty()) {
    WorkRequest* req = work_queue->front();
    work_queue->pop();
    uv_close(reinterpret_cast<uv_handle_t*>(&req->async), UiThreadAfterClose);
  }
  delete work_queue;

  uv_cond_destroy(&proc_init_cond);
  uv_mutex_destroy(&proc_init_mutex);
  uv_mutex_destroy(&proc_initialized);

  delete entry_point_hook;
  entry_point_hook = nullptr;
}

struct InitializeProcessContext {
  void* arg;
  WorkRequestAfterFunc callback;
};

void InitializeProcessWork(void* arg) {
  // no actual work to do here, just need this to run on the UI thread to guarantee that the UI
  // thread is running
}

void InitializeProcessAfter(void* arg) {
  InitializeProcessContext* context = reinterpret_cast<InitializeProcessContext*>(arg);
  context->callback(context->arg);
  delete context;
}

NODE_EXTERN void InitializeProcess(void* arg, WorkRequestAfterFunc cb) {
  InitializeProcessContext* context = new InitializeProcessContext;
  context->arg = arg;
  context->callback = cb;
  QueueWorkForUiThread(context, InitializeProcessWork, InitializeProcessAfter);
  if (uv_mutex_trylock(&proc_initialized) == UV_OK) {
    // process has not been initialized yet, so we signal it to do so
    uv_mutex_lock(&proc_init_mutex);
    uv_cond_signal(&proc_init_cond);
    uv_mutex_unlock(&proc_init_mutex);
  }
}

extern "C" __declspec(dllexport) void OnInject() {
  // note that this is not he exe's entry point, but rather the first point where BW starts doing
  // BW-specific things
  entry_point_hook = new sbat::FuncHook<EntryPointFunc>(
      reinterpret_cast<EntryPointFunc>(0x004E0AE0), HOOK_EntryPoint);
  entry_point_hook->Inject();

  game_init_hook = new sbat::FuncHook<GameInitFunc>(reinterpret_cast<GameInitFunc>(0x004E08A5),
      HOOK_GameInit);
  game_init_hook->Inject();
}

}  // namespace sbat