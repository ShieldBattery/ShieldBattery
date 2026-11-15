use std::collections::HashMap;
use std::sync::LazyLock;

use base64::Engine as _;
use base64::prelude::BASE64_STANDARD;
use color_eyre::eyre;
use color_eyre::eyre::{WrapErr, eyre};
use reqwest::Url;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone)]
pub struct MailgunSettings {
    /// API key associated with the Mailgun account.
    api_key: SecretString,
    /// Domain to send emails with (this is also configured on Mailgun).
    domain: String,
    /// Email address to send emails from.
    from: String,
    api_url: Url,
}

impl MailgunSettings {
    pub fn new(
        api_key: impl Into<String>,
        domain: impl Into<String>,
        from: impl Into<String>,
        api_url: Option<impl Into<Url>>,
    ) -> Self {
        let api_key: String = api_key.into();

        Self {
            api_key: api_key.into(),
            domain: domain.into(),
            from: from.into(),
            api_url: api_url.map_or_else(
                || Url::parse("https://api.mailgun.net/").unwrap(),
                |u| u.into(),
            ),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailChangeData {
    pub username: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailVerificationData {
    pub code: String,
    pub username: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PasswordChangeData {
    pub username: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LoginNameChangeData {
    pub username: String,
    pub old_login_name: String,
    pub new_login_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MailgunTemplate {
    EmailChange(EmailChangeData),
    EmailVerification(EmailVerificationData),
    PasswordChange(PasswordChangeData),
    LoginNameChange(LoginNameChangeData),
}

impl MailgunTemplate {
    fn template_name(&self) -> &'static str {
        match self {
            MailgunTemplate::EmailChange(_) => "email-change",
            MailgunTemplate::EmailVerification(_) => "email-verification",
            MailgunTemplate::PasswordChange(_) => "password-change",
            MailgunTemplate::LoginNameChange(_) => "login-name-change",
        }
    }
}

#[derive(Debug, Clone)]
pub struct MailgunMessage {
    /// The email address the message will be sent to.
    pub to: String,
    /// The template and associated data to use to construct the email subject/body.
    pub template: MailgunTemplate,
    /// The recipient's locale (generally the user's stored locale), which picks the language the
    /// email is sent in. See [resolve_translation_language].
    pub locale: Option<String>,
}

pub struct MailgunClient {
    settings: Option<MailgunSettings>,
    canonical_host: String,
    http: reqwest::Client,
}

#[derive(thiserror::Error, Debug)]
pub enum MailgunError {
    #[error(transparent)]
    UnexpectedError(#[from] eyre::Error),
}

const ENGLISH: &str = "en";

/// The languages emails are rendered in, matching `TranslationLanguage` in `common/i18n.ts`.
const SUPPORTED_LANGUAGES: [&str; 5] = [ENGLISH, "es", "ko", "ru", "zh-Hans"];

/// Regions whose Chinese is written in Traditional characters according to CLDR's likely subtags
/// (e.g. `zh-TW` maximizes to `zh-Hant-TW`). Chinese in any other region is Simplified.
const TRADITIONAL_CHINESE_REGIONS: [&str; 15] = [
    "au", "bn", "gb", "gf", "hk", "id", "mo", "pa", "pf", "ph", "sr", "th", "tw", "us", "vn",
];

/// Maps a locale (e.g. a user's stored locale, which may be a supported language like `ko` or a
/// browser-reported tag like `ko-KR` or `zh-CN`) to the supported language an email to them should
/// be in. A missing, empty, or unsupported locale resolves to English.
///
/// This is a port of `resolveTranslationLanguage` in `common/i18n.ts`, which the client uses to
/// pick the app's language; their unit tests share the same cases. A locale matches a supported
/// language with the same tag, with the same language and script (inferring the script of Chinese
/// from its region), or with the same language alone.
pub fn resolve_translation_language(locale: Option<&str>) -> &'static str {
    let Some(locale) = locale.filter(|l| !l.is_empty()) else {
        return ENGLISH;
    };
    let locale = locale.to_ascii_lowercase();

    let candidates = match parse_language_tag(&locale) {
        Some(tag) => {
            // Only Chinese has a supported language that names its script, so other languages
            // never need one inferred
            let script = match (tag.script, tag.region) {
                (Some(script), _) => script,
                (None, Some(region))
                    if tag.language == "zh" && TRADITIONAL_CHINESE_REGIONS.contains(&region) =>
                {
                    "hant"
                }
                (None, _) if tag.language == "zh" => "hans",
                (None, _) => "",
            };
            vec![
                locale.clone(),
                format!("{}-{script}", tag.language),
                tag.language.to_string(),
            ]
        }
        // Not a well-formed tag, so there's no script to infer
        None => vec![
            locale.clone(),
            locale.split('-').next().unwrap_or_default().to_string(),
        ],
    };

    candidates
        .iter()
        .find_map(|candidate| {
            SUPPORTED_LANGUAGES
                .iter()
                .find(|l| l.eq_ignore_ascii_case(candidate))
        })
        .copied()
        .unwrap_or(ENGLISH)
}

struct LanguageTag<'a> {
    language: &'a str,
    script: Option<&'a str>,
    region: Option<&'a str>,
}

/// Parses the language, script, and region of a lowercase BCP 47 language tag, or returns `None`
/// if the tag isn't well formed. Variants and extensions are checked loosely and otherwise ignored.
fn parse_language_tag(tag: &str) -> Option<LanguageTag<'_>> {
    let is_alpha = |s: &str| s.bytes().all(|b| b.is_ascii_lowercase());
    let is_digit = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
    let is_alphanumeric = |s: &str| {
        s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
    };

    let mut subtags = tag.split('-').peekable();
    let language = subtags.next()?;
    if !(matches!(language.len(), 2 | 3 | 5..=8) && is_alpha(language)) {
        return None;
    }
    let script = subtags.next_if(|s| s.len() == 4 && is_alpha(s));
    let region =
        subtags.next_if(|s| (s.len() == 2 && is_alpha(s)) || (s.len() == 3 && is_digit(s)));
    // Then variants (5-8 characters, or 4 starting with a digit), and finally extensions, each a
    // single-character singleton followed by subtags of 1-8 characters
    let mut in_extension = false;
    for subtag in subtags {
        if !is_alphanumeric(subtag) {
            return None;
        }
        let is_variant = (5..=8).contains(&subtag.len())
            || (subtag.len() == 4 && subtag.as_bytes()[0].is_ascii_digit());
        if subtag.len() == 1 {
            in_extension = true;
        } else if !(is_variant || in_extension && subtag.len() <= 8) {
            return None;
        }
    }

    Some(LanguageTag {
        language,
        script,
        region,
    })
}

/// Returns the tag of the Mailgun template version holding the `language` rendering of a template
/// for the server at `canonical_host`. This must match `emailTemplateVersion` in
/// `server/lib/mail/email-templates.ts`, which uploads the templates; both sides pin the same
/// expected values in their tests. English uses the hash of the host alone, the one tag known to a
/// server build that sends every email in English.
fn template_version(canonical_host: &str, language: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical_host);
    if language != ENGLISH {
        hasher.update("\n");
        hasher.update(language);
    }
    let hash = hasher.finalize();
    BASE64_STANDARD.encode(&hash[..])
}

/// Template name -> language -> subject line, generated by `pnpm gen-emails` along with the
/// templates themselves.
static SUBJECTS: LazyLock<HashMap<String, HashMap<String, String>>> = LazyLock::new(|| {
    serde_json::from_str(include_str!("email-subjects.json"))
        .expect("email-subjects.json should be valid")
});

/// Returns the subject line of the `language` rendering of `template_name`, falling back to the
/// English one.
fn subject(template_name: &str, language: &str) -> Option<&'static str> {
    let subjects = SUBJECTS.get(template_name)?;
    subjects
        .get(language)
        .or_else(|| subjects.get(ENGLISH))
        .map(String::as_str)
}

impl MailgunClient {
    pub fn new(settings: Option<MailgunSettings>, canonical_host: impl Into<String>) -> Self {
        Self {
            settings,
            canonical_host: canonical_host.into(),
            http: reqwest::Client::new(),
        }
    }

    #[tracing::instrument(skip_all)]
    pub async fn send(&self, message: MailgunMessage) -> Result<(), MailgunError> {
        let Some(settings) = &self.settings else {
            tracing::warn!(
                "Skipping sending email because mailgun settings are not configured: {message:?}"
            );
            return Ok(());
        };

        let template_data = self.serialize_template_data(&message.template)?;
        let template_name = message.template.template_name();
        let language = resolve_translation_language(message.locale.as_deref());
        let subject = subject(template_name, language)
            .ok_or_else(|| eyre!("No subject line for email template {template_name}"))?;
        let template_version = template_version(&self.canonical_host, language);

        #[derive(Serialize, Debug)]
        struct SendParams<'a> {
            from: &'a str,
            to: &'a str,
            template: &'a str,
            subject: &'a str,
            #[serde(rename = "t:text")]
            send_plaintext: &'a str,
            #[serde(rename = "t:variables")]
            template_variables: &'a str,
            #[serde(rename = "t:version")]
            template_version: &'a str,
        }

        let params = SendParams {
            from: &settings.from,
            to: &message.to,
            template: template_name,
            subject,
            send_plaintext: "yes",
            template_variables: &template_data,
            template_version: &template_version,
        };

        let domain = &settings.domain;
        let url = settings
            .api_url
            .join(format!("/v3/{domain}/messages").as_str())
            .wrap_err("Failed to construct Mailgun API URL")?;

        let res = self
            .http
            .post(url)
            .form(&params)
            .basic_auth("api", Some(settings.api_key.expose_secret()))
            .send()
            .await
            .wrap_err("HTTP request failed")?;

        let status = res.status();
        if !status.is_success() {
            let error = res
                .text()
                .await
                .unwrap_or_else(|_| "Could not get error text".into());
            return Err(MailgunError::UnexpectedError(eyre!(
                "got HTTP {status}, server replied: {error}"
            )));
        }

        Ok(())
    }

    fn serialize_template_data(&self, template: &MailgunTemplate) -> Result<String, MailgunError> {
        let template_data = serde_json::to_value(template)
            .wrap_err("Failed to serialize template data structure")?;
        // All templates have access to a HOST variable so we add that here
        let template_data = match template_data {
            serde_json::Value::Object(mut o) => {
                o.insert(
                    "HOST".into(),
                    serde_json::Value::String(self.canonical_host.clone()),
                );
                Ok(serde_json::Value::Object(o))
            }
            _ => Err(eyre!("Expected serialized template data to be an Object")),
        }?;
        let template_data = serde_json::to_string(&template_data)
            .wrap_err("Failed to serialize template data value")?;
        Ok(template_data)
    }
}

#[cfg(test)]
mod tests {
    use mockito::Matcher;
    use serde_json::json;

