#ifndef NODE_BW_SRC_IMMEDIATE_H_
#define NODE_BW_SRC_IMMEDIATE_H_

namespace sbat {
namespace bw {
/*uv_check_start(&check_immediate_watcher, node::CheckImmediate);
  // idle handle is needed only to maintain event loop
  uv_idle_start(&idle_immediate_dummy, node::IdleImmediateDummy);
} else {
  uv_check_stop(&check_immediate_watcher);
  uv_idle_stop(&idle_immediate_dummy);*/
typedef void (*ImmediateCallback)(void* arg);

void InitImmediate();
void FreeImmediate();
void AddImmediateCallback(ImmediateCallback callback, void* arg);

}  // namespace bw
}  // namespace sbat
#endif  // NODE_BW_SRC_IMMEDIATE_H_