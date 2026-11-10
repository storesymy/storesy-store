import { usePublishedSnapshot } from "../lib/publishedStore";

/**
 * Public storefront at `/` — serves the static document frozen when the
 * merchant clicked Publish. Unpublished (never published, or unpublished)
 * always shows the Coming Soon view: one dead-center headline, no header,
 * no footer — the same frame a published Coming Soon store serves. Draft
 * edits never reach this page; only another Publish rewrites what visitors
 * see.
 */
export function StorePage() {
  const snapshot = usePublishedSnapshot();

  if (!snapshot) {
    return (
      <main className="pv">
        <div className="soonC">
          <h1 className="soonC__title">Coming Soon</h1>
        </div>
      </main>
    );
  }

  if (snapshot.type === "custom-html") {
    return (
      <main className="pv pv--code">
        <iframe
          className="pv__frame"
          title="Store"
          srcDoc={snapshot.html}
          sandbox="allow-scripts"
        />
      </main>
    );
  }

  return <main className="pv" dangerouslySetInnerHTML={{ __html: snapshot.html }} />;
}
