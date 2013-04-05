#ifndef WIN_THREAD_H
#define WIN_THREAD_H

#define WIN32_LEAN_AND_MEAN
#include <Windows.h>

namespace sbat {

class WinThread
{
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
    static unsigned __stdcall EntryPoint(void*);
    virtual void Execute() = 0;

  private:
    HANDLE thread_handle_;
    unsigned int thread_id_;
    bool running_;
    HANDLE terminated_event_;
};

}
#endif