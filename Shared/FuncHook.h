#ifndef FUNCHOOK_H
#define FUNCHOOK_H

#define WIN32_LEAN_AND_MEAN
#include <windows.h>
//TODO(tec27): re-style this to follow goog c++ style guide; this should probably also be a class
typedef void (*FuncPtr)();

struct FuncHook {
  unsigned char * funcMemory;
  unsigned char origMem[6];
  unsigned char newMem[6];

  FuncPtr call;

  bool injected;

  FuncHook();
  FuncHook(FuncPtr func, FuncPtr hookFunc);
  void setup(FuncPtr func, FuncPtr hookFunc);
  bool inject();
  bool restore();
};

#endif