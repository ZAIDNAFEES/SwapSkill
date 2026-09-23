import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../models/webrtc_call.dart';

class CallProvider extends ChangeNotifier {
  final FirebaseFirestore _db = FirebaseFirestore.instance;

  WebRTCCallDoc? _incomingCall;
  WebRTCCallDoc? get incomingCall => _incomingCall;
  bool get hasIncomingCall => _incomingCall != null;

  String? _currentUserId;
  StreamSubscription? _incomingCallSubscription;

  void init(String currentUserId) {
    if (_currentUserId == currentUserId && _incomingCallSubscription != null) return;
    _currentUserId = currentUserId;

    _incomingCallSubscription?.cancel();
    _incomingCallSubscription = _db
        .collection('calls')
        .where('calleeId', isEqualTo: currentUserId)
        .where('status', isEqualTo: 'calling')
        .snapshots()
        .listen((snapshot) {
      if (snapshot.docs.isNotEmpty) {
        final doc = snapshot.docs.first;
        _incomingCall = WebRTCCallDoc.fromFirestore(doc);
      } else {
        _incomingCall = null;
      }
      notifyListeners();
    });
  }

  void clearIncomingCall() {
    _incomingCall = null;
    notifyListeners();
  }

  @override
  void dispose() {
    _incomingCallSubscription?.cancel();
    super.dispose();
  }
}
