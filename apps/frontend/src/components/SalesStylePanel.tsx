import { useState } from "react";
import type { ChangeEvent } from "react";
import { FontPickerModal } from "./FontPickerModal";
import { SetIcon } from "./SetIcon";
import {
  DEFAULT_FONT_GROUPS,
  DEFAULT_FONTS,
  ensureGoogleFont,
  fontLabel,
} from "../lib/googleFonts";
import { ICON_SET_LIST } from "../lib/setIcons";
import {
  SIZE_STOPS,
  THEME_PRESETS,
  WRAP_MAX,
  WRAP_MIN,
  clampWrapWidth,
  defaultStyle,
  themeMatches,
} from "../lib/salesPages";
import type { SalesPageStyle, SizeStop, WidthMode } from "../lib/salesPages";

interface Props {
  style: SalesPageStyle;
  onPatch: (patch: Partial<SalesPageStyle>) => void;
}

type FontField = "fontHead" | "fontBody";

/** Sentinel option that opens the Google Fonts browser. */
const MORE_FONTS = "__more__";

function StopSlider({
  id,
  label,
  value,
  stops,
  onChange,
}: {
  id: string;
  label: string;
  value: SizeStop;
  stops: SizeStop[];
  onChange: (stop: SizeStop) => void;
}) {
  const index = Math.max(0, stops.indexOf(value));
  return (
    <>
      <div className="sp__sliderRow">
        <label htmlFor={id}>{label}</label>
        <span className="sp__sliderValue">{value}</span>
      </div>
      <input
        id={id}
        className="sp__range"
        type="range"
        min={0}
        max={stops.length - 1}
        step={1}
        value={index}
        onChange={(event) => {
          const next = stops[Number(event.target.value)];
          if (next) onChange(next);
        }}
      />
    </>
  );
}

/**
 * Segmented Full/Fixed width toggle plus the fixed-mode px field. The px input
 * keeps a local draft so typing "12" isn't clamped to 320 mid-keystroke; the
 * value commits (clamped) on blur or Enter.
 */
function WidthControl({ style, onPatch }: Props) {
  const [draft, setDraft] = useState(String(style.wrapWidth));
  const commit = () => {
    const parsed = Number.parseInt(draft, 10);
    const next = Number.isFinite(parsed) ? clampWrapWidth(parsed) : style.wrapWidth;
    setDraft(String(next));
    if (next !== style.wrapWidth) onPatch({ wrapWidth: next });
  };
  return (
    <>
      <div className="sp__sliderRow">
        <span className="sp__colorLabel">Content width</span>
      </div>
      <div className="sp__segRow">
        {(["full", "fixed"] as WidthMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            className={
              style.width === mode ? "sp__segBtn sp__segBtn--active" : "sp__segBtn"
            }
            aria-pressed={style.width === mode}
            onClick={() => onPatch({ width: mode })}
          >
            {mode === "full" ? "Full Width" : "Fixed Width"}
          </button>
        ))}
      </div>
      {style.width === "fixed" ? (
        <div className="sp__segRow">
          <input
            className="sp__widthInput"
            type="number"
            min={WRAP_MIN}
            max={WRAP_MAX}
            step={10}
            value={draft}
            aria-label="Fixed content width in pixels"
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commit();
                event.currentTarget.blur();
              }
            }}
          />
          <span className="sp__widthUnit">px</span>
        </div>
      ) : null}
    </>
  );
}

/**
 * The editor's Style tab — full-look themes (colors + fonts + size + spacing +
 * corners, with the color rows as manual overrides), Google Fonts, font size,
 * whitespace and the icon set. Every control writes into the page's `style`
 * document, which the canvas turns into scoped CSS variables, so changes
 * preview live.
 */
