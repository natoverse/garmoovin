import contextlib
import io
import json
import os
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from garmin_writer.__main__ import display, main
from garmin_writer.garmin import GarminError
from garmin_writer.mapping import load_mapping
from garmin_writer.models import Batch, Item
from garmin_writer.tests.helpers import FakeGarmin, private_test_directory


FIXTURE = Path(__file__).resolve().parents[2] / "fixtures" / "title-mapping-v2.json"


class CliTests(unittest.TestCase):
    def setUp(self):
        self.temp = self.enterContext(private_test_directory())
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

    def run_cli(self, command, *, tty=False):
        with patch("garmin_writer.__main__.token_directory", return_value=self.tokens), \
             patch("garmin_writer.__main__.GarminAdapter", return_value=self.fake), \
             patch.dict(os.environ, {"GROOMIN_JOURNAL_DIR": str(self.root / "journal")}), \
             patch("sys.stdin.isatty", return_value=tty), \
             patch("builtins.input", side_effect=AssertionError("Activity commands must not prompt")) as prompt, \
             contextlib.redirect_stdout(self.output), contextlib.redirect_stderr(self.errors):
            result = main(command)
            prompt.assert_not_called()
            return result

    def test_read_only_review_and_json_only_apply(self):
        self.assertFalse(list(self.root.glob("*.zip")))
        self.assertEqual(self.run_cli(["review", str(self.mapping)]), 0)
        self.assertEqual(self.fake.writes, [])
        self.assertIn("2 eligible", self.output.getvalue())
        self.assertNotIn("Blocked activities", self.output.getvalue())
        self.assertEqual(self.run_cli(["apply", str(self.mapping)]), 0)
        self.assertEqual(self.fake.writes, [("1", "Renamed 1"), ("2", "Renamed 2")])
        self.assertIn("2 confirmed", self.output.getvalue())
        self.assertEqual(self.run_cli(["apply", str(self.mapping)], tty=False), 0)
        self.assertEqual(len(self.fake.writes), 2)
        self.assertIn("already_applied", self.output.getvalue())

    def test_apply_executes_without_prompt_with_or_without_terminal(self):
        for tty in (False, True):
            with self.subTest(tty=tty):
                self.fake = FakeGarmin()
                self.assertEqual(self.run_cli(["apply", str(self.mapping)], tty=tty), 0)
                self.assertEqual(self.fake.writes, [("1", "Renamed 1"), ("2", "Renamed 2")])
        self.assertIn("Applying 2 eligible activity changes", self.output.getvalue())

    def test_changes_to_file_after_review_cannot_alter_authorized_batch(self):
        def change_file(batch):
            data = deepcopy(self.data)
            data["changes"][0]["newTitle"] = "Not reviewed"
            self.mapping.write_text(json.dumps(data))
            display(batch)
        with patch("garmin_writer.__main__.display", side_effect=change_file):
            self.assertEqual(self.run_cli(["apply", str(self.mapping)]), 0)
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
        summary = self.output.getvalue().split("Blocked activities (1):\n")[1]
        self.assertIn('"Original 1" (Garmin ID: "1"; source: "nested/garmin-1.gpx")', summary)
        self.assertIn('Reason: "The recorded start time differs by more than 60 seconds."', summary)
        self.assertNotIn("Original 2", summary)
        self.assertEqual(self.run_cli(["apply", str(self.mapping)]), 1)
        self.assertEqual(self.fake.writes, [("2", "Renamed 2")])
        results = self.output.getvalue().split("Operation results:\n")[1]
        self.assertIn("Blocked activities (1):", results)
        self.assertIn('Reason: "The recorded start time differs by more than 60 seconds."', results)

    def test_blocked_summary_lists_every_activity_and_reason(self):
        self.fake.records["1"]["summaryDTO"]["startTimeGMT"] = "2025-01-02T10:00:00"
        del self.fake.records["2"]
        self.assertEqual(self.run_cli(["apply", str(self.mapping)]), 1)
        summary = self.output.getvalue().split("Blocked activities (2):\n")[1]
        self.assertIn('"Original 1" (Garmin ID: "1";', summary)
        self.assertIn('"Original 2" (Garmin ID: "2";', summary)
        self.assertIn("The recorded start time differs by more than 60 seconds.", summary)
        self.assertIn("This activity is not accessible in the connected Garmin account.", summary)
        self.assertEqual(self.fake.writes, [])

    def test_blocked_summary_handles_missing_details_and_escapes_terminal_text(self):
        proposal = load_mapping(self.mapping).proposals().changes[0]
        item = Item(proposal=proposal, status="blocked", currentTitle="Current\n\x1b[31mname")
        batch = Batch(
            id="a" * 32, createdAt="2026-09-18T00:00:00Z",
            archiveFingerprint=self.data["archiveFingerprint"], account=self.fake.identity,
            items=[item],
        )
        with contextlib.redirect_stdout(self.output):
            display(batch)
        summary = self.output.getvalue().split("Blocked activities (1):\n")[1]
        self.assertIn('"Current\\n\\u001b[31mname" (Garmin ID: unavailable;', summary)
        self.assertIn('Reason: "No explanation was provided."', summary)
        self.assertNotIn("\x1b", summary)

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

    def use_type_fixture(self):
        self.data = json.loads((FIXTURE.parent / "activity-mapping-v3.json").read_text())
        self.mapping.write_text(json.dumps(self.data))
        self.fake.records["42"] = {
            "activityId": 42, "activityName": "Remote morning run",
            "summaryDTO": {"startTimeGMT": "2025-01-02T00:00:00"},
            "activityTypeDTO": {"typeKey": "running"},
        }

    def test_type_review_displays_original_current_proposed_values_and_catalog_binding(self):
        self.use_type_fixture()
        self.assertEqual(self.run_cli(["review", str(self.mapping)]), 0)
        output = self.output.getvalue()
        for expected in (
            '"activityType": "Running"', '"currentActivityType": "running"',
            '"newActivityType": "trail_running"', '"typeId": 6', '"parentTypeId": 1',
            '"originalTitle": "Morning run"', '"currentTitle": "Remote morning run"',
            '"changedSinceExport": true', '"typeChangedSinceExport": false',
        ):
            self.assertIn(expected, output)
        self.assertEqual(self.fake.writes, [])
        self.assertEqual(self.fake.type_writes, [])
        self.assertEqual(self.run_cli(["apply", str(self.mapping)]), 0)
        self.assertEqual(self.fake.writes, [])
        self.assertEqual(len(self.fake.type_writes), 1)
        self.assertIn("1 eligible activity changes", self.output.getvalue())
        self.assertEqual(self.run_cli(["apply", str(self.mapping)], tty=False), 0)
        self.assertEqual(len(self.fake.type_writes), 1)
        self.assertIn('"typeChangedSinceExport": true', self.output.getvalue())

    def test_type_changes_execute_without_terminal_or_prompt(self):
        self.use_type_fixture()
        self.assertEqual(self.run_cli(["apply", str(self.mapping)], tty=False), 0)
        self.assertEqual(len(self.fake.type_writes), 1)
        self.assertEqual(self.fake.writes, [])

    def test_blocked_type_review_explains_catalog_failure(self):
        self.use_type_fixture()
        self.fake.catalog = []
        self.assertEqual(self.run_cli(["review", str(self.mapping)]), 1)
        summary = self.output.getvalue().split("Blocked activities (1):\n")[1]
        self.assertIn('Garmin ID: "42"', summary)
        self.assertIn("The proposed activity type is absent or ambiguous in Garmin's catalog.", summary)
        self.assertEqual(self.fake.type_writes, [])
        self.assertEqual(self.fake.writes, [])

    def test_invalid_v3_inputs_are_rejected_before_authentication(self):
        self.use_type_fixture()
        for values in ({"newActivityType": None}, {"newActivityType": "Running"},
                       {"newTitle": None}, {"newActivityType": "running"}, {"typeId": 6}):
            data = deepcopy(self.data)
            data["changes"][0].update(values)
            self.mapping.write_text(json.dumps(data))
            with self.subTest(values=values):
                self.assertEqual(self.run_cli(["review", str(self.mapping)]), 2)
        self.assertEqual(self.fake.connects, 0)

    def test_partial_combined_cli_recovery_requires_apply_flag_and_skips_completed_title(self):
        self.use_type_fixture()
        self.data["changes"][0]["newTitle"] = "Trail morning"
        self.mapping.write_text(json.dumps(self.data))
        self.fake.on_type_write = lambda _id, _type: None
        self.assertEqual(self.run_cli(["apply", str(self.mapping)]), 1)
        self.assertEqual(self.fake.writes, [("42", "Trail morning")])
        self.assertEqual(len(self.fake.type_writes), 1)
        self.mapping.unlink()
        self.assertEqual(self.run_cli(["reconcile"]), 0)
        self.assertEqual(len(self.fake.type_writes), 1)
        self.fake.on_type_write = None
        self.assertEqual(self.run_cli(["reconcile", "--apply"]), 0)
        self.assertEqual(self.fake.writes, [("42", "Trail morning")])
        self.assertEqual(len(self.fake.type_writes), 2)
