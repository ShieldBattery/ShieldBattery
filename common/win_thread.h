#ifndef SHARED_WIN_THREAD_H_
#define SHARED_WIN_THREAD_H_

#include <Windows.h>

namespace sbat {
class WinThread {
  public:
    WinThread();
    bool Start();

    const HANDLE thread_handle() const { return thread_handle_; }
    const unsigned int thread_id() const { return thread_id_; }
    bool is_running() const { return running_; }
    bool is_terminated() const;
    void Terminate();
  protected:
    void Run();
    static unsigned __stdcall EntryPoint(void* thread_instance);
    virtual void Execute() = 0;

  private:
    HANDLE thread_handle_;
    unsigned int thread_id_;
    bool running_;
    HANDLE terminated_event_;
};
}  // namespace sbat
#endif  // SHARED_WIN_THREAD_H_