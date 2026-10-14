import { useEffect, useRef } from "react";

// Custom plain-text field ported from the Wails app. A native <textarea> lays
// mixed Farsi/English text out with the document base direction, so what you
// see while typing does not match the canvas. This contenteditable mirrors the
// text object's writing direction and keeps plain text only (no rich markup).
export function RichTextField({
  id,
  value,
  onChange,
  dir = "rtl",
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  dir?: "rtl" | "ltr";
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const updateEmpty = () => {
    const el = ref.current;
    if (el) el.classList.toggle("is-empty", (el.textContent || "").length === 0);
  };

  // Adopt external changes (object switch, undo, preset) without disturbing the
  // caret while the user is typing.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = value ?? "";
    if (el.textContent !== next) el.textContent = next;
    updateEmpty();
  }, [value]);

  const insertPlainText = (text: string) => {
    const el = ref.current;
    if (!el || !text) return;
    const selection = window.getSelection();
    let range: Range;
    if (selection && selection.rangeCount && el.contains(selection.anchorNode)) {
      range = selection.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStart(node, text.length);
    range.collapse(true);
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    updateEmpty();
    onChange(el.textContent || "");
  };

  return (
    <div className="rich-text">
      <div
        id={id}
        ref={ref}
        className="rich-text-input is-empty"
        contentEditable
        suppressContentEditableWarning
        dir={dir}
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder ?? "Text"}
        onInput={() => {
          updateEmpty();
          onChange(ref.current?.textContent || "");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            insertPlainText("\n");
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          insertPlainText(e.clipboardData.getData("text"));
        }}
      />
    </div>
  );
}
