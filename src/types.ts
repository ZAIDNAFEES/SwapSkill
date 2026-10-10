export interface UserProfile {
  uid: string;
  email: string;
  fullName: string;
  username: string;
  country: string;
  countryCode: string;
  city: string;
  languages: string[];
  skillsToTeach: string[];
  skillsToLearn: string[];
  bio: string;
  availability: string;
  timezone: string;
  createdAt: any; // Firestore Timestamp
  photoUrl: string;
  profilePhotoUrl?: string;
  coverUrl?: string;
  coverPhotoUrl?: string;
  followersCount: number;
  followingCount: number;
  points: number;
  sessionsCount: number;
  rating: number;
  reviewCount?: number;
  instagram?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  website?: string;
  followingList?: string[];
  followers?: string[];
  following?: string[];
  blockedUsers?: string[];
  verified?: boolean;
  displayName?: string;
  photoURL?: string;
  matchScore?: number;
  isStealthMode?: boolean;
  isOnlineVisible?: boolean;
  notificationSettings?: {
    // Sound & Haptic switches
    notificationSounds?: boolean;
    callRingtone?: boolean;
    chatSounds?: boolean;
    sessionReminderSounds?: boolean;
    vibrationFeedback?: boolean;
    
    // Notification Delivery switches
    directMessages?: boolean;
    bookingRequests?: boolean;
    newFollowers?: boolean;
    completedReviews?: boolean;
  };
}

export interface Chat {
  id: string;
  participantIds: string[];
  lastMessage: string;
  lastMessageSenderId: string;
  lastMessageTime: any; // Firestore Timestamp
  lastMessageAt?: any; // Firestore Timestamp
  updatedAt?: any;
  createdAt?: any;
  unreadCount: { [userId: string]: number };
  mutedUsers?: string[];
  pinnedUsers?: string[];
  archivedUsers?: string[];
  typingUsers?: { [userId: string]: boolean };
  isLegacy?: boolean;
  mergedChatIds?: string[];
  // Instagram-style Message Request System:
  requestStatus?: "pending" | "accepted" | "declined" | "deleted";
  requestedBy?: string; // UID of sender who initiated the request
  requestedTo?: string; // UID of recipient who received the request
  requestDeletedBy?: string[]; // UIDs of users who deleted/dismissed the request
  isRequest?: boolean;
}

export interface Message {
  id: string;
  senderId: string;
  text: string;
  timestamp: any; // Firestore Timestamp
  imageUrl?: string;
  audioUrl?: string;
  fileUrl?: string;
  fileType?: string;
  fileName?: string;
  fileSize?: number;
  isDeleted?: boolean;
  replyToId?: string;
  replyToText?: string;
  isEdited?: boolean;
  status?: 'sent' | 'delivered' | 'seen';
  isRead?: boolean;
  readAt?: any;
}

export interface Session {
  id: string;
  teacherId: string;
  learnerId: string;
  studentId?: string;
  senderId?: string;
  receiverId?: string;
  teacherName: string;
  learnerName: string;
  studentName?: string;
  teacherPhoto?: string;
  learnerPhoto?: string;
  teacherPhotoUrl?: string;
  learnerPhotoUrl?: string;
  skillName: string;
  skill?: string;
  teachSkill?: string;
  status: string;
  previousStatus?: string;
  deletedAt?: any; // Firestore Timestamp
  deletedBy?: string; // User UID who moved to trash
  scheduledTime: any; // Firestore Timestamp or Date or string
  sessionEndTime?: any; // Firestore Timestamp or Date or string
  meetingId?: string;
  callId?: string;
  livekitRoom?: string;
  createdAt: any; // Firestore Timestamp
  duration?: number; // duration in minutes (e.g. 30, 45, 60)
  sessionType?: string;
  notes?: string;
  timezone?: string;
  cancelReason?: string;
  cancelledBy?: string;
  // Post-session tracking & feedback
  liveParticipants?: string[];
  hasStartedLive?: boolean;
  sessionEnded?: boolean;
  isEnded?: boolean;
  meetingEnded?: boolean;
  isLive?: boolean;
  lastLeaveTime?: any;
  actualStartTime?: any;
  actualEndTime?: any;
  actualDuration?: string | number;
  completedAt?: any;
  rating?: number;
  feedbackText?: string;
  feedbackChips?: string[];
  reviewedBy?: string[];
}

export interface Review {
  id: string;
  sessionId: string;
  reviewerId: string;
  revieweeId: string;
  reviewerName: string;
  rating: number; // 1-5
  comment: string;
  createdAt: any; // Firestore Timestamp;
}

export const DEFAULT_AVATAR = "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 240'%3E%3Cdefs%3E%3Cmask id='cut-slash'%3E%3Crect x='0' y='0' width='240' height='240' fill='white' /%3E%3Cline x1='40' y1='40' x2='200' y2='200' stroke='black' stroke-width='16' stroke-linecap='round' /%3E%3C/mask%3E%3C/defs%3E%3Cg mask='url(%23cut-slash)'%3E%3Crect x='25' y='90' width='26' height='6' rx='2' fill='%23D4AF37' /%3E%3Crect x='35' y='80' width='6' height='26' rx='2' fill='%23D4AF37' /%3E%3Ccircle cx='130' cy='75' r='38' fill='%23D4AF37' /%3E%3Cpath d='M60,190 C60,145 90,132 130,132 C170,132 200,145 200,190 C200,205 60,205 60,190 Z' fill='%23D4AF37' /%3E%3C/g%3E%3Cline x1='40' y1='40' x2='200' y2='200' stroke='%23D4AF37' stroke-width='8' stroke-linecap='round' /%3E%3C/svg%3E";

/**
 * Resolves the canonical SwapSkill profile photo URL with strict priority:
 * 1. Explicitly uploaded custom SwapSkill profile picture (`profilePhotoUrl`)
 * 2. Standard SwapSkill profile photo field (`photoUrl`)
 * 3. Fallback to Google / Firebase Auth avatar only if no custom photo exists (`photoURL`)
 * 4. DEFAULT_AVATAR svg
 */
export function getUserProfilePhoto(
  profile?: Partial<UserProfile> | null,
  fallbackUser?: { photoURL?: string | null; photoUrl?: string | null } | null
): string {
  if (profile?.profilePhotoUrl && typeof profile.profilePhotoUrl === "string" && profile.profilePhotoUrl.trim()) {
    return profile.profilePhotoUrl.trim();
  }
  if (profile?.photoUrl && typeof profile.photoUrl === "string" && profile.photoUrl.trim()) {
    return profile.photoUrl.trim();
  }
  if ((profile as any)?.avatar && typeof (profile as any).avatar === "string" && (profile as any).avatar.trim()) {
    return (profile as any).avatar.trim();
  }
  if (profile?.photoURL && typeof profile.photoURL === "string" && profile.photoURL.trim()) {
    return profile.photoURL.trim();
  }
  if (fallbackUser?.photoUrl && typeof fallbackUser.photoUrl === "string" && fallbackUser.photoUrl.trim()) {
    return fallbackUser.photoUrl.trim();
  }
  if (fallbackUser?.photoURL && typeof fallbackUser.photoURL === "string" && fallbackUser.photoURL.trim()) {
    return fallbackUser.photoURL.trim();
  }
  return DEFAULT_AVATAR;
}


