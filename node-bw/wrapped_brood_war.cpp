#include  "./wrapped_brood_war.h"

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

using std::list;
using std::make_pair;
using std::map;
using std::shared_ptr;
using std::vector;
using std::wstring;
using v8::AccessorInfo;
using v8::Arguments;
using v8::Array;
using v8::Boolean;
using v8::Context;
using v8::Exception;
using v8::Function;
using v8::FunctionTemplate;
using v8::Handle;
using v8::HandleScope;
using v8::Int32;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::Locker;
using v8::Object;
using v8::Persistent;
using v8::String;
using v8::ThrowException;
using v8::TryCatch;
using v8::Uint32;
using v8::Value;

namespace sbat {
namespace bw {

map<WrappedBroodWar*, WrappedBroodWar::EventHandlerMap> WrappedBroodWar::event_handlers_;
GameLoopQueue* WrappedBroodWar::game_loop_queue_;

EventHandlerContext::EventHandlerContext(Handle<Function> callback)
    : callback_(Persistent<Function>::New(callback)) {
}

EventHandlerContext::~EventHandlerContext() {
  callback_.Dispose();
}

Handle<Function> EventHandlerContext::callback() const {
  return callback_;
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
  Local<FunctionTemplate> tpl = FunctionTemplate::New(New);
  tpl->SetClassName(String::NewSymbol("BwPlayerSlot"));
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  // functions
  SetProtoAccessor(tpl, "playerId", GetPlayerId);
  SetProtoAccessor(tpl, "stormId", GetStormId);
  SetProtoAccessor(tpl, "type", GetType);
  SetProtoAccessor(tpl, "race", GetRace);
  SetProtoAccessor(tpl, "team", GetTeam);
  SetProtoAccessor(tpl, "name", GetName);

  constructor = Persistent<Function>::New(tpl->GetFunction());
}

Handle<Value> BwPlayerSlot::New(const Arguments& args) {
  HandleScope scope;

  BwPlayerSlot* playerSlot = new BwPlayerSlot();
  playerSlot->Wrap(args.This());

  return scope.Close(args.This());
}

Handle<Value> BwPlayerSlot::NewInstance(PlayerInfo* player_info) {
  HandleScope scope;

  Local<Object> instance = constructor->NewInstance();
  BwPlayerSlot* wrapped = ObjectWrap::Unwrap<BwPlayerSlot>(instance);
  wrapped->set_player_info(player_info);

  return scope.Close(instance);
}

Handle<Value> BwPlayerSlot::GetPlayerId(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  PlayerInfo* player_info = BwPlayerSlot::Unwrap(info);
  return scope.Close(Integer::NewFromUnsigned(player_info->player_id));
}

Handle<Value> BwPlayerSlot::GetStormId(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  PlayerInfo* player_info = BwPlayerSlot::Unwrap(info);
  return scope.Close(Integer::NewFromUnsigned(player_info->storm_id));
}

Handle<Value> BwPlayerSlot::GetType(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  PlayerInfo* player_info = BwPlayerSlot::Unwrap(info);
  return scope.Close(Integer::NewFromUnsigned(static_cast<uint32>(player_info->type)));
}

Handle<Value> BwPlayerSlot::GetRace(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  PlayerInfo* player_info = BwPlayerSlot::Unwrap(info);
  return scope.Close(Integer::NewFromUnsigned(static_cast<uint32>(player_info->race)));
}

Handle<Value> BwPlayerSlot::GetTeam(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  PlayerInfo* player_info = BwPlayerSlot::Unwrap(info);
  return scope.Close(Integer::NewFromUnsigned(static_cast<uint32>(player_info->team)));
}

Handle<Value> BwPlayerSlot::GetName(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  PlayerInfo* player_info = BwPlayerSlot::Unwrap(info);
  return scope.Close(String::New(player_info->name));
}

WrappedBroodWar::WrappedBroodWar()
    : brood_war_(BroodWar::Get()),
      log_symbol_(Persistent<String>::New(String::NewSymbol("onLog"))) {
  HandleScope scope;
  event_handlers_.insert(make_pair(this, WrappedBroodWar::EventHandlerMap()));
  Logger::Init(WrappedBroodWar::Log, this);
}

WrappedBroodWar::~WrappedBroodWar() {
  // BroodWar is a singleton, so we don't want to delete it
  event_handlers_.erase(this);
  Logger::Destroy(Log, this);
  log_symbol_.Dispose();
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

  Local<FunctionTemplate> tpl = FunctionTemplate::New(New);
  tpl->SetClassName(String::NewSymbol("CBroodWar"));
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
  SetProtoMethod(tpl, "setSettings", SetSettings);
  SetProtoMethod(tpl, "initProcess", InitProcess);
  SetProtoMethod(tpl, "initSprites", InitSprites);
  SetProtoMethod(tpl, "initPlayerInfo", InitPlayerInfo);
  SetProtoMethod(tpl, "chooseNetworkProvider", ChooseNetworkProvider);
  SetProtoMethod(tpl, "createGame", CreateGame);
  SetProtoMethod(tpl, "spoofGame", SpoofGame);
  SetProtoMethod(tpl, "joinGame", JoinGame);
  SetProtoMethod(tpl, "initGameNetwork", InitGameNetwork);
  SetProtoMethod(tpl, "addComputer", AddComputer);
  SetProtoMethod(tpl, "setRace", SetRace);
  SetProtoMethod(tpl, "processLobbyTurn", ProcessLobbyTurn);
  SetProtoMethod(tpl, "startGameCountdown", StartGameCountdown);
  SetProtoMethod(tpl, "runGameLoop", RunGameLoop);
  SetProtoMethod(tpl, "sendMultiplayerChatMessage", SendMultiplayerChatMessage);
  SetProtoMethod(tpl, "displayIngameMessage", DisplayIngameMessage);
  SetProtoMethod(tpl, "cleanUpForExit", CleanUpForExit);

  constructor = Persistent<Function>::New(tpl->GetFunction());
}

Handle<Value> WrappedBroodWar::New(const Arguments& args) {
  HandleScope scope;

  WrappedBroodWar* bw = new WrappedBroodWar();
  bw->Wrap(args.This());

  return scope.Close(args.This());
}

Handle<Value> WrappedBroodWar::NewInstance(const Arguments& args) {
  HandleScope scope;

  Local<Object> instance = constructor->NewInstance();
  WrappedBroodWar* wrapped_bw = ObjectWrap::Unwrap<WrappedBroodWar>(instance);
  BroodWar* bw = wrapped_bw->brood_war_;

  Local<Array> slots = Array::New(8);
  PlayerInfo* infos = bw->players();
  for (int i = 0; i < 8; i++) {
    slots->Set(i, BwPlayerSlot::NewInstance(&infos[i]));
  }
  instance->Set(String::NewSymbol("slots"), slots);

  return scope.Close(instance);
}

void WrappedBroodWar::Log(void* arg, LogLevel level, const char* msg) {
  WrappedBroodWar* wrapped = reinterpret_cast<WrappedBroodWar*>(arg);
  Local<Value> callback = wrapped->handle_->Get(wrapped->log_symbol_);
  if (!callback->IsFunction()) {
    return;
  }

  Local<Value> argv[] = { Integer::New(static_cast<int32>(level)), String::New(msg) };
  callback.As<Function>()->Call(wrapped->handle_, 2, argv);
}

// accessor defitions
Handle<Value> WrappedBroodWar::GetCurrentMapPath(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  return scope.Close(String::New(bw->current_map_path().c_str()));
}

Handle<Value> WrappedBroodWar::GetCurrentMapName(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  return scope.Close(String::New(bw->current_map_name().c_str()));
}

Handle<Value> WrappedBroodWar::GetCurrentMapFolderPath(Local<String> property,
    const AccessorInfo& info) {
  HandleScope scope;
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  return scope.Close(String::New(bw->current_map_folder_path().c_str()));
}

Handle<Value> WrappedBroodWar::GetLocalPlayerId(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  return scope.Close(Uint32::NewFromUnsigned(bw->local_player_id()));
}

Handle<Value> WrappedBroodWar::GetLocalLobbyId(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  return scope.Close(Uint32::NewFromUnsigned(bw->local_lobby_id()));
}

Handle<Value> WrappedBroodWar::GetLocalPlayerName(Local<String> property,
    const AccessorInfo& info) {
  HandleScope scope;
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  return scope.Close(String::New(bw->local_player_name().c_str()));
}

void WrappedBroodWar::SetLocalPlayerName(Local<String> property, Local<Value> value,
    const AccessorInfo& info) {
  HandleScope scope;

  if (!value->IsString() && !value->IsStringObject()) {
    ThrowException(Exception::TypeError(String::New("Local player name must be a String")));
    return;
  }

  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  String::AsciiValue ascii_value(value);
  char* c_str = *ascii_value;
  bw->set_local_player_name(c_str ? std::string(c_str) : std::string());
}

Handle<Value> WrappedBroodWar::GetGameSpeed(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  return scope.Close(Uint32::New(static_cast<int32>(bw->current_game_speed())));
}

Handle<Value> WrappedBroodWar::GetIsBroodWar(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  return scope.Close(Boolean::New(bw->is_brood_war()));
}

void WrappedBroodWar::SetIsBroodWar(Local<String> property, Local<Value> value,
    const AccessorInfo& info) {
  HandleScope scope;

  if (!value->IsBoolean() && !value->IsBooleanObject()) {
    ThrowException(Exception::TypeError(String::New("isBroodWar must be a Boolean")));
    return;
  }

  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  bw->set_is_brood_war(value->BooleanValue());
}

Handle<Value> WrappedBroodWar::GetIsMultiplayer(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  return scope.Close(Boolean::New(bw->is_multiplayer()));
}

void WrappedBroodWar::SetIsMultiplayer(Local<String> property, Local<Value> value,
    const AccessorInfo& info) {
  HandleScope scope;

  if (!value->IsBoolean() && !value->IsBooleanObject()) {
    ThrowException(Exception::TypeError(String::New("isMultiplayer must be a Boolean")));
    return;
  }

  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  bw->set_is_multiplayer(value->BooleanValue());
}

Handle<Value> WrappedBroodWar::GetIsHostingGame(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  return scope.Close(Boolean::New(bw->is_hosting_game()));
}

Handle<Value> WrappedBroodWar::GetWasBooted(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  return scope.Close(Boolean::New(bw->was_booted()));
}

Handle<Value> WrappedBroodWar::GetBootReason(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  return scope.Close(Int32::New(static_cast<int32>(bw->boot_reason())));
}

Handle<Value> WrappedBroodWar::GetLobbyDirtyFlag(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;
  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  return scope.Close(Boolean::New(bw->lobby_dirty_flag()));
}

void WrappedBroodWar::SetLobbyDirtyFlag(Local<String> property, Local<Value> value,
    const AccessorInfo& info) {
  HandleScope scope;

  if (!value->IsBoolean() && !value->IsBooleanObject()) {
    ThrowException(Exception::TypeError(String::New("lobbyDirtyFlag must be a Boolean")));
    return;
  }

  BroodWar* bw = WrappedBroodWar::Unwrap(info);
  bw->set_lobby_dirty_flag(value->BooleanValue());
}

Handle<Value> WrappedBroodWar::GetEventHandler(Local<String> property, const AccessorInfo& info) {
  HandleScope scope;

  String::Utf8Value name(property);
  std::string std_name(*name);
  WrappedBroodWar* wrapped_bw = ObjectWrap::Unwrap<WrappedBroodWar>(info.This());

  auto i = event_handlers_[wrapped_bw].find(std_name);
  if (i != event_handlers_[wrapped_bw].end()) {
    return scope.Close(i->second->callback());
  }

  return scope.Close(v8::Undefined());
}

void WrappedBroodWar::SetEventHandler(Local<String> property, Local<Value> value,
    const AccessorInfo& info) {
  HandleScope scope;

  if (!value->IsFunction() && !value->IsUndefined() && !value->IsNull()) {
    ThrowException(Exception::TypeError(String::New("callback must be a function")));
    return;
  }

  String::Utf8Value name(property);
  std::string std_name(*name);
  WrappedBroodWar* wrapped_bw = ObjectWrap::Unwrap<WrappedBroodWar>(info.This());

  if (!value->IsFunction()) {
    event_handlers_[wrapped_bw].erase(std_name);
  } else {
    event_handlers_[wrapped_bw].insert(make_pair(std_name, 
        shared_ptr<EventHandlerContext>(new EventHandlerContext(value.As<Function>()))));
  }
}

Handle<Value> WrappedBroodWar::SetSettings(const Arguments& args) {
  // This function should be called before the dependent modules (Snp, Forge, etc.) are loaded and
  // initialized, so that they can make use of any custom settings
  HandleScope scope;

  assert(args.Length() > 0);
  Local<Object> settings_object = args[0]->ToObject();
  Settings result = Settings();

  if (settings_object->Has(String::NewSymbol("bwPort"))) {
    result.bw_port = settings_object->Get(String::NewSymbol("bwPort"))->Int32Value();
  } else {
    Logger::Log(LogLevel::Warning, "Using default value for setting bwPort");
    result.bw_port = 6112;
  }

  if (settings_object->Has(String::NewSymbol("width"))) {
    result.width = settings_object->Get(String::NewSymbol("width"))->Int32Value();
  } else {
    Logger::Log(LogLevel::Warning, "Using default value for setting width");
    result.width = 640;
  }

  if (settings_object->Has(String::NewSymbol("height"))) {
    result.height = settings_object->Get(String::NewSymbol("height"))->Int32Value();
  } else {
    Logger::Log(LogLevel::Warning, "Using default value for setting height");
    result.height = 480;
  }

  if (settings_object->Has(String::NewSymbol("displayMode"))) {
    result.display_mode = static_cast<DisplayMode>(
        settings_object->Get(String::NewSymbol("displayMode"))->Int32Value());
  } else {
    Logger::Log(LogLevel::Warning, "Using default value for setting displayMode");
    result.display_mode = DisplayMode::FullScreen;
  }

  if (settings_object->Has(String::NewSymbol("mouseSensitivity"))) {
    result.mouse_sensitivity =
        settings_object->Get(String::NewSymbol("mouseSensitivity"))->Int32Value();
    if (result.mouse_sensitivity < 0 || result.mouse_sensitivity > 4) {
      Logger::Log(LogLevel::Warning, "mouseSensitivity out of valid range, using default value");
      result.mouse_sensitivity = 0;
    }
  } else {
    Logger::Log(LogLevel::Warning, "Using default value for setting mouseSensitivity");
    result.mouse_sensitivity = 0;
  }

  if (settings_object->Has(String::NewSymbol("maintainAspectRatio"))) {
    result.maintain_aspect_ratio =
        settings_object->Get(String::NewSymbol("maintainAspectRatio"))->BooleanValue();
  } else {
    Logger::Log(LogLevel::Warning, "Using default value for setting aspectRatio");
    result.maintain_aspect_ratio = true;
  }

  if (settings_object->Has(String::NewSymbol("renderer"))) {
    result.renderer = static_cast<RenderMode>(
        settings_object->Get(String::NewSymbol("renderer"))->Int32Value());
  } else {
    Logger::Log(LogLevel::Warning, "Using default renderer");
    result.renderer = RenderMode::DirectX;
  }

  sbat::SetSettings(result);
  return scope.Close(v8::Undefined());
}

struct InitProcessContext {
  Persistent<Function> callback;
};

void InitProcessAfter(void* arg) {
  HandleScope scope;
  InitProcessContext* context = reinterpret_cast<InitProcessContext*>(arg);

  TryCatch try_catch;
  context->callback->Call(Context::GetCurrent()->Global(), 0, NULL);

  context->callback.Dispose();
  delete context;

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }
}

// function definitions
Handle<Value> WrappedBroodWar::InitProcess(const Arguments& args) {
  // This only needs to be called once per process launch, but calling it multiple times will not
  // harm anything
  HandleScope scope;

  if (args.Length() < 1) {
    ThrowException(Exception::Error(String::New("Incorrect number of arguments")));
    return scope.Close(v8::Undefined());
  } else if (!args[0]->IsFunction()) {
    ThrowException(Exception::TypeError(String::New("Expected callback function")));
    return scope.Close(v8::Undefined());
  }

  InitProcessContext* context = new InitProcessContext;
  context->callback = Persistent<Function>::New(args[0].As<Function>());

  sbat::InitializeProcess(context, InitProcessAfter);

  return scope.Close(v8::Undefined());
}

struct InitSpritesContext {
  Persistent<Function> cb;
  BroodWar* bw;
};

void InitSpritesWork(void* arg) {
  InitSpritesContext* context = reinterpret_cast<InitSpritesContext*>(arg);
  context->bw->InitSprites();
}

void InitSpritesAfter(void* arg) {
  HandleScope scope;

  InitSpritesContext* context = reinterpret_cast<InitSpritesContext*>(arg);
  TryCatch try_catch;
  context->cb->Call(Context::GetCurrent()->Global(), 0, NULL);

  context->cb.Dispose();
  delete context;

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }
}

