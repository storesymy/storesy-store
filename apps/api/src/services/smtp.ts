import { connect } from "cloudflare:sockets";

/**
 * Minimal SMTP-over-TLS client for one-shot sends (Gmail's submission
 * service, implicit TLS on 465 via Workers `connect({ secureTransport })`).
 *
 * Deliberately small: EHLO → AUTH PLAIN → MAIL/RCPT → DATA → QUIT, enough
 * for transactional test mail — not a bulk mailer. The connection opener is
 * injectable so tests drive the REAL protocol code against a scripted
 * dialogue instead of opening sockets.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
  to: string;
  subject: string;
  text: string;
}

/** The half of a socket this client needs: line in, line out, close. */
export interface SmtpConnection {
  write(line: string): Promise<void>;
  /** Next CRLF-terminated line (multiline replies arrive one per call). */
  read(): Promise<string>;
  close(): Promise<void>;
}

/** SMTP-level failure: carries the reply code (`0` = never connected). */
export class SmtpError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "SmtpError";
  }
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Real socket: implicit TLS to the submission port. */
function openTlsConnection(config: SmtpConfig): Promise<SmtpConnection> {
  const socket = connect(
    { hostname: config.host, port: config.port },
    { secureTransport: "on", allowHalfOpen: false },
  );
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return Promise.resolve({
    async write(line: string) {
      await writer.write(new TextEncoder().encode(line));
    },
    async read() {
      // Accumulate decoded bytes until a full CRLF line is buffered.
      for (;;) {
        const crlf = buffer.indexOf("\r\n");
        if (crlf !== -1) {
          const line = buffer.slice(0, crlf);
          buffer = buffer.slice(crlf + 2);
          return line;
        }
        const { value, done } = await reader.read();
        if (done) throw new SmtpError(0, "The SMTP connection closed unexpectedly.");
        if (value) buffer += decoder.decode(value, { stream: true });
      }
    },
    async close() {
      try {
        await writer.close();
        await reader.cancel();
      } catch {
        // Already torn down — closing is best-effort.
      }
    },
  });
}

/**
 * Reads one reply; multi-line replies drain to the FINAL line — which is
 * `250 text` (code + SPACE), while continuations are `250-text` (code +
 * DASH). Testing only the code would stop at `250-SIZE…` and leave Gmail's
 * capability lines (`250-8BITMIME`, `250-AUTH …`) in the buffer, where the
 * next command would read them as a bogus reply — exactly the
 * `SMTP 250: 8BITMIME AUTH …` failure this fix addresses.
 */
async function readReply(conn: SmtpConnection): Promise<{ code: number; text: string }> {
  const first = await conn.read();
  const code = Number(first.slice(0, 3));
  const parts = [first.slice(4)];
  if (first.slice(3, 4) === "-") {
    for (;;) {
      const line = await conn.read();
      parts.push(line.slice(4));
      const isFinal = line.slice(0, 3) === String(code) && (line.slice(3, 4) === " " || line.length === 3);
      if (isFinal) break;
    }
  }
  if (!Number.isFinite(code) || code < 100) {
    throw new SmtpError(0, `Unreadable SMTP reply: ${first}`);
  }
  return { code, text: parts.join(" ").trim() };
}

async function expect(conn: SmtpConnection, want: number): Promise<{ code: number; text: string }> {
  const reply = await readReply(conn);
  if (reply.code !== want) throw new SmtpError(reply.code, reply.text);
  return reply;
}

/** RFC 5321 dot-stuffing: a body line starting with "." gets another dot.
 *  Line endings normalize to CRLF; stray CRs are dropped. */
function dotStuff(text: string): string {
  return text
    .replace(/\r\n?|\n/g, "\r\n")
    .replace(/(^|\r\n)\./g, "$1..");
}

/** A header value must be one ASCII line: CR/LF folded to a space, and any
 *  non-ASCII run RFC 2047 encoded-word encoded (Subject with an accent, a
 *  smiley, … — raw UTF-8 in a header is malformed and spam filters cite it). */
function headerValue(value: string): string {
  const folded = value.replace(/[\r\n]+/g, " ").trim();
  // eslint-disable-next-line no-control-regex
  if (!/^[\u0000-\u007F]*$/.test(folded)) {
    const bytes = new TextEncoder().encode(folded);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `=?UTF-8?B?${btoa(binary)}?=`;
  }
  return folded;
}

