const STORM_RESEND_REQUEST: u8 = 2;
const STORM_RESEND_RESPONSE: u8 = 4;

const HEADER_FROM_ID_OFFSET: usize = 10;
const HEADER_RESEND_OFFSET: usize = 11;
const RESEND_REQUEST_TARGET_OFFSET: usize = 12;

pub enum ResendType {
    /// Contains the target user the packet is from. (If None, it's for the user receiving the
    /// packet).
    Request(Option<u8>),
    /// Contains the user the packet is from.
    Response(u8),
}

/// Returns None if the given packet is not a resend packet, otherwise returns information about the
/// resend and its target.
pub fn get_resend_info(data: &[u8]) -> Option<ResendType> {
    if data.len() <= HEADER_RESEND_OFFSET {
        None
    } else {
        match data[HEADER_RESEND_OFFSET] {
            STORM_RESEND_REQUEST => {
                if data.len() <= RESEND_REQUEST_TARGET_OFFSET {
                    Some(ResendType::Request(None))
                } else {
                    Some(ResendType::Request(Some(
                        data[RESEND_REQUEST_TARGET_OFFSET],
                    )))
                }
            }
            STORM_RESEND_RESPONSE => Some(ResendType::Response(data[HEADER_FROM_ID_OFFSET])),
            _ => None,
        }
    }
}

/// Returns the Storm ID that sent this packet initially. If 255, that player has not been assigned
/// an ID yet.
pub fn get_storm_id(data: &[u8]) -> Option<u8> {
    if data.len() <= HEADER_FROM_ID_OFFSET {
        None
    } else {
        Some(data[HEADER_FROM_ID_OFFSET])
    }
}
