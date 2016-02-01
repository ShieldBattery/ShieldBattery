#pragma once

#include <node.h>
#include "./settings.h"

namespace sbat {
typedef void (*WorkRequestWorkerFunc)(void* arg);
typedef void (*WorkRequestAfterFunc)(void* arg);

NODE_EXTERN void QueueWorkForUiThread(void* arg, WorkRequestWorkerFunc worker_func,
    WorkRequestAfterFunc after_cb);
NODE_EXTERN void InitializeProcess(void* arg, WorkRequestAfterFunc cb);

}  // namespace sbat
