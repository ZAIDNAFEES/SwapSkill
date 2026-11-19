import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../../providers/auth_provider.dart';
import '../../models/user_profile.dart';
import '../../services/session_service.dart';
import '../../constants/app_colors.dart';
import '../../constants/app_typography.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';
import '../../widgets/skill_chip.dart';

class BookSessionSheet extends StatefulWidget {
  final UserProfile mentor;
  const BookSessionSheet({super.key, required this.mentor});

  @override
  State<BookSessionSheet> createState() => _BookSessionSheetState();
}

class _BookSessionSheetState extends State<BookSessionSheet> {
  final SessionService _sessionService = SessionService();
  final TextEditingController _notesController = TextEditingController();

  String? _selectedSkill;
  DateTime _selectedDate = DateTime.now().add(const Duration(days: 1));
  TimeOfDay _selectedTime = const TimeOfDay(hour: 14, minute: 0);
  int _durationMinutes = 45;
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    if (widget.mentor.skillsToTeach.isNotEmpty) {
      _selectedSkill = widget.mentor.skillsToTeach.first;
    }
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 60)),
    );
    if (picked != null) {
      setState(() => _selectedDate = picked);
    }
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _selectedTime,
    );
    if (picked != null) {
      setState(() => _selectedTime = picked);
    }
  }

  Future<void> _submitRequest() async {
    if (_selectedSkill == null || _selectedSkill!.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a skill to learn')),
      );
      return;
    }

    final auth = Provider.of<AuthProvider>(context, listen: false);
    final user = auth.currentUserProfile;
    if (user == null) return;

    setState(() => _isLoading = true);

    try {
      final scheduledDateTime = DateTime(
        _selectedDate.year,
        _selectedDate.month,
        _selectedDate.day,
        _selectedTime.hour,
        _selectedTime.minute,
      );

      await _sessionService.requestSwapSession(
        teacherId: widget.mentor.uid,
        learnerId: user.uid,
        teacherName: widget.mentor.fullName,
        learnerName: user.fullName,
        skillName: _selectedSkill!,
        scheduledTime: scheduledDateTime,
        duration: _durationMinutes,
        notes: _notesController.text.trim(),
      );

      if (!mounted) return;
      Navigator.of(context).pop();

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Swap session requested with ${widget.mentor.fullName}!'),
          backgroundColor: AppColors.success,
        ),
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Error: $e'), backgroundColor: AppColors.danger),
      );
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dateStr = DateFormat('EEE, MMM d, yyyy').format(_selectedDate);
    final timeStr = _selectedTime.format(context);

    return Container(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Handle bar
            Center(
              child: Container(
                width: 40,
                height: 4,
                decoration: BoxDecoration(
                  color: AppColors.border,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text('Book Skill Swap Session', style: AppTypography.h2),
            Text('With ${widget.mentor.fullName}', style: AppTypography.bodySmall),
            const SizedBox(height: 20),

            // Select Skill
            Text('Select Skill to Learn', style: AppTypography.label),
            const SizedBox(height: 8),
            if (widget.mentor.skillsToTeach.isNotEmpty)
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: widget.mentor.skillsToTeach.map((s) {
                  final isSelected = _selectedSkill == s;
                  return ChoiceChip(
                    label: Text(s),
                    selected: isSelected,
                    onSelected: (_) => setState(() => _selectedSkill = s),
                    selectedColor: AppColors.primaryLight,
                    labelStyle: AppTypography.caption.copyWith(
                      color: isSelected ? AppColors.primary : AppColors.textSecondary,
                      fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                    ),
                  );
                }).toList(),
              )
            else
              Text('Mentor has not listed teachable skills', style: AppTypography.bodySmall),
            const SizedBox(height: 20),

            // Date & Time Picker Row
            Row(
              children: [
                Expanded(
                  child: InkWell(
                    onTap: _pickDate,
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        border: Border.all(color: AppColors.border),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Date', style: AppTypography.caption),
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              const Icon(Icons.calendar_today_rounded, size: 16, color: AppColors.primary),
                              const SizedBox(width: 6),
                              Flexible(child: Text(dateStr, style: AppTypography.label, maxLines: 1)),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: InkWell(
                    onTap: _pickTime,
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        border: Border.all(color: AppColors.border),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Time', style: AppTypography.caption),
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              const Icon(Icons.access_time_rounded, size: 16, color: AppColors.primary),
                              const SizedBox(width: 6),
                              Flexible(child: Text(timeStr, style: AppTypography.label, maxLines: 1)),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),

            // Duration Slider
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Session Duration', style: AppTypography.label),
                Text('$_durationMinutes minutes', style: AppTypography.label.copyWith(color: AppColors.primary)),
              ],
            ),
            Slider(
              value: _durationMinutes.toDouble(),
              min: 15,
              max: 90,
              divisions: 5,
              activeColor: AppColors.primary,
              onChanged: (v) => setState(() => _durationMinutes = v.toInt()),
            ),
            const SizedBox(height: 12),

            // Notes
            CustomTextField(
              label: 'Notes & Goals (Optional)',
              hintText: 'What specific topic or code challenge do you want to tackle?',
              controller: _notesController,
              maxLines: 2,
            ),
            const SizedBox(height: 24),

            // Submit Button
            CustomButton(
              text: 'Send Swap Request',
              isLoading: _isLoading,
              onPressed: _submitRequest,
            ),
          ],
        ),
      ),
    );
  }
}
