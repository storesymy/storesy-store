import { AppError, badRequest } from "../core/errors";
import type { IntegrationRow } from "../models/schema";
import { decryptSecret, fieldAad } from "./integrations.crypto";
import { GmailOAuthError, sendGmailEmail } from "./gmail.service";

/**
 * One email, sent through one connected Email integration.
 *
 * The single transport both Test Email and the checkout's notifications use:
 * Gmail through the Gmail API (Google OAuth, send-only scope) or Cloudflare
 * Email Sending over REST. Credentials are decrypted per send and never
 * logged; provider refusals surface as `502 email_send_failed` with a
 * fixable reason — a revoked Gmail grant says to reconnect.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface SentEmail {
  /** The address the provider was told to send from. */
  from: string;
}

export async function sendIntegrationEmail(
  env: Env,
  row: IntegrationRow,
  message: EmailMessage,
): Promise<SentEmail> {
  if (row.provider === "gmail") {
    const from = (row.data.settings.username ?? "").trim();
    if (from === "") {
      throw badRequest("missing_credentials", "This Gmail integration has no account address stored.");
    }
    const encrypted = row.data.secrets.refreshToken;
    if (!encrypted) {
      throw badRequest(
        "missing_credentials",
        "Reconnect Gmail with Google sign-in before sending.",
      );
    }
    const refreshToken = await decryptSecret(env, fieldAad(row.uuid, "refreshToken"), encrypted);
    try {
      return await sendGmailEmail(env, from, refreshToken, message);
    } catch (error) {
      if (error instanceof GmailOAuthError) {
        // Missing config is a setup problem (400); everything else the
        // merchant can fix is a send failure with the reason attached.
        if (error.code === "not_configured") throw badRequest(error.code, error.message);
        throw new AppError(502, "email_send_failed", error.message);
      }
      throw new AppError(502, "email_send_failed", "Could not send the email.");
    }
  }

  if (row.provider === "cloudflare") {
    const token = row.data.secrets.apiToken;
    if (!token) throw badRequest("missing_credentials", "This integration has no API token stored.");
    const accountId = row.data.settings.accountId;
    if (!accountId) {
      throw badRequest("missing_credentials", "This integration has no Account ID stored.");
    }
    // The sender must be a domain enabled for Email Sending — Cloudflare
    // rejects anything else as `email.invalid`, so fail fast with the fix.
    const from = (row.data.settings.senderEmail ?? "").trim();
    if (from === "") {
      throw badRequest(
        "missing_sender",
        "Add a Sender email first — pencil ✎ the Sender email row in this modal, then retry.",
      );
    }

    let response: Response;
    try {
      response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${await decryptSecret(env, fieldAad(row.uuid, "apiToken"), token)}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: message.to,
            from,
            subject: message.subject,
            text: message.text,
          }),
        },
      );
    } catch {
      throw new AppError(502, "email_send_failed", "Could not reach Cloudflare to send the email.");
    }

    const payload = (await response.json().catch(() => null)) as
      | { success?: boolean; errors?: Array<{ message?: string }> }
      | null;
    if (!response.ok || payload?.success !== true) {
      const reason = payload?.errors?.[0]?.message ?? `Cloudflare responded ${response.status}`;
      const hint = reason.includes("email.invalid")
        ? " Check that the Sender email's domain is enabled for Email Sending on this account and that the recipient is allowed."
        : "";
      throw new AppError(502, "email_send_failed", `Cloudflare refused the email: ${reason}.${hint}`);
    }
    return { from };
  }

  throw badRequest("wrong_provider", "This integration can't send email.");
}
