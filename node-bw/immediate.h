#ifndef NODE_BW_IMMEDIATE_H_
#define NODE_BW_IMMEDIATE_H_

namespace sbat {
namespace bw {
typedef void (*ImmediateCallback)(void* arg);

void InitImmediate();
void FreeImmediate();
void AddImmediateCallback(ImmediateCallback callback, void* arg);

}  // namespace bw
}  // namespace sbat
#endif  // NODE_BW_IMMEDIATE_H_