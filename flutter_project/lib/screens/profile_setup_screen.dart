import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../models/user_profile.dart';
import '../constants/app_colors.dart';
import '../constants/app_typography.dart';
import '../constants/app_constants.dart';
import '../widgets/custom_button.dart';
import '../widgets/custom_text_field.dart';
import '../widgets/skill_chip.dart';
import 'main_navigation_screen.dart';

class ProfileSetupScreen extends StatefulWidget {
  const ProfileSetupScreen({super.key});

  @override
  State<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends State<ProfileSetupScreen> {
  final TextEditingController _bioController = TextEditingController();
  final TextEditingController _cityController = TextEditingController();
  final TextEditingController _skillTeachController = TextEditingController();
  final TextEditingController _skillLearnController = TextEditingController();

  final List<String> _skillsToTeach = [];
  final List<String> _skillsToLearn = [];
  String _selectedCountry = 'United States of America';
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    final auth = Provider.of<AuthProvider>(context, listen: false);
    if (auth.currentUserProfile != null) {
      final p = auth.currentUserProfile!;
      _bioController.text = p.bio;
      _cityController.text = p.city;
      _selectedCountry = p.country;
      _skillsToTeach.addAll(p.skillsToTeach);
      _skillsToLearn.addAll(p.skillsToLearn);
    }
  }

  void _addTeachSkill(String skill) {
    final s = skill.trim();
    if (s.isNotEmpty && !_skillsToTeach.contains(s)) {
      setState(() {
        _skillsToTeach.add(s);
        _skillTeachController.clear();
      });
    }
  }

  void _addLearnSkill(String skill) {
    final s = skill.trim();
    if (s.isNotEmpty && !_skillsToLearn.contains(s)) {
      setState(() {
        _skillsToLearn.add(s);
        _skillLearnController.clear();
      });
    }
  }

  Future<void> _handleSave() async {
    if (_skillsToTeach.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please add at least 1 skill you can teach!')),
      );
      return;
    }

    setState(() => _isLoading = true);

    try {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      final current = auth.currentUserProfile;
      final user = auth.user;

      if (user != null) {
        final profile = UserProfile(
          uid: user.uid,
          email: user.email ?? current?.email ?? '',
          fullName: current?.fullName ?? user.displayName ?? 'Swap Partner',
          username: current?.username ?? 'user_${user.uid.substring(0, 5)}',
          bio: _bioController.text.trim(),
          city: _cityController.text.trim().isEmpty ? 'San Francisco' : _cityController.text.trim(),
          country: _selectedCountry,
          skillsToTeach: _skillsToTeach,
          skillsToLearn: _skillsToLearn,
          photoUrl: current?.photoUrl ?? user.photoURL ?? '',
          createdAt: current?.createdAt ?? DateTime.now(),
        );

        await auth.updateProfile(profile);

        if (!mounted) return;
        Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => const MainNavigationScreen()),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  void dispose() {
    _bioController.dispose();
    _cityController.dispose();
    _skillTeachController.dispose();
    _skillLearnController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text('Setup Your Profile', style: AppTypography.h2),
        backgroundColor: AppColors.surface,
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Complete your exchange profile',
                style: AppTypography.bodyMedium,
              ),
              const SizedBox(height: 20),

              // Skills to Teach
              Text('Skills You Can Teach', style: AppTypography.label),
              const SizedBox(height: 4),
              Text(
                'What crafts, languages, or tools are you confident sharing?',
                style: AppTypography.bodySmall,
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: CustomTextField(
                      controller: _skillTeachController,
                      hintText: 'e.g. Flutter, Spanish, UI Design',
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: () => _addTeachSkill(_skillTeachController.text),
                    icon: const Icon(Icons.add_rounded),
                    style: IconButton.styleFrom(backgroundColor: AppColors.primary),
                  ),
                ],
              ),
              if (_skillsToTeach.isNotEmpty) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: _skillsToTeach
                      .map((s) => SkillChip(
                            label: s,
                            type: SkillChipType.teach,
                            onDeleted: () => setState(() => _skillsToTeach.remove(s)),
                          ))
                      .toList(),
                ),
              ],
              const SizedBox(height: 24),

              // Skills to Learn
              Text('Skills You Want to Learn', style: AppTypography.label),
              const SizedBox(height: 4),
              Text(
                'What are you eager to master through 1-on-1 swaps?',
                style: AppTypography.bodySmall,
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: CustomTextField(
                      controller: _skillLearnController,
                      hintText: 'e.g. Python, Piano, French',
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: () => _addLearnSkill(_skillLearnController.text),
                    icon: const Icon(Icons.add_rounded),
                    style: IconButton.styleFrom(backgroundColor: AppColors.secondary),
                  ),
                ],
              ),
              if (_skillsToLearn.isNotEmpty) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: _skillsToLearn
                      .map((s) => SkillChip(
                            label: s,
                            type: SkillChipType.learn,
                            onDeleted: () => setState(() => _skillsToLearn.remove(s)),
                          ))
                      .toList(),
                ),
              ],
              const SizedBox(height: 24),

              // Bio
              CustomTextField(
                label: 'About You (Bio)',
                hintText: 'Share a bit about your background, passion projects, and exchange goals...',
                controller: _bioController,
                maxLines: 3,
              ),
              const SizedBox(height: 16),

              // City
              CustomTextField(
                label: 'City',
                hintText: 'San Francisco',
                controller: _cityController,
                prefixIcon: const Icon(Icons.location_on_outlined, color: AppColors.textMuted, size: 20),
              ),
              const SizedBox(height: 32),

              // Continue Button
              CustomButton(
                text: 'Save & Discover Mentors',
                isLoading: _isLoading,
                onPressed: _handleSave,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
