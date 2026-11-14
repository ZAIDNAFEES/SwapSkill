import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Edit3, Plus, Send, Sparkles, Trash2, X, MessageCircle, Check } from "lucide-react";
import { UserNote, UserProfile } from "../../types";
import { SmartImage } from "../SmartImage";

export const NOTE_DURATION_MS = 24 * 60 * 60 * 1000;
export const NOTE_MAX_LENGTH = 60;

export const NOTE_MOODS = [
  { emoji: "🤝", label: "Open to swap" },
  { emoji: "💻", label: "Coding now" },
  { emoji: "🎧", label: "Deep focus" },
  { emoji: "☕", label: "Free to chat" },
  { emoji: "📚", label: "Practicing" },
  { emoji: "🎨", label: "Creating" },
] as const;

export const NOTE_QUICK_EMOJIS = ["🔥", "✨", "💻", "☕", "🎧", "🤝", "🚀", "🙌", "😊"];
export const NOTE_REACTIONS = ["👋", "🔥", "❤️", "👏", "😂", "🤝"];

export function getValidActiveNote(note?: UserNote | null): UserNote | null {
  if (!note || typeof note.text !== "string") return null;
  const trimmed = note.text.trim();
  if (!trimmed && !note.moodLabel) return null;
  if (note.expiresAt && Date.now() > note.expiresAt) return null;
  return {
    ...note,
    text: trimmed,
  };
}

export function formatNoteAge(createdAt?: number): string {
  if (!createdAt) return "now";
  const diffSec = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  if (diffSec < 60) return "Just now";
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return "24h";
}

