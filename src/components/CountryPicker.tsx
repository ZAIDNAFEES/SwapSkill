import React, { useState, useMemo } from "react";
import { countries, Country } from "../data/countries";
import { Search, ChevronDown, Check, Globe } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface CountryPickerProps {
  selectedCode: string;
  onChange: (country: Country) => void;
  label?: string;
  placeholder?: string;
}

export default function CountryPicker({
  selectedCode,
  onChange,
  label = "Country",
  placeholder = "Select country"
}: CountryPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedCountry = useMemo(() => {
    return countries.find((c) => c.code === selectedCode);
  }, [selectedCode]);

  const filteredCountries = useMemo(() => {
    if (!searchQuery.trim()) return countries;
    const lowerQuery = searchQuery.toLowerCase();
    return countries.filter((c) =>
      c.name.toLowerCase().includes(lowerQuery)
    );
  }, [searchQuery]);

  const handleSelect = (country: Country) => {
    onChange(country);
    setIsOpen(false);
    setSearchQuery("");
  };

  return (
    <div className="relative flex flex-col gap-1.5 w-full font-sans text-left">
      {label && (
        <span className="text-[12px] font-medium text-[#52525B]">
          {label}
        </span>
      )}

      {/* Selected Country Trigger */}
      <button
        id="country-picker-trigger"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-11 px-3.5 rounded-xl border border-[#E8E4DB] bg-[#F7F4EE] hover:bg-[#F2EFE8] text-[#0D0D0F] flex items-center justify-between transition focus:outline-none focus:bg-[#FFFFFF] focus:border-[#0D0D0F] cursor-pointer"
      >
        {selectedCountry ? (
          <span className="flex items-center gap-2 text-[13px] font-medium truncate">
            <span className="text-base leading-none select-none">{selectedCountry.flag}</span>
            <span className="truncate">{selectedCountry.name}</span>
          </span>
        ) : (
          <span className="text-[#A1A1AA] text-[13px]">{placeholder}</span>
        )}
        <ChevronDown className={`w-4 h-4 text-[#71717A] transition-transform duration-200 shrink-0 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Search Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40 bg-[#0D0D0F]/25 backdrop-blur-xs"
              onClick={() => {
                setIsOpen(false);
                setSearchQuery("");
              }}
            />

            {/* Dropdown Card */}
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="absolute left-0 right-0 top-[70px] z-50 max-h-72 flex flex-col rounded-2xl border border-[#E8E4DB] bg-[#FFFFFF] shadow-xl overflow-hidden"
            >
              {/* Search Bar inside dropdown */}
              <div className="p-3 border-b border-[#E8E4DB] flex items-center gap-2 bg-[#FAF8F4]">
                <Search className="w-4 h-4 text-[#71717A] shrink-0" />
                <input
                  id="country-search-input"
                  type="text"
                  placeholder="Search countries..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent border-none text-[13px] text-[#0D0D0F] focus:outline-none placeholder-[#A1A1AA]"
                  autoFocus
                />
              </div>

              {/* Country List */}
              <div 
                className="overflow-y-auto max-h-56 divide-y divide-[#F2EFE8] mobile-scroll touch-pan-y overscroll-y-contain"
                style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
              >
                {filteredCountries.length > 0 ? (
                  filteredCountries.map((c) => {
                    const isSelected = c.code === selectedCode;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => handleSelect(c)}
                        className={`w-full px-4 py-2.5 text-left flex items-center justify-between text-[13px] transition hover:bg-[#FAF8F4] cursor-pointer ${
                          isSelected ? "bg-[#F7F4EE] text-[#0D0D0F] font-semibold" : "text-[#52525B]"
                        }`}
                      >
                        <span className="flex items-center gap-2.5">
                          <span className="text-base select-none">{c.flag}</span>
                          <span>{c.name}</span>
                        </span>
                        {isSelected && <Check className="w-4 h-4 text-[#C9A96E]" strokeWidth={2.5} />}
                      </button>
                    );
                  })
                ) : (
                  <div className="p-4 text-center text-xs text-[#71717A]">
                    No countries found
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
