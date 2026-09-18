import contextlib
import io
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from garmin_writer import storage
from garmin_writer.storage import StorageError, journal_directory, private_directory, token_directory
from garmin_writer.tests.helpers import private_test_directory


class StorageNamingTests(unittest.TestCase):
    def setUp(self):
        self.temp = self.enterContext(private_test_directory())
        self.home = Path(self.temp.name).resolve()
        self.patches = contextlib.ExitStack()
        self.patches.enter_context(patch("pathlib.Path.home", return_value=self.home))
        self.patches.enter_context(patch.dict(os.environ, {}, clear=True))
        self.messages = io.StringIO()
        self.patches.enter_context(contextlib.redirect_stderr(self.messages))

    def tearDown(self):
        self.patches.close()
        self.temp.cleanup()

    def test_fresh_install_uses_groomin_defaults(self):
        self.assertEqual(token_directory(), self.home / ".groomin" / "tokens")
        self.assertEqual(journal_directory(), self.home / ".groomin" / "journal")

    def test_repository_and_nested_private_storage_are_rejected(self):
        for path in (storage.ROOT, storage.ROOT / "journal"):
            with self.subTest(path=path), self.assertRaises(StorageError):
                private_directory(path)

    def test_existing_private_state_is_not_silently_abandoned(self):
        previous = self.home / ".garmin-view"
        (previous / "tokens").mkdir(parents=True)
        (previous / "journal").mkdir()
        self.assertEqual(token_directory(), previous / "tokens")
        self.assertEqual(journal_directory(), previous / "journal")
        self.assertFalse((self.home / ".groomin").exists())
        self.assertIn("preserve existing state", self.messages.getvalue())

    def test_ambiguous_existing_journal_directories_require_an_explicit_choice(self):
        for name in (".garmin-view", ".groomin"):
            (self.home / name / "journal").mkdir(parents=True)
        with self.assertRaises(StorageError):
            journal_directory()
        os.environ["GROOMIN_JOURNAL_DIR"] = str(self.home / ".garmin-view" / "journal")
        self.assertEqual(journal_directory(), self.home / ".garmin-view" / "journal")

    def test_legacy_environment_setting_is_preserved_but_conflicts_are_rejected(self):
        path = self.home / "existing-journal"
        os.environ["GARMIN_VIEW_JOURNAL_DIR"] = str(path)
        self.assertEqual(journal_directory(), path)
        self.assertIn("deprecated", self.messages.getvalue())
        os.environ["GROOMIN_JOURNAL_DIR"] = str(path)
        self.assertEqual(journal_directory(), path)
        os.environ["GROOMIN_JOURNAL_DIR"] = str(self.home / "different")
        with self.assertRaises(StorageError):
            journal_directory()

    def test_legacy_symlinks_cannot_bypass_private_storage_guards(self):
        target = self.home / "elsewhere"
        target.mkdir()
        (self.home / ".garmin-view").symlink_to(target, target_is_directory=True)
        with self.assertRaises(StorageError):
            token_directory()
