import type { StoreCode } from "@storesy/shared";

/** Full document handed to the Custom HTML preview iframe / "open in new tab". */
export function composeCodeDocument(code: StoreCode): string {
  const safeJs = code.js.replace(/<\/script/gi, "<\\/script");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${code.css}</style></head><body>${code.html}<script>${safeJs}</script></body></html>`;
}
