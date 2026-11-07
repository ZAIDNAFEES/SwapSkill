import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:intl/intl.dart';
import '../models/message.dart';
import '../constants/app_colors.dart';
import '../constants/app_typography.dart';

class ChatBubble extends StatelessWidget {
  final Message message;
  final bool isMe;
  final VoidCallback? onReply;
  final VoidCallback? onLongPress;

  const ChatBubble({
    super.key,
    required this.message,
    required this.isMe,
    this.onReply,
    this.onLongPress,
  });

  @override
  Widget build(BuildContext context) {
    final formattedTime = DateFormat('h:mm a').format(message.timestamp);

    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 12),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
        decoration: BoxDecoration(
          color: isMe ? AppColors.primary : AppColors.surface,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(isMe ? 16 : 4),
            bottomRight: Radius.circular(isMe ? 4 : 16),
          ),
          border: isMe ? null : Border.all(color: AppColors.border, width: 1),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.04),
              blurRadius: 3,
              offset: const Offset(0, 1),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          child: Column(
            crossAxisAlignment: isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start,
            children: [
              // Reply preview
              if (message.replyToText != null && message.replyToText!.isNotEmpty) ...[
                Container(
                  margin: const EdgeInsets.only(bottom: 6),
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: isMe ? Colors.black.withOpacity(0.15) : AppColors.borderLight,
                    borderRadius: BorderRadius.circular(8),
                    border: Border(
                      left: BorderSide(
                        color: isMe ? Colors.white70 : AppColors.primary,
                        width: 3,
                      ),
                    ),
                  ),
                  child: Text(
                    message.replyToText!,
                    style: AppTypography.caption.copyWith(
                      color: isMe ? Colors.white70 : AppColors.textSecondary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],

              // Image attachment
              if (message.imageUrl != null && message.imageUrl!.isNotEmpty) ...[
                ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: CachedNetworkImage(
                    imageUrl: message.imageUrl!,
                    fit: BoxFit.cover,
                    placeholder: (context, url) => Container(
                      height: 180,
                      color: isMe ? Colors.white12 : AppColors.borderLight,
                      child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
                    ),
                    errorWidget: (context, url, error) => const Icon(Icons.broken_image),
                  ),
                ),
                if (message.text.isNotEmpty) const SizedBox(height: 6),
              ],

              // Text
              if (message.text.isNotEmpty)
                Text(
                  message.text,
                  style: AppTypography.bodyLarge.copyWith(
                    color: isMe ? Colors.white : AppColors.textPrimary,
                    fontSize: 15,
                  ),
                ),

              const SizedBox(height: 4),

              // Time & Status row
              Row(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  Text(
                    formattedTime,
                    style: AppTypography.caption.copyWith(
                      color: isMe ? Colors.white70 : AppColors.textMuted,
                      fontSize: 10,
                    ),
                  ),
                  if (isMe) ...[
                    const SizedBox(width: 4),
                    Icon(
                      message.status == MessageStatus.seen
                          ? Icons.done_all_rounded
                          : message.status == MessageStatus.delivered
                              ? Icons.done_all_rounded
                              : Icons.done_rounded,
                      size: 13,
                      color: message.status == MessageStatus.seen
                          ? Colors.lightBlueAccent
                          : Colors.white70,
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
