import 'package:cloud_firestore/cloud_firestore.dart';

class NotificationItem {
  final String id;
  final String type; // 'follower' | 'session_request' | 'session_accepted' | 'review' | 'chat'
  final String senderId;
  final String senderName;
  final String? senderPhoto;
  final String? referenceId;
  final String message;
  final bool read;
  final DateTime createdAt;

  NotificationItem({
    required this.id,
    required this.type,
    required this.senderId,
    required this.senderName,
    this.senderPhoto,
    this.referenceId,
    required this.message,
    this.read = false,
    required this.createdAt,
  });

  factory NotificationItem.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? {};

    DateTime created = DateTime.now();
    if (data['createdAt'] is Timestamp) {
      created = (data['createdAt'] as Timestamp).toDate();
    } else if (data['createdAt'] is int) {
      created = DateTime.fromMillisecondsSinceEpoch(data['createdAt']);
    }

    return NotificationItem(
      id: doc.id,
      type: data['type'] ?? 'general',
      senderId: data['senderId'] ?? '',
      senderName: data['senderName'] ?? 'Member',
      senderPhoto: data['senderPhoto'],
      referenceId: data['referenceId'],
      message: data['message'] ?? '',
      read: data['read'] == true,
      createdAt: created,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'type': type,
      'senderId': senderId,
      'senderName': senderName,
      'senderPhoto': senderPhoto,
      'referenceId': referenceId,
      'message': message,
      'read': read,
      'createdAt': Timestamp.fromDate(createdAt),
    };
  }
}
