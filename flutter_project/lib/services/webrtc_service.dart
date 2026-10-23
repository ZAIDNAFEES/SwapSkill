import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:permission_handler/permission_handler.dart';
import '../models/webrtc_call.dart';
import '../constants/app_constants.dart';

class WebRTCService extends ChangeNotifier {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  RTCVideoRenderer localRenderer = RTCVideoRenderer();
  RTCVideoRenderer remoteRenderer = RTCVideoRenderer();

  RTCPeerConnection? _peerConnection;
  MediaStream? _localStream;

  CallStatus _callStatus = CallStatus.idle;
  CallStatus get callStatus => _callStatus;

  String? _activeCallId;
  String? get activeCallId => _activeCallId;

  bool _isMuted = false;
  bool get isMuted => _isMuted;

  bool _isCameraOff = false;
  bool get isCameraOff => _isCameraOff;

  bool _isSpeakerOn = true;
  bool get isSpeakerOn => _isSpeakerOn;

  int _callDuration = 0;
  int get callDuration => _callDuration;
  Timer? _durationTimer;

  StreamSubscription? _callSubscription;
  StreamSubscription? _candidatesSubscription;
  final List<RTCIceCandidate> _queuedRemoteCandidates = [];
  bool _hasRemoteDescription = false;

  bool _isInitialized = false;
  bool get isInitialized => _isInitialized;

  // Initialize Renderers
  Future<void> initRenderers() async {
    if (!_isInitialized) {
      await localRenderer.initialize();
      await remoteRenderer.initialize();
      _isInitialized = true;
    }
  }

  // Request Hardware Permissions
  Future<bool> requestMediaPermissions() async {
    final cameraStatus = await Permission.camera.request();
    final micStatus = await Permission.microphone.request();
    return cameraStatus.isGranted && micStatus.isGranted;
  }

  // Start Outgoing Call (Caller Flow)
  Future<void> startCall({
    required String swapSessionId,
    required String callerId,
    required String calleeId,
    required String callerName,
    String? callerPhoto,
    required String calleeName,
    String? calleePhoto,
  }) async {
    await initRenderers();
    final hasPermissions = await requestMediaPermissions();
    if (!hasPermissions) {
      _setCallStatus(CallStatus.failed);
      return;
    }

    _setCallStatus(CallStatus.requestingMedia);

    try {
      _activeCallId = 'call_$swapSessionId';
      _queuedRemoteCandidates.clear();
      _hasRemoteDescription = false;

      // 1. Get User Media
      final mediaConstraints = {
        'audio': true,
        'video': {
          'facingMode': 'user',
          'mandatory': {
            'minWidth': '640',
            'minHeight': '480',
            'minFrameRate': '30',
          },
        }
      };

      _localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      localRenderer.srcObject = _localStream;

      // 2. Create Peer Connection
      final configuration = {
        'iceServers': AppConstants.iceServers,
        'sdpSemantics': 'unified-plan',
      };

      _peerConnection = await createPeerConnection(configuration);

      // Add local tracks to peer connection
      _localStream!.getTracks().forEach((track) {
        _peerConnection!.addTrack(track, _localStream!);
      });

      // Handle Remote Stream Arrival
      _peerConnection!.onTrack = (RTCTrackEvent event) {
        if (event.streams.isNotEmpty) {
          remoteRenderer.srcObject = event.streams[0];
          _setCallStatus(CallStatus.connected);
          _startDurationTimer();
        }
      };

      // Handle ICE Candidates
      final myCandidatesCol = _db.collection('calls').doc(_activeCallId).collection('callerCandidates');
      _peerConnection!.onIceCandidate = (RTCIceCandidate candidate) {
        if (candidate.candidate != null) {
          myCandidatesCol.add({
            'candidate': candidate.toMap(),
            'senderId': callerId,
            'timestamp': DateTime.now().millisecondsSinceEpoch,
          });
        }
      };

      // 3. Create Offer & Write to Firestore
      final offer = await _peerConnection!.createOffer({
        'offerToReceiveAudio': 1,
        'offerToReceiveVideo': 1,
      });
      await _peerConnection!.setLocalDescription(offer);

      final callDocData = WebRTCCallDoc(
        id: _activeCallId!,
        swapSessionId: swapSessionId,
        callerId: callerId,
        calleeId: calleeId,
        callerName: callerName,
        callerPhoto: callerPhoto,
        calleeName: calleeName,
        calleePhoto: calleePhoto,
        status: CallStatus.calling,
        offer: {'type': offer.type, 'sdp': offer.sdp},
        createdAt: DateTime.now(),
        updatedAt: DateTime.now(),
      );

      await _db.collection('calls').doc(_activeCallId).set(callDocData.toMap());
      _setCallStatus(CallStatus.calling);

      // 4. Listen for Remote Callee Candidates
      final remoteCandidatesCol = _db.collection('calls').doc(_activeCallId).collection('calleeCandidates');
      _candidatesSubscription = remoteCandidatesCol.snapshots().listen((snapshot) async {
        for (final change in snapshot.docChanges) {
          if (change.type == DocumentChangeType.added) {
            final data = change.doc.data() as Map<String, dynamic>?;
            if (data != null && data['candidate'] != null && data['senderId'] != callerId) {
              final candMap = Map<String, dynamic>.from(data['candidate']);
              final candidate = RTCIceCandidate(
                candMap['candidate'],
                candMap['sdpMid'],
                candMap['sdpMLineIndex'],
              );

              if (_hasRemoteDescription && _peerConnection != null) {
                await _peerConnection!.addCandidate(candidate);
              } else {
                _queuedRemoteCandidates.add(candidate);
              }
            }
          }
        }
      });

      // 5. Listen for Answer in call document
      _callSubscription = _db.collection('calls').doc(_activeCallId).snapshots().listen((snapshot) async {
        if (!snapshot.exists) return;
        final data = snapshot.data();
        if (data == null) return;

        final statusStr = data['status']?.toString();
        if (statusStr == 'rejected') {
          _setCallStatus(CallStatus.rejected);
          endCall();
        } else if (statusStr == 'ended') {
          _setCallStatus(CallStatus.ended);
          endCall();
        } else if (data['answer'] != null && !_hasRemoteDescription) {
          final answer = data['answer'] as Map<String, dynamic>;
          final sdp = RTCSessionDescription(answer['sdp'], answer['type']);
          await _peerConnection!.setRemoteDescription(sdp);
          _hasRemoteDescription = true;

          // Drain queued candidates
          for (final cand in _queuedRemoteCandidates) {
            await _peerConnection!.addCandidate(cand);
          }
          _queuedRemoteCandidates.clear();
        }
      });
    } catch (e) {
      if (kDebugMode) print('WebRTC startCall Error: $e');
      _setCallStatus(CallStatus.failed);
    }
  }