export function SalesStylePanel({ style, onPatch }: Props) {
  const [picker, setPicker] = useState<FontField | null>(null);

  const color = (key: "accent" | "background" | "text") => ({
    value: style[key],
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      onPatch({ [key]: event.target.value.toUpperCase() } as Partial<SalesPageStyle>),
  });

  /** Font select: the nine defaults, this page's pick, then More Fonts…. */
  const fontSelect = (field: FontField) => {
    const current = style[field];
    const custom = DEFAULT_FONTS.includes(current) ? null : current;
    return (
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`sp-${field}`}>
          {field === "fontHead" ? "Headings" : "Body"}
        </label>
        <select
          id={`sp-${field}`}
          className="sf-select"
          value={current}
          onChange={(event) => {
            const next = event.target.value;
            if (next === MORE_FONTS) {
              // Keep the select on its real value — the modal does the picking.
              event.target.value = current;
              setPicker(field);
              return;
            }
            ensureGoogleFont(next);
            onPatch({ [field]: next } as Partial<SalesPageStyle>);
          }}
        >
          {custom !== null ? <option value={custom}>{fontLabel(custom)}</option> : null}
          {DEFAULT_FONT_GROUPS.map((group) => (
            <optgroup key={group.category} label={group.label}>
              {group.families.map((family) => (
                <option key={family} value={family}>
                  {family}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={MORE_FONTS}>More Fonts…</option>
        </select>
      </div>
    );
  };

  return (
    <div className="sp__panel" role="tabpanel" aria-label="Style">
      <div className="sp__group">
        <span className="sp__groupTitle">Theme</span>
        <div className="sp__themeRow">
          {THEME_PRESETS.map((preset) => {
            const owned = preset.style;
            const active = themeMatches(style, preset);
            const corners = Math.round(owned.radiusScale * 8);
            const fonts =
              owned.fontHead === owned.fontBody
                ? owned.fontHead
                : `${owned.fontHead} + ${owned.fontBody}`;
            return (
              <button
                key={preset.id}
                type="button"
                title={`${preset.label} — ${fonts} · ${owned.fontSize} text · ${owned.whitespace} space · ${corners}px corners`}
                className={active ? "sp__themeChip sp__themeChip--active" : "sp__themeChip"}
                onClick={() => onPatch({ ...owned })}
              >
                <span className="sp__themeDot" style={{ background: owned.accent }} aria-hidden="true" />
                {preset.label}
              </button>
            );
          })}
        </div>
        <WidthControl style={style} onPatch={onPatch} />
        <div className="sp__colorRow">
          <span className="sp__colorLabel">Accent</span>
          <input className="sp__color" type="color" aria-label="Accent color" {...color("accent")} />
          <code className="sp__hex">{style.accent}</code>
        </div>
        <div className="sp__colorRow">
          <span className="sp__colorLabel">Background</span>
          <input
            className="sp__color"
            type="color"
            aria-label="Background color"
            {...color("background")}
          />
          <code className="sp__hex">{style.background}</code>
        </div>
        <div className="sp__colorRow">
          <span className="sp__colorLabel">Text</span>
          <input className="sp__color" type="color" aria-label="Text color" {...color("text")} />
          <code className="sp__hex">{style.text}</code>
        </div>
      </div>

      <div className="sp__group">
        <span className="sp__groupTitle">Typography</span>
        {fontSelect("fontHead")}
        {fontSelect("fontBody")}
        <StopSlider
          id="sp-fs"
          label="Font Size"
          value={style.fontSize}
          stops={SIZE_STOPS}
          onChange={(stop) => onPatch({ fontSize: stop })}
        />
      </div>

      <div className="sp__group">
        <span className="sp__groupTitle">Size &amp; whitespace</span>
        <StopSlider
          id="sp-space"
          label="Whitespace"
          value={style.whitespace}
          stops={SIZE_STOPS}
          onChange={(stop) => onPatch({ whitespace: stop })}
        />
        <div className="sp__sliderRow">
          <label htmlFor="sp-radius">Corner radius</label>
          <span className="sp__sliderValue">{Math.round(style.radiusScale * 8)}px</span>
        </div>
        <input
          id="sp-radius"
          className="sp__range"
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={style.radiusScale}
          onChange={(event) => onPatch({ radiusScale: Number(event.target.value) })}
        />
      </div>

      <div className="sp__group">
        <span className="sp__groupTitle">Icon set</span>
        <div className="sp__iconRow" role="radiogroup" aria-label="Icon set">
          {ICON_SET_LIST.map((set) => {
            const active = style.iconSet === set.id;
            return (
              <button
                key={set.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={active ? "sp__iconChip sp__iconChip--active" : "sp__iconChip"}
                onClick={() => onPatch({ iconSet: set.id })}
              >
                <SetIcon set={set.id} name="check" size={15} />
                {set.label}
              </button>
            );
          })}
        </div>
        <p className="sp__note">
          Feature checks and FAQ chevrons on the page use this set.
        </p>
      </div>

      <button type="button" className="pd__clear" onClick={() => onPatch(defaultStyle())}>
        Reset style to defaults
      </button>

      {picker !== null ? (
        <FontPickerModal
          current={style[picker]}
          onPick={(family) => {
            ensureGoogleFont(family);
            onPatch({ [picker]: family } as Partial<SalesPageStyle>);
            setPicker(null);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </div>
  );
}
