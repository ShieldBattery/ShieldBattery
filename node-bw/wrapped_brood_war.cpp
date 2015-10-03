#include  "./wrapped_brood_war.h"

#include <nan.h>
#include <node.h>
#include <uv.h>
#include <list>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "node-bw/brood_war.h"
#include "node-bw/immediate.h"
#include "logger/logger.h"
#include "shieldbattery/settings.h"
#include "shieldbattery/shieldbattery.h"
#include "v8-helpers/helpers.h"

using Nan::Callback;
using Nan::EscapableHandleScope;
using Nan::FunctionCallbackInfo;
using Nan::GetCurrentContext;
using Nan::HandleScope;
using Nan::MakeCallback;
using Nan::Null;
using Nan::Persistent;
using Nan::PropertyCallbackInfo;
using Nan::SetAccessor;
using Nan::SetPrototypeMethod;
using Nan::ThrowError;
using Nan::ThrowTypeError;
using Nan::To;
using Nan::Utf8String;
using std::list;
using std::make_pair;
using std::map;
using std::shared_ptr;
using std::unique_ptr;
using std::vector;
using std::wstring;
using v8::Array;
using v8::Boolean;
using v8::Context;
using v8::Function;
using v8::FunctionTemplate;
using v8::Int32;
using v8::Integer;
using v8::Local;
using v8::Object;
using v8::ObjectTemplate;
using v8::String;
using v8::Uint32;
using v8::Value;

namespace sbat {
namespace bw {

map<WrappedBroodWar*, WrappedBroodWar::EventHandlerMap> WrappedBroodWar::event_handlers_;
GameLoopQueue* WrappedBroodWar::game_loop_queue_;

EventHandlerContext::EventHandlerContext(Local<Function> callback)
    : callback_(Persistent<Function>(callback)) {
}

EventHandlerContext::~EventHandlerContext() {
  callback_.Reset();
}

Local<Function> EventHandlerContext::callback() const {
  Local<Function> cb = Nan::New<Function>(callback_);
  return cb;
}

BwPlayerSlot::BwPlayerSlot() : player_info_(nullptr) {
}

BwPlayerSlot::~BwPlayerSlot() {
}

void BwPlayerSlot::set_player_info(PlayerInfo* player_info) {
  player_info_ = player_info;
}

Persistent<Function> BwPlayerSlot::constructor;

void BwPlayerSlot::Init() {
  Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(New);
  tpl->SetClassName(Nan::New("BwPlayerSlot").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  // functions
  SetProtoAccessor(tpl, "playerId", GetStormId);
  SetProtoAccessor(tpl, "stormId", GetStormId);
  SetProtoAccessor(tpl, "type", GetType);
  SetProtoAccessor(tpl, "race", GetRace);
  SetProtoAccessor(tpl, "team", GetTeam);
  SetProtoAccessor(tpl, "name", GetName);

  constructor.Reset(tpl->GetFunction());
}

void BwPlayerSlot::New(const FunctionCallbackInfo<Value>& info) {
  BwPlayerSlot* playerSlot = new BwPlayerSlot();
  playerSlot->Wrap(info.This());

  info.GetReturnValue().Set(info.This());
}

Local<Value> BwPlayerSlot::NewInstance(PlayerInfo* player_info) {
  EscapableHandleScope scope;

  Local<Function> cons = Nan::New<Function>(constructor);
  Local<Object> instance = cons->NewInstance();
  BwPlayerSlot* wrapped = ObjectWrap::Unwrap<BwPlayerSlot>(instance);
  wrapped->set_player_info(player_info);

  return scope.Escape(instance);
}

void BwPlayerSlot::GetPlayerId(Local<String> property, const PropertyCallbackInfo<Value>& info) {
  PlayerInfo* player_info = BwPlayerSlot::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(Integer::NewFromUnsigned(
      static_cast<uint32>(player_info->player_id))));
}

void BwPlayerSlot::GetStormId(Local<String> property, const PropertyCallbackInfo<Value>& info) {
  PlayerInfo* player_info = BwPlayerSlot::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(Integer::NewFromUnsigned(
      static_cast<uint32>(player_info->storm_id))));
}

void BwPlayerSlot::GetType(Local<String> property, const PropertyCallbackInfo<Value>& info) {
  PlayerInfo* player_info = BwPlayerSlot::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(Integer::NewFromUnsigned(
      static_cast<uint32>(player_info->type))));
}

void BwPlayerSlot::GetRace(Local<String> property, const PropertyCallbackInfo<Value>& info) {
  PlayerInfo* player_info = BwPlayerSlot::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(Integer::NewFromUnsigned(
      static_cast<uint32>(player_info->race))));
}

void BwPlayerSlot::GetTeam(Local<String> property, const PropertyCallbackInfo<Value>& info) {
  PlayerInfo* player_info = BwPlayerSlot::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(Integer::NewFromUnsigned(
      static_cast<uint32>(player_info->team))));
}

void BwPlayerSlot::GetName(Local<String> property, const PropertyCallbackInfo<Value>& info) {
  PlayerInfo* player_info = BwPlayerSlot::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(player_info->name).ToLocalChecked());
}

WrappedBroodWar::WrappedBroodWar()
    : brood_war_(BroodWar::Get()),
      log_symbol_(Persistent<String>(Nan::New("onLog").ToLocalChecked())) {
  HandleScope scope;
  event_handlers_.insert(make_pair(this, WrappedBroodWar::EventHandlerMap()));
  Logger::Init(WrappedBroodWar::Log, this);
}

