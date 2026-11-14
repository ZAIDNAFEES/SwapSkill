import React from "react";
import { ExternalLink, Globe } from "lucide-react";
import { getLinkMetadata } from "../../utils/linkPreview";

interface LinkPreviewCardProps {
  url: string;
  isSelf?: boolean;
}

export const LinkPreviewCard: React.FC<LinkPreviewCardProps> = ({ url, isSelf = false }) => {
  const metadata = React.useMemo(() => getLinkMetadata(url), [url]);

  return (
    <a
      href={metadata.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`group block mt-1.5 rounded-xl overflow-hidden border transition-all duration-150 ${
        isSelf
          ? "bg-black/10 dark:bg-white/10 hover:bg-black/15 dark:hover:bg-white/15 border-black/10 dark:border-white/15"
          : "bg-zinc-800/80 hover:bg-zinc-800 border-zinc-700/60"
      }`}
    >
      {/* Thumbnail Banner if available */}
      {metadata.imageUrl && (
        <div className="relative w-full h-32 sm:h-36 overflow-hidden bg-black/40">
          <img
            src={metadata.imageUrl}
            alt={metadata.title}
            className="w-full h-full object-cover group-hover:scale-103 transition-transform duration-200"
            loading="lazy"
            onError={(e) => {
              // Hide image container on broken image link
              (e.target as HTMLElement).parentElement?.classList.add("hidden");
            }}
          />
        </div>
      )}

      {/* Content Details */}
      <div className="p-2.5 flex items-start gap-2.5">
        {metadata.faviconUrl ? (
          <img
            src={metadata.faviconUrl}
            alt=""
            className="w-4 h-4 rounded-xs shrink-0 mt-0.5 object-contain"
            onError={(e) => {
              (e.target as HTMLElement).style.display = "none";
            }}
          />
        ) : (
          <Globe size={14} className="shrink-0 mt-0.5 opacity-60" />
        )}

        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold tracking-tight truncate leading-snug group-hover:underline">
            {metadata.title}
          </p>
          {metadata.description && (
            <p className="text-[10px] opacity-75 truncate mt-0.5 leading-tight">
              {metadata.description}
            </p>
          )}
          <span className="inline-flex items-center gap-1 text-[9px] uppercase tracking-wider font-mono opacity-60 mt-1">
            <span>{metadata.domain}</span>
            <ExternalLink size={9} />
          </span>
        </div>
      </div>
    </a>
  );
};
