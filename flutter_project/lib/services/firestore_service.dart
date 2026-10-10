import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/user_profile.dart';
import '../models/review.dart';
import '../models/notification_item.dart';

class FirestoreService {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  // Save / Update User Profile
  Future<void> saveUserProfile(UserProfile profile) async {
    await _db.collection('users').doc(profile.uid).set(
      profile.toMap(),
      SetOptions(merge: true),
    );
  }

  // Get User Profile by UID
  Future<UserProfile?> getUserProfile(String uid) async {
    final snap = await _db.collection('users').doc(uid).get();
    if (!snap.exists || snap.data() == null) return null;
    return UserProfile.fromFirestore(snap);
  }

  // Stream single user profile
  Stream<UserProfile?> streamUserProfile(String uid) {
    return _db.collection('users').doc(uid).snapshots().map((snap) {
      if (!snap.exists || snap.data() == null) return null;
      return UserProfile.fromFirestore(snap);
    });
  }

  // Stream all discoverable users
  Stream<List<UserProfile>> streamDiscoverUsers({int limit = 40}) {
    return _db
        .collection('users')
        .limit(limit)
        .snapshots()
        .map((snap) => snap.docs.map((doc) => UserProfile.fromFirestore(doc)).toList());
  }

  // Follow / Unfollow Transaction with Subcollections & Array synchronization
  Future<bool> toggleFollowUser({
    required String currentUserId,
    required String targetUserId,
    required String currentUserName,
    required String? currentUserPhoto,
  }) async {
    if (currentUserId == targetUserId) return false;

    final currentUserRef = _db.collection('users').doc(currentUserId);
    final targetUserRef = _db.collection('users').doc(targetUserId);

    final currentFollowingSubDoc = currentUserRef.collection('following').doc(targetUserId);
    final targetFollowerSubDoc = targetUserRef.collection('followers').doc(currentUserId);

    bool isNowFollowing = false;

    await _db.runTransaction((transaction) async {
      final currentDoc = await transaction.get(currentUserRef);
      final targetDoc = await transaction.get(targetUserRef);
      final followDoc = await transaction.get(currentFollowingSubDoc);

      final currentData = currentDoc.data() ?? {};
      final targetData = targetDoc.data() ?? {};

      List<String> curFollowing = List<String>.from(currentData['following'] ?? []);
      int curFollowingCount = (currentData['followingCount'] as num?)?.toInt() ?? 0;

      List<String> targetFollowers = List<String>.from(targetData['followers'] ?? []);
      int targetFollowersCount = (targetData['followersCount'] as num?)?.toInt() ?? 0;

      if (followDoc.exists) {
        // UNFOLLOW
        isNowFollowing = false;
        curFollowing.remove(targetUserId);
        targetFollowers.remove(currentUserId);

        curFollowingCount = (curFollowingCount - 1).clamp(0, 999999);
        targetFollowersCount = (targetFollowersCount - 1).clamp(0, 999999);

        transaction.update(currentUserRef, {
          'following': curFollowing,
          'followingCount': curFollowingCount,
        });

        transaction.update(targetUserRef, {
          'followers': targetFollowers,
          'followersCount': targetFollowersCount,
        });

        transaction.delete(currentFollowingSubDoc);
        transaction.delete(targetFollowerSubDoc);
      } else {
        // FOLLOW
        isNowFollowing = true;
        if (!curFollowing.contains(targetUserId)) {
          curFollowing.add(targetUserId);
        }
        if (!targetFollowers.contains(currentUserId)) {
          targetFollowers.add(currentUserId);
        }

        curFollowingCount++;
        targetFollowersCount++;

        transaction.update(currentUserRef, {
          'following': curFollowing,
          'followingCount': curFollowingCount,
        });

        transaction.update(targetUserRef, {
          'followers': targetFollowers,
          'followersCount': targetFollowersCount,
        });

        transaction.set(currentFollowingSubDoc, {'followedAt': FieldValue.serverTimestamp()});
        transaction.set(targetFollowerSubDoc, {'followerAt': FieldValue.serverTimestamp()});
      }
    });

    // Send follower notification if followed
    if (isNowFollowing) {
      await _db.collection('users').doc(targetUserId).collection('notifications').add({
        'type': 'follower',
        'senderId': currentUserId,
        'senderName': currentUserName,
        'senderPhoto': currentUserPhoto ?? '',
        'referenceId': currentUserId,
        'message': 'started following your skill profile! ✦',
        'read': false,
        'createdAt': FieldValue.serverTimestamp(),
      });
    }

    return isNowFollowing;
  }

  // Check if following
  Future<bool> isFollowing(String currentUserId, String targetUserId) async {
    final doc = await _db
        .collection('users')
        .doc(currentUserId)
        .collection('following')
        .doc(targetUserId)
        .get();
    return doc.exists;
  }

  // Stream reviews for a user
  Stream<List<Review>> streamReviews(String revieweeId) {
    return _db
        .collection('reviews')
        .where('revieweeId', isEqualTo: revieweeId)
        .snapshots()
        .map((snap) => snap.docs.map((doc) => Review.fromFirestore(doc)).toList());
  }

  // Stream notifications for a user
  Stream<List<NotificationItem>> streamNotifications(String userId) {
    return _db
        .collection('users')
        .doc(userId)
        .collection('notifications')
        .orderBy('createdAt', descending: true)
        .limit(50)
        .snapshots()
        .map((snap) => snap.docs.map((doc) => NotificationItem.fromFirestore(doc)).toList());
  }

  // Mark all notifications as read
  Future<void> markNotificationsRead(String userId) async {
    final snap = await _db
        .collection('users')
        .doc(userId)
        .collection('notifications')
        .where('read', isEqualTo: false)
        .get();

    final batch = _db.batch();
    for (final doc in snap.docs) {
      batch.update(doc.reference, {'read': true});
    }
    await batch.commit();
  }
}