WrappedBroodWar::~WrappedBroodWar() {
  // BroodWar is a singleton, so we don't want to delete it
  event_handlers_.erase(this);
  Logger::Destroy(Log, this);
  log_symbol_.Reset();
}

Persistent<Function> WrappedBroodWar::constructor;

void WrappedBroodWar::Init() {
  BroodWar* bw = BroodWar::Get();

  game_loop_queue_ = new GameLoopQueue();

  EventHandlers handlers;
  handlers.OnLobbyDownloadStatus = OnLobbyDownloadStatus;
  handlers.OnLobbySlotChange = OnLobbySlotChange;
  handlers.OnLobbyStartCountdown = OnLobbyStartCountdown;
  handlers.OnLobbyGameInit = OnLobbyGameInit;
  handlers.OnLobbyMissionBriefing = OnLobbyMissionBriefing;
  handlers.OnLobbyChatMessage = OnLobbyChatMessage;
  handlers.OnMenuErrorDialog = OnMenuErrorDialog;
  handlers.OnGameLoopIteration = OnGameLoopIteration;
  handlers.OnCheckForChatCommand = OnCheckForChatCommand;
  bw->set_event_handlers(handlers);

  Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(New);
  tpl->SetClassName(Nan::New("CBroodWar").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  // accessors
  SetProtoAccessor(tpl, "currentMapPath", GetCurrentMapPath);
  SetProtoAccessor(tpl, "currentMapName", GetCurrentMapName);
  SetProtoAccessor(tpl, "currentMapFolderPath", GetCurrentMapFolderPath);
  SetProtoAccessor(tpl, "localPlayerId", GetLocalPlayerId);
  SetProtoAccessor(tpl, "localLobbyId", GetLocalLobbyId);
  SetProtoAccessor(tpl, "localPlayerName", GetLocalPlayerName, SetLocalPlayerName);
  SetProtoAccessor(tpl, "gameSpeed", GetGameSpeed);
  SetProtoAccessor(tpl, "isBroodWar", GetIsBroodWar, SetIsBroodWar);
  SetProtoAccessor(tpl, "isMultiplayer", GetIsMultiplayer, SetIsMultiplayer);
  SetProtoAccessor(tpl, "isHostingGame", GetIsHostingGame);
  SetProtoAccessor(tpl, "wasBooted", GetWasBooted);
  SetProtoAccessor(tpl, "bootReason", GetBootReason);
  SetProtoAccessor(tpl, "lobbyDirtyFlag", GetLobbyDirtyFlag, SetLobbyDirtyFlag);

#define EVENT_HANDLER(name) SetProtoAccessor(tpl, (##name), GetEventHandler, SetEventHandler);
  EVENT_HANDLER("onLobbyDownloadStatus");
  EVENT_HANDLER("onLobbySlotChange");
  EVENT_HANDLER("onLobbyStartCountdown");
  EVENT_HANDLER("onLobbyGameInit");
  EVENT_HANDLER("onLobbyMissionBriefing");
  EVENT_HANDLER("onLobbyChatMessage");
  EVENT_HANDLER("onMenuErrorDialog");
  EVENT_HANDLER("onCheckForChatCommand");
#undef EVENT_HANDLER

  // functions
  SetPrototypeMethod(tpl, "setSettings", SetSettings);
  SetPrototypeMethod(tpl, "initProcess", InitProcess);
  SetPrototypeMethod(tpl, "initSprites", InitSprites);
  SetPrototypeMethod(tpl, "initPlayerInfo", InitPlayerInfo);
  SetPrototypeMethod(tpl, "chooseNetworkProvider", ChooseNetworkProvider);
  SetPrototypeMethod(tpl, "createGame", CreateGame);
  SetPrototypeMethod(tpl, "spoofGame", SpoofGame);
  SetPrototypeMethod(tpl, "joinGame", JoinGame);
  SetPrototypeMethod(tpl, "initGameNetwork", InitGameNetwork);
  SetPrototypeMethod(tpl, "addComputer", AddComputer);
  SetPrototypeMethod(tpl, "setRace", SetRace);
  SetPrototypeMethod(tpl, "processLobbyTurn", ProcessLobbyTurn);
  SetPrototypeMethod(tpl, "startGameCountdown", StartGameCountdown);
  SetPrototypeMethod(tpl, "runGameLoop", RunGameLoop);
  SetPrototypeMethod(tpl, "sendMultiplayerChatMessage", SendMultiplayerChatMessage);
  SetPrototypeMethod(tpl, "displayIngameMessage", DisplayIngameMessage);
  SetPrototypeMethod(tpl, "cleanUpForExit", CleanUpForExit);

  constructor.Reset(tpl->GetFunction());
}

void WrappedBroodWar::New(const FunctionCallbackInfo<Value>& info) {
  WrappedBroodWar* bw = new WrappedBroodWar();
  bw->Wrap(info.This());

  info.GetReturnValue().Set(info.This());
}

Local<Value> WrappedBroodWar::NewInstance(const FunctionCallbackInfo<Value>& info) {
  EscapableHandleScope scope;

  Local<Function> cons = Nan::New<Function>(constructor);
  Local<Object> instance = cons->NewInstance();
  WrappedBroodWar* wrapped_bw = ObjectWrap::Unwrap<WrappedBroodWar>(instance);
  BroodWar* bw = wrapped_bw->brood_war_;

  Local<Array> slots = Nan::New<Array>(8);
  PlayerInfo* infos = bw->players();
  for (int i = 0; i < 8; i++) {
    slots->Set(i, BwPlayerSlot::NewInstance(&infos[i]));
  }
  instance->Set(Nan::New("slots").ToLocalChecked(), slots);

  return scope.Escape(instance);
}

void WrappedBroodWar::Log(void* arg, LogLevel level, const char* msg) {
  WrappedBroodWar* wrapped = reinterpret_cast<WrappedBroodWar*>(arg);
  Local<String> log_symbol = Nan::New<String>(wrapped->log_symbol_);
  Local<Value> callback = Nan::Get(wrapped->handle(), log_symbol).ToLocalChecked();
  if (!callback->IsFunction()) {
    return;
  }

  Local<Value> argv[] = { Nan::New(static_cast<int32>(level)), Nan::New(msg).ToLocalChecked() };
  MakeCallback(GetCurrentContext()->Global(), callback.As<Function>(), 2, argv);
}

// accessor defitions
void WrappedBroodWar::GetCurrentMapPath(Local<String> property,
    const PropertyCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(bw->current_map_path().c_str()).ToLocalChecked());
}

