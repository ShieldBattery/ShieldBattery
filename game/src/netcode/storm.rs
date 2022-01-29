const STORM_RESEND_REQUEST: u8 = 2;
const STORM_RESEND_RESPONSE: u8 = 4;

const HEADER_RESEND_OFFSET: usize = 11;

/// Returns whether the given Storm packet data is a resend or resend request.
pub fn is_storm_resend(data: &Vec<u8>) -> bool {
    if data.len() <= HEADER_RESEND_OFFSET {
        false
    } else {
        match data[HEADER_RESEND_OFFSET] {
            STORM_RESEND_REQUEST => true,
            STORM_RESEND_RESPONSE => true,
            _ => false,
        }
    }
}