  // Answer Incoming Call (Callee Flow)
  Future<void> answerCall({
    required String callId,
    required String currentUserId,
  }) async {
    await initRenderers();
    final hasPermissions = await requestMediaPermissions();
    if (!hasPermissions) {
      _setCallStatus(CallStatus.failed);
      return;
    }

    _setCallStatus(CallStatus.connecting);

    try {
      _activeCallId = callId;
      _queuedRemoteCandidates.clear();
      _hasRemoteDescription = false;

      // 1. Get Call Doc from Firestore
      final callDocSnap = await _db.collection('calls').doc(callId).get();
      if (!callDocSnap.exists || callDocSnap.data() == null) {
        _setCallStatus(CallStatus.failed);
        return;
      }

      final callData = callDocSnap.data()!;
      final offerMap = callData['offer'] as Map<String, dynamic>;

      // 2. Get User Media
      final mediaConstraints = {
        'audio': true,
        'video': {
          'facingMode': 'user',
          'mandatory': {
            'minWidth': '640',
            'minHeight': '480',
            'minFrameRate': '30',
          },
        }
      };

      _localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      localRenderer.srcObject = _localStream;

      // 3. Create Peer Connection
      final configuration = {
        'iceServers': AppConstants.iceServers,
        'sdpSemantics': 'unified-plan',
      };

      _peerConnection = await createPeerConnection(configuration);

      _localStream!.getTracks().forEach((track) {
        _peerConnection!.addTrack(track, _localStream!);
      });

      _peerConnection!.onTrack = (RTCTrackEvent event) {
        if (event.streams.isNotEmpty) {
          remoteRenderer.srcObject = event.streams[0];
          _setCallStatus(CallStatus.connected);
          _startDurationTimer();
        }
      };

      // Handle ICE Candidates for Callee
      final myCandidatesCol = _db.collection('calls').doc(_activeCallId).collection('calleeCandidates');
      _peerConnection!.onIceCandidate = (RTCIceCandidate candidate) {
        if (candidate.candidate != null) {
          myCandidatesCol.add({
            'candidate': candidate.toMap(),
            'senderId': currentUserId,
            'timestamp': DateTime.now().millisecondsSinceEpoch,
          });
        }
      };

      // 4. Set Remote Description from Offer
      final offerDesc = RTCSessionDescription(offerMap['sdp'], offerMap['type']);
      await _peerConnection!.setRemoteDescription(offerDesc);
      _hasRemoteDescription = true;

      // 5. Create Answer & Set Local Description
      final answer = await _peerConnection!.createAnswer({
        'offerToReceiveAudio': 1,
        'offerToReceiveVideo': 1,
      });
      await _peerConnection!.setLocalDescription(answer);

      // Write Answer to Firestore
      await _db.collection('calls').doc(callId).update({
        'status': 'connected',
        'answer': {'type': answer.type, 'sdp': answer.sdp},
        'updatedAt': FieldValue.serverTimestamp(),
      });

      // 6. Listen for Caller Candidates
      final remoteCandidatesCol = _db.collection('calls').doc(callId).collection('callerCandidates');
      _candidatesSubscription = remoteCandidatesCol.snapshots().listen((snapshot) async {
        for (final change in snapshot.docChanges) {
          if (change.type == DocumentChangeType.added) {
            final data = change.doc.data() as Map<String, dynamic>?;
            if (data != null && data['candidate'] != null && data['senderId'] != currentUserId) {
              final candMap = Map<String, dynamic>.from(data['candidate']);
              final candidate = RTCIceCandidate(
                candMap['candidate'],
                candMap['sdpMid'],
                candMap['sdpMLineIndex'],
              );

              if (_hasRemoteDescription && _peerConnection != null) {
                await _peerConnection!.addCandidate(candidate);
              }
            }
          }
        }
      });

      // 7. Listen for Call Status updates
      _callSubscription = _db.collection('calls').doc(callId).snapshots().listen((snapshot) {
        if (!snapshot.exists) return;
        final data = snapshot.data();
        if (data == null) return;
        if (data['status'] == 'ended') {
          _setCallStatus(CallStatus.ended);
          endCall();
        }
      });
    } catch (e) {
      if (kDebugMode) print('WebRTC answerCall Error: $e');
      _setCallStatus(CallStatus.failed);
    }
  }

