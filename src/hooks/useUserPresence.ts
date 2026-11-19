import { useState, useEffect } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";

export type PresenceState = "active" | "idle" | "offline";

export interface UserPresence {
  status: PresenceState;
  colorClass: string;
  lastSeen: Date | null;
}

export function useUserPresence(userId: string | undefined): UserPresence {
  const [presence, setPresence] = useState<UserPresence>({
    status: "offline",
    colorClass: "bg-zinc-500",
    lastSeen: null,
  });

  useEffect(() => {
    if (!userId) {
      setPresence({ status: "offline", colorClass: "bg-zinc-500", lastSeen: null });
      return;
    }

    const presenceRef = doc(db, "userPresence", userId);
    const unsubscribe = onSnapshot(
      presenceRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setPresence({ status: "offline", colorClass: "bg-zinc-500", lastSeen: null });
          return;
        }

        const data = snapshot.data();
        const rawLastSeen = data.lastSeen;
        const lastSeenDate = rawLastSeen?.toDate ? rawLastSeen.toDate() : rawLastSeen ? new Date(rawLastSeen) : null;
        const statusVal = data.status || "offline";

        if (statusVal === "offline" || !lastSeenDate) {
          setPresence({
            status: "offline",
            colorClass: "bg-zinc-500",
            lastSeen: lastSeenDate,
          });
          return;
        }

        // Calculate time diff in minutes
        const diffMs = Date.now() - lastSeenDate.getTime();
        const diffMins = diffMs / 1000 / 60;

        let status: PresenceState = "offline";
        let colorClass = "bg-zinc-500";

        if (statusVal === "online" && diffMins <= 1.5) {
          status = "active";
          colorClass = "bg-emerald-500";
        } else if (diffMins <= 10) {
          status = "idle";
          colorClass = "bg-amber-500";
        } else {
          status = "offline";
          colorClass = "bg-zinc-500";
        }

        setPresence({
          status,
          colorClass,
          lastSeen: lastSeenDate,
        });
      },
      (error) => {
        console.error("Error reading user presence:", error);
      }
    );

    return () => unsubscribe();
  }, [userId]);

  return presence;
}
