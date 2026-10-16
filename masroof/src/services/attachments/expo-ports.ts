import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { FileStore, ImageCompressor } from './attachment-service';

const MAX_EDGE = 1600;

/** Paths are relative to the app's document directory (sandboxed, not shared). */
const fileAt = (path: string) => new File(Paths.document, path);

export const expoFileStore: FileStore = {
  async write(path, bytes) {
    const parent = new Directory(Paths.document, path.split('/').slice(0, -1).join('/'));
    if (!parent.exists) parent.create({ intermediates: true });
    const f = fileAt(path);
    if (!f.exists) f.create();
    await f.write(bytes);
  },
  read: (path) => fileAt(path).bytes(),
  move(from, to) {
    fileAt(from).move(fileAt(to));
  },
  delete(path) {
    const f = fileAt(path);
    if (f.exists) f.delete();
  },
  list(dir) {
    const d = new Directory(Paths.document, dir);
    if (!d.exists) return [];
    return d.list().map((entry) => entry.name);
  },
  availableBytes: () => Paths.availableDiskSpace,
};

export const expoCompressor: ImageCompressor = async (uri) => {
  const original = await ImageManipulator.manipulate(uri).renderAsync();
  // Longest edge ≤ 1600px, aspect ratio kept, small images never upscaled.
  let image = original;
  if (original.width > MAX_EDGE || original.height > MAX_EDGE) {
    const ctx = ImageManipulator.manipulate(original);
    ctx.resize(original.width >= original.height ? { width: MAX_EDGE } : { height: MAX_EDGE });
    image = await ctx.renderAsync();
  }
  const result = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  const tmp = new File(result.uri);
  try {
    return await tmp.bytes();
  } finally {
    // The manipulator and the picker both leave plaintext JPEGs in the cache
    // directory: remove them as soon as the bytes are in memory.
    deleteIfCached(result.uri);
    deleteIfCached(uri);
  }
};

function deleteIfCached(uri: string) {
  try {
    if (!uri.startsWith(Paths.cache.uri)) return; // never touch the user's photo library
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // best effort: the OS also purges the cache directory
  }
}

export type PickResult =
  | { status: 'picked'; uri: string; width: number }
  | { status: 'cancelled' }
  /** Permission refused; when !canAskAgain the UI deep-links to Settings (J2). */
  | { status: 'denied'; canAskAgain: boolean };

export async function pickImage(source: 'library' | 'camera'): Promise<PickResult> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { status: 'denied', canAskAgain: perm.canAskAgain };
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1,
    exif: false,
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return { status: 'cancelled' };
  return { status: 'picked', uri: asset.uri, width: asset.width };
}
