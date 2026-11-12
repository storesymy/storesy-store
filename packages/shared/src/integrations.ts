import { z } from "zod";
import { emailSchema } from "./schemas";

/**
 * The integration catalogue — ONE source for every surface that speaks about
 * providers: the card grid and dialogs in the app, and the API that validates
 * what a client may store for each brand. Per-brand variance lives entirely
 * here (fields + their roles), so a new provider is a code change and never a
 * migration.
 *
 * Static brand facts (label, category, favicon, description, setup guide) are
 * catalogue-only and are never written to the database.
 */

/** The four groups the cards are tagged with. */
export type IntegrationCategory = "Payment" | "Tracking" | "Fulfilment" | "Email";

/**
 * Where a field's value goes, and how it is treated:
 *
 * - `name`   — the instance's label; stored in the row's `name` column
 *              (every provider must have exactly one, required).
 * - `config` — non-secret settings; stored in `data.settings`, returned as-is.
 * - `secret` — credentials; encrypted at rest in `data.secrets`, never
 *              returned — reads carry only a write-time hint (`••••1234`).
 */
export type IntegrationFieldRole = "name" | "config" | "secret";

/**
 * One input of a provider's Test Email section (details modal): prefilled on
 * open — recipient from the signed-in session, subject/message the default.
 * Present = the provider sends; button-only mode (Cloudflare) lets the server
 * pick every default itself.
 */
export interface TestEmailField {
  name: string;
  label: string;
  type: "email" | "text" | "textarea";
  placeholder?: string;
}

/**
 * The default SUBJECT. Deliberately free of any "test"-sounding wording —
 * automated mail with test-y subjects is a classic spam signal. ASCII only
 * (the SMTP transport folds anything else through RFC 2047 anyway).
 */
export const DEFAULT_EMAIL_SUBJECT = "Food for thought";

/**
 * The default BODY pool:30 quotes about business, sales and hard work.
 * Each send picks one at random, so repeated smoke sends never share the
 * same content (identical repeats feed content-similarity filtering).
 *
 * Straight ASCII quotes on purpose: the SMTP transport can declare a pure
 * ASCII body `7bit`, which is the cleanest possible payload.
 */
export const BUSINESS_QUOTES: ReadonlyArray<readonly [text: string, author: string]> = [
  ["The secret of getting ahead is getting started.", "Mark Twain"],
  ["Your most unhappy customers are your greatest source of learning.", "Bill Gates"],
  ["People don't care how much you know until they know how much you care.", "Theodore Roosevelt"],
  ["Satisfaction lies in the effort, not in the attainment.", "Mahatma Gandhi"],
  ["The harder I work, the luckier I get.", "Samuel Goldwyn"],
  ["Genius is one percent inspiration and ninety-nine percent perspiration.", "Thomas Edison"],
  ["Whether you think you can or you think you can't, you're right.", "Henry Ford"],
  ["It does not matter how slowly you go as long as you do not stop.", "Confucius"],
  ["Opportunities don't happen. You create them.", "Chris Grosser"],
  ["Don't be afraid to give up the good to go for the great.", "John D. Rockefeller"],
  ["I find that the harder I work, the more luck I seem to have.", "Thomas Jefferson"],
  ["Quality is not an act, it is a habit.", "Aristotle"],
  ["The way to get started is to quit talking and begin doing.", "Walt Disney"],
  ["Success usually comes to those who are too busy to be looking for it.", "Henry David Thoreau"],
  ["Vision without execution is hallucination.", "Thomas Edison"],
  ["Fall seven times, stand up eight.", "Japanese proverb"],
  ["A river cuts through rock not because of its power but because of its persistence.", "James N. Watkins"],
  ["Do what you can, with what you have, where you are.", "Theodore Roosevelt"],
  ["Success is walking from failure to failure with no loss of enthusiasm.", "Winston Churchill"],
  ["The only way to do great work is to love what you do.", "Steve Jobs"],
  ["Act as if what you do makes a difference. It does.", "William James"],
  ["Perfection is not attainable, but if we chase perfection we can catch excellence.", "Vince Lombardi"],
  ["If you're going through hell, keep going.", "Winston Churchill"],
  ["Well done is better than well said.", "Benjamin Franklin"],
  ["Doubt kills more dreams than failure ever will.", "Suzy Kassem"],
  ["You miss 100% of the shots you don't take.", "Wayne Gretzky"],
  ["Amateurs sit and wait for inspiration; the rest of us just get up and go to work.", "Stephen King"],
  ["Discipline is choosing between what you want now and what you want most.", "Abraham Lincoln"],
  ["Simplicity is the ultimate sophistication.", "Leonardo da Vinci"],
  ["Dream big. Start small. Act now.", "Robin Sharma"],
];

