import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";

export interface PickerOption {
  value: string;
  label: string;
  prefix?: string;
  hint?: string;
}

interface SearchablePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  searchPlaceholder?: string;
  options: PickerOption[];
  selectedValue?: string;
  selectedValues?: string[];
  multiSelect?: boolean;
  allOptionLabel?: string;
  onSelectSingle?: (option: PickerOption | null) => void;
  onToggleMulti?: (value: string) => void;
}

export default function SearchablePickerModal({
  isOpen,
  onClose,
  title,
  searchPlaceholder = "Search...",
  options,
  selectedValue = "",
  selectedValues = [],
  multiSelect = false,
  allOptionLabel,
  onSelectSingle,
  onToggleMulti,
}: SearchablePickerModalProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      return;
    }
    const t = setTimeout(() => {
      inputRef.current?.focus();
    }, 60);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        opt.value.toLowerCase().includes(q) ||
        (opt.hint && opt.hint.toLowerCase().includes(q))
    );
  }, [options, query]);

  if (!isOpen) return null;

  const selectedLowerSet = new Set(selectedValues.map((v) => v.toLowerCase()));

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-ptr-ignore="true"
      onClick={onClose}
      className="fixed inset-0 z-[95] bg-[#0D0D0F]/50 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-fade-in font-sans"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-[#FFFFFF] border border-[#E8E4DB] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[82dvh] overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-[#E8E4DB] flex items-center justify-between gap-3 shrink-0">
          <h3 className="text-[15px] font-bold text-[#0D0D0F] tracking-tight">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[#F7F4EE] border border-[#E8E4DB] hover:bg-[#F2EFE8] flex items-center justify-center text-[#71717A] hover:text-[#0D0D0F] transition cursor-pointer shrink-0"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Integrated Search Bar */}
        <div className="px-4 py-3 border-b border-[#F2EFE8] bg-[#FAF8F4] shrink-0">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-[#71717A] absolute left-3.5 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full h-10 pl-10 pr-9 rounded-xl bg-[#FFFFFF] border border-[#E8E4DB] focus:border-[#0D0D0F] text-sm text-[#0D0D0F] placeholder:text-[#71717A] outline-none transition"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="w-6 h-6 rounded-full bg-[#F2EFE8] hover:bg-[#E8E4DB] flex items-center justify-center text-[#71717A] hover:text-[#0D0D0F] absolute right-2.5 cursor-pointer transition"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Options List (A-Z) */}
        <div
          className="flex-1 overflow-y-auto divide-y divide-[#F2EFE8] mobile-scroll overscroll-y-contain"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {!multiSelect && allOptionLabel && !query.trim() && (
            <button
              type="button"
              onClick={() => {
                onSelectSingle?.(null);
                onClose();
              }}
              className={`w-full px-5 py-3 min-h-[46px] text-left flex items-center justify-between gap-3 text-[13.5px] transition cursor-pointer ${
                !selectedValue
                  ? "bg-[#F7F4EE] text-[#0D0D0F] font-semibold"
                  : "text-[#0D0D0F] hover:bg-[#FAF8F4]"
              }`}
            >
              <span>{allOptionLabel}</span>
              {!selectedValue && <Check className="w-4 h-4 text-[#C9A96E] shrink-0" />}
            </button>
          )}

          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt) => {
              const isSelected = multiSelect
                ? selectedLowerSet.has(opt.value.toLowerCase()) || selectedLowerSet.has(opt.label.toLowerCase())
                : selectedValue.toLowerCase() === opt.value.toLowerCase() ||
                  selectedValue.toLowerCase() === opt.label.toLowerCase();

              return (
                <button
                  key={`${opt.value}-${opt.label}`}
                  type="button"
                  onClick={() => {
                    if (multiSelect) {
                      onToggleMulti?.(opt.value);
                    } else {
                      onSelectSingle?.(opt);
                      onClose();
                    }
                  }}
                  className={`w-full px-5 py-3 min-h-[46px] text-left flex items-center justify-between gap-3 text-[13.5px] transition cursor-pointer ${
                    isSelected
                      ? "bg-[#F7F4EE] text-[#0D0D0F] font-semibold"
                      : "text-[#0D0D0F] hover:bg-[#FAF8F4]"
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    {opt.prefix && <span className="text-base leading-none shrink-0 select-none">{opt.prefix}</span>}
                    <span className="truncate">{opt.label}</span>
                  </span>
                  {isSelected && <Check className="w-4 h-4 text-[#C9A96E] shrink-0" />}
                </button>
              );
            })
          ) : (
            <div className="py-12 px-5 text-center text-[13px] text-[#71717A]">
              No matches found for &ldquo;{query.trim()}&rdquo;
            </div>
          )}
        </div>

        {/* Multi-select Done Bar */}
        {multiSelect && (
          <div className="px-5 py-3 border-t border-[#E8E4DB] bg-[#FFFFFF] flex items-center justify-between gap-3 shrink-0 pb-safe">
            <span className="text-xs text-[#71717A] tabular-nums">
              {selectedValues.length} selected
            </span>
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-5 rounded-full bg-[#0D0D0F] hover:bg-[#1C1C20] text-[#F7F4EE] text-xs font-semibold cursor-pointer transition"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