Handle<Value> WrappedBroodWar::InitSprites(const Arguments& args) {
  HandleScope scope;
  assert(args.Length() >= 1);
  Local<Function> cb = args[0].As<Function>();

  InitSpritesContext* context = new InitSpritesContext();
  context->cb = Persistent<Function>::New(cb);
  context->bw = WrappedBroodWar::Unwrap(args);

  sbat::QueueWorkForUiThread(context, InitSpritesWork, InitSpritesAfter);

  return scope.Close(v8::Undefined());
}

Handle<Value> WrappedBroodWar::InitPlayerInfo(const Arguments& args) {
  HandleScope scope;

  BroodWar* bw = WrappedBroodWar::Unwrap(args);
  bw->InitPlayerInfo();

  return scope.Close(v8::Undefined());
}

Handle<Value> WrappedBroodWar::ChooseNetworkProvider(const Arguments& args) {
  HandleScope scope;

  if (args.Length() > 0 &&
      !(args[0]->IsNumber() || args[0]->IsNumberObject() ||
      args[0]->IsUint32() || args[0]->IsInt32())) {
    ThrowException(Exception::TypeError(String::New("networkProvider must be a Number")));
    return scope.Close(v8::Undefined());
  }

  BroodWar* bw = WrappedBroodWar::Unwrap(args);
  bool result;
  if (args.Length() > 0) {
    result = bw->ChooseNetworkProvider(args[0]->ToUint32()->Uint32Value());
  } else {
    result = bw->ChooseNetworkProvider();
  }

  return scope.Close(Boolean::New(result));
}

