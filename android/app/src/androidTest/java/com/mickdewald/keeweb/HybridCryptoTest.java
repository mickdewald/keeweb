package com.mickdewald.keeweb;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import androidx.biometric.BiometricManager;
import androidx.test.core.app.ApplicationProvider;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class HybridCryptoTest {
    @Before
    public void createKeyWithoutBiometrics() throws Exception {
        HybridCrypto.deleteKey();
        HybridCrypto.ensureKey(false);
    }

    @After
    public void deleteKey() throws Exception {
        HybridCrypto.deleteKey();
    }

    @Test
    public void roundTripsAShortPassword() throws Exception {
        byte[] plain = "fake-password".getBytes(StandardCharsets.UTF_8);
        assertArrayEquals(plain, HybridCrypto.decrypt(HybridCrypto.decryptCipher(), HybridCrypto.encrypt(plain)));
    }

    @Test
    public void roundTripsAThousandCharacterPassword() throws Exception {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 1000; i++) {
            sb.append((char) ('a' + i % 26));
        }
        byte[] plain = sb.toString().getBytes(StandardCharsets.UTF_8);
        assertArrayEquals(plain, HybridCrypto.decrypt(HybridCrypto.decryptCipher(), HybridCrypto.encrypt(plain)));
    }

    @Test
    public void encryptingTheSameValueTwiceGivesDifferentBlobs() throws Exception {
        byte[] plain = "fake-password".getBytes(StandardCharsets.UTF_8);
        assertFalse(Arrays.equals(HybridCrypto.encrypt(plain), HybridCrypto.encrypt(plain)));
    }

    @Test
    public void rejectsATamperedCiphertext() throws Exception {
        byte[] blob = HybridCrypto.encrypt("fake-password".getBytes(StandardCharsets.UTF_8));
        blob[blob.length - 1] ^= 1;
        assertThrows(Exception.class, () -> HybridCrypto.decrypt(HybridCrypto.decryptCipher(), blob));
    }

    @Test
    public void replacesAKeyThatDoesNotRequireBiometrics() throws Exception {
        // Keystore refuses biometric-bound keys until a strong biometric is enrolled.
        assumeTrue(BiometricManager.from(ApplicationProvider.getApplicationContext())
                        .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                == BiometricManager.BIOMETRIC_SUCCESS);
        assertFalse(HybridCrypto.requiresUserAuthentication());
        HybridCrypto.ensureKey(true);
        assertTrue(HybridCrypto.requiresUserAuthentication());
    }
}