/**
 * A random body from {@link BUSINESS_QUOTES} — greeting, the quote, sign-off.
 * `rand` is injectable so tests can pin the pick; production just uses the
 * default. NO "test"-sounding wording anywhere (see DEFAULT_EMAIL_SUBJECT).
 */
export function randomEmailBody(rand: () => number = Math.random): string {
  const pick = BUSINESS_QUOTES[Math.floor(rand() * BUSINESS_QUOTES.length)] ?? BUSINESS_QUOTES[0]!;
  return [
    "Hi,",
    "",
    `    "${pick[0]}"`,
    `        - ${pick[1]}`,
    "",
    "All the best,",
    "- Storesy",
  ].join("\n");
}

/** What POST /api/integrations/:uuid/test-email accepts (all optional). */
export const testEmailSchema = z.object({
  recipient: emailSchema.optional(),
  subject: z.string().trim().min(1, "Subject is required").max(200, "Subject is too long").optional(),
  message: z.string().max(10_000, "Message is too long").optional(),
});

/** One credential the provider's setup asks for. */
export interface IntegrationField {
  /** Stable key the value is stored under (per provider). */
  name: string;
  label: string;
  role: IntegrationFieldRole;
  type?: "text" | "password" | "select";
  placeholder?: string;
  /** For `select` fields: the allowed values in order (first = default). */
  options?: readonly string[];
}

/** One step of the provider's in-modal how-to: a line of prose with a link
 *  that opens in a new tab, a plain line, or prose + a screenshot. */
export type IntegrationGuideStep =
  | { kind: "link"; text: string; url: string }
  | { kind: "text"; text: string }
  | { kind: "image"; text: string; image: string; alt?: string };

/** One provider: a card on the grid, and the contract for its data. */
export interface IntegrationProvider {
  /** Stable key instances carry; the row's `provider` column. */
  id: string;
  /** Brand shown on the card. */
  label: string;
  /** Host the favicon is fetched from, e.g. `chip-in.asia`. */
  domain: string;
  /** Icon path on that host; defaults to `/favicon.ico`. */
  faviconPath?: string;
  /** Full icon URL, overriding domain + path (hosts with no public icon). */
  faviconUrl?: string;
  category: IntegrationCategory;
  /** Short copy, clamped to two lines on the card. */
  description: string;
  /**
   * `google-oauth` providers are connected through an OAuth flow, not the
   * generic credential form: the API refuses `POST /api/integrations` for
   * them and the card opens the provider's sign-in dialog instead.
   */
  auth?: "google-oauth";
  /** Credentials the setup dialog asks for, in order — first is `name`. */
  fields: IntegrationField[];
  /** Where to find those credentials — heading + steps, under the fields. */
  guide?: { title: string; steps: IntegrationGuideStep[] };
  /**
   * Test Email capability. `fields` present → a section in the details modal
   * with these inputs (prefilled); no `fields` → a field-less button whose
   * defaults the server picks. Absent → no Test Email for the provider.
   */
  testEmail?: { fields?: TestEmailField[] };
}