async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SmtpError(0, `SMTP ${what} timed out.`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Send one message. Throws {@link SmtpError} for any protocol/network
 * failure; the caller maps codes to user-facing guidance.
 */
export async function sendSmtpMail(
  config: SmtpConfig,
  open: (config: SmtpConfig) => Promise<SmtpConnection> = openTlsConnection,
  timeoutMs = 15_000,
): Promise<void> {
  try {
    await withTimeout(
      (async () => {
        const conn = await open(config); // connect failures → SmtpError below
      try {
        await expect(conn, 220); // greeting
        await conn.write("EHLO storesy.local\r\n");
        await expect(conn, 250);
        await conn.write(`AUTH PLAIN ${toBase64(`\0${config.username}\0${config.password}`)}\r\n`);
        await expect(conn, 235);
        await conn.write(`MAIL FROM:<${config.from}>\r\n`);
        await expect(conn, 250);
        await conn.write(`RCPT TO:<${config.to}>\r\n`);
        await expect(conn, 250);
        await conn.write("DATA\r\n");
        await expect(conn, 354);

        // Message-ID sits on the SENDER's realm (a .local domain is invalid
        // on the public internet and spam filters check it); the transfer
        // encoding must match the payload — 7bit only for pure-ASCII bodies
        // (Gmail advertises 8BITMIME, so UTF-8 user messages are honest).
        const realm = (config.from.split("@")[1] ?? "localhost").toLowerCase();
        const isAscii = /^[\u0000-\u007F]*$/.test(config.text);
        const headers = [
          `From: ${config.from}`,
          `To: ${config.to}`,
          `Subject: ${headerValue(config.subject)}`,
          `Date: ${new Date().toUTCString()}`,
          `Message-ID: <${crypto.randomUUID()}@${realm}>`,
          "MIME-Version: 1.0",
          'Content-Type: text/plain; charset="utf-8"',
          `Content-Transfer-Encoding: ${isAscii ? "7bit" : "8bit"}`,
        ].join("\r\n");
        await conn.write(`${headers}\r\n\r\n${dotStuff(config.text)}\r\n.\r\n`);
        await expect(conn, 250);
        await conn.write("QUIT\r\n");
        } finally {
          await conn.close();
        }
      })(),
      timeoutMs,
      "session",
    );
  } catch (error) {
    // Socket/DNS/timeout failures wear code 0 so the mapping stays uniform.
    throw error instanceof SmtpError
      ? error
      : new SmtpError(0, error instanceof Error ? error.message : "Unknown SMTP failure.");
  }
}

/** Map an SMTP failure to the message the details modal shows. */
export function smtpFailureMessage(error: unknown): string {
  if (error instanceof SmtpError) {
    // Gmail's auth refusals — the actionable cause is almost always the
    // password type (Google removed "less secure apps" in 2022).
    if ([534, 535, 538, 533, 530].includes(error.code)) {
      return (
        "Google rejected the credentials — use a 16-character App Password " +
        "(2-Step Verification must be ON on the Google account). " +
        `Google replied: ${error.message}`
      );
    }
    // Daily quota (`550 5.4.5 User daily sending quota exceeded…`) — the
    // limit is a rolling 24 hours, ~500/day on free accounts.
    if (error.code === 550 && /quota|5\.4\.5/i.test(error.message)) {
      return (
        "Gmail's daily sending limit has been reached (rolling 24 hours, " +
        "about 500/day on free accounts). Try again after the window — or " +
        "use AWS SES / Cloudflare Email for volume."
      );
    }
    // Throttling (421/450 and friends) — temporary, not a config problem.
    if (
      error.code === 421 ||
      error.code === 450 ||
      /rate.?limit|too many|throttl|temporarily|try again later/i.test(error.message)
    ) {
      return (
        "Gmail is rate-limiting this account right now — wait a few minutes " +
        "and retry. If it persists, cut down burst volume."
      );
    }
    if (error.code === 0) {
      return `Could not reach the mail server: ${error.message}`;
    }
    return `SMTP ${error.code}: ${error.message}`;
  }
  return "Could not send the test email.";
}