Handle<Value> WrappedBroodWar::CreateGame(const Arguments& args) {
  HandleScope scope;

  if (args.Length() < 1) {
    ThrowException(Exception::Error(String::New("Incorrect number of arguments")));
    return scope.Close(v8::Undefined());
  } else if (!args[0]->IsObject()) {
    ThrowException(Exception::TypeError(String::New("Incorrect arguments")));
    return scope.Close(v8::Undefined());
  }

  Local<Object> config = Local<Object>::Cast(args[0]);
  if (!config->Has(String::New("mapPath")) || !config->Has(String::New("gameType"))) {
    ThrowException(Exception::TypeError(String::New("Must specify at least mapPath and gameType")));
    return scope.Close(v8::Undefined());
  }

  char* game_name = nullptr;
  char* password = nullptr;
  char* map_path;
  uint32 game_type;
  GameSpeed game_speed = GameSpeed::Fastest;

  Local<Value> game_name_value = config->Get(String::New("name"));
  if (!game_name_value.IsEmpty() &&
      (game_name_value->IsString() || game_name_value->IsStringObject())) {
    String::AsciiValue ascii(game_name_value);
    game_name = *ascii;
  }

  Local<Value> password_value = config->Get(String::New("password"));
  if (!password_value.IsEmpty() &&
      (password_value->IsString() || password_value->IsStringObject())) {
    String::AsciiValue ascii(password_value);
    password = *ascii;
  }

  Local<Value> map_path_value = config->Get(String::New("mapPath"));
  if (!map_path_value->IsString() && !map_path_value->IsStringObject()) {
    ThrowException(Exception::TypeError(String::New("mapPath must be a String")));
    return scope.Close(v8::Undefined());
  }
  String::AsciiValue map_path_ascii(map_path_value);
  map_path = *map_path_ascii;

  Local<Value> game_type_value = config->Get(String::New("gameType"));
  if (!game_type_value->IsNumber() && !game_type_value->IsNumberObject() &&
      !game_type_value->IsUint32() && !game_type_value->IsInt32()) {
    ThrowException(Exception::TypeError(String::New("gameType must be a Number")));
    return scope.Close(v8::Undefined());
  }
  game_type = game_type_value->ToUint32()->Uint32Value();

  Local<Value> game_speed_value = config->Get(String::New("speed"));
  if (!game_speed_value.IsEmpty() &&
      (game_speed_value->IsNumber() || game_speed_value->IsNumberObject() ||
      game_speed_value->IsUint32() || game_speed_value->IsInt32())) {
    game_speed = static_cast<GameSpeed>(game_speed_value->ToInt32()->Int32Value());
  }

  BroodWar* bw = WrappedBroodWar::Unwrap(args);
  bool result = bw->CreateGame(game_name ? game_name : "ShieldBattery",
      password ? password : std::string(),
      map_path,
      game_type,
      game_speed);

  return scope.Close(Boolean::New(result));
}

