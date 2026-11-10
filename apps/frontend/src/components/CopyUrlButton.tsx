import { Icon } from "@storesy/ui";
import { useState } from "react";

/**
 * "Copy" chip beside the chrome URL — copies the page's absolute URL to
 * the clipboard (the same destination the URL link opens) and flashes
 * "Copied" with a check so the click visibly did something.
 */
export function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    const absolute = new URL(url, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(absolute);
    } catch {
      // Clipboard API blocked (permission/insecure context) — the old
      // textarea + execCommand trick still works everywhere that matters.
      const area = document.createElement("textarea");
      area.value = absolute;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
      } catch {
        // Nothing else to try — the button at least doesn't break the page.
      }
      area.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button type="button" className="sf-frame__copy" onClick={() => void copy()}>
      <Icon name={copied ? "check" : "copy"} size={12} />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
