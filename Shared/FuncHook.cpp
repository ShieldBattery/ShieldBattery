#include "FuncHook.h"

// TODO(tec27): restyle, see header

FuncHook::FuncHook() {
  funcMemory = NULL;
  injected = false;
  int i;
  for(i = 0; i < 6; i++)
    origMem[i] = newMem[i] = 0;
}

FuncHook::FuncHook(FuncPtr func, FuncPtr hookFunc) {
  funcMemory = NULL;
  injected = false;
  int i;
  for(i = 0; i < 6; i++)
    origMem[i] = newMem[i] = 0;
  setup(func, hookFunc);
}

void FuncHook::setup(FuncPtr func, FuncPtr hookFunc) {
  if(funcMemory != NULL) {// this hook has been setup before
    if(call == func)
      return; // same function, just leave it in place
    else {
      if(injected)
        restore();
    }
  }

  injected = false;
  call = func;
  funcMemory = reinterpret_cast<unsigned char *>(func);
  unsigned char *hookFuncMem = reinterpret_cast<unsigned char *>(hookFunc);

  DWORD oldProtect;
  if(VirtualProtect(funcMemory, 6, PAGE_EXECUTE_READ, &oldProtect) == FALSE) return;
  
  // get a pointer to the address pointer at the second byte of newMem (param for push)
  unsigned char **newMemAddrPtr = reinterpret_cast<unsigned char **>(&newMem[1]); 
  *newMemAddrPtr = hookFuncMem; // set parameter of push to the address of our hookfunc
  newMem[0] = 0x68; // push (address provided through hookFunc)
  newMem[5] = 0xc3; // return

  for(int i = 0; i < 6; i++)
    origMem[i] = funcMemory[i];

  VirtualProtect(funcMemory, 6, oldProtect, &oldProtect);
}

bool FuncHook::inject() {
  DWORD oldProtect;
  if(VirtualProtect(funcMemory, 6, PAGE_EXECUTE_READWRITE, &oldProtect) == FALSE) return false;

  for(int i = 0; i < 6; i++)
    funcMemory[i] = newMem[i];
  injected = true;
  if(VirtualProtect(funcMemory, 6, oldProtect, &oldProtect) == FALSE) return false;
  FlushInstructionCache(GetCurrentProcess(), funcMemory, 6);

  return true;
}

bool FuncHook::restore() {
  DWORD oldProtect;
  if(VirtualProtect(funcMemory, 6, PAGE_EXECUTE_READWRITE, &oldProtect) == FALSE) return false;
  for(int i = 0; i < 6; i++)
    funcMemory[i] = origMem[i];
  injected = false;
  if(VirtualProtect(funcMemory, 6, oldProtect, &oldProtect) == FALSE) return false;
  FlushInstructionCache(GetCurrentProcess(), funcMemory, 6);
  
  return true;
}