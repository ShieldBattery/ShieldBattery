#include <Windows.h>
#include <stdlib.h>
#include <string>
#include <fstream>
#include "../common/func_hook.h"

typedef void (*EntryPointFunc)();

HINSTANCE selfInstance;
sbat::FuncHook<EntryPointFunc>* entryPointHook;

void doInjection();
void loadInjectees(std::string, std::string);
void inject(std::string);

EntryPointFunc func_for_free_ = nullptr;  // hackish way of avoiding needing a local below
void __declspec(naked) __declspec(noreturn) HOOK_entryPoint() {
  doInjection();

  func_for_free_ = entryPointHook->callable();
  delete entryPointHook;
  entryPointHook = nullptr;
  // Now we do some hackery to chain a call to FreeLibrary (to unload this module) into a jmp (well, ret)
  // back to the now restored entry point
  __asm {
    push selfInstance; // hModule param for FreeLibrary
    push func_for_free_; // return address for FreeLibrary
    push FreeLibrary;
    ret;
  }
}

void doInjection()  {
  char procPath[MAX_PATH];
  GetModuleFileNameA(NULL, procPath, MAX_PATH);

  char* lastSlash = strrchr(procPath, '\\');
  if (lastSlash == NULL) {
    return;
  }
  *lastSlash = '\0';

  std::string scoutHome(procPath);
  std::string loaderFilePath = scoutHome + "\\scout.load";

  loadInjectees(loaderFilePath, scoutHome);
}

void patchEntryPoint() {
  // we're using InfectInject, which modifies the entry point of BW to run its own code
  // We want to make sure our code runs before any BW code runs but *not* inside DllMain
  // To do this, we just patch the actual BW entry point (the one the infector overrides)
  // to call our injector
  entryPointHook = new sbat::FuncHook<EntryPointFunc>(reinterpret_cast<EntryPointFunc>(0x00404C21),
      HOOK_entryPoint);
  entryPointHook->Inject();
}

extern "C" BOOL WINAPI DllMain(HINSTANCE dllInstance, DWORD reason, LPVOID reserved) {
  if (reason == DLL_PROCESS_ATTACH) {
    selfInstance = dllInstance;
    patchEntryPoint();
  }

  return TRUE;
}

void loadInjectees(std::string loaderFilePath, std::string scoutHome) {
  std::string line;
  std::ifstream loaderFile(loaderFilePath);
  if (loaderFile.is_open()) {
    while (loaderFile.good()) {
      getline(loaderFile, line);
      inject(scoutHome + "\\" + line);
    }

    loaderFile.close();
  }
}

typedef void (*OnInjectFunc)();
void inject(std::string dllPath) {
  HMODULE module = LoadLibraryA(dllPath.c_str());
  if (module != NULL) {
    OnInjectFunc onInject = reinterpret_cast<OnInjectFunc>(
        GetProcAddress(module, "scout_onInject"));
    if (onInject != nullptr) {
      onInject();
    }
  }
}