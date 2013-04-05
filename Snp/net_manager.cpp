#include "net_manager.h"

#include <Windows.h>
#include <assert.h>
#include "snp_packets.h"

namespace sbat {
namespace snp {

// TODO(tec27): We need a better way of logging errors from this

NetManager::NetManager(const HANDLE packet_received_event, const u_short port)
  : packet_received_event_(packet_received_event),\
    port_(port),
    socket_(),
    packet_queue_section_(),
    packet_queue_(nullptr) {
  InitializeCriticalSection(&packet_queue_section_);
}

NetManager::~NetManager() {
  if(!is_terminated()) {
    Terminate();
    while(is_running()) {} // this has an expectation that the thread will exit reasonably quickly
  }

  if(socket_) {
    closesocket(socket_);
  }

  EnterCriticalSection(&packet_queue_section_);
  if(packet_queue_) {
    StormPacket* packet = packet_queue_;
    while(packet) {
      StormPacket* cur = packet;
      packet = cur->next;
      delete cur;
    }
  }
  LeaveCriticalSection(&packet_queue_section_);

  DeleteCriticalSection(&packet_queue_section_);
}

bool NetManager::Create(const HANDLE packet_received_event, const u_short port,
    NetManager* net_manager) {
  NetManager* result = new NetManager(packet_received_event, port);
  if(result->Init()) {
    net_manager = result;
    return true;
  } else {
    net_manager = nullptr;
    return false;
  }
}

bool NetManager::Init() {
  socket_ = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
  if(socket_ == INVALID_SOCKET) {
    return false;
  }

  DWORD value = 1;
  if(setsockopt(socket_, SOL_SOCKET, SO_REUSEADDR, reinterpret_cast<char*>(&value),
      sizeof(DWORD)) == SOCKET_ERROR) {
    closesocket(socket_);
    socket_ = NULL;
    return false;
  }
  if(setsockopt(socket_, SOL_SOCKET, SO_BROADCAST, reinterpret_cast<char*>(&value),
      sizeof(DWORD)) == SOCKET_ERROR) {
    closesocket(socket_);
    socket_ = NULL;
    return false;
  }

  SOCKADDR_IN socket_address;
  memset(&socket_address, 0, sizeof(socket_address));
  socket_address.sin_family = AF_INET;
  socket_address.sin_port = htons(port_);

  if(bind(socket_, reinterpret_cast<SOCKADDR*>(&socket_address),
      sizeof(socket_address)) == SOCKET_ERROR) {
    closesocket(socket_);
    socket_ = NULL;
    return false;
  }

  if(!Start()) {
    closesocket(socket_);
    socket_ = NULL;
    return false;
  }

  return true;
}

void NetManager::Execute() {
  while(!is_terminated()) {
    ReadSocket();
  }
}

void NetManager::ReadSocket() {
  SOCKADDR_IN from_address;
  int from_address_len = sizeof(from_address);
  byte buffer[SNP_PACKET_SIZE + sizeof(PacketHeader)] = { 0 };

  int bytes_received = recvfrom(socket_, reinterpret_cast<char*>(&buffer), 
      SNP_PACKET_SIZE + sizeof(PacketHeader), 0, reinterpret_cast<SOCKADDR*>(&from_address),
      &from_address_len);
  if(is_terminated()) {
    return;
  }

  switch(bytes_received) {
    case SOCKET_ERROR: 
      return;
    case 0: // connection was closed gracefully, should never happen for UDP?
      Terminate(); 
      return;
    default: 
      break;
  }

  memset(from_address.sin_zero, 0, sizeof(from_address.sin_zero));
  PacketHeader* header = reinterpret_cast<PacketHeader*>(buffer);
  if(header->size < sizeof(header) || header->size != bytes_received) {
    return; // incomplete/invalid packet
  }

  switch(header->type) {
    case PKT_STORM: {
      ProcessStormPacket(buffer[sizeof(PacketHeader)], header->size - sizeof(PacketHeader), 
          from_address);
      break;
    }
    default:
      break;
  }
}

void NetManager::ProcessStormPacket(const byte& packet_data, const DWORD size,
    const SOCKADDR_IN& from_address) {
  assert(size <= SNP_PACKET_SIZE);

  StormPacket* new_packet = new StormPacket;
  
  memcpy(&new_packet->data, &packet_data, size);
  new_packet->size = size;
  memcpy(&new_packet->from_address, &from_address, sizeof(new_packet->from_address));
  new_packet->next = nullptr;

  EnterCriticalSection(&packet_queue_section_);
  if(packet_queue_ != nullptr) {
    StormPacket* cur = packet_queue_;
    for(StormPacket* cur = packet_queue_; cur->next != nullptr; cur = cur->next) {}
    
    cur->next = new_packet;
  } else {
    packet_queue_ = new_packet;
  }
  SetEvent(packet_received_event_);
  LeaveCriticalSection(&packet_queue_section_);
}

}
}