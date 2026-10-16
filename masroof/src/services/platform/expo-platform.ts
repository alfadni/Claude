import { getRandomBytes } from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { openSettings } from 'expo-linking';

import type { FileStore, ImageCompressor } from '../attachments/attachment-service';
import {
  expoCompressor,
  expoFileStore,
  pickImage,
  type PickResult,
} from '../attachments/expo-ports';

/** Device integrations, injected into the session so tests can swap them. */
export type Platform = Readonly<{
  files: FileStore;
  compress: ImageCompressor;
  pickImage: (source: 'library' | 'camera') => Promise<PickResult>;
  randomBytes: (n: number) => Uint8Array;
  openSystemSettings: () => void;
  haptic: (kind: 'success' | 'warning') => void;
}>;

export const expoPlatform: Platform = {
  files: expoFileStore,
  compress: expoCompressor,
  pickImage,
  randomBytes: getRandomBytes,
  openSystemSettings: () => void openSettings(),
  haptic: (kind) =>
    void Haptics.notificationAsync(
      kind === 'success'
        ? Haptics.NotificationFeedbackType.Success
        : Haptics.NotificationFeedbackType.Warning,
    ).catch(() => undefined),
};
