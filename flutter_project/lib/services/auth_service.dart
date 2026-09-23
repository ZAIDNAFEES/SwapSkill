import 'package:firebase_auth/firebase_auth.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'firestore_service.dart';
import '../models/user_profile.dart';

class AuthService {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final GoogleSignIn _googleSignIn = GoogleSignIn();
  final FirestoreService _firestoreService = FirestoreService();

  User? get currentUser => _auth.currentUser;
  Stream<User?> get authStateChanges => _auth.authStateChanges();

  // Sign In with Email & Password
  Future<UserCredential> signInWithEmail(String email, String password) async {
    final cred = await _auth.signInWithEmailAndPassword(
      email: email.trim(),
      password: password,
    );
    return cred;
  }

  // Register with Email & Password and create initial profile
  Future<UserCredential> registerWithEmail({
    required String email,
    required String password,
    required String fullName,
    required String username,
  }) async {
    final cred = await _auth.createUserWithEmailAndPassword(
      email: email.trim(),
      password: password,
    );

    final user = cred.user;
    if (user != null) {
      await user.updateDisplayName(fullName);
      
      final profile = UserProfile(
        uid: user.uid,
        email: email.trim(),
        fullName: fullName.trim(),
        username: username.trim().toLowerCase().replaceAll(' ', ''),
        photoUrl: user.photoURL ?? '',
        createdAt: DateTime.now(),
      );

      await _firestoreService.saveUserProfile(profile);
    }

    return cred;
  }

  // Sign In with Google
  Future<UserCredential?> signInWithGoogle() async {
    try {
      final GoogleSignInAccount? googleUser = await _googleSignIn.signIn();
      if (googleUser == null) return null; // User cancelled

      final GoogleSignInAuthentication googleAuth = await googleUser.authentication;
      final OAuthCredential credential = GoogleAuthProvider.credential(
        accessToken: googleAuth.accessToken,
        idToken: googleAuth.idToken,
      );

      final UserCredential userCred = await _auth.signInWithCredential(credential);
      final user = userCred.user;

      if (user != null) {
        // Check if profile exists, if not create default
        final existing = await _firestoreService.getUserProfile(user.uid);
        if (existing == null) {
          final profile = UserProfile(
            uid: user.uid,
            email: user.email ?? '',
            fullName: user.displayName ?? 'Swap Partner',
            username: (user.displayName ?? 'user_${user.uid.substring(0, 5)}')
                .toLowerCase()
                .replaceAll(' ', '_'),
            photoUrl: user.photoURL ?? '',
            createdAt: DateTime.now(),
          );
          await _firestoreService.saveUserProfile(profile);
        }
      }

      return userCred;
    } catch (e) {
      rethrow;
    }
  }

  // Send Password Reset
  Future<void> sendPasswordReset(String email) async {
    await _auth.sendPasswordResetEmail(email: email.trim());
  }

  // Sign Out
  Future<void> signOut() async {
    await _googleSignIn.signOut();
    await _auth.signOut();
  }
}
