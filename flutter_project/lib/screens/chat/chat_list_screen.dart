import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:intl/intl.dart';
import '../../providers/auth_provider.dart';
import '../../providers/chat_provider.dart';
import '../../models/chat.dart';
import '../../constants/app_colors.dart';
import '../../constants/app_typography.dart';
import '../../widgets/user_avatar.dart';
import 'chat_detail_screen.dart';

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key});

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final chatProvider = Provider.of<ChatProvider>(context);
    final currentUid = auth.user?.uid ?? '';

    var chats = chatProvider.chats;

    if (_searchQuery.isNotEmpty) {
      chats = chats.where((c) {
        final otherProfile = c.otherUserProfile;
        final name = otherProfile?.fullName.toLowerCase() ?? '';
        final lastMsg = c.lastMessage.toLowerCase();
        return name.contains(_searchQuery) || lastMsg.contains(_searchQuery);
      }).toList();
    }

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text('Messages', style: AppTypography.h2),
        backgroundColor: AppColors.surface,
        elevation: 0,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(56),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
            child: TextField(
              controller: _searchController,
              onChanged: (v) => setState(() => _searchQuery = v.trim().toLowerCase()),
              style: AppTypography.bodyMedium,
              decoration: InputDecoration(
                hintText: 'Search conversations...',
                prefixIcon: const Icon(Icons.search_rounded, color: AppColors.textMuted),
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
        ),
      ),
      body: chats.isEmpty
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.chat_bubble_outline_rounded, size: 56, color: AppColors.textMuted),
                  const SizedBox(height: 12),
                  Text('No conversations yet', style: AppTypography.h3),
                  const SizedBox(height: 4),
                  Text('Connect with mentors on Discover to start swapping', style: AppTypography.bodySmall),
                ],
              ),
            )
          : ListView.separated(
              itemCount: chats.length,
              separatorBuilder: (context, index) => const Divider(height: 1, color: AppColors.borderLight),
              itemBuilder: (context, index) {
                final chat = chats[index];
                final otherId = chat.getOtherParticipant(currentUid) ?? '';
                final otherProfile = chat.otherUserProfile;
                final name = otherProfile?.fullName ?? 'Swap Partner';
                final photo = otherProfile?.effectivePhotoUrl;
                final unread = chat.getUnreadFor(currentUid);
                final timeStr = DateFormat('h:mm a').format(chat.lastMessageTime);

                return ListTile(
                  contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  leading: UserAvatar(
                    name: name,
                    imageUrl: photo,
                    radius: 24,
                    showOnlineBadge: true,
                    isOnline: otherProfile?.isOnlineVisible ?? true,
                  ),
                  title: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          name,
                          style: AppTypography.label.copyWith(
                            fontSize: 15,
                            fontWeight: unread > 0 ? FontWeight.w700 : FontWeight.w600,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(
                        timeStr,
                        style: AppTypography.caption.copyWith(
                          color: unread > 0 ? AppColors.primary : AppColors.textMuted,
                          fontWeight: unread > 0 ? FontWeight.w700 : FontWeight.w400,
                        ),
                      ),
                    ],
                  ),
                  subtitle: Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            chat.lastMessage,
                            style: AppTypography.bodySmall.copyWith(
                              color: unread > 0 ? AppColors.textPrimary : AppColors.textSecondary,
                              fontWeight: unread > 0 ? FontWeight.w600 : FontWeight.w400,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (unread > 0)
                          Container(
                            margin: const EdgeInsets.only(left: 8),
                            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                            decoration: BoxDecoration(
                              color: AppColors.primary,
                              borderRadius: BorderRadius.circular(10),
                            ),
                            child: Text(
                              '$unread',
                              style: AppTypography.caption.copyWith(
                                color: Colors.white,
                                fontWeight: FontWeight.w700,
                                fontSize: 10,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  onTap: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => ChatDetailScreen(
                          chatId: chat.id,
                          otherUserId: otherId,
                          otherUserName: name,
                          otherUserPhoto: photo,
                          isLegacy: chat.isLegacy,
                        ),
                      ),
                    );
                  },
                );
              },
            ),
    );
  }
}
