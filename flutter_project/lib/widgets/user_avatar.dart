import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../constants/app_colors.dart';
import '../constants/app_typography.dart';

class UserAvatar extends StatelessWidget {
  final String? imageUrl;
  final String name;
  final double radius;
  final bool showOnlineBadge;
  final bool isOnline;

  const UserAvatar({
    super.key,
    this.imageUrl,
    required this.name,
    this.radius = 24,
    this.showOnlineBadge = false,
    this.isOnline = false,
  });

  String _getInitials(String fullName) {
    if (fullName.trim().isEmpty) return 'U';
    final parts = fullName.trim().split(' ');
    if (parts.length >= 2 && parts[0].isNotEmpty && parts[1].isNotEmpty) {
      return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    }
    return fullName.substring(0, 1).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final bool hasValidUrl = imageUrl != null &&
        imageUrl!.isNotEmpty &&
        (imageUrl!.startsWith('http://') || imageUrl!.startsWith('https://'));

    return Stack(
      children: [
        CircleAvatar(
          radius: radius,
          backgroundColor: AppColors.primaryLight,
          child: hasValidUrl
              ? ClipOval(
                  child: CachedNetworkImage(
                    imageUrl: imageUrl!,
                    width: radius * 2,
                    height: radius * 2,
                    fit: BoxFit.cover,
                    placeholder: (context, url) => Container(
                      color: AppColors.primaryLight,
                      child: Center(
                        child: Text(
                          _getInitials(name),
                          style: AppTypography.label.copyWith(
                            color: AppColors.primary,
                            fontSize: radius * 0.7,
                          ),
                        ),
                      ),
                    ),
                    errorWidget: (context, url, error) => Container(
                      color: AppColors.primaryLight,
                      child: Center(
                        child: Text(
                          _getInitials(name),
                          style: AppTypography.label.copyWith(
                            color: AppColors.primary,
                            fontSize: radius * 0.7,
                          ),
                        ),
                      ),
                    ),
                  ),
                )
              : Center(
                  child: Text(
                    _getInitials(name),
                    style: AppTypography.label.copyWith(
                      color: AppColors.primary,
                      fontSize: radius * 0.7,
                    ),
                  ),
                ),
        ),
        if (showOnlineBadge)
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              width: (radius * 0.6).clamp(10.0, 14.0),
              height: (radius * 0.6).clamp(10.0, 14.0),
              decoration: BoxDecoration(
                color: isOnline ? AppColors.online : AppColors.offline,
                shape: BoxShape.circle,
                border: Border.writeToBorder(
                  Border.all(color: Colors.white, width: 2),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
