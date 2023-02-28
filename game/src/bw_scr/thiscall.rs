//! Since extern "thiscall" is not available in stable rust this module
//! provides necessary code for wrapping extern "C" function in a
//! runtime-generated thiscall

use std::marker::PhantomData;
use std::mem;

use byteorder::{ByteOrder, LittleEndian};
use lazy_static::lazy_static;
use winapi::um::heapapi::{HeapCreate, HeapAlloc};
use winapi::um::winnt::{HEAP_CREATE_ENABLE_EXECUTE};

lazy_static! {
    static ref EXEC_HEAP: usize = init_exec_heap();
}

fn init_exec_heap() -> usize {
    unsafe {
        let result = HeapCreate(HEAP_CREATE_ENABLE_EXECUTE, 0, 0) as usize;
        assert!(result != 0);
        result
    }
}

#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct Thiscall<T: ExternCFn>(usize, PhantomData<T>);

pub trait ExternCFnArgs {
    const N: u8;
}

struct Private;

pub struct ArgCount1(Private);
pub struct ArgCount2(Private);
pub struct ArgCount3(Private);
pub struct ArgCount4(Private);
pub struct ArgCount6(Private);
pub struct ArgCount8(Private);
pub struct ArgCount11(Private);

impl ExternCFnArgs for ArgCount1 {
    const N: u8 = 1;
}

impl ExternCFnArgs for ArgCount2 {
    const N: u8 = 2;
}

impl ExternCFnArgs for ArgCount3 {
    const N: u8 = 3;
}

impl ExternCFnArgs for ArgCount4 {
    const N: u8 = 4;
}

impl ExternCFnArgs for ArgCount6 {
    const N: u8 = 6;
}

impl ExternCFnArgs for ArgCount8 {
    const N: u8 = 8;
}

impl ExternCFnArgs for ArgCount11 {
    const N: u8 = 11;
}

pub trait ExternCFn {
    type Args: ExternCFnArgs;
    type Ret;
    type A1;
    type A2;
    type A3;
    type A4;
    type A5;
    type A6;
    type A7;
    type A8;
    type A9;
    type A10;
    type A11;

    fn cast_usize(self) -> usize;
}

/// Just something that users cannot initialize
pub struct Unused(Private);

impl<A, R> ExternCFn for unsafe extern "C" fn(A) -> R {
    type Args = ArgCount1;
    type Ret = R;
    type A1 = A;
    type A2 = Unused;
    type A3 = Unused;
    type A4 = Unused;
    type A5 = Unused;
    type A6 = Unused;
    type A7 = Unused;
    type A8 = Unused;
    type A9 = Unused;
    type A10 = Unused;
    type A11 = Unused;

    fn cast_usize(self) -> usize {
        self as usize
    }
}

impl<A, B, R> ExternCFn for unsafe extern "C" fn(A, B) -> R {
    type Args = ArgCount2;
    type Ret = R;
    type A1 = A;
    type A2 = B;
    type A3 = Unused;
    type A4 = Unused;
    type A5 = Unused;
    type A6 = Unused;
    type A7 = Unused;
    type A8 = Unused;
    type A9 = Unused;
    type A10 = Unused;
    type A11 = Unused;

    fn cast_usize(self) -> usize {
        self as usize
    }
}

impl<A, B, C, R> ExternCFn for unsafe extern "C" fn(A, B, C) -> R {
    type Args = ArgCount3;
    type Ret = R;
    type A1 = A;
    type A2 = B;
    type A3 = C;
    type A4 = Unused;
    type A5 = Unused;
    type A6 = Unused;
    type A7 = Unused;
    type A8 = Unused;
    type A9 = Unused;
    type A10 = Unused;
    type A11 = Unused;

    fn cast_usize(self) -> usize {
        self as usize
    }
}

impl<A, B, C, D, R> ExternCFn for unsafe extern "C" fn(A, B, C, D) -> R {
    type Args = ArgCount4;
    type Ret = R;
    type A1 = A;
    type A2 = B;
    type A3 = C;
    type A4 = D;
    type A5 = Unused;
    type A6 = Unused;
    type A7 = Unused;
    type A8 = Unused;
    type A9 = Unused;
    type A10 = Unused;
    type A11 = Unused;

