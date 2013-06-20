#ifndef SHIELDBATTERY_SHIELDBATTERY_H_
#define SHIELDBATTERY_SHIELDBATTERY_H_

#include <node.h>

namespace sbat {
typedef void (*WorkRequestWorkerFunc)(void* arg);
typedef void (*WorkRequestAfterFunc)(void* arg);

NODE_EXTERN void QueueWorkForMainThread(void* arg, WorkRequestWorkerFunc worker_func,
    WorkRequestAfterFunc after_cb);
}  // namespace sbat
#endif  // SHIELDBATTERY_SHIELDBATTERY_H_