void WrappedBroodWar::GetCurrentMapName(Local<String> property,
    const PropertyCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(bw->current_map_name().c_str()).ToLocalChecked());
}

void WrappedBroodWar::GetCurrentMapFolderPath(Local<String> property,
    const PropertyCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(bw->current_map_folder_path().c_str()).ToLocalChecked());
}

void WrappedBroodWar::GetLocalPlayerId(Local<String> property,
    const PropertyCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(Uint32::NewFromUnsigned(bw->local_player_id())));
}

void WrappedBroodWar::GetLocalLobbyId(Local<String> property,
    const PropertyCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(Uint32::NewFromUnsigned(bw->local_lobby_id())));
}

void WrappedBroodWar::GetLocalPlayerName(Local<String> property,
    const PropertyCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(bw->local_player_name().c_str()).ToLocalChecked());
}

void WrappedBroodWar::SetLocalPlayerName(Local<String> property, Local<Value> value,
    const PropertyCallbackInfo<void>& info) {
  if (!value->IsString() && !value->IsStringObject()) {
    ThrowTypeError("Local player name must be a String");
    return;
  }

  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  String::AsciiValue ascii_value(value);
  char* c_str = *ascii_value;
  bw->set_local_player_name(c_str ? std::string(c_str) : std::string());
}

void WrappedBroodWar::GetGameSpeed(Local<String> property,
    const PropertyCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(static_cast<int32>(bw->current_game_speed())));
}

void WrappedBroodWar::GetIsBroodWar(Local<String> property,
    const PropertyCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(bw->is_brood_war()));
}

void WrappedBroodWar::SetIsBroodWar(Local<String> property, Local<Value> value,
    const PropertyCallbackInfo<void>& info) {
  if (!value->IsBoolean() && !value->IsBooleanObject()) {
    ThrowTypeError("isBroodWar must be a Boolean");
    return;
  }

  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  bw->set_is_brood_war(value->BooleanValue());
}

void WrappedBroodWar::GetIsMultiplayer(Local<String> property,
    const PropertyCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(bw->is_multiplayer()));
}

void WrappedBroodWar::SetIsMultiplayer(Local<String> property, Local<Value> value,
    const PropertyCallbackInfo<void>& info) {
  if (!value->IsBoolean() && !value->IsBooleanObject()) {
    ThrowTypeError("isMultiplayer must be a Boolean");
    return;
  }

  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  bw->set_is_multiplayer(value->BooleanValue());
}

void WrappedBroodWar::GetIsHostingGame(Local<String> property,
    const PropertyCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(bw->is_hosting_game()));
}

void WrappedBroodWar::GetWasBooted(Local<String> property,
    const PropertyCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(bw->was_booted()));
}

void WrappedBroodWar::GetBootReason(Local<String> property,
    const PropertyCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(static_cast<int32>(bw->boot_reason())));
}

void WrappedBroodWar::GetLobbyDirtyFlag(Local<String> property,
    const PropertyCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  info.GetReturnValue().Set(Nan::New(bw->lobby_dirty_flag()));
}

void WrappedBroodWar::SetLobbyDirtyFlag(Local<String> property, Local<Value> value,
    const PropertyCallbackInfo<void>& info) {
  if (!value->IsBoolean() && !value->IsBooleanObject()) {
    ThrowTypeError("lobbyDirtyFlag must be a Boolean");
    return;
  }

  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  bw->set_lobby_dirty_flag(value->BooleanValue());
}

void WrappedBroodWar::GetEventHandler(Local<String> property,
    const PropertyCallbackInfo<Value>& info) {
  Utf8String name(property);
  std::string std_name(*name);
  WrappedBroodWar* wrapped_bw = ObjectWrap::Unwrap<WrappedBroodWar>(info.This());

  auto i = event_handlers_[wrapped_bw].find(std_name);
  if (i != event_handlers_[wrapped_bw].end()) {
    info.GetReturnValue().Set(i->second->callback());
  }

  return;
}

