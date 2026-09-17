import contextlib
import io
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import requests

from garmin_writer import auth
from garmin_writer.garmin import GarminAdapter, GarminError


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name).resolve()
        token = self.path / "garmin_tokens.json"
        token.write_text("{}")
        token.chmod(0o600)
        self.api = MagicMock()
        self.api.client.connectapi.return_value = {"displayName": "account-a", "fullName": "Synthetic User"}
        self.adapter = GarminAdapter(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def test_restore_uses_only_tokens_and_no_transient_retries(self):
        with patch("garmin_writer.garmin.Garmin", return_value=self.api) as factory:
            account = self.adapter.connect()
        factory.assert_called_once_with(retry_attempts=0)
        self.api.login.assert_called_once_with(str(self.path))
        self.api.client.dump.assert_called_once_with(str(self.path))
        self.assertEqual(account.id, "account-a")

    def test_exact_owned_id_is_required_before_reading_details(self):
        with patch("garmin_writer.garmin.Garmin", return_value=self.api):
            self.adapter.connect()
        self.api.get_activities_by_date.return_value = [{"activityId": 1}]
        self.api.get_activity.return_value = {"activityId": 1}
        self.assertEqual(self.adapter.read("1", "2025-01-01T00:00:00Z"), {"activityId": 1})
        with self.assertRaises(GarminError):
            self.adapter.read("2", "2025-01-01T00:00:00Z")
        self.api.get_activity.assert_called_once_with("1")
        self.api.get_activities_by_date.assert_called_once_with("2024-12-31", "2025-01-02")

    def test_unsafe_token_permissions_and_errors_do_not_leak_credentials(self):
        (self.path / "garmin_tokens.json").chmod(0o644)
        with self.assertRaises(GarminError):
            self.adapter.connect()
        error = requests.HTTPError("synthetic-secret-token")
        error.response = SimpleNamespace(status_code=429)
        with self.assertRaises(GarminError) as captured:
            self.adapter.call(lambda: (_ for _ in ()).throw(error))
        self.assertEqual(captured.exception.kind, "rate_limit")
        self.assertNotIn("synthetic-secret-token", str(captured.exception))
        with self.assertRaises(GarminError) as captured:
            self.adapter.call(lambda: (_ for _ in ()).throw(ValueError("synthetic-secret-token")))
        self.assertEqual(captured.exception.kind, "unavailable")
        self.assertNotIn("synthetic-secret-token", str(captured.exception))

    def test_terminal_helper_performs_fresh_login_mfa_and_private_dump(self):
        fake = MagicMock()
        saved = {}
        def factory(**kwargs):
            saved.update(kwargs)
            return fake
        def login():
            self.assertNotIn("GARMINTOKENS", os.environ)
            self.assertEqual(saved["prompt_mfa"](), "654321")
        fake.login.side_effect = login
        output = io.StringIO()
        with patch("garmin_writer.auth.token_directory", return_value=self.path), \
             patch("builtins.input", return_value="synthetic@example.invalid"), \
             patch("getpass.getpass", side_effect=["synthetic-password", "654321"]), \
             patch("garmin_writer.auth.Garmin", side_effect=factory), \
             patch.dict(os.environ, {"GARMINTOKENS": "synthetic-token-directory"}), \
             contextlib.redirect_stdout(output):
            self.assertEqual(auth.main(), 0)
            self.assertEqual(os.environ["GARMINTOKENS"], "synthetic-token-directory")
        fake.client.dump.assert_called_once_with(str(self.path))
        self.assertNotIn("synthetic-password", output.getvalue())
        self.assertNotIn("654321", output.getvalue())
        self.assertEqual((self.path / "garmin_tokens.json").stat().st_mode & 0o777, 0o600)
