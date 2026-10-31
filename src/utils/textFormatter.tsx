import React from "react";

/**
 * Parses chat message text for standard WhatsApp/Telegram Markdown-style formatting:
 * - *bold*
 * - _italic_
 * - ~strikethrough~
 * - `inline code`
 * 
 * Safely returns React elements without using dangerouslySetInnerHTML.
 */
export function formatChatText(text: string): React.ReactNode {
  if (!text) return "";

  // Regular expression matching:
  // 1. `code`
  // 2. *bold*
  // 3. _italic_
  // 4. ~strikethrough~
  const regex = /(`[^`]+`|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
  const parts = text.split(regex);

  if (parts.length === 1) {
    return text;
  }

  return parts.map((part, index) => {
    if (!part) return null;

    // `code`
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code
          key={index}
          className="font-mono text-[12px] px-1 py-0.5 rounded bg-black/15 dark:bg-white/15 text-inherit"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    // *bold*
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return (
        <strong key={index} className="font-bold text-inherit">
          {part.slice(1, -1)}
        </strong>
      );
    }

    // _italic_
    if (part.startsWith("_") && part.endsWith("_") && part.length > 2) {
      return (
        <em key={index} className="italic text-inherit">
          {part.slice(1, -1)}
        </em>
      );
    }

    // ~strikethrough~
    if (part.startsWith("~") && part.endsWith("~") && part.length > 2) {
      return (
        <span key={index} className="line-through opacity-80 text-inherit">
          {part.slice(1, -1)}
        </span>
      );
    }

    return <React.Fragment key={index}>{part}</React.Fragment>;
  });
}
