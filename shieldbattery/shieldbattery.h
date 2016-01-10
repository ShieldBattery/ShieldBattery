#ifndef SHIELDBATTERY_SHIELDBATTERY_H_
#define SHIELDBATTERY_SHIELDBATTERY_H_

#include <node.h>
#include "./settings.h"
#include "./snp_interface.h"

namespace sbat {
typedef void (*WorkRequestWorkerFunc)(void* arg);
typedef void (*WorkRequestAfterFunc)(void* arg);

NODE_EXTERN void QueueWorkForUiThread(void* arg, WorkRequestWorkerFunc worker_func,
    WorkRequestAfterFunc after_cb);
NODE_EXTERN void InitializeProcess(void* arg, WorkRequestAfterFunc cb);

NODE_EXTERN SnpInterface* GetSnpInterface();
}  // namespace sbat
#endif  // SHIELDBATTERY_SHIELDBATTERY_H_