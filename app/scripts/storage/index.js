import { Launcher } from 'comp/launcher';
import { AndroidPlatform } from 'comp/platform/android/android-platform';
import { StorageAndroidDocument } from 'storage/impl/storage-android-document';
import { StorageCache } from 'storage/impl/storage-cache';
import { StorageDropbox } from 'storage/impl/storage-dropbox';
import { StorageFile } from 'storage/impl/storage-file';
import { StorageFileCache } from 'storage/impl/storage-file-cache';
import { StorageGDrive } from 'storage/impl/storage-gdrive';
import { StorageOneDrive } from 'storage/impl/storage-onedrive';
import { StorageTeams } from 'storage/impl/storage-teams';
import { StorageWebDav } from 'storage/impl/storage-webdav';
import { createOAuthSession } from 'storage/pkce';

const BuiltInStorage = {
    file: new StorageFile(),
    cache: Launcher ? new StorageFileCache() : new StorageCache()
};

const ThirdPartyStorage = {
    dropbox: new StorageDropbox(),
    gdrive: new StorageGDrive(),
    onedrive: new StorageOneDrive(),
    msteams: new StorageTeams(),
    webdav: new StorageWebDav()
};

const Storage = BuiltInStorage;
if (!Launcher || Launcher.thirdPartyStoragesSupported) {
    Object.assign(Storage, ThirdPartyStorage);
}
if (AndroidPlatform.isAndroid) {
    Storage.androiddoc = new StorageAndroidDocument();
}

requestAnimationFrame(createOAuthSession);

export { Storage };
