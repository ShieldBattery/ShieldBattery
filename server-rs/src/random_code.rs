use rand::{RngCore, rng};

// NOTE(tec27): If you change this, make sure to change the TS version as well.
/// Characters used in random verification codes sent through email.
const RANDOM_EMAIL_CODE_CHARACTERS: &[u8] = b"BCDFGHJKLMNPQRTWXY3469";
const NUM_POTENTIAL_CHARS: u16 = RANDOM_EMAIL_CODE_CHARACTERS.len() as u16;
const CHARS_TO_GEN: u16 = 10;
// Values above this number have leftover bits that will mess up the distribution when we use mod
const MAX_ALLOWABLE_RAND: u16 =
    ((0x10000u32 / NUM_POTENTIAL_CHARS as u32) * NUM_POTENTIAL_CHARS as u32 - 1) as u16;
const BYTES_TO_GEN: u16 = 2 * (CHARS_TO_GEN + 1);

/// Returns a secure random code string of the format XXXXX-XXXXX, suitable for things like password
/// reset and email verification codes.
pub fn gen_random_code() -> String {
    // TODO(tec27): There is probably a more efficient way to do this with a
    // rand::distr::SampleString implementation, this is just a direct port of our TS version

    let mut result = Vec::with_capacity(CHARS_TO_GEN as usize);
    let mut buf = [0u8; BYTES_TO_GEN as usize];

    while result.len() < CHARS_TO_GEN as usize {
        rng().fill_bytes(&mut buf);
        let mut pos = 0;
        while pos + 1 < buf.len() && result.len() < CHARS_TO_GEN as usize {
            let value = u16::from_le_bytes([buf[pos], buf[pos + 1]]);
            pos += 2;
            if value > MAX_ALLOWABLE_RAND {
                continue;
            }
            let idx = (value % NUM_POTENTIAL_CHARS) as usize;
            result.push(RANDOM_EMAIL_CODE_CHARACTERS[idx] as char);
        }
    }

    let half = CHARS_TO_GEN as usize / 2;
    format!(
        "{}-{}",
        String::from_iter(result[..half].iter()),
        String::from_iter(result[half..].iter()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use regex::Regex;

    #[test]
    fn test_gen_random_code_format() {
        let code = gen_random_code();
        // The code should match the format XXXXX-XXXXX, only using allowed characters
        let re = Regex::new(r"^[BCDFGHJKLMNPQRTWXY3469]{5}-[BCDFGHJKLMNPQRTWXY3469]{5}$").unwrap();
        assert!(
            re.is_match(&code),
            "code '{code}' did not match expected format",
        );
    }

    #[test]
    fn test_gen_random_code_uniqueness() {
        let code1 = gen_random_code();
        let code2 = gen_random_code();
        assert_ne!(code1, code2, "codes should be different");
    }

    #[test]
    fn test_gen_only_valid_letters() {
        let codes = (0..2000).map(|_| gen_random_code()).collect::<Vec<_>>();
        for code in codes {
            let mut first = code.clone();
            // Split at -
            let second = first.split_off(5);
            for c in first.chars() {
                assert!(
                    RANDOM_EMAIL_CODE_CHARACTERS.contains(&(c as u8)),
                    "code '{code}' contains invalid character '{c}'",
                );
            }
            for c in second.chars().skip(1) {
                assert!(
                    RANDOM_EMAIL_CODE_CHARACTERS.contains(&(c as u8)),
                    "code '{code}' contains invalid character '{c}'",
                );
            }
        }
    }
}
