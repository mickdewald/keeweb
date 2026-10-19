function canSaveToAndroidDocument(sourceStorage, destinationStorage) {
    return destinationStorage !== 'androiddoc' || sourceStorage === 'androiddoc';
}

export { canSaveToAndroidDocument };
