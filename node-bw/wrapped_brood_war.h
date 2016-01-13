#pragma once

#include <node.h>
#include <nan.h>
#include <map>
#include <memory>
#include <string>

#include "node-bw/brood_war.h"
#include "common/types.h"
#include "logger/logger.h"

namespace sbat {
namespace bw {

template <typename target_t, typename getter_t>
inline void SetProtoAccessor(target_t& tpl, const char* name, getter_t getter) {
  Nan::SetAccessor(tpl->PrototypeTemplate(), Nan::New<v8::String>(name).ToLocalChecked(), getter);
}

template <typename target_t, typename getter_t, typename setter_t>
inline void SetProtoAccessor(target_t& tpl, const char* name, getter_t getter, setter_t setter) {
  Nan::SetAccessor(tpl->PrototypeTemplate(), Nan::New<v8::String>(name).ToLocalChecked(), getter,
      setter);
}

class EventHandlerContext {
public:
  explicit EventHandlerContext(v8::Local<v8::Function> callback);
  ~EventHandlerContext();
  v8::Local<v8::Function> callback() const;
private:
  Nan::Persistent<v8::Function> callback_;
};

class BwPlayerSlot : public Nan::ObjectWrap {
public:
  static void Init();
  static v8::Local<v8::Value> NewInstance(PlayerInfo* player_info);

private:
  BwPlayerSlot();
  ~BwPlayerSlot();
  void set_player_info(PlayerInfo* player_info);

  // Disallow copying
  BwPlayerSlot(const BwPlayerSlot&) = delete;
  BwPlayerSlot& operator=(const BwPlayerSlot&) = delete;

  static Nan::Persistent<v8::Function> constructor;
  static void New(const Nan::FunctionCallbackInfo<v8::Value>& info);

  // getters
  static void GetPlayerId(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void GetStormId(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void GetType(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void GetRace(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void GetTeam(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void GetName(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);

  template <class T>
  static PlayerInfo* Unwrap(const T &t) {
    BwPlayerSlot* wrapped = ObjectWrap::Unwrap<BwPlayerSlot>(t.This());
    return wrapped->player_info_;
  }

  PlayerInfo* player_info_;
};

typedef void (*GameLoopWorkerFunc)(void* arg);
typedef void (*GameLoopAfterFunc)(void* arg);

class GameLoopQueue {
  struct GameLoopFuncContext {
    GameLoopFuncContext(void* arg, GameLoopWorkerFunc worker_func, GameLoopAfterFunc after_func)
        : arg(arg),
          worker_func(worker_func),
          after_func(after_func) {
    }

    void* arg;
    GameLoopWorkerFunc worker_func;
    GameLoopAfterFunc after_func;  // nullable
  };

public:
  GameLoopQueue();
  ~GameLoopQueue();

  inline bool has_items() { return has_items_; }
  void QueueFunc(void* arg, GameLoopWorkerFunc worker_func);
  void QueueFunc(void* arg, GameLoopWorkerFunc worker_func, GameLoopAfterFunc after_func);
  void ExecuteItems();

private:
  // Disallow copying
  GameLoopQueue(const GameLoopQueue&) = delete;
  GameLoopQueue& operator=(const GameLoopQueue&) = delete;

  static void OnExecutionCompleted(uv_async_t* handle);

  volatile bool has_items_;
  uv_mutex_t mutex_;
  uv_async_t async_;
  std::list<GameLoopFuncContext> items_;
  std::list<GameLoopFuncContext> completed_;
};

class WrappedBroodWar : public Nan::ObjectWrap {
public:
  static void Init();
  static v8::Local<v8::Value> NewInstance(const Nan::FunctionCallbackInfo<v8::Value>& info);

  typedef std::map<std::string, std::shared_ptr<EventHandlerContext>> EventHandlerMap;
  static std::map<WrappedBroodWar*, EventHandlerMap> event_handlers_;

private:
  WrappedBroodWar();
  ~WrappedBroodWar();

  static Nan::Persistent<v8::Function> constructor;
  static void New(const Nan::FunctionCallbackInfo<v8::Value>& info);

  // accessors
  static void GetCurrentMapPath(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void GetCurrentMapName(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void GetCurrentMapFolderPath(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void GetLocalPlayerId(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void GetLocalLobbyId(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void GetLocalPlayerName(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void SetLocalPlayerName(v8::Local<v8::String> property, v8::Local<v8::Value> value,
      const Nan::PropertyCallbackInfo<void>& info);
  static void GetGameSpeed(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void GetIsBroodWar(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void SetIsBroodWar(v8::Local<v8::String> property, v8::Local<v8::Value> value,
      const Nan::PropertyCallbackInfo<void>& info);
  static void GetIsMultiplayer(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void SetIsMultiplayer(v8::Local<v8::String> property, v8::Local<v8::Value> value,
      const Nan::PropertyCallbackInfo<void>& info);
  static void GetIsHostingGame(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void GetWasBooted(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void GetBootReason(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void GetLobbyDirtyFlag(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void SetLobbyDirtyFlag(v8::Local<v8::String> property, v8::Local<v8::Value> value,
      const Nan::PropertyCallbackInfo<void>& info);
  static void GetEventHandler(v8::Local<v8::String> property,
      const Nan::PropertyCallbackInfo<v8::Value>& info);
  static void SetEventHandler(v8::Local<v8::String> property, v8::Local<v8::Value> value,
      const Nan::PropertyCallbackInfo<void>& info);

  // functions
  static void SetSettings(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void InitProcess(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void InitSprites(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void InitPlayerInfo(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void ChooseNetworkProvider(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void CreateGame(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void SpoofGame(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void JoinGame(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void InitGameNetwork(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void AddComputer(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void SetRace(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void ProcessLobbyTurn(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void StartGameCountdown(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void RunGameLoop(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void SendMultiplayerChatMessage(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void DisplayIngameMessage(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void CleanUpForExit(const Nan::FunctionCallbackInfo<v8::Value>& info);

  // unwrapper helper
  template <class T>
  static BroodWar* Unwrap(const T &t) {
    WrappedBroodWar* wrapped_bw = ObjectWrap::Unwrap<WrappedBroodWar>(t.This());
    return wrapped_bw->brood_war_;
  }

  // Event handlers for BroodWar
  static void OnLobbyDownloadStatus(byte slot, byte download_percent);
  static void OnLobbySlotChange(byte slot, byte storm_id, byte type, byte race, byte team);
  static void OnLobbyStartCountdown();
  static void OnLobbyGameInit(uint32 random_seed, byte player_bytes[8]);
  static void OnLobbyMissionBriefing(byte slot);
  static void OnLobbyChatMessage(byte slot, const std::string& message);
  static void OnMenuErrorDialog(const std::string& message);
  static void OnGameLoopIteration();
  static void OnCheckForChatCommand(const std::string& message, ChatMessageType message_type,
      byte recipients);
  
  // Functions for logging
  static void Log(void* arg, LogLevel level, const char* msg);

  Nan::Persistent<v8::String> log_symbol_;
  BroodWar* brood_war_;
  static GameLoopQueue* game_loop_queue_;
};

}  // namespace bw
}  // namespace sbat
