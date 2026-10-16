import Constants from 'expo-constants';
import { reloadAppAsync } from 'expo';
import { getRandomBytes } from 'expo-crypto';
import * as Haptics from 'expo-haptics';
import { openSettings } from 'expo-linking';

import type { SqlExecutor } from '@/data/sql-executor';

import type { FileStore, ImageCompressor } from '../attachments/attachment-service';
import {
  expoCompressor,
  expoFileStore,
  pickImage,
  type PickResult,
} from '../attachments/expo-ports';
import type { ResetPorts } from '../reset/reset-service';
import { createExpoVault, expoSecrets, isDeviceCompromised } from '../security/expo-security';
import type { BiometricVault, Secrets } from '../security/lock-service';
import { expoResetPorts, openScratch, pickFile, shareBytes, type PickedFile } from './expo-data-io';

/** Device integrations, injected into the session so tests can swap them. */
export type Platform = Readonly<{
  files: FileStore;
  compress: ImageCompressor;
  pickImage: (source: 'library' | 'camera') => Promise<PickResult>;
  randomBytes: (n: number) => Uint8Array;
  openSystemSettings: () => void;
  haptic: (kind: 'success' | 'warning') => void;
  secrets: Secrets;
  vault: (promptMessage: () => string) => BiometricVault;
  isDeviceCompromised: () => Promise<boolean>;
  shareBytes: (fileName: string, bytes: Uint8Array | string, mimeType: string) => Promise<void>;
  pickFile: (mimeTypes: string[]) => Promise<PickedFile | null>;
  openScratch: () => SqlExecutor;
  resetPorts: (closeDatabase: () => void) => Omit<ResetPorts, 'wipeLock'>;
  reloadApp: () => void;
  appVersion: string;
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
  secrets: expoSecrets,
  vault: createExpoVault,
  isDeviceCompromised,
  shareBytes,
  pickFile,
  openScratch,
  resetPorts: expoResetPorts,
  reloadApp: () => void reloadAppAsync('data restored or reset'),
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
};

export type { PickedFile };