  // Reject Incoming Call
  Future<void> rejectCall(String callId) async {
    await _db.collection('calls').doc(callId).update({
      'status': 'rejected',
      'endedAt': FieldValue.serverTimestamp(),
    });
    _setCallStatus(CallStatus.rejected);
    endCall();
  }

  // Toggle Microphone
  void toggleMute() {
    if (_localStream != null) {
      final audioTracks = _localStream!.getAudioTracks();
      if (audioTracks.isNotEmpty) {
        final currentEnabled = audioTracks[0].enabled;
        audioTracks[0].enabled = !currentEnabled;
        _isMuted = !audioTracks[0].enabled;
        notifyListeners();
      }
    }
  }

  // Toggle Camera
  void toggleCamera() {
    if (_localStream != null) {
      final videoTracks = _localStream!.getVideoTracks();
      if (videoTracks.isNotEmpty) {
        final currentEnabled = videoTracks[0].enabled;
        videoTracks[0].enabled = !currentEnabled;
        _isCameraOff = !videoTracks[0].enabled;
        notifyListeners();
      }
    }
  }

  // Switch Front/Back Camera
  Future<void> switchCamera() async {
    if (_localStream != null) {
      final videoTracks = _localStream!.getVideoTracks();
      if (videoTracks.isNotEmpty) {
        await Helper.switchCamera(videoTracks[0]);
        notifyListeners();
      }
    }
  }

  // Toggle Speakerphone
  void toggleSpeaker() {
    _isSpeakerOn = !_isSpeakerOn;
    if (_localStream != null) {
      _localStream!.getAudioTracks().forEach((track) {
        track.enableSpeakerphone(_isSpeakerOn);
      });
    }
    notifyListeners();
  }

  // End Call & Cleanup Everything
  Future<void> endCall() async {
    _durationTimer?.cancel();
    _durationTimer = null;
    _callDuration = 0;

    _callSubscription?.cancel();
    _candidatesSubscription?.cancel();

    if (_activeCallId != null) {
      try {
        await _db.collection('calls').doc(_activeCallId).update({
          'status': 'ended',
          'endedAt': FieldValue.serverTimestamp(),
        });
      } catch (_) {}
    }

    try {
      _localStream?.getTracks().forEach((track) => track.stop());
      await _localStream?.dispose();
      _localStream = null;

      await _peerConnection?.close();
      _peerConnection = null;

      localRenderer.srcObject = null;
      remoteRenderer.srcObject = null;
    } catch (_) {}

    _activeCallId = null;
    _setCallStatus(CallStatus.idle);
  }

  void _startDurationTimer() {
    _durationTimer?.cancel();
    _callDuration = 0;
    _durationTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      _callDuration++;
      notifyListeners();
    });
  }

  void _setCallStatus(CallStatus status) {
    _callStatus = status;
    notifyListeners();
  }

  @override
  void dispose() {
    endCall();
    localRenderer.dispose();
    remoteRenderer.dispose();
    super.dispose();
  }
}
