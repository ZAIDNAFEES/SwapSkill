import 'package:cloud_firestore/cloud_firestore.dart';

class UserProfile {
  final String uid;
  final String email;
  final String fullName;
  final String username;
  final String country;
  final String countryCode;
  final String city;
  final List<String> languages;
  final List<String> skillsToTeach;
  final List<String> skillsToLearn;
  final String bio;
  final String availability;
  final String timezone;
  final DateTime? createdAt;
  final String photoUrl;
  final String? profilePhotoUrl;
  final String? coverUrl;
  final String? coverPhotoUrl;
  final int followersCount;
  final int followingCount;
  final int points;
  final int sessionsCount;
  final double rating;
  final int reviewCount;
  final String? instagram;
  final String? linkedin;
  final String? github;
  final String? portfolio;
  final String? website;
  final List<String> followingList;
  final List<String> followers;
  final List<String> following;
  final List<String> blockedUsers;
  final bool verified;
  final bool isOnlineVisible;

  UserProfile({
    required this.uid,
    required this.email,
    required this.fullName,
    required this.username,
    this.country = 'United States of America',
    this.countryCode = 'US',
    this.city = 'San Francisco',
    this.languages = const ['English'],
    this.skillsToTeach = const [],
    this.skillsToLearn = const [],
    this.bio = '',
    this.availability = 'Flexible',
    this.timezone = 'UTC',
    this.createdAt,
    this.photoUrl = '',
    this.profilePhotoUrl,
    this.coverUrl,
    this.coverPhotoUrl,
    this.followersCount = 0,
    this.followingCount = 0,
    this.points = 0,
    this.sessionsCount = 0,
    this.rating = 5.0,
    this.reviewCount = 0,
    this.instagram,
    this.linkedin,
    this.github,
    this.portfolio,
    this.website,
    this.followingList = const [],
    this.followers = const [],
    this.following = const [],
    this.blockedUsers = const [],
    this.verified = false,
    this.isOnlineVisible = true,
  });

  String get effectivePhotoUrl {
    if (profilePhotoUrl != null && profilePhotoUrl!.isNotEmpty) {
      return profilePhotoUrl!;
    }
    return photoUrl;
  }

  String get effectiveCoverUrl {
    if (coverPhotoUrl != null && coverPhotoUrl!.isNotEmpty) {
      return coverPhotoUrl!;
    }
    return coverUrl ?? '';
  }

  factory UserProfile.fromFirestore(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? {};
    
    DateTime? created;
    if (data['createdAt'] is Timestamp) {
      created = (data['createdAt'] as Timestamp).toDate();
    } else if (data['createdAt'] is int) {
      created = DateTime.fromMillisecondsSinceEpoch(data['createdAt']);
    }

    return UserProfile(
      uid: doc.id,
      email: data['email'] ?? '',
      fullName: data['fullName'] ?? data['displayName'] ?? 'Member',
      username: data['username'] ?? 'user_${doc.id.substring(0, 5)}',
      country: data['country'] ?? 'United States of America',
      countryCode: data['countryCode'] ?? 'US',
      city: data['city'] ?? 'San Francisco',
      languages: List<String>.from(data['languages'] ?? ['English']),
      skillsToTeach: List<String>.from(data['skillsToTeach'] ?? []),
      skillsToLearn: List<String>.from(data['skillsToLearn'] ?? []),
      bio: data['bio'] ?? '',
      availability: data['availability'] ?? 'Flexible',
      timezone: data['timezone'] ?? 'UTC',
      createdAt: created,
      photoUrl: data['photoUrl'] ?? data['photoURL'] ?? '',
      profilePhotoUrl: data['profilePhotoUrl'],
      coverUrl: data['coverUrl'] ?? data['coverPhotoUrl'],
      coverPhotoUrl: data['coverPhotoUrl'],
      followersCount: (data['followersCount'] as num?)?.toInt() ?? 0,
      followingCount: (data['followingCount'] as num?)?.toInt() ?? 0,
      points: (data['points'] as num?)?.toInt() ?? 0,
      sessionsCount: (data['sessionsCount'] as num?)?.toInt() ?? 0,
      rating: (data['rating'] as num?)?.toDouble() ?? 5.0,
      reviewCount: (data['reviewCount'] as num?)?.toInt() ?? 0,
      instagram: data['instagram'],
      linkedin: data['linkedin'],
      github: data['github'],
      portfolio: data['portfolio'],
      website: data['website'],
      followingList: List<String>.from(data['followingList'] ?? data['following'] ?? []),
      followers: List<String>.from(data['followers'] ?? []),
      following: List<String>.from(data['following'] ?? []),
      blockedUsers: List<String>.from(data['blockedUsers'] ?? []),
      verified: data['verified'] ?? false,
      isOnlineVisible: data['isOnlineVisible'] ?? true,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'uid': uid,
      'email': email,
      'fullName': fullName,
      'username': username,
      'country': country,
      'countryCode': countryCode,
      'city': city,
      'languages': languages,
      'skillsToTeach': skillsToTeach,
      'skillsToLearn': skillsToLearn,
      'bio': bio,
      'availability': availability,
      'timezone': timezone,
      'createdAt': createdAt != null ? Timestamp.fromDate(createdAt!) : FieldValue.serverTimestamp(),
      'photoUrl': effectivePhotoUrl,
      'profilePhotoUrl': profilePhotoUrl,
      'coverUrl': effectiveCoverUrl,
      'coverPhotoUrl': coverPhotoUrl,
      'followersCount': followersCount,
      'followingCount': followingCount,
      'points': points,
      'sessionsCount': sessionsCount,
      'rating': rating,
      'reviewCount': reviewCount,
      'instagram': instagram,
      'linkedin': linkedin,
      'github': github,
      'portfolio': portfolio,
      'website': website,
      'followingList': followingList,
      'followers': followers,
      'following': following,
      'blockedUsers': blockedUsers,
      'verified': verified,
      'isOnlineVisible': isOnlineVisible,
    };
  }
}