/** The whole catalogue, in card order. */
export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  {
    id: "chip",
    label: "CHIP",
    domain: "chip-in.asia",
    faviconPath: "/images/favicon.png",
    category: "Payment",
    description: "FPX, cards and e-wallets for Malaysian buyers, settled through CHIP.",
    fields: [
      { name: "name", label: "Name", role: "name" },
      { name: "secretKey", label: "Secret Key", role: "secret", type: "password" },
    ],
    guide: {
      title: "How to get the secret key:",
      steps: [
        {
          kind: "link",
          text: "Sign up with CHIP and Go to API key section -->",
          url: "https://portal.chip-in.asia/collect/developers/api-keys",
        },
        { kind: "text", text: "Add API Key" },
        {
          kind: "image",
          text: "Click 'Copy Link' to copy the secret key",
          image: "/chip-api-keys-guide.png",
          alt: "CHIP Developers page with an arrow pointing at the Copy link button",
        },
      ],
    },
  },
  {
    id: "billplz",
    label: "Billplz",
    domain: "main.billplz.com",
    category: "Payment",
    description: "Payment links and FPX collection for local buyers.",
    fields: [
      { name: "name", label: "Name", role: "name" },
      {
        name: "host",
        label: "Host",
        role: "config",
        type: "select",
        options: ["billplz.com", "billplz-sandbox.com"],
      },
      { name: "apiKey", label: "Secret Key", role: "secret", type: "password" },
      { name: "collectionId", label: "Collection ID", role: "config" },
    ],
  },
  {
    id: "google-tag-manager",
    label: "Google Tag Manager",
    domain: "tagmanager.google.com",
    faviconUrl:
      "https://cdn.jsdelivr.net/gh/glincker/thesvg@39d01edc94e8a23dd150c72e31457d6e33b3e435/public/icons/google-tag-manager/default.svg",
    category: "Tracking",
    description: "Manage and deploy marketing tags without editing your site's code.",
    fields: [
      { name: "name", label: "Name", role: "name" },
      { name: "containerId", label: "Container ID", role: "config", placeholder: "GTM-XXXXXXX" },
    ],
  },
  {
    id: "meta-pixel",
    label: "Meta Pixel",
    domain: "facebook.com",
    category: "Tracking",
    description: "Measure Meta ads and build audiences from store activity.",
    fields: [
      { name: "name", label: "Name", role: "name" },
      { name: "pixelId", label: "Pixel ID", role: "config", placeholder: "1234567890" },
    ],
  },
  {
    id: "tiktok-pixel",
    label: "Tiktok Pixel",
    domain: "tiktok.com",
    category: "Tracking",
    description: "Measure TikTok ads and retarget store visitors.",
    fields: [
      { name: "name", label: "Name", role: "name" },
      { name: "pixelId", label: "Pixel ID", role: "config", placeholder: "C4XXXXXXXXXX" },
    ],
  },
  {
    id: "myparcel-asia",
    label: "MyParcel Asia",
    domain: "myparcelasia.com",
    faviconPath: "/assets/img/ICONmpa.png",
    category: "Fulfilment",
    description: "Book couriers and print shipping labels across the region.",
    fields: [
      { name: "name", label: "Name", role: "name" },
      {
        name: "host",
        label: "Host",
        role: "config",
        type: "select",
        options: ["app.myparcelasia.com", "demo.myparcelasia.com"],
      },
      { name: "apiKey", label: "API Key", role: "secret", type: "password" },
      { name: "apiSecret", label: "API Secret", role: "secret", type: "password" },
    ],
  },
  {
    id: "cloudflare",
    label: "Cloudflare Email",
    domain: "cloudflare.com",
    category: "Email",
    description: "Route your domain's mail through Cloudflare Email Routing.",
    fields: [
      { name: "name", label: "Name", role: "name" },
      { name: "accountId", label: "Account ID", role: "config" },
      { name: "apiToken", label: "API Token", role: "secret", type: "password" },
      {
        name: "senderEmail",
        label: "Sender email",
        role: "config",
        placeholder: "no-reply@yourdomain.com",
      },
    ],
    testEmail: {},
  },
  {
    id: "aws-ses",
    label: "AWS SES",
    domain: "aws.amazon.com",
    category: "Email",
    description: "Send receipts and password resets through Amazon SES.",
    fields: [
      { name: "name", label: "Name", role: "name" },
      { name: "key", label: "Key", role: "secret", type: "password" },
      { name: "secret", label: "Secret", role: "secret", type: "password" },
      { name: "region", label: "Region", role: "config", placeholder: "ap-southeast-1" },
      { name: "configSet", label: "Config Set", role: "config" },
    ],
  },
  {
    id: "gmail",
    label: "Gmail",
    domain: "gmail.com",
    faviconUrl: "https://ssl.gstatic.com/ui/v1/icons/mail/images/favicon_gmail_2026_v2.ico",
    category: "Email",
    description: "Send order emails from your Gmail account with Google sign-in.",
    auth: "google-oauth",
    // No manual credential fields: the OAuth flow collects them. The account
    // email and connection method are rendered by the details modal instead.
    fields: [{ name: "name", label: "Name", role: "name" }],
    testEmail: {
      fields: [
        { name: "recipient", label: "Recipient Email", type: "email", placeholder: "you@gmail.com" },
        { name: "subject", label: "Subject", type: "text" },
        { name: "message", label: "Message", type: "textarea" },
      ],
    },
  },
];

export function providerOf(providerId: string): IntegrationProvider | undefined {
  return INTEGRATION_PROVIDERS.find((entry) => entry.id === providerId);
}

/** The browser redirect URL the OAuth start endpoint returns. */
export interface GmailOAuthStart {
  url: string;
}

/**
 * The details the confirmation dialog shows after Google sign-in — never a
 * token, only what the merchant must confirm before the row is written.
 */