export function formatNoteRemaining(expiresAt?: number): string {
  if (!expiresAt) return "24h";
  const diffMs = Math.max(0, expiresAt - Date.now());
  const mins = Math.ceil(diffMs / 60000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.ceil(mins / 60);
  return `${hrs}h left`;
}

export interface NoteTrayContact {
  uid: string;
  chatId?: string;
  chatObj?: any;
  profile: UserProfile | null;
  displayName: string;
  photoUrl?: string;
  note: UserNote | null;
  isTyping?: boolean;
}

interface InstagramNotesTrayProps {
  currentUserProfile: UserProfile | null;
  userNote: UserNote | null;
  contacts: NoteTrayContact[];
  onOpenOwnNote: () => void;
  onSelectContact: (contact: NoteTrayContact) => void;
}

export function InstagramNotesTray({
  currentUserProfile,
  userNote,
  contacts,
  onOpenOwnNote,
  onSelectContact,
}: InstagramNotesTrayProps) {
  const validOwnNote = getValidActiveNote(userNote);
  const myPhoto = currentUserProfile?.photoUrl || currentUserProfile?.photoURL || (currentUserProfile as any)?.profilePhotoUrl;
  const myName = currentUserProfile?.fullName || "You";

  return (
    <div
      className="px-3.5 pt-2 pb-3 border-b border-[#E8E4DB]/80 dark:border-neutral-800/80 bg-[#FAF8F4]/90 dark:bg-[#111215]/70 overflow-x-auto no-scrollbar select-none shrink-0 overscroll-x-contain"
    >
      <div className="flex items-end gap-3.5 min-w-max">
        {/* 1. Current User Note ("Your note") */}
        <button
          id="own-note-tray-btn"
          type="button"
          onClick={onOpenOwnNote}
          className="flex flex-col items-center cursor-pointer group relative touch-manipulation active:scale-95 transition-transform focus:outline-none min-w-[72px]"
        >
          {/* Floating Overlapping Thought Bubble */}
          <div className="relative z-10 -mb-3.5 flex flex-col items-center">
            <div
              className={`min-w-[66px] max-w-[98px] px-2.5 py-1.5 rounded-[16px] bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB]/90 dark:border-neutral-700/80 shadow-[0_3px_12px_rgba(13,13,15,0.08)] text-center transition-all ${
                validOwnNote
                  ? "text-[#0D0D0F] dark:text-white"
                  : "text-[#71717A] dark:text-neutral-400"
              }`}
            >
              {validOwnNote ? (
                <div className="flex flex-col items-center gap-0.5">
                  {validOwnNote.moodEmoji && (
                    <span className="text-[10px] leading-none font-medium text-[#9A7A42] dark:text-[#C9A96E] truncate max-w-[84px]">
                      {validOwnNote.moodEmoji} {validOwnNote.moodLabel}
                    </span>
                  )}
                  {validOwnNote.text && (
                    <p className="text-[11px] font-medium leading-[1.2] line-clamp-2 break-words">
                      {validOwnNote.text}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-[11px] font-normal leading-[1.2] whitespace-nowrap">
                  Note...
                </p>
              )}
            </div>
            {/* Authentic Instagram Double Circular Thought Tail */}
            <div className="flex flex-col items-start self-start ml-3.5 -mt-1 pointer-events-none">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB]/80 dark:border-neutral-700/80 shadow-2xs" />
              <span className="w-1.5 h-1.5 rounded-full bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB]/80 dark:border-neutral-700/80 ml-1 mt-0.5" />
            </div>
          </div>

          {/* Avatar + Ring + Action Badge */}
          <div className="relative">
            <div
              className={`w-[62px] h-[62px] rounded-full p-[2px] transition-all ${
                validOwnNote
                  ? "bg-gradient-to-tr from-[#C9A96E] via-[#DFC289] to-[#0D0D0F] shadow-xs"
                  : "bg-[#E8E4DB] dark:bg-neutral-700"
              }`}
            >
              <div className="w-full h-full rounded-full p-[2px] bg-[#FAF8F4] dark:bg-[#111215]">
                <SmartImage
                  src={myPhoto}
                  alt={myName}
                  className="w-full h-full rounded-full object-cover"
                  fallbackType="profile"
                  fullName={myName}
                  sizeType="thumbnail"
                />
              </div>
            </div>

            <span
              className={`absolute bottom-0 right-0 w-5 h-5 rounded-full flex items-center justify-center ring-2 ring-[#FAF8F4] dark:ring-[#111215] shadow-xs transition-transform group-hover:scale-110 ${
                validOwnNote
                  ? "bg-[#FFFFFF] dark:bg-neutral-800 text-[#0D0D0F] dark:text-[#C9A96E] border border-[#E8E4DB] dark:border-neutral-700"
                  : "bg-[#0D0D0F] dark:bg-[#C9A96E] text-[#F7F4EE] dark:text-[#0D0D0F]"
              }`}
            >
              {validOwnNote ? <Edit3 size={10} /> : <Plus size={12} strokeWidth={2.75} />}
            </span>
          </div>

          <span className="mt-1.5 text-[11px] font-medium text-[#71717A] dark:text-neutral-400 group-hover:text-[#0D0D0F] dark:group-hover:text-white truncate max-w-[70px]">
            Your note
          </span>
        </button>

        {/* 2. Contacts with Active Notes + Recent Contacts */}
        {contacts.map((contact) => {
          const validNote = getValidActiveNote(contact.note);
          const firstName = (contact.displayName || "Partner").trim().split(" ")[0];
          const hasBubble = Boolean(validNote || contact.isTyping);

          return (
            <button
              key={`tray_note_${contact.uid}`}
              type="button"
              onClick={() => onSelectContact(contact)}
              className="flex flex-col items-center cursor-pointer group relative touch-manipulation active:scale-95 transition-transform focus:outline-none min-w-[72px]"
            >
              {/* Floating Thought Bubble ONLY if contact has a real active note or is typing */}
              {hasBubble ? (
                <div className="relative z-10 -mb-3.5 flex flex-col items-center">
                  <div className="min-w-[66px] max-w-[98px] px-2.5 py-1.5 rounded-[16px] bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB]/90 dark:border-neutral-700/80 shadow-[0_3px_12px_rgba(13,13,15,0.08)] text-[#0D0D0F] dark:text-white text-center">
                    {contact.isTyping ? (
                      <p className="text-[11px] font-medium text-[#9A7A42] dark:text-[#C9A96E] italic">
                        typing...
                      </p>
                    ) : validNote ? (
                      <div className="flex flex-col items-center gap-0.5">
                        {validNote.moodEmoji && (
                          <span className="text-[10px] leading-none font-medium text-[#9A7A42] dark:text-[#C9A96E] truncate max-w-[84px]">
                            {validNote.moodEmoji} {validNote.moodLabel}
                          </span>
                        )}
                        {validNote.text && (
                          <p className="text-[11px] font-medium leading-[1.2] line-clamp-2 break-words">
                            {validNote.text}
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-start self-start ml-3.5 -mt-1 pointer-events-none">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB]/80 dark:border-neutral-700/80 shadow-2xs" />
                    <span className="w-1.5 h-1.5 rounded-full bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB]/80 dark:border-neutral-700/80 ml-1 mt-0.5" />
                  </div>
                </div>
              ) : null}

              {/* Contact Avatar */}
              <div className="relative">
                <div
                  className={`w-[62px] h-[62px] rounded-full p-[2px] transition-transform group-hover:scale-105 ${
                    validNote
                      ? "bg-gradient-to-tr from-[#C9A96E] via-[#D9BC84] to-[#0D0D0F] shadow-xs"
                      : "bg-[#E8E4DB] dark:bg-neutral-700"
                  }`}
                >
                  <div className="w-full h-full rounded-full p-[2px] bg-[#FAF8F4] dark:bg-[#111215]">
                    <SmartImage
                      src={contact.photoUrl}
                      alt={contact.displayName}
                      className="w-full h-full rounded-full object-cover"
                      fallbackType="profile"
                      fullName={contact.displayName}
                      sizeType="thumbnail"
                    />
                  </div>
                </div>
              </div>

              <span className="mt-1.5 text-[11px] font-medium text-[#0D0D0F]/80 dark:text-neutral-300 group-hover:text-[#0D0D0F] dark:group-hover:text-white truncate max-w-[70px]">
                {firstName}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface InstagramNoteComposerModalProps {
  isOpen: boolean;
  existingNote: UserNote | null;
  currentUserProfile: UserProfile | null;
  onClose: () => void;
  onSaveNote: (note: UserNote) => Promise<void> | void;
  onDeleteNote: () => Promise<void> | void;
}

export function InstagramNoteComposerModal({
  isOpen,
  existingNote,
  currentUserProfile,
  onClose,
  onSaveNote,
  onDeleteNote,
}: InstagramNoteComposerModalProps) {
  const validExisting = getValidActiveNote(existingNote);
  const [step, setStep] = useState<"action" | "compose">(validExisting ? "action" : "compose");
  const [text, setText] = useState(validExisting?.text || "");
  const [selectedMood, setSelectedMood] = useState<{ emoji: string; label: string } | null>(
    validExisting?.moodLabel
      ? { emoji: validExisting.moodEmoji || "✨", label: validExisting.moodLabel }
      : null
  );
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const valid = getValidActiveNote(existingNote);
    setStep(valid ? "action" : "compose");
    setText(valid?.text || "");
    setSelectedMood(
      valid?.moodLabel ? { emoji: valid.moodEmoji || "✨", label: valid.moodLabel } : null
    );
    setIsSaving(false);
  }, [isOpen, existingNote]);

  useEffect(() => {
    if (isOpen && step === "compose") {
      const t = setTimeout(() => {
        textareaRef.current?.focus();
      }, 90);
      return () => clearTimeout(t);
    }
  }, [isOpen, step]);

  const myPhoto = currentUserProfile?.photoUrl || currentUserProfile?.photoURL || (currentUserProfile as any)?.profilePhotoUrl;
  const myName = currentUserProfile?.fullName || "You";
  const canShare = Boolean(text.trim() || selectedMood);

  const handleShare = async () => {
    if (!canShare || isSaving) return;
    setIsSaving(true);
    const now = Date.now();
    const nextNote: UserNote = {
      text: text.trim().slice(0, NOTE_MAX_LENGTH),
      ...(selectedMood ? { moodEmoji: selectedMood.emoji, moodLabel: selectedMood.label } : {}),
      createdAt: now,
      expiresAt: now + NOTE_DURATION_MS,
    };
    try {
      await onSaveNote(nextNote);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onDeleteNote();
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleAppendEmoji = (emoji: string) => {
    setText((prev) => {
      if (prev.length + emoji.length > NOTE_MAX_LENGTH) return prev;
      return prev ? `${prev}${emoji}` : emoji;
    });
    textareaRef.current?.focus();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          data-ptr-ignore="true"
          className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4 font-sans"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#0D0D0F]/55 backdrop-blur-xs cursor-pointer"
          />

          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ type: "spring", damping: 28, stiffness: 360 }}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 w-full sm:max-w-md bg-[#F7F4EE] dark:bg-[#141519] rounded-t-3xl sm:rounded-3xl border border-[#E8E4DB] dark:border-neutral-800 shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]"
          >
            {/* Header */}
            <div className="px-4 py-3.5 border-b border-[#E8E4DB] dark:border-neutral-800 bg-[#FFFFFF] dark:bg-[#191B20] flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onClose}
                className="text-xs font-medium text-[#71717A] hover:text-[#0D0D0F] dark:hover:text-white px-2 py-1.5 rounded-lg cursor-pointer transition"
              >
                Cancel
              </button>

              <span className="text-[14px] font-bold text-[#0D0D0F] dark:text-white tracking-tight">
                {step === "action" ? "Your note" : "New note"}
              </span>

              {step === "compose" ? (
                <button
                  type="button"
                  disabled={!canShare || isSaving}
                  onClick={handleShare}
                  className={`h-8 px-4 rounded-full text-xs font-semibold transition cursor-pointer ${
                    canShare && !isSaving
                      ? "bg-[#0D0D0F] dark:bg-[#C9A96E] text-[#F7F4EE] dark:text-[#0D0D0F] hover:opacity-90 active:scale-95"
                      : "bg-[#E8E4DB] dark:bg-neutral-800 text-[#71717A] cursor-not-allowed"
                  }`}
                >
                  {isSaving ? "Sharing..." : "Share"}
                </button>
              ) : (
                <div className="w-12" />
              )}
            </div>

            {step === "action" && validExisting ? (
              <div className="px-6 pt-8 pb-6 flex flex-col items-center text-center gap-6">
                <div className="flex flex-col items-center">
                  {/* Large Floating Thought Bubble */}
                  <div className="relative z-10 -mb-4 flex flex-col items-center">
                    <div className="min-w-[160px] max-w-[260px] px-4 py-3 rounded-[22px] bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB] dark:border-neutral-700 shadow-[0_8px_28px_rgba(13,13,15,0.09)] flex flex-col items-center gap-1">
                      {validExisting.moodLabel && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F7F4EE] dark:bg-neutral-800 text-[11px] font-medium text-[#9A7A42] dark:text-[#C9A96E]">
                          <span>{validExisting.moodEmoji}</span>
                          <span>{validExisting.moodLabel}</span>
                        </span>
                      )}
                      {validExisting.text && (
                        <p className="text-[15px] font-medium text-[#0D0D0F] dark:text-white leading-snug break-words">
                          {validExisting.text}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-start self-start ml-8 -mt-1.5">
                      <span className="w-3.5 h-3.5 rounded-full bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB] dark:border-neutral-700 shadow-2xs" />
                      <span className="w-2 h-2 rounded-full bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB] dark:border-neutral-700 ml-1.5 mt-1" />
                    </div>
                  </div>

                  {/* Avatar */}
                  <div className="w-20 h-20 rounded-full p-[2.5px] bg-gradient-to-tr from-[#C9A96E] via-[#DFC289] to-[#0D0D0F] shadow-md">
                    <div className="w-full h-full rounded-full p-[2px] bg-[#F7F4EE] dark:bg-[#141519]">
                      <SmartImage
                        src={myPhoto}
                        alt={myName}
                        className="w-full h-full rounded-full object-cover"
                        fallbackType="profile"
                        fullName={myName}
                      />
                    </div>
                  </div>
                </div>

                <p className="text-xs text-[#71717A] dark:text-neutral-400">
                  Shared {formatNoteAge(validExisting.createdAt)} · {formatNoteRemaining(validExisting.expiresAt)}
                </p>

                <div className="w-full flex flex-col gap-2.5 pb-safe">
                  <button
                    type="button"
                    onClick={() => setStep("compose")}
                    className="w-full h-11 rounded-xl bg-[#0D0D0F] dark:bg-[#C9A96E] text-[#F7F4EE] dark:text-[#0D0D0F] text-[13px] font-semibold cursor-pointer hover:opacity-90 active:scale-[0.99] transition"
                  >
                    Leave a new note
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={handleDelete}
                    className="w-full h-11 rounded-xl bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB] dark:border-neutral-700 text-rose-600 dark:text-rose-400 text-[13px] font-semibold flex items-center justify-center gap-1.5 hover:bg-rose-50 dark:hover:bg-rose-950/20 cursor-pointer transition"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete note</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-5 pt-6 pb-5 flex flex-col items-center gap-5 overflow-y-auto mobile-scroll">
                {/* Interactive Live Bubble + Avatar Preview */}
                <div className="flex flex-col items-center w-full">
                  <div className="relative z-10 -mb-4 flex flex-col items-center w-full max-w-[270px]">
                    <div className="w-full px-4 py-3 rounded-[24px] bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB] dark:border-neutral-700 shadow-[0_8px_28px_rgba(13,13,15,0.09)] flex flex-col items-center gap-1.5">
                      {selectedMood && (
                        <button
                          type="button"
                          onClick={() => setSelectedMood(null)}
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#F7F4EE] dark:bg-neutral-800 border border-[#E8E4DB] dark:border-neutral-700 text-[11px] font-medium text-[#9A7A42] dark:text-[#C9A96E] cursor-pointer hover:opacity-80"
                          title="Tap to remove status"
                        >
                          <span>{selectedMood.emoji}</span>
                          <span>{selectedMood.label}</span>
                          <X className="w-3 h-3 ml-0.5 opacity-70" />
                        </button>
                      )}
                      <textarea
                        ref={textareaRef}
                        rows={2}
                        maxLength={NOTE_MAX_LENGTH}
                        value={text}
                        onChange={(e) => setText(e.target.value.replace(/\n/g, " "))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleShare();
                          }
                        }}
                        placeholder="Share a thought..."
                        className="w-full bg-transparent text-center text-[15px] font-medium text-[#0D0D0F] dark:text-white placeholder:text-[#71717A]/70 resize-none outline-none leading-snug"
                      />
                    </div>
                    <div className="flex flex-col items-start self-start ml-9 -mt-1.5 pointer-events-none">
                      <span className="w-3.5 h-3.5 rounded-full bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB] dark:border-neutral-700 shadow-2xs" />
                      <span className="w-2 h-2 rounded-full bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB] dark:border-neutral-700 ml-1.5 mt-1" />
                    </div>
                  </div>

                  {/* Avatar */}
                  <div className="w-20 h-20 rounded-full p-[2.5px] bg-gradient-to-tr from-[#C9A96E] via-[#DFC289] to-[#0D0D0F] shadow-md">
                    <div className="w-full h-full rounded-full p-[2px] bg-[#F7F4EE] dark:bg-[#141519]">
                      <SmartImage
                        src={myPhoto}
                        alt={myName}
                        className="w-full h-full rounded-full object-cover"
                        fallbackType="profile"
                        fullName={myName}
                      />
                    </div>
                  </div>

                  <span
                    className={`mt-2 text-[11px] font-mono tabular-nums ${
                      text.length >= NOTE_MAX_LENGTH - 5 ? "text-rose-500 font-semibold" : "text-[#71717A]"
                    }`}
                  >
                    {text.length}/{NOTE_MAX_LENGTH}
                  </span>
                </div>

                {/* 1-Tap Quick Emoji Row */}
                <div className="w-full flex items-center justify-center gap-1.5 flex-wrap">
                  {NOTE_QUICK_EMOJIS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => handleAppendEmoji(em)}
                      className="w-9 h-9 rounded-full bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB] dark:border-neutral-700 hover:bg-[#F2EFE8] dark:hover:bg-neutral-800 text-base flex items-center justify-center active:scale-90 transition cursor-pointer shadow-2xs"
                    >
                      {em}
                    </button>
                  ))}
                </div>

                {/* Status / Vibe Chips */}
                <div className="w-full flex flex-col gap-2">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[#71717A] text-center flex items-center justify-center gap-1">
                    <Sparkles className="w-3 h-3 text-[#C9A96E]" />
                    Add a status vibe
                  </span>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {NOTE_MOODS.map((mood) => {
                      const active = selectedMood?.label === mood.label;
                      return (
                        <button
                          key={mood.label}
                          type="button"
                          onClick={() => setSelectedMood(active ? null : mood)}
                          className={`h-8 px-3 rounded-full text-[11.5px] font-medium flex items-center gap-1.5 transition cursor-pointer ${
                            active
                              ? "bg-[#0D0D0F] dark:bg-[#C9A96E] text-[#F7F4EE] dark:text-[#0D0D0F] font-semibold shadow-2xs"
                              : "bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB] dark:border-neutral-700 text-[#0D0D0F] dark:text-neutral-200 hover:bg-[#F2EFE8]"
                          }`}
                        >
                          <span>{mood.emoji}</span>
                          <span>{mood.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <p className="text-[11px] text-[#71717A] text-center pb-safe">
                  Shared with people in your chats · Disappears after 24h
                </p>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

interface InstagramNoteViewerModalProps {
  contact: NoteTrayContact | null;
  onClose: () => void;
  onOpenChat: (contact: NoteTrayContact) => void;
  onReplyToNote: (contact: NoteTrayContact, note: UserNote, replyText: string) => Promise<void> | void;
}

export function InstagramNoteViewerModal({
  contact,
  onClose,
  onOpenChat,
  onReplyToNote,
}: InstagramNoteViewerModalProps) {
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [sentConfirm, setSentConfirm] = useState<string | null>(null);

  const note = contact ? getValidActiveNote(contact.note) : null;

  useEffect(() => {
    setReplyText("");
    setSending(false);
    setSentConfirm(null);
  }, [contact?.uid]);

  const handleSendReply = async (customText?: string) => {
    if (!contact || !note || sending) return;
    const finalText = (customText ?? replyText).trim();
    if (!finalText) return;

    setSending(true);
    try {
      await onReplyToNote(contact, note, finalText);
      if (!customText) setReplyText("");
      setSentConfirm(customText ? `Sent ${customText}` : "Reply sent");
      setTimeout(() => {
        onClose();
      }, 650);
    } finally {
      setSending(false);
    }
  };

  const firstName = (contact?.displayName || "Partner").trim().split(" ")[0];

  return (
    <AnimatePresence>
      {contact && note && (
        <div
          role="dialog"
          aria-modal="true"
          data-ptr-ignore="true"
          className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4 font-sans"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-[#0D0D0F]/55 backdrop-blur-xs cursor-pointer"
          />

          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ type: "spring", damping: 28, stiffness: 360 }}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 w-full sm:max-w-md bg-[#F7F4EE] dark:bg-[#141519] rounded-t-3xl sm:rounded-3xl border border-[#E8E4DB] dark:border-neutral-800 shadow-2xl overflow-hidden flex flex-col"
          >
            {/* Header */}
            <div className="px-4 py-3 border-b border-[#E8E4DB] dark:border-neutral-800 bg-[#FFFFFF] dark:bg-[#191B20] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <SmartImage
                  src={contact.photoUrl}
                  alt={contact.displayName}
                  className="w-8 h-8 rounded-full object-cover border border-[#E8E4DB] shrink-0"
                  fallbackType="profile"
                  fullName={contact.displayName}
                  sizeType="thumbnail"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[13px] font-bold text-[#0D0D0F] dark:text-white truncate">
                      {contact.displayName}
                    </span>
                    <span className="text-[11px] text-[#71717A] shrink-0">
                      · {formatNoteAge(note.createdAt)}
                    </span>
                  </div>
                  {contact.profile?.username && (
                    <span className="text-[11px] text-[#71717A] block truncate">
                      @{contact.profile.username}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenChat(contact);
                  }}
                  className="h-8 px-3 rounded-full bg-[#F2EFE8] dark:bg-neutral-800 hover:bg-[#E8E4DB] text-[#0D0D0F] dark:text-white text-[11.5px] font-semibold flex items-center gap-1.5 cursor-pointer transition"
                >
                  <MessageCircle className="w-3.5 h-3.5 text-[#9A7A42] dark:text-[#C9A96E]" />
                  <span>Chat</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-8 h-8 rounded-full hover:bg-[#F2EFE8] dark:hover:bg-neutral-800 flex items-center justify-center text-[#71717A] hover:text-[#0D0D0F] dark:hover:text-white cursor-pointer transition"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Thought Bubble Showcase */}
            <div className="px-6 pt-8 pb-5 flex flex-col items-center text-center">
              <div className="relative z-10 -mb-4 flex flex-col items-center">
                <div className="min-w-[160px] max-w-[270px] px-4 py-3.5 rounded-[22px] bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB] dark:border-neutral-700 shadow-[0_8px_28px_rgba(13,13,15,0.09)] flex flex-col items-center gap-1">
                  {note.moodLabel && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F7F4EE] dark:bg-neutral-800 text-[11px] font-medium text-[#9A7A42] dark:text-[#C9A96E]">
                      <span>{note.moodEmoji}</span>
                      <span>{note.moodLabel}</span>
                    </span>
                  )}
                  {note.text && (
                    <p className="text-[15.5px] font-medium text-[#0D0D0F] dark:text-white leading-snug break-words">
                      {note.text}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-start self-start ml-8 -mt-1.5">
                  <span className="w-3.5 h-3.5 rounded-full bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB] dark:border-neutral-700 shadow-2xs" />
                  <span className="w-2 h-2 rounded-full bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB] dark:border-neutral-700 ml-1.5 mt-1" />
                </div>
              </div>

              <div className="w-20 h-20 rounded-full p-[2.5px] bg-gradient-to-tr from-[#C9A96E] via-[#DFC289] to-[#0D0D0F] shadow-md">
                <div className="w-full h-full rounded-full p-[2px] bg-[#F7F4EE] dark:bg-[#141519]">
                  <SmartImage
                    src={contact.photoUrl}
                    alt={contact.displayName}
                    className="w-full h-full rounded-full object-cover"
                    fallbackType="profile"
                    fullName={contact.displayName}
                  />
                </div>
              </div>
            </div>

            {/* Quick Emoji Reactions */}
            <div className="px-5 pb-4 flex items-center justify-center gap-2">
              {NOTE_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  disabled={sending}
                  onClick={() => handleSendReply(emoji)}
                  className="w-10 h-10 rounded-full bg-[#FFFFFF] dark:bg-[#1E2028] border border-[#E8E4DB] dark:border-neutral-700 hover:bg-[#F2EFE8] text-lg flex items-center justify-center active:scale-90 transition cursor-pointer shadow-2xs"
                >
                  {emoji}
                </button>
              ))}
            </div>

            {/* Direct Reply Bar */}
            <div className="px-4 py-3 bg-[#FFFFFF] dark:bg-[#191B20] border-t border-[#E8E4DB] dark:border-neutral-800 pb-safe">
              {sentConfirm ? (
                <div className="h-10 rounded-full bg-[#0D0D0F] dark:bg-[#C9A96E] text-[#F7F4EE] dark:text-[#0D0D0F] text-xs font-semibold flex items-center justify-center gap-1.5">
                  <Check className="w-4 h-4" />
                  <span>{sentConfirm}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleSendReply();
                      }
                    }}
                    placeholder={`Reply to ${firstName}'s note...`}
                    className="flex-1 h-10 px-4 rounded-full bg-[#F7F4EE] dark:bg-neutral-900 border border-[#E8E4DB] dark:border-neutral-700 text-xs text-[#0D0D0F] dark:text-white placeholder:text-[#71717A] outline-none focus:border-[#0D0D0F] dark:focus:border-[#C9A96E] transition"
                    autoFocus
                  />
                  <button
                    type="button"
                    disabled={!replyText.trim() || sending}
                    onClick={() => handleSendReply()}
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition shrink-0 ${
                      replyText.trim() && !sending
                        ? "bg-[#0D0D0F] dark:bg-[#C9A96E] text-[#F7F4EE] dark:text-[#0D0D0F] cursor-pointer active:scale-90"
                        : "bg-[#E8E4DB] dark:bg-neutral-800 text-[#71717A] cursor-not-allowed"
                    }`}
                    aria-label="Send reply"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
