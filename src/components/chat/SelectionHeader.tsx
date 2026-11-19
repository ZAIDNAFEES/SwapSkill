import React from "react";
import { X, Copy, Forward, Trash2 } from "lucide-react";

interface SelectionHeaderProps {
  selectedCount: number;
  onExitSelection: () => void;
  onCopy: () => void;
  onForward: () => void;
  onDelete: () => void;
}

export const SelectionHeader: React.FC<SelectionHeaderProps> = ({
  selectedCount,
  onExitSelection,
  onCopy,
  onForward,
  onDelete,
}) => {
  return (
    <div 
      id="chat-selection-header"
      className="shrink-0 flex-none bg-[#0D0D0F] text-[#F7F4EE] border-b border-[#1E1E22] flex items-center justify-between px-3 sm:px-4 shadow-sm relative z-30 select-none w-full pt-[env(safe-area-inset-top,0px)] min-h-[calc(56px+env(safe-area-inset-top,0px))]"
    >
      {/* Left: Exit button & Count */}
      <div className="flex items-center gap-2 sm:gap-3">
        <button
          id="btn-exit-selection"
          type="button"
          onClick={onExitSelection}
          className="w-9 h-9 rounded-full hover:bg-white/10 flex items-center justify-center transition cursor-pointer text-zinc-300 hover:text-white active:scale-95"
          title="Exit selection"
          aria-label="Exit selection"
        >
          <X size={20} />
        </button>
        <span className="font-semibold text-sm sm:text-base text-white">
          {selectedCount} selected
        </span>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1 sm:gap-2">
        <button
          id="btn-selection-copy"
          type="button"
          onClick={onCopy}
          className="p-2 sm:p-2.5 hover:bg-white/10 rounded-full text-zinc-300 hover:text-white transition cursor-pointer active:scale-95"
          title="Copy text"
          aria-label="Copy text"
        >
          <Copy size={18} />
        </button>

        <button
          id="btn-selection-forward"
          type="button"
          onClick={onForward}
          className="p-2 sm:p-2.5 hover:bg-white/10 rounded-full text-zinc-300 hover:text-white transition cursor-pointer active:scale-95"
          title="Forward"
          aria-label="Forward"
        >
          <Forward size={18} />
        </button>

        <button
          id="btn-selection-delete"
          type="button"
          onClick={onDelete}
          className="p-2 sm:p-2.5 hover:bg-red-500/15 rounded-full text-red-400 hover:text-red-300 transition cursor-pointer active:scale-95"
          title="Delete"
          aria-label="Delete"
        >
          <Trash2 size={18} />
        </button>
      </div>
    </div>
  );
};

export default SelectionHeader;
