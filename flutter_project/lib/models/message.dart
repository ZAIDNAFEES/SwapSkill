import 'package:cloud_firestore/cloud_firestore.dart';

enum MessageStatus { sent, delivered, seen }

class Message {
  final String id;
  final String senderId;
  final String text;
  final DateTime timestamp;
  final String? imageUrl;
  final String? audioUrl;
  final String? fileUrl;
  final String? fileName;
  final int? fileSize;
  final bool isDeleted;
  final bool isEdited;
  final String? replyToId;
  final String? replyToText;
  final MessageStatus status;

  Message({
    required this.id,
    required this.senderId,
    required this.text,
    required this.timestamp,
    this.imageUrl,
    this.audioUrl,
    this.fileUrl,
    this.fileName,
    this.fileSize,
    this.isDeleted = false,
    this.isEdited = false,
    this.replyToId,
    this.replyToText,
    this.status = MessageStatus.sent,
  });

  factory Message.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? {};

    DateTime time = DateTime.now();
    if (data['timestamp'] is Timestamp) {
      time = (data['timestamp'] as Timestamp).toDate();
    } else if (data['timestamp'] is int) {
      time = DateTime.fromMillisecondsSinceEpoch(data['timestamp']);
    }

    MessageStatus st = MessageStatus.sent;
    final statusStr = data['status']?.toString().toLowerCase();
    if (statusStr == 'seen' || statusStr == 'read') {
      st = MessageStatus.seen;
    } else if (statusStr == 'delivered') {
      st = MessageStatus.delivered;
    }

    return Message(
      id: doc.id,
      senderId: data['senderId'] ?? '',
      text: data['text'] ?? '',
      timestamp: time,
      imageUrl: data['imageUrl'],
      audioUrl: data['audioUrl'],
      fileUrl: data['fileUrl'],
      fileName: data['fileName'],
      fileSize: (data['fileSize'] as num?)?.toInt(),
      isDeleted: data['isDeleted'] == true || data['deleted'] == true,
      isEdited: data['isEdited'] == true,
      replyToId: data['replyToId'],
      replyToText: data['replyToText'],
      status: st,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'senderId': senderId,
      'text': text,
      'timestamp': Timestamp.fromDate(timestamp),
      'imageUrl': imageUrl,
      'audioUrl': audioUrl,
      'fileUrl': fileUrl,
      'fileName': fileName,
      'fileSize': fileSize,
      'isDeleted': isDeleted,
      'isEdited': isEdited,
      'replyToId': replyToId,
      'replyToText': replyToText,
      'status': status.name,
    };
  }
}
