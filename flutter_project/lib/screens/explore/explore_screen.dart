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
import '../discover/user_detail_screen.dart';

class ExploreScreen extends StatefulWidget {
  const ExploreScreen({super.key});

  @override
  State<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends State<ExploreScreen> {
  final FirestoreService _firestoreService = FirestoreService();
  String _selectedCategory = 'All';
  String _filterType = 'all'; // 'all' | 'teach' | 'learn'
  String _sortBy = 'rating'; // 'rating' | 'sessions' | 'followers'
  String _query = '';
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final currentUid = auth.user?.uid ?? '';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text('Explore Exchanges', style: AppTypography.h2),
        backgroundColor: AppColors.surface,
        elevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(110),
          child: Column(
            children: [
              // Search Input
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: TextField(
                  controller: _searchController,
                  onChanged: (val) => setState(() => _query = val.trim().toLowerCase()),
                  style: AppTypography.bodyMedium,
                  decoration: InputDecoration(
                    hintText: 'Search skills (e.g. Flutter, Spanish, Guitar)...',
                    prefixIcon: const Icon(Icons.search_rounded, color: AppColors.textMuted),
                    suffixIcon: _query.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear, size: 18),
                            onPressed: () {
                              _searchController.clear();
                              setState(() => _query = '');
                            },
                          )
                        : null,
                    filled: true,
                    fillColor: AppColors.background,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                      borderSide: const BorderSide(color: AppColors.border),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 8),

              // Filter Tabs (All, Teaching, Learning)
              SizedBox(
                height: 44,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  children: [
                    _buildFilterChip('All Skills', 'all'),
                    const SizedBox(width: 8),
                    _buildFilterChip('Can Teach', 'teach'),
                    const SizedBox(width: 8),
                    _buildFilterChip('Wants to Learn', 'learn'),
                    const SizedBox(width: 16),
                    // Categories
                    ...AppConstants.skillCategories.map((c) => Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: SkillChip(
                            label: c,
                            type: SkillChipType.category,
                            isSelected: _selectedCategory == c,
                            onTap: () => setState(() => _selectedCategory = c),
                          ),
                        )),
                  ],
                ),
              ),
              const SizedBox(height: 8),
            ],
          ),
        ),
      ),
      body: StreamBuilder<List<UserProfile>>(
        stream: _firestoreService.streamDiscoverUsers(),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          var users = snapshot.data ?? [];
          users = users.where((u) => u.uid != currentUid).toList();

          // Apply Category & Query Filters
          if (_query.isNotEmpty) {
            users = users.where((u) {
              final nameMatch = u.fullName.toLowerCase().contains(_query);
              final teachMatch = u.skillsToTeach.any((s) => s.toLowerCase().contains(_query));
              final learnMatch = u.skillsToLearn.any((s) => s.toLowerCase().contains(_query));
              return nameMatch || teachMatch || learnMatch;
            }).toList();
          }

          if (_filterType == 'teach') {
            users = users.where((u) => u.skillsToTeach.isNotEmpty).toList();
          } else if (_filterType == 'learn') {
            users = users.where((u) => u.skillsToLearn.isNotEmpty).toList();
          }

          // Sort
          if (_sortBy == 'rating') {
            users.sort((a, b) => b.rating.compareTo(a.rating));
          } else if (_sortBy == 'sessions') {
            users.sort((a, b) => b.sessionsCount.compareTo(a.sessionsCount));
          }

          if (users.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.search_off_rounded, size: 56, color: AppColors.textMuted),
                  const SizedBox(height: 12),
                  Text('No matching mentors found', style: AppTypography.h3),
                  const SizedBox(height: 4),
                  Text('Try adjusting your search terms or filters', style: AppTypography.bodySmall),
                ],
              ),
            );
          }

          return GridView.builder(
            padding: const EdgeInsets.all(16),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              childAspectRatio: 0.76,
            ),
            itemCount: users.length,
            itemBuilder: (context, index) {
              final u = users[index];
              return _ExploreGridCard(user: u);
            },
          );
        },
      ),
    );
  }

  Widget _buildFilterChip(String label, String value) {
    final isSelected = _filterType == value;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (_) => setState(() => _filterType = value),
      selectedColor: AppColors.primaryLight,
      labelStyle: AppTypography.caption.copyWith(
        color: isSelected ? AppColors.primary : AppColors.textSecondary,
        fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
      ),
      backgroundColor: AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(color: isSelected ? AppColors.primary : AppColors.border),
      ),
    );
  }
}

class _ExploreGridCard extends StatelessWidget {
  final UserProfile user;
  const _ExploreGridCard({required this.user});

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
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
          padding: const EdgeInsets.all(12),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              UserAvatar(
                name: user.fullName,
                imageUrl: user.effectivePhotoUrl,
                radius: 28,
              ),
              const SizedBox(height: 10),
              Text(
                user.fullName,
                style: AppTypography.label.copyWith(fontSize: 14),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 2),
              Text(
                user.city,
                style: AppTypography.caption,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 8),
              if (user.skillsToTeach.isNotEmpty)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.teachBadgeBg,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    user.skillsToTeach.first,
                    style: AppTypography.caption.copyWith(
                      color: AppColors.teachBadgeText,
                      fontWeight: FontWeight.w600,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              const Spacer(),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.star_rounded, size: 14, color: AppColors.warning),
                  const SizedBox(width: 2),
                  Text(
                    user.rating.toStringAsFixed(1),
                    style: AppTypography.caption.copyWith(fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '${user.sessionsCount} swaps',
                    style: AppTypography.caption.copyWith(color: AppColors.textMuted),
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
