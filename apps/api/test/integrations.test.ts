import { env, SELF } from "cloudflare:test";
import { INTEGRATION_PROVIDERS, isAdminRole } from "@storesy/shared";
import { describe, expect, it } from "vitest";
import {
  decryptSecret,
  encryptSecret,
  fieldAad,
  secretHint,
} from "../src/services/integrations.crypto";

/**
 * Integrations hold live payment/email credentials, so they earn tests the
 * ordinary CRUD surfaces don't: the catalogue's contract (every provider has
 * a Name field), envelope crypto (round-trip, AAD binding, tamper), the
 * admin-only gate (401 signed out, 403 with a non-admin role), validation
 * messages, and — above all — that a plaintext secret never appears in ANY
 * response, only its write-time hint.
 */

const ORIGIN = "http://example.com";
const EMAIL = `integrations-${crypto.randomUUID()}@example.com`;

/** One signup for the whole file — signups are rate-limited per client IP. */
let session: Promise<string> | null = null;
function sharedSession(): Promise<string> {
  session ??= (async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Integrations Tester", email: EMAIL, password: "correct horse battery" }),
    });
    expect(response.status).toBe(201);
    return (response.headers.get("set-cookie") as string).split(";")[0] as string;
  })();
  return session;
}

const jsonHeaders = (cookie: string) => ({ "Content-Type": "application/json", Cookie: cookie });

async function setRole(role: string): Promise<void> {
  await env.DB.prepare("UPDATE users SET role = ?1 WHERE email = ?2").bind(role, EMAIL).run();
}

interface ErrorEnvelope {
  error: { code: string; message: string; fields?: Record<string, string> };
}
interface IntegrationDto {
  uuid: string;
  provider: string;
  name: string;
  connected: boolean;
  connectedAt: string | null;
  settings: Record<string, string>;
  hints: Record<string, string>;
  addedAt: string;
}

