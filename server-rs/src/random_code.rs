use rand::{Rng, rng};

// NOTE(tec27): If you change this, make sure to change the TS version as well.
/// Characters used in random verification codes sent through email.
const RANDOM_EMAIL_CODE_CHARACTERS: &[u8] = b"BCDFGHJKLMNPQRTWXY3469";
const NUM_POTENTIAL_CHARS: u16 = RANDOM_EMAIL_CODE_CHARACTERS.len() as u16;
// Values above this number have leftover bits that will mess up the distribution when we use mod
const MAX_ALLOWABLE_RAND: u16 =
    ((0x10000u32 / NUM_POTENTIAL_CHARS as u32) * NUM_POTENTIAL_CHARS as u32 - 1) as u16;

/// Generates a secure random code of `char_count` characters, formatted as two dash-separated
/// groups.
fn gen_random_code_of_len(char_count: usize) -> String {
    // TODO(tec27): There is probably a more efficient way to do this with a
    // rand::distr::SampleString implementation, this is just a direct port of our TS version

    // Generate a bit of extra randomness to hopefully have enough "valid" bytes in one go
    let bytes_to_gen = 2 * (char_count + 1);
    let mut result = Vec::with_capacity(char_count);
    let mut buf = vec![0u8; bytes_to_gen];

    while result.len() < char_count {
        rng().fill_bytes(&mut buf);
        let mut pos = 0;
        while pos + 1 < buf.len() && result.len() < char_count {
            let value = u16::from_le_bytes([buf[pos], buf[pos + 1]]);
            pos += 2;
            if value > MAX_ALLOWABLE_RAND {
                continue;
            }
            let idx = (value % NUM_POTENTIAL_CHARS) as usize;
            result.push(RANDOM_EMAIL_CODE_CHARACTERS[idx] as char);
        }
    }

    let half = char_count / 2;
    format!(
        "{}-{}",
        String::from_iter(result[..half].iter()),
        String::from_iter(result[half..].iter()),
    )
}

/// Returns a secure random code string of the format XXXXX-XXXXX, suitable for things like password
/// reset and email verification codes.
pub fn gen_random_code() -> String {
    gen_random_code_of_len(10)
}

/// Returns a shorter secure random code string of the format XXX-XXX, suitable for contexts where
/// ease of transcription matters more than the entropy a full-length code provides (e.g. lobby
/// join codes).
pub fn gen_short_random_code() -> String {
    gen_random_code_of_len(6)
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

    #[test]
    fn test_gen_short_random_code_format() {
        let code = gen_short_random_code();
        // The code should match the format XXX-XXX, only using allowed characters
        let re = Regex::new(r"^[BCDFGHJKLMNPQRTWXY3469]{3}-[BCDFGHJKLMNPQRTWXY3469]{3}$").unwrap();
        assert!(
            re.is_match(&code),
            "code '{code}' did not match expected format",
        );
    }

    #[test]
    fn test_gen_short_random_code_uniqueness() {
        let code1 = gen_short_random_code();
        let code2 = gen_short_random_code();
        assert_ne!(code1, code2, "codes should be different");
    }

    #[test]
    fn test_gen_short_only_valid_letters() {
        let codes = (0..2000)
            .map(|_| gen_short_random_code())
            .collect::<Vec<_>>();
        for code in codes {
            let mut first = code.clone();
            // Split at -
            let second = first.split_off(3);
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
