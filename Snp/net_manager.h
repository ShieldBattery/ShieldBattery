#ifndef SNP_NET_MANAGER_H_
#define SNP_NET_MANAGER_H_

#include <Windows.h>
#include "common/win_thread.h"

namespace sbat {
namespace snp {
struct StormPacket;

class NetManager : public WinThread {
public:
  static bool Create(const HANDLE packet_received_event, const u_short port,
      NetManager* net_manager);
  ~NetManager();
protected:
  void Execute();
private:
  NetManager(const HANDLE packet_received_event, const u_short port);
  bool Init();
  void ReadSocket();
  void ProcessStormPacket(const byte& packet_data, const DWORD size,
      const SOCKADDR_IN& from_address);

  const HANDLE packet_received_event_;
  const u_short port_;
  SOCKET socket_;
  CRITICAL_SECTION packet_queue_section_;
  StormPacket* packet_queue_;
};
}  // namespace snp
}  // namespace sbat

#endif  // SNP_NET_MANAGER_H_