Handle<Value> WrappedBroodWar::SpoofGame(const Arguments& args) {
  HandleScope scope;

  assert(args.Length() == 4);

  String::AsciiValue game_name_value(args[0]);
  std::string game_name = *game_name_value;
  bool is_replay = args[1]->BooleanValue();
  String::Utf8Value address(args[2]);
  uint32 port = args[3]->Uint32Value();

  SnpInterface* snp = GetSnpInterface();
  assert(snp != nullptr);
  snp->SpoofGame(game_name, uv_ip4_addr(*address, port), is_replay);

  return scope.Close(v8::Undefined());
}

Handle<Value> WrappedBroodWar::JoinGame(const Arguments& args) {
  HandleScope scope;

  BroodWar* bw = WrappedBroodWar::Unwrap(args);
  // Basically none of this info actually matters, although BW likes to check it for some reason.
  // The actual game info will be distributed upon joining. The thing that *does* matter is the
  // index, make sure it matches the index you're spoofing at.
  JoinableGameInfo info = JoinableGameInfo();
  info.index = 1;
  strcpy_s(info.game_name, "shieldbattery");
  info.map_width = 256;
  info.map_height = 256;
  info.is_not_eight_player = 0;
  info.player_count = 0;
  info.game_speed = static_cast<byte>(GameSpeed::Fastest);
  info.game_type = 0x10002;
  info.cdkey_checksum = 0x1D10C1E5;
  info.tileset = 0x01;
  strcpy_s(info.game_creator, "fakename");
  strcpy_s(info.map_name, "fakemap");

  bool result = bw->JoinGame(info);

  return scope.Close(Boolean::New(result));
}