void WrappedBroodWar::SetEventHandler(Local<String> property, Local<Value> value,
    const PropertyCallbackInfo<void>& info) {
  if (!value->IsFunction() && !value->IsUndefined() && !value->IsNull()) {
    ThrowTypeError("callback must be a function");
    return;
  }

  Utf8String name(property);
  std::string std_name(*name);
  WrappedBroodWar* wrapped_bw = ObjectWrap::Unwrap<WrappedBroodWar>(info.This());

  if (!value->IsFunction()) {
    event_handlers_[wrapped_bw].erase(std_name);
  } else {
    event_handlers_[wrapped_bw].insert(make_pair(std_name, 
        shared_ptr<EventHandlerContext>(new EventHandlerContext(value.As<Function>()))));
  }
}

void WrappedBroodWar::SetSettings(const FunctionCallbackInfo<Value>& info) {
  // This function should be called before the dependent modules (Snp, Forge, etc.) are loaded and
  // initialized, so that they can make use of any custom settings
  assert(info.Length() > 0);
  Local<Object> settings_object = To<Object>(info[0]).ToLocalChecked();
  Settings result = Settings();

  if (settings_object->Has(Nan::New("bwPort").ToLocalChecked())) {
    result.bw_port = settings_object->Get(Nan::New("bwPort").ToLocalChecked())->Int32Value();
  } else {
    Logger::Log(LogLevel::Warning, "Using default value for setting bwPort");
    result.bw_port = 6112;
  }

  if (settings_object->Has(Nan::New("width").ToLocalChecked())) {
    result.width = settings_object->Get(Nan::New("width").ToLocalChecked())->Int32Value();
  } else {
    Logger::Log(LogLevel::Warning, "Using default value for setting width");
    result.width = 640;
  }

  if (settings_object->Has(Nan::New("height").ToLocalChecked())) {
    result.height = settings_object->Get(Nan::New("height").ToLocalChecked())->Int32Value();
  } else {
    Logger::Log(LogLevel::Warning, "Using default value for setting height");
    result.height = 480;
  }

  if (settings_object->Has(Nan::New("displayMode").ToLocalChecked())) {
    result.display_mode = static_cast<DisplayMode>(
        settings_object->Get(Nan::New("displayMode").ToLocalChecked())->Int32Value());
  } else {
    Logger::Log(LogLevel::Warning, "Using default value for setting displayMode");
    result.display_mode = DisplayMode::FullScreen;
  }

  if (settings_object->Has(Nan::New("mouseSensitivity").ToLocalChecked())) {
    result.mouse_sensitivity =
        settings_object->Get(Nan::New("mouseSensitivity").ToLocalChecked())->Int32Value();
    if (result.mouse_sensitivity < 0 || result.mouse_sensitivity > 4) {
      Logger::Log(LogLevel::Warning, "mouseSensitivity out of valid range, using default value");
      result.mouse_sensitivity = 0;
    }
  } else {
    Logger::Log(LogLevel::Warning, "Using default value for setting mouseSensitivity");
    result.mouse_sensitivity = 0;
  }

  if (settings_object->Has(Nan::New("maintainAspectRatio").ToLocalChecked())) {
    result.maintain_aspect_ratio =
        settings_object->Get(Nan::New("maintainAspectRatio").ToLocalChecked())->BooleanValue();
  } else {
    Logger::Log(LogLevel::Warning, "Using default value for setting aspectRatio");
    result.maintain_aspect_ratio = true;
  }

  if (settings_object->Has(Nan::New("renderer").ToLocalChecked())) {
    result.renderer = static_cast<RenderMode>(
        settings_object->Get(Nan::New("renderer").ToLocalChecked())->Int32Value());
  } else {
    Logger::Log(LogLevel::Warning, "Using default renderer");
    result.renderer = RenderMode::DirectX;
  }

  sbat::SetSettings(result);
  return;
}

struct InitProcessContext {
  unique_ptr<Callback> callback;
};

void InitProcessAfter(void* arg) {
  HandleScope scope;
  InitProcessContext* context = reinterpret_cast<InitProcessContext*>(arg);

  context->callback->Call(GetCurrentContext()->Global(), 0, NULL);
  delete context;
}

// function definitions
void WrappedBroodWar::InitProcess(const FunctionCallbackInfo<Value>& info) {
  // This only needs to be called once per process launch, but calling it multiple times will not
  // harm anything
  if (info.Length() < 1) {
    ThrowError("Incorrect number of arguments");
    return;
  } else if (!info[0]->IsFunction()) {
    ThrowTypeError("Expected callback function");
    return;
  }

  InitProcessContext* context = new InitProcessContext;
  context->callback.reset(new Callback(info[0].As<Function>()));

  sbat::InitializeProcess(context, InitProcessAfter);

  return;
}

struct InitSpritesContext {
  unique_ptr<Callback> cb;
  BroodWar* bw;
};

void InitSpritesWork(void* arg) {
  InitSpritesContext* context = reinterpret_cast<InitSpritesContext*>(arg);
  context->bw->InitSprites();
}

void InitSpritesAfter(void* arg) {
  HandleScope scope;

  InitSpritesContext* context = reinterpret_cast<InitSpritesContext*>(arg);
  context->cb->Call(GetCurrentContext()->Global(), 0, NULL);

  delete context;
}

void WrappedBroodWar::InitSprites(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() >= 1);

  InitSpritesContext* context = new InitSpritesContext();
  context->cb.reset(new Callback(info[0].As<Function>()));
  context->bw = WrappedBroodWar::Unwrap(info);

  sbat::QueueWorkForUiThread(context, InitSpritesWork, InitSpritesAfter);

  return;
}

