import { describe, expect, it } from "vitest";
import { sendSmtpMail, smtpFailureMessage, SmtpError } from "../src/services/smtp";
import type { SmtpConnection, SmtpConfig } from "../src/services/smtp";

/**
 * The SMTP client's protocol behaviour, against a SCRIPTED dialogue — no
 * sockets in CI. The first test is the regression for the real bug: Gmail's
 * EHLO reply is multi-line with continuation dashes (`250-8BITMIME`,
 * `250-AUTH …`), and a final-line check that only matched the code stopped
 * early, leaving capability lines for the AUTH step to misread as a bogus
 * `SMTP 250: 8BITMIME AUTH …` reply.
 */

const CONFIG: SmtpConfig = {
  host: "smtp.gmail.com",
  port: 465,
  username: "sender@gmail.com",
  password: "abcd efgh ijkl mnop",
  from: "sender@gmail.com",
  to: "reader@example.com",
  subject: "Test Email",
  text: "Hello.\n.hidden line stays stuffed",
};

function scripted(replies: string[]): { conn: SmtpConnection; written: string[] } {
  const written: string[] = [];
  let index = 0;
  return {
    written,
    conn: {
      async write(line: string) {
        written.push(line.replace(/\r\n$/, ""));
      },
      async read() {
        const reply = replies[index];
        if (reply === undefined) throw new Error("script exhausted");
        index += 1;
        return reply;
      },
      async close() {},
    },
  };
}

describe("smtp client", () => {
  it("drains Gmail's multi-line EHLO and completes the whole session", async () => {
    const { conn, written } = scripted([
      "220 smtp.gmail.com ESMTP d18-20020a0560000000b000005a59d5f5f5sm123456789.12 - gsmtp",
      "250-smtp.gmail.com at your service",
      "250-SIZE 52428800",
      "250-8BITMIME",
      "250-AUTH LOGIN PLAIN XOAUTH2 PLAIN-CLIENTTOKEN OAUTHBEARER XOAUTH",
      "250-ENHANCEDSTATUSCODES",
      "250 SMTPUTF8",
      "235 2.7.0 Accepted",
      "250 2.1.0 OK",
      "250 2.1.0 OK",
      "354 Go ahead",
      "250 2.0.0 OK: queued as ABCDEF123",
    ]);
    await sendSmtpMail(CONFIG, async () => conn);

    expect(written[0]).toBe("EHLO storesy.local");
    expect(written.some((line) => line.startsWith("AUTH PLAIN "))).toBe(true);
    expect(written.some((line) => line === "MAIL FROM:<sender@gmail.com>")).toBe(true);
    expect(written.some((line) => line === "RCPT TO:<reader@example.com>")).toBe(true);
    expect(written).toContain("DATA");
    expect(written).toContain("QUIT");

    const data = written.join("\n");
    expect(data).toContain("Subject: Test Email");
    expect(data).toContain("From: sender@gmail.com");
    // Message-ID sits on the sender's realm — `.local` is invalid publicly
    // and is exactly what spam filters flag.
    expect(data).toMatch(/Message-ID: <[0-9a-f-]+@gmail\.com>/);
    expect(data).not.toMatch(/Message-ID: <[^>]*@storesy\.local>/);
    // RFC 5321 dot-stuffing: the ".hidden" body line gains a dot.
    expect(data).toContain("..hidden line stays stuffed");
    expect(data).toContain("\r\n."); // terminator
  }, 10_000);

  it("maps Gmail's credential refusal to the App Password guidance", async () => {
    const { conn } = scripted([
      "220 smtp.gmail.com ESMTP",
      "250-smtp.gmail.com at your service",
      "250-8BITMIME",
      "250 SMTPUTF8",
      "535 5.7.8 Error: authentication failed, code 535",
    ]);
    let caught: unknown;
    try {
      await sendSmtpMail(CONFIG, async () => conn);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SmtpError);
    expect((caught as SmtpError).code).toBe(535);
    const message = smtpFailureMessage(caught);
    expect(message).toContain("App Password");
    expect(message).not.toContain("ijkl mnop"); // never echo the password
  }, 10_000);

  it("keeps subjects to one header line and declares 7bit for ASCII", async () => {
    const { conn, written } = scripted([
      "220 smtp ESMTP",
      "250 OK",
      "235 Accepted",
      "250 OK",
      "250 OK",
      "354 Go ahead",
      "250 OK",
    ]);
    await sendSmtpMail(
      { ...CONFIG, subject: "Hello\r\nBcc: evil@example.com", text: "pure ascii body" },
      async () => conn,
    );
    const lines = written.join("\n").split(/\r?\n/);
    // The CRLF was folded away — no injected header LINE ever forms.
    expect(lines.some((line) => line.startsWith("Bcc:"))).toBe(false);
    expect(lines.some((line) => line.startsWith("Subject: Hello Bcc: evil@example.com"))).toBe(true);
    expect(lines.some((line) => line === "Content-Transfer-Encoding: 7bit")).toBe(true);
  }, 10_000);

  it("RFC 2047-encodes non-ASCII subjects and declares 8bit bodies", async () => {
    const { conn, written } = scripted([
      "220 smtp ESMTP",
      "250 OK",
      "235 Accepted",
      "250 OK",
      "250 OK",
      "354 Go ahead",
      "250 OK",
    ]);
    await sendSmtpMail(
      { ...CONFIG, subject: "Prüfung ✓", text: "café is not ASCII" },
      async () => conn,
    );
    const data = written.join("\n");
    expect(data).toContain("Subject: =?UTF-8?B?");
    expect(data).not.toContain("Prüfung"); // raw UTF-8 never appears in the header
    expect(data).toContain("Content-Transfer-Encoding: 8bit");
  }, 10_000);

  it("maps the daily-quota refusal to the limit guidance", () => {
    const message = smtpFailureMessage(
      new SmtpError(550, "5.4.5 User daily sending quota exceeded. (Mode: normal)"),
    );
    expect(message).toContain("daily sending limit");
    expect(message).toContain("AWS SES");
  });

  it("maps throttling to a retry-later message", () => {
    const message = smtpFailureMessage(
      new SmtpError(421, "4.7.0 Temporary System Problem. Try again later"),
    );
    expect(message).toContain("rate-limiting");
    expect(message).toContain("retry");
  });

  it("reports a closed connection as code 0", async () => {
    const { conn } = scripted(["220 smtp.gmail.com ESMTP"]);
    // read() throws "script exhausted" once replies run out
    let caught: unknown;
    try {
      await sendSmtpMail(CONFIG, async () => conn);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SmtpError);
    expect(smtpFailureMessage(caught)).toContain("Could not reach");
  }, 10_000);
});
