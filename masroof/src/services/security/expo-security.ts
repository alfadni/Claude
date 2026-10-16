import * as Device from 'expo-device';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';

import type { BiometricVault, Secrets } from './lock-service';

const plain: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const expoSecrets: Secrets = {
  get: (k) => SecureStore.getItemAsync(k, plain),
  set: (k, v) => SecureStore.setItemAsync(k, v, plain),
  delete: (k) => SecureStore.deleteItemAsync(k, plain),
};

export function createExpoVault(promptMessage: () => string): BiometricVault {
  const bio = (): SecureStore.SecureStoreOptions => ({
    ...plain,
    requireAuthentication: true, // iOS: biometryCurrentSet; invalidated on change
    authenticationPrompt: promptMessage(),
  });
  return {
    async isAvailable() {
      const [hw, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      return hw && enrolled && SecureStore.canUseBiometricAuthentication();
    },
    set: (k, v) => SecureStore.setItemAsync(k, v, bio()),
    get: (k) => SecureStore.getItemAsync(k, bio()),
    delete: (k) => SecureStore.deleteItemAsync(k, bio()),
  };
}

/** Root/jailbreak hint (spec 7: warn only, never block). Android only in Expo. */
export async function isDeviceCompromised(): Promise<boolean> {
  try {
    return await Device.isRootedExperimentalAsync();
  } catch {
    return false;
  }
}
