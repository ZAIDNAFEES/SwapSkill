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
        className={`glass-connected-btn rounded-xl font-semibold cursor-pointer flex items-center justify-center gap-1.5 select-none whitespace-nowrap ${
          isWFull ? "w-full min-w-0" : "min-w-[100px] shrink-0"
        } ${hasCustomHeight ? "" : "h-10"} px-3.5 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        {isLoading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#52525B] shrink-0" />
        ) : (
          <>
            {showIcon && (
              <UserCheck className="w-3.5 h-3.5 text-[#52525B] stroke-[2.1] shrink-0" />
            )}
            <span className="truncate text-[13px] font-semibold text-[#0D0D0F] tracking-normal">{followingText}</span>
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
      className={`glass-connect-btn rounded-xl font-semibold cursor-pointer flex items-center justify-center gap-1.5 select-none whitespace-nowrap ${
        isWFull ? "w-full min-w-0" : "min-w-[100px] shrink-0"
      } ${hasCustomHeight ? "" : "h-10"} px-3.5 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {isLoading ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#F7F4EE] shrink-0" />
      ) : (
        <>
          {showIcon && (
            <UserPlus className="w-3.5 h-3.5 text-[#F7F4EE] stroke-[2.1] shrink-0" />
          )}
          <span className="truncate text-[13px] font-semibold text-[#F7F4EE] tracking-normal">{followText}</span>
        </>
      )}
    </button>
  );
};

export default FollowButton;
