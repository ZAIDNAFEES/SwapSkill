import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';
import '../../providers/auth_provider.dart';
import '../../models/user_profile.dart';
import '../../services/storage_service.dart';
import '../../constants/app_colors.dart';
import '../../constants/app_typography.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';
import '../../widgets/skill_chip.dart';
import '../../widgets/user_avatar.dart';

class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  final StorageService _storageService = StorageService();
  final ImagePicker _picker = ImagePicker();

  late TextEditingController _nameController;
  late TextEditingController _usernameController;
  late TextEditingController _bioController;
  late TextEditingController _cityController;
  late TextEditingController _countryController;
  final TextEditingController _teachSkillController = TextEditingController();
  final TextEditingController _learnSkillController = TextEditingController();

  final List<String> _skillsToTeach = [];
  final List<String> _skillsToLearn = [];
  String? _photoUrl;
  String? _coverUrl;
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final user = auth.currentUserProfile;

    _nameController = TextEditingController(text: user?.fullName ?? '');
    _usernameController = TextEditingController(text: user?.username ?? '');
    _bioController = TextEditingController(text: user?.bio ?? '');
    _cityController = TextEditingController(text: user?.city ?? 'San Francisco');
    _countryController = TextEditingController(text: user?.country ?? 'United States');

    if (user != null) {
      _skillsToTeach.addAll(user.skillsToTeach);
      _skillsToLearn.addAll(user.skillsToLearn);
      _photoUrl = user.effectivePhotoUrl;
      _coverUrl = user.effectiveCoverUrl;
    }
  }

  Future<void> _pickAvatar() async {
    final picked = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 80);
    if (picked == null) return;

    final auth = Provider.of<AuthProvider>(context, listen: false);
    if (auth.user == null) return;

    setState(() => _isLoading = true);
    try {
      final url = await _storageService.uploadProfileImage(File(picked.path), auth.user!.uid);
      setState(() => _photoUrl = url);
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error: $e')));
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _handleSave() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final current = auth.currentUserProfile;
    if (current == null) return;

    setState(() => _isLoading = true);

    try {
      final updated = UserProfile(
        uid: current.uid,
        email: current.email,
        fullName: _nameController.text.trim(),
        username: _usernameController.text.trim(),
        bio: _bioController.text.trim(),
        city: _cityController.text.trim(),
        country: _countryController.text.trim(),
        skillsToTeach: _skillsToTeach,
        skillsToLearn: _skillsToLearn,
        photoUrl: _photoUrl ?? current.photoUrl,
        profilePhotoUrl: _photoUrl ?? current.profilePhotoUrl,
        coverUrl: _coverUrl ?? current.coverUrl,
        coverPhotoUrl: _coverUrl ?? current.coverPhotoUrl,
        followersCount: current.followersCount,
        followingCount: current.followingCount,
        points: current.points,
        sessionsCount: current.sessionsCount,
        rating: current.rating,
        reviewCount: current.reviewCount,
        followingList: current.followingList,
        followers: current.followers,
        following: current.following,
        blockedUsers: current.blockedUsers,
        verified: current.verified,
        createdAt: current.createdAt,
      );

      await auth.updateProfile(updated);

      if (!mounted) return;
      Navigator.of(context).pop();

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Profile updated successfully!'),
          backgroundColor: AppColors.success,
        ),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to update: $e'), backgroundColor: AppColors.danger),
      );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _usernameController.dispose();
    _bioController.dispose();
    _cityController.dispose();
    _countryController.dispose();
    _teachSkillController.dispose();
    _learnSkillController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text('Edit Profile', style: AppTypography.h2),
        backgroundColor: AppColors.surface,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: AppColors.textPrimary, size: 18),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Avatar Change
              Center(
                child: Stack(
                  children: [
                    UserAvatar(
                      name: _nameController.text,
                      imageUrl: _photoUrl,
                      radius: 46,
                    ),
                    Positioned(
                      bottom: 0,
                      right: 0,
                      child: InkWell(
                        onTap: _pickAvatar,
                        borderRadius: BorderRadius.circular(20),
                        child: Container(
                          padding: const EdgeInsets.all(8),
                          decoration: const BoxDecoration(
                            color: AppColors.primary,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.camera_alt_rounded, size: 18, color: Colors.white),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),

              CustomTextField(
                label: 'Full Name',
                controller: _nameController,
              ),
              const SizedBox(height: 16),

              CustomTextField(
                label: 'Username',
                controller: _usernameController,
              ),
              const SizedBox(height: 16),

              CustomTextField(
                label: 'Bio',
                controller: _bioController,
                maxLines: 3,
              ),
              const SizedBox(height: 16),

              Row(
                children: [
                  Expanded(
                    child: CustomTextField(
                      label: 'City',
                      controller: _cityController,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: CustomTextField(
                      label: 'Country',
                      controller: _countryController,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 24),

              // Teachable Skills
              Text('Skills You Can Teach', style: AppTypography.label),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: CustomTextField(
                      controller: _teachSkillController,
                      hintText: 'Add skill to teach...',
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: () {
                      final s = _teachSkillController.text.trim();
                      if (s.isNotEmpty && !_skillsToTeach.contains(s)) {
                        setState(() {
                          _skillsToTeach.add(s);
                          _teachSkillController.clear();
                        });
                      }
                    },
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

              // Learning Skills
              Text('Skills You Want to Learn', style: AppTypography.label),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: CustomTextField(
                      controller: _learnSkillController,
                      hintText: 'Add skill to learn...',
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    onPressed: () {
                      final s = _learnSkillController.text.trim();
                      if (s.isNotEmpty && !_skillsToLearn.contains(s)) {
                        setState(() {
                          _skillsToLearn.add(s);
                          _learnSkillController.clear();
                        });
                      }
                    },
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
              const SizedBox(height: 32),

              CustomButton(
                text: 'Save Changes',
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