    use super::*;

    #[test]
    fn serializes_templates() {
        let client = MailgunClient::new(None, "https://example.com");
        let data = client.serialize_template_data(&MailgunTemplate::EmailVerification(
            EmailVerificationData {
                code: "asdf1234".into(),
                username: "user".into(),
            },
        ));

        assert!(data.is_ok(), "{:?}", data);
        let data: serde_json::Value = serde_json::from_str(&data.unwrap()).unwrap();

        assert_eq!(
            data,
            json!({
                "HOST": "https://example.com",
                "code": "asdf1234",
                "username": "user",
            })
        )
    }

    #[tokio::test]
    async fn skips_send_when_not_configured() {
        let client = MailgunClient::new(None, "https://example.com");
        let res = client
            .send(MailgunMessage {
                to: "user@example.org".into(),
                template: MailgunTemplate::EmailVerification(EmailVerificationData {
                    code: "asdf1234".into(),
                    username: "user".into(),
                }),
                locale: None,
            })
            .await;

        assert!(res.is_ok(), "{:?}", res);
    }

    #[tokio::test]
    async fn sends_email_verification() {
        let mut server = mockito::Server::new_async().await;
        let response = json!({
            "message": "Queued. Thank you.",
            "id": "<20111114174239.25659.5817@samples.mailgun.org>"
        });
        let route = server
            .mock("POST", "/v3/example.com/messages")
            .match_body(Matcher::AllOf(vec![
                Matcher::UrlEncoded("template".into(), "email-verification".into()),
                Matcher::UrlEncoded(
                    "subject".into(),
                    SUBJECTS["email-verification"]["ko"].clone(),
                ),
                Matcher::UrlEncoded(
                    "t:version".into(),
                    template_version("https://example.com", "ko"),
                ),
            ]))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response.to_string())
            .create_async()
            .await;

