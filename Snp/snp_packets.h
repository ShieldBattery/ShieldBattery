#ifndef SNP_CONSTANTS_H
#define SNP_CONSTANTS_H

#define SNP_PACKET_SIZE 512

namespace sbat {
namespace snp {

enum PacketType {
  PKT_STORM // TODO(tec27): more types
};

// this packet info wraps the packets sent by storm/us with something that can be used to route it
struct PacketHeader {
  PacketType type;
  WORD size; // size includes the size of this header
};

// Storm packets that will be queued until read
struct StormPacket {
  byte data[SNP_PACKET_SIZE];
  SOCKADDR_IN from_address;
  DWORD size;

  StormPacket* next;
};

}
}

#endif