Handle<Value> WrappedBroodWar::InitGameNetwork(const Arguments& args) {
  HandleScope scope;

  BroodWar* bw = WrappedBroodWar::Unwrap(args);
  bw->InitGameNetwork();

  return scope.Close(v8::Undefined());
}

Handle<Value> WrappedBroodWar::AddComputer(const Arguments& args) {
  HandleScope scope;

  if (args.Length() < 1) {
    ThrowException(Exception::Error(String::New("Incorrect number of arguments")));
    return scope.Close(v8::Undefined());
  } else if (!args[0]->IsNumber() && !args[0]->IsNumberObject() && !args[0]->IsUint32() &&
      !args[0]->IsInt32()) {
    ThrowException(Exception::TypeError(String::New("slotNumber must be a Number")));
    return scope.Close(v8::Undefined());
  }

  BroodWar* bw = WrappedBroodWar::Unwrap(args);
  bool result = bw->AddComputer(args[0]->ToUint32()->Uint32Value());
  return scope.Close(Boolean::New(result));
}

Handle<Value> WrappedBroodWar::SetRace(const Arguments& args) {
  HandleScope scope;
  
  assert(args.Length() == 2);

  BroodWar* bw = WrappedBroodWar::Unwrap(args);
  bool result = bw->SetRace(args[0]->Uint32Value(), args[1]->Uint32Value());
  return scope.Close(Boolean::New(result));
}

