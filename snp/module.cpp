#include "snp/module-priv.h"

#include <node.h>
#include <nan.h>
#include <uv.h>
#include <list>
#include <memory>

#include "snp/snp.h"

using Nan::FunctionCallbackInfo;
using Nan::HandleScope;
using Nan::Persistent;
using std::list;
using std::unique_ptr;
using v8::Array;
using v8::Function;
using v8::Local;
using v8::Maybe;
using v8::Object;
using v8::String;
using v8::Uint32;
using v8::Value;

namespace sbat{
namespace snp{

class Command;

static uv_mutex_t command_mutex;
static list<unique_ptr<Command>> js_commands;
static uv_async_t command_async;

static uv_mutex_t message_mutex;
static list<ReceivedMessage*> messages;

// The following static members should only be accessed on the JS thread
static Persistent<Object> module_exports;
static Persistent<Object> network_handler;

void QueueCommand(unique_ptr<Command> command) {
  uv_mutex_lock(&command_mutex);
  js_commands.push_back(std::move(command));
  uv_async_send(&command_async);
  uv_mutex_unlock(&command_mutex);
}

void OnCommandsQueued(uv_async_t* handle) {
  uv_mutex_lock(&command_mutex);
  if (js_commands.empty()) {
    uv_mutex_unlock(&command_mutex);
    return;
  }

  while (!js_commands.empty()) {
    list<unique_ptr<Command>> processing;
    processing.splice(processing.begin(), js_commands);
    uv_mutex_unlock(&command_mutex);

    for (const auto& command : processing) {
      command->Execute();
    }
    uv_mutex_lock(&command_mutex);
  }
  uv_mutex_unlock(&command_mutex);
}

void OnMessageReceived(const FunctionCallbackInfo<Value>& info) {
  auto handleInt = Nan::To<uint32_t>(info[0]);
  HANDLE receive_event = reinterpret_cast<HANDLE>(handleInt.FromJust());

  auto buffer = Nan::To<Object>(info[1]).ToLocalChecked();
  String::Utf8Value addressStr(Nan::To<String>(info[2]).ToLocalChecked());

  auto message = new ReceivedMessage();
  message->buffer.Reset(buffer);
  message->data = node::Buffer::Data(buffer);
  message->length = node::Buffer::Length(buffer);
  int result = uv_inet_pton(AF_INET, *addressStr, &message->from.sin_addr);
  assert(result == 0);
  message->from.sin_family = AF_INET;
  message->from.sin_port = htons(6112);

  uv_mutex_lock(&message_mutex);
  messages.push_back(std::move(message));
  SetEvent(receive_event);
  uv_mutex_unlock(&message_mutex);
}

Command::~Command() {}

CreateNetworkHandlerCommand::CreateNetworkHandlerCommand(HANDLE receive_event)
  : receive_event_(receive_event) {
}

void CreateNetworkHandlerCommand::Execute() {
  assert(!module_exports.IsEmpty());

  HandleScope scope;
  Local<Function> initFunc = Nan::Get(Nan::New(module_exports), Nan::New("init").ToLocalChecked())
      .ToLocalChecked().As<Function>();

  Local<Function> onReceive = Nan::New<Function>(OnMessageReceived);
  // This is a dumb hack to avoid creating a wrapper object for what is effectively an int.
  Local<Uint32> handleInt = Nan::New(reinterpret_cast<uint32_t>(receive_event_));
  Local<Value> argv[] = {
    onReceive,
    handleInt
  };
  network_handler.Reset(Nan::Call(initFunc, Nan::GetCurrentContext()->Global(), 2, argv)
      .ToLocalChecked().As<Object>());
}

void CreateNetworkHandler(HANDLE receive_event) {
  QueueCommand(std::make_unique<CreateNetworkHandlerCommand>(receive_event));
}

SendMessageCommand::SendMessageCommand(
    uint32 num_targets, sockaddr_in** targets, char* data, uint32 data_len) 
  : num_targets_(num_targets),
    targets_(new IN_ADDR[num_targets]),
    data_(new char[data_len]),
    data_len_(data_len) {
  std::copy(data, data + data_len, data_);
  for (uint32_t i = 0; i < num_targets; i++) {
    const auto& target = *targets[i];
    std::copy(&target.sin_addr, (&target.sin_addr) + 1, &targets_[i]);
  }
}

SendMessageCommand::~SendMessageCommand() {
  delete[] targets_;
  // We don't delete data here because it's being used by a Buffer, the Buffer will call FreeData
  // when its GC'd
}

void SendMessageCommand::Execute() {
  assert(!network_handler.IsEmpty());

  HandleScope scope;
  Local<Object> handler = Nan::New(network_handler);
  Local<Function> sendFunc =
      Nan::Get(handler, Nan::New("send").ToLocalChecked()).ToLocalChecked().As<Function>();

  Local<Object> buffer =
    Nan::NewBuffer(data_, data_len_, SendMessageCommand::FreeData, nullptr).ToLocalChecked();
  Local<Array> targets = Nan::New<Array>();
  for (uint32_t i = 0; i < num_targets_; i++) {
    const auto& target = targets_[i];
    char stringified[20];
    int result = uv_inet_ntop(AF_INET, &target, stringified, sizeof(stringified));
    Nan::Set(targets, i, Nan::New(stringified).ToLocalChecked());
  }

  Local<Value> argv[] = {
    targets,
    buffer
  };
  Nan::Call(sendFunc, handler, 2, argv);
}

void SendMessageCommand::FreeData(char* data, void* hint) {
  delete[] data;
}

void SendNetworkMessage(uint32 num_targets, sockaddr_in** targets, char* data, uint32 data_len) {
  QueueCommand(std::make_unique<SendMessageCommand>(num_targets, targets, data, data_len));
}

DestroyNetworkHandlerCommand::DestroyNetworkHandlerCommand() {
}

void DestroyNetworkHandlerCommand::Execute() {
  assert(!network_handler.IsEmpty());

  HandleScope scope;
  Local<Object> handler = Nan::New(network_handler);
  Local<Function> destroyFunc =
    Nan::Get(handler, Nan::New("destroy").ToLocalChecked()).ToLocalChecked().As<Function>();

  Nan::Call(destroyFunc, handler, 0, nullptr);

  network_handler.Empty();
}

void DestroyNetworkHandler() {
  QueueCommand(std::make_unique<DestroyNetworkHandlerCommand>());
}

bool RetrieveMessage(sockaddr_in** from_ptr, char** data_ptr, uint32* data_len_ptr) {
  uv_mutex_lock(&message_mutex);
  if (messages.empty()) {
    uv_mutex_unlock(&message_mutex);
    return false;
  }
  auto message = messages.front();
  messages.pop_front();
  uv_mutex_unlock(&message_mutex);

  *from_ptr = &message->from;
  *data_ptr = message->data;
  *data_len_ptr = message->length;
  return true;
}

void FreeMessage(sockaddr_in* from, char* packet, uint32 data_len) {
  ReceivedMessage* message = reinterpret_cast<ReceivedMessage*>(from);
  delete message;
}
  
void InitModule(Local<Object> exports, Local<Value> unused) {
  uv_mutex_init(&message_mutex);

  uv_mutex_init(&command_mutex);
  uv_async_init(uv_default_loop(), &command_async, OnCommandsQueued);

  module_exports.Reset(exports);
}

}
}

NODE_MODULE(shieldbattery_snp, sbat::snp::InitModule);