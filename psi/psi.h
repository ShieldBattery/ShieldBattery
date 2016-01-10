#ifndef PSI_PSI_H_
#define PSI_PSI_H_

#include <node.h>
#include <uv.h>
#include <Windows.h>

const LPSTR SERVICE_NAME = "Psi";

namespace sbat {
namespace psi {

void WINAPI ServiceMain(DWORD argc, LPSTR *argv);
void WINAPI ServiceControlHandler(DWORD ctrl_code, DWORD event_type, LPVOID event_data, LPVOID param);
typedef void (*ShutdownCallbackFunc)();

class PsiService {
public:
  PsiService(bool isInServiceMode);
  ~PsiService();

  bool isInServiceMode() const { return isInServiceMode_; }

  void Register();
  void InitServiceStatus();
  void Start();
  void Stop();
  void StartWorkerThread();
  void WaitWorkerThread();
  void SignalShutdown();

  NODE_EXTERN static void SetShutdownCallback(ShutdownCallbackFunc func);

private:
  PsiService(const PsiService&) = delete;
  PsiService& operator=(const PsiService&) = delete;

  static void WorkerThread(LPVOID param);
  static void StopServiceWorker(uv_async_t* handle);
  static void ShutdownTimerCallback(uv_timer_t* handle);
  void SetServiceStatus(DWORD dwCurrentState, DWORD dwWin32ExitCode, DWORD dwWaitHint);

  static ShutdownCallbackFunc emit_shutdown_;

  uv_async_t async_service_stopper_;
  uv_timer_t shutdown_timer_;
  uv_mutex_t terminated_mutex_;
  uv_thread_t worker_thread_;
  bool isInServiceMode_;
  bool terminated_;

  SERVICE_STATUS service_status_;
  SERVICE_STATUS_HANDLE service_status_handle_;
  HANDLE service_stop_event_;
};

}  // namespace psi
}  // namespace sbat

#endif  // PSI_PSI_H_