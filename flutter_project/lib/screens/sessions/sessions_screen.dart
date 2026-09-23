import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../models/session.dart';
import '../../services/session_service.dart';
import '../../constants/app_colors.dart';
import '../../constants/app_typography.dart';
import '../../widgets/session_card.dart';
import '../webrtc/video_call_screen.dart';
import 'leave_review_dialog.dart';

class SessionsScreen extends StatefulWidget {
  const SessionsScreen({super.key});

  @override
  State<SessionsScreen> createState() => _SessionsScreenState();
}

class _SessionsScreenState extends State<SessionsScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  final SessionService _sessionService = SessionService();

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  void _launchVideoCall(SwapSession session, String currentUserId, String currentUserName, String? currentUserPhoto) {
    final otherUserId = session.getOtherUserId(currentUserId);
    final otherUserName = session.getOtherUserName(currentUserId);

    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => VideoCallScreen(
          swapSessionId: session.id,
          callId: 'call_${session.id}',
          otherUserId: otherUserId,
          otherUserName: otherUserName,
          isCaller: true,
        ),
      ),
    );
  }

  void _showReviewDialog(SwapSession session, String currentUserId, String currentUserName) {
    showDialog(
      context: context,
      builder: (ctx) => LeaveReviewDialog(
        session: session,
        currentUserId: currentUserId,
        currentUserName: currentUserName,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final currentUid = auth.user?.uid ?? '';
    final currentName = auth.currentUserProfile?.fullName ?? 'Member';
    final currentPhoto = auth.currentUserProfile?.effectivePhotoUrl;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text('Swap Sessions', style: AppTypography.h2),
        backgroundColor: AppColors.surface,
        elevation: 0,
        bottom: TabBar(
          controller: _tabController,
          labelColor: AppColors.primary,
          unselectedLabelColor: AppColors.textMuted,
          indicatorColor: AppColors.primary,
          labelStyle: AppTypography.label,
          tabs: const [
            Tab(text: 'Accepted'),
            Tab(text: 'Pending'),
            Tab(text: 'Completed'),
            Tab(text: 'All'),
          ],
        ),
      ),
      body: StreamBuilder<List<SwapSession>>(
        stream: currentUid.isNotEmpty ? _sessionService.streamUserSessions(currentUid) : null,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          }

          final allSessions = snapshot.data ?? [];

          final accepted = allSessions.where((s) => s.isAccepted).toList();
          final pending = allSessions.where((s) => s.isPending).toList();
          final completed = allSessions.where((s) => s.isCompleted).toList();

          return TabBarView(
            controller: _tabController,
            children: [
              _buildSessionList(accepted, currentUid, currentName, currentPhoto, 'No accepted sessions yet. Schedule one to start!'),
              _buildSessionList(pending, currentUid, currentName, currentPhoto, 'No pending swap requests.'),
              _buildSessionList(completed, currentUid, currentName, currentPhoto, 'No completed swap sessions yet.'),
              _buildSessionList(allSessions, currentUid, currentName, currentPhoto, 'No swap sessions recorded.'),
            ],
          );
        },
      ),
    );
  }

  Widget _buildSessionList(
    List<SwapSession> list,
    String currentUid,
    String currentName,
    String? currentPhoto,
    String emptyMessage,
  ) {
    if (list.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.calendar_month_outlined, size: 56, color: AppColors.textMuted),
            const SizedBox(height: 12),
            Text(emptyMessage, style: AppTypography.bodyMedium, textAlign: TextAlign.center),
          ],
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 8),
      itemCount: list.length,
      itemBuilder: (context, index) {
        final session = list[index];
        return SessionCard(
          session: session,
          currentUserId: currentUid,
          onAccept: () => _sessionService.acceptSession(session.id, currentUid),
          onDecline: () => _sessionService.cancelOrDeclineSession(session.id, currentUid),
          onLaunchCall: () => _launchVideoCall(session, currentUid, currentName, currentPhoto),
          onComplete: () => _sessionService.completeSession(session.id),
          onReview: () => _showReviewDialog(session, currentUid, currentName),
        );
      },
    );
  }
}
