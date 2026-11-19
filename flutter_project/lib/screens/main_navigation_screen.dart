import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/chat_provider.dart';
import '../providers/call_provider.dart';
import '../constants/app_colors.dart';
import '../constants/app_typography.dart';
import 'discover/discover_screen.dart';
import 'explore/explore_screen.dart';
import 'sessions/sessions_screen.dart';
import 'chat/chat_list_screen.dart';
import 'profile/profile_screen.dart';
import 'notifications/notifications_screen.dart';
import 'webrtc/video_call_screen.dart';
import '../widgets/incoming_call_dialog.dart';

class MainNavigationScreen extends StatefulWidget {
  final int initialIndex;
  const MainNavigationScreen({super.key, this.initialIndex = 0});

  @override
  State<MainNavigationScreen> createState() => _MainNavigationScreenState();
}

class _MainNavigationScreenState extends State<MainNavigationScreen> {
  late int _currentIndex;
  bool _dialogShowing = false;

  final List<Widget> _screens = const [
    DiscoverScreen(),
    ExploreScreen(),
    SessionsScreen(),
    ChatListScreen(),
    ProfileScreen(),
  ];

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      if (auth.user != null) {
        Provider.of<ChatProvider>(context, listen: false).init(auth.user!.uid);
        Provider.of<CallProvider>(context, listen: false).init(auth.user!.uid);
      }
    });
  }

  void _checkIncomingCall(CallProvider callProvider) {
    if (callProvider.hasIncomingCall && !_dialogShowing && mounted) {
      _dialogShowing = true;
      final call = callProvider.incomingCall!;

      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => IncomingCallDialog(
          call: call,
          onAccept: () {
            Navigator.of(ctx).pop();
            _dialogShowing = false;
            callProvider.clearIncomingCall();

            Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => VideoCallScreen(
                  swapSessionId: call.swapSessionId,
                  callId: call.id,
                  otherUserId: call.callerId,
                  otherUserName: call.callerName,
                  otherUserPhoto: call.callerPhoto,
                  isCaller: false,
                ),
              ),
            );
          },
          onDecline: () {
            Navigator.of(ctx).pop();
            _dialogShowing = false;
            callProvider.clearIncomingCall();
          },
        ),
      ).then((_) => _dialogShowing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final chatProvider = Provider.of<ChatProvider>(context);
    final callProvider = Provider.of<CallProvider>(context);

    // Trigger incoming call check
    WidgetsBinding.instance.addPostFrameCallback((_) => _checkIncomingCall(callProvider));

    return Scaffold(
      body: IndexedStack(
        index: _currentIndex,
        children: _screens,
      ),
      bottomNavigationBar: Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          border: Border(top: BorderSide(color: AppColors.border, width: 1)),
        ),
        child: NavigationBarTheme(
          data: NavigationBarThemeData(
            indicatorColor: AppColors.primaryLight,
            labelTextStyle: MaterialStateProperty.resolveWith<TextStyle>(
              (Set<MaterialState> states) {
                if (states.contains(MaterialState.selected)) {
                  return AppTypography.caption.copyWith(
                    color: AppColors.primary,
                    fontWeight: FontWeight.w700,
                  );
                }
                return AppTypography.caption.copyWith(
                  color: AppColors.textMuted,
                  fontWeight: FontWeight.w500,
                );
              },
            ),
          ),
          child: NavigationBar(
            height: 65,
            backgroundColor: Colors.white,
            elevation: 0,
            selectedIndex: _currentIndex,
            onDestinationSelected: (idx) => setState(() => _currentIndex = idx),
            destinations: [
              const NavigationDestination(
                icon: Icon(Icons.home_outlined, color: AppColors.textSecondary),
                selectedIcon: Icon(Icons.home_rounded, color: AppColors.primary),
                label: 'Discover',
              ),
              const NavigationDestination(
                icon: Icon(Icons.explore_outlined, color: AppColors.textSecondary),
                selectedIcon: Icon(Icons.explore_rounded, color: AppColors.primary),
                label: 'Explore',
              ),
              const NavigationDestination(
                icon: Icon(Icons.calendar_today_outlined, color: AppColors.textSecondary),
                selectedIcon: Icon(Icons.calendar_today_rounded, color: AppColors.primary),
                label: 'Sessions',
              ),
              NavigationDestination(
                icon: Badge(
                  isLabelVisible: chatProvider.totalUnreadCount > 0,
                  label: Text('${chatProvider.totalUnreadCount}'),
                  backgroundColor: AppColors.primary,
                  child: const Icon(Icons.chat_bubble_outline_rounded, color: AppColors.textSecondary),
                ),
                selectedIcon: Badge(
                  isLabelVisible: chatProvider.totalUnreadCount > 0,
                  label: Text('${chatProvider.totalUnreadCount}'),
                  backgroundColor: AppColors.primary,
                  child: const Icon(Icons.chat_bubble_rounded, color: AppColors.primary),
                ),
                label: 'Messages',
              ),
              const NavigationDestination(
                icon: Icon(Icons.person_outline_rounded, color: AppColors.textSecondary),
                selectedIcon: Icon(Icons.person_rounded, color: AppColors.primary),
                label: 'Profile',
              ),
            ],
          ),
        ),
      ),
    );
  }
}
