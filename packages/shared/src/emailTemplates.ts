/**
 * Automated email templates — the words the store sends on its own.
 *
 * A template is plain text with `{placeholder}` tokens. The merchant edits it
 * once on /templates; every send fills the tokens from the order. The defaults
 * below reproduce the messages Storesy has always sent, so an untouched
 * install reads exactly as before.
 */

/** One token the message may use, and what the store drops in its place. */
export interface EmailTemplatePlaceholder {
  /** The literal token, braces included — e.g. `{firstName}`. */
  token: string;
  description: string;
}

/** Tokens the thank-you message understands, in the order the UI lists them. */
export const EMAIL_TEMPLATE_PLACEHOLDERS: EmailTemplatePlaceholder[] = [
  { token: "{firstName}", description: "The buyer's first name" },
  { token: "{customerName}", description: "The buyer's full name" },
  { token: "{email}", description: "The buyer's email address" },
  { token: "{orderNo}", description: "The order reference, e.g. #0001" },
  { token: "{paidAt}", description: "When payment landed" },
  { token: "{pageName}", description: "The sales page's name" },
  { token: "{items}", description: "One line per item bought" },
  { token: "{total}", description: "The total paid, e.g. RM60.00" },
  { token: "{quantity}", description: "How many items, e.g. 2 items" },
  { token: "{shippingNote}", description: "The delivery sentence (empty for digital-only)" },
  { token: "{downloads}", description: "Download links (empty when nothing digital)" },
  { token: "{testNote}", description: "The test-order notice (empty for real orders)" },
];

/** The key of the one template the checkout sends today. */
export const THANK_YOU_TEMPLATE_KEY = "thank-you";

/** A template's stored subject + message, with its display metadata. */
export interface EmailTemplateDefinition {
  key: string;
  name: string;
  description: string;
  subject: string;
  body: string;
}

/**
 * Built-in templates. The repository seeds any missing row from here on its
 * first read, and the API falls back to the same text if a row is unreadable —
 * one source of truth for "what the store sends by default".
 */
export const DEFAULT_EMAIL_TEMPLATES: EmailTemplateDefinition[] = [
  {
    key: THANK_YOU_TEMPLATE_KEY,
    name: "Thank You Email",
    description:
      "Sent to the buyer after a successful payment — a thank-you, the item list, the total and download links.",
    subject: "Thank you for your order — {pageName}",
    body: [
      "Hi {firstName},",
      "",
      "Thank you for shopping with {pageName} — your payment of {total} has been received. We truly appreciate your support.",
      "",
      "Order: {orderNo}",
      "Paid: {paidAt}",
      "",
      "What you bought",
      "{items}",
      "",
      "Total paid: {total} ({quantity})",
      "{shippingNote}",
      "{downloads}",
      "If you have any questions, just reply to this email.",
      "",
      "Thank you,",
      "{pageName}",
      "{testNote}",
    ].join("\n"),
  },
];

/** The default definition for a key, if the key is built in. */
export function defaultEmailTemplate(key: string): EmailTemplateDefinition | null {
  return DEFAULT_EMAIL_TEMPLATES.find((template) => template.key === key) ?? null;
}

/** Tokens in `text` that aren't in the placeholder catalogue (`{wat}`). */
export function unknownTemplatePlaceholders(text: string): string[] {
  const known = new Set(EMAIL_TEMPLATE_PLACEHOLDERS.map((placeholder) => placeholder.token));
  const found = text.match(/\{[a-zA-Z][a-zA-Z0-9]*\}/g) ?? [];
  return [...new Set(found.filter((token) => !known.has(token)))];
}

/** Replace known tokens; unknown braces are left untouched (never rendered). */
export function renderEmailTemplate(text: string, values: Record<string, string>): string {
  return text.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (token) => values[token.slice(1, -1)] ?? token);
}
