export interface PagerProps {
  /** 1-based current page. */
  page: number;
  pageCount: number;
  /** First row index shown (1-based), 0 when there is nothing to show. */
  from: number;
  /** Last row index shown. */
  to: number;
  /** Total rows across all pages. */
  total: number;
  onPageChange: (page: number) => void;
  /** aria-label for the page-button group. */
  label?: string;
  /** Noun used in the default aria-label, e.g. "products". */
  noun?: string;
}

/** 1 … c-1 c c+1 … n — keeps the pager compact as the list grows. */
function pageList(current: number, total: number): Array<number | "gap"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const wanted = [1, total, current - 1, current, current + 1].filter(
    (page) => page >= 1 && page <= total,
  );
  const pages = [...new Set(wanted)].sort((a, b) => a - b);
  const out: Array<number | "gap"> = [];
  let prev = 0;
  for (const entry of pages) {
    if (entry - prev > 1) out.push("gap");
    out.push(entry);
    prev = entry;
  }
  return out;
}

/** "Showing x–y of z" + prev / numbered pages / next. */
export function Pager({
  page,
  pageCount,
  from,
  to,
  total,
  onPageChange,
  label,
  noun = "pages",
}: PagerProps) {
  return (
    <div className="ui-pager">
      <span className="ui-pager__showing">
        Showing {from}–{to} of {total}
      </span>
      <nav className="ui-pager__pages" aria-label={label ?? `${noun} pages`}>
        <button
          type="button"
          className="ui-pager__page"
          disabled={page <= 1}
          aria-label="Previous page"
          onClick={() => onPageChange(page - 1)}
        >
          ‹
        </button>
        {pageList(page, pageCount).map((entry) =>
          entry === "gap" ? (
            <span key="gap" className="ui-pager__page ui-pager__page--gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={entry}
              type="button"
              className={
                entry === page ? "ui-pager__page ui-pager__page--active" : "ui-pager__page"
              }
              aria-current={entry === page ? "page" : undefined}
              onClick={() => onPageChange(entry)}
            >
              {entry}
            </button>
          ),
        )}
        <button
          type="button"
          className="ui-pager__page"
          disabled={page >= pageCount}
          aria-label="Next page"
          onClick={() => onPageChange(page + 1)}
        >
          ›
        </button>
      </nav>
    </div>
  );
}
