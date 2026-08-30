import React from "react";
import { Home, Search, MessageSquare, Calendar, User } from "lucide-react";
import { motion } from "motion/react";

export type TabType = "home" | "search" | "messages" | "sessions" | "profile";

interface NavigationProps {
  activeTab: TabType;
  onChangeTab: (tab: TabType) => void;
  unreadMessagesCount?: number;
  pendingSessionsCount?: number;
}

export default function Navigation({
  activeTab,
  onChangeTab,
  unreadMessagesCount = 0,
  pendingSessionsCount = 0
}: NavigationProps) {
  const navItems = [
    {
      id: "home" as TabType,
      label: "Discover",
      icon: <Home className="w-[19px] h-[19px]" strokeWidth={1.8} />,
      badge: 0
    },
    {
      id: "search" as TabType,
      label: "Explore",
      icon: <Search className="w-[19px] h-[19px]" strokeWidth={1.8} />,
      badge: 0
    },
    {
      id: "messages" as TabType,
      label: "Chats",
      icon: <MessageSquare className="w-[19px] h-[19px]" strokeWidth={1.8} />,
      badge: unreadMessagesCount
    },
    {
      id: "sessions" as TabType,
      label: "Sessions",
      icon: <Calendar className="w-[19px] h-[19px]" strokeWidth={1.8} />,
      badge: pendingSessionsCount
    },
    {
      id: "profile" as TabType,
      label: "Profile",
      icon: <User className="w-[19px] h-[19px]" strokeWidth={1.8} />,
      badge: 0
    }
  ];

  const handleTabClick = (tabId: TabType) => {
    if (typeof window !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(6);
      } catch (_) {}
    }
    onChangeTab(tabId);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 w-full bg-[#FFFFFF]/95 backdrop-blur-md border-t border-[#E8E4DB] pb-[max(env(safe-area-inset-bottom),10px)] pt-2 select-none shadow-[0_-2px_12px_rgba(13,13,15,0.03)]">
      <div className="max-w-md mx-auto px-4">
        <div className="h-[48px] flex items-center justify-around relative">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                id={`luxury-nav-${item.id}`}
                key={item.id}
                onClick={() => handleTabClick(item.id)}
                className="flex-1 flex flex-col items-center justify-center h-full relative cursor-pointer focus:outline-none group py-0.5"
                aria-label={item.label}
              >
                {/* Active Indicator Bar at top of item */}
                <div className="relative flex items-center justify-center w-12 h-6 mb-1">
                  {isActive && (
                    <motion.div
                      layoutId="luxuryActiveIndicator"
                      transition={{ type: "spring", stiffness: 500, damping: 40 }}
                      className="absolute -top-1 w-6 h-[2px] bg-[#C9A96E] rounded-full"
                    />
                  )}

                  {/* Icon & Badge */}
                  <div className={`relative z-10 transition-colors duration-200 flex items-center justify-center ${
                    isActive ? "text-[#0D0D0F]" : "text-[#71717A] group-hover:text-[#0D0D0F]"
                  }`}>
                    {item.icon}

                    {/* Notification Badge */}
                    {item.badge > 0 && (
                      <span className={`absolute -top-1.5 -right-2 min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center shadow-xs ${
                        item.id === "sessions"
                          ? "bg-[#EF4444] text-white border border-white"
                          : "bg-[#0D0D0F] border border-[#C9A96E]/40 text-[#F7F4EE]"
                      }`}>
                        {item.badge > 99 ? "99+" : item.badge}
                      </span>
                    )}
                  </div>
                </div>

                {/* Label Text */}
                <span className={`text-[10px] tracking-tight transition-all duration-200 ${
                  isActive ? "text-[#0D0D0F] font-semibold" : "text-[#71717A] font-normal group-hover:text-[#0D0D0F]"
                }`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
