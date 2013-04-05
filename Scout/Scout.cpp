#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#include <stdlib.h>
#include <string>
#include <fstream>
#include "../Shared/FuncHook.h"

using namespace std;

HINSTANCE selfInstance;
FuncHook entryPointHook;

void doInjection();
void loadInjectees(string,string);
void inject(string);

void __declspec(naked) __declspec(noreturn) HOOK_entryPoint() {
  doInjection();

  entryPointHook.restore();
  // Now we do some hackery to chain a call to FreeLibrary (to unload this module) into a jmp (well, ret)
  // back to the now restored entry point
  __asm {
    push selfInstance // hModule param for FreeLibrary
    push entryPointHook.call // return address for FreeLibrary
    push FreeLibrary
    ret
  }
}

void doInjection()  {
  char procPath[MAX_PATH];
  GetModuleFileNameA(NULL, procPath, MAX_PATH);

  char* lastSlash = strrchr(procPath, '\\');
  if(lastSlash == NULL) return;
  *lastSlash = '\0';

  string scoutHome(procPath);
  string loaderFilePath = scoutHome + "\\scout.load";

  loadInjectees(loaderFilePath, scoutHome);
}

void patchEntryPoint() {
  // we're using InfectInject, which modifies the entry point of BW to run its own code
  // We want to make sure our code runs before any BW code runs but *not* inside DllMain
  // To do this, we just patch the actual BW entry point (the one the infector overrides)
  // to call our injector
  DWORD entryPoint = 0x00404C21;
  entryPointHook.setup(reinterpret_cast<FuncPtr>(entryPoint), reinterpret_cast<FuncPtr>(HOOK_entryPoint));
  entryPointHook.inject();
}

extern "C" BOOL WINAPI DllMain(HINSTANCE dllInstance, DWORD reason, LPVOID reserved) {
  if(reason == DLL_PROCESS_ATTACH) {
    selfInstance = dllInstance;
    patchEntryPoint();
  }

  return TRUE;
}

void loadInjectees(string loaderFilePath, string scoutHome) {
  string line;
  ifstream loaderFile(loaderFilePath);
  if(loaderFile.is_open()) {
    while(loaderFile.good()) {
      getline(loaderFile, line);
      inject(scoutHome + "\\" + line);
    }

    loaderFile.close();
  }
}

typedef void (*OnInjectFunc)();
void inject(string dllPath) {
  HMODULE module = LoadLibraryA(dllPath.c_str());
  OnInjectFunc onInject = reinterpret_cast<OnInjectFunc>(GetProcAddress(module, "scout_onInject"));
  if(onInject) onInject();
}