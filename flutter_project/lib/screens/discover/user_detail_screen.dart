import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../providers/auth_provider.dart';
import '../../models/user_profile.dart';
import '../../models/review.dart';
import '../../services/firestore_service.dart';
import '../../services/conversation_service.dart';
import '../../constants/app_colors.dart';
import '../../constants/app_typography.dart';
import '../../widgets/user_avatar.dart';
import '../../widgets/skill_chip.dart';
import '../../widgets/custom_button.dart';
import '../chat/chat_detail_screen.dart';
import '../sessions/book_session_sheet.dart';

class UserDetailScreen extends StatefulWidget {
  final String userId;
  const UserDetailScreen({super.key, required this.userId});

  @override
  State<UserDetailScreen> createState() => _UserDetailScreenState();
}

class _UserDetailScreenState extends State<UserDetailScreen> {
  final FirestoreService _firestoreService = FirestoreService();
  final ConversationService _conversationService = ConversationService();
  bool _isFollowing = false;
  bool _isLoadingFollow = false;

  @override
  void initState() {
    super.initState();
    _checkFollowStatus();
  }

  Future<void> _checkFollowStatus() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    if (auth.user != null) {
      final isF = await _firestoreService.isFollowing(auth.user!.uid, widget.userId);
      if (mounted) setState(() => _isFollowing = isF);
    }
  }

  Future<void> _toggleFollow(UserProfile user) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    if (auth.user == null) return;

    setState(() => _isLoadingFollow = true);
    try {
      final newStatus = await _firestoreService.toggleFollowUser(
        currentUserId: auth.user!.uid,
        targetUserId: user.uid,
        currentUserName: auth.currentUserProfile?.fullName ?? 'Member',
        currentUserPhoto: auth.currentUserProfile?.effectivePhotoUrl,
      );
      if (mounted) setState(() => _isFollowing = newStatus);
    } finally {
      if (mounted) setState(() => _isLoadingFollow = false);
    }
  }

  Future<void> _startChat(UserProfile user) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    if (auth.user == null) return;

    try {
      final canonicalChatId = await _conversationService.getOrCreateConversation(
        currentUserId: auth.user!.uid,
        otherUserId: user.uid,
      );

      if (!mounted) return;
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => ChatDetailScreen(
            chatId: canonicalChatId,
            otherUserId: user.uid,
            otherUserName: user.fullName,
            otherUserPhoto: user.effectivePhotoUrl,
          ),
        ),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not open chat: $e')),
      );
    }
  }

  void _openBookSessionModal(UserProfile user) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => BookSessionSheet(mentor: user),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final isMe = auth.user?.uid == widget.userId;

    return StreamBuilder<UserProfile?>(
      stream: _firestoreService.streamUserProfile(widget.userId),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Scaffold(
            backgroundColor: AppColors.background,
            body: Center(child: CircularProgressIndicator()),
          );
        }

        final user = snapshot.data;
        if (user == null) {
          return Scaffold(
            backgroundColor: AppColors.background,
            appBar: AppBar(backgroundColor: AppColors.surface, elevation: 0),
            body: const Center(child: Text('User profile not found')),
          );
        }

        return Scaffold(
          backgroundColor: AppColors.background,
          body: CustomScrollView(
            slivers: [
              // Sliver App Bar with Cover Photo
              SliverAppBar(
                expandedHeight: 180,
                pinned: true,
                backgroundColor: AppColors.surface,
                elevation: 0,
                leading: IconButton(
                  icon: Container(
                    padding: const EdgeInsets.all(6),
                    decoration: BoxDecoration(
                      color: Colors.white.withOpacity(0.9),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.arrow_back_ios_new_rounded, color: AppColors.textPrimary, size: 18),
                  ),
                  onPressed: () => Navigator.of(context).pop(),
                ),
                flexibleSpace: FlexibleSpaceBar(
                  background: user.effectiveCoverUrl.isNotEmpty
                      ? CachedNetworkImage(
                          imageUrl: user.effectiveCoverUrl,
                          fit: BoxFit.cover,
                        )
                      : Container(
                          decoration: const BoxDecoration(
                            gradient: LinearGradient(
                              colors: [Color(0xFF1E293B), Color(0xFF334155)],
                              begin: Alignment.topLeft,
                              end: Alignment.bottomRight,
                            ),
                          ),
                        ),
                ),
              ),

              // Profile Content
              SliverToBoxAdapter(
                child: Container(
                  color: AppColors.surface,
                  padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Avatar & Actions Row
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          UserAvatar(
                            name: user.fullName,
                            imageUrl: user.effectivePhotoUrl,
                            radius: 40,
                            showOnlineBadge: true,
                            isOnline: true,
                          ),
                          const Spacer(),
                          if (!isMe) ...[
                            // Follow Button
                            OutlinedButton(
                              onPressed: _isLoadingFollow ? null : () => _toggleFollow(user),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: _isFollowing ? AppColors.textSecondary : AppColors.primary,
                                side: BorderSide(color: _isFollowing ? AppColors.border : AppColors.primary),
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                              ),
                              child: _isLoadingFollow
                                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                                  : Text(_isFollowing ? 'Following' : '+ Follow'),
                            ),
                            const SizedBox(width: 8),
                            // Message Button
                            ElevatedButton.icon(
                              onPressed: () => _startChat(user),
                              icon: const Icon(Icons.chat_bubble_outline_rounded, size: 16),
                              label: const Text('Message'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppColors.primary,
                                foregroundColor: Colors.white,
                                elevation: 0,
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                              ),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 16),

                      // Name, Username & Badges
                      Row(
                        children: [
                          Text(user.fullName, style: AppTypography.h1),
                          if (user.verified) ...[
                            const SizedBox(width: 6),
                            const Icon(Icons.verified_rounded, color: AppColors.primary, size: 20),
                          ],
                        ],
                      ),
                      Text('@${user.username}', style: AppTypography.bodySmall.copyWith(color: AppColors.primary)),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          const Icon(Icons.location_on_outlined, size: 16, color: AppColors.textMuted),
                          const SizedBox(width: 4),
                          Text('${user.city}, ${user.country}', style: AppTypography.bodyMedium),
                        ],
                      ),
                      const SizedBox(height: 16),

                      // Stats Row
                      Container(
                        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                        decoration: BoxDecoration(
                          color: AppColors.background,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: AppColors.border),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceAround,
                          children: [
                            _buildStatItem('Swaps', '${user.sessionsCount}'),
                            _buildDivider(),
                            _buildStatItem('Rating', '${user.rating.toStringAsFixed(1)} ★'),
                            _buildDivider(),
                            _buildStatItem('Followers', '${user.followers.length}'),
                            _buildDivider(),
                            _buildStatItem('Following', '${user.following.length}'),
                          ],
                        ),
                      ),
                      const SizedBox(height: 20),

                      // Book Session CTA
                      if (!isMe) ...[
                        CustomButton(
                          text: 'Request Swap Session',
                          icon: Icons.calendar_today_rounded,
                          width: double.infinity,
                          onPressed: () => _openBookSessionModal(user),
                        ),
                        const SizedBox(height: 24),
                      ],

                      // Bio
                      if (user.bio.isNotEmpty) ...[
                        Text('About', style: AppTypography.h3),
                        const SizedBox(height: 8),
                        Text(user.bio, style: AppTypography.bodyMedium),
                        const SizedBox(height: 20),
                      ],

                      // Skills Teaches
                      Text('Can Teach', style: AppTypography.h3),
                      const SizedBox(height: 8),
                      if (user.skillsToTeach.isNotEmpty)
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: user.skillsToTeach.map((s) => SkillChip(label: s, type: SkillChipType.teach)).toList(),
                        )
                      else
                        Text('No teaching skills listed yet', style: AppTypography.bodySmall),
                      const SizedBox(height: 20),

                      // Skills Learning
                      Text('Wants to Learn', style: AppTypography.h3),
                      const SizedBox(height: 8),
                      if (user.skillsToLearn.isNotEmpty)
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: user.skillsToLearn.map((s) => SkillChip(label: s, type: SkillChipType.learn)).toList(),
                        )
                      else
                        Text('No learning skills listed yet', style: AppTypography.bodySmall),
                      const SizedBox(height: 20),

                      // Reviews & Ratings
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('Reviews & Endorsements', style: AppTypography.h3),
                          Text('${user.reviewCount} total', style: AppTypography.caption),
                        ],
                      ),
                      const SizedBox(height: 12),
                    ],
                  ),
                ),
              ),

              // Reviews Stream List
              StreamBuilder<List<Review>>(
                stream: _firestoreService.streamReviews(widget.userId),
                builder: (context, revSnap) {
                  final reviews = revSnap.data ?? [];
                  if (reviews.isEmpty) {
                    return SliverToBoxAdapter(
                      child: Container(
                        color: AppColors.surface,
                        padding: const EdgeInsets.all(20),
                        child: Center(
                          child: Text('No reviews yet. Complete a swap to be the first!', style: AppTypography.bodySmall),
                        ),
                      ),
                    );
                  }

                  return SliverList(
                    delegate: SliverChildBuilderDelegate(
                      (context, index) {
                        final r = reviews[index];
                        return Container(
                          color: AppColors.surface,
                          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  UserAvatar(name: r.reviewerName, radius: 14),
                                  const SizedBox(width: 8),
                                  Text(r.reviewerName, style: AppTypography.label),
                                  const Spacer(),
                                  Row(
                                    children: List.generate(
                                      5,
                                      (i) => Icon(
                                        i < r.rating ? Icons.star_rounded : Icons.star_outline_rounded,
                                        color: AppColors.warning,
                                        size: 16,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 6),
                              Text(r.comment, style: AppTypography.bodyMedium),
                              const Divider(height: 20, color: AppColors.borderLight),
                            ],
                          ),
                        );
                      },
                      childCount: reviews.length,
                    ),
                  );
                },
              ),

              const SliverToBoxAdapter(child: SizedBox(height: 40)),
            ],
          ),
        );
      },
    );
  }

  Widget _buildStatItem(String label, String value) {
    return Column(
      children: [
        Text(value, style: AppTypography.h3.copyWith(fontSize: 16)),
        const SizedBox(height: 2),
        Text(label, style: AppTypography.caption),
      ],
    );
  }

  Widget _buildDivider() {
    return Container(
      width: 1,
      height: 24,
      color: AppColors.border,
    );
  }
}