Handle<Value> WrappedBroodWar::ProcessLobbyTurn(const Arguments& args) {
  HandleScope scope;

  BroodWar* bw = WrappedBroodWar::Unwrap(args);
  uint32 result = bw->ProcessLobbyTurn();

  return scope.Close(Uint32::NewFromUnsigned(result));
}

Handle<Value> WrappedBroodWar::StartGameCountdown(const Arguments& args) {
  HandleScope scope;

  BroodWar* bw = WrappedBroodWar::Unwrap(args);
  bool result = bw->StartGameCountdown();

  return scope.Close(Boolean::New(result));
}

struct GameLoopContext {
  Persistent<Function> cb;
  BroodWar* bw;
  // TODO(tec27): results from the game to pass back?
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
}

void RunGameLoopAfter(void* arg) {
  HandleScope scope;

  GameLoopContext* context = reinterpret_cast<GameLoopContext*>(arg);
  TryCatch try_catch;
  context->cb->Call(Context::GetCurrent()->Global(), 0, NULL);

  context->cb.Dispose();
  delete context;

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }
}

Handle<Value> WrappedBroodWar::RunGameLoop(const Arguments& args) {
  // It is a very bad idea to try to run multiple game loops at once, but in the interest of keeping
  // the C++ side of things simple I'm not going to handle this case here. The JS wrapper will
  // block this from happening itself, but if you're writing custom JS for this or changing the
  // wrapper, ensure that only one game loop is running at once!
  HandleScope scope;

  if (args.Length() < 1) {
    ThrowException(Exception::Error(String::New("Incorrect number of arguments")));
    return scope.Close(v8::Undefined());
  } else if (!args[0]->IsFunction()) {
    ThrowException(Exception::TypeError(String::New("Expected callback function")));
    return scope.Close(v8::Undefined());
  }
  Local<Function> cb = Local<Function>::Cast(args[0]);

  GameLoopContext* context = new GameLoopContext;
  context->cb = Persistent<Function>::New(cb);
  context->bw = WrappedBroodWar::Unwrap(args);

  sbat::QueueWorkForUiThread(context, RunGameLoopWork, RunGameLoopAfter);

  return scope.Close(v8::Undefined());
}

