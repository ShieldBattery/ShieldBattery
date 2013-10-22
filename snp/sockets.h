#ifndef SNP_SOCKETS_H_
#define SNP_SOCKETS_H_

#include <node.h>
#include <map>

#include "shieldbattery/settings.h"
#include "snp/packets.h"

namespace sbat {
namespace snp {

struct QueuedPacket {
  uint32 num_targets;
  sockaddr_in** targets;
  byte* data;
  uint32 data_len;
};

uv_err_code BeginSocketLoop(HANDLE receive_signal, const Settings& settings);
void EndSocketLoop();
StormPacket* GetStormPacket();
void FreeStormPacket(StormPacket* packet);
void SendStormPacket(const QueuedPacket& packet);

class PacketParser {
  enum class ParserReadState {
    Header = 0,
    PacketData,
    Blacklisted
  };

  struct CompareSockAddr {
    bool operator()(sockaddr_in const& lhs, sockaddr_in const& rhs) const {
      if (lhs.sin_family != rhs.sin_family) {
        return lhs.sin_family < rhs.sin_family;
      } else if (lhs.sin_addr.s_addr != rhs.sin_addr.s_addr) {
        return lhs.sin_addr.s_addr < rhs.sin_addr.s_addr;
      } else {
        return lhs.sin_port < rhs.sin_port;
      }
    }
  };

  struct ParserState {
    ParserReadState read_state;
    uint32 offset;
    PacketHeader header;
    byte data[SNP_PACKET_SIZE];
  };

  typedef std::map<sockaddr_in, ParserState, CompareSockAddr> ParserStateMap;

public:
  PacketParser();
  ~PacketParser();

  void Parse(sockaddr_in* addr, ssize_t nread, uv_buf_t buf);

private:
  void ParseHeader(const ParserStateMap::iterator& state_iterator, ssize_t nread, uv_buf_t buf);
  void ParseData(const ParserStateMap::iterator& state_iterator, ssize_t nread, uv_buf_t buf);
  void HandleStormPacket(const ParserStateMap::iterator& state_iterator);
  ParserStateMap states_;
};

}  // namespace snp
}  // namespace sbat

#endif  // SNP_SOCKETS_H_