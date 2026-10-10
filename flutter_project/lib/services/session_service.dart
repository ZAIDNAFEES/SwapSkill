import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/session.dart';
import '../models/review.dart';

class SessionService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  // Stream all swap sessions for a user
  Stream<List<SwapSession>> streamUserSessions(String userId) {
    return _db.collection('sessions').snapshots().map((snap) {
      final list = snap.docs
          .map((doc) => SwapSession.fromFirestore(doc))
          .where((s) => s.teacherId == userId || s.learnerId == userId)
          .toList();
      // Sort by scheduledTime or createdAt descending
      list.sort((a, b) => b.scheduledTime.compareTo(a.scheduledTime));
      return list;
    });
  }

  // Create / Request a new Swap Session
  Future<String> requestSwapSession({
    required String teacherId,
    required String learnerId,
    required String teacherName,
    required String learnerName,
    required String skillName,
    required DateTime scheduledTime,
    int duration = 45,
    String? notes,
  }) async {
    final docRef = _db.collection('sessions').doc();
    final jitsiRoom = 'swapskill_${docRef.id}';

    final session = SwapSession(
      id: docRef.id,
      teacherId: teacherId,
      learnerId: learnerId,
      teacherName: teacherName,
      learnerName: learnerName,
      skillName: skillName,
      status: 'requested',
      scheduledTime: scheduledTime,
      jitsiRoom: jitsiRoom,
      createdAt: DateTime.now(),
      duration: duration,
      notes: notes,
    );

    await docRef.set(session.toMap());

    // Send notification to teacher
    await _db.collection('users').doc(teacherId).collection('notifications').add({
      'type': 'session_request',
      'senderId': learnerId,
      'senderName': learnerName,
      'referenceId': docRef.id,
      'message': 'requested a swap session for "$skillName" ✦',
      'read': false,
      'createdAt': FieldValue.serverTimestamp(),
    });

    return docRef.id;
  }

  // Accept a Swap Session
  Future<void> acceptSession(String sessionId, String currentUserId) async {
    final sessionRef = _db.collection('sessions').doc(sessionId);
    final snap = await sessionRef.get();
    if (!snap.exists) return;

    final session = SwapSession.fromFirestore(snap);
    await sessionRef.update({
      'status': 'accepted',
      'updatedAt': FieldValue.serverTimestamp(),
    });

    // Notify learner
    await _db.collection('users').doc(session.learnerId).collection('notifications').add({
      'type': 'session_accepted',
      'senderId': session.teacherId,
      'senderName': session.teacherName,
      'referenceId': sessionId,
      'message': 'accepted your swap session for "${session.skillName}"! Ready for Live Video Call ✦',
      'read': false,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }

  // Decline / Cancel Swap Session
  Future<void> cancelOrDeclineSession(String sessionId, String userId, {String? reason}) async {
    await _db.collection('sessions').doc(sessionId).update({
      'status': 'cancelled',
      'cancelReason': reason ?? 'Cancelled by user',
      'cancelledBy': userId,
      'updatedAt': FieldValue.serverTimestamp(),
    });
  }

  // Complete Session
  Future<void> completeSession(String sessionId) async {
    final snap = await _db.collection('sessions').doc(sessionId).get();
    if (!snap.exists) return;

    final session = SwapSession.fromFirestore(snap);

    await _db.collection('sessions').doc(sessionId).update({
      'status': 'completed',
      'completedAt': FieldValue.serverTimestamp(),
    });

    // Increment sessions count on both users
    await _db.collection('users').doc(session.teacherId).update({
      'sessionsCount': FieldValue.increment(1),
      'points': FieldValue.increment(10),
    });

    await _db.collection('users').doc(session.learnerId).update({
      'sessionsCount': FieldValue.increment(1),
      'points': FieldValue.increment(10),
    });
  }

  // Submit Review and recalculate user rating
  Future<void> submitReview({
    required String sessionId,
    required String reviewerId,
    required String revieweeId,
    required String reviewerName,
    required double rating,
    required String comment,
  }) async {
    final reviewDoc = _db.collection('reviews').doc();
    final review = Review(
      id: reviewDoc.id,
      sessionId: sessionId,
      reviewerId: reviewerId,
      revieweeId: revieweeId,
      reviewerName: reviewerName,
      rating: rating,
      comment: comment,
      createdAt: DateTime.now(),
    );

    await reviewDoc.set(review.toMap());

    // Recalculate reviewee rating
    final allReviewsSnap = await _db.collection('reviews').where('revieweeId', isEqualTo: revieweeId).get();
    if (allReviewsSnap.docs.isNotEmpty) {
      double total = 0;
      for (final doc in allReviewsSnap.docs) {
        total += (doc.data()['rating'] as num?)?.toDouble() ?? 5.0;
      }
      final avg = total / allReviewsSnap.docs.length;
      await _db.collection('users').doc(revieweeId).update({
        'rating': double.parse(avg.toStringAsFixed(1)),
        'reviewCount': allReviewsSnap.docs.length,
      });
    }

    // Send review notification
    await _db.collection('users').doc(revieweeId).collection('notifications').add({
      'type': 'review',
      'senderId': reviewerId,
      'senderName': reviewerName,
      'referenceId': sessionId,
      'message': 'left you a $rating ★ review! ✦',
      'read': false,
      'createdAt': FieldValue.serverTimestamp(),
    });
  }
}