describe("catalogue contract", () => {
  it("gives every provider exactly one Name field, listed first", () => {
    for (const provider of INTEGRATION_PROVIDERS) {
      const names = provider.fields.filter((field) => field.role === "name");
      expect(names.map((field) => field.name), provider.id).toEqual(["name"]);
      expect(provider.fields[0]?.role, provider.id).toBe("name");
    }
  });

  it("gives Billplz the specified fields in order", () => {
    const billplz = INTEGRATION_PROVIDERS.find((provider) => provider.id === "billplz");
    expect(billplz?.fields.map((field) => field.label)).toEqual([
      "Name",
      "Host",
      "Secret Key",
      "Collection ID",
    ]);
    const host = billplz?.fields.find((field) => field.name === "host");
    expect(host?.role).toBe("config");
    expect(host?.type).toBe("select");
    expect(host?.options).toEqual(["billplz.com", "billplz-sandbox.com"]);
  });

  it("gives MyParcel Asia the specified fields in order", () => {
    const myparcel = INTEGRATION_PROVIDERS.find((provider) => provider.id === "myparcel-asia");
    expect(myparcel?.fields.map((field) => field.label)).toEqual([
      "Name",
      "Host",
      "API Key",
      "API Secret",
    ]);
    const host = myparcel?.fields.find((field) => field.name === "host");
    expect(host?.type).toBe("select");
    expect(host?.options).toEqual(["app.myparcelasia.com", "demo.myparcelasia.com"]);
    expect(myparcel?.fields.filter((field) => field.role === "secret").map((f) => f.name)).toEqual([
      "apiKey",
      "apiSecret",
    ]);
  });

  it("gives AWS SES the specified fields in order", () => {
    const ses = INTEGRATION_PROVIDERS.find((provider) => provider.id === "aws-ses");
    expect(ses?.fields.map((field) => field.label)).toEqual([
      "Name",
      "Key",
      "Secret",
      "Region",
      "Config Set",
    ]);
    const roles = Object.fromEntries(ses!.fields.map((field) => [field.name, field.role]));
    expect(roles).toEqual({
      name: "name",
      key: "secret",
      secret: "secret",
      region: "config",
      configSet: "config",
    });
  });

  it("gives Cloudflare Email the specified fields in order", () => {
    const cloudflare = INTEGRATION_PROVIDERS.find((provider) => provider.id === "cloudflare");
    expect(cloudflare?.fields.map((field) => field.label)).toEqual([
      "Name",
      "Account ID",
      "API Token",
      "Sender email",
    ]);
    expect(cloudflare?.fields.find((f) => f.name === "accountId")?.role).toBe("config");
    expect(cloudflare?.fields.find((f) => f.name === "apiToken")?.role).toBe("secret");
    expect(cloudflare?.fields.some((f) => f.name === "domain")).toBe(false);
  });

  it("gives Gmail the specified fields, icon and Test Email section", () => {
    const gmail = INTEGRATION_PROVIDERS.find((provider) => provider.id === "gmail");
    expect(gmail?.fields.map((field) => field.label)).toEqual(["Name", "Username", "App Password"]);
    expect(gmail?.guide?.title).toBe("How to get App Password:");
    expect(gmail?.guide?.steps).toHaveLength(4);
    expect(gmail?.guide?.steps?.[3]?.text).toContain("500 emails/day");
    expect(gmail?.fields.find((f) => f.name === "username")?.role).toBe("config");
    expect(gmail?.fields.find((f) => f.name === "password")?.role).toBe("secret");
    expect(gmail?.faviconUrl).toBe(
      "https://ssl.gstatic.com/ui/v1/icons/mail/images/favicon_gmail_2026_v2.ico",
    );
    expect(gmail?.testEmail?.fields?.map((field) => field.label)).toEqual([
      "Recipient Email",
      "Subject",
      "Message",
    ]);
    expect(gmail?.testEmail?.fields?.[2]?.type).toBe("textarea");
  });

  it("has unique provider ids", () => {
    const ids = INTEGRATION_PROVIDERS.map((provider) => provider.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("treats owner as admin, and unknown roles as not", () => {
    expect(isAdminRole("owner")).toBe(true);
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("viewer")).toBe(false);
    expect(isAdminRole("")).toBe(false);
  });
});

describe("envelope crypto", () => {
  const AAD = fieldAad("itg-0199f3c2-0000-7000-8000-000000000000", "secretKey");

  it("round-trips through a versioned envelope", async () => {
    const envelope = await encryptSecret(env, AAD, "sk_live_abc123");
    expect(envelope.startsWith("v1.")).toBe(true);
    expect(envelope.includes("sk_live_abc123")).toBe(false);
    await expect(decryptSecret(env, AAD, envelope)).resolves.toBe("sk_live_abc123");
  });

  it("refuses an envelope under another row's AAD", async () => {
    const envelope = await encryptSecret(env, AAD, "secret");
    const otherRow = fieldAad("itg-0199f3c2-0000-7000-8000-ffffffffffff", "secretKey");
    await expect(decryptSecret(env, otherRow, envelope)).rejects.toThrow();
  });

  it("refuses a tampered envelope", async () => {
    const envelope = await encryptSecret(env, AAD, "secret");
    const [version, iv, ct] = envelope.split(".");
    const flipped = `${version}.${iv}.${ct?.slice(0, -2)}${ct?.slice(-2) === "AA" ? "BB" : "AA"}`;
    await expect(decryptSecret(env, AAD, flipped)).rejects.toThrow();
  });

  it("writes the display hint at write time", () => {
    expect(secretHint("sk_live_1234f2a")).toBe("••••4f2a");
  });
});

describe("admin gate", () => {
  it("401s every integration route without a session", async () => {
    const list = await SELF.fetch(`${ORIGIN}/api/integrations`);
    expect(list.status).toBe(401);
    const post = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "chip", name: "X", fields: { secretKey: "y" } }),
    });
    expect(post.status).toBe(401);
    const testEmail = await SELF.fetch(`${ORIGIN}/api/integrations/itg-x/test-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(testEmail.status).toBe(401);
  });

  it("403s a signed-in non-admin on every route", async () => {
    const cookie = await sharedSession();
    await setRole("viewer");
    try {
      const list = await SELF.fetch(`${ORIGIN}/api/integrations`, { headers: jsonHeaders(cookie) });
      expect(list.status).toBe(403);
      const post = await SELF.fetch(`${ORIGIN}/api/integrations`, {
        method: "POST",
        headers: jsonHeaders(cookie),
        body: JSON.stringify({ provider: "chip", name: "X", fields: { secretKey: "y" } }),
      });
      expect(post.status).toBe(403);
      const patch = await SELF.fetch(`${ORIGIN}/api/integrations/itg-x`, {
        method: "PATCH",
        headers: jsonHeaders(cookie),
        body: JSON.stringify({ name: "Y" }),
      });
      expect(patch.status).toBe(403);
      const remove = await SELF.fetch(`${ORIGIN}/api/integrations/itg-x`, {
        method: "DELETE",
        headers: jsonHeaders(cookie),
      });
      expect(remove.status).toBe(403);
      const testEmail = await SELF.fetch(`${ORIGIN}/api/integrations/itg-x/test-email`, {
        method: "POST",
        headers: jsonHeaders(cookie),
      });
      expect(testEmail.status).toBe(403);
    } finally {
      await setRole("owner");
    }
  });
});

describe("end-to-end as admin", () => {
  it("creates, lists, validates, patches and deletes without leaking secrets", async () => {
    const cookie = await sharedSession();

    const empty = await SELF.fetch(`${ORIGIN}/api/integrations`, { headers: jsonHeaders(cookie) });
    expect(empty.status).toBe(200);
    expect(((await empty.json()) as { integrations: IntegrationDto[] }).integrations).toEqual([]);

    // --- happy create (secret provider): CHIP -------------------------------
    const SECRET = "sk_live_1234f2a";
    const created = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ provider: "chip", name: "Main Store", fields: { secretKey: SECRET } }),
    });
    expect(created.status).toBe(201);
    const chip = (await created.json()) as IntegrationDto;
    expect(chip.uuid.startsWith("itg-")).toBe(true);
    expect(chip.name).toBe("Main Store");
    expect(chip.connected).toBe(true);
    expect(chip.connectedAt).not.toBeNull();
    expect(chip.hints.secretKey).toBe("••••4f2a");
    expect(chip.settings).toEqual({});
    // The plaintext must not exist in ANY response body.
    expect(JSON.stringify(chip)).not.toContain(SECRET);

    // --- happy create (config provider): GTM -------------------------------
    const gtmCreated = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        provider: "google-tag-manager",
        name: "Main Container",
        fields: { containerId: "GTM-ABC123" },
      }),
    });
    expect(gtmCreated.status).toBe(201);
    const gtm = (await gtmCreated.json()) as IntegrationDto;
    expect(gtm.settings.containerId).toBe("GTM-ABC123");
    expect(gtm.hints).toEqual({});

    // --- list: both rows, oldest first, still no secrets -------------------
    const listed = await SELF.fetch(`${ORIGIN}/api/integrations`, { headers: jsonHeaders(cookie) });
    const rows = ((await listed.json()) as { integrations: IntegrationDto[] }).integrations;
    expect(rows.map((row) => row.name)).toEqual(["Main Store", "Main Container"]);
    expect(JSON.stringify(rows)).not.toContain(SECRET);

    // --- validation battery --------------------------------------------------
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["blank name", { provider: "chip", name: "   ", fields: { secretKey: SECRET } }, "name"],
      ["missing secret", { provider: "chip", name: "No Secret", fields: {} }, "fields.secretKey"],
      ["unknown provider", { provider: "paypal", name: "X", fields: {} }, "provider"],
      ["name inside fields", { provider: "chip", name: "X", fields: { name: "Y", secretKey: SECRET } }, "fields.name"],
      ["unknown field key", { provider: "chip", name: "X", fields: { secretKey: SECRET, bogus: "1" } }, "fields.bogus"],
    ];
    for (const [label, body, field] of cases) {
      const response = await SELF.fetch(`${ORIGIN}/api/integrations`, {
        method: "POST",
        headers: jsonHeaders(cookie),
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as ErrorEnvelope;
      expect(response.status, label).toBe(422);
      expect(Object.keys(payload.error.fields ?? {}), label).toContain(field);
      expect(JSON.stringify(payload), label).not.toContain(SECRET);
    }

    // --- PATCH: rename, rotate a secret, keep the rest ------------------------
    const rotated = "rotated_key_9999";
    const patched = await SELF.fetch(`${ORIGIN}/api/integrations/${chip.uuid}`, {
      method: "PATCH",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ name: "Renamed Store", fields: { secretKey: rotated } }),
    });
    expect(patched.status).toBe(200);
    const renamed = (await patched.json()) as IntegrationDto;
    expect(renamed.name).toBe("Renamed Store");
    expect(renamed.hints.secretKey).toBe("••••9999");
    expect(JSON.stringify(renamed)).not.toContain(rotated);
    expect(JSON.stringify(renamed)).not.toContain(SECRET);

    const configPatch = await SELF.fetch(`${ORIGIN}/api/integrations/${gtm.uuid}`, {
      method: "PATCH",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ name: "Staging Container" }),
    });
    expect(configPatch.status).toBe(200);
    const gtmRenamed = (await configPatch.json()) as IntegrationDto;
    // Omitted fields are untouched: the config value survives a rename.
    expect(gtmRenamed.settings.containerId).toBe("GTM-ABC123");

    const badPatch = await SELF.fetch(`${ORIGIN}/api/integrations/${chip.uuid}`, {
      method: "PATCH",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ fields: { nope: "1" } }),
    });
    expect(badPatch.status).toBe(422);

    // --- DELETE: hard removal -------------------------------------------------
    const removed = await SELF.fetch(`${ORIGIN}/api/integrations/${chip.uuid}`, {
      method: "DELETE",
      headers: jsonHeaders(cookie),
    });
    expect(removed.status).toBe(204);
    const after = await SELF.fetch(`${ORIGIN}/api/integrations`, { headers: jsonHeaders(cookie) });
    const remaining = ((await after.json()) as { integrations: IntegrationDto[] }).integrations;
    expect(remaining.map((row) => row.uuid)).toEqual([gtm.uuid]);

    const again = await SELF.fetch(`${ORIGIN}/api/integrations/${chip.uuid}`, {
      method: "DELETE",
      headers: jsonHeaders(cookie),
    });
    expect(again.status).toBe(404);

    // --- Billplz: the select field ------------------------------------------
    const validHost = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        provider: "billplz",
        name: "Sandbox Till",
        fields: { host: "billplz-sandbox.com", apiKey: "bplz_key_5566", collectionId: "col_123" },
      }),
    });
    expect(validHost.status).toBe(201);
    const sandbox = (await validHost.json()) as IntegrationDto;
    expect(sandbox.settings).toEqual({ host: "billplz-sandbox.com", collectionId: "col_123" });
    expect(sandbox.hints.apiKey).toBe("••••5566");

    const invalidHost = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        provider: "billplz",
        name: "Bad Host",
        fields: { host: "evil.example.com", apiKey: "bplz_key_5566", collectionId: "col_123" },
      }),
    });
    expect(invalidHost.status).toBe(422);
    const hostError = (await invalidHost.json()) as ErrorEnvelope;
    expect(hostError.error.fields?.["fields.host"]).toContain("billplz.com");
    expect(JSON.stringify(hostError)).not.toContain("bplz_key_5566");

    // PATCH a select to the other allowed value, and refuse an unknown one.
    const flip = await SELF.fetch(`${ORIGIN}/api/integrations/${sandbox.uuid}`, {
      method: "PATCH",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ fields: { host: "billplz.com" } }),
    });
    expect(flip.status).toBe(200);
    expect(((await flip.json()) as IntegrationDto).settings.host).toBe("billplz.com");
    const badFlip = await SELF.fetch(`${ORIGIN}/api/integrations/${sandbox.uuid}`, {
      method: "PATCH",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ fields: { host: "nope.example.com" } }),
    });
    expect(badFlip.status).toBe(422);

    // A BLANK secret is refused: "keep the stored value" is expressed by
    // OMITTING the key (the edit form does exactly that), never by "".
    const blankSecret = await SELF.fetch(`${ORIGIN}/api/integrations/${sandbox.uuid}`, {
      method: "PATCH",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ fields: { apiKey: "" } }),
    });
    expect(blankSecret.status).toBe(422);
    expect(((await blankSecret.json()) as ErrorEnvelope).error.fields?.["fields.apiKey"]).toBeTruthy();

    // --- MyParcel Asia: select + TWO secrets --------------------------------
    const myparcel = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        provider: "myparcel-asia",
        name: "MPA Live",
        fields: {
          host: "app.myparcelasia.com",
          apiKey: "mpa_key_2233",
          apiSecret: "mpa_secret_4455",
        },
      }),
    });
    expect(myparcel.status).toBe(201);
    const mpa = (await myparcel.json()) as IntegrationDto;
    expect(mpa.settings).toEqual({ host: "app.myparcelasia.com" });
    expect(mpa.hints).toEqual({ apiKey: "••••2233", apiSecret: "••••4455" });
    expect(JSON.stringify(mpa)).not.toContain("mpa_secret_4455");

    const badMpaHost = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        provider: "myparcel-asia",
        name: "MPA Bad",
        fields: { host: "mpa.example.com", apiKey: "mpa_key_2233", apiSecret: "mpa_secret_4455" },
      }),
    });
    expect(badMpaHost.status).toBe(422);
    expect(
      ((await badMpaHost.json()) as ErrorEnvelope).error.fields?.["fields.host"],
    ).toContain("demo.myparcelasia.com");

    // --- AWS SES: two secrets + two config values ---------------------------
    const ses = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        provider: "aws-ses",
        name: "SES Production",
        fields: {
          key: "AKIAEXAMPLE7QP2",
          secret: "aws_secret_aabbccdd",
          region: "ap-southeast-1",
          configSet: "receipts",
        },
      }),
    });
    expect(ses.status).toBe(201);
    const row = (await ses.json()) as IntegrationDto;
    expect(row.settings).toEqual({ region: "ap-southeast-1", configSet: "receipts" });
    expect(row.hints).toEqual({ key: "••••7QP2", secret: "••••ccdd" });
    expect(JSON.stringify(row)).not.toContain("aws_secret_aabbccdd");
    expect(JSON.stringify(row)).not.toContain("AKIAEXAMPLE7QP2");

    // Missing config values are refused like any other provider.
    const sesMissing = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        provider: "aws-ses",
        name: "SES Incomplete",
        fields: { key: "AKIAEXAMPLE7QP2", secret: "aws_secret_aabbccdd" },
      }),
    });
    expect(sesMissing.status).toBe(422);
    const sesErrors = ((await sesMissing.json()) as ErrorEnvelope).error.fields ?? {};
    expect(Object.keys(sesErrors)).toEqual(
      expect.arrayContaining(["fields.region", "fields.configSet"]),
    );

    // --- Cloudflare Email: Account ID config + API Token secret --------------
    const cloudflare = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        provider: "cloudflare",
        name: "Email Routing",
        fields: {
          accountId: "cf_acct_9f8e7d",
          apiToken: "cftoken_11223344",
          senderEmail: "no-reply@example.com",
        },
      }),
    });
    expect(cloudflare.status).toBe(201);
    const cf = (await cloudflare.json()) as IntegrationDto;
    expect(cf.settings).toEqual({ accountId: "cf_acct_9f8e7d", senderEmail: "no-reply@example.com" });
    expect(cf.hints).toEqual({ apiToken: "••••3344" });
    expect(JSON.stringify(cf)).not.toContain("cftoken_11223344");

    const cfMissing = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        provider: "cloudflare",
        name: "CF Incomplete",
        fields: { apiToken: "cftoken_11223344" },
      }),
    });
    expect(cfMissing.status).toBe(422);
    expect(
      ((await cfMissing.json()) as ErrorEnvelope).error.fields?.["fields.accountId"],
    ).toContain("Account ID");
  });

  it("test email: route contract (404 / wrong provider / provider refusal)", async () => {
    const cookie = await sharedSession();

    // Unknown row → 404, before any provider logic.
    const missing = await SELF.fetch(`${ORIGIN}/api/integrations/itg-0199f3c2-0000-7000-8000-ffffffffffff/test-email`, {
      method: "POST",
      headers: jsonHeaders(cookie),
    });
    expect(missing.status).toBe(404);

    // Only the Cloudflare Email provider sends for now.
    const chip = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ provider: "chip", name: "Not A Mailer", fields: { secretKey: "sk_live_abcdef12" } }),
    });
    expect(chip.status).toBe(201);
    const chipUuid = (await chip.json()) as { uuid: string };
    const wrongProvider = await SELF.fetch(`${ORIGIN}/api/integrations/${chipUuid.uuid}/test-email`, {
      method: "POST",
      headers: jsonHeaders(cookie),
    });
    expect(wrongProvider.status).toBe(400);
    expect(((await wrongProvider.json()) as ErrorEnvelope).error.code).toBe("wrong_provider");
    await SELF.fetch(`${ORIGIN}/api/integrations/${chipUuid.uuid}`, { method: "DELETE", headers: jsonHeaders(cookie) });

    // Cloudflare row with dummy credentials: Cloudflare refuses the token (or
    // the sandbox can't reach it) — both land on the SAME honest contract:
    // 502 email_send_failed, never echoing the stored secret.
    const cf = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        provider: "cloudflare",
        name: "CF Test Mailer",
        fields: {
          accountId: "0123456789abcdef0123456789abcdef",
          apiToken: "cf_dummy_token_987654",
          senderEmail: "no-reply@example.com",
        },
      }),
    });
    expect(cf.status).toBe(201);
    const cfUuid = (await cf.json()) as { uuid: string };
    const refused = await SELF.fetch(`${ORIGIN}/api/integrations/${cfUuid.uuid}/test-email`, {
      method: "POST",
      headers: jsonHeaders(cookie),
    });
    expect(refused.status).toBe(502);
    const refusalBody = (await refused.json()) as ErrorEnvelope;
    expect(refusalBody.error.code).toBe("email_send_failed");
    expect(JSON.stringify(refusalBody)).not.toContain("cf_dummy_token_987654");

    await SELF.fetch(`${ORIGIN}/api/integrations/${cfUuid.uuid}`, { method: "DELETE", headers: jsonHeaders(cookie) });

    // Gmail: the section's overrides are validated before a socket opens.
    const gmail = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        provider: "gmail",
        name: "Gmail Probe",
        fields: { username: "probe@gmail.com", password: "abcd efgh ijkl mnop" },
      }),
    });
    expect(gmail.status).toBe(201);
    const gmailUuid = (await gmail.json()) as { uuid: string };
    const badRecipient = await SELF.fetch(`${ORIGIN}/api/integrations/${gmailUuid.uuid}/test-email`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ recipient: "not-an-email" }),
    });
    expect(badRecipient.status).toBe(422);
    expect(((await badRecipient.json()) as ErrorEnvelope).error.fields?.recipient).toBeTruthy();
    // A NORMAL Google password (not a 16-char App Password) fails fast with
    // the exact fix — no provider round-trip on a guaranteed 535.
    const normalPassword = await SELF.fetch(`${ORIGIN}/api/integrations`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({
        provider: "gmail",
        name: "Gmail Normal Password",
        fields: { username: "probe@gmail.com", password: "MyNormalGooglePw!99" },
      }),
    });
    expect(normalPassword.status).toBe(201);
    const normalUuid = (await normalPassword.json()) as { uuid: string };
    const fastFail = await SELF.fetch(`${ORIGIN}/api/integrations/${normalUuid.uuid}/test-email`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({}),
    });
    expect(fastFail.status).toBe(400);
    const fastBody = (await fastFail.json()) as ErrorEnvelope;
    expect(fastBody.error.code).toBe("invalid_credentials");
    expect(fastBody.error.message).toContain("App passwords");
    await SELF.fetch(`${ORIGIN}/api/integrations/${normalUuid.uuid}`, { method: "DELETE", headers: jsonHeaders(cookie) });

    const longSubject = await SELF.fetch(`${ORIGIN}/api/integrations/${gmailUuid.uuid}/test-email`, {
      method: "POST",
      headers: jsonHeaders(cookie),
      body: JSON.stringify({ subject: "x".repeat(201) }),
    });
    expect(longSubject.status).toBe(422);
    await SELF.fetch(`${ORIGIN}/api/integrations/${gmailUuid.uuid}`, { method: "DELETE", headers: jsonHeaders(cookie) });

    // Rows saved BEFORE the Sender email field existed: Test Email fails fast
    // with the actionable fix (no network call to Cloudflare at all).
    const legacyUuid = `itg-0199f3c2-0000-7000-8000-0000000000fe`;
    await env.DB.prepare(
      "INSERT INTO integrations (uuid, name, provider, data) VALUES (?1, ?2, ?3, ?4)",
    ).bind(
      legacyUuid,
      "Legacy CF Row",
      "cloudflare",
      JSON.stringify({
        connected: true,
        connectedAt: "2026-11-01 10:00:00",
        settings: { accountId: "0123456789abcdef0123456789abcdef" },
        // Any envelope string: the sender check fires BEFORE decryption.
        secrets: { apiToken: "v1.dummy.dummy" },
        hints: { apiToken: "••••abcd" },
        createdAt: "2026-11-01 10:00:00",
        updatedAt: "2026-11-01 10:00:00",
      }),
    ).run();
    try {
      const noSender = await SELF.fetch(`${ORIGIN}/api/integrations/${legacyUuid}/test-email`, {
        method: "POST",
        headers: jsonHeaders(cookie),
      });
      expect(noSender.status).toBe(400);
      const body = (await noSender.json()) as ErrorEnvelope;
      expect(body.error.code).toBe("missing_sender");
      expect(body.error.message).toContain("Sender email");
    } finally {
      await env.DB.prepare("DELETE FROM integrations WHERE uuid = ?1").bind(legacyUuid).run();
    }
  });
});
