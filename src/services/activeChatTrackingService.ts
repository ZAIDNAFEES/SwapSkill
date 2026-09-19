/**
 * Active Chat & Visibility Tracking Service
 * 
 * Provides centralized, real-time tracking of whether a chat is currently
 * open and actively viewed by the user. Used to suppress push/in-app notifications
 * for the chat that is currently visible on screen, while preserving notifications
 * for background, screen-off, closed app, or other conversations.
 */

class ActiveChatTrackingService {
  private activeChatId: string | null = null;
  private activePartnerId: string | null = null;
  private activeParticipantIds: Set<string> = new Set();
  private isMessagesTabActive = false;

  /**
   * Updates the currently open chat in the UI.
   * Pass null or empty chatId when the chat is closed/exited.
   */
  public setActiveChat(params: {
    chatId: string | null;
    partnerId?: string | null;
    participantIds?: string[];
  } | null): void {
    if (!params || !params.chatId) {
      this.activeChatId = null;
      this.activePartnerId = null;
      this.activeParticipantIds.clear();
      return;
    }

    this.activeChatId = params.chatId;
    this.activePartnerId = params.partnerId || null;
    this.activeParticipantIds = new Set(params.participantIds || []);
    if (params.partnerId) {
      this.activeParticipantIds.add(params.partnerId);
    }
  }

  /**
   * Updates whether the main Messages navigation tab is currently visible
   */
  public setTab(tab: string): void {
    this.isMessagesTabActive = tab === "messages";
  }

  public getActiveChatId(): string | null {
    return this.activeChatId;
  }

  public getActivePartnerId(): string | null {
    return this.activePartnerId;
  }

  /**
   * Determines if a specific chat is currently open and visible on screen.
   * Returns true ONLY when:
   * 1. The document/app is visible in the foreground (not screen-off or backgrounded).
   * 2. The Messages tab is active.
   * 3. A chat is actively open.
   * 4. The incoming message matches the active chat ID or partner/participant.
   */
  public isChatCurrentlyOpenAndVisible(chatId?: string | null, senderId?: string | null): boolean {
    // 1. If screen is off, minimized, or document is hidden -> NOT visible (notifications MUST trigger)
    if (typeof document !== "undefined" && document.visibilityState !== "visible") {
      return false;
    }

    // 2. User must be in the messages tab
    if (!this.isMessagesTabActive) {
      return false;
    }

    // 3. User must have a chat open
    if (!this.activeChatId) {
      return false;
    }

    // 4. Check chat ID equality or canonical relationship
    if (chatId) {
      if (chatId === this.activeChatId) return true;
      if (this.activeChatId.includes(chatId) || chatId.includes(this.activeChatId)) return true;
    }

    // 5. Check sender ID against active partner or participant IDs
    if (senderId) {
      if (this.activePartnerId && this.activePartnerId === senderId) {
        return true;
      }
      if (this.activeParticipantIds.has(senderId)) {
        return true;
      }
      if (this.activeChatId.includes(senderId)) {
        return true;
      }
    }

    return false;
  }
}

export const activeChatTrackingService = new ActiveChatTrackingService();