void WrappedBroodWar::InitPlayerInfo(const FunctionCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  bw->InitPlayerInfo();

  return;
}

void WrappedBroodWar::ChooseNetworkProvider(const FunctionCallbackInfo<Value>& info) {
  if (info.Length() > 0 &&
      !(info[0]->IsNumber() || info[0]->IsNumberObject() ||
      info[0]->IsUint32() || info[0]->IsInt32())) {
    ThrowTypeError("networkProvider must be a Number");
    return;
  }

  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  bool result;
  if (info.Length() > 0) {
    result = bw->ChooseNetworkProvider(info[0]->ToUint32()->Uint32Value());
  } else {
    result = bw->ChooseNetworkProvider();
  }

  info.GetReturnValue().Set(Nan::New(result));
}

void WrappedBroodWar::CreateGame(const FunctionCallbackInfo<Value>& info) {
  if (info.Length() < 1) {
    ThrowError("Incorrect number of arguments");
    return;
  } else if (!info[0]->IsObject()) {
    ThrowTypeError("Incorrect arguments");
    return;
  }

  Local<Object> config = Local<Object>::Cast(info[0]);
  if (!config->Has(Nan::New("mapPath").ToLocalChecked()) ||
      !config->Has(Nan::New("gameType").ToLocalChecked())) {
    ThrowTypeError("Must specify at least mapPath and gameType");
    return;
  }

  char* game_name = nullptr;
  char* map_path;
  uint32 game_type;
  GameSpeed game_speed = GameSpeed::Fastest;

  Local<Value> game_name_value = config->Get(Nan::New("name").ToLocalChecked());
  if (!game_name_value.IsEmpty() &&
      (game_name_value->IsString() || game_name_value->IsStringObject())) {
    String::AsciiValue ascii(game_name_value);
    game_name = *ascii;
  }

  Local<Value> map_path_value = config->Get(Nan::New("mapPath").ToLocalChecked());
  if (!map_path_value->IsString() && !map_path_value->IsStringObject()) {
    ThrowTypeError("mapPath must be a String");
    return;
  }
  String::AsciiValue map_path_ascii(map_path_value);
  map_path = *map_path_ascii;

  Local<Value> game_type_value = config->Get(Nan::New("gameType").ToLocalChecked());
  if (!game_type_value->IsNumber() && !game_type_value->IsNumberObject() &&
      !game_type_value->IsUint32() && !game_type_value->IsInt32()) {
    ThrowTypeError("gameType must be a Number");
    return;
  }
  game_type = game_type_value->ToUint32()->Uint32Value();

  Local<Value> game_speed_value = config->Get(Nan::New("speed").ToLocalChecked());
  if (!game_speed_value.IsEmpty() &&
      (game_speed_value->IsNumber() || game_speed_value->IsNumberObject() ||
      game_speed_value->IsUint32() || game_speed_value->IsInt32())) {
    game_speed = static_cast<GameSpeed>(game_speed_value->ToInt32()->Int32Value());
  }

  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  MapResult result = bw->CreateGame(game_name ? game_name : "ShieldBattery", map_path, game_type,
      game_speed);

  info.GetReturnValue().Set(Nan::New(result == MapResult::OK));
}

void WrappedBroodWar::SpoofGame(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 4);

  String::AsciiValue game_name_value(info[0]);
  std::string game_name = *game_name_value;
  bool is_replay = info[1]->BooleanValue();
  Utf8String address(info[2]);
  uint32 port = info[3]->Uint32Value();

  SnpInterface* snp = GetSnpInterface();
  assert(snp != nullptr);
  snp->SpoofGame(game_name, uv_ip4_addr(*address, port), is_replay);

  return;
}

void WrappedBroodWar::JoinGame(const FunctionCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  // Basically none of this info actually matters, although BW likes to check it for some reason.
  // The actual game info will be distributed upon joining. The thing that *does* matter is the
  // index, make sure it matches the index you're spoofing at.
  JoinableGameInfo game_info = JoinableGameInfo();
  game_info.index = 1;
  strcpy_s(game_info.game_name, "shieldbattery");
  game_info.map_width = 256;
  game_info.map_height = 256;
  game_info.active_player_count = 0;
  game_info.max_player_count = 0;
  game_info.game_speed = static_cast<byte>(GameSpeed::Fastest);
  game_info.game_type = 2;           // Melee
  game_info.game_subtype = 1;        // First subtype
  game_info.cdkey_checksum = 'SHIE'; // Doesn't need to be valid (and shouldn't be).
  game_info.tileset = 0x01;          // Space Platform
  strcpy_s(game_info.game_creator, "fakename");
  strcpy_s(game_info.map_name, "fakemap");

  bool result = bw->JoinGame(game_info);

  info.GetReturnValue().Set(Nan::New(result));
}

void WrappedBroodWar::InitGameNetwork(const FunctionCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  bw->InitGameNetwork();

  return;
}

void WrappedBroodWar::AddComputer(const FunctionCallbackInfo<Value>& info) {
  if (info.Length() < 1) {
    ThrowError("Incorrect number of arguments");
    return;
  } else if (!info[0]->IsNumber() && !info[0]->IsNumberObject() && !info[0]->IsUint32() &&
      !info[0]->IsInt32()) {
    ThrowTypeError("slotNumber must be a Number");
    return;
  }

  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  bool result = bw->AddComputer(info[0]->ToUint32()->Uint32Value());
  info.GetReturnValue().Set(Nan::New(result));
}

