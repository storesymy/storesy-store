import { ICON_SETS } from "../lib/setIcons";
import type { IconSetId, SetGlyphName } from "../lib/setIcons";

interface SetIconProps {
  set: IconSetId;
  name: SetGlyphName;
  size?: number;
  className?: string;
}

/** Renders a glyph in the visual language of the page's chosen icon set. */
export function SetIcon({ set, name, size = 14, className }: SetIconProps) {
  const glyphs = ICON_SETS[set] ?? ICON_SETS.lucide;
  const glyph = glyphs[name];
  const stroked = glyph.stroke !== undefined;
  return (
    <svg
      className={className}
      viewBox={glyph.viewBox}
      width={size}
      height={size}
      fill={stroked ? "none" : "currentColor"}
      stroke={stroked ? "currentColor" : "none"}
      strokeWidth={glyph.stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      fillRule={glyph.fillRule}
      aria-hidden="true"
      focusable="false"
    >
      {glyph.paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
