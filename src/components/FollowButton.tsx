import React from "react";
import { Loader2, UserPlus, UserCheck } from "lucide-react";

export interface FollowButtonProps {
  isFollowing: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void | Promise<void>;
  isLoading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  className?: string;
  showIcon?: boolean;
  followingText?: string;
  followText?: string;
}

export const FollowButton: React.FC<FollowButtonProps> = ({
  isFollowing,
  onClick,
  isLoading = false,
  disabled = false,
  fullWidth = false,
  className = "",
  showIcon = true,
  followingText = "Connected",
  followText = "Connect",
}) => {
  const isWFull = fullWidth || className.includes("w-full");
  const hasCustomHeight = className.includes("h-");

  if (isFollowing) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || isLoading}
        className={`glass-connected-btn rounded-xl font-medium cursor-pointer flex items-center justify-center gap-1.5 select-none ${
          isWFull ? "w-full min-w-0" : "min-w-[92px] shrink-0"
        } ${hasCustomHeight ? "" : "h-[38px]"} px-3.5 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        {isLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C9A96E] shrink-0" />
        ) : (
          <>
            {showIcon && (
              <UserCheck className="w-3.5 h-3.5 text-[#C9A96E] stroke-[2.2]" />
            )}
            <span className="truncate text-xs font-semibold text-[#0D0D0F] tracking-tight">{followingText}</span>
          </>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`glass-connect-btn rounded-xl font-medium cursor-pointer flex items-center justify-center gap-1.5 select-none ${
        isWFull ? "w-full min-w-0" : "min-w-[92px] shrink-0"
      } ${hasCustomHeight ? "" : "h-[38px]"} px-3.5 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {isLoading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#C9A96E] shrink-0" />
      ) : (
        <>
          {showIcon && (
            <UserPlus className="w-3.5 h-3.5 text-[#C9A96E] stroke-[2.2]" />
          )}
          <span className="truncate text-xs font-semibold text-[#0D0D0F] tracking-tight">{followText}</span>
        </>
      )}
    </button>
  );
};

export default FollowButton;