void WrappedBroodWar::SetRace(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 2);

  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  bool result = bw->SetRace(info[0]->Uint32Value(), info[1]->Uint32Value());
  info.GetReturnValue().Set(Nan::New(result));
}

void WrappedBroodWar::ProcessLobbyTurn(const FunctionCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  uint32 result = bw->ProcessLobbyTurn();

  info.GetReturnValue().Set(Nan::New(Uint32::NewFromUnsigned(result)));
}

void WrappedBroodWar::StartGameCountdown(const FunctionCallbackInfo<Value>& info) {
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  bool result = bw->StartGameCountdown();

  info.GetReturnValue().Set(Nan::New(result));
}

struct GameLoopContext {
  unique_ptr<Callback> cb;
  BroodWar* bw;
};

#define WM_GAME_STARTED (WM_USER + 7)

void RunGameLoopWork(void* arg) {
  GameLoopContext* context = reinterpret_cast<GameLoopContext*>(arg);
  assert(context->bw->game_state() == GameState::Initializing);

  HWND hwnd = FindWindowA("SWarClass", NULL);
  assert(hwnd != NULL);
  PostMessage(hwnd, WM_GAME_STARTED, NULL, NULL);

  context->bw->set_game_state(GameState::Ingame);
  context->bw->RunGameLoop();
  context->bw->ConvertGameResults();
}

void RunGameLoopAfter(void* arg) {
  GameLoopContext* context = reinterpret_cast<GameLoopContext*>(arg);
  auto game_results = context->bw->game_results();
  auto players = context->bw->players();
  Local<Object> result = Nan::New<Object>();
  for (size_t i = 0; i < 8; ++i) {
    if (players[i].storm_id < game_results.size()) {
      result->Set(Nan::New(players[i].name).ToLocalChecked(),
          Nan::New(static_cast<uint32>(game_results[players[i].storm_id])));
    }
  }
  Local<Integer> game_time = Nan::New(context->bw->game_time());
  Local<Value> argv[] = { Null(), Nan::New(result), game_time };
  context->cb->Call(GetCurrentContext()->Global(), 3, argv);

  delete context;
}

void WrappedBroodWar::RunGameLoop(const FunctionCallbackInfo<Value>& info) {
  // It is a very bad idea to try to run multiple game loops at once, but in the interest of keeping
  // the C++ side of things simple I'm not going to handle this case here. The JS wrapper will
  // block this from happening itself, but if you're writing custom JS for this or changing the
  // wrapper, ensure that only one game loop is running at once!
  if (info.Length() < 1) {
    ThrowError("Incorrect number of arguments");
    return;
  } else if (!info[0]->IsFunction()) {
    ThrowTypeError("Expected callback function");
    return;
  }
  Local<Function> cb = Local<Function>::Cast(info[0]);

  GameLoopContext* context = new GameLoopContext;
  context->cb.reset(new Callback(cb));
  context->bw = WrappedBroodWar::Unwrap(info);

  sbat::QueueWorkForUiThread(context, RunGameLoopWork, RunGameLoopAfter);

  return;
}

struct SendMultiplayerChatMessageContext {
  std::string message;
  ChatMessageType type;
  byte recipients;
  BroodWar* bw;
};

// Sends a multiplayer chat message, using the same thread as the game loop to ensure thread safety
// params: message, type[, recipients]
void WrappedBroodWar::SendMultiplayerChatMessage(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() >= 2);

  String::AsciiValue message_arg(info[0]);
  ChatMessageType type = static_cast<ChatMessageType>(
      To<Uint32>(info[1]).ToLocalChecked()->Uint32Value());
  byte recipients = static_cast<byte>((info.Length() > 2 ? To<Uint32>(info[2]).ToLocalChecked() :
      To<Uint32>(Uint32::NewFromUnsigned(0)).ToLocalChecked())->Uint32Value());
  auto context = new SendMultiplayerChatMessageContext();
  context->message = *message_arg;
  context->type = type;
  context->recipients = recipients;
  context->bw = WrappedBroodWar::Unwrap(info);

  game_loop_queue_->QueueFunc(context, [](void* arg) {
    auto context = reinterpret_cast<SendMultiplayerChatMessageContext*>(arg);
    context->bw->SendMultiplayerChatMessage(context->message, context->recipients, context->type);
    delete context;
  });

  return;
}

struct DisplayIngameMessageContext {
  std::string message;
  uint32 timeout;
  BroodWar* bw;
};

// Displays a message (in the chat area), using the same thread as the game loop.
// params: message[, timeout]
void WrappedBroodWar::DisplayIngameMessage(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() >= 1);

  String::AsciiValue message_arg(info[0]);
  auto context = new DisplayIngameMessageContext();
  context->message = *message_arg;
  context->timeout = (info.Length() > 1 ? To<Uint32>(info[1]).ToLocalChecked() :
      To<Uint32>(Uint32::NewFromUnsigned(0)).ToLocalChecked())->Uint32Value();
  context->bw = WrappedBroodWar::Unwrap(info);

  game_loop_queue_->QueueFunc(context, [](void *arg) {
    auto context = reinterpret_cast<DisplayIngameMessageContext*>(arg);
    context->bw->DisplayMessage(context->message, context->timeout);
    delete context;
  });

  return;
}

