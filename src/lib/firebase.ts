import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { resolveHelyumeModel, type HelyumeModelId } from './models';
import type { ChatMessage, Conversation } from './storage';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) ?? [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

if (typeof window !== 'undefined') {
  void testConnection();
}

export function sanitizeDocId(rawId: string): string {
  const cleaned = rawId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  return cleaned || `id_${Date.now()}`;
}

export async function signInWithGoogleAccount(): Promise<User> {
  const credential = await signInWithPopup(auth, googleProvider);
  await ensureUserProfile(credential.user);
  return credential.user;
}

export async function signOutAccount(): Promise<void> {
  await signOut(auth);
}

export function subscribeAuthState(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

export async function ensureUserProfile(user: User): Promise<void> {
  const userId = sanitizeDocId(user.uid);
  const path = `users/${userId}`;
  const ref = doc(db, 'users', userId);
  const displayName = (user.displayName?.trim() || user.email?.split('@')[0] || 'Helyume Üyesi').slice(
    0,
    100
  );
  const email = (user.email?.trim() || 'user@helyume.app').slice(0, 200);
  const photoURL = user.photoURL ? user.photoURL.slice(0, 600) : undefined;

  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: userId,
        displayName,
        email,
        ...(photoURL ? { photoURL } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        displayName,
        ...(photoURL ? { photoURL } : {}),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeUserConversations(
  userId: string,
  onData: (conversations: Conversation[]) => void,
  onError?: (err: unknown) => void
): () => void {
  const safeUid = sanitizeDocId(userId);
  const path = `users/${safeUid}/conversations`;
  const q = query(collection(db, path), orderBy('updatedAt', 'desc'), limit(40));

  return onSnapshot(
    q,
    (snapshot) => {
      const list: Conversation[] = snapshot.docs.map((d) => {
        const data = d.data() as {
          id?: string;
          title?: string;
          model?: HelyumeModelId;
          updatedAt?: { toMillis?: () => number };
        };
        return {
          id: data.id || d.id,
          title: data.title || 'Yeni Sohbet',
          model: resolveHelyumeModel(data.model).id,
          updatedAt: data.updatedAt?.toMillis?.() ?? Date.now(),
          messages: [],
        };
      });
      onData(list);
    },
    (error) => {
      if (onError) onError(error);
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch {
        // Error surfaced cleanly to console via handleFirestoreError
      }
    }
  );
}

export async function fetchConversationMessages(
  userId: string,
  conversationId: string
): Promise<ChatMessage[]> {
  const safeUid = sanitizeDocId(userId);
  const safeConvId = sanitizeDocId(conversationId);
  const path = `users/${safeUid}/conversations/${safeConvId}/messages`;

  try {
    const q = query(collection(db, path), orderBy('createdAt', 'asc'), limit(200));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data() as {
        id?: string;
        role?: 'user' | 'assistant';
        content?: string;
        model?: HelyumeModelId;
        engine?: string;
        durationMs?: number;
      };
      return {
        id: data.id || d.id,
        role: data.role === 'assistant' ? 'assistant' : 'user',
        content: data.content || '',
        model: resolveHelyumeModel(data.model).id,
        phase: 'done',
        engine: data.engine === 'api' ? 'api' : 'none',
        durationMs: typeof data.durationMs === 'number' ? data.durationMs : undefined,
      };
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function persistConversationMessages(params: {
  userId: string;
  conversationId: string;
  title: string;
  model: HelyumeModelId;
  isNewConversation: boolean;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}): Promise<void> {
  const {
    userId,
    conversationId,
    title,
    model,
    isNewConversation,
    userMessage,
    assistantMessage,
  } = params;

  const safeUid = sanitizeDocId(userId);
  const safeConvId = sanitizeDocId(conversationId);
  const safeUserMsgId = sanitizeDocId(userMessage.id);
  const safeAsstMsgId = sanitizeDocId(assistantMessage.id);
  const convPath = `users/${safeUid}/conversations/${safeConvId}`;

  try {
    if (auth.currentUser) {
      await ensureUserProfile(auth.currentUser);
    }
    const convRef = doc(db, 'users', safeUid, 'conversations', safeConvId);

    if (isNewConversation) {
      await setDoc(convRef, {
        id: safeConvId,
        userId: safeUid,
        title: title.slice(0, 120) || 'Yeni Sohbet',
        model: resolveHelyumeModel(model).id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(convRef, {
        model: resolveHelyumeModel(model).id,
        updatedAt: serverTimestamp(),
      });
    }

    const batch = writeBatch(db);
    const userMsgRef = doc(db, 'users', safeUid, 'conversations', safeConvId, 'messages', safeUserMsgId);
    batch.set(userMsgRef, {
      id: safeUserMsgId,
      userId: safeUid,
      conversationId: safeConvId,
      role: 'user',
      content: userMessage.content.slice(0, 32000),
      model: resolveHelyumeModel(model).id,
      createdAt: serverTimestamp(),
    });

    if (assistantMessage.content.trim().length > 0) {
      const asstRef = doc(
        db,
        'users',
        safeUid,
        'conversations',
        safeConvId,
        'messages',
        safeAsstMsgId
      );
      batch.set(asstRef, {
        id: safeAsstMsgId,
        userId: safeUid,
        conversationId: safeConvId,
        role: 'assistant',
        content: assistantMessage.content.slice(0, 32000),
        model: resolveHelyumeModel(model).id,
        engine: assistantMessage.engine ?? 'none',
        ...(typeof assistantMessage.durationMs === 'number'
          ? { durationMs: Math.max(0, Math.min(600000, assistantMessage.durationMs)) }
          : {}),
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, convPath);
  }
}

export async function updateCloudConversationModel(
  userId: string,
  conversationId: string,
  model: HelyumeModelId
): Promise<void> {
  const safeUid = sanitizeDocId(userId);
  const safeConvId = sanitizeDocId(conversationId);
  const path = `users/${safeUid}/conversations/${safeConvId}`;
  try {
    await updateDoc(doc(db, 'users', safeUid, 'conversations', safeConvId), {
      model: resolveHelyumeModel(model).id,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteCloudConversation(
  userId: string,
  conversationId: string
): Promise<void> {
  const safeUid = sanitizeDocId(userId);
  const safeConvId = sanitizeDocId(conversationId);
  const path = `users/${safeUid}/conversations/${safeConvId}`;
  try {
    const msgsSnap = await getDocs(
      collection(db, 'users', safeUid, 'conversations', safeConvId, 'messages')
    );
    const batch = writeBatch(db);
    for (const msgDoc of msgsSnap.docs) {
      batch.delete(msgDoc.ref);
    }
    batch.delete(doc(db, 'users', safeUid, 'conversations', safeConvId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
