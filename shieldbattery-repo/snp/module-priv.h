#pragma once

#include <nan.h>
#include <Windows.h>

#include "common/types.h"

namespace sbat {
namespace snp {

// A generic command that can be passed via our async command queue
class Command {
public:
  virtual ~Command() = 0;
  // Execute this command, will be run on the JS thread
  virtual void Execute() = 0;
};

class CreateNetworkHandlerCommand : public Command {
public:
  CreateNetworkHandlerCommand(HANDLE receive_event);
  virtual void Execute();

private:
  HANDLE receive_event_;
};

class SendMessageCommand : public Command {
public:
  SendMessageCommand(uint32 num_targets, sockaddr_in** targets, char* data, uint32 data_len);
  virtual ~SendMessageCommand();
  virtual void Execute();
private:
  static void FreeData(char* data, void* hint);

  uint32 num_targets_;
  IN_ADDR* targets_;
  char* data_;
  uint32 data_len_;
};

class DestroyNetworkHandlerCommand : public Command {
public:
  DestroyNetworkHandlerCommand();
  virtual void Execute();
};

struct ReceivedMessage {
  // from needs to be the first thing in this struct such that &from => &ReceivedMessage (so we can
  // free what Storm gives us)
  sockaddr_in from;
  Nan::Persistent<v8::Object> buffer;
  char* data;
  size_t length;
};

}
}