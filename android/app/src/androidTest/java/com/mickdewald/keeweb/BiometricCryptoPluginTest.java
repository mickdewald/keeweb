package com.mickdewald.keeweb;

import static org.junit.Assert.assertEquals;

import androidx.biometric.BiometricPrompt;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class BiometricCryptoPluginTest {
    @Test
    public void mapsPromptErrorsToWebAppCodes() {
        assertEquals("USER_CANCELED", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_USER_CANCELED));
        assertEquals("USER_CANCELED", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_NEGATIVE_BUTTON));
        assertEquals("USER_CANCELED", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_CANCELED));
        assertEquals("USER_CANCELED", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_TIMEOUT));
        assertEquals("LOCKOUT", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_LOCKOUT));
        assertEquals("LOCKOUT", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_LOCKOUT_PERMANENT));
        assertEquals("NO_BIOMETRICS", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_NO_BIOMETRICS));
        assertEquals("UNAVAILABLE", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_HW_UNAVAILABLE));
        assertEquals("UNAVAILABLE", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_HW_NOT_PRESENT));
        assertEquals("FAILED", BiometricCryptoPlugin.errorCode(BiometricPrompt.ERROR_VENDOR));
    }
}
