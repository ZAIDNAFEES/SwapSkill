import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:image_picker/image_picker.dart';
import '../../providers/auth_provider.dart';
import '../../models/message.dart';
import '../../services/conversation_service.dart';
import '../../services/storage_service.dart';
import '../../constants/app_colors.dart';
import '../../constants/app_typography.dart';
import '../../widgets/user_avatar.dart';
import '../../widgets/chat_bubble.dart';
import '../discover/user_detail_screen.dart';

class ChatDetailScreen extends StatefulWidget {
  final String chatId;
  final String otherUserId;
  final String otherUserName;
  final String? otherUserPhoto;
  final bool isLegacy;

  const ChatDetailScreen({
    super.key,
    required this.chatId,
    required this.otherUserId,
    required this.otherUserName,
    this.otherUserPhoto,
    this.isLegacy = false,
  });

  @override
  State<ChatDetailScreen> createState() => _ChatDetailScreenState();
}

class _ChatDetailScreenState extends State<ChatDetailScreen> {
  final ConversationService _conversationService = ConversationService();
  final StorageService _storageService = StorageService();
  final TextEditingController _textController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final ImagePicker _picker = ImagePicker();

  Message? _replyingTo;
  bool _isUploading = false;

  @override
  void initState() {
    super.initState();
    _markRead();
  }

  void _markRead() {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    if (auth.user != null) {
      _conversationService.markConversationAsRead(
        widget.chatId,
        auth.user!.uid,
        isLegacy: widget.isLegacy,
      );
    }
  }

  Future<void> _handleSendMessage() async {
    final text = _textController.text.trim();
    if (text.isEmpty && !_isUploading) return;

    final auth = Provider.of<AuthProvider>(context, listen: false);
    if (auth.user == null) return;

    _textController.clear();
    final reply = _replyingTo;
    setState(() => _replyingTo = null);

    try {
      await _conversationService.sendMessage(
        chatId: widget.chatId,
        currentUserId: auth.user!.uid,
        otherUserId: widget.otherUserId,
        text: text,
        replyToId: reply?.id,
        replyToText: reply?.text,
        isLegacy: widget.isLegacy,
      );

      _scrollController.animateTo(
        0,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to send: $e'), backgroundColor: AppColors.danger),
      );
    }
  }

  Future<void> _pickAndSendImage() async {
    final picked = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 75);
    if (picked == null) return;

    final auth = Provider.of<AuthProvider>(context, listen: false);
    if (auth.user == null) return;

    setState(() => _isUploading = true);

    try {
      final file = File(picked.path);
      final downloadUrl = await _storageService.uploadChatAttachment(file, widget.chatId, 'jpg');

      await _conversationService.sendMessage(
        chatId: widget.chatId,
        currentUserId: auth.user!.uid,
        otherUserId: widget.otherUserId,
        text: '',
        imageUrl: downloadUrl,
        isLegacy: widget.isLegacy,
      );
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to upload image: $e'), backgroundColor: AppColors.danger),
      );
    } finally {
      if (mounted) setState(() => _isUploading = false);
    }
  }

  @override
  void dispose() {
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final currentUid = auth.user?.uid ?? '';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, color: AppColors.textPrimary, size: 18),
          onPressed: () => Navigator.of(context).pop(),
        ),
        titleSpacing: 0,
        title: InkWell(
          onTap: () {
            Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => UserDetailScreen(userId: widget.otherUserId)),
            );
          },
          child: Row(
            children: [
              UserAvatar(
                name: widget.otherUserName,
                imageUrl: widget.otherUserPhoto,
                radius: 18,
                showOnlineBadge: true,
                isOnline: true,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.otherUserName,
                      style: AppTypography.label.copyWith(fontSize: 15),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    Text(
                      'Online • Swap Partner',
                      style: AppTypography.caption.copyWith(color: AppColors.online),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.info_outline_rounded, color: AppColors.textPrimary),
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => UserDetailScreen(userId: widget.otherUserId)),
              );
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // Messages stream
          Expanded(
            child: StreamBuilder<List<Message>>(
              stream: _conversationService.streamMessages(widget.chatId, isLegacy: widget.isLegacy),
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }

                final messages = snapshot.data ?? [];
                if (messages.isEmpty) {
                  return Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        UserAvatar(name: widget.otherUserName, imageUrl: widget.otherUserPhoto, radius: 32),
                        const SizedBox(height: 12),
                        Text('Say hello to ${widget.otherUserName}!', style: AppTypography.h3),
                        const SizedBox(height: 4),
                        Text('Discuss your skills and schedule a swap session', style: AppTypography.bodySmall),
                      ],
                    ),
                  );
                }

                return ListView.builder(
                  controller: _scrollController,
                  reverse: true,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  itemCount: messages.length,
                  itemBuilder: (context, index) {
                    final msg = messages[index];
                    final isMe = msg.senderId == currentUid;
                    return ChatBubble(
                      message: msg,
                      isMe: isMe,
                      onReply: () => setState(() => _replyingTo = msg),
                    );
                  },
                );
              },
            ),
          ),

          // Uploading indicator
          if (_isUploading)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 16),
              color: AppColors.surface,
              child: Row(
                children: [
                  const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
                  const SizedBox(width: 10),
                  Text('Uploading media...', style: AppTypography.caption),
                ],
              ),
            ),

          // Reply Bar Preview
          if (_replyingTo != null)
            Container(
              color: AppColors.surface,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Row(
                children: [
                  Container(
                    width: 3,
                    height: 32,
                    decoration: BoxDecoration(
                      color: AppColors.primary,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Replying to message', style: AppTypography.caption.copyWith(fontWeight: FontWeight.w700)),
                        Text(
                          _replyingTo!.text.isNotEmpty ? _replyingTo!.text : 'Attachment',
                          style: AppTypography.bodySmall,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close_rounded, size: 18),
                    onPressed: () => setState(() => _replyingTo = null),
                  ),
                ],
              ),
            ),

          // Bottom Input Bar
          Container(
            padding: EdgeInsets.only(
              left: 12,
              right: 12,
              top: 8,
              bottom: MediaQuery.of(context).viewInsets.bottom > 0 ? 8 : 16,
            ),
            decoration: const BoxDecoration(
              color: AppColors.surface,
              border: Border(top: BorderSide(color: AppColors.border, width: 1)),
            ),
            child: Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.photo_outlined, color: AppColors.primary),
                  onPressed: _isUploading ? null : _pickAndSendImage,
                ),
                Expanded(
                  child: TextField(
                    controller: _textController,
                    minLines: 1,
                    maxLines: 4,
                    style: AppTypography.bodyMedium,
                    decoration: InputDecoration(
                      hintText: 'Type a message...',
                      hintStyle: AppTypography.bodyMedium.copyWith(color: AppColors.textMuted),
                      filled: true,
                      fillColor: AppColors.background,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(20),
                        borderSide: BorderSide.none,
                      ),
                    ),
                    onSubmitted: (_) => _handleSendMessage(),
                  ),
                ),
                const SizedBox(width: 6),
                IconButton.filled(
                  onPressed: _handleSendMessage,
                  icon: const Icon(Icons.send_rounded, size: 18),
                  style: IconButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
