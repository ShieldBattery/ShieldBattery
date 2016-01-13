#pragma once

#include <node.h>
#include <uv.h>
#include <list>

namespace sbat {

enum class NODE_EXTERN LogLevel {
  Verbose = 0,
  Debug,
  Warning,
  Error
};

typedef void (*LogFunc)(void* arg, LogLevel level, const char* msg);

class Logger {
  struct LogContext {
    LogLevel level;
    char* msg;
    LogFunc func;
    void* arg;
  };

public:
  // Should be called from the same thread that Node will be running on, before any logging happens
  NODE_EXTERN static void Init(LogFunc func, void* arg);
  // Should be called when the thing pointed to by arg is destroyed (if it matters). Will only
  // destroy if the func and arg match what is currently set.
  NODE_EXTERN static void Destroy(LogFunc func, void* arg);

  // Order is not guaranteed by these functions across multiple threads. Calls that come from the
  // main thread just after a background thread queues a log are very likely to be logged first.
  NODE_EXTERN static void Log(LogLevel level, const char* msg);
  NODE_EXTERN static void Logf(LogLevel level, const char* msg_format, ...);

private:
  Logger(LogFunc func, void* arg);
  ~Logger();

  static void InitMutex();
  static void OnLogsQueued(uv_async_t* handle);

  uv_thread_t main_thread_;
  LogFunc func_;
  void* arg_;
  uv_async_t async_;
  std::list<LogContext> log_queue_;

  static uv_mutex_t instance_mutex_;
  static Logger* instance_;
};

}  // namespace sbat
