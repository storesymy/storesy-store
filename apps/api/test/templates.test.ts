import { DEFAULT_EMAIL_TEMPLATES } from "@storesy/shared";
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * /api/templates — the Email Templates gallery and its edit dialog. Reads seed
 * the built-in thank-you template; writes validate placeholders so a typo can
 * never reach a buyer as literal braces.
 */

const ORIGIN = "http://example.com";
let cookie: string;

async function signup(): Promise<string> {
  const response = await SELF.fetch(`${ORIGIN}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Templates Tester",
      email: `templates-${crypto.randomUUID()}@example.com`,
      password: "correct horse battery",
    }),
  });
  expect(response.status).toBe(201);
  return (response.headers.get("set-cookie") as string).split(";")[0] as string;
}

const jsonHeaders = () => ({ "Content-Type": "application/json", Cookie: cookie });

beforeAll(async () => {
  cookie = await signup();
});

describe("email templates API", () => {
  it("rejects signed-out reads", async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/templates`)).status).toBe(401);
  });

  it("seeds and returns the thank-you card with its live text", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/templates`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      templates: {
        id: string;
        key: string;
        name: string;
        subject: string;
        body: string;
        placeholders: { token: string; description: string }[];
      }[];
    };
    expect(body.templates).toHaveLength(1);
    const template = body.templates[0];
    expect(template?.id).toMatch(/^tpl-[0-9a-f-]{36}$/);
    expect(template?.key).toBe("thank-you");
    expect(template?.name).toBe("Thank You Email");
    expect(template?.subject).toBe(DEFAULT_EMAIL_TEMPLATES[0]?.subject);
    expect(template?.body).toContain("{firstName}");
    expect(template?.body).toContain("{items}");
    expect(template?.placeholders.some((item) => item.token === "{downloads}")).toBe(true);
  });

  it("saves the merchant's subject and message, trimming the edges", async () => {
    const list = (await (
      await SELF.fetch(`${ORIGIN}/api/templates`, { headers: { Cookie: cookie } })
    ).json()) as { templates: { id: string }[] };
    const id = list.templates[0]?.id as string;

    const saved = await SELF.fetch(`${ORIGIN}/api/templates/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({
        subject: "  Your {pageName} receipt ({orderNo})  ",
        body: "  Hi {firstName},\n\nThanks for {total}.\n\n{items}\n\n{downloads}  ",
      }),
    });
    expect(saved.status).toBe(200);
    const template = (await saved.json()) as { subject: string; body: string };
    expect(template.subject).toBe("Your {pageName} receipt ({orderNo})");
    expect(template.body).toBe("Hi {firstName},\n\nThanks for {total}.\n\n{items}\n\n{downloads}");

    const reread = (await (
      await SELF.fetch(`${ORIGIN}/api/templates`, { headers: { Cookie: cookie } })
    ).json()) as { templates: { subject: string; body: string }[] };
    expect(reread.templates[0]?.subject).toBe(template.subject);
    expect(reread.templates[0]?.body).toBe(template.body);

    // Put the built-in wording back for the other suites.
    const restored = await SELF.fetch(`${ORIGIN}/api/templates/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify(DEFAULT_EMAIL_TEMPLATES[0]),
    });
    expect(restored.status).toBe(200);
  });

  it("refuses an unknown placeholder and an empty field", async () => {
    const list = (await (
      await SELF.fetch(`${ORIGIN}/api/templates`, { headers: { Cookie: cookie } })
    ).json()) as { templates: { id: string }[] };
    const id = list.templates[0]?.id as string;

    const unknown = await SELF.fetch(`${ORIGIN}/api/templates/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ subject: "Hello", body: "Hi {buyerFirstName}, {nope}" }),
    });
    expect(unknown.status).toBe(422);
    const unknownBody = (await unknown.json()) as {
      error: { message: string; fields?: Record<string, string> };
    };
    expect(unknownBody.error.fields?.body).toContain("{buyerFirstName}");
    expect(unknownBody.error.fields?.body).toContain("{nope}");

    const empty = await SELF.fetch(`${ORIGIN}/api/templates/${id}`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ subject: "   ", body: "" }),
    });
    expect(empty.status).toBe(422);
  });

  it("404s an unknown template id", async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/templates/tpl-01a1a1a1-0000-7000-8000-000000000000`, {
      method: "PATCH",
      headers: jsonHeaders(),
      body: JSON.stringify({ subject: "Hello", body: "Hi" }),
    });
    expect(response.status).toBe(404);
  });
});
