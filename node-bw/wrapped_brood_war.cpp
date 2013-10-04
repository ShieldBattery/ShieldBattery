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
using v8::Local;
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
  EventHandlers handlers;
  handlers.OnLobbyDownloadStatus = OnLobbyDownloadStatus;
  handlers.OnLobbySlotChange = OnLobbySlotChange;
  handlers.OnLobbyStartCountdown = OnLobbyStartCountdown;
  handlers.OnLobbyGameInit = OnLobbyGameInit;
  handlers.OnLobbyMissionBriefing = OnLobbyMissionBriefing;
  handlers.OnLobbyChatMessage = OnLobbyChatMessage;
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
#undef EVENT_HANDLER

  // functions
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
  SetProtoMethod(tpl, "loadPlugin", LoadPlugin);

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

Handle<Value> WrappedBroodWar::InitSprites(const Arguments& args) {
  HandleScope scope;

  BroodWar* bw = WrappedBroodWar::Unwrap(args);
  bw->InitSprites();

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

void RunGameLoopWork(void* arg) {
  GameLoopContext* context = reinterpret_cast<GameLoopContext*>(arg);
  assert(context->bw->game_state() == GameState::Initializing);

  // TODO(tec27): get rid of this temporary hack once we have our own windowed mode
  HWND hwnd = FindWindowA("SWarClass", NULL);
  if (hwnd != NULL) {
    // hackishly bring the window to the front, getting around Win7 restrictions on when you can
    // do this
    ShowWindow(hwnd, SW_SHOW);
    BringWindowToTop(hwnd);
    SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
    SetWindowPos(hwnd, HWND_TOPMOST, 0, 0,  0, 0,SWP_NOMOVE | SWP_NOSIZE);
    SetWindowPos(hwnd,HWND_NOTOPMOST, 0, 0, 0, 0, SWP_SHOWWINDOW | SWP_NOMOVE | SWP_NOSIZE);
  }

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

struct LoadPluginContext {
  uv_work_t req;
  wstring* plugin_path;
  Persistent<Function> callback;

  WindowsError* error;
};

void LoadPluginWork(uv_work_t* req) {
  LoadPluginContext* context = reinterpret_cast<LoadPluginContext*>(req->data);
  HMODULE handle = LoadLibraryW(context->plugin_path->c_str());
  if (handle != NULL) {
    context->error = new WindowsError();
  } else {
    context->error = new WindowsError(GetLastError());
  }
}

void LoadPluginAfter(uv_work_t* req, int status) {
  HandleScope scope;
  LoadPluginContext* context = reinterpret_cast<LoadPluginContext*>(req->data);

  Local<Value> err = Local<Value>::New(v8::Null());
  if (context->error->is_error()) {
    err = Exception::Error(
        String::New(reinterpret_cast<const uint16_t*>(context->error->message().c_str())));
  }

  Local<Value> argv[] = { err };
  TryCatch try_catch;
  context->callback->Call(Context::GetCurrent()->Global(), 1, argv);

  context->callback.Dispose();
  delete context->plugin_path;
  delete context->error;
  delete context;

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }
}

Handle<Value> WrappedBroodWar::LoadPlugin(const Arguments& args) {
  // TODO(tec27): for now this is just loading a DLL, eventually this should handle some sort of
  // plugin API (or not, I dunno yet)
  HandleScope scope;

  if (args.Length() < 2) {
    ThrowException(Exception::Error(String::New("Incorrect number of arguments")));
    return scope.Close(v8::Undefined());
  }
  if (!args[0]->IsString() && !args[0]->IsStringObject()) {
    ThrowException(Exception::TypeError(String::New("pluginPath must be a string")));
    return scope.Close(v8::Undefined());
  }
  if (!args[1]->IsFunction()) {
    ThrowException(Exception::TypeError(String::New("callback must be a function")));
    return scope.Close(v8::Undefined());
  }

  LoadPluginContext* context = new LoadPluginContext;
  context->plugin_path = ToWstring(args[0].As<String>());
  context->callback = Persistent<Function>::New(args[1].As<Function>());
  context->req.data = context;
  uv_queue_work(uv_default_loop(), &context->req, LoadPluginWork, LoadPluginAfter);

  return scope.Close(v8::Undefined());
}

struct EventHandlerCallbackInfo {
  std::string* method_name;
  vector<Persistent<Value>>* args;
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
#pragma warning(suppress: 28182)
    cb->Call(wrapped_bw->handle_, info->args->size(),
        (info->args->empty() ? nullptr : &(*info->args)[0]));

    for (auto arg_it = info->args->begin(); arg_it != info->args->end(); ++arg_it) {
      arg_it->Dispose();
    }
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
  HandleScope scope;
  EventHandlerCallbackInfo* info = new EventHandlerCallbackInfo;
  info->method_name = new std::string("onLobbyDownloadStatus");
  info->args = new vector<Persistent<Value>>;
  info->args->push_back(Persistent<Integer>::New(Integer::NewFromUnsigned(slot)));
  info->args->push_back(Persistent<Integer>::New(Integer::NewFromUnsigned(download_percent)));

  AddImmediateCallback(EventHandlerImmediate, info);
}

void WrappedBroodWar::OnLobbySlotChange(byte slot, byte storm_id, byte type, byte race, byte team) {
  HandleScope scope;
  EventHandlerCallbackInfo* info = new EventHandlerCallbackInfo;
  info->method_name = new std::string("onLobbySlotChange");
  info->args = new vector<Persistent<Value>>;
  info->args->push_back(Persistent<Integer>::New(Integer::NewFromUnsigned(slot)));
  info->args->push_back(Persistent<Integer>::New(Integer::NewFromUnsigned(storm_id)));
  info->args->push_back(Persistent<Integer>::New(Integer::NewFromUnsigned(type)));
  info->args->push_back(Persistent<Integer>::New(Integer::NewFromUnsigned(race)));
  info->args->push_back(Persistent<Integer>::New(Integer::NewFromUnsigned(team)));

  AddImmediateCallback(EventHandlerImmediate, info);
}

void WrappedBroodWar::OnLobbyStartCountdown() {
  HandleScope scope;
  EventHandlerCallbackInfo* info = new EventHandlerCallbackInfo;
  info->method_name = new std::string("onLobbyStartCountdown");
  info->args = new vector<Persistent<Value>>;

  AddImmediateCallback(EventHandlerImmediate, info);
}

void WrappedBroodWar::OnLobbyGameInit(uint32 random_seed, byte player_bytes[8]) {
  HandleScope scope;
  EventHandlerCallbackInfo* info = new EventHandlerCallbackInfo;
  info->method_name = new std::string("onLobbyGameInit");
  info->args = new vector<Persistent<Value>>;
  info->args->push_back(Persistent<Integer>::New(Integer::NewFromUnsigned(random_seed)));
  Local<Array> player_array = Array::New(8);
  for (int i = 0; i < 8; i++) {
    player_array->Set(i, Integer::NewFromUnsigned(player_bytes[i]));
  }
  info->args->push_back(Persistent<Array>::New(player_array));

  AddImmediateCallback(EventHandlerImmediate, info);
}

void WrappedBroodWar::OnLobbyMissionBriefing(byte slot) {
  HandleScope scope;
  EventHandlerCallbackInfo* info = new EventHandlerCallbackInfo;
  info->method_name = new std::string("onLobbyMissionBriefing");
  info->args = new vector<Persistent<Value>>;
  info->args->push_back(Persistent<Integer>::New(Integer::NewFromUnsigned(slot)));

  AddImmediateCallback(EventHandlerImmediate, info);
}

void WrappedBroodWar::OnLobbyChatMessage(byte slot, const std::string& message) {
  HandleScope scope;
  EventHandlerCallbackInfo* info = new EventHandlerCallbackInfo;
  info->method_name = new std::string("onLobbyChatMessage");
  info->args = new vector<Persistent<Value>>;
  info->args->push_back(Persistent<Integer>::New(Integer::NewFromUnsigned(slot)));
  info->args->push_back(Persistent<String>::New(String::New(message.c_str())));

  AddImmediateCallback(EventHandlerImmediate, info);
}

}  // namespace bw
}  // namespace sbat