struct CleanUpForExitContext {
  unique_ptr<Callback> cb;
  BroodWar* bw;
};

void CleanUpForExitWork(void* arg) {
  CleanUpForExitContext* context = reinterpret_cast<CleanUpForExitContext*>(arg);

  context->bw->CleanUpForExit();
}

void CleanUpForExitAfter(void* arg) {
  HandleScope scope;

  CleanUpForExitContext* context = reinterpret_cast<CleanUpForExitContext*>(arg);
  context->cb->Call(GetCurrentContext()->Global(), 0, NULL);

  delete context;
}

void WrappedBroodWar::CleanUpForExit(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 1);
  assert(info[0]->IsFunction());

  Local<Function> cb = Local<Function>::Cast(info[0]);

  CleanUpForExitContext* context = new CleanUpForExitContext;
  context->cb.reset(new Callback(cb));
  context->bw = WrappedBroodWar::Unwrap(info);

  sbat::QueueWorkForUiThread(context, CleanUpForExitWork, CleanUpForExitAfter);

  return;
}

struct EventHandlerCallbackInfo {
  std::string* method_name;
  vector<shared_ptr<ScopelessValue>>* args;
};

void EventHandlerImmediate(void* arg) {
  EventHandlerCallbackInfo* info = reinterpret_cast<EventHandlerCallbackInfo*>(arg);

  for (auto it = WrappedBroodWar::event_handlers_.begin(); 
      it != WrappedBroodWar::event_handlers_.end(); ++it) {
    WrappedBroodWar* wrapped_bw = it->first;
#pragma warning(suppress: 6011)
    auto cb_it = it->second.find(*info->method_name);
    if (cb_it == it->second.end()) {
      continue;
    }

    Local<Function> cb = cb_it->second->callback();
    vector<Local<Value>> params(info->args->size());
    std::transform(info->args->begin(), info->args->end(), params.begin(),
        [](const shared_ptr<ScopelessValue>& value) { return value->ApplyCurrentScope(); });

#pragma warning(suppress: 28182)
    MakeCallback(GetCurrentContext()->Global(), cb, info->args->size(),
        (params.empty() ? nullptr : &params[0]));
    //cb->Call(wrapped_bw->handle_, info->args->size(), (params.empty() ? nullptr : &params[0]));

    delete info->method_name;
    delete info->args;
  }
}

// I don't think we want to assume these will always be running on the same thread, so I use
// immediate here to trigger the callbacks ASAPly on the node thread. It just so happens that
// currently all the lobby events DO happen on the node thread, but this will be more useful for
// things like ingame hooks.
void WrappedBroodWar::OnLobbyDownloadStatus(byte slot, byte download_percent) {
  EventHandlerCallbackInfo* info = new EventHandlerCallbackInfo;
  info->method_name = new std::string("onLobbyDownloadStatus");
  info->args = new vector<shared_ptr<ScopelessValue>>;
  info->args->push_back(shared_ptr<ScopelessInteger>(ScopelessInteger::NewFromUnsigned(slot)));
  info->args->push_back(shared_ptr<ScopelessInteger>(
      ScopelessInteger::NewFromUnsigned(download_percent)));

  AddImmediateCallback(EventHandlerImmediate, info);
}

void WrappedBroodWar::OnLobbySlotChange(byte slot, byte storm_id, byte type, byte race, byte team) {
  EventHandlerCallbackInfo* info = new EventHandlerCallbackInfo;
  info->method_name = new std::string("onLobbySlotChange");
  info->args = new vector<shared_ptr<ScopelessValue>>;
  info->args->push_back(shared_ptr<ScopelessInteger>(ScopelessInteger::NewFromUnsigned(slot)));
  info->args->push_back(shared_ptr<ScopelessInteger>(ScopelessInteger::NewFromUnsigned(storm_id)));
  info->args->push_back(shared_ptr<ScopelessInteger>(ScopelessInteger::NewFromUnsigned(type)));
  info->args->push_back(shared_ptr<ScopelessInteger>(ScopelessInteger::NewFromUnsigned(race)));
  info->args->push_back(shared_ptr<ScopelessInteger>(ScopelessInteger::NewFromUnsigned(team)));

  AddImmediateCallback(EventHandlerImmediate, info);
}

void WrappedBroodWar::OnLobbyStartCountdown() {
  EventHandlerCallbackInfo* info = new EventHandlerCallbackInfo;
  info->method_name = new std::string("onLobbyStartCountdown");
  info->args = new vector<shared_ptr<ScopelessValue>>;

  AddImmediateCallback(EventHandlerImmediate, info);
}

void WrappedBroodWar::OnLobbyGameInit(uint32 random_seed, byte player_bytes[8]) {
  EventHandlerCallbackInfo* info = new EventHandlerCallbackInfo;
  info->method_name = new std::string("onLobbyGameInit");
  info->args = new vector<shared_ptr<ScopelessValue>>;
  info->args->push_back(shared_ptr<ScopelessInteger>(
      ScopelessInteger::NewFromUnsigned(random_seed)));
  ScopelessArray* player_array = ScopelessArray::New(8);
  for (int i = 0; i < 8; i++) {
    player_array->Set(i, shared_ptr<ScopelessInteger>(
        ScopelessInteger::NewFromUnsigned(player_bytes[i])));
  }
  info->args->push_back(shared_ptr<ScopelessArray>(player_array));

  AddImmediateCallback(EventHandlerImmediate, info);
}

