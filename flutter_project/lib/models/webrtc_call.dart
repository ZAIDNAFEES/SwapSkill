import 'package:cloud_firestore/cloud_firestore.dart';

enum CallStatus {
  idle,
  requestingMedia,
  calling,
  ringing,
  connecting,
  connected,
  reconnecting,
  ended,
  rejected,
  failed,
  missed
}

class WebRTCCallDoc {
  final String id;
  final String swapSessionId;
  final String callerId;
  final String calleeId;
  final String callerName;
  final String? callerPhoto;
  final String calleeName;
  final String? calleePhoto;
  final CallStatus status;
  final Map<String, dynamic>? offer;
  final Map<String, dynamic>? answer;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? endedAt;

  WebRTCCallDoc({
    required this.id,
    required this.swapSessionId,
    required this.callerId,
    required this.calleeId,
    required this.callerName,
    this.callerPhoto,
    required this.calleeName,
    this.calleePhoto,
    required this.status,
    this.offer,
    this.answer,
    required this.createdAt,
    required this.updatedAt,
    this.endedAt,
  });

  static CallStatus parseStatus(String? statusStr) {
    switch (statusStr) {
      case 'calling':
        return CallStatus.calling;
      case 'ringing':
        return CallStatus.ringing;
      case 'connecting':
        return CallStatus.connecting;
      case 'connected':
        return CallStatus.connected;
      case 'reconnecting':
        return CallStatus.reconnecting;
      case 'ended':
        return CallStatus.ended;
      case 'rejected':
        return CallStatus.rejected;
      case 'failed':
        return CallStatus.failed;
      case 'missed':
        return CallStatus.missed;
      default:
        return CallStatus.idle;
    }
  }

  static String statusToString(CallStatus st) {
    switch (st) {
      case CallStatus.calling:
        return 'calling';
      case CallStatus.ringing:
        return 'ringing';
      case CallStatus.connecting:
        return 'connecting';
      case CallStatus.connected:
        return 'connected';
      case CallStatus.reconnecting:
        return 'reconnecting';
      case CallStatus.ended:
        return 'ended';
      case CallStatus.rejected:
        return 'rejected';
      case CallStatus.failed:
        return 'failed';
      case CallStatus.missed:
        return 'missed';
      default:
        return 'idle';
    }
  }

  factory WebRTCCallDoc.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? {};

    DateTime created = DateTime.now();
    if (data['createdAt'] is Timestamp) {
      created = (data['createdAt'] as Timestamp).toDate();
    } else if (data['createdAt'] is int) {
      created = DateTime.fromMillisecondsSinceEpoch(data['createdAt']);
    }

    DateTime updated = DateTime.now();
    if (data['updatedAt'] is Timestamp) {
      updated = (data['updatedAt'] as Timestamp).toDate();
    } else if (data['updatedAt'] is int) {
      updated = DateTime.fromMillisecondsSinceEpoch(data['updatedAt']);
    }

    DateTime? ended;
    if (data['endedAt'] is Timestamp) {
      ended = (data['endedAt'] as Timestamp).toDate();
    } else if (data['endedAt'] is int) {
      ended = DateTime.fromMillisecondsSinceEpoch(data['endedAt']);
    }

    return WebRTCCallDoc(
      id: doc.id,
      swapSessionId: data['swapSessionId'] ?? '',
      callerId: data['callerId'] ?? '',
      calleeId: data['calleeId'] ?? '',
      callerName: data['callerName'] ?? 'Caller',
      callerPhoto: data['callerPhoto'],
      calleeName: data['calleeName'] ?? 'Callee',
      calleePhoto: data['calleePhoto'],
      status: parseStatus(data['status']),
      offer: data['offer'] as Map<String, dynamic>?,
      answer: data['answer'] as Map<String, dynamic>?,
      createdAt: created,
      updatedAt: updated,
      endedAt: ended,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'swapSessionId': swapSessionId,
      'callerId': callerId,
      'calleeId': calleeId,
      'callerName': callerName,
      'callerPhoto': callerPhoto,
      'calleeName': calleeName,
      'calleePhoto': calleePhoto,
      'status': statusToString(status),
      'offer': offer,
      'answer': answer,
      'createdAt': Timestamp.fromDate(createdAt),
      'updatedAt': Timestamp.fromDate(updatedAt),
      'endedAt': endedAt != null ? Timestamp.fromDate(endedAt!) : null,
    };
  }
}
