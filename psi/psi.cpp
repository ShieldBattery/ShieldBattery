#include "psi/psi.h"

#include <fcntl.h>
#include <io.h>
#include <string>
#include <vector>

#include "common/win_helpers.h"

using std::string;
using std::vector;

// set this to true if you want to be able to run the service from an IDE/command-line
// (to e.g. debug it)
const bool RUN_IN_IDE = false;
// set this to true if you want to debug node using something like node-inspector. You'll probably
// also have to run it outside of a service (see flag above).
const bool NODE_DEBUG = false;
// set this to true if you want to wait for the native (i.e. VS) debugger to attach to the process
// before executing.
const bool AWAIT_DEBUGGER = false;

int wmain(int argc, wchar_t *argv[]) {
  if (RUN_IN_IDE) {
    // we don't actually use argc/argv, so this is a dumb hack signal
    sbat::psi::ServiceMain(272727, nullptr);
  } else {
    SERVICE_TABLE_ENTRY ServiceTable[] = {
      { SERVICE_NAME, reinterpret_cast<LPSERVICE_MAIN_FUNCTION>(sbat::psi::ServiceMain) },
      { NULL, NULL }
    };

    if (!StartServiceCtrlDispatcher(ServiceTable)) {
      return 1;
    }
  }

  return 0;
}

