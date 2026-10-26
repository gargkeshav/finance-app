import { useId, useRef, useState } from "react";
import { resolveComboText } from "../combo";

interface ComboOption {
  id: string;
  name: string;
}

interface ComboFieldProps {
  label: string;
  value: string;
  options: ComboOption[];
  nonePlaceholder: string;
  onChange: (id: string) => void;
  onCreate?: (name: string) => string;
}

export function ComboField({ label, value, options, nonePlaceholder, onChange, onCreate }: ComboFieldProps) {
  const listId = useId();
  const optionsRef = useRef(options);
  const valueRef = useRef(value);
  const committedText = useRef<string | null>(null);
  optionsRef.current = options;
  valueRef.current = value;
  const [text, setText] = useState(() => options.find((option) => option.id === value)?.name ?? "");

  function commitText(inputText: string) {
    if (committedText.current === inputText) return;
    committedText.current = inputText;
    const resolution = resolveComboText(inputText, optionsRef.current);
    if (resolution.kind === "none") {
      setText("");
      onChange("");
    } else if (resolution.kind === "existing") {
      setText(optionsRef.current.find((option) => option.id === resolution.id)?.name ?? inputText.trim());
      onChange(resolution.id);
    } else if (onCreate) {
      setText(resolution.name);
      onChange(onCreate(resolution.name));
    } else {
      setText(optionsRef.current.find((option) => option.id === valueRef.current)?.name ?? "");
    }
  }

  return (
    <label>
      {label}
      <input
        list={listId}
        onBlur={(event) => commitText(event.currentTarget.value)}
        onChange={(event) => {
          committedText.current = null;
          setText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            commitText(event.currentTarget.value);
          }
        }}
        placeholder={nonePlaceholder}
        value={text}
      />
      <datalist id={listId}>
        {options.map((option) => <option key={option.id} value={option.name} />)}
      </datalist>
    </label>
  );
}