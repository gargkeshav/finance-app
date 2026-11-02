import { useEffect, useId, useMemo, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
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
  const inputId = useId();
  const selectedName = options.find((option) => option.id === value)?.name ?? "";
  const [text, setText] = useState(selectedName);
  const normalizedOptions = useMemo(() => options.map((option) => ({
    ...option,
    search: `${option.name} ${option.id}`,
  })), [options]);

  useEffect(() => {
    setText(selectedName);
  }, [selectedName]);

  function commitText(inputText: string) {
    const resolution = resolveComboText(inputText, options);
    if (resolution.kind === "none") {
      setText("");
      onChange("");
    } else if (resolution.kind === "existing") {
      const selected = options.find((option) => option.id === resolution.id);
      setText(selected?.name ?? "");
      onChange(resolution.id);
    } else if (onCreate) {
      setText(resolution.name);
      onChange(onCreate(resolution.name));
    } else {
      setText(selectedName);
    }
  }

  return (
    <div className="grid min-w-0 gap-1.5 text-sm font-medium">
      <label htmlFor={inputId}>{label}</label>
      <Combobox
        items={normalizedOptions}
        value={value || null}
        onValueChange={(nextValue) => {
          if (typeof nextValue !== "string") return;
          if (nextValue === "__create__") {
            commitText(text);
            return;
          }
          onChange(nextValue);
          setText(options.find((option) => option.id === nextValue)?.name ?? "");
        }}
        inputValue={text}
        onInputValueChange={setText}
      >
        <ComboboxInput
          id={inputId}
          onBlur={(event) => commitText(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              commitText(event.currentTarget.value);
            } else if (event.key === "Escape") {
              setText(selectedName);
            }
          }}
          placeholder={nonePlaceholder}
        />
        <ComboboxContent>
          <ComboboxEmpty>No matching options.</ComboboxEmpty>
          <ComboboxList>
            {options.map((option) => (
              <ComboboxItem key={option.id} value={option.id}>{option.name}</ComboboxItem>
            ))}
            {onCreate && text.trim() && !options.some((option) => option.name.toLocaleLowerCase() === text.trim().toLocaleLowerCase()) && (
              <ComboboxItem value="__create__">Create “{text.trim()}”</ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}