    fn cast_usize(self) -> usize {
        self as usize
    }
}

impl<A, B, C, D, E, F, R> ExternCFn for unsafe extern "C" fn(A, B, C, D, E, F) -> R {
    type Args = ArgCount6;
    type Ret = R;
    type A1 = A;
    type A2 = B;
    type A3 = C;
    type A4 = D;
    type A5 = E;
    type A6 = F;
    type A7 = Unused;
    type A8 = Unused;
    type A9 = Unused;
    type A10 = Unused;
    type A11 = Unused;

    fn cast_usize(self) -> usize {
        self as usize
    }
}

impl<A, B, C, D, E, F, G, H, R> ExternCFn for unsafe extern "C" fn(A, B, C, D, E, F, G, H) -> R {
    type Args = ArgCount8;
    type Ret = R;
    type A1 = A;
    type A2 = B;
    type A3 = C;
    type A4 = D;
    type A5 = E;
    type A6 = F;
    type A7 = G;
    type A8 = H;
    type A9 = Unused;
    type A10 = Unused;
    type A11 = Unused;

    fn cast_usize(self) -> usize {
        self as usize
    }
}

impl<A, B, C, D, E, F, G, H, I, J, K, R> ExternCFn for
    unsafe extern "C" fn(A, B, C, D, E, F, G, H, I, J, K) -> R
{
    type Args = ArgCount11;
    type Ret = R;
    type A1 = A;
    type A2 = B;
    type A3 = C;
    type A4 = D;
    type A5 = E;
    type A6 = F;
    type A7 = G;
    type A8 = H;
    type A9 = I;
    type A10 = J;
    type A11 = K;

    fn cast_usize(self) -> usize {
        self as usize
    }
}

impl<T: ExternCFn> Thiscall<T> {
    /// Creates a callable wrapper to a func that is extern "C"
    pub fn new(func: T) -> Thiscall<T> {
        unsafe {
            let heap = *EXEC_HEAP;
            // Just allocating enough for the wrapper.
            // Overallocating really doesn't hurt at all since there's no way
            // that we use entire 4096-byte page that is being allocated to
            // hold these.
            let alloc_size = 0x40;
            let ptr = HeapAlloc(heap as *mut _, 0, alloc_size) as *mut u8;
            assert!(!ptr.is_null());
            let mut slice = std::slice::from_raw_parts_mut(ptr, alloc_size);
            for _ in 0..(T::Args::N - 1) {
                // Push args arg_max ..= 2
                // push [esp + 4 * (args - 1)]
                (&mut slice[..4]).copy_from_slice(&[0xff, 0x74, 0xe4, (T::Args::N - 1) * 4]);
                slice = &mut slice[4..];
            }
            // push ecx
            slice[0] = 0x51;
            // mov eax, func
            slice[1] = 0xb8;
            LittleEndian::write_u32(&mut slice[2..], T::cast_usize(func) as u32);
            slice = &mut slice[6..];
            // call eax
            slice[0] = 0xff;
            slice[1] = 0xd0;
            // add esp, args * 4
            (&mut slice[2..5]).copy_from_slice(&[0x83, 0xc4, T::Args::N * 4]);
            // ret (args - 1) * 4
            (&mut slice[5..8]).copy_from_slice(&[0xc2, (T::Args::N - 1) * 4, 0x00]);
            Thiscall(ptr as usize, PhantomData)
        }
    }

    /// Creates thiscall wrapper to a foreign function which already uses thiscall ABI,
    /// so that it can be called properly.
    pub fn foreign(fnptr: usize) -> Thiscall<T> {
        Thiscall(fnptr, PhantomData)
    }

    pub fn cast_usize(self) -> usize {
        self.0
    }
}

impl<T: ExternCFn<Args = ArgCount1>> Thiscall<T> {
    pub unsafe fn call1(self, a1: T::A1) -> T::Ret {
        let fnptr: unsafe extern "C" fn(usize, T::A1) -> T::Ret = mem::transmute(CALL.as_ptr());
        fnptr(self.0, a1)
    }
}