struct SendMultiplayerChatMessageContext {
  std::string message;
  ChatMessageType type;
  byte recipients;
  BroodWar* bw;
};

// Sends a multiplayer chat message, using the same thread as the game loop to ensure thread safety
// params: message, type[, recipients]
Handle<Value> WrappedBroodWar::SendMultiplayerChatMessage(const Arguments& args) {
  HandleScope scope;
  assert(args.Length() >= 2);

  String::AsciiValue message_arg(args[0]);
  ChatMessageType type = static_cast<ChatMessageType>(args[1]->ToUint32()->Uint32Value());
  byte recipients = static_cast<byte>((args.Length() > 2 ? args[2]->ToUint32() :
    Uint32::NewFromUnsigned(0)->ToUint32())->Uint32Value());
  auto context = new SendMultiplayerChatMessageContext();
  context->message = *message_arg;
  context->type = type;
  context->recipients = recipients;
  context->bw = WrappedBroodWar::Unwrap(args);

  game_loop_queue_->QueueFunc(context, [](void* arg) {
    auto context = reinterpret_cast<SendMultiplayerChatMessageContext*>(arg);
    context->bw->SendMultiplayerChatMessage(context->message, context->recipients, context->type);
    delete context;
  });

  return scope.Close(v8::Undefined());
}

