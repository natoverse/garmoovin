import contextlib
import io
import json
import os
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from garmin_writer.__main__ import main
from garmin_writer.garmin import GarminError
from garmin_writer.mapping import load_mapping
from garmin_writer.tests.helpers import FakeGarmin


FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "title-mapping-v2.json"


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.tokens = self.root / "tokens"
        self.tokens.mkdir(mode=0o700)
        self.mapping = self.root / "edits.json"
        self.data = json.loads(FIXTURE.read_text())
        self.mapping.write_text(json.dumps(self.data))
        self.fake = FakeGarmin()
        self.output = io.StringIO()
        self.errors = io.StringIO()

    def tearDown(self):
        self.temp.cleanup()

    def run_cli(self, command, *, answer="APPLY", tty=True, on_confirm=None):
        with patch("garmin_writer.__main__.token_directory", return_value=self.tokens), \
             patch("garmin_writer.__main__.GarminAdapter", return_value=self.fake), \
             patch.dict(os.environ, {"GROOMIN_JOURNAL_DIR": str(self.root / "journal")}), \
             patch("sys.stdin.isatty", return_value=tty), \
             patch("builtins.input", side_effect=on_confirm, return_value=answer), \
             contextlib.redirect_stdout(self.output), contextlib.redirect_stderr(self.errors):
            return main(command)

    def test_read_only_review_and_json_only_apply(self):
        self.assertFalse(list(self.root.glob("*.zip")))
        self.assertEqual(self.run_cli(["review", str(self.mapping)]), 0)
        self.assertEqual(self.fake.writes, [])
        self.assertIn("2 eligible", self.output.getvalue())
        self.assertEqual(self.run_cli(["apply", str(self.mapping)]), 0)
        self.assertEqual(self.fake.writes, [("1", "Renamed 1"), ("2", "Renamed 2")])
        self.assertIn("2 confirmed", self.output.getvalue())
        self.assertEqual(self.run_cli(["apply", str(self.mapping)], tty=False), 0)
        self.assertEqual(len(self.fake.writes), 2)
        self.assertIn("already_applied", self.output.getvalue())

    def test_confirmation_is_required_and_not_scriptable(self):
        self.assertEqual(self.run_cli(["apply", str(self.mapping)], answer="no"), 1)
        self.assertEqual(self.run_cli(["apply", str(self.mapping)], tty=False), 1)
        self.assertEqual(self.fake.writes, [])

    def test_changes_to_file_after_review_cannot_alter_authorized_batch(self):
        def change_file(_prompt):
            data = deepcopy(self.data)
            data["changes"][0]["newTitle"] = "Not reviewed"
            self.mapping.write_text(json.dumps(data))
            return "APPLY"
        self.assertEqual(self.run_cli(["apply", str(self.mapping)], on_confirm=change_file), 0)
        self.assertEqual(self.fake.writes[0], ("1", "Renamed 1"))

    def test_invalid_contracts_fail_before_authentication(self):
        mutations = [
            lambda data: data.update(schemaVersion=1),
            lambda data: data.update(schemaVersion=2.0),
            lambda data: data.update(password="synthetic-secret"),
            lambda data: data["changes"][0].pop("recordedStartTime"),
            lambda data: data["changes"][0].update(recordedStartTime=None),
            lambda data: data["changes"][0].update(recordedStartTime="2025-02-30T10:00:00.000Z"),
            lambda data: data["changes"][0].update(recordedStartTime="2025-01-01T10:00:00"),
            lambda data: data["changes"][0].update(garminActivityId="2"),
            lambda data: data["changes"][0].update(sourceFile="../garmin-1.gpx"),
            lambda data: data["changes"][0].update(activityType="Unknown"),
            lambda data: data["changes"][0].update(newTitle=" "),
            lambda data: data["changes"][0].update(newTitle="Original 1"),
            lambda data: data["changes"].append(deepcopy(data["changes"][0])),
            lambda data: data.update(archiveFingerprint="invalid"),
            lambda data: data.update(changes=[]),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                data = deepcopy(self.data)
                mutation(data)
                self.mapping.write_text(json.dumps(data))
                self.assertEqual(self.run_cli(["apply", str(self.mapping)]), 2)
        self.assertEqual(self.fake.connects, 0)
        self.assertEqual(self.fake.writes, [])
        self.assertNotIn("synthetic-secret", self.errors.getvalue())

    def test_duplicate_json_keys_and_large_or_invalid_files_are_rejected(self):
        for raw in ('{"schemaVersion":2,"schemaVersion":1}', "not json", " " * (1024 * 1024 + 1)):
            self.mapping.write_text(raw)
            self.assertEqual(self.run_cli(["review", str(self.mapping)]), 2)
        self.assertEqual(self.fake.connects, 0)

    def test_uncertain_write_recovers_across_invocations_without_replay(self):
        def lose_response(activity_id, title):
            self.fake.records[activity_id]["activityName"] = title
            raise GarminError("unavailable")
        self.fake.on_write = lose_response
        self.assertEqual(self.run_cli(["apply", str(self.mapping)]), 1)
        self.assertEqual(len(self.fake.writes), 1)
        self.assertEqual(self.run_cli(["apply", str(self.mapping)]), 2)
        self.fake.on_write = None
        self.mapping.unlink()
        self.assertEqual(self.run_cli(["reconcile"]), 0)
        self.assertEqual(len(self.fake.writes), 1)
        self.assertEqual(self.run_cli(["reconcile", "--apply"]), 0)
        self.assertEqual(self.fake.writes, [("1", "Renamed 1"), ("2", "Renamed 2")])

    def test_remote_identity_mismatch_blocks_only_affected_changes(self):
        self.fake.records["1"]["summaryDTO"]["startTimeGMT"] = "2025-01-02T10:00:00"
        self.assertEqual(self.run_cli(["review", str(self.mapping)]), 1)
        self.assertEqual(self.fake.writes, [])
        self.assertIn("1 blocked", self.output.getvalue())
        self.assertEqual(self.run_cli(["apply", str(self.mapping)]), 1)
        self.assertEqual(self.fake.writes, [("2", "Renamed 2")])

    def test_shared_website_fixture_is_self_contained(self):
        mapping = load_mapping(FIXTURE)
        self.assertEqual(mapping.proposals().changes[0].sourceFile, "nested/garmin-1.gpx")
        self.assertEqual(mapping.proposals().changes[0].date, "2025-01-01T10:00:00.000Z")

    def test_interrupted_write_is_journaled_and_never_automatically_replayed(self):
        def interrupt(activity_id, title):
            self.fake.records[activity_id]["activityName"] = title
            raise KeyboardInterrupt
        self.fake.on_write = interrupt
        self.assertEqual(self.run_cli(["apply", str(self.mapping)]), 130)
        self.assertEqual(len(self.fake.writes), 1)
        self.fake.on_write = None
        self.assertEqual(self.run_cli(["reconcile"]), 0)
        self.assertEqual(len(self.fake.writes), 1)

    def test_unexpected_library_validation_error_never_leaks_secrets(self):
        with patch.object(self.fake, "connect", side_effect=ValueError("synthetic-secret-token")):
            self.assertEqual(self.run_cli(["review", str(self.mapping)]), 2)
        self.assertNotIn("synthetic-secret-token", self.errors.getvalue())
        self.assertIn("Details withheld", self.errors.getvalue())
