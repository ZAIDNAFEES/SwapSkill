import 'package:flutter/material.dart';
import '../../models/session.dart';
import '../../services/session_service.dart';
import '../../constants/app_colors.dart';
import '../../constants/app_typography.dart';
import '../../widgets/custom_button.dart';
import '../../widgets/custom_text_field.dart';

class LeaveReviewDialog extends StatefulWidget {
  final SwapSession session;
  final String currentUserId;
  final String currentUserName;

  const LeaveReviewDialog({
    super.key,
    required this.session,
    required this.currentUserId,
    required this.currentUserName,
  });

  @override
  State<LeaveReviewDialog> createState() => _LeaveReviewDialogState();
}

class _LeaveReviewDialogState extends State<LeaveReviewDialog> {
  final SessionService _sessionService = SessionService();
  final TextEditingController _commentController = TextEditingController();
  double _rating = 5.0;
  bool _isLoading = false;

  Future<void> _submitReview() async {
    if (_commentController.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please write a brief comment')),
      );
      return;
    }

    setState(() => _isLoading = true);

    try {
      final revieweeId = widget.session.getOtherUserId(widget.currentUserId);
      await _sessionService.submitReview(
        sessionId: widget.session.id,
        reviewerId: widget.currentUserId,
        revieweeId: revieweeId,
        reviewerName: widget.currentUserName,
        rating: _rating,
        comment: _commentController.text.trim(),
      );

      if (!mounted) return;
      Navigator.of(context).pop();

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Review submitted! Thank you for endorsing your partner.'),
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
    _commentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final otherName = widget.session.getOtherUserName(widget.currentUserId);

    return Dialog(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Rate Your Swap Experience', style: AppTypography.h2, textAlign: TextAlign.center),
            const SizedBox(height: 4),
            Text('With $otherName for "${widget.session.skillName}"', style: AppTypography.bodySmall, textAlign: TextAlign.center),
            const SizedBox(height: 20),

            // Star Rating Selector
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(5, (index) {
                final starVal = index + 1.0;
                return IconButton(
                  onPressed: () => setState(() => _rating = starVal),
                  icon: Icon(
                    starVal <= _rating ? Icons.star_rounded : Icons.star_outline_rounded,
                    color: AppColors.warning,
                    size: 36,
                  ),
                );
              }),
            ),
            Center(
              child: Text('$_rating / 5.0 Stars', style: AppTypography.label.copyWith(color: AppColors.warning)),
            ),
            const SizedBox(height: 16),

            // Comment
            CustomTextField(
              label: 'Feedback & Endorsement',
              hintText: 'Was the session helpful, polite, and well-paced?',
              controller: _commentController,
              maxLines: 3,
            ),
            const SizedBox(height: 20),

            // Actions
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    style: OutlinedButton.styleFrom(
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: CustomButton(
                    text: 'Submit',
                    isLoading: _isLoading,
                    onPressed: _submitReview,
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
