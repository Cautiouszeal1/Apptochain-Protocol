// Persistent storage for Reown AppKit sessions, backed by AsyncStorage.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Storage } from "@reown/appkit-react-native";

const parse = <T,>(raw: string | null): T | undefined => {
  if (raw == null) return undefined;
  try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
};

export const storage: Storage = {
  async getKeys() {
    return [...(await AsyncStorage.getAllKeys())];
  },
  async getEntries<T = any>() {
    // getAllKeys + getItem exist in every AsyncStorage version (v2 and v3)
    const keys = [...(await AsyncStorage.getAllKeys())];
    const values = await Promise.all(keys.map((k) => AsyncStorage.getItem(k)));
    return keys.map((k, i) => [k, parse<T>(values[i]) as T] as [string, T]);
  },
  async getItem<T = any>(key: string) {
    return parse<T>(await AsyncStorage.getItem(key));
  },
  async setItem<T = any>(key: string, value: T) {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
  },
};
