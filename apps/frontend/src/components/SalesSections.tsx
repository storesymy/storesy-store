import { Icon } from "@storesy/ui";
import { useContext, useEffect, useState } from "react";
import { EditingContext, Editable, StaticContext } from "./Editable";
import { MediaSlot } from "./MediaSlot";
import { SetIcon } from "./SetIcon";
import { IMAGE_PLACEHOLDERS, SECTION_IMAGE_MAX } from "../lib/salesPages";
import type { IconSetId } from "../lib/setIcons";
import type { SalesSection, SalesSectionItem } from "../lib/salesPages";

interface SectionContentProps {
  section: SalesSection;
  /** Icon library the page's feature checks and FAQ chevrons come from. */
  iconSet: IconSetId;
  onChange: (patch: Partial<SalesSection>) => void;
  onRemoveItem: (index: number) => void;
}

/** Small ✕ on a row — only while editing, and only while section is selected. */
function RowRemove({ disabled, onRemove }: { disabled: boolean; onRemove: () => void }) {
  const editable = useContext(EditingContext);
  if (!editable) return null;
  return (
    <button
      type="button"
      className="ssv__itemRemove"
      aria-label="Remove row"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onRemove();
      }}
    >
      <Icon name="close" size={11} />
    </button>
  );
}

/** Live DD:HH:MM:SS — ticks once a second, isolated to this subtree. */
function Countdown({ target }: { target: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const end = Date.parse(target);
  const diff = Number.isFinite(end) ? Math.max(0, end - now) : 0;
  const cells: Array<[string, number]> = [
    ["Days", Math.floor(diff / 86_400_000)],
    ["Hours", Math.floor(diff / 3_600_000) % 24],
    ["Mins", Math.floor(diff / 60_000) % 60],
    ["Secs", Math.floor(diff / 1000) % 60],
  ];

  return (
    <div className="ssv__clock" aria-hidden="true">
      {cells.map(([label, value]) => (
        <span className="ssv__cell" key={label}>
          <span className="ssv__num">{String(value).padStart(2, "0")}</span>
          <span className="ssv__unit">{label}</span>
        </span>
      ))}
    </div>
  );
}

export function SectionContent({
  section,
  iconSet,
  onChange,
  onRemoveItem,
}: SectionContentProps) {
  const { title, subtitle, buttonLabel, items, images } = section;
  const editable = useContext(EditingContext);

  function setItem(index: number, field: "text" | "detail", next: string) {
    const nextItems = items.map((item: SalesSectionItem, i) => {
      if (i !== index) return item;
      return field === "text" ? { ...item, text: next } : { ...item, detail: next };
    });
    onChange({ items: nextItems });
  }

  /** Next preset id for an appended slide/tile — cycles the palette. */
  function presetAt(count: number): string {
    return `ph:${IMAGE_PLACEHOLDERS[count % IMAGE_PLACEHOLDERS.length]!.id}`;
  }

  switch (section.type) {
    case "hero":
      return (
        <section className="sfv__spHero">
          <div className="ssv__wrap">
            <span className="sfv__chip">Limited release</span>
            <h2>
              <Editable
                value={title}
                onChange={(next) => onChange({ title: next })}
                ariaLabel="Hero headline"
                placeholder="Your headline"
              />
            </h2>
            <p>
              <Editable
                value={subtitle}
                onChange={(next) => onChange({ subtitle: next })}
                ariaLabel="Hero subline"
                placeholder="One line about the offer"
              />
            </p>
            <span className="sfv__btn sfv__btn--lg">
              <Editable
                value={buttonLabel}
                onChange={(next) => onChange({ buttonLabel: next })}
                ariaLabel="Button label"
                placeholder="Button label"
              />
            </span>
          </div>
        </section>
      );

    case "biglist":
      return (
        <section className="ssv__block">
          <div className="ssv__wrap">
            <h3 className="ssv__title">
              <Editable
                value={title}
                onChange={(next) => onChange({ title: next })}
                ariaLabel="List title"
                placeholder="List title"
              />
            </h3>
            <ol className="ssv__list">
              {items.map((item, index) => (
                <li className="ssv__li" key={item.id}>
                  <span className="ssv__bullet" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="ssv__liText">
                    <Editable
                      value={item.text}
                      onChange={(next) => setItem(index, "text", next)}
                      ariaLabel={`List row ${index + 1}`}
                      placeholder="List row"
                    />
                  </span>
                  <RowRemove
                    disabled={items.length <= 1}
                    onRemove={() => onRemoveItem(index)}
                  />
                </li>
              ))}
            </ol>
          </div>
        </section>
      );

    case "countdown":
      return (
        <section className="ssv__countdown">
          <div className="ssv__wrap">
            <h3 className="ssv__title ssv__title--dark">
              <Editable
                value={title}
                onChange={(next) => onChange({ title: next })}
                ariaLabel="Countdown title"
                placeholder="Offer ends in"
              />
            </h3>
            <Countdown target={section.target} />
            <p className="ssv__countNote">Limited stock at this price — first come, first served.</p>
          </div>
        </section>
      );

    case "cta":
      return (
        <section className="ssv__cta">
          <div className="ssv__wrap ssv__ctaRow">
            <div className="ssv__ctaText">
              <h3>
                <Editable
                  value={title}
                  onChange={(next) => onChange({ title: next })}
                  ariaLabel="CTA title"
                  placeholder="Call to action"
                />
              </h3>
              <p>
                <Editable
                  value={subtitle}
                  onChange={(next) => onChange({ subtitle: next })}
                  ariaLabel="CTA text"
                  placeholder="Supporting line"
                />
              </p>
            </div>
            <span className="sfv__btn sfv__btn--lg ssv__ctaBtn">
              <Editable
                value={buttonLabel}
                onChange={(next) => onChange({ buttonLabel: next })}
                ariaLabel="CTA button label"
                placeholder="Button label"
              />
            </span>
          </div>
        </section>
      );

    case "features":
      return (
        <section className="ssv__block">
          <div className="ssv__wrap">
            <h3 className="ssv__title">
              <Editable
                value={title}
                onChange={(next) => onChange({ title: next })}
                ariaLabel="Features title"
                placeholder="Features title"
              />
            </h3>
            <div className="ssv__features">
              {items.map((item, index) => (
                <div className="sfv__benefit" key={item.id}>
                  <span className="sfv__benefitDot" aria-hidden="true">
                    <SetIcon set={iconSet} name="check" size={14} />
                  </span>
                  <h4>
                    <Editable
                      value={item.text}
                      onChange={(next) => setItem(index, "text", next)}
                      ariaLabel={`Feature ${index + 1} title`}
                      placeholder="Feature"
                    />
                  </h4>
                  <p>
                    <Editable
                      value={item.detail}
                      onChange={(next) => setItem(index, "detail", next)}
                      ariaLabel={`Feature ${index + 1} detail`}
                      placeholder="One line about it"
                    />
                  </p>
                  <RowRemove disabled={items.length <= 1} onRemove={() => onRemoveItem(index)} />
                </div>
              ))}
            </div>
          </div>
        </section>
      );

    case "testimonial":
      return (
        <blockquote className="sfv__quote">
          <div className="ssv__wrap">
            <Editable
              value={title}
              onChange={(next) => onChange({ title: next })}
              ariaLabel="Quote"
              placeholder="Customer quote"
            />
            <cite>
              <Editable
                value={subtitle}
                onChange={(next) => onChange({ subtitle: next })}
                ariaLabel="Quote attribution"
                placeholder="Name · verified buyer"
              />
            </cite>
          </div>
        </blockquote>
      );

    case "faq":
      return (
        <FaqSection
          section={section}
          iconSet={iconSet}
          onChange={onChange}
          onRemoveItem={onRemoveItem}
        />
      );

    case "footer":
      return (
        <footer className="sfv__footer">
          <div className="ssv__wrap">
            <Editable
              value={title}
              onChange={(next) => onChange({ title: next })}
              ariaLabel="Footer brand"
              placeholder="Brand"
            />
            <span aria-hidden="true"> · </span>
            <Editable
              value={subtitle}
              onChange={(next) => onChange({ subtitle: next })}
              ariaLabel="Footer copyright"
              placeholder="© 2026"
            />
          </div>
        </footer>
      );

    case "featured-image":
      return (
        <section className="ssv__block">
          <div className="ssv__wrap">
            <h3 className="ssv__title">
              <Editable
                value={title}
                onChange={(next) => onChange({ title: next })}
                ariaLabel="Image section title"
                placeholder="Section title"
              />
            </h3>
            <MediaSlot
              className="ssv__media ssv__media--wide"
              src={images[0] ?? "ph:dune"}
              alt={title}
              onChange={(next) => onChange({ images: [next] })}
            />
            <p className="ssv__mediaCaption">
              <Editable
                value={subtitle}
                onChange={(next) => onChange({ subtitle: next })}
                ariaLabel="Image caption"
                placeholder="Caption"
              />
            </p>
          </div>
        </section>
      );

    case "carousel":
      return <CarouselSection section={section} onChange={onChange} />;

    case "image-info":
      return (
        <section className="ssv__block">
          <div className="ssv__wrap ssv__split">
            <MediaSlot
              className="ssv__media ssv__media--split"
              src={images[0] ?? "ph:plum"}
              alt={title}
              onChange={(next) => onChange({ images: [next] })}
            />
            <div className="ssv__splitText">
            <h3 className="ssv__title">
              <Editable
                value={title}
                onChange={(next) => onChange({ title: next })}
                ariaLabel="Info title"
                placeholder="Info title"
              />
            </h3>
            <p className="ssv__splitSub">
              <Editable
                value={subtitle}
                onChange={(next) => onChange({ subtitle: next })}
                ariaLabel="Info text"
                placeholder="One line about it"
              />
            </p>
            <ul className="ssv__infoList">
              {items.map((item, index) => (
                <li className="ssv__infoRow" key={item.id}>
                  <span className="ssv__infoDot" aria-hidden="true">
                    <SetIcon set={iconSet} name="check" size={11} />
                  </span>
                  <span className="ssv__infoText">
                    <Editable
                      value={item.text}
                      onChange={(next) => setItem(index, "text", next)}
                      ariaLabel={`Info row ${index + 1}`}
                      placeholder="Label"
                    />
                  </span>
                  <span className="ssv__infoValue">
                    <Editable
                      value={item.detail}
                      onChange={(next) => setItem(index, "detail", next)}
                      ariaLabel={`Info value ${index + 1}`}
                      placeholder="Value"
                    />
                  </span>
                  <RowRemove
                    disabled={items.length <= 1}
                    onRemove={() => onRemoveItem(index)}
                  />
                </li>
              ))}
            </ul>
            </div>
          </div>
        </section>
      );

    case "gallery":
      return (
        <section className="ssv__block">
          <div className="ssv__wrap">
            <h3 className="ssv__title">
              <Editable
                value={title}
                onChange={(next) => onChange({ title: next })}
                ariaLabel="Gallery title"
                placeholder="Gallery title"
              />
            </h3>
            <div className="ssv__gallery">
              {images.map((src, index) => (
                <div className="ssv__galTile" key={`${index}-${src}`}>
                  <MediaSlot
                    className="ssv__media ssv__media--square"
                    src={src}
                    alt={`${title} ${index + 1}`}
                    onChange={(next) =>
                      onChange({
                        images: images.map((entry, i) => (i === index ? next : entry)),
                      })
                    }
                  />
                  {images.length > 1 && editable ? (
                    <button
                      type="button"
                      className="ssv__galRemove"
                      aria-label="Remove image"
                      onClick={(event) => {
                        event.stopPropagation();
                        onChange({ images: images.filter((_, i) => i !== index) });
                      }}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  ) : null}
                </div>
              ))}
              {images.length < SECTION_IMAGE_MAX && editable ? (
                <button
                  type="button"
                  className="ssv__galAdd"
                  aria-label="Add image"
                  onClick={() => onChange({ images: [...images, presetAt(images.length)] })}
                >
                  <Icon name="plus" size={15} />
                  Add image
                </button>
              ) : null}
            </div>
          </div>
        </section>
      );

    case "image-text":
      return (
        <section className="ssv__block">
          <div className="ssv__wrap ssv__split">
            <div className="ssv__splitText">
              <h3 className="ssv__title">
                <Editable
                  value={title}
                  onChange={(next) => onChange({ title: next })}
                  ariaLabel="Split title"
                  placeholder="Section title"
                />
              </h3>
              <p className="ssv__splitSub">
                <Editable
                  value={subtitle}
                  onChange={(next) => onChange({ subtitle: next })}
                  ariaLabel="Split text"
                  placeholder="A line about the image"
                />
              </p>
              <span className="sfv__btn ssv__splitBtn">
                <Editable
                  value={buttonLabel}
                  onChange={(next) => onChange({ buttonLabel: next })}
                  ariaLabel="Button label"
                  placeholder="Button label"
                />
              </span>
            </div>
            <MediaSlot
              className="ssv__media ssv__media--split"
              src={images[0] ?? "ph:slate"}
              alt={title}
              onChange={(next) => onChange({ images: [next] })}
            />
          </div>
        </section>
      );
  }
}

/** FAQ rows live apart so the open-row state is a normal top-level hook. */
function FaqSection({ section, iconSet, onChange, onRemoveItem }: SectionContentProps) {
  const [open, setOpen] = useState(-1);
  // The stored public document has no scripts: every answer renders in the
  // open state (visible to readers, present for crawlers).
  const isStatic = useContext(StaticContext);
  const { title, items } = section;

  function setItem(index: number, field: "text" | "detail", next: string) {
    const nextItems = items.map((item: SalesSectionItem, i) => {
      if (i !== index) return item;
      return field === "text" ? { ...item, text: next } : { ...item, detail: next };
    });
    onChange({ items: nextItems });
  }

  return (
    <section className="ssv__block">
      <div className="ssv__wrap">
        <h3 className="ssv__title">
          <Editable
            value={title}
            onChange={(next) => onChange({ title: next })}
            ariaLabel="FAQ title"
            placeholder="FAQ title"
          />
        </h3>
        <div className="ssv__faqList">
        {items.map((item, index) => (
          <div
            className={
              isStatic || open === index ? "ssv__faqRow ssv__faqRow--open" : "ssv__faqRow"
            }
            key={item.id}
          >
            <div className="ssv__faqHead">
              <span className="ssv__faqQ">
                <Editable
                  value={item.text}
                  onChange={(next) => setItem(index, "text", next)}
                  ariaLabel={`Question ${index + 1}`}
                  placeholder="Question"
                />
              </span>
              {isStatic ? null : (
                <button
                  type="button"
                  className="ssv__faqToggle"
                  aria-label={open === index ? "Collapse answer" : "Expand answer"}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(open === index ? -1 : index);
                  }}
                >
                  <SetIcon set={iconSet} name="chevron" size={15} />
                </button>
              )}
              <RowRemove disabled={items.length <= 1} onRemove={() => onRemoveItem(index)} />
            </div>
            {isStatic || open === index ? (
              <p className="ssv__faqA">
                <Editable
                  value={item.detail}
                  onChange={(next) => setItem(index, "detail", next)}
                  ariaLabel={`Answer ${index + 1}`}
                  placeholder="The answer"
                />
              </p>
            ) : null}
          </div>
        ))}
        </div>
      </div>
    </section>
  );
}

