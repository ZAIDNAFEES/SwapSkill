import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../models/user_profile.dart';
import '../services/auth_service.dart';
import '../services/firestore_service.dart';

class AuthProvider extends ChangeNotifier {
  final AuthService _authService = AuthService();
  final FirestoreService _firestoreService = FirestoreService();

  User? _user;
  User? get user => _user;
  bool get isAuthenticated => _user != null;

  UserProfile? _currentUserProfile;
  UserProfile? get currentUserProfile => _currentUserProfile;

  bool _isLoading = true;
  bool get isLoading => _isLoading;

  StreamSubscription<User?>? _authSubscription;
  StreamSubscription<UserProfile?>? _profileSubscription;

  AuthProvider() {
    _initAuthListener();
  }

  void _initAuthListener() {
    _authSubscription = _authService.authStateChanges.listen((User? user) {
      _user = user;
      if (user != null) {
        _subscribeToProfile(user.uid);
      } else {
        _currentUserProfile = null;
        _profileSubscription?.cancel();
        _isLoading = false;
        notifyListeners();
      }
    });
  }

  void _subscribeToProfile(String uid) {
    _profileSubscription?.cancel();
    _profileSubscription = _firestoreService.streamUserProfile(uid).listen((profile) {
      _currentUserProfile = profile;
      _isLoading = false;
      notifyListeners();
    });
  }

  Future<void> signInWithEmail(String email, String password) async {
    _isLoading = true;
    notifyListeners();
    try {
      await _authService.signInWithEmail(email, password);
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> registerWithEmail({
    required String email,
    required String password,
    required String fullName,
    required String username,
  }) async {
    _isLoading = true;
    notifyListeners();
    try {
      await _authService.registerWithEmail(
        email: email,
        password: password,
        fullName: fullName,
        username: username,
      );
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> signInWithGoogle() async {
    _isLoading = true;
    notifyListeners();
    try {
      await _authService.signInWithGoogle();
    } finally {
      _isLoading = false;
      notifyListeners();
    }
  }

  Future<void> updateProfile(UserProfile updatedProfile) async {
    await _firestoreService.saveUserProfile(updatedProfile);
    _currentUserProfile = updatedProfile;
    notifyListeners();
  }

  Future<void> signOut() async {
    await _authService.signOut();
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    _profileSubscription?.cancel();
    super.dispose();
  }
}
