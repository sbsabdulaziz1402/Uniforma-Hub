import { useEffect, useState } from "react";
import { haptic } from "../lib/tg";

export interface Option { value: string; label: string; note?: string }

/**
 * Свой выпадающий список вместо системного <select>.
 * Системный на мобильных рисуется колесом ОС и выбивается из макета,
 * плюс его нельзя оформить. Здесь — шторка снизу, как принято на телефоне.
 */
export default function Select({
  value, options, onChange, placeholder = "Не выбрано", title, multiple = false,
}: {
  value: string | string[];
  options: Option[];
  onChange: (v: string & string[]) => void;
  placeholder?: string;
  title?: string;
  multiple?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = multiple ? (value as string[]) : [value as string].filter(Boolean);

  // Шторка открыта — страница под ней не должна прокручиваться
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const labels = options.filter((o) => selected.includes(o.value)).map((o) => o.label);

  const pick = (v: string) => {
    haptic();
    if (multiple) {
      const next = selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v];
      onChange(next as unknown as string & string[]);
    } else {
      onChange(v as string & string[]);
      setOpen(false);
    }
  };

  return (
    <>
      <button type="button" className="select-btn" onClick={() => { haptic(); setOpen(true); }}>
        <span className={"val" + (labels.length ? "" : " empty")}>
          {labels.length ? labels.join(", ") : placeholder}
        </span>
        <span className="chev">▾</span>
      </button>

      {open && (
        <div className="sheet-back" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-grip" />
            {title && <div className="sheet-title">{title}</div>}

            {options.map((o) => {
              const on = selected.includes(o.value);
              return (
                <button key={o.value} type="button"
                  className={"sheet-item" + (on ? " on" : "")}
                  onClick={() => pick(o.value)}>
                  <span>
                    {o.label}
                    {o.note && <div className="hint">{o.note}</div>}
                  </span>
                  {on && <span className="mark">✓</span>}
                </button>
              );
            })}

            {options.length === 0 && <div className="empty">Список пуст</div>}

            {multiple && (
              <div style={{ padding: "12px 20px 4px" }}>
                <button onClick={() => setOpen(false)}>Готово</button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
