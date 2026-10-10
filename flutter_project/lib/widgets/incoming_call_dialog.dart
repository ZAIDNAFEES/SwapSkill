import 'package:flutter/material.dart';
import '../models/webrtc_call.dart';
import '../constants/app_colors.dart';
import '../constants/app_typography.dart';
import 'user_avatar.dart';

class IncomingCallDialog extends StatelessWidget {
  final WebRTCCallDoc call;
  final VoidCallback onAccept;
  final VoidCallback onDecline;

  const IncomingCallDialog({
    super.key,
    required this.call,
    required this.onAccept,
    required this.onDecline,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: Center(
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 24),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.15),
                blurRadius: 20,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.primaryLight,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.videocam_rounded, size: 14, color: AppColors.primary),
                    const SizedBox(width: 4),
                    Text(
                      'INCOMING SWAP CALL',
                      style: AppTypography.caption.copyWith(
                        color: AppColors.primary,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              UserAvatar(
                name: call.callerName,
                imageUrl: call.callerPhoto,
                radius: 36,
              ),
              const SizedBox(height: 12),
              Text(
                call.callerName,
                style: AppTypography.h2,
              ),
              const SizedBox(height: 4),
              Text(
                'Live 1-on-1 Skill Exchange Session',
                style: AppTypography.bodySmall,
              ),
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  // Decline Button
                  Column(
                    children: [
                      InkWell(
                        onTap: onDecline,
                        borderRadius: BorderRadius.circular(30),
                        child: Container(
                          width: 56,
                          height: 56,
                          decoration: const BoxDecoration(
                            color: AppColors.danger,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.call_end_rounded, color: Colors.white, size: 28),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text('Decline', style: AppTypography.caption),
                    ],
                  ),
                  // Accept Button
                  Column(
                    children: [
                      InkWell(
                        onTap: onAccept,
                        borderRadius: BorderRadius.circular(30),
                        child: Container(
                          width: 56,
                          height: 56,
                          decoration: const BoxDecoration(
                            color: AppColors.success,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(Icons.videocam_rounded, color: Colors.white, size: 28),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text('Accept', style: AppTypography.caption.copyWith(color: AppColors.success, fontWeight: FontWeight.w700)),
                    ],
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