        let settings = MailgunSettings::new(
            "key-1234567890abcdef1234567890abcdef",
            "example.com",
            "noreply@example.com",
            Some(Url::parse(&server.url()).unwrap()),
        );
        let client = MailgunClient::new(Some(settings), "https://example.com");

        let res = client
            .send(MailgunMessage {
                to: "user@example.org".into(),
                template: MailgunTemplate::EmailVerification(EmailVerificationData {
                    code: "asdf1234".into(),
                    username: "user".into(),
                }),
                locale: Some("ko-KR".into()),
            })
            .await;

        route.assert_async().await;
        assert!(res.is_ok(), "{:?}", res);
    }

    #[tokio::test]
    async fn handles_mailgun_failure() {
        let mut server = mockito::Server::new_async().await;
        // NOTE(tec27): I don't think this really matches the format of their errors but we don't
        // really do anything in particular with it anyway
        let response = json!({
            "message": "Domain example.com is not allowed to send: request limit exceeded",
        });
        let route = server
            .mock("POST", "/v3/example.com/messages")
            .with_status(429)
            .with_header("content-type", "application/json")
            .with_body(response.to_string())
            .create_async()
            .await;
        let settings = MailgunSettings::new(
            "key-1234567890abcdef1234567890abcdef",
            "example.com",
            "noreply@example.com",
            Some(Url::parse(&server.url()).unwrap()),
        );
        let client = MailgunClient::new(Some(settings), "https://example.com");

        let res = client
            .send(MailgunMessage {
                to: "user@example.org".into(),
                template: MailgunTemplate::PasswordChange(PasswordChangeData {
                    username: "user".into(),
                }),
                locale: None,
            })
            .await;

        route.assert_async().await;
        assert!(res.is_err(), "{:?}", res);
    }

