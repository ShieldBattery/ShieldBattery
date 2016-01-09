#ifndef SNP_PACKETS_H_
#define SNP_PACKETS_H_

#include <winsock2.h>

#include "common/types.h"

#define SNP_PACKET_SIZE 512

namespace sbat {
namespace snp {
enum class PacketType : byte {
  Storm = 0
};

#pragma pack(push)
#pragma pack(1)
// this packet info wraps the packets sent by storm/us with something that can be used to route it
struct PacketHeader {
  PacketType type;
  uint16 size;  // size does not include the size of this header
};
#pragma pack(pop)

// Storm packets that will be queued until read
struct StormPacket {
  byte data[SNP_PACKET_SIZE];
  sockaddr_in from_address;
  uint32 size;

  StormPacket* next;
};
}  // namespace snp
}  // namespace sbat

#endif  // SNP_PACKETS_H_