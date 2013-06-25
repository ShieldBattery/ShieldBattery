#include  "./wrapped_brood_war.h"

#include <node.h>
#include <uv.h>
#include <string>

#include "./brood_war.h"
#include "shieldbattery/shieldbattery.h"

using v8::AccessorInfo;
using v8::Arguments;
using v8::Boolean;
using v8::Context;
using v8::Exception;
using v8::Function;
using v8::FunctionTemplate;
using v8::Handle;
using v8::HandleScope;
using v8::Int32;
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

WrappedBroodWar::WrappedBroodWar()
  : brood_war_(BroodWar::Get()) {
}

WrappedBroodWar::~WrappedBroodWar() {
  delete brood_war_;
}

Persistent<Function> WrappedBroodWar::constructor;

void WrappedBroodWar::Init() {
  Local<FunctionTemplate> tpl = FunctionTemplate::New(New);
  tpl->SetClassName(String::NewSymbol("CBroodWar"));
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  // accessors
  tpl->PrototypeTemplate()->SetAccessor(String::NewSymbol("currentMapPath"), GetCurrentMapPath);
  tpl->PrototypeTemplate()->SetAccessor(String::NewSymbol("currentMapName"), GetCurrentMapName);
  tpl->PrototypeTemplate()->SetAccessor(String::NewSymbol("currentMapFolderPath"),
      GetCurrentMapFolderPath);
  tpl->PrototypeTemplate()->SetAccessor(String::NewSymbol("localPlayerId"), GetLocalPlayerId);
  tpl->PrototypeTemplate()->SetAccessor(String::NewSymbol("localPlayerName"),
      GetLocalPlayerName, SetLocalPlayerName);
  tpl->PrototypeTemplate()->SetAccessor(String::NewSymbol("gameSpeed"), GetGameSpeed);
  tpl->PrototypeTemplate()->SetAccessor(String::NewSymbol("isBroodWar"),
      GetIsBroodWar, SetIsBroodWar);
  tpl->PrototypeTemplate()->SetAccessor(String::NewSymbol("isMultiplayer"),
      GetIsMultiplayer, SetIsMultiplayer);
  tpl->PrototypeTemplate()->SetAccessor(String::NewSymbol("isHostingGame"), GetIsHostingGame);
  tpl->PrototypeTemplate()->SetAccessor(String::NewSymbol("wasBooted"), GetWasBooted);
  tpl->PrototypeTemplate()->SetAccessor(String::NewSymbol("bootReason"), GetBootReason);
  tpl->PrototypeTemplate()->SetAccessor(String::NewSymbol("lobbyDirtyFlag"),
      GetLobbyDirtyFlag, SetLobbyDirtyFlag);

  // functions
  tpl->PrototypeTemplate()->Set(String::NewSymbol("initSprites"),
      FunctionTemplate::New(InitSprites)->GetFunction());
  tpl->PrototypeTemplate()->Set(String::NewSymbol("initPlayerInfo"),
      FunctionTemplate::New(InitPlayerInfo)->GetFunction());
  tpl->PrototypeTemplate()->Set(String::NewSymbol("chooseNetworkProvider"),
      FunctionTemplate::New(ChooseNetworkProvider)->GetFunction());
  tpl->PrototypeTemplate()->Set(String::NewSymbol("createGame"),
      FunctionTemplate::New(CreateGame)->GetFunction());
  tpl->PrototypeTemplate()->Set(String::NewSymbol("initGameNetwork"),
      FunctionTemplate::New(InitGameNetwork)->GetFunction());
  tpl->PrototypeTemplate()->Set(String::NewSymbol("addComputer"),
      FunctionTemplate::New(AddComputer)->GetFunction());
  tpl->PrototypeTemplate()->Set(String::NewSymbol("processLobbyTurn"),
      FunctionTemplate::New(ProcessLobbyTurn)->GetFunction());
  tpl->PrototypeTemplate()->Set(String::NewSymbol("startGameCountdown"),
      FunctionTemplate::New(StartGameCountdown)->GetFunction());
  tpl->PrototypeTemplate()->Set(String::NewSymbol("runGameLoop"),
      FunctionTemplate::New(RunGameLoop)->GetFunction());

  constructor = Persistent<Function>::New(tpl->GetFunction());
}

Handle<Value> WrappedBroodWar::New(const Arguments& args) {
  HandleScope scope;

  WrappedBroodWar* bw = new WrappedBroodWar();
  bw->Wrap(args.This());

  return args.This();
}

Handle<Value> WrappedBroodWar::NewInstance(const Arguments& args) {
  HandleScope scope;

  Local<Object> instance = constructor->NewInstance();

  return scope.Close(instance);
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

// function definitions
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
  bool result = bw->CreateGame(game_name ? std::string(game_name) : std::string("ShieldBattery"),
      password ? std::string(password) : std::string(),
      std::string(map_path),
      game_type,
      game_speed);

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

  GameLoopContext* context = new GameLoopContext();
  context->cb = Persistent<Function>::New(cb);
  context->bw = WrappedBroodWar::Unwrap(args);

  sbat::QueueWorkForMainThread(context,
      WrappedBroodWar::AsyncRunGameLoop, WrappedBroodWar::AsyncAfterRunGameLoop);

  return scope.Close(v8::Undefined());
}

void WrappedBroodWar::AsyncRunGameLoop(void* arg) {
  GameLoopContext* context = reinterpret_cast<GameLoopContext*>(arg);
  context->bw->RunGameLoop();
}

void WrappedBroodWar::AsyncAfterRunGameLoop(void* arg) {
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

}  // namespace bw
}  // namespace sbat