namespace sbat {
namespace psi {

ShutdownCallbackFunc PsiService::emit_shutdown_ = nullptr;

PsiService::PsiService(bool isInServiceMode)
    : async_service_stopper_(),
      shutdown_timer_(),
      terminated_mutex_(),
      worker_thread_(),
      isInServiceMode_(isInServiceMode),
      terminated_(false),
      service_status_(),
      service_status_handle_(NULL),
      service_stop_event_(INVALID_HANDLE_VALUE) {
  uv_async_init(uv_default_loop(), &async_service_stopper_, StopServiceWorker);
  uv_unref(reinterpret_cast<uv_handle_t*>(&async_service_stopper_));
  async_service_stopper_.data = this;
  uv_timer_init(uv_default_loop(), &shutdown_timer_);
  // Don't let the timer keep the event loop running, it's only for the "kept running too long" case
  uv_unref(reinterpret_cast<uv_handle_t*>(&shutdown_timer_));
  shutdown_timer_.data = this;
  uv_mutex_init(&terminated_mutex_);
}

PsiService::~PsiService() {
  if (service_status_.dwCurrentState != SERVICE_STOPPED) {
    SetServiceStatus(SERVICE_STOPPED, NO_ERROR, 0);
  }

  uv_close(reinterpret_cast<uv_handle_t*>(&async_service_stopper_), NULL);
  uv_close(reinterpret_cast<uv_handle_t*>(&shutdown_timer_), NULL);
  uv_mutex_destroy(&terminated_mutex_);
}

void PsiService::Register() {
  service_status_handle_ = RegisterServiceCtrlHandlerEx(SERVICE_NAME,
    reinterpret_cast<LPHANDLER_FUNCTION_EX>(ServiceControlHandler),
    reinterpret_cast<LPVOID>(this));
  if (!service_status_handle_) {
    return;
  }
}

void PsiService::InitServiceStatus() {
  service_status_.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
  service_status_.dwServiceSpecificExitCode = 0;
  service_status_.dwCheckPoint = 0;
}

void PsiService::Start() {
  SetServiceStatus(SERVICE_START_PENDING, NO_ERROR, 1000);
  SetServiceStatus(SERVICE_RUNNING, NO_ERROR, 0);
}

void PsiService::Stop() {
  if (service_status_.dwCurrentState != SERVICE_STOP_PENDING) {
    return;
  }

  SetServiceStatus(SERVICE_STOPPED, NO_ERROR, 0);
}

void PsiService::StartWorkerThread() {
  uv_thread_create(&worker_thread_, WorkerThread, reinterpret_cast<LPVOID>(this));
}

void PsiService::WaitWorkerThread() {
  // Wait until our worker thread exits signaling that the service has completed and stopped
  uv_thread_join(&worker_thread_);
}

void PsiService::StopServiceWorker(uv_async_t* handle) {
  PsiService* service = reinterpret_cast<PsiService*>(handle->data);
  uv_timer_start(&service->shutdown_timer_, ShutdownTimerCallback, 5000, 0);

  // Emit a 'shutdown' event from node-psi
  if (emit_shutdown_ != nullptr) {
    emit_shutdown_();
  }
}

NODE_EXTERN void PsiService::SetShutdownCallback(ShutdownCallbackFunc callback) {
  emit_shutdown_ = callback;
}

void PsiService::SignalShutdown() {
  SetServiceStatus(SERVICE_STOP_PENDING, NO_ERROR, 0);
  uv_async_send(&async_service_stopper_);
}

void WINAPI ServiceMain(DWORD argc, LPSTR *argv) {
  bool isServiceMode = argc != 272727;
  
  PsiService service(isServiceMode);

  if (isServiceMode) {
    service.Register();
  }
  service.InitServiceStatus();
  if (isServiceMode) {
    service.Start();
  }

  service.StartWorkerThread();
  service.WaitWorkerThread();

  if (isServiceMode) {
    service.Stop();
  }
}

void WINAPI ServiceControlHandler(DWORD ctrl_code, DWORD event_type,
    LPVOID event_data, LPVOID param) {
  PsiService* instance = reinterpret_cast<PsiService*>(param);
  switch (ctrl_code) {
  case SERVICE_CONTROL_STOP:
    instance->SignalShutdown();
    break;
  default:
    break;
  }
}

void PsiService::WorkerThread(LPVOID param) {
  PsiService* instance = reinterpret_cast<PsiService*>(param);

  if (AWAIT_DEBUGGER) {
    while (!IsDebuggerPresent()) {
      Sleep(50);
    }
  }

  if (instance->isInServiceMode()) {
    // open a temp file so that node can write errors out to it
    wchar_t temp_path[MAX_PATH];
    int ret = GetTempPathW(MAX_PATH, temp_path);
    assert(ret != 0);
    wchar_t temp_file[MAX_PATH];
    ret = GetTempFileNameW(temp_path, L"psi", 0, temp_file);
    assert(ret != 0);

    int fh;
    ret = _wsopen_s(&fh, temp_file, _O_TRUNC | _O_CREAT | _O_WRONLY | _O_TEXT, _SH_DENYNO,
        _S_IREAD | _S_IWRITE);
    assert(ret == 0);
    ret = _dup2(fh, 1 /* stdout */);
    assert(ret == 0);
    ret = _dup2(fh, 2 /* stderr */);
    assert(ret == 0);

    // Can't _dup2 stdout/err before they have a CRT handle associated with them,
    // so use freopen to allocate a handle for them and then _dup2 it
    // (The freopened file gets closed once _dup2 is called)

    ret = GetTempFileNameW(temp_path, L"psi", 0, temp_file);
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
  }

  HMODULE module_handle;
  char path[MAX_PATH];
  BOOL return_value;
  return_value = GetModuleHandleExA(
      GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
      reinterpret_cast<LPCSTR>(&wmain), &module_handle);
  GetModuleFileNameA(module_handle, path, sizeof(path));

  string pathString(path);
  string::size_type slashPos = string(path).find_last_of("\\/");
  string scriptPath = pathString.substr(0, slashPos).append("\\js\\index.js");
  vector<char> scriptPathArg(scriptPath.begin(), scriptPath.end());
  scriptPathArg.push_back('\0');

  vector<char*> node_argv;
  node_argv.push_back(path);
  if (NODE_DEBUG) {
    node_argv.push_back("--debug=5858");
  }
  node_argv.push_back(&scriptPathArg[0]);
  node_argv.push_back("psi");

  node::Start(node_argv.size(), &node_argv[0]);

  uv_mutex_lock(&instance->terminated_mutex_);
  instance->terminated_ = true;
  uv_mutex_unlock(&instance->terminated_mutex_);
}

void PsiService::ShutdownTimerCallback(uv_timer_t* handle) {
  // Called when we've exceeded our allotted timeout for shutting down. This being called indicates
  // that there are leftover handles on libuv's event loop (something is long-running and did not
  // properly respond to our 'shutdown' event being emitted). In response, we'll simply exit
  // immediately, as we don't have many other options.
  ExitProcess(0);
}

void PsiService::SetServiceStatus(DWORD current_state, DWORD win32_exit_code, DWORD wait_hint) {
  service_status_.dwCurrentState = current_state;
  service_status_.dwWin32ExitCode = win32_exit_code;
  service_status_.dwWaitHint = wait_hint;

  if (current_state == SERVICE_START_PENDING) {
    service_status_.dwControlsAccepted = 0;
  } else {
    service_status_.dwControlsAccepted = SERVICE_ACCEPT_STOP;
  }

  ::SetServiceStatus(service_status_handle_, &service_status_);
}

}  // namespace psi
}  // namespace sbat
