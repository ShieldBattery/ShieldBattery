#pragma once

#include <winsock2.h>

#include "common/types.h"



namespace sbat {
namespace snp {
// min-MTU - (max-IP-header-size + udp-header-size)
const size_t SNP_PACKET_SIZE = 576 - (60 + 8);

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
