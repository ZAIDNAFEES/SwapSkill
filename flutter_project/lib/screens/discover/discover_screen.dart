import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../models/user_profile.dart';
import '../../services/firestore_service.dart';
import '../../constants/app_colors.dart';
import '../../constants/app_typography.dart';
import '../../constants/app_constants.dart';
import '../../widgets/user_avatar.dart';
import '../../widgets/skill_chip.dart';
import 'user_detail_screen.dart';
import '../notifications/notifications_screen.dart';

class DiscoverScreen extends StatefulWidget {
  const DiscoverScreen({super.key});

  @override
  State<DiscoverScreen> createState() => _DiscoverScreenState();
}

class _DiscoverScreenState extends State<DiscoverScreen> {
  final FirestoreService _firestoreService = FirestoreService();
  String _selectedCategory = 'All';
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final currentUser = auth.currentUserProfile;
    final currentUid = auth.user?.uid ?? '';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        elevation: 0,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: AppColors.primaryLight,
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.swap_horiz_rounded, color: AppColors.primary, size: 22),
            ),
            const SizedBox(width: 10),
            Text(
              'SwapSkill',
              style: AppTypography.h2.copyWith(fontWeight: FontWeight.w800),
            ),
          ],
        ),
        actions: [
          StreamBuilder(
            stream: currentUid.isNotEmpty ? _firestoreService.streamNotifications(currentUid) : null,
            builder: (context, snapshot) {
              final unreadCount = snapshot.data?.where((n) => !n.read).length ?? 0;
              return IconButton(
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const NotificationsScreen()),
                  );
                },
                icon: Badge(
                  isLabelVisible: unreadCount > 0,
                  label: Text('$unreadCount'),
                  backgroundColor: AppColors.danger,
                  child: const Icon(Icons.notifications_none_rounded, color: AppColors.textPrimary),
                ),
              );
            },
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: CustomScrollView(
        slivers: [
          // Greeting & Search Header
          SliverToBoxAdapter(
            child: Container(
              color: AppColors.surface,
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Hello, ${currentUser?.fullName.split(' ').first ?? 'Partner'} 👋',
                    style: AppTypography.h1.copyWith(fontSize: 22),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'Discover mentors & swap knowledge today',
                    style: AppTypography.bodyMedium,
                  ),
                  const SizedBox(height: 16),

                  // Search Bar
                  TextField(
                    controller: _searchController,
                    onChanged: (val) => setState(() => _searchQuery = val.trim().toLowerCase()),
                    style: AppTypography.bodyMedium,
                    decoration: InputDecoration(
                      hintText: 'Search by skill, name or language...',
                      hintStyle: AppTypography.bodyMedium.copyWith(color: AppColors.textMuted),
                      prefixIcon: const Icon(Icons.search_rounded, color: AppColors.textMuted),
                      suffixIcon: _searchQuery.isNotEmpty
                          ? IconButton(
                              icon: const Icon(Icons.clear_rounded, size: 18),
                              onPressed: () {
                                _searchController.clear();
                                setState(() => _searchQuery = '');
                              },
                            )
                          : null,
                      filled: true,
                      fillColor: AppColors.background,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: AppColors.border),
                      ),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: AppColors.border),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),

          // Categories Horizontal Scroll
          SliverToBoxAdapter(
            child: Container(
              height: 54,
              color: AppColors.surface,
              padding: const EdgeInsets.only(bottom: 12),
              child: ListView.builder(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: AppConstants.skillCategories.length,
                itemBuilder: (context, index) {
                  final cat = AppConstants.skillCategories[index];
                  final isSelected = _selectedCategory == cat;
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: SkillChip(
                      label: cat,
                      type: SkillChipType.category,
                      isSelected: isSelected,
                      onTap: () => setState(() => _selectedCategory = cat),
                    ),
                  );
                },
              ),
            ),
          ),

          const SliverToBoxAdapter(
            child: SizedBox(height: 12),
          ),

          // Section Title
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Featured Mentors', style: AppTypography.h3),
                  Text(
                    'P2P Verified',
                    style: AppTypography.caption.copyWith(color: AppColors.primary, fontWeight: FontWeight.w700),
                  ),
                ],
              ),
            ),
          ),

          // Stream of Users
          StreamBuilder<List<UserProfile>>(
            stream: _firestoreService.streamDiscoverUsers(),
            builder: (context, snapshot) {
              if (snapshot.connectionState == ConnectionState.waiting) {
                return const SliverFillRemaining(
                  child: Center(child: CircularProgressIndicator()),
                );
              }

              if (snapshot.hasError) {
                return SliverFillRemaining(
                  child: Center(
                    child: Text('Error loading mentors: ${snapshot.error}', style: AppTypography.bodyMedium),
                  ),
                );
              }

              var users = snapshot.data ?? [];
              // Exclude current user
              users = users.where((u) => u.uid != currentUid).toList();

              // Filter by search query
              if (_searchQuery.isNotEmpty) {
                users = users.where((u) {
                  final nameMatch = u.fullName.toLowerCase().contains(_searchQuery);
                  final teachMatch = u.skillsToTeach.any((s) => s.toLowerCase().contains(_searchQuery));
                  final learnMatch = u.skillsToLearn.any((s) => s.toLowerCase().contains(_searchQuery));
                  return nameMatch || teachMatch || learnMatch;
                }).toList();
              }

              if (users.isEmpty) {
                return SliverFillRemaining(
                  child: Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.people_outline_rounded, size: 48, color: AppColors.textMuted),
                        const SizedBox(height: 12),
                        Text('No mentors found matching your search', style: AppTypography.bodyMedium),
                      ],
                    ),
                  ),
                );
              }

              return SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                sliver: SliverList(
                  delegate: SliverChildBuilderDelegate(
                    (context, index) {
                      final user = users[index];
                      return _MentorCard(user: user);
                    },
                    childCount: users.length,
                  ),
                ),
              );
            },
          ),

          const SliverToBoxAdapter(
            child: SizedBox(height: 24),
          ),
        ],
      ),
    );
  }
}

