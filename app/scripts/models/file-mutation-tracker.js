const pendingTrackers = new WeakMap();

function getTracker(file) {
    let tracker = pendingTrackers.get(file);
    if (!tracker) {
        tracker = { count: 0, callbacks: [], mutationQueue: Promise.resolve() };
        pendingTrackers.set(file, tracker);
    }
    return tracker;
}

function beginPendingMutation(file) {
    const tracker = getTracker(file);
    tracker.count++;
    file.set({ pendingMutations: tracker.count });
    let completed = false;
    return () => {
        if (completed) {
            return;
        }
        completed = true;
        tracker.count--;
        file.set({ pendingMutations: tracker.count });
        if (!tracker.count) {
            const callbacks = tracker.callbacks;
            tracker.callbacks = [];
            callbacks.forEach((callback) => callback());
        }
    };
}

function queuePendingMutation(file, mutation) {
    const completeMutation = beginPendingMutation(file);
    const tracker = getTracker(file);
    const result = tracker.mutationQueue.then(mutation);
    tracker.mutationQueue = result.catch(() => {});
    return result.then(
        (value) => {
            completeMutation();
            return value;
        },
        (err) => {
            completeMutation();
            throw err;
        }
    );
}

function waitForPendingMutations(file, callback) {
    const tracker = getTracker(file);
    if (tracker.count) {
        tracker.callbacks.push(callback);
    } else {
        callback();
    }
}

export { beginPendingMutation, queuePendingMutation, waitForPendingMutations };
