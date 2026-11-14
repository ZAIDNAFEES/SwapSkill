import 'dart:async';
import 'package:flutter/foundation.dart';
import '../models/chat.dart';
import '../models/user_profile.dart';
import '../services/conversation_service.dart';
import '../services/firestore_service.dart';

class ChatProvider extends ChangeNotifier {
  final ConversationService _conversationService = ConversationService();
  final FirestoreService _firestoreService = FirestoreService();

  List<Chat> _chats = [];
  List<Chat> get chats => _chats;

  final Map<String, UserProfile> _cachedProfiles = {};
  Map<String, UserProfile> get cachedProfiles => _cachedProfiles;

  int _totalUnreadCount = 0;
  int get totalUnreadCount => _totalUnreadCount;

  String? _currentUserId;
  StreamSubscription<List<Chat>>? _chatsSubscription;

  void init(String currentUserId) {
    if (_currentUserId == currentUserId && _chatsSubscription != null) return;
    _currentUserId = currentUserId;

    _chatsSubscription?.cancel();
    _chatsSubscription = _conversationService.streamUserConversations(currentUserId).listen((chatList) async {
      _chats = chatList;
      _calculateTotalUnread();

      // Resolve other user profiles for chats
      for (final chat in _chats) {
        final otherId = chat.getOtherParticipant(currentUserId);
        if (otherId != null && !_cachedProfiles.containsKey(otherId)) {
          final profile = await _firestoreService.getUserProfile(otherId);
          if (profile != null) {
            _cachedProfiles[otherId] = profile;
            chat.otherUserProfile = profile;
          }
        } else if (otherId != null) {
          chat.otherUserProfile = _cachedProfiles[otherId];
        }
      }

      notifyListeners();
    });
  }

  void _calculateTotalUnread() {
    if (_currentUserId == null) {
      _totalUnreadCount = 0;
      return;
    }
    int count = 0;
    for (final chat in _chats) {
      count += chat.getUnreadFor(_currentUserId!);
    }
    _totalUnreadCount = count;
  }

  Future<UserProfile?> getOrFetchProfile(String userId) async {
    if (_cachedProfiles.containsKey(userId)) {
      return _cachedProfiles[userId];
    }
    final p = await _firestoreService.getUserProfile(userId);
    if (p != null) {
      _cachedProfiles[userId] = p;
      notifyListeners();
    }
    return p;
  }

  @override
  void dispose() {
    _chatsSubscription?.cancel();
    super.dispose();
  }
}
