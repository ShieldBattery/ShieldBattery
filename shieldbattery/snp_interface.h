#ifndef SHIELDBATTERY_SNP_INTERFACE_H_
#define SHIELDBATTERY_SNP_INTERFACE_H_

#include <node.h>
#include <string>

struct sockaddr_in;

namespace sbat {

typedef void (*SpoofGameFunc)(const std::string& game_name, const sockaddr_in& host_addr,
    bool is_replay);
typedef void (*StopSpoofingGameFunc)();

struct SnpInterface {
  SpoofGameFunc SpoofGame;
  StopSpoofingGameFunc StopSpoofingGame;
};

NODE_EXTERN void BindSnp(const SnpInterface& funcs);
NODE_EXTERN void UnbindSnp();

}  // sbat

#endif  // SHIELDBATTERY_SNP_INTERFACE_H_