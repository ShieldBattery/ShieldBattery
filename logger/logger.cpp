#include "logger/logger.h"

#include <node.h>
#include <uv.h>
#include <list>

namespace sbat {

using std::list;

static uv_once_t mutex_init_once = UV_ONCE_INIT;

Logger* Logger::instance_ = nullptr;
uv_mutex_t Logger::instance_mutex_;

void Logger::InitMutex() {
  uv_mutex_init(&instance_mutex_);
}

void Logger::Init(LogFunc func, void* arg) {
  uv_once(&mutex_init_once, InitMutex);
  uv_mutex_lock(&instance_mutex_);
  if (instance_ != nullptr) {
    delete instance_;
    instance_ = nullptr;
  }

  instance_ = new Logger(func, arg);
  uv_mutex_unlock(&instance_mutex_);
}

void Logger::Log(LogLevel level, const char* msg) {
  uv_mutex_lock(&instance_mutex_);
  if (instance_ == nullptr) {
    uv_mutex_unlock(&instance_mutex_);
    return;
  }
  
  uv_thread_t cur_thread = uv_thread_self();
  if (uv_thread_equal(&instance_->main_thread_, &cur_thread)) {
    // we're on the main thread, no need to use the async
    instance_->func_(instance_->arg_, level, msg);
  } else {
    size_t msg_size = strlen(msg);
    char* internal_msg = new char[strlen(msg) + 1];
    strcpy_s(internal_msg, msg_size + 1, msg);

    LogContext context;
    context.level = level;
    context.msg = internal_msg;
    context.func = instance_->func_;
    context.arg = instance_->arg_;

    instance_->log_queue_.push_back(context);
    uv_async_send(&instance_->async_);
  }
  uv_mutex_unlock(&instance_mutex_);
}

void Logger::Logf(LogLevel level, const char* msg_format, ...) {
  const int initial_size = 1024;
  char* formatted = new char[initial_size];
  va_list argp;
  va_start(argp, msg_format);
  int size = vsnprintf(formatted, initial_size, msg_format, argp);
  va_end(argp);

  if (size >= initial_size) {
    delete[] formatted;
    formatted = new char[size + 1];
    va_start(argp, msg_format);
    vsnprintf(formatted, size + 1, msg_format, argp);
    va_end(argp);
  }

  Log(level, formatted);
  delete[] formatted;
}

void Logger::Destroy(LogFunc func, void* arg) {
  uv_mutex_lock(&instance_mutex_);
  if (instance_ != nullptr) {
    if (instance_->func_ == func && instance_->arg_ == arg) {
      delete instance_;
      instance_ = nullptr;
    }
  }
  uv_mutex_unlock(&instance_mutex_);
}

Logger::Logger(LogFunc func, void* arg)
  : main_thread_(uv_thread_self()),
    func_(func),
    arg_(arg),
    async_(),
    log_queue_() {
  uv_async_init(uv_default_loop(), &async_, OnLogsQueued);
}

Logger::~Logger() {
  uv_close(reinterpret_cast<uv_handle_t*>(&async_), NULL);
}

void Logger::OnLogsQueued(uv_async_t* handle) {
  uv_mutex_lock(&instance_mutex_);
  if (instance_ == nullptr || instance_->log_queue_.empty()) {
    uv_mutex_unlock(&instance_mutex_);
    return;
  }

  while (instance_ != nullptr && !instance_->log_queue_.empty()) {
    list<LogContext> temp_queue;
    temp_queue.splice(temp_queue.begin(), instance_->log_queue_);
    uv_mutex_unlock(&instance_mutex_);

    for (auto it = temp_queue.begin(); it != temp_queue.end(); ++it) {
      const LogContext& context = *it;
      context.func(context.arg, context.level, context.msg);
      delete[] context.msg;
    }

    uv_mutex_lock(&instance_mutex_);
  }
  uv_mutex_unlock(&instance_mutex_);
}

}  // namespace sbat