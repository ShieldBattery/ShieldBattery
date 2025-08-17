use color_eyre::eyre;
use color_eyre::eyre::{WrapErr, eyre};
use data_encoding::BASE64;
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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PasswordResetData {
    pub username: String,
    pub token: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UsernameRecoveryData {
    pub email: String,
    pub usernames: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MailgunTemplate {
    EmailChange(EmailChangeData),
    EmailVerification(EmailVerificationData),
    PasswordChange(PasswordChangeData),
    LoginNameChange(LoginNameChangeData),
    PasswordReset(PasswordResetData),
    UsernameRecovery(UsernameRecoveryData),
}

impl MailgunTemplate {
    fn subject(&self) -> &'static str {
        match self {
            MailgunTemplate::EmailChange(_) => "ShieldBattery Email Changed",
            MailgunTemplate::EmailVerification(_) => "ShieldBattery Email Verification",
            MailgunTemplate::PasswordChange(_) => "ShieldBattery Password Changed",
            MailgunTemplate::LoginNameChange(_) => "ShieldBattery Login Name Changed",
            MailgunTemplate::PasswordReset(_) => "ShieldBattery Password Reset",
            MailgunTemplate::UsernameRecovery(_) => "ShieldBattery Username Recovery",
        }
    }

    fn template_name(&self) -> &'static str {
        match self {
            MailgunTemplate::EmailChange(_) => "email-change",
            MailgunTemplate::EmailVerification(_) => "email-verification",
            MailgunTemplate::PasswordChange(_) => "password-change",
            MailgunTemplate::LoginNameChange(_) => "login-name-change",
            MailgunTemplate::PasswordReset(_) => "password-reset",
            MailgunTemplate::UsernameRecovery(_) => "username-recovery",
        }
    }
}

#[derive(Debug, Clone)]
pub struct MailgunMessage {
    /// The email address the message will be sent to.
    pub to: String,
    /// The template and associated data to use to construct the email subject/body.
    pub template: MailgunTemplate,
}

pub struct MailgunClient {
    settings: Option<MailgunSettings>,
    canonical_host: String,
    template_version: String,
}

#[derive(thiserror::Error, Debug)]
pub enum MailgunError {
    #[error(transparent)]
    UnexpectedError(#[from] eyre::Error),
}

fn get_template_version(canonical_host: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(canonical_host);
    let hash = hasher.finalize();
    BASE64.encode(&hash[..])
}

impl MailgunClient {
    pub fn new(settings: Option<MailgunSettings>, canonical_host: impl Into<String>) -> Self {
        let canonical_host: String = canonical_host.into();
        let template_version = get_template_version(&canonical_host);

        tracing::debug!("Using template version: {template_version}");

        Self {
            settings,
            canonical_host,
            template_version,
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
            from: &settings.from.to_string(),
            to: &message.to,
            template: message.template.template_name(),
            subject: message.template.subject(),
            send_plaintext: "yes",
            template_variables: &template_data,
            template_version: &self.template_version,
        };

        let domain = &settings.domain;
        let url = settings
            .api_url
            .join(format!("/v3/{domain}/messages").as_str())
            .wrap_err("Failed to construct Mailgun API URL")?;

        let client = reqwest::Client::new();
        let res = client
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
            serde_json::Value::Object(o) => {
                let mut o = o.clone();
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

        assert!(data.is_ok(), "{:?}", &data);
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
            })
            .await;

        assert!(res.is_ok(), "{:?}", &res);
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
            })
            .await;

        route.assert_async().await;
        assert!(res.is_ok(), "{:?}", &res);
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
            })
            .await;

        route.assert_async().await;
        assert!(res.is_err(), "{:?}", &res);
    }
}