void WrappedBroodWar::OnLobbyMissionBriefing(byte slot) {
  EventHandlerCallbackInfo* info = new EventHandlerCallbackInfo;
  info->method_name = new std::string("onLobbyMissionBriefing");
  info->args = new vector<shared_ptr<ScopelessValue>>;
  info->args->push_back(shared_ptr<ScopelessInteger>(ScopelessInteger::NewFromUnsigned(slot)));

  AddImmediateCallback(EventHandlerImmediate, info);
}

void WrappedBroodWar::OnLobbyChatMessage(byte slot, const std::string& message) {
  EventHandlerCallbackInfo* info = new EventHandlerCallbackInfo;
  info->method_name = new std::string("onLobbyChatMessage");
  info->args = new vector<shared_ptr<ScopelessValue>>;
  info->args->push_back(shared_ptr<ScopelessInteger>(ScopelessInteger::NewFromUnsigned(slot)));
  info->args->push_back(shared_ptr<ScopelessString>(ScopelessString::New(message)));

  AddImmediateCallback(EventHandlerImmediate, info);
}

void WrappedBroodWar::OnMenuErrorDialog(const std::string& message) {
  EventHandlerCallbackInfo* info = new EventHandlerCallbackInfo;
  info->method_name = new std::string("onMenuErrorDialog");
  info->args = new vector<shared_ptr<ScopelessValue>>;
  info->args->push_back(shared_ptr<ScopelessString>(ScopelessString::New(message.c_str())));

  AddImmediateCallback(EventHandlerImmediate, info);
}

void WrappedBroodWar::OnCheckForChatCommand(const std::string& message,
    ChatMessageType message_type, byte recipients) {
  EventHandlerCallbackInfo* info = new EventHandlerCallbackInfo;
  info->method_name = new std::string("onCheckForChatCommand");
  info->args = new vector<shared_ptr<ScopelessValue>>;
  info->args->push_back(shared_ptr<ScopelessString>(ScopelessString::New(message.c_str())));
  info->args->push_back(shared_ptr<ScopelessInteger>(
      ScopelessInteger::NewFromUnsigned(static_cast<byte>(message_type))));
  info->args->push_back(
      shared_ptr<ScopelessInteger>(ScopelessInteger::NewFromUnsigned(recipients)));

  AddImmediateCallback(EventHandlerImmediate, info);
}

void WrappedBroodWar::OnGameLoopIteration() {
  game_loop_queue_->ExecuteItems();
}

GameLoopQueue::GameLoopQueue() 
    : has_items_(false),
      mutex_(),
      async_(),
      items_(),
      completed_() {
  uv_async_init(uv_default_loop(), &async_, OnExecutionCompleted);
  async_.data = this;

  uv_mutex_init(&mutex_);
}

GameLoopQueue::~GameLoopQueue() {
  uv_close(reinterpret_cast<uv_handle_t*>(&async_), NULL);
  uv_mutex_destroy(&mutex_);
}

void GameLoopQueue::QueueFunc(void* arg, GameLoopWorkerFunc worker_func) {
  QueueFunc(arg, worker_func, nullptr);
}

void GameLoopQueue::QueueFunc(void* arg, GameLoopWorkerFunc worker_func,
    GameLoopAfterFunc after_func) {
  uv_mutex_lock(&mutex_);
  items_.push_back(GameLoopFuncContext(arg, worker_func, after_func));
  has_items_ = true;
  uv_mutex_unlock(&mutex_);
}

void GameLoopQueue::ExecuteItems() {
  if (!has_items()) {
    return;
  }

  uv_mutex_lock(&mutex_);
  if (items_.empty()) {
    uv_mutex_unlock(&mutex_);
    return;
  }

  // For the sake of speed, we'll only do one pass over the items. If any items are added while
  // these ones are executing, they'll have to wait for the next game loop iteration
  list<GameLoopFuncContext> executees;
  executees.splice(executees.begin(), items_);
  has_items_ = false;
  uv_mutex_unlock(&mutex_);

  for (auto it = executees.begin(); it != executees.end(); ++it) {
    const GameLoopFuncContext& context = *it;
    context.worker_func(context.arg);
  }

  uv_mutex_lock(&mutex_);
  completed_.splice(completed_.end(), executees);
  uv_mutex_unlock(&mutex_);
  uv_async_send(&async_);
}

void GameLoopQueue::OnExecutionCompleted(uv_async_t* handle, int status) {
  GameLoopQueue* instance = reinterpret_cast<GameLoopQueue*>(handle->data);

  uv_mutex_lock(&instance->mutex_);
  if (instance->completed_.empty()) {
    uv_mutex_unlock(&instance->mutex_);
    return;
  }
  
  list<GameLoopFuncContext> done;
  done.splice(done.begin(), instance->completed_);
  uv_mutex_unlock(&instance->mutex_);

  for (auto it = done.begin(); it != done.end(); ++it) {
    const GameLoopFuncContext& context = *it;
    if (context.after_func != nullptr) {
      context.after_func(context.arg);
    }
  }
}

NODE_MODULE_EXPORT void SetBroodWarInputDisabled(bool disabled) {
  BroodWar::SetInputDisabled(disabled);
}

}  // namespace bw
}  // namespace sbat
