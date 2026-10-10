# Security Specification: Realtime Messaging System

## 1. Data Invariants
- **Conversation Integrity:** A conversation can only exist if its document ID contains a sorted, valid join pattern of exactly two active platform user IDs (e.g. `userId1_userId2`), and its `participantIds` list contains both members.
- **Message Confidentiality:** Messages inside `conversations/{conversationId}/messages` are strictly peer-to-peer. They can only be read or written by authenticated users who are verified participants of that specific conversation.
- **Presence Validation:** A user can only modify their own `userPresence/{userId}` document. Spoofing another user's online or offline state is mathematically impossible.
- **Typing Integrity:** Users can only declare their own typing status under `typingStatus/{conversationId}`.

## 2. The "Dirty Dozen" Threat Payloads (Verification Cases)
1. **Malicious Join Request:** Attacker attempts to create a conversation document where they are NOT in the `participantIds` list.
2. **Conversation Update Impersonation:** Attacker tries to modify `unreadCount` of another user to keep them from receiving updates.
3. **Foreign Message Injection:** Authenticated User A tries to insert a message into a conversation between User B and User C.
4. **Message Modification Spoofing:** Attacker attempts to update a message sent by someone else to change its text contents.
5. **Seen Receipt Tampering:** User B attempts to change the body text of User A's message under the guise of sending a "seen" read receipt.
6. **Presence Hijacking:** Attacker attempts to write or update a document in `userPresence/someOtherUserId` to mark them as online/offline.
7. **Typing Status Spoofing:** Attacker attempts to mark another member as typing inside a conversation.
8. **Malicious Notification Injector:** Attacker tries to inject notification objects directly into another user's profile with unvalidated, malicious payload fields.
9. **Relational Sync Orphan:** Attacker tries to write a message under a non-existent conversation or bypassing the `conversations` parent existence check.
10. **Denial of Wallet Payload:** Attacker attempts to send a message containing a 2MB string.
11. **Immortality Field Bypass:** Attacker attempts to modify the `createdAt` or `senderId` of an existing message.
12. **Unverified Account Access:** User with `email_verified == false` attempts to write messages to verified provider channels.
