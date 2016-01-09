#include "snp/sockets.h"

#include <assert.h>
#include <node.h>
#include <map>
#include <vector>

#include "logger/logger.h"
#include "snp/packets.h"
#include "shieldbattery/settings.h"

using std::make_pair;
using std::vector;

namespace sbat {
namespace snp {
struct QueuedPacketInternal {
  vector<sockaddr_in>* targets;
  vector<byte>* data;

  QueuedPacketInternal* next;
};

struct SendPacketContext {
  uv_buf_t buf;
  uint32 ref_count;
};

static uv_loop_t* loop = nullptr;
static uv_thread_t loop_thread;

static bool socket_dead = false;
static uv_udp_t socket;

static PacketParser* parser;

static HANDLE incoming_signal;
static uv_mutex_t incoming_mutex;
static StormPacket* incoming_packets;

static uv_async_t outgoing_async;
static uv_mutex_t outgoing_mutex;
static QueuedPacketInternal* outgoing_packets;

void ThreadFunc(void* arg) {
  uv_run(loop, UV_RUN_DEFAULT);
}

void AllocBuffer(uv_handle_t* handle, size_t suggested_size, uv_buf_t *buf) {
  *buf = uv_buf_init(new char[suggested_size], suggested_size);
}

void FreeBuffer(uv_buf_t buf) {
  delete[] buf.base;
}

void OnReceive(uv_udp_t* req, ssize_t nread, const uv_buf_t *buf, const sockaddr* addr, unsigned flags) {
  if (nread < 0) {
    // TODO(tec27): notify shieldbattery of the error
    Logger::Logf(LogLevel::Error, "Socket closed unexpectedly: %s %s", uv_err_name(nread),
        uv_strerror(nread));
    socket_dead = true;
    uv_close(reinterpret_cast<uv_handle_t*>(&socket), NULL);
    FreeBuffer(*buf);
    return;
  }

  parser->Parse(reinterpret_cast<const sockaddr_in*>(addr), nread, *buf);
  FreeBuffer(*buf);
}

void OnPacketSent(uv_udp_send_t* req, int status) {
  if (status < 0) {
    Logger::Logf(LogLevel::Error, "Sending packet failed (cb): %s %s", uv_err_name(status),
        uv_strerror(status));
  }

  SendPacketContext* context = reinterpret_cast<SendPacketContext*>(req->data);
  --context->ref_count;
  if (context->ref_count == 0) {
    FreeBuffer(context->buf);
    delete context;
  }

  delete req;
}

void SendPacketInternal(QueuedPacketInternal* packet) {
  if (socket_dead) {
    return;
  }

  SendPacketContext* context = new SendPacketContext;
  AllocBuffer(reinterpret_cast<uv_handle_t*>(&socket), packet->data->size(), &context->buf);
  assert(context->buf.len >= packet->data->size());
  memcpy_s(context->buf.base, context->buf.len, packet->data->data(), packet->data->size());
  context->ref_count = packet->targets->size();

  for (auto it = packet->targets->begin(); it != packet->targets->end(); ++it) {
    uv_udp_send_t* req = new uv_udp_send_t;
    req->data = context;
    int result = uv_udp_send(req, &socket, &context->buf, 1, reinterpret_cast<const sockaddr *>(&*it), OnPacketSent);
    if (result < 0) {
      Logger::Logf(LogLevel::Error, "Sending packet failed: %s %s", uv_err_name(result),
          uv_strerror(result));
    }
  }
}

void OnQueuedPackets(uv_async_t* handle) {
  uv_mutex_lock(&outgoing_mutex);
  QueuedPacketInternal* p = outgoing_packets;
  outgoing_packets = nullptr;
  uv_mutex_unlock(&outgoing_mutex);

  while (p != nullptr) {
    SendPacketInternal(p);
    QueuedPacketInternal* to_free = p;
    p = p->next;
    delete to_free->targets;
    delete to_free->data;
    delete to_free;
  }
}

int BeginSocketLoop(HANDLE receive_signal, const Settings& settings) {
  incoming_signal = receive_signal;
  loop = uv_loop_new();
  loop_thread = new uv_thread_t();

  socket_dead = false;
  int result = uv_udp_init(loop, &socket);
  if (result < 0) {
    Logger::Logf(LogLevel::Error, "Failed to init socket: %s %s", uv_err_name(result),
        uv_strerror(result));
    return result;
  }
  // TODO(tec27): should we allow users to pick an adapter?
  sockaddr_in receive_addr;
  uv_ip4_addr("0.0.0.0", settings.bw_port, &receive_addr);
  result = uv_udp_bind(&socket, reinterpret_cast<const sockaddr *>(&receive_addr), 0);
  if (result < 0) {
    Logger::Logf(LogLevel::Error, "Failed to bind socket: %s %s", uv_err_name(result),
        uv_strerror(result));
    return result;
  }
  Logger::Logf(LogLevel::Debug, "Snp socket bound to 0.0.0.0:%d", settings.bw_port);
  result = uv_udp_recv_start(&socket, AllocBuffer, OnReceive);
  if (result < 0) {
    Logger::Logf(LogLevel::Error, "Failed to start receiving on socket: %s %s", uv_err_name(result),
        uv_strerror(result));
    return result;
  }
  Logger::Log(LogLevel::Debug, "Snp socket ready to receive packets");

  parser = new PacketParser();
  uv_mutex_init(&incoming_mutex);
  uv_mutex_init(&outgoing_mutex);
  uv_async_init(loop, &outgoing_async, OnQueuedPackets);

  uv_thread_create(&loop_thread, ThreadFunc, nullptr);
  return 0;
}

void EndSocketLoop() {
  if (loop == nullptr) {
    return;
  }

  uv_close(reinterpret_cast<uv_handle_t*>(&socket), NULL);
  uv_close(reinterpret_cast<uv_handle_t*>(&outgoing_async), NULL);
  uv_mutex_destroy(&outgoing_mutex);
  uv_mutex_destroy(&incoming_mutex);
  uv_stop(loop);
  uv_thread_join(&loop_thread);
  uv_loop_delete(loop);
  loop = nullptr;
  delete parser;
  parser = nullptr;
  incoming_signal = NULL;
}

static void AddStormPacket(const sockaddr_in& from, const PacketHeader& header,
    const byte data[SNP_PACKET_SIZE]) {
  assert(header.type == PacketType::Storm);
  StormPacket* packet = new StormPacket();
  memcpy_s(packet->data, sizeof(packet->data), data, header.size);
  packet->from_address = from;
  packet->size = header.size;

  uv_mutex_lock(&incoming_mutex);
  if (incoming_packets == nullptr) {
    incoming_packets = packet;
  } else {
    StormPacket* list_packet = incoming_packets;
    while (list_packet->next != nullptr) {
      list_packet = list_packet->next;
    }
    list_packet->next = packet;
  }
  uv_mutex_unlock(&incoming_mutex);

  SetEvent(incoming_signal);
}

StormPacket* GetStormPacket() {
  StormPacket* result = nullptr;

  uv_mutex_lock(&incoming_mutex);
  if (incoming_packets != nullptr) {
    result = incoming_packets;
    incoming_packets = incoming_packets->next;
    result->next = nullptr;
  }
  uv_mutex_unlock(&incoming_mutex);

  return result;
}

void FreeStormPacket(StormPacket* packet) {
  delete packet;
}

void SendStormPacket(const QueuedPacket& packet) {
  QueuedPacketInternal* my_packet = new QueuedPacketInternal();
  my_packet->targets = new vector<sockaddr_in>();
  for (uint32 i = 0; i < packet.num_targets; i++) {
    my_packet->targets->push_back(*(packet.targets[i]));
  }

  PacketHeader header = PacketHeader();
  header.type = PacketType::Storm;
  header.size = packet.data_len;
  byte* header_bytes = reinterpret_cast<byte*>(&header);
  my_packet->data = new vector<byte>(header_bytes, header_bytes + sizeof(header));
  my_packet->data->insert(my_packet->data->end(), packet.data, packet.data + packet.data_len);

  uv_mutex_lock(&outgoing_mutex);
  if (outgoing_packets == nullptr) {
    outgoing_packets = my_packet;
  } else {
    QueuedPacketInternal* p = outgoing_packets;
    while (p->next != nullptr) {
      p = p->next;
    }
    p->next = my_packet;
  }
  uv_mutex_unlock(&outgoing_mutex);

  uv_async_send(&outgoing_async);
}

// The current structure of this parser assumes a small number of concurrent players and that it
// will be recreated between successive games. If this is not the case, the map of parser states
// could grow without bound.
PacketParser::PacketParser() : states_() {
}

PacketParser::~PacketParser() {
}

void PacketParser::Parse(const sockaddr_in* addr, ssize_t nread, uv_buf_t buf) {
  sockaddr_in my_addr = sockaddr_in(*addr);
  auto it = states_.find(my_addr);
  if (it == states_.end()) {
    auto result = states_.insert(make_pair(my_addr, ParserState()));
    it = result.first;
  }

  switch (it->second.read_state) {
  case ParserReadState::Header: ParseHeader(it, nread, buf); break;
  case ParserReadState::PacketData: ParseData(it, nread, buf); break;
  case ParserReadState::Blacklisted: break;  // TODO(tec27): try to let them back in after a bit?
  }
}

#define MIN(a, b) (((a) < (b)) ? (a) : (b))
void PacketParser::ParseHeader(const ParserStateMap::iterator& it, ssize_t nread, uv_buf_t buf) {
  uint32 offset = it->second.offset;
  uint32 header_size = sizeof(it->second.header);
  int32 left = header_size - offset;
  byte* header_ptr = reinterpret_cast<byte*>(&it->second.header);
  header_ptr += offset;
  memcpy_s(header_ptr, left, buf.base, MIN(nread, left));
  if (nread >= left) {
    // header is completed
    it->second.offset = 0;
    it->second.read_state = ParserReadState::PacketData;

    if (it->second.header.size > SNP_PACKET_SIZE) {
      Logger::Log(LogLevel::Debug, "Received a packet larger than the packet size");
      // they sent us an invalid header size (malicious or corrupted)
      // TODO(tec27): can this actually be because of corruption? if so, find a way to re-sync the
      // stream instead of blacklisting
      it->second.read_state = ParserReadState::Blacklisted;
    }

    if (nread > left) {
      // still data left in this buffer, pass it on to parse data from
      uv_buf_t leftover_buf;
      leftover_buf.base = buf.base + left;
      leftover_buf.len = buf.len - left;
      ParseData(it, nread - left, leftover_buf);
    }
  } else {
    // header is incomplete
    it->second.offset += nread;
  }
}

void PacketParser::ParseData(const ParserStateMap::iterator& it, ssize_t nread, uv_buf_t buf) {
  uint32 offset = it->second.offset;
  uint32 data_size = it->second.header.size;
  int32 left = data_size - offset;
  byte* data_ptr = &it->second.data[offset];
  memcpy_s(data_ptr, left, buf.base, MIN(nread, left));
  if (nread < left) {
    // packet is incomplete
    it->second.offset += nread;
  }

  // packet is complete
  switch (it->second.header.type) {
  case PacketType::Storm: HandleStormPacket(it); break;
  }

  it->second.read_state = ParserReadState::Header;
  it->second.offset = 0;

  if (nread > left) {
    // still data left in this buffer, pass it on to parse another header
    uv_buf_t leftover_buf;
    leftover_buf.base = buf.base + left;
    leftover_buf.len = buf.len - left;
    ParseHeader(it, nread - left, leftover_buf);
  }
}
#undef MIN

void PacketParser::HandleStormPacket(const ParserStateMap::iterator& it) {
  AddStormPacket(it->first, it->second.header, it->second.data);
}

}  // namespace snp
}  // namespace sbat
