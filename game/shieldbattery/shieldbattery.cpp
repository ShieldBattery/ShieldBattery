#include "shieldbattery/shieldbattery.h"

#include <fcntl.h>
#include <io.h>
#include <node.h>
#include <winsock2.h>
#include <Windows.h>
#include <shellapi.h>

#include <queue>
#include <string>
#include <vector>

#include "shieldbattery/settings.h"
#include "common/func_hook.h"
#include "common/types.h"
#include "common/win_helpers.h"
#include "logger/logger.h"
#include "snp/snp.h"

// set this to true if you want to debug node using something like node-inspector
const bool NODE_DEBUG = false;
// set this to true if you want to wait for the native (i.e. VS) debugger to attach to the process
// before executing.
const bool AWAIT_DEBUGGER = false;

using std::queue;
using std::string;
using std::vector;

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
static queue<WorkRequest*>* work_queue;
static uv_thread_t node_thread;

static Settings* current_settings = nullptr;

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
      Logger::Log(LogLevel::Verbose, "UI thread running requested work");
      req->worker_func(req->data);
      Logger::Log(LogLevel::Verbose, "UI thread finished running work");
      uv_async_send(&req->async);
    }
  }

  Logger::Log(LogLevel::Verbose, "UI thread finished");
}

void UiThreadAfterClose(uv_handle_t* closed) {
  WorkRequest* req = reinterpret_cast<WorkRequest*>(closed->data);
  delete req;
}

void UiThreadWorkCompleted(uv_async_t* async) {
  WorkRequest* req = reinterpret_cast<WorkRequest*>(async->data);
  req->after_cb(req->data);
  uv_close(reinterpret_cast<uv_handle_t*>(async), UiThreadAfterClose);
}

void TerminateUiThread() {
  if (terminated) {
    return;
  }

  Logger::Log(LogLevel::Verbose, "Terminating UI thread");
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
  Logger::Log(LogLevel::Verbose, "Queuing work for the UI thread");
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

  string pathString(path);
  string::size_type slashPos = string(path).find_last_of("\\/");
  string scriptPath = pathString.substr(0, slashPos).append("\\index.js");
  vector<char> scriptPathArg(scriptPath.begin(), scriptPath.end());
  scriptPathArg.push_back('\0');

  wchar_t** processArgs;
  int numProcessArgs;
  processArgs = CommandLineToArgvW(GetCommandLineW(), &numProcessArgs);
  assert(numProcessArgs >= 2);
  const wchar_t* wideGameId = processArgs[0];
  size_t wideLen = wcslen(wideGameId);
  char* gameId = new char[wideLen + 1];
  size_t numConverted;
  wcstombs_s(&numConverted, gameId, wideLen + 1, wideGameId, wideLen);

  const wchar_t* widePort = processArgs[1];
  wideLen = wcslen(wideGameId);
  char* port = new char[wideLen + 1];
  wcstombs_s(&numConverted, port, wideLen + 1, widePort, wideLen);

  vector<char*> argv;
  argv.push_back(path);
  if (NODE_DEBUG) {
    argv.push_back("--debug=5858");
  }
  argv.push_back(&scriptPathArg[0]);
  argv.push_back("shieldbattery");
  argv.push_back(gameId);
  argv.push_back(port);

  node::Start(argv.size(), &argv[0]);

  delete[] gameId;

  TerminateUiThread();
}

// EntryPoint and GameInit as essentially a single function done in 2 parts. When EntryPoint is hit,
// it waits on a condition being set by something in the Node space. Once set, it lets BW continue
// initializing itself, which will eventually result in GameInit being hooked, at which point our
// custom functionality continues and our UiThreadWorker can begin.

