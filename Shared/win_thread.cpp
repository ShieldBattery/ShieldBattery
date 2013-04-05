#include "win_thread.h"

#include <process.h>

namespace sbat {

WinThread::WinThread() 
  : running_(false) {
}

bool WinThread::Start() {
  if(running_) return false;

  terminated_event_ = CreateEvent(NULL /* security attributes */, true /* manual reset */,
      false /* initial state */, NULL /* name */);

  thread_handle_ = (HANDLE)_beginthreadex(NULL, // security
      0,                                        // stack size
      WinThread::EntryPoint,                    // entry-point-function
      this,                                     // arg list holding the "this" pointer
      0,                                        // Create running, not suspended
      &thread_id_);

  if(thread_handle_ == reinterpret_cast<HANDLE>(-1L)) {
    return false;
  } else {
    running_ = true;
    return true;
  }
}

bool WinThread::is_terminated() const {
  return !running_ || WaitForSingleObject(terminated_event_, 0) == WAIT_OBJECT_0;
}

void WinThread::Terminate() {
  SetEvent(terminated_event_);
}

void WinThread::Run() {
   Execute();

   running_ = false;
   CloseHandle(terminated_event_);
   terminated_event_ = NULL;
   thread_handle_ = NULL;
   thread_id_ = 0xFFFFFFFF;
}

unsigned __stdcall WinThread::EntryPoint(void* pthis) {
  WinThread * pt = (WinThread*)pthis;
  pt->Run();

  return 1;
}

}