class _MentorCard extends StatelessWidget {
  final UserProfile user;
  const _MentorCard({required this.user});

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: AppColors.border, width: 1),
      ),
      color: AppColors.card,
      child: InkWell(
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => UserDetailScreen(userId: user.uid)),
          );
        },
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // User header
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  UserAvatar(
                    name: user.fullName,
                    imageUrl: user.effectivePhotoUrl,
                    radius: 26,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                user.fullName,
                                style: AppTypography.h3.copyWith(fontSize: 16),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ),
                            if (user.verified) ...[
                              const SizedBox(width: 4),
                              const Icon(Icons.verified_rounded, size: 16, color: AppColors.primary),
                            ],
                          ],
                        ),
                        Text(
                          '${user.city}, ${user.country}',
                          style: AppTypography.bodySmall,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  // Rating Badge
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.warningLight,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.star_rounded, size: 14, color: AppColors.warning),
                        const SizedBox(width: 2),
                        Text(
                          user.rating.toStringAsFixed(1),
                          style: AppTypography.caption.copyWith(
                            color: AppColors.warning,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),

              if (user.bio.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text(
                  user.bio,
                  style: AppTypography.bodyMedium.copyWith(fontSize: 13),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],

              const SizedBox(height: 12),

              // Teaches section
              if (user.skillsToTeach.isNotEmpty) ...[
                Text('TEACHES', style: AppTypography.caption.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.5)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: user.skillsToTeach
                      .take(3)
                      .map((s) => SkillChip(label: s, type: SkillChipType.teach))
                      .toList(),
                ),
              ],

              if (user.skillsToLearn.isNotEmpty) ...[
                const SizedBox(height: 10),
                Text('WANTS TO LEARN', style: AppTypography.caption.copyWith(fontWeight: FontWeight.w700, letterSpacing: 0.5)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: user.skillsToLearn
                      .take(3)
                      .map((s) => SkillChip(label: s, type: SkillChipType.learn))
                      .toList(),
                ),
              ],

              const SizedBox(height: 14),
              const Divider(height: 1, color: AppColors.border),
              const SizedBox(height: 10),

              // Footer: Quick stats & Action
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.repeat_rounded, size: 16, color: AppColors.textMuted),
                      const SizedBox(width: 4),
                      Text(
                        '${user.sessionsCount} Swaps Completed',
                        style: AppTypography.caption,
                      ),
                    ],
                  ),
                  Text(
                    'View Profile →',
                    style: AppTypography.label.copyWith(color: AppColors.primary),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
