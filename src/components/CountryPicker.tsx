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
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
          {label}
        </span>
      )}

      {/* Selected Country Trigger */}
      <button
        id="country-picker-trigger"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full h-11 px-4 rounded-xl border border-gray-200 bg-slate-50 hover:bg-slate-100 text-gray-900 flex items-center justify-between transition focus:outline-none focus:border-blue-500 cursor-pointer"
      >
        {selectedCountry ? (
          <span className="flex items-center gap-2 text-sm font-medium">
            <span className="text-lg leading-none select-none">{selectedCountry.flag}</span>
            <span>{selectedCountry.name}</span>
          </span>
        ) : (
          <span className="text-gray-400 text-sm">{placeholder}</span>
        )}
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Search Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40 bg-black/20 backdrop-blur-xs"
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
              className="absolute left-0 right-0 top-[70px] z-50 max-h-72 flex flex-col rounded-2xl border border-gray-200 bg-white shadow-xl overflow-hidden"
            >
              {/* Search Bar inside dropdown */}
              <div className="p-3 border-b border-gray-100 flex items-center gap-2 bg-slate-50">
                <Search className="w-4 h-4 text-gray-400 shrink-0" />
                <input
                  id="country-search-input"
                  type="text"
                  placeholder="Search countries..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent border-none text-sm text-gray-900 focus:outline-none placeholder-gray-400"
                  autoFocus
                />
              </div>

              {/* Country List */}
              <div 
                className="overflow-y-auto max-h-56 divide-y divide-gray-100 mobile-scroll touch-pan-y overscroll-y-contain"
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
                        className={`w-full px-4 py-2.5 text-left flex items-center justify-between text-sm transition hover:bg-slate-50 cursor-pointer ${
                          isSelected ? "bg-blue-50 text-blue-600 font-bold" : "text-gray-700"
                        }`}
                      >
                        <span className="flex items-center gap-2.5">
                          <span className="text-base select-none">{c.flag}</span>
                          <span>{c.name}</span>
                        </span>
                        {isSelected && <Check className="w-4 h-4 text-blue-600" />}
                      </button>
                    );
                  })
                ) : (
                  <div className="p-4 text-center text-xs text-gray-400">
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
