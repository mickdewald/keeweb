import * as kdbxweb from 'kdbxweb';
import { Otp } from 'util/data/otp';

const EntryModelOtpAutoTypeMixin = {
    initOtpGenerator() {
        let otpUrl;
        if (this.fields.otp) {
            otpUrl = this.fields.otp;
            if (otpUrl.isProtected) {
                otpUrl = otpUrl.getText();
            }
            // called only if secret provided, no formatted url
            if (Otp.isSecret(otpUrl.replace(/\s/g, ''))) {
                otpUrl = Otp.makeUrl(otpUrl.replace(/\s/g, '').toUpperCase());
            } else if (otpUrl.toLowerCase().lastIndexOf('otpauth:', 0) !== 0) {
                // KeeOTP plugin format
                const args = {};
                otpUrl.split('&').forEach((part) => {
                    const parts = part.split('=', 2);
                    args[parts[0]] = decodeURIComponent(parts[1]).replace(/=/g, '');
                });
                if (args.key) {
                    otpUrl = Otp.makeUrl(args.key, args.step, args.size);
                }
            }
        } else if (this.entry.fields.get('TOTP Seed')) {
            // TrayTOTP plugin format
            let secret = this.entry.fields.get('TOTP Seed');
            if (secret.isProtected) {
                secret = secret.getText();
            }
            if (secret) {
                let settings = this.entry.fields.get('TOTP Settings');
                if (settings && settings.isProtected) {
                    settings = settings.getText();
                }
                let period, digits;
                if (settings) {
                    settings = settings.split(';');
                    if (settings.length > 0 && settings[0] > 0) {
                        period = settings[0];
                    }
                    if (settings.length > 1 && settings[1] > 0) {
                        digits = settings[1];
                    }
                }
                otpUrl = Otp.makeUrl(secret, period, digits);
                this.fields.otp = kdbxweb.ProtectedValue.fromString(otpUrl);
            }
        }
        if (otpUrl) {
            if (this.otpGenerator && this.otpGenerator.url === otpUrl) {
                return;
            }
            try {
                this.otpGenerator = Otp.parseUrl(otpUrl);
            } catch {
                this.otpGenerator = null;
            }
        } else {
            this.otpGenerator = null;
        }
    },

    setOtp(otp) {
        this.otpGenerator = otp;
        this.setOtpUrl(otp.url);
    },

    setOtpUrl(url) {
        this.setField('otp', url ? kdbxweb.ProtectedValue.fromString(url) : undefined);
        this.entry.fields.delete('TOTP Seed');
        this.entry.fields.delete('TOTP Settings');
    },

    getEffectiveEnableAutoType() {
        if (typeof this.entry.autoType.enabled === 'boolean') {
            return this.entry.autoType.enabled;
        }
        return this.group.getEffectiveEnableAutoType();
    },

    getEffectiveAutoTypeSeq() {
        return this.entry.autoType.defaultSequence || this.group.getEffectiveAutoTypeSeq();
    },

    setEnableAutoType(enabled) {
        this._entryModified();
        this.entry.autoType.enabled = enabled;
        this._buildAutoType();
    },

    setAutoTypeObfuscation(enabled) {
        this._entryModified();
        this.entry.autoType.obfuscation = enabled
            ? kdbxweb.Consts.AutoTypeObfuscationOptions.UseClipboard
            : kdbxweb.Consts.AutoTypeObfuscationOptions.None;
        this._buildAutoType();
    },

    setAutoTypeSeq(seq) {
        this._entryModified();
        this.entry.autoType.defaultSequence = seq || undefined;
        this._buildAutoType();
    }
};

export { EntryModelOtpAutoTypeMixin };
