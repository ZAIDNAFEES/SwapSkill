import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../models/webrtc_call.dart';
import '../../services/webrtc_service.dart';
import '../../constants/app_colors.dart';
import '../../constants/app_typography.dart';
import '../../widgets/user_avatar.dart';

class VideoCallScreen extends StatefulWidget {
  final String swapSessionId;
  final String callId;
  final String otherUserId;
  final String otherUserName;
  final String? otherUserPhoto;
  final bool isCaller;

  const VideoCallScreen({
    super.key,
    required this.swapSessionId,
    required this.callId,
    required this.otherUserId,
    required this.otherUserName,
    this.otherUserPhoto,
    required this.isCaller,
  });

  @override
  State<VideoCallScreen> createState() => _VideoCallScreenState();
}

class _VideoCallScreenState extends State<VideoCallScreen> {
  late WebRTCService _webrtcService;

  @override
  void initState() {
    super.initState();
    _webrtcService = WebRTCService();
    _initCall();
  }

  Future<void> _initCall() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final user = auth.currentUserProfile;
    if (user == null) return;

    if (widget.isCaller) {
      await _webrtcService.startCall(
        swapSessionId: widget.swapSessionId,
        callerId: user.uid,
        calleeId: widget.otherUserId,
        callerName: user.fullName,
        callerPhoto: user.effectivePhotoUrl,
        calleeName: widget.otherUserName,
        calleePhoto: widget.otherUserPhoto,
      );
    } else {
      await _webrtcService.answerCall(
        callId: widget.callId,
        currentUserId: user.uid,
      );
    }
  }

  String _formatDuration(int seconds) {
    final mins = (seconds ~/ 60).toString().padLeft(2, '0');
    final secs = (seconds % 60).toString().padLeft(2, '0');
    return '$mins:$secs';
  }

  void _handleHangUp() async {
    await _webrtcService.endCall();
    if (mounted) Navigator.of(context).pop();
  }

  @override
  void dispose() {
    _webrtcService.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<WebRTCService>.value(
      value: _webrtcService,
      child: Consumer<WebRTCService>(
        builder: (context, service, _) {
          final isConnected = service.callStatus == CallStatus.connected;

          // Auto-pop if call ended or rejected
          if (service.callStatus == CallStatus.ended || service.callStatus == CallStatus.rejected) {
            WidgetsBinding.instance.addPostFrameCallback((_) {
              if (mounted) Navigator.of(context).pop();
            });
          }

          return Scaffold(
            backgroundColor: const Color(0xFF0F172A),
            body: SafeArea(
              child: Stack(
                children: [
                  // Full Screen Remote Stream or Calling Avatar
                  Positioned.fill(
                    child: isConnected && !service.isCameraOff
                        ? RTCVideoView(
                            service.remoteRenderer,
                            objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
                          )
                        : Container(
                            color: const Color(0xFF0F172A),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                UserAvatar(
                                  name: widget.otherUserName,
                                  imageUrl: widget.otherUserPhoto,
                                  radius: 56,
                                ),
                                const SizedBox(height: 18),
                                Text(
                                  widget.otherUserName,
                                  style: AppTypography.h1.copyWith(color: Colors.white),
                                ),
                                const SizedBox(height: 8),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                                  decoration: BoxDecoration(
                                    color: Colors.white.withOpacity(0.1),
                                    borderRadius: BorderRadius.circular(20),
                                  ),
                                  child: Text(
                                    service.callStatus == CallStatus.calling
                                        ? 'Calling...'
                                        : service.callStatus == CallStatus.connecting
                                            ? 'Connecting WebRTC...'
                                            : service.callStatus == CallStatus.requestingMedia
                                                ? 'Accessing Camera...'
                                                : 'Live Skill Exchange',
                                    style: AppTypography.bodySmall.copyWith(color: Colors.white70),
                                  ),
                                ),
                              ],
                            ),
                          ),
                  ),

                  // Floating PIP Local Camera View
                  if (service.isInitialized && !service.isCameraOff)
                    Positioned(
                      top: 16,
                      right: 16,
                      child: Container(
                        width: 110,
                        height: 160,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(16),
                          border: Border.all(color: Colors.white.withOpacity(0.6), width: 2),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withOpacity(0.3),
                              blurRadius: 10,
                              offset: const Offset(0, 4),
                            ),
                          ],
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(14),
                          child: RTCVideoView(
                            service.localRenderer,
                            mirror: true,
                            objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
                          ),
                        ),
                      ),
                    ),

                  // Top Header: Back & Timer
                  Positioned(
                    top: 16,
                    left: 16,
                    child: Row(
                      children: [
                        IconButton(
                          icon: Container(
                            padding: const EdgeInsets.all(6),
                            decoration: BoxDecoration(
                              color: Colors.black.withOpacity(0.5),
                              shape: BoxShape.circle,
                            ),
                            child: const Icon(Icons.arrow_back_ios_new_rounded, color: Colors.white, size: 18),
                          ),
                          onPressed: _handleHangUp,
                        ),
                        const SizedBox(width: 8),
                        if (isConnected)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                            decoration: BoxDecoration(
                              color: Colors.black.withOpacity(0.5),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Row(
                              children: [
                                Container(
                                  width: 8,
                                  height: 8,
                                  decoration: const BoxDecoration(
                                    color: AppColors.danger,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                                const SizedBox(width: 6),
                                Text(
                                  _formatDuration(service.callDuration),
                                  style: AppTypography.caption.copyWith(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),

                  // Bottom Controls Dock
                  Positioned(
                    bottom: 24,
                    left: 20,
                    right: 20,
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 16),
                      decoration: BoxDecoration(
                        color: const Color(0xFF1E293B).withOpacity(0.92),
                        borderRadius: BorderRadius.circular(28),
                        border: Border.all(color: Colors.white.withOpacity(0.1)),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.4),
                            blurRadius: 20,
                            offset: const Offset(0, 10),
                          ),
                        ],
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: [
                          // Mute Audio Toggle
                          IconButton(
                            onPressed: service.toggleMute,
                            icon: Icon(
                              service.isMuted ? Icons.mic_off_rounded : Icons.mic_rounded,
                              color: service.isMuted ? AppColors.danger : Colors.white,
                              size: 26,
                            ),
                          ),

                          // Toggle Camera
                          IconButton(
                            onPressed: service.toggleCamera,
                            icon: Icon(
                              service.isCameraOff ? Icons.videocam_off_rounded : Icons.videocam_rounded,
                              color: service.isCameraOff ? AppColors.danger : Colors.white,
                              size: 26,
                            ),
                          ),

                          // Switch Front/Back Camera
                          IconButton(
                            onPressed: service.switchCamera,
                            icon: const Icon(Icons.cameraswitch_rounded, color: Colors.white, size: 26),
                          ),

                          // Speaker Toggle
                          IconButton(
                            onPressed: service.toggleSpeaker,
                            icon: Icon(
                              service.isSpeakerOn ? Icons.volume_up_rounded : Icons.volume_off_rounded,
                              color: service.isSpeakerOn ? AppColors.primary : Colors.white,
                              size: 26,
                            ),
                          ),

                          // Hang Up Button
                          InkWell(
                            onTap: _handleHangUp,
                            borderRadius: BorderRadius.circular(24),
                            child: Container(
                              width: 48,
                              height: 48,
                              decoration: const BoxDecoration(
                                color: AppColors.danger,
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(Icons.call_end_rounded, color: Colors.white, size: 24),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
