import 'dart:io';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:uuid/uuid.dart';

class StorageService {
  final FirebaseStorage _storage = FirebaseStorage.instance;
  final Uuid _uuid = const Uuid();

  // Upload Profile Image
  Future<String> uploadProfileImage(File file, String userId) async {
    final ref = _storage.ref().child('profiles').child('$userId.jpg');
    final uploadTask = await ref.putFile(file);
    return await uploadTask.ref.getDownloadURL();
  }

  // Upload Cover Image
  Future<String> uploadCoverImage(File file, String userId) async {
    final ref = _storage.ref().child('covers').child('$userId.jpg');
    final uploadTask = await ref.putFile(file);
    return await uploadTask.ref.getDownloadURL();
  }

  // Upload Chat Attachment (Image/Audio/File)
  Future<String> uploadChatAttachment(File file, String chatId, String extension) async {
    final fileId = _uuid.v4();
    final ref = _storage.ref().child('chats').child(chatId).child('$fileId.$extension');
    final uploadTask = await ref.putFile(file);
    return await uploadTask.ref.getDownloadURL();
  }
}
