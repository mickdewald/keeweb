const PassThroughTags = ['a', 'input', 'textarea'];

function touchValueAction({ isMobile, readonly, hasValue, targetTag, insideLink, hasSelection }) {
    if (PassThroughTags.includes(targetTag) || insideLink || hasSelection) {
        return 'none';
    }
    if (!isMobile || !hasValue) {
        return readonly ? 'none' : 'edit';
    }
    return 'copy';
}

function touchLongPressAction({ isMobile, readonly }) {
    return isMobile && !readonly ? 'actions' : 'none';
}

export { touchValueAction, touchLongPressAction };
