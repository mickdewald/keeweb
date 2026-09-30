package com.mickdewald.keeweb;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import java.nio.ByteBuffer;
import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;

/**
 * Master-password protection: a random AES-256-GCM key encrypts the password, and an RSA-OAEP key
 * pair in the Android Keystore wraps that AES key. Encrypting needs only the public key (no prompt);
 * unwrapping needs the biometric-bound private key. Layout: [2-byte wrapped length][wrapped key][12-byte IV][ciphertext].
 */
final class HybridCrypto {
    static final String ALIAS = "keeweb-master-password";
    private static final String RSA = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding";
    private static final int IV_LENGTH = 12;
    // Keystore RSA-OAEP only supports SHA-1 for MGF1 on many devices.
    static final OAEPParameterSpec OAEP = new OAEPParameterSpec(
            "SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT);

    private HybridCrypto() {}

    static KeyStore keyStore() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        return ks;
    }

    /**
     * Makes sure a usable key pair exists. A key that was permanently invalidated (new fingerprint,
     * screen lock removed) or whose biometric requirement differs is replaced, so a password
     * encrypted after a password unlock is never wrapped for a key that can no longer decrypt.
     */
    static void ensureKey(boolean requireBiometrics) throws Exception {
        if (keyStore().containsAlias(ALIAS)) {
            if (requiresUserAuthentication() == requireBiometrics && !isInvalidated()) {
                return;
            }
            deleteKey();
        }
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
                        ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(2048)
                .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP);
        if (requireBiometrics) {
            spec.setUserAuthenticationRequired(true)
                    .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
                    .setInvalidatedByBiometricEnrollment(true);
        }
        KeyPairGenerator gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore");
        gen.initialize(spec.build());
        gen.generateKeyPair();
    }

    static boolean requiresUserAuthentication() throws Exception {
        PrivateKey key = (PrivateKey) keyStore().getKey(ALIAS, null);
        KeyInfo info = KeyFactory.getInstance(key.getAlgorithm(), "AndroidKeyStore").getKeySpec(key, KeyInfo.class);
        return info.isUserAuthenticationRequired();
    }

    private static boolean isInvalidated() throws Exception {
        try {
            decryptCipher();
            return false;
        } catch (KeyPermanentlyInvalidatedException e) {
            return true;
        }
    }

    static void deleteKey() throws Exception {
        keyStore().deleteEntry(ALIAS);
    }

    static byte[] encrypt(byte[] plain) throws Exception {
        PublicKey stored = keyStore().getCertificate(ALIAS).getPublicKey();
        PublicKey pub = KeyFactory.getInstance(stored.getAlgorithm())
                .generatePublic(new X509EncodedKeySpec(stored.getEncoded()));
        KeyGenerator kg = KeyGenerator.getInstance("AES");
        kg.init(256);
        SecretKey aes = kg.generateKey();
        // A fresh AES key per encryption; the random IV is unique for that key by construction.
        byte[] iv = new byte[IV_LENGTH];
        new SecureRandom().nextBytes(iv);
        Cipher gcm = Cipher.getInstance("AES/GCM/NoPadding");
        gcm.init(Cipher.ENCRYPT_MODE, aes, new GCMParameterSpec(128, iv));
        byte[] body = gcm.doFinal(plain);
        Cipher rsa = Cipher.getInstance(RSA);
        rsa.init(Cipher.ENCRYPT_MODE, pub, OAEP);
        byte[] rawKey = aes.getEncoded();
        byte[] wrapped;
        try {
            wrapped = rsa.doFinal(rawKey);
        } finally {
            Arrays.fill(rawKey, (byte) 0);
        }
        return ByteBuffer.allocate(2 + wrapped.length + iv.length + body.length)
                .putShort((short) wrapped.length).put(wrapped).put(iv).put(body).array();
    }

    /** Returns an RSA cipher ready for decryption; the caller authenticates it via BiometricPrompt. */
    static Cipher decryptCipher() throws Exception {
        PrivateKey key = (PrivateKey) keyStore().getKey(ALIAS, null);
        if (key == null) {
            throw new KeyPermanentlyInvalidatedException("No key under " + ALIAS);
        }
        Cipher rsa = Cipher.getInstance(RSA);
        rsa.init(Cipher.DECRYPT_MODE, key, OAEP);
        return rsa;
    }

    static byte[] decrypt(Cipher authenticatedRsa, byte[] blob) throws Exception {
        ByteBuffer in = ByteBuffer.wrap(blob);
        int wrappedLength = in.getShort() & 0xFFFF;
        if (wrappedLength == 0 || wrappedLength + IV_LENGTH > in.remaining()) {
            throw new IllegalArgumentException("Malformed encrypted password");
        }
        byte[] wrapped = new byte[wrappedLength];
        in.get(wrapped);
        byte[] iv = new byte[IV_LENGTH];
        in.get(iv);
        byte[] body = new byte[in.remaining()];
        in.get(body);
        byte[] rawKey = authenticatedRsa.doFinal(wrapped);
        SecretKeySpec aes;
        try {
            aes = new SecretKeySpec(rawKey, "AES");
        } finally {
            Arrays.fill(rawKey, (byte) 0);
        }
        Cipher gcm = Cipher.getInstance("AES/GCM/NoPadding");
        gcm.init(Cipher.DECRYPT_MODE, aes, new GCMParameterSpec(128, iv));
        return gcm.doFinal(body);
    }
}
