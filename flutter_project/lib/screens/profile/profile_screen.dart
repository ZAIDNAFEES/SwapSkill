import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../providers/auth_provider.dart';
import '../../constants/app_colors.dart';
import '../../constants/app_typography.dart';
import '../../widgets/user_avatar.dart';
import '../../widgets/skill_chip.dart';
import 'edit_profile_screen.dart';
import '../auth/login_screen.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final user = auth.currentUserProfile;

    if (user == null) {
      return const Scaffold(
        backgroundColor: AppColors.background,
        body: Center(child: CircularProgressIndicator()),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.background,
      body: CustomScrollView(
        slivers: [
          // Sliver App Bar with Cover Photo & Actions
          SliverAppBar(
            expandedHeight: 180,
            pinned: true,
            backgroundColor: AppColors.surface,
            elevation: 0,
            actions: [
              IconButton(
                icon: Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.9),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.edit_rounded, color: AppColors.textPrimary, size: 18),
                ),
                onPressed: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const EditProfileScreen()),
                  );
                },
              ),
              IconButton(
                icon: Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.9),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.logout_rounded, color: AppColors.danger, size: 18),
                ),
                onPressed: () async {
                  final confirm = await showDialog<bool>(
                    context: context,
                    builder: (ctx) => AlertDialog(
                      title: const Text('Sign Out'),
                      content: const Text('Are you sure you want to sign out of SwapSkill?'),
                      actions: [
                        TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
                        TextButton(
                          onPressed: () => Navigator.of(ctx).pop(true),
                          child: const Text('Sign Out', style: TextStyle(color: AppColors.danger)),
                        ),
                      ],
                    ),
                  );
                  if (confirm == true) {
                    await auth.signOut();
                    if (context.mounted) {
                      Navigator.of(context).pushAndRemoveUntil(
                        MaterialPageRoute(builder: (_) => const LoginScreen()),
                        (route) => false,
                      );
                    }
                  }
                },
              ),
              const SizedBox(width: 8),
            ],
            flexibleSpace: FlexibleSpaceBar(
              background: user.effectiveCoverUrl.isNotEmpty
                  ? CachedNetworkImage(imageUrl: user.effectiveCoverUrl, fit: BoxFit.cover)
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
                  // Avatar
                  Row(
                    children: [
                      UserAvatar(
                        name: user.fullName,
                        imageUrl: user.effectivePhotoUrl,
                        radius: 40,
                        showOnlineBadge: true,
                        isOnline: true,
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Flexible(
                                  child: Text(user.fullName, style: AppTypography.h2),
                                ),
                                if (user.verified) ...[
                                  const SizedBox(width: 4),
                                  const Icon(Icons.verified_rounded, color: AppColors.primary, size: 18),
                                ],
                              ],
                            ),
                            Text('@${user.username}', style: AppTypography.bodySmall.copyWith(color: AppColors.primary)),
                            const SizedBox(height: 4),
                            Text('${user.city}, ${user.country}', style: AppTypography.bodySmall),
                          ],
                        ),
                      ),
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
                        _buildStatItem('Points', '${user.points} ✦'),
                        _buildDivider(),
                        _buildStatItem('Rating', '${user.rating.toStringAsFixed(1)} ★'),
                        _buildDivider(),
                        _buildStatItem('Followers', '${user.followers.length}'),
                      ],
                    ),
                  ),
                  const SizedBox(height: 20),

                  // Bio
                  if (user.bio.isNotEmpty) ...[
                    Text('About Me', style: AppTypography.h3),
                    const SizedBox(height: 6),
                    Text(user.bio, style: AppTypography.bodyMedium),
                    const SizedBox(height: 20),
                  ],

                  // Teaches
                  Text('I Can Teach', style: AppTypography.h3),
                  const SizedBox(height: 8),
                  if (user.skillsToTeach.isNotEmpty)
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: user.skillsToTeach.map((s) => SkillChip(label: s, type: SkillChipType.teach)).toList(),
                    )
                  else
                    Text('Add skills you can teach in Edit Profile', style: AppTypography.bodySmall),
                  const SizedBox(height: 20),

                  // Wants to Learn
                  Text('I Want to Learn', style: AppTypography.h3),
                  const SizedBox(height: 8),
                  if (user.skillsToLearn.isNotEmpty)
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: user.skillsToLearn.map((s) => SkillChip(label: s, type: SkillChipType.learn)).toList(),
                    )
                  else
                    Text('Add skills you want to learn in Edit Profile', style: AppTypography.bodySmall),
                  const SizedBox(height: 32),
                ],
              ),
            ),
          ),
        ],
      ),
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