/** Slides + arrows + dots live apart so the shown-slide state is a hook. */
function CarouselSection({
  section,
  onChange,
}: Pick<SectionContentProps, "section" | "onChange">) {
  const [slide, setSlide] = useState(0);
  const editable = useContext(EditingContext);
  // The stored public document has no scripts: arrows and dots can't work
  // there, so every slide renders stacked — all content visible and crawlable.
  const isStatic = useContext(StaticContext);
  const { title, subtitle, images } = section;
  const count = Math.max(1, images.length);
  const index = Math.min(Math.max(0, slide), count - 1);

  return (
    <section className="ssv__block">
      <div className="ssv__wrap">
        <h3 className="ssv__title">
          <Editable
            value={title}
            onChange={(next) => onChange({ title: next })}
            ariaLabel="Carousel title"
            placeholder="Carousel title"
          />
        </h3>
        {isStatic ? (
          <div className="ssv__carousel ssv__carousel--static">
            {(images.length > 0 ? images : ["ph:tide"]).map((src, i) => (
              <MediaSlot
                key={i}
                className="ssv__media ssv__media--wide"
                src={src}
                alt={`${title} — slide ${i + 1}`}
                onChange={() => {
                  /* Static serialization — never edited here. */
                }}
              />
            ))}
          </div>
        ) : (
          <>
        <div className="ssv__carousel">
        <button
          type="button"
          className="ssv__carouselNav ssv__carouselNav--prev"
          aria-label="Previous slide"
          onClick={(event) => {
            event.stopPropagation();
            setSlide((index - 1 + count) % count);
          }}
        >
          <Icon name="arrowLeft" size={14} />
        </button>
        <MediaSlot
          className="ssv__media ssv__media--wide"
          src={images[index] ?? "ph:tide"}
          alt={`${title} — slide ${index + 1}`}
          onChange={(next) =>
            onChange({ images: images.map((src, i) => (i === index ? next : src)) })
          }
        />
        <button
          type="button"
          className="ssv__carouselNav ssv__carouselNav--next"
          aria-label="Next slide"
          onClick={(event) => {
            event.stopPropagation();
            setSlide((index + 1) % count);
          }}
        >
          <Icon name="arrowLeft" size={14} />
        </button>
      </div>
      {count > 1 ? (
        <div className="ssv__dots">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              className={
                i === index ? "ssv__carouselDot ssv__carouselDot--active" : "ssv__carouselDot"
              }
              aria-label={`Go to slide ${i + 1}`}
              onClick={(event) => {
                event.stopPropagation();
                setSlide(i);
              }}
            />
          ))}
        </div>
      ) : null}
          </>
        )}
      <p className="ssv__mediaCaption">
        <Editable
          value={subtitle}
          onChange={(next) => onChange({ subtitle: next })}
          ariaLabel="Carousel caption"
          placeholder="Caption"
        />
      </p>
      </div>
      {editable ? (
        <div className="spe__mediaBar" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="spe__mediaBtn"
            aria-label="Add slide"
            disabled={count >= SECTION_IMAGE_MAX}
            onClick={() => onChange({ images: [...images, `ph:${IMAGE_PLACEHOLDERS[count % IMAGE_PLACEHOLDERS.length]!.id}`] })}
          >
            + Add slide
          </button>
          <button
            type="button"
            className="spe__mediaBtn"
            aria-label="Remove slide"
            disabled={count <= 1}
            onClick={() => {
              onChange({ images: images.filter((_, i) => i !== index) });
              setSlide(Math.max(0, index - 1));
            }}
          >
            Remove slide
          </button>
        </div>
      ) : null}
    </section>
  );
}
