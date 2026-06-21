#[repr(C)]
pub struct SkenionExtensionHost {
    _private: [u8; 0],
}

#[unsafe(no_mangle)]
pub extern "C" fn skenion_extension_init(_host: *mut SkenionExtensionHost) -> i32 {
    0
}
