#include "psi/psi.h"

#include <string>

#include "common/win_helpers.h"

int wmain(int argc, wchar_t *argv[]) {
  SERVICE_TABLE_ENTRY ServiceTable[] = {
    { SERVICE_NAME, reinterpret_cast<LPSERVICE_MAIN_FUNCTION>(sbat::psi::ServiceMain) },
    { NULL, NULL }
  };

  if (!StartServiceCtrlDispatcher(ServiceTable)) {
    return 0;
  }

  return 0;
}

namespace sbat {
namespace psi {

ShutdownCallbackFunc PsiService::emit_shutdown_ = nullptr;

PsiService::PsiService()
    : async_service_stopper_(),
      shutdown_timer_(),
      terminated_mutex_(),
      worker_thread_(),
      terminated_(false),
      service_status_(),
      service_status_handle_(NULL),
      service_stop_event_(INVALID_HANDLE_VALUE) {
  uv_async_init(uv_default_loop(), &async_service_stopper_, StopServiceWorker);
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

void PsiService::StopServiceWorker(uv_async_t* handle, int status) {
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
  PsiService service;

  service.Register();
  service.InitServiceStatus();
  service.Start();

  service.StartWorkerThread();
  service.WaitWorkerThread();
  service.Stop();
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

  // open a temp file so that node can write errors out to it
  char temp_path[MAX_PATH];
  int ret = GetTempPathA(MAX_PATH, temp_path);
  assert(ret != 0);
  char temp_file[MAX_PATH];
  ret = GetTempFileNameA(temp_path, "psi", 0, temp_file);
  assert(ret != 0);

  FILE* fp;
  freopen_s(&fp, temp_file, "w", stdout);
  freopen_s(&fp, temp_file, "w", stderr);

  HMODULE module_handle;
  char path[MAX_PATH];
  BOOL return_value;
  return_value = GetModuleHandleExA(
      GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
      reinterpret_cast<LPCSTR>(&wmain), &module_handle);
  GetModuleFileNameA(module_handle, path, sizeof(path));

  char** node_argv = new char*[1];
  node_argv[0] = path;
  node::Start(1, node_argv);

  uv_mutex_lock(&instance->terminated_mutex_);
  instance->terminated_ = true;
  uv_mutex_unlock(&instance->terminated_mutex_);
}

void PsiService::ShutdownTimerCallback(uv_timer_t* handle, int status) {
  // Called when we've exceeded our allotted timeout for shutting down. This being called indicates
  // that there are leftover handles on libuv's event loop (something is long-running and did not
  // properly respond to our 'shutdown' event being emitted). In response, we'll simply call uv_stop
  // and end the loop less gracefully.
  PsiService* instance = reinterpret_cast<PsiService*>(handle->data);

  uv_mutex_lock(&instance->terminated_mutex_);
  if (!instance->terminated_) {
    uv_stop(uv_default_loop());
  }
  uv_mutex_unlock(&instance->terminated_mutex_);
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
