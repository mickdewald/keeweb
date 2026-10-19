"""Exercise the APK guard against real compiled Android resources, without secrets."""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
SDK = Path(os.environ.get("ANDROID_HOME", Path.home() / "Library/Android/sdk"))
TOOLS = sorted(SDK.glob("build-tools/*/aapt2"))
PLATFORMS = sorted(SDK.glob("platforms/*/android.jar"))
FAKE = "fakeCredentialForRegressionOnly"


@unittest.skipUnless(TOOLS and PLATFORMS, "Android SDK is required for compiled-resource tests")
class ApkSecretTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="keeweb-apk-guard-")
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.apk = self.work / "fixture.apk"

    def build(self, strings="", metadata="", asset="safe fixture", extra_resources=None):
        res = self.work / "res/values"
        res.mkdir(parents=True)
        (res / "strings.xml").write_text(f"<resources>{strings}</resources>")
        for relative, content in (extra_resources or {}).items():
            destination = self.work / "res" / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(content)
        manifest = self.work / "AndroidManifest.xml"
        manifest.write_text(
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android" '
            'package="test.keeweb.guard"><application>' + metadata + "</application></manifest>"
        )
        compiled = self.work / "compiled.zip"
        subprocess.run([str(TOOLS[-1]), "compile", "--dir", str(self.work / "res"),
                        "-o", str(compiled)], check=True, capture_output=True)
        subprocess.run([str(TOOLS[-1]), "link", "-I", str(PLATFORMS[-1]),
                        "--manifest", str(manifest), "-o", str(self.apk),
                        str(compiled)], check=True, capture_output=True)
        with ZipFile(self.apk, "a") as apk:
            apk.writestr("assets/public/index.html", asset)

    def check(self, **env):
        return subprocess.run(["bash", "scripts/android/check-apk-secrets.sh", str(self.apk)],
                              cwd=ROOT, env={**os.environ, **env}, capture_output=True, text=True)

    def assertRejected(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertNotIn(FAKE, result.stdout + result.stderr, "guard must redact candidate values")

    def test_safe_compiled_apk_passes(self):
        self.build(strings='<string name="app_name">KeeWeb Guard</string>')
        self.assertEqual(self.check().returncode, 0)

    def test_asset_secret_rejected(self):
        self.build(asset=f'apiKey="{FAKE}"')
        self.assertRejected(self.check())

    def test_compiled_string_secret_rejected(self):
        self.build(strings=f'<string name="agent_password">{FAKE}</string>')
        self.assertRejected(self.check())

    def test_credential_resource_alias_cannot_hide_value(self):
        self.build(strings=f'<string name="ordinary_name">{FAKE}</string>'
                   '<item name="agent_password" type="string">@string/ordinary_name</item>')
        self.assertRejected(self.check())

    def test_allowed_label_cannot_hide_a_locale_alias(self):
        self.build(strings=f'<string name="ordinary_name">{FAKE}</string>'
                   '<string name="confirm_device_credential_password">Use password</string>',
                   extra_resources={"values-de/strings.xml": '<resources><item type="string" '
                                    'name="confirm_device_credential_password">'
                                    '@string/ordinary_name</item></resources>'})
        self.assertRejected(self.check())

    def test_metadata_nonstring_resource_cannot_bypass_guard(self):
        self.build(strings='<integer name="ordinary_name">123</integer>',
                   metadata='<meta-data android:name="apiKey" android:resource="@integer/ordinary_name"/>')
        self.assertRejected(self.check())

    def test_short_native_password_is_still_a_credential(self):
        self.build(strings='<string name="agent_password">short</string>')
        self.assertRejected(self.check())

    def test_raw_resource_secret_rejected(self):
        self.build()
        with ZipFile(self.apk, "a") as apk:
            apk.writestr("res/raw/config.json", '{"apiKey":"' + FAKE + '"}')
        self.assertRejected(self.check())

    def test_known_biometric_ui_label_passes(self):
        self.build(strings='<string name="confirm_device_credential_password">Passwort nutzen</string>')
        self.assertEqual(self.check().returncode, 0)

    def test_known_ui_label_name_cannot_hide_secret(self):
        self.build(strings=f'<string name="confirm_device_credential_password">{FAKE}</string>')
        self.assertRejected(self.check())

    def test_compiled_metadata_secret_rejected(self):
        self.build(metadata=f'<meta-data android:name="apiKey" android:value="{FAKE}"/>')
        self.assertRejected(self.check())

    def test_metadata_resource_reference_rejected(self):
        self.build(strings=f'<string name="ordinary_name">{FAKE}</string>',
                   metadata='<meta-data android:name="apiKey" android:resource="@string/ordinary_name"/>')
        self.assertRejected(self.check())

    def test_database_in_any_apk_path_rejected(self):
        self.build()
        with ZipFile(self.apk, "a") as apk:
            apk.writestr("res/raw/hidden.KDBX", "fake database")
        self.assertRejected(self.check())

    def test_missing_decoder_fails_closed(self):
        self.build()
        self.assertRejected(self.check(KEEWEB_AAPT2=str(self.work / "missing-aapt2")))

    def test_broken_decoder_fails_closed(self):
        self.build()
        decoder = self.work / "broken-aapt2"
        decoder.write_text("#!/bin/sh\nexit 2\n")
        decoder.chmod(0o700)
        self.assertRejected(self.check(KEEWEB_AAPT2=str(decoder)))

    def test_corrupt_resource_table_rejected(self):
        self.build()
        replacement = self.work / "corrupt.apk"
        with ZipFile(self.apk) as original, ZipFile(replacement, "w") as corrupt:
            for item in original.infolist():
                corrupt.writestr(item.filename, b"broken" if item.filename == "resources.arsc"
                                 else original.read(item))
        shutil.move(replacement, self.apk)
        self.assertRejected(self.check())


if __name__ == "__main__":
    unittest.main()
