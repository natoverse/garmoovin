import contextlib
import io
import os
import unittest
from itertools import combinations
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

    def test_fresh_install_uses_garmoovin_defaults(self):
        self.assertEqual(token_directory(), self.home / ".garmoovin" / "tokens")
        self.assertEqual(journal_directory(), self.home / ".garmoovin" / "journal")

    def test_repository_and_nested_private_storage_are_rejected(self):
        for path in (storage.ROOT, storage.ROOT / "journal"):
            with self.subTest(path=path), self.assertRaises(StorageError):
                private_directory(path)

    def test_existing_private_state_is_not_silently_abandoned(self):
        for name in (".groomin", ".garmin-view"):
            home = self.home / name[1:]
            previous = home / name
            (previous / "tokens").mkdir(parents=True)
            (previous / "journal").mkdir()
            token = previous / "tokens" / "garmin_tokens.json"
            journal = previous / "journal" / "recovery.json"
            token.write_text("synthetic saved session")
            journal.write_text("synthetic unresolved journal")
            with self.subTest(name=name), patch("pathlib.Path.home", return_value=home):
                self.assertEqual(token_directory(), previous / "tokens")
                self.assertEqual(journal_directory(), previous / "journal")
                self.assertFalse((home / ".garmoovin").exists())
                self.assertEqual(token.read_text(), "synthetic saved session")
                self.assertEqual(journal.read_text(), "synthetic unresolved journal")
        self.assertIn("preserve existing state", self.messages.getvalue())

    def test_ambiguous_existing_journal_directories_require_an_explicit_choice(self):
        for index, names in enumerate(combinations((".garmoovin", ".groomin", ".garmin-view"), 2)):
            home = self.home / str(index)
            for name in names:
                (home / name / "journal").mkdir(parents=True)
            with self.subTest(names=names), patch("pathlib.Path.home", return_value=home):
                with self.assertRaises(StorageError):
                    journal_directory()
                with self.assertRaises(StorageError):
                    token_directory()
                selected = home / names[0]
                with patch.dict(os.environ, {
                    "GARMOOVIN_JOURNAL_DIR": str(selected / "journal"),
                    "GARMINTOKENS": str(selected / "tokens"),
                }):
                    self.assertEqual(journal_directory(), selected / "journal")
                    self.assertEqual(token_directory(), selected / "tokens")

    def test_legacy_environment_setting_is_preserved_but_conflicts_are_rejected(self):
        path = self.home / "existing-journal"
        for name in ("GROOMIN_JOURNAL_DIR", "GARMIN_VIEW_JOURNAL_DIR"):
            with self.subTest(name=name), patch.dict(os.environ, {name: str(path), "HOME": str(self.home)}, clear=True):
                self.assertEqual(journal_directory(), path)
                self.assertIn(f"{name} is deprecated; use GARMOOVIN_JOURNAL_DIR", self.messages.getvalue())
                os.environ["GARMOOVIN_JOURNAL_DIR"] = "~/existing-journal"
                self.assertEqual(journal_directory().expanduser(), path)
                os.environ["GARMOOVIN_JOURNAL_DIR"] = str(self.home / "different")
                with self.assertRaises(StorageError):
                    journal_directory()

    def test_legacy_overrides_cannot_conflict_with_each_other(self):
        os.environ["GROOMIN_JOURNAL_DIR"] = str(self.home / "one")
        os.environ["GARMIN_VIEW_JOURNAL_DIR"] = str(self.home / "two")
        with self.assertRaises(StorageError):
            journal_directory()
        os.environ["GARMIN_VIEW_JOURNAL_DIR"] = os.environ["GROOMIN_JOURNAL_DIR"]
        os.environ["GARMOOVIN_JOURNAL_DIR"] = os.environ["GROOMIN_JOURNAL_DIR"]
        self.assertEqual(journal_directory(), self.home / "one")

    def test_legacy_symlinks_cannot_bypass_private_storage_guards(self):
        target = self.home / "elsewhere"
        target.mkdir()
        for name in (".garmoovin", ".groomin", ".garmin-view"):
            link = self.home / name
            link.symlink_to(target, target_is_directory=True)
            with self.subTest(name=name), self.assertRaises(StorageError):
                token_directory()
            link.unlink()
