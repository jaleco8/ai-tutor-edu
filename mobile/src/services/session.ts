import * as SecureStore from 'expo-secure-store';
import { AuthSession } from '../types';

const SESSION_KEY = 'ai-tutor-session';

export async function loadSession() {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  return raw ? JSON.parse(raw) as AuthSession : null;
}

export async function saveSession(session: AuthSession) {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession() {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}
