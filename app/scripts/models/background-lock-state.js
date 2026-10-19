import { Events } from 'framework/events';

let backgroundLockGeneration = 0;
let backgroundLockActive = false;

function syncModel(model) {
    if (!model) {
        return;
    }
    model.backgroundLockGeneration = backgroundLockGeneration;
    model.backgroundLockActive = backgroundLockActive;
}

function beginBackgroundLock(model) {
    backgroundLockGeneration++;
    return activateBackgroundLock(model, backgroundLockGeneration);
}

function activateBackgroundLock(model, generation) {
    if (typeof generation === 'number' && generation > backgroundLockGeneration) {
        backgroundLockGeneration = generation;
    }
    backgroundLockActive = true;
    syncModel(model);
    Events.emit('background-lock-started', { model, generation: backgroundLockGeneration });
    return backgroundLockGeneration;
}

function finishBackgroundLock(model, generation) {
    if (generation === backgroundLockGeneration) {
        backgroundLockActive = false;
        syncModel(model);
        Events.emit('background-lock-finished', { model, generation });
        return;
    }
    syncModel(model);
}

function getBackgroundLockGeneration(model) {
    return model?.backgroundLockGeneration ?? backgroundLockGeneration;
}

function isOpenAllowedForGeneration(model, generation) {
    const currentGeneration = getBackgroundLockGeneration(model);
    const active = model?.backgroundLockActive ?? backgroundLockActive;
    return generation === currentGeneration && !active;
}

export {
    activateBackgroundLock,
    beginBackgroundLock,
    finishBackgroundLock,
    getBackgroundLockGeneration,
    isOpenAllowedForGeneration
};