impl<T: ExternCFn<Args = ArgCount2>> Thiscall<T> {
    pub unsafe fn call2(self, a1: T::A1, a2: T::A2) -> T::Ret {
        let fnptr: unsafe extern "C" fn(usize, T::A1, T::A2) -> T::Ret =
            mem::transmute(CALL.as_ptr());
        fnptr(self.0, a1, a2)
    }
}

impl<T: ExternCFn<Args = ArgCount3>> Thiscall<T> {
    pub unsafe fn call3(self, a1: T::A1, a2: T::A2, a3: T::A3) -> T::Ret {
        let fnptr: unsafe extern "C" fn(usize, T::A1, T::A2, T::A3) -> T::Ret =
            mem::transmute(CALL.as_ptr());
        fnptr(self.0, a1, a2, a3)
    }
}

impl<T: ExternCFn<Args = ArgCount6>> Thiscall<T> {
    pub unsafe fn call6(
        self,
        a1: T::A1,
        a2: T::A2,
        a3: T::A3,
        a4: T::A4,
        a5: T::A5,
        a6: T::A6,
    ) -> T::Ret {
        let fnptr:
            unsafe extern "C" fn(usize, T::A1, T::A2, T::A3, T::A4, T::A5, T::A6) -> T::Ret =
            mem::transmute(CALL.as_ptr());
        fnptr(self.0, a1, a2, a3, a4, a5, a6)
    }
}

impl<T: ExternCFn<Args = ArgCount8>> Thiscall<T> {
    pub unsafe fn call8(
        self,
        a1: T::A1,
        a2: T::A2,
        a3: T::A3,
        a4: T::A4,
        a5: T::A5,
        a6: T::A6,
        a7: T::A7,
        a8: T::A8,
    ) -> T::Ret {
        let fnptr:
            unsafe extern "C" fn(usize, T::A1, T::A2, T::A3, T::A4, T::A5, T::A6, T::A7, T::A8) -> T::Ret =
            mem::transmute(CALL.as_ptr());
        fnptr(self.0, a1, a2, a3, a4, a5, a6, a7, a8)
    }
}

impl<T: ExternCFn<Args = ArgCount11>> Thiscall<T> {
    pub unsafe fn call11(
        self,
        a1: T::A1,
        a2: T::A2,
        a3: T::A3,
        a4: T::A4,
        a5: T::A5,
        a6: T::A6,
        a7: T::A7,
        a8: T::A8,
        a9: T::A9,
        a10: T::A10,
        a11: T::A11,
    ) -> T::Ret {
        let fnptr:
            unsafe extern "C" fn(usize, T::A1, T::A2, T::A3, T::A4, T::A5, T::A6,
                T::A7, T::A8, T::A9, T::A10, T::A11) -> T::Ret =
            mem::transmute(CALL.as_ptr());
        fnptr(self.0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11)
    }
}

// Max 11 arguments
#[link_section = ".text"]
static CALL: [u8; 0x39] = [
    0x55,                   // push ebp
    0x89, 0xe5,             // mov ebp, esp
    0x8b, 0x44, 0xe4, 0x08, // mov eax, [esp + 0x8]
    0x8b, 0x4c, 0xe4, 0x0c, // mov ecx, [esp + 0xc]
    0xff, 0x74, 0xe4, 0x34, // push [esp + 0x34]
    0xff, 0x74, 0xe4, 0x34, // push [esp + 0x34]
    0xff, 0x74, 0xe4, 0x34, // push [esp + 0x34]
    0xff, 0x74, 0xe4, 0x34, // push [esp + 0x34]
    0xff, 0x74, 0xe4, 0x34, // push [esp + 0x34]
    0xff, 0x74, 0xe4, 0x34, // push [esp + 0x34]
    0xff, 0x74, 0xe4, 0x34, // push [esp + 0x34]
    0xff, 0x74, 0xe4, 0x34, // push [esp + 0x34]
    0xff, 0x74, 0xe4, 0x34, // push [esp + 0x34]
    0xff, 0x74, 0xe4, 0x34, // push [esp + 0x34]
    0xff, 0xd0,             // call eax
    0x89, 0xec,             // mov esp, ebp
    0x5d,                   // pop ebp
    0xc3,                   // ret
];
