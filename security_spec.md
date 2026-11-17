# Helyume Security Specification (Phase 0)

## 1. Data Invariants
1. A user profile at `users/{userId}` can only be read or created/updated by the verified owner (`request.auth.uid == userId && request.auth.token.email_verified == true`), and `/users` cannot be listed.
2. A conversation at `users/{userId}/conversations/{conversationId}` cannot be created unless the owning user profile exists, `userId == request.auth.uid`, and `id == conversationId`.
3. A message at `users/{userId}/conversations/{conversationId}/messages/{messageId}` cannot be created unless the parent conversation exists and belongs to `request.auth.uid`, and `conversationId` matches the parent path.
4. `createdAt`, `uid`, `userId`, `id`, and `conversationId` are immutable after creation; timestamps must match `request.time`.

## 2. Dirty Dozen Adversarial Payloads (Expected: PERMISSION_DENIED)
1. Unauthenticated read on `/users/uid1`.
2. Unverified email token (`email_verified: false`) writing `/users/uid1`.
3. Listing `/users` collection to scrape user emails.
4. Creating `/users/uid1` with `uid: "other_uid"` (identity spoofing).
5. Creating `/users/uid1` with shadow field `isAdmin: true`.
6. Updating `/users/uid1` to change `createdAt` or `email`.
7. Reading `/users/uid1/conversations/c1` as `uid2`.
8. Creating `/users/uid1/conversations/c1` with client-forged `createdAt` not equal to `request.time`.
9. Creating `/users/uid1/conversations/bad$id` with invalid ID characters.
10. Creating `/users/uid1/conversations/c1` with `model: "unknown-model"`.
11. Creating `/users/uid1/conversations/c1/messages/m1` when parent conversation `c1` does not exist.
12. Updating a message in `/users/uid1/conversations/c1/messages/m1` to mutate `role` or exceed `content` 32000 chars.
