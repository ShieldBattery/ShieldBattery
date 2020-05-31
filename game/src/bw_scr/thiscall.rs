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

pub trait ExternCFn {
    const ARGS: u8;
    type Ret;
    type A1;
    type A2;
    type A3;

    fn cast_usize(self) -> usize;
}

/// Just something that users cannot initialize
pub struct Unused(usize);

impl<A, R> ExternCFn for unsafe extern "C" fn(A) -> R {
    const ARGS: u8 = 1;
    type Ret = R;
    type A1 = A;
    type A2 = Unused;
    type A3 = Unused;

    fn cast_usize(self) -> usize {
        self as usize
    }
}

impl<A, B, R> ExternCFn for unsafe extern "C" fn(A, B) -> R {
    const ARGS: u8 = 2;
    type Ret = R;
    type A1 = A;
    type A2 = B;
    type A3 = Unused;

    fn cast_usize(self) -> usize {
        self as usize
    }
}

impl<A, B, C, R> ExternCFn for unsafe extern "C" fn(A, B, C) -> R {
    const ARGS: u8 = 3;
    type Ret = R;
    type A1 = A;
    type A2 = B;
    type A3 = C;

    fn cast_usize(self) -> usize {
        self as usize
    }
}

impl<T: ExternCFn> Thiscall<T> {
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
            for _ in 0..(T::ARGS - 1) {
                // Push args arg_max ..= 2
                // push [esp + 4 * (args - 1)]
                (&mut slice[..4]).copy_from_slice(&[0xff, 0x74, 0xe4, (T::ARGS - 1) * 4]);
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
            (&mut slice[2..5]).copy_from_slice(&[0x83, 0xc4, T::ARGS * 4]);
            // ret (args - 1) * 4
            (&mut slice[5..8]).copy_from_slice(&[0xc2, (T::ARGS - 1) * 4, 0x00]);
            Thiscall(ptr as usize, PhantomData)
        }
    }

    pub unsafe fn call1(self, a1: T::A1) -> T::Ret {
        let fnptr: unsafe extern "C" fn(usize, T::A1) -> T::Ret = mem::transmute(CALL.as_ptr());
        fnptr(self.0, a1)
    }

    pub unsafe fn call2(self, a1: T::A1, a2: T::A2) -> T::Ret {
        let fnptr: unsafe extern "C" fn(usize, T::A1, T::A2) -> T::Ret =
            mem::transmute(CALL.as_ptr());
        fnptr(self.0, a1, a2)
    }

    pub unsafe fn call3(self, a1: T::A1, a2: T::A2, a3: T::A3) -> T::Ret {
        let fnptr: unsafe extern "C" fn(usize, T::A1, T::A2, T::A3) -> T::Ret =
            mem::transmute(CALL.as_ptr());
        fnptr(self.0, a1, a2, a3)
    }
}

// Max 3 arguments
#[link_section = ".text"]
static CALL: [u8; 0x19] = [
    0x55,                   // push ebp
    0x89, 0xe5,             // mov ebp, esp
    0x8b, 0x44, 0xe4, 0x08, // mov eax, [esp + 0x8]
    0x8b, 0x4c, 0xe4, 0x0c, // mov ecx, [esp + 0xc]
    0xff, 0x74, 0xe4, 0x14, // push [esp + 0x14]
    0xff, 0x74, 0xe4, 0x14, // push [esp + 0x14]
    0xff, 0xd0,             // call eax
    0x89, 0xec,             // mov esp, ebp
    0x5d,                   // pop ebp
    0xc3,                   // ret
];