    #[test]
    fn template_versions() {
        // server/lib/mail/email-templates.test.ts pins the same tags for the same inputs
        let host = "https://shieldbattery.net";
        assert_eq!(
            template_version(host, "en"),
            "6TWLTKiKLSzKmyewoKyh62poVoasmuXylMwYuOu5t8k="
        );
        assert_eq!(
            template_version(host, "es"),
            "+l5/wkcQvBwZd3CbFA2FcyjXzLRefO/XBjA/1bR1Apo="
        );
        assert_eq!(
            template_version(host, "ko"),
            "as+XHPtOHfzf7lJxrPBnKzk50x5SaUvmH3PkHUwdLOE="
        );
        assert_eq!(
            template_version(host, "ru"),
            "59KZgW+Ya77H9gotZcWQ1GWVQJUxDlwkIcjs8Uye3eU="
        );
        assert_eq!(
            template_version(host, "zh-Hans"),
            "OKpDrctPc1qF+MzaOxuojE2H84Ug47w5fS4xisVxTss="
        );
    }

    #[test]
    fn resolves_translation_languages() {
        // common/i18n.test.ts tests resolveTranslationLanguage against these same cases
        let cases: [(Option<&str>, &str); 25] = [
            (None, "en"),
            (Some(""), "en"),
            (Some("en"), "en"),
            (Some("en-US"), "en"),
            (Some("ko"), "ko"),
            (Some("ko-KR"), "ko"),
            (Some("es"), "es"),
            (Some("es-MX"), "es"),
            (Some("es-419"), "es"),
            (Some("ru-RU"), "ru"),
            (Some("zh-Hans"), "zh-Hans"),
            (Some("zh-CN"), "zh-Hans"),
            (Some("zh-SG"), "zh-Hans"),
            (Some("zh"), "zh-Hans"),
            (Some("zh-Hans-CN"), "zh-Hans"),
            (Some("ZH-hans-cn"), "zh-Hans"),
            (Some("zh-TW"), "en"),
            (Some("zh-HK"), "en"),
            (Some("zh-US"), "en"),
            (Some("zh-Hant"), "en"),
            (Some("zh-Hant-CN"), "en"),
            (Some("pt-BR"), "en"),
            (Some("ko_KR"), "en"),
            (Some("zh-cmn-Hans"), "en"),
            (Some("not a locale"), "en"),
        ];
        for (locale, expected) in cases {
            assert_eq!(
                resolve_translation_language(locale),
                expected,
                "locale: {locale:?}"
            );
        }
    }

    #[test]
    fn every_template_has_subjects_in_every_language() {
        for template_name in [
            "email-change",
            "email-verification",
            "password-change",
            "login-name-change",
        ] {
            for language in SUPPORTED_LANGUAGES {
                assert!(
                    SUBJECTS
                        .get(template_name)
                        .and_then(|s| s.get(language))
                        .is_some_and(|s| !s.is_empty()),
                    "missing subject for {template_name} in {language}"
                );
            }
        }
    }
}
