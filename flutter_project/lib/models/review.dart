import 'package:cloud_firestore/cloud_firestore.dart';

class Review {
  final String id;
  final String sessionId;
  final String reviewerId;
  final String revieweeId;
  final String reviewerName;
  final double rating;
  final String comment;
  final DateTime createdAt;

  Review({
    required this.id,
    required this.sessionId,
    required this.reviewerId,
    required this.revieweeId,
    required this.reviewerName,
    required this.rating,
    required this.comment,
    required this.createdAt,
  });

  factory Review.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? {};
    
    DateTime created = DateTime.now();
    if (data['createdAt'] is Timestamp) {
      created = (data['createdAt'] as Timestamp).toDate();
    } else if (data['createdAt'] is int) {
      created = DateTime.fromMillisecondsSinceEpoch(data['createdAt']);
    }

    return Review(
      id: doc.id,
      sessionId: data['sessionId'] ?? '',
      reviewerId: data['reviewerId'] ?? '',
      revieweeId: data['revieweeId'] ?? '',
      reviewerName: data['reviewerName'] ?? 'Member',
      rating: (data['rating'] as num?)?.toDouble() ?? 5.0,
      comment: data['comment'] ?? '',
      createdAt: created,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'sessionId': sessionId,
      'reviewerId': reviewerId,
      'revieweeId': revieweeId,
      'reviewerName': reviewerName,
      'rating': rating,
      'comment': comment,
      'createdAt': Timestamp.fromDate(createdAt),
    };
  }
}