typedef int (*EntryPointFunc)(HMODULE module_handle);
FuncHook<EntryPointFunc>* entry_point_hook;
int HOOK_EntryPoint(HMODULE module_handle) {
  entry_point_hook->Restore();

  // open a temp file so that node can write errors out to it
  wchar_t temp_path[MAX_PATH];
  int ret = GetTempPathW(MAX_PATH, temp_path);
  assert(ret != 0);
  wchar_t temp_file[MAX_PATH];
  ret = GetTempFileNameW(temp_path, L"shieldbattery", 0, temp_file);
  assert(ret != 0);

  int fh;
  ret = _wsopen_s(&fh, temp_file, _O_TRUNC | _O_CREAT | _O_WRONLY | _O_TEXT, _SH_DENYNO,
    _S_IREAD | _S_IWRITE);
  assert(ret == 0);
  ret = _dup2(fh, 1 /* stdout */);
  assert(ret == 0);
  ret = _dup2(fh, 2 /* stderr */);
  assert(ret == 0);

  // Node uses GetStdHandle for printing fatal v8 failures, so we set that as well
  HANDLE handle = CreateFileW(temp_file, GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL,
      CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
  assert(handle != INVALID_HANDLE_VALUE);
  SetStdHandle(STD_OUTPUT_HANDLE, handle);
  SetStdHandle(STD_ERROR_HANDLE, handle);

  // Can't _dup2 stdout/err before they have a CRT handle associated with them,
  // so use freopen to allocate a handle for them and then _dup2 it
  // (The freopened file gets closed once _dup2 is called)

  ret = GetTempFileNameW(temp_path, L"shieldbattery", 0, temp_file);
  assert(ret != 0);

  FILE* fp;
  ret = _wfreopen_s(&fp, temp_file, L"w", stdout);
  assert(ret == 0);
  ret = _dup2(fh, _fileno(stdout));
  assert(ret == 0);
  ret = _wfreopen_s(&fp, temp_file, L"w", stderr);
  assert(ret == 0);
  ret = _dup2(fh, _fileno(stderr));
  assert(ret == 0);
  _wremove(temp_file);

  if (AWAIT_DEBUGGER) {
    while (!IsDebuggerPresent()) {
      Sleep(50);
    }
  }

  HMODULE sbat_handle;
  char path[MAX_PATH];
  GetModuleHandleExA(
    GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
    reinterpret_cast<LPCSTR>(&HOOK_EntryPoint), &sbat_handle);
  GetModuleFileNameA(sbat_handle, path, sizeof(path));
  string pathString(path);
  string::size_type slashPos = string(path).find_last_of("\\/");
  string shieldbatteryDir = pathString.substr(0, slashPos + 1);
  // Set the DLL directory to shieldbattery so that Windows can find our delay-loaded DLLs (and we
  // don't have to put stuff in the StarCraft dir).
  SetDllDirectoryA(shieldbatteryDir.c_str());

  uv_cond_init(&proc_init_cond);
  uv_mutex_init(&proc_init_mutex);
  uv_mutex_init(&proc_initialized);

  uv_mutex_init(&work_queue_mutex);
  uv_cond_init(&work_queue_cond);
  terminated = false;
  work_queue = new queue<WorkRequest*>();

  uv_thread_create(&node_thread, StartNode, nullptr);

  uv_mutex_lock(&proc_init_mutex);
  uv_cond_wait(&proc_init_cond, &proc_init_mutex);
  uv_mutex_unlock(&proc_init_mutex);

  return entry_point_hook->callable()(module_handle);
}

typedef void (*GameInitFunc)();
FuncHook<GameInitFunc>* game_init_hook;
void HOOK_GameInit() {
  // This essentially just serves as a stopping point for "general initialization stuff" BW does
  // after its entry point
  delete game_init_hook;
  game_init_hook = nullptr;

  snp::InitSnpStructs();

  Logger::Log(LogLevel::Verbose, "Game initialization reached, beginning UI thread worker");
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

typedef DWORD (__stdcall *CheckForOtherInstancesFunc)(char* wnd_class_name);
sbat::FuncHook<CheckForOtherInstancesFunc>* check_other_instances_hook = nullptr;
DWORD __stdcall HOOK_CheckForOtherInstances(char* wnd_class_name) {
  // We handle killing old SC processes ourselves, so no need to let this check for itself (and
  // cause problems because its code calls Sleep).
  check_other_instances_hook->Restore();
  delete check_other_instances_hook;
  check_other_instances_hook = nullptr;

  return 0;
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
  if (uv_mutex_trylock(&proc_initialized) == 0) {
    // process has not been initialized yet, so we signal it to do so
    uv_mutex_lock(&proc_init_mutex);
    uv_cond_signal(&proc_init_cond);
    uv_mutex_unlock(&proc_init_mutex);
  }
}

NODE_EXTERN void SetSettings(const Settings& settings) {
  delete current_settings;
  current_settings = new Settings(settings);
}

NODE_EXTERN const Settings& GetSettings() {
  assert(current_settings != nullptr);
  return *current_settings;
}

HMODULE process_module_handle = GetModuleHandle(NULL);
HookedModule process_hooks(GetModuleHandle(NULL));
char current_dir_on_inject[MAX_PATH];
string real_starcraft_path;

DWORD __stdcall GetModuleFileNameAHook(
  _In_opt_ HMODULE module_handle, _Out_ LPSTR filename, _In_ DWORD size) {
  if (module_handle == nullptr || module_handle == process_module_handle) {
    real_starcraft_path.copy(filename, size);
    filename[size - 1] = '\0';
    if (real_starcraft_path.length() > size) {
      SetLastError(ERROR_INSUFFICIENT_BUFFER);
      return size;
    } else {
      return real_starcraft_path.length();
    }
  } else {
    return GetModuleFileNameA(module_handle, filename, size);
  }
}

extern "C" __declspec(dllexport) void OnInject() {
  DWORD count = GetCurrentDirectoryA(sizeof(current_dir_on_inject), current_dir_on_inject);
  if (!count) {
    ExitProcess(GetLastError());
  }
  real_starcraft_path = string(current_dir_on_inject) + "\\StarCraft.exe";
  process_hooks.AddHook("kernel32.dll", "GetModuleFileNameA", GetModuleFileNameAHook);
  process_hooks.Inject();

  // note that this is not the exe's entry point, but rather the first point where BW starts doing
  // BW-specific things
  entry_point_hook = new sbat::FuncHook<EntryPointFunc>(
      reinterpret_cast<EntryPointFunc>(0x004E0AE0), HOOK_EntryPoint);
  entry_point_hook->Inject();

  game_init_hook = new sbat::FuncHook<GameInitFunc>(reinterpret_cast<GameInitFunc>(0x004E08A5),
      HOOK_GameInit);
  game_init_hook->Inject();

  check_other_instances_hook = new sbat::FuncHook<CheckForOtherInstancesFunc>(
      reinterpret_cast<CheckForOtherInstancesFunc>(0x004E0380), HOOK_CheckForOtherInstances);
  check_other_instances_hook->Inject();
}

}  // namespace sbat