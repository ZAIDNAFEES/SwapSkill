import 'package:cloud_firestore/cloud_firestore.dart';

class SwapSession {
  final String id;
  final String teacherId;
  final String learnerId;
  final String teacherName;
  final String learnerName;
  final String skillName;
  final String status; // 'requested' | 'pending' | 'accepted' | 'declined' | 'completed' | 'cancelled'
  final DateTime scheduledTime;
  final String jitsiRoom;
  final String? meetingId;
  final DateTime createdAt;
  final int duration; // in minutes
  final String? sessionType;
  final String? notes;
  final String? timezone;
  final String? cancelReason;
  final String? cancelledBy;

  SwapSession({
    required this.id,
    required this.teacherId,
    required this.learnerId,
    required this.teacherName,
    required this.learnerName,
    required this.skillName,
    required this.status,
    required this.scheduledTime,
    required this.jitsiRoom,
    this.meetingId,
    required this.createdAt,
    this.duration = 45,
    this.sessionType = 'Skill Exchange',
    this.notes,
    this.timezone = 'UTC',
    this.cancelReason,
    this.cancelledBy,
  });

  bool isParticipant(String userId) => teacherId == userId || learnerId == userId;
  bool isTeacher(String userId) => teacherId == userId;
  bool isLearner(String userId) => learnerId == userId;

  String getOtherUserName(String currentUserId) {
    return currentUserId == teacherId ? learnerName : teacherName;
  }

  String getOtherUserId(String currentUserId) {
    return currentUserId == teacherId ? learnerId : teacherId;
  }

  bool get isAccepted => status.toLowerCase() == 'accepted';
  bool get isPending => status.toLowerCase() == 'requested' || status.toLowerCase() == 'pending';
  bool get isCompleted => status.toLowerCase() == 'completed';
  bool get isCancelled => status.toLowerCase() == 'cancelled' || status.toLowerCase() == 'declined';

  factory SwapSession.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? {};

    DateTime sched = DateTime.now();
    if (data['scheduledTime'] is Timestamp) {
      sched = (data['scheduledTime'] as Timestamp).toDate();
    } else if (data['scheduledTime'] is int) {
      sched = DateTime.fromMillisecondsSinceEpoch(data['scheduledTime']);
    }

    DateTime created = DateTime.now();
    if (data['createdAt'] is Timestamp) {
      created = (data['createdAt'] as Timestamp).toDate();
    } else if (data['createdAt'] is int) {
      created = DateTime.fromMillisecondsSinceEpoch(data['createdAt']);
    }

    return SwapSession(
      id: doc.id,
      teacherId: data['teacherId'] ?? '',
      learnerId: data['learnerId'] ?? data['studentId'] ?? '',
      teacherName: data['teacherName'] ?? 'Teacher',
      learnerName: data['learnerName'] ?? data['studentName'] ?? 'Learner',
      skillName: data['skillName'] ?? data['skill'] ?? 'Craft',
      status: data['status'] ?? 'pending',
      scheduledTime: sched,
      jitsiRoom: data['jitsiRoom'] ?? 'swapskill_${doc.id}',
      meetingId: data['meetingId'],
      createdAt: created,
      duration: (data['duration'] as num?)?.toInt() ?? 45,
      sessionType: data['sessionType'] ?? 'Skill Exchange',
      notes: data['notes'],
      timezone: data['timezone'] ?? 'UTC',
      cancelReason: data['cancelReason'],
      cancelledBy: data['cancelledBy'],
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'teacherId': teacherId,
      'learnerId': learnerId,
      'teacherName': teacherName,
      'learnerName': learnerName,
      'skillName': skillName,
      'status': status,
      'scheduledTime': Timestamp.fromDate(scheduledTime),
      'jitsiRoom': jitsiRoom,
      'meetingId': meetingId,
      'createdAt': Timestamp.fromDate(createdAt),
      'duration': duration,
      'sessionType': sessionType,
      'notes': notes,
      'timezone': timezone,
      'cancelReason': cancelReason,
      'cancelledBy': cancelledBy,
    };
  }
}
