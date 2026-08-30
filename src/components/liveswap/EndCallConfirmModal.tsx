import React from "react";
import { PhoneOff, AlertTriangle } from "lucide-react";

export interface EndCallConfirmModalProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirmEnd: () => void;
  partnerName: string;
}

export const EndCallConfirmModal: React.FC<EndCallConfirmModalProps> = ({
  isOpen,
  onCancel,
  onConfirmEnd,
  partnerName,
}) => {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[100000] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        e.stopPropagation();
        onCancel();
      }}
    >
      <div 
        className="w-full max-w-sm bg-[#141418] border border-white/15 rounded-3xl p-6 shadow-2xl text-center text-[#F7F4EE] animate-in zoom-in-95 duration-150 relative select-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-12 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 mx-auto mb-4 flex items-center justify-center shadow-lg shadow-rose-500/10">
          <PhoneOff className="w-5 h-5" />
        </div>

        <h3 className="text-base font-bold tracking-tight text-[#F7F4EE] mb-1.5">
          End Live Swap?
        </h3>
        <p className="text-xs text-white/65 leading-relaxed mb-6">
          Leaving will end the live exchange session with <span className="font-semibold text-white/90">{partnerName}</span> and record your swap as completed.
        </p>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="h-10 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-[#F7F4EE] text-xs font-semibold transition active:scale-95 cursor-pointer border border-white/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirmEnd}
            className="h-10 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition active:scale-95 cursor-pointer shadow-lg shadow-rose-600/30 flex items-center justify-center gap-1.5"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            <span>End Session</span>
          </button>
        </div>
      </div>
    </div>
  );
};