struct DisplayIngameMessageContext {
  std::string message;
  uint32 timeout;
  BroodWar* bw;
};

// Displays a message (in the chat area), using the same thread as the game loop.
// params: message[, timeout]
Handle<Value> WrappedBroodWar::DisplayIngameMessage(const Arguments& args) {
  HandleScope scope;
  assert(args.Length() >= 1);

  String::AsciiValue message_arg(args[0]);
  auto context = new DisplayIngameMessageContext();
  context->message = *message_arg;
  context->timeout = (args.Length() > 1 ? 
    args[1]->ToUint32() : Uint32::NewFromUnsigned(0)->ToUint32())->Uint32Value();
  context->bw = WrappedBroodWar::Unwrap(args);

  game_loop_queue_->QueueFunc(context, [](void *arg) {
    auto context = reinterpret_cast<DisplayIngameMessageContext*>(arg);
    context->bw->DisplayMessage(context->message, context->timeout);
    delete context;
  });

  return scope.Close(v8::Undefined());
}

struct CleanUpForExitContext {
  Persistent<Function> cb;
  BroodWar* bw;
};

void CleanUpForExitWork(void* arg) {
  CleanUpForExitContext* context = reinterpret_cast<CleanUpForExitContext*>(arg);

  context->bw->CleanUpForExit();
}

void CleanUpForExitAfter(void* arg) {
  HandleScope scope;

  CleanUpForExitContext* context = reinterpret_cast<CleanUpForExitContext*>(arg);
  TryCatch try_catch;
  context->cb->Call(Context::GetCurrent()->Global(), 0, NULL);

  context->cb.Dispose();
  delete context;

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }
}

Handle<Value> WrappedBroodWar::CleanUpForExit(const Arguments& args) {
  HandleScope scope;
  assert(args.Length() == 1);
  assert(args[0]->IsFunction());

  Local<Function> cb = Local<Function>::Cast(args[0]);

  CleanUpForExitContext* context = new CleanUpForExitContext;
  context->cb = Persistent<Function>::New(cb);
  context->bw = WrappedBroodWar::Unwrap(args);

  sbat::QueueWorkForUiThread(context, CleanUpForExitWork, CleanUpForExitAfter);

  return scope.Close(v8::Undefined());
}

struct EventHandlerCallbackInfo {
  std::string* method_name;
  vector<shared_ptr<ScopelessValue>>* args;
};

void EventHandlerImmediate(void* arg) {
  HandleScope scope;
  EventHandlerCallbackInfo* info = reinterpret_cast<EventHandlerCallbackInfo*>(arg);

  for (auto it = WrappedBroodWar::event_handlers_.begin(); 
      it != WrappedBroodWar::event_handlers_.end(); ++it) {
    WrappedBroodWar* wrapped_bw = it->first;
#pragma warning(suppress: 6011)
    auto cb_it = it->second.find(*info->method_name);
    if (cb_it == it->second.end()) {
      continue;
    }

    TryCatch try_catch;
    Handle<Function> cb = cb_it->second->callback();
    vector<Local<Value>> params(info->args->size());
    std::transform(info->args->begin(), info->args->end(), params.begin(),
        [](const shared_ptr<ScopelessValue>& value) { return value->ApplyCurrentScope(); });

#pragma warning(suppress: 28182)
    cb->Call(wrapped_bw->handle_, info->args->size(), (params.empty() ? nullptr : &params[0]));

    delete info->method_name;
    delete info->args;

    if (try_catch.HasCaught()) {
      node::FatalException(try_catch);
    }
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

}  // namespace bw
}  // namespace sbat
