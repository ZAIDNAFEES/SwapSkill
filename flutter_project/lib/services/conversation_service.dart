import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/chat.dart';
import '../models/message.dart';

class ConversationService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  // Deterministic Canonical Conversation Key
  String getCanonicalKey(String uid1, String uid2) {
    final list = [uid1.trim(), uid2.trim()]..sort();
    return list.join('_');
  }

  // Get or Create Exactly ONE Canonical Conversation Document (Prevents Duplicates)
  Future<String> getOrCreateConversation({
    required String currentUserId,
    required String otherUserId,
    String? initialLastMessage,
  }) async {
    if (currentUserId == otherUserId) {
      throw Exception('Cannot chat with yourself');
    }

    final canonicalId = getCanonicalKey(currentUserId, otherUserId);
    final participantIds = [currentUserId.trim(), otherUserId.trim()]..sort();

    // 1. Check conversations collection by canonical ID
    final convDoc = await _db.collection('conversations').doc(canonicalId).get();
    if (convDoc.exists) {
      return canonicalId;
    }

    // 2. Check legacy chats collection by canonical ID
    final chatDoc = await _db.collection('chats').doc(canonicalId).get();
    if (chatDoc.exists) {
      return canonicalId;
    }

    // 3. Query existing conversation by participantIds array
    final querySnap = await _db
        .collection('conversations')
        .where('participantIds', arrayContains: currentUserId.trim())
        .get();

    for (final doc in querySnap.docs) {
      final parts = List<String>.from(doc.data()['participantIds'] ?? []);
      if (parts.contains(otherUserId.trim())) {
        return doc.id;
      }
    }

    // 4. Create new canonical conversation
    final initData = {
      'id': canonicalId,
      'participantIds': participantIds,
      'lastMessage': initialLastMessage ?? 'Conversation started',
      'lastMessageSenderId': currentUserId,
      'lastMessageTime': FieldValue.serverTimestamp(),
      'unreadCount': {
        currentUserId: 0,
        otherUserId: 0,
      },
      'isLegacy': false,
    };

    await _db.collection('conversations').doc(canonicalId).set(initData);
    return canonicalId;
  }

  // Stream all conversations for a user
  Stream<List<Chat>> streamUserConversations(String currentUserId) {
    return _db
        .collection('conversations')
        .where('participantIds', arrayContains: currentUserId)
        .snapshots()
        .map((snap) {
      final list = snap.docs.map((doc) => Chat.fromFirestore(doc)).toList();
      // Sort conversations stably by lastMessageTime descending
      list.sort((a, b) => b.lastMessageTime.compareTo(a.lastMessageTime));
      return list;
    });
  }

  // Stream messages for a conversation
  Stream<List<Message>> streamMessages(String chatId, {int limit = 60, bool isLegacy = false}) {
    final collectionName = isLegacy ? 'chats' : 'conversations';
    return _db
        .collection(collectionName)
        .doc(chatId)
        .collection('messages')
        .orderBy('timestamp', descending: true)
        .limit(limit)
        .snapshots()
        .map((snap) => snap.docs.map((doc) => Message.fromFirestore(doc)).toList());
  }

  // Send Message
  Future<void> sendMessage({
    required String chatId,
    required String currentUserId,
    required String otherUserId,
    required String text,
    String? imageUrl,
    String? audioUrl,
    String? fileUrl,
    String? fileName,
    int? fileSize,
    String? replyToId,
    String? replyToText,
    bool isLegacy = false,
  }) async {
    final collectionName = isLegacy ? 'chats' : 'conversations';
    final chatRef = _db.collection(collectionName).doc(chatId);
    final msgCol = chatRef.collection('messages');

    final msgData = {
      'senderId': currentUserId,
      'text': text,
      'timestamp': FieldValue.serverTimestamp(),
      'imageUrl': imageUrl,
      'audioUrl': audioUrl,
      'fileUrl': fileUrl,
      'fileName': fileName,
      'fileSize': fileSize,
      'replyToId': replyToId,
      'replyToText': replyToText,
      'status': 'sent',
      'isDeleted': false,
      'isEdited': false,
    };

    // Add message
    await msgCol.add(msgData);

    // Update conversation metadata
    String displayLastMsg = text;
    if (text.isEmpty && imageUrl != null) displayLastMsg = '📷 Photo';
    if (text.isEmpty && audioUrl != null) displayLastMsg = '🎤 Voice note';
    if (text.isEmpty && fileUrl != null) displayLastMsg = '📎 Document';

    await chatRef.set({
      'lastMessage': displayLastMsg,
      'lastMessageSenderId': currentUserId,
      'lastMessageTime': FieldValue.serverTimestamp(),
      'unreadCount': {
        otherUserId: FieldValue.increment(1),
        currentUserId: 0,
      }
    }, SetOptions(merge: true));
  }

  // Mark conversation as read
  Future<void> markConversationAsRead(String chatId, String currentUserId, {bool isLegacy = false}) async {
    final collectionName = isLegacy ? 'chats' : 'conversations';
    await _db.collection(collectionName).doc(chatId).set({
      'unreadCount': {
        currentUserId: 0,
      }
    }, SetOptions(merge: true));
  }

  // Update Typing status
  Future<void> setTypingStatus(String chatId, String currentUserId, bool isTyping, {bool isLegacy = false}) async {
    final collectionName = isLegacy ? 'chats' : 'conversations';
    await _db.collection(collectionName).doc(chatId).set({
      'typingUsers': {
        currentUserId: isTyping,
      }
    }, SetOptions(merge: true));
  }
}
