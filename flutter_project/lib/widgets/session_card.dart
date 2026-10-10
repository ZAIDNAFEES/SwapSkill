import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/session.dart';
import '../constants/app_colors.dart';
import '../constants/app_typography.dart';
import 'user_avatar.dart';

class SessionCard extends StatelessWidget {
  final SwapSession session;
  final String currentUserId;
  final VoidCallback? onAccept;
  final VoidCallback? onDecline;
  final VoidCallback? onLaunchCall;
  final VoidCallback? onComplete;
  final VoidCallback? onReview;
  final VoidCallback? onTap;

  const SessionCard({
    super.key,
    required this.session,
    required this.currentUserId,
    this.onAccept,
    this.onDecline,
    this.onLaunchCall,
    this.onComplete,
    this.onReview,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isTeacher = session.isTeacher(currentUserId);
    final otherName = session.getOtherUserName(currentUserId);
    final formattedDate = DateFormat('EEE, MMM d • h:mm a').format(session.scheduledTime);

    Color statusBg;
    Color statusTextColor;
    String statusLabel = session.status.toUpperCase();

    switch (session.status.toLowerCase()) {
      case 'accepted':
        statusBg = AppColors.successLight;
        statusTextColor = AppColors.success;
        statusLabel = 'ACCEPTED';
        break;
      case 'requested':
      case 'pending':
        statusBg = AppColors.warningLight;
        statusTextColor = AppColors.warning;
        statusLabel = 'PENDING';
        break;
      case 'completed':
        statusBg = AppColors.primaryLight;
        statusTextColor = AppColors.primary;
        statusLabel = 'COMPLETED';
        break;
      case 'cancelled':
      case 'declined':
        statusBg = AppColors.dangerLight;
        statusTextColor = AppColors.danger;
        statusLabel = 'CANCELLED';
        break;
      default:
        statusBg = AppColors.borderLight;
        statusTextColor = AppColors.textSecondary;
    }

    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: AppColors.border, width: 1),
      ),
      margin: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
      color: AppColors.card,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header row: Skill & Status Badge
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      session.skillName,
                      style: AppTypography.h3.copyWith(fontSize: 16),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: statusBg,
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      statusLabel,
                      style: AppTypography.caption.copyWith(
                        color: statusTextColor,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Partner Row
              Row(
                children: [
                  UserAvatar(name: otherName, radius: 18),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          otherName,
                          style: AppTypography.label,
                        ),
                        Text(
                          isTeacher ? 'Learning from you' : 'Teaching you',
                          style: AppTypography.bodySmall,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Time & Duration Row
              Row(
                children: [
                  const Icon(Icons.access_time_rounded, size: 16, color: AppColors.textMuted),
                  const SizedBox(width: 6),
                  Text(
                    formattedDate,
                    style: AppTypography.bodyMedium.copyWith(color: AppColors.textSecondary),
                  ),
                  const SizedBox(width: 12),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.borderLight,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      '${session.duration} min',
                      style: AppTypography.caption,
                    ),
                  ),
                ],
              ),

              if (session.notes != null && session.notes!.isNotEmpty) ...[
                const SizedBox(height: 8),
                Text(
                  session.notes!,
                  style: AppTypography.bodySmall.copyWith(fontStyle: FontStyle.italic),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],

              const SizedBox(height: 14),
              const Divider(height: 1, color: AppColors.border),
              const SizedBox(height: 12),

              // Action Buttons
              if (session.isAccepted) ...[
                // Video Call Button for Accepted Sessions
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: onLaunchCall,
                    icon: const Icon(Icons.videocam_rounded, size: 20),
                    label: const Text('Start Live Video Call'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ),
              ] else if (session.isPending && isTeacher) ...[
                // Accept / Decline Row for Teacher
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: onDecline,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.danger,
                          side: const BorderSide(color: AppColors.danger),
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        child: const Text('Decline'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: ElevatedButton(
                        onPressed: onAccept,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.success,
                          foregroundColor: Colors.white,
                          padding: const EdgeInsets.symmetric(vertical: 10),
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(10),
                          ),
                        ),
                        child: const Text('Accept Swap'),
                      ),
                    ),
                  ],
                ),
              ] else if (session.isCompleted) ...[
                // Completed State: Review button
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: onReview,
                    icon: const Icon(Icons.star_rounded, size: 18, color: AppColors.warning),
                    label: const Text('Leave a Review'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.textPrimary,
                      side: const BorderSide(color: AppColors.border),
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ),
              ] else ...[
                // Awaiting confirmation banner
                Center(
                  child: Text(
                    session.isPending
                        ? 'Waiting for ${session.teacherName} to accept'
                        : 'Session closed',
                    style: AppTypography.bodySmall,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