export interface GmailOAuthPending {
  email: string;
  scopes: string[];
  suggestedName: string;
  /** `YYYY-MM-DD HH:MM:SS` Asia/Kuala_Lumpur. */
  expiresAt: string;
}

/** POST /api/integrations/gmail/oauth/start */
export const startGmailOAuthSchema = z
  .object({
    /** Existing Gmail row being reconnected, when set. */
    integrationUuid: z.string().trim().max(80).optional(),
  })
  .default({});

/** POST /api/integrations/gmail/oauth/complete */
export const completeGmailOAuthSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(80, "Name is too long."),
});

export type StartGmailOAuthInput = z.infer<typeof startGmailOAuthSchema>;
export type CompleteGmailOAuthInput = z.infer<typeof completeGmailOAuthSchema>;

/**
 * One stored instance as every READ returns it — settings and write-time
 * hints only; `secrets` never crosses the wire in either direction except
 * as plaintext on the way IN (create/patch), and never back out.
 */
export interface IntegrationRecord {
  uuid: string;
  provider: string;
  name: string;
  connected: boolean;
  connectedAt: string | null;
  settings: Record<string, string>;
  hints: Record<string, string>;
  /** `YYYY-MM-DD HH:MM:SS` Asia/Kuala_Lumpur. */
  addedAt: string;
}

/** What POST accepts: `name` is the label column, `fields` the config+secrets. */
export interface CreateIntegrationInput {
  provider: string;
  name: string;
  fields: Record<string, string>;
}

/** What PATCH accepts: everything optional; omitted fields stay unchanged. */
export interface UpdateIntegrationInput {
  name?: string;
  connected?: boolean;
  fields?: Record<string, string>;
}

function fieldOf(provider: IntegrationProvider, key: string): IntegrationField | undefined {
  return provider.fields.find((field) => field.name === key);
}

/**
 * Fields accepted in `fields` are config + secret; a `name`-role field is the
 * row's label and travels top-level instead. Every non-name field is required
 * on create — the form collects them all, so the API insists on them too.
 */
export const createIntegrationSchema = z
  .object({
    provider: z.string(),
    name: z
      .string()
      .trim()
      .min(1, "Name is required.")
      .max(80, "Name is too long."),
    /** Field key → value; secrets arrive plaintext and are encrypted server-side. */
    fields: z.record(z.string(), z.string()),
  })
  .superRefine((value, ctx) => {
    const provider = providerOf(value.provider);
    if (!provider) {
      ctx.addIssue({ code: "custom", path: ["provider"], message: "Unknown provider." });
      return;
    }
    if (provider.auth === "google-oauth") {
      ctx.addIssue({
        code: "custom",
        path: ["provider"],
        message: `${provider.label} is connected with Google sign-in, not API keys.`,
      });
      return;
    }
    for (const [key, field] of Object.entries(value.fields)) {
      const known = fieldOf(provider, key);
      if (!known) {
        ctx.addIssue({
          code: "custom",
          path: ["fields", key],
          message: `${provider.label} has no field "${key}".`,
        });
        continue;
      }
      if (known.role === "name") {
        ctx.addIssue({
          code: "custom",
          path: ["fields", key],
          message: "Name is sent as `name`, not inside `fields`.",
        });
      }
    }
    for (const field of provider.fields) {
      if (field.role === "name") continue;
      if ((value.fields[field.name] ?? "").trim() === "") {
        ctx.addIssue({
          code: "custom",
          path: ["fields", field.name],
          message: `${field.label} is required.`,
        });
      }
    }
  });

/**
 * PATCH: every key optional (omitted = unchanged); a secret left blank is an
 * error rather than a silent wipe — clearing a credential is an explicit act
 * the UI does not offer yet.
 */
export const updateIntegrationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required.")
      .max(80, "Name is too long.")
      .optional(),
    connected: z.boolean().optional(),
    fields: z
      .record(z.string(), z.string())
      .optional()
      .superRefine((fields, ctx) => {
        if (fields === undefined) return;
        for (const [key, raw] of Object.entries(fields)) {
          if (raw.trim() === "") {
            ctx.addIssue({ code: "custom", path: [key], message: "A value is required." });
          }
        }
      }),
  })
  .superRefine((value, ctx) => {
    if (value.fields === undefined) return;
    // Every provider's label field is keyed `name` and travels top-level; the
    // service does the per-row key check against the row's own provider.
    if ("name" in value.fields) {
      ctx.addIssue({
        code: "custom",
        path: ["fields", "name"],
        message: "Name is sent as `name`, not inside `fields`.",
      });
    }
  });
