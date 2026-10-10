import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../../providers/auth_provider.dart';
import '../../models/notification_item.dart';
import '../../services/firestore_service.dart';
import '../../constants/app_colors.dart';
import '../../constants/app_typography.dart';
import '../../widgets/user_avatar.dart';
import '../discover/user_detail_screen.dart';
import '../sessions/sessions_screen.dart';

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final currentUid = auth.user?.uid ?? '';
    final firestoreService = FirestoreService();

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text('Activity & Alerts', style: AppTypography.h2),
        backgroundColor: AppColors.surface,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: AppColors.textPrimary, size: 18),
          onPressed: () => Navigator.of(context).pop(),
        ),
        actions: [
          TextButton(
            onPressed: () => firestoreService.markNotificationsRead(currentUid),
            child: Text('Mark all read', style: AppTypography.label.copyWith(color: AppColors.primary)),
          ),
        ],
      ),
      body: StreamBuilder<List<NotificationItem>>(
        stream: firestoreService.streamNotifications(currentUid),
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          final notifs = snapshot.data ?? [];
          if (notifs.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.notifications_off_outlined, size: 56, color: AppColors.textMuted),
                  const SizedBox(height: 12),
                  Text('No notifications yet', style: AppTypography.h3),
                  const SizedBox(height: 4),
                  Text('Session requests and reviews will appear here', style: AppTypography.bodySmall),
                ],
              ),
            );
          }

          return ListView.separated(
            padding: const EdgeInsets.symmetric(vertical: 8),
            itemCount: notifs.length,
            separatorBuilder: (context, index) => const Divider(height: 1, color: AppColors.borderLight),
            itemBuilder: (context, index) {
              final n = notifs[index];
              final timeStr = DateFormat('MMM d • h:mm a').format(n.createdAt);

              IconData iconData = Icons.notifications_rounded;
              Color iconColor = AppColors.primary;

              if (n.type == 'follower') {
                iconData = Icons.person_add_rounded;
                iconColor = AppColors.primary;
              } else if (n.type == 'session_request') {
                iconData = Icons.calendar_today_rounded;
                iconColor = AppColors.warning;
              } else if (n.type == 'session_accepted') {
                iconData = Icons.check_circle_rounded;
                iconColor = AppColors.success;
              } else if (n.type == 'review') {
                iconData = Icons.star_rounded;
                iconColor = AppColors.warning;
              }

              return Container(
                color: n.read ? Colors.transparent : AppColors.primaryLight.withOpacity(0.3),
                child: ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  leading: Stack(
                    children: [
                      UserAvatar(name: n.senderName, imageUrl: n.senderPhoto, radius: 22),
                      Positioned(
                        right: 0,
                        bottom: 0,
                        child: Container(
                          padding: const EdgeInsets.all(2),
                          decoration: const BoxDecoration(
                            color: Colors.white,
                            shape: BoxShape.circle,
                          ),
                          child: Icon(iconData, size: 12, color: iconColor),
                        ),
                      ),
                    ],
                  ),
                  title: RichText(
                    text: TextSpan(
                      style: AppTypography.bodyMedium,
                      children: [
                        TextSpan(text: n.senderName, style: AppTypography.label),
                        TextSpan(text: ' ${n.message}'),
                      ],
                    ),
                  ),
                  subtitle: Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(timeStr, style: AppTypography.caption),
                  ),
                  onTap: () {
                    if (n.type == 'follower') {
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => UserDetailScreen(userId: n.senderId)),
                      );
                    } else if (n.type.contains('session')) {
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const SessionsScreen()),
                      );
                    }
                  },
                ),
              );
            },
          );
        },
      ),
    );
  }
}
