package com.mickdewald.keeweb;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
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
    // Never the app's real alias: running the tests must not delete the user's key.
    private static final String TEST_ALIAS = "keeweb-master-password-test";

    @Before
    public void createKeyWithoutBiometrics() throws Exception {
        HybridCrypto.deleteKey(TEST_ALIAS);
        HybridCrypto.ensureKey(TEST_ALIAS, false);
    }

    @After
    public void deleteKey() throws Exception {
        HybridCrypto.deleteKey(TEST_ALIAS);
    }

    private static byte[] roundTrip(byte[] plain) throws Exception {
        return HybridCrypto.decrypt(HybridCrypto.decryptCipher(TEST_ALIAS), HybridCrypto.encrypt(TEST_ALIAS, plain));
    }

    @Test
    public void usesADifferentAliasThanTheApp() {
        assertNotEquals(HybridCrypto.ALIAS, TEST_ALIAS);
    }

    @Test
    public void roundTripsAShortPassword() throws Exception {
        byte[] plain = "fake-password".getBytes(StandardCharsets.UTF_8);
        assertArrayEquals(plain, roundTrip(plain));
    }

    @Test
    public void roundTripsAThousandCharacterPassword() throws Exception {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 1000; i++) {
            sb.append((char) ('a' + i % 26));
        }
        byte[] plain = sb.toString().getBytes(StandardCharsets.UTF_8);
        assertArrayEquals(plain, roundTrip(plain));
    }

    @Test
    public void encryptingTheSameValueTwiceGivesDifferentBlobs() throws Exception {
        byte[] plain = "fake-password".getBytes(StandardCharsets.UTF_8);
        assertFalse(Arrays.equals(HybridCrypto.encrypt(TEST_ALIAS, plain), HybridCrypto.encrypt(TEST_ALIAS, plain)));
    }

    @Test
    public void rejectsATamperedCiphertextWithoutCallingItStale() throws Exception {
        byte[] blob = HybridCrypto.encrypt(TEST_ALIAS, "fake-password".getBytes(StandardCharsets.UTF_8));
        blob[blob.length - 1] ^= 1;
        Exception e = assertThrows(Exception.class,
                () -> HybridCrypto.decrypt(HybridCrypto.decryptCipher(TEST_ALIAS), blob));
        assertFalse(e instanceof HybridCrypto.StaleBlobException);
    }

    @Test
    public void reportsABlobOfAReplacedKeyAsStale() throws Exception {
        // File A was saved with the old key; file B's password unlock replaced the key.
        byte[] fileA = HybridCrypto.encrypt(TEST_ALIAS, "password-a".getBytes(StandardCharsets.UTF_8));
        HybridCrypto.deleteKey(TEST_ALIAS);
        HybridCrypto.ensureKey(TEST_ALIAS, false);
        byte[] fileB = "password-b".getBytes(StandardCharsets.UTF_8);
        assertArrayEquals(fileB, roundTrip(fileB));
        assertThrows(HybridCrypto.StaleBlobException.class,
                () -> HybridCrypto.decrypt(HybridCrypto.decryptCipher(TEST_ALIAS), fileA));
    }

    @Test
    public void reportsAMissingKeyAsInvalidated() throws Exception {
        HybridCrypto.deleteKey(TEST_ALIAS);
        assertThrows(android.security.keystore.KeyPermanentlyInvalidatedException.class,
                () -> HybridCrypto.decryptCipher(TEST_ALIAS));
    }

    @Test
    public void replacesAKeyThatDoesNotRequireBiometrics() throws Exception {
        // Keystore refuses biometric-bound keys until a strong biometric is enrolled.
        assumeTrue(BiometricManager.from(ApplicationProvider.getApplicationContext())
                        .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                == BiometricManager.BIOMETRIC_SUCCESS);
        assertFalse(HybridCrypto.requiresUserAuthentication(TEST_ALIAS));
        HybridCrypto.ensureKey(TEST_ALIAS, true);
        assertTrue(HybridCrypto.requiresUserAuthentication(TEST_ALIAS));
    }
}
