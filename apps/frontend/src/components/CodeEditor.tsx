import { Icon } from "@storesy/ui";
import type { StoreCode } from "@storesy/shared";
import { useEffect, useState } from "react";
import type { CodeFile } from "../lib/useStorefront";
import { composeCodeDocument } from "../lib/codeDocument";

const FILES: { id: CodeFile; label: string }[] = [
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "js", label: "JS" },
];

interface CodeEditorProps {
  code: StoreCode;
  /** Active file — lifted so the page's "Copy code" action copies what you see. */
  file: CodeFile;
  onFileChange: (file: CodeFile) => void;
  onCodeChange: (file: CodeFile, value: string) => void;
}

export function CodeEditor({ code, file, onFileChange, onCodeChange }: CodeEditorProps) {
  const [doc, setDoc] = useState(() => composeCodeDocument(code));

  // Debounced so typing stays smooth and scripts only re-run when you pause.
  useEffect(() => {
    const timer = window.setTimeout(() => setDoc(composeCodeDocument(code)), 300);
    return () => window.clearTimeout(timer);
  }, [code]);

  return (
    <div className="sf-code">
      <div className="sf-code__editor">
        <div className="sf-code__tabs" role="tablist" aria-label="Code file">
          {FILES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`sf-file-${entry.id}`}
              aria-selected={file === entry.id}
              aria-controls="sf-code-pane"
              className={
                file === entry.id ? "sf-code__tab sf-code__tab--active" : "sf-code__tab"
              }
              onClick={() => onFileChange(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <textarea
          id="sf-code-pane"
          role="tabpanel"
          aria-labelledby={`sf-file-${file}`}
          className="sf-code__area"
          value={code[file]}
          spellCheck={false}
          aria-label={`${file.toUpperCase()} source`}
          onChange={(event) => onCodeChange(file, event.target.value)}
        />
      </div>

      <div className="sf-code__preview">
        <div className="sf-code__previewBar">
          <span className="sf-code__live">Live preview</span>
          <span>sandboxed</span>
        </div>
        {/* Scripts allowed, same-origin blocked: authored JS can run but not touch the app. */}
        <iframe className="sf-code__frame" title="Live preview" srcDoc={doc} sandbox="allow-scripts" />
      </div>
    </div>
  );
}
