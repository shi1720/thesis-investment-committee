import { getApp, getApps, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  setPersistence,
  signInAnonymously,
  signOut,
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
  if (!auth.currentUser) throw new Error("Your private workspace could not be opened. Please retry.");
  headers.set("Authorization", `Bearer ${await auth.currentUser.getIdToken()}`);
  const response = await fetch(path, { ...options, headers });
  if (response.status !== 401) return response;
  headers.set("Authorization", `Bearer ${await auth.currentUser.getIdToken(true)}`);
  return fetch(path, { ...options, headers });
}

/** Call only after the authenticated account-data deletion succeeds. */
export async function newPrivateWorkspace() {
  if (!firebaseEnabled) return;
  const auth = await privateAuth();
  await signOut(auth);
  await signInAnonymously(auth);
}
