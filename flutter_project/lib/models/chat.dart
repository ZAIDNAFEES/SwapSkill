import 'package:cloud_firestore/cloud_firestore.dart';
import 'user_profile.dart';

class Chat {
  final String id;
  final List<String> participantIds;
  final String lastMessage;
  final String lastMessageSenderId;
  final DateTime lastMessageTime;
  final Map<String, int> unreadCount;
  final List<String> pinnedUsers;
  final List<String> archivedUsers;
  final List<String> mutedUsers;
  final Map<String, bool> typingUsers;
  final bool isLegacy;
  final List<String> mergedChatIds;
  
  // Transient client properties
  UserProfile? otherUserProfile;
  String? otherUserId;

  Chat({
    required this.id,
    required this.participantIds,
    required this.lastMessage,
    required this.lastMessageSenderId,
    required this.lastMessageTime,
    this.unreadCount = const {},
    this.pinnedUsers = const [],
    this.archivedUsers = const [],
    this.mutedUsers = const [],
    this.typingUsers = const {},
    this.isLegacy = false,
    this.mergedChatIds = const [],
    this.otherUserProfile,
    this.otherUserId,
  });

  String? getOtherParticipant(String currentUserId) {
    if (otherUserId != null && otherUserId != currentUserId) {
      return otherUserId;
    }
    for (final id in participantIds) {
      if (id != currentUserId && id.isNotEmpty) {
        return id;
      }
    }
    return null;
  }

  int getUnreadFor(String currentUserId) {
    return unreadCount[currentUserId] ?? 0;
  }

  factory Chat.fromFirestore(DocumentSnapshot doc, {bool isLegacy = false}) {
    final data = doc.data() as Map<String, dynamic>? ?? {};

    DateTime msgTime = DateTime.now();
    if (data['lastMessageTime'] is Timestamp) {
      msgTime = (data['lastMessageTime'] as Timestamp).toDate();
    } else if (data['lastMessageTime'] is int) {
      msgTime = DateTime.fromMillisecondsSinceEpoch(data['lastMessageTime']);
    }

    Map<String, int> unreads = {};
    if (data['unreadCount'] is Map) {
      (data['unreadCount'] as Map).forEach((key, val) {
        unreads[key.toString()] = (val as num?)?.toInt() ?? 0;
      });
    }

    Map<String, bool> typing = {};
    if (data['typingUsers'] is Map) {
      (data['typingUsers'] as Map).forEach((key, val) {
        typing[key.toString()] = val == true;
      });
    }

    return Chat(
      id: doc.id,
      participantIds: List<String>.from(data['participantIds'] ?? []),
      lastMessage: data['lastMessage'] ?? '',
      lastMessageSenderId: data['lastMessageSenderId'] ?? '',
      lastMessageTime: msgTime,
      unreadCount: unreads,
      pinnedUsers: List<String>.from(data['pinnedUsers'] ?? []),
      archivedUsers: List<String>.from(data['archivedUsers'] ?? []),
      mutedUsers: List<String>.from(data['mutedUsers'] ?? []),
      typingUsers: typing,
      isLegacy: isLegacy || (data['isLegacy'] == true),
      mergedChatIds: List<String>.from(data['mergedChatIds'] ?? [doc.id]),
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'participantIds': participantIds,
      'lastMessage': lastMessage,
      'lastMessageSenderId': lastMessageSenderId,
      'lastMessageTime': Timestamp.fromDate(lastMessageTime),
      'unreadCount': unreadCount,
      'pinnedUsers': pinnedUsers,
      'archivedUsers': archivedUsers,
      'mutedUsers': mutedUsers,
      'typingUsers': typingUsers,
      'isLegacy': isLegacy,
    };
  }
}
