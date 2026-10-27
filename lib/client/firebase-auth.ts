import { deleteApp, getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  getAuth,
  inMemoryPersistence,
  linkWithPopup,
  onIdTokenChanged,
  setPersistence,
  signInWithCredential,
  signInWithPopup,
  updateCurrentUser,
  signInAnonymously,
  signOut,
  type OAuthCredential,
  type User,
} from "firebase/auth";
import config from "@/web/firebase-config.json";

export const firebaseEnabled =
  (import.meta as ImportMeta & { env?: { VITE_FIREBASE?: string } }).env
    ?.VITE_FIREBASE === "true";

let initialization: Promise<ReturnType<typeof getAuth>> | undefined;

async function privateAuth() {
  if (!initialization) {
    initialization = (async () => {
      const app = getApps().length ? getApp() : initializeApp(config);
      const auth = getAuth(app);
      await setPersistence(auth, browserLocalPersistence);
      await auth.authStateReady();
      if (!auth.currentUser) await signInAnonymously(auth);
      return auth;
    })().catch((error) => {
      initialization = undefined;
      throw error;
    });
  }
  return initialization;
}

/** Native Sites authentication remains in place when the Firebase build is off. */
export async function workspaceFetch(path: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  if (!firebaseEnabled) return fetch(path, { ...options, headers });
  const auth = await privateAuth();
  if (!auth.currentUser)
    throw new Error(
      "Your private workspace could not be opened. Please retry.",
    );
  headers.set("Authorization", `Bearer ${await auth.currentUser.getIdToken()}`);
  const response = await fetch(path, { ...options, headers });
  if (response.status !== 401) return response;
  headers.set(
    "Authorization",
    `Bearer ${await auth.currentUser.getIdToken(true)}`,
  );
  return fetch(path, { ...options, headers });
}

/** Sign out and open a fresh guest identity. This does not erase the previous workspace. */
export async function newPrivateWorkspace() {
  if (!firebaseEnabled) return;
  const auth = await privateAuth();
  await signOut(auth);
  await signInAnonymously(auth);
}

export interface WorkspaceIdentity {
  uid: string;
  name: string;
  email: string | null;
  photoURL: string | null;
  isAnonymous: boolean;
}

const identity = (user: User): WorkspaceIdentity => ({
  uid: user.uid,
  name:
    user.displayName || (user.isAnonymous ? "Guest workspace" : "Your account"),
  email: user.email,
  photoURL: user.photoURL,
  isAnonymous: user.isAnonymous,
});

export function observeWorkspaceIdentity(
  listener: (user: WorkspaceIdentity | null) => void,
) {
  let cancelled = false;
  let stop = () => {};
  if (!firebaseEnabled) {
    listener(null);
    return stop;
  }
  void privateAuth()
    .then((auth) => {
      if (cancelled) return;
      stop = onIdTokenChanged(auth, (user) =>
        listener(user ? identity(user) : null),
      );
    })
    .catch(() => {
      if (!cancelled) listener(null);
    });
  return () => {
    cancelled = true;
    stop();
  };
}

let pendingGoogleMerge: {
  credential: OAuthCredential;
  guestUid: string;
} | null = null;

function googleError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (
    code === "auth/popup-closed-by-user" ||
    code === "auth/cancelled-popup-request"
  )
    return new Error(
      "Google sign-in was cancelled. Your workspace is unchanged.",
    );
  if (code === "auth/popup-blocked")
    return new Error(
      "Allow the Google sign-in window for Thesis, then try again.",
    );
  if (code === "auth/operation-not-allowed")
    return new Error(
      "Google sign-in is not enabled for this deployment yet. Your guest workspace is safe.",
    );
  if (code === "auth/unauthorized-domain")
    return new Error(
      "Google sign-in is not configured for this website yet. Your guest workspace is safe.",
    );
  if (code === "auth/account-exists-with-different-credential")
    return new Error(
      "This email uses a different sign-in method. Your guest workspace has been kept. Sign in with the original account method before linking Google.",
    );
  return new Error(
    "Google sign-in could not be completed. Your current workspace has been kept. Please retry.",
  );
}

/** Linking a new Google identity preserves the guest UID and all server records. */
export async function connectGoogleAccount(): Promise<{
  status: "linked" | "signed_in" | "merge_required";
}> {
  const auth = await privateAuth();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    if (!auth.currentUser?.isAnonymous) {
      await signInWithPopup(auth, provider);
      return { status: "signed_in" };
    }
    const guest = auth.currentUser;
    try {
      const linked = await linkWithPopup(guest, provider);
      await linked.user.getIdToken(true);
      pendingGoogleMerge = null;
      return { status: "linked" };
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (
        code !== "auth/credential-already-in-use" &&
        code !== "auth/email-already-in-use"
      )
        throw error;
      const credential = GoogleAuthProvider.credentialFromError(
        error as Parameters<typeof GoogleAuthProvider.credentialFromError>[0],
      );
      if (!credential) throw error;
      // No sign-out or primary auth switch occurs on a collision.
      pendingGoogleMerge = { credential, guestUid: guest.uid };
      return { status: "merge_required" };
    }
  } catch (error) {
    throw googleError(error);
  }
}

export function cancelGoogleMerge() {
  pendingGoogleMerge = null;
}

/** A secondary in-memory identity proves ownership without displacing the guest. */
export async function completeGoogleMerge(): Promise<{
  merged: boolean;
  conflicts?: string[];
}> {
  const pending = pendingGoogleMerge;
  if (!pending)
    throw new Error(
      "Start Google sign-in again to continue. Your guest workspace is unchanged.",
    );
  const auth = await privateAuth();
  if (
    !auth.currentUser?.isAnonymous ||
    auth.currentUser.uid !== pending.guestUid
  ) {
    throw new Error(
      "The active workspace changed. Start Google sign-in again before merging.",
    );
  }
  const secondary = initializeApp(
    config,
    `thesis-google-merge-${crypto.randomUUID()}`,
  );
  const secondaryAuth = getAuth(secondary);
  try {
    await setPersistence(secondaryAuth, inMemoryPersistence);
    const target = await signInWithCredential(
      secondaryAuth,
      pending.credential,
    );
    const sourceIdToken = await auth.currentUser.getIdToken(true);
    const response = await fetch("/api/platform/account/merge", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await target.user.getIdToken(true)}`,
      },
      body: JSON.stringify({ sourceIdToken }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      conflicts?: string[];
    };
    if (!response.ok)
      throw new Error(
        result.error ||
          "Your workspaces could not be merged. Your guest workspace remains open and unchanged.",
      );
    // The server copies first and confirms before the primary browser identity changes.
    await updateCurrentUser(auth, target.user);
    pendingGoogleMerge = null;
    return { merged: true, conflicts: result.conflicts };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error)
      throw googleError(error);
    throw error;
  } finally {
    await signOut(secondaryAuth).catch(() => {});
    await deleteApp(secondary).catch(() => {});
  }
}
