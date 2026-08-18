import { AutoTypeEmitter } from 'auto-type/auto-type-emitter';
import { Logger } from 'util/logger';

const emitterLogger = new Logger(
    'auto-type-emitter',
    undefined,
    localStorage.debugAutoType ? Logger.Level.All : Logger.Level.Info
);

const AutoTypeRunnerEmitterMixin = {
    run(callback, windowId) {
        this.emitter = new AutoTypeEmitter(this.emitNext.bind(this), windowId);
        this.emitterState = {
            callback,
            stack: [],
            ops: this.ops,
            opIx: 0,
            mod: {},
            activeMod: {},
            finished: null
        };
        this.emitter.begin();
    },

    emitNext(err) {
        if (err) {
            this.emitterState.finished = true;
            this.emitterState.callback(err);
            return;
        }
        if (this.emitterState.finished) {
            this.emitterState.callback();
            return;
        }
        this.resetEmitterMod(this.emitterState.mod);
        if (this.emitterState.opIx >= this.emitterState.ops.length) {
            const state = this.emitterState.stack.pop();
            if (state) {
                Object.assign(this.emitterState, {
                    ops: state.ops,
                    opIx: state.opIx,
                    mod: state.mod
                });
                this.emitNext();
            } else {
                this.resetEmitterMod({});
                this.emitterState.finished = true;
                emitterLogger.debug('waitComplete');
                this.emitter.waitComplete();
            }
            return;
        }
        const op = this.emitterState.ops[this.emitterState.opIx];
        if (op.type === 'group') {
            if (op.mod) {
                this.setEmitterMod(op.mod);
            }
            this.emitterState.stack.push({
                ops: this.emitterState.ops,
                opIx: this.emitterState.opIx + 1,
                mod: { ...this.emitterState.mod }
            });
            Object.assign(this.emitterState, {
                ops: op.value,
                opIx: 0,
                mod: { ...this.emitterState.activeMod }
            });
            this.emitNext();
            return;
        }
        this.emitterState.opIx++;
        if (op.mod) {
            this.setEmitterMod(op.mod);
        }
        switch (op.type) {
            case 'text':
                emitterLogger.debug('text', op.value);
                if (op.value) {
                    this.emitter.text(op.value);
                } else {
                    this.emitNext();
                }
                break;
            case 'key':
                emitterLogger.debug('key', op.value);
                this.emitter.key(op.value);
                break;
            case 'cmd': {
                const method = this.emitter[op.value];
                if (!method) {
                    throw 'Bad cmd: ' + op.value;
                }
                emitterLogger.debug(op.value, op.arg);
                method.call(this.emitter, op.arg);
                break;
            }
            default:
                throw 'Bad op: ' + op.type;
        }
    },

    setEmitterMod(addedMod) {
        Object.keys(addedMod).forEach(function (mod) {
            if (addedMod[mod] && !this.emitterState.activeMod[mod]) {
                emitterLogger.debug('mod', mod, true);
                this.emitter.setMod(mod, true);
                this.emitterState.activeMod[mod] = true;
            }
        }, this);
    },

    resetEmitterMod(targetState) {
        Object.keys(this.emitterState.activeMod).forEach(function (mod) {
            if (this.emitterState.activeMod[mod] && !targetState[mod]) {
                emitterLogger.debug('mod', mod, false);
                this.emitter.setMod(mod, false);
                delete this.emitterState.activeMod[mod];
            }
        }, this);
    }
};

export { AutoTypeRunnerEmitterMixin };
