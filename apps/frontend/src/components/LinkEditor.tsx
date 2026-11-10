import { Icon } from "@storesy/ui";
import type { StoreLink } from "@storesy/shared";

interface LinkEditorProps {
  links: StoreLink[];
  onAdd: () => void;
  onUpdate: (id: string, changes: Partial<StoreLink>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  /** Rendered in the header — the editor opens as a dialog from Quick actions. */
  onClose?: () => void;
}

/** Dialog body that edits the Link Tree rows; the phone preview updates as you type. */
export function LinkEditor({ links, onAdd, onUpdate, onRemove, onMove, onClose }: LinkEditorProps) {
  return (
    <section className="ui-card">
      <header className="ui-card__header">
        <h2 className="ui-card__title">Edit links</h2>
        <span className="sf-cardTools">
          <span className="ui-nav__badge">{links.length}</span>
          {onClose ? (
            <button type="button" className="sf-iconBtn" aria-label="Close" onClick={onClose}>
              <Icon name="close" size={14} />
            </button>
          ) : null}
        </span>
      </header>

      <div className="ui-card__body">
        <div className="sf-links">
          {links.length === 0 ? (
            <p className="sf-links__empty">
              No links yet. Add your first one — it appears in the phone preview instantly.
            </p>
          ) : null}

          {links.map((link, index) => (
            <div className="sf-linkRow" key={link.id}>
              <div className="sf-linkRow__fields">
                <label className="sf-linkRow__field">
                  <span>Label</span>
                  <input
                    className="ui-field__input"
                    value={link.label}
                    placeholder="My link"
                    onChange={(event) => onUpdate(link.id, { label: event.target.value })}
                  />
                </label>
                <label className="sf-linkRow__field">
                  <span>URL</span>
                  <input
                    className="ui-field__input"
                    value={link.url}
                    placeholder="https://"
                    inputMode="url"
                    onChange={(event) => onUpdate(link.id, { url: event.target.value })}
                  />
                </label>
              </div>

              <div className="sf-linkRow__controls">
                <button
                  type="button"
                  className="sf-iconBtn"
                  aria-label={`Move "${link.label}" up`}
                  disabled={index === 0}
                  onClick={() => onMove(link.id, -1)}
                >
                  <Icon name="arrowUp" size={14} />
                </button>
                <button
                  type="button"
                  className="sf-iconBtn"
                  aria-label={`Move "${link.label}" down`}
                  disabled={index === links.length - 1}
                  onClick={() => onMove(link.id, 1)}
                >
                  <Icon name="arrowDown" size={14} />
                </button>
                <button
                  type="button"
                  className="sf-iconBtn sf-iconBtn--danger"
                  aria-label={`Remove "${link.label}"`}
                  onClick={() => onRemove(link.id)}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
          ))}

          <button type="button" className="ui-btn ui-btn--secondary sf-links__add" onClick={onAdd}>
            <Icon name="plus" size={15} />
            <span>Add link</span>
          </button>
        </div>
      </div>
    </section>
  );
}
