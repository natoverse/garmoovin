import json
import unittest
from copy import deepcopy
from pathlib import Path

from pydantic import ValidationError

from garmin_writer.mapping import MappingError, load_mapping
from garmin_writer.tests.helpers import private_test_directory


FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"


class MappingTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(private_test_directory())
        self.path = Path(directory.name) / "mapping.json"
        self.data = json.loads((FIXTURES / "activity-mapping-v3.json").read_text())

    def load(self, data):
        self.path.write_text(json.dumps(data))
        return load_mapping(self.path)

    def test_shared_type_only_fixture_preserves_identity_and_omits_rename(self):
        mapping = self.load(self.data)
        change = mapping.proposals().changes[0]
        self.assertEqual(mapping.schemaVersion, 3)
        self.assertEqual(mapping.archiveFingerprint, "a" * 64)
        self.assertEqual(change.sourceFile, "garmin-42.gpx")
        self.assertEqual(change.date, "2025-01-02T00:00:00.000Z")
        self.assertEqual(change.activityType, "Running")
        self.assertEqual(change.originalTitle, "Morning run")
        self.assertEqual(change.newActivityType, "trail_running")
        self.assertIsNone(change.newTitle)
        self.assertNotIn("newTitle", self.data["changes"][0])

    def test_v3_accepts_mixed_title_type_and_combined_changes(self):
        original = self.data["changes"][0]
        title_only = {**original, "sourceFile": "nested/garmin-43.gpx", "garminActivityId": "43", "newTitle": "New title"}
        del title_only["newActivityType"]
        combined = {**original, "sourceFile": "garmin-44.gpx", "garminActivityId": "44", "newTitle": "Trail run"}
        self.data["changes"] += [title_only, combined]
        changes = self.load(self.data).proposals().changes
        self.assertEqual([change.newTitle for change in changes], [None, "New title", "Trail run"])
        self.assertEqual([change.newActivityType for change in changes], ["trail_running", None, "trail_running"])

    def test_v2_remains_strict_title_only(self):
        data = json.loads((FIXTURES / "title-mapping-v2.json").read_text())
        self.assertEqual(self.load(data).schemaVersion, 2)
        self.assertIsNone(self.load(data).proposals().changes[0].newActivityType)
        for addition in ("trail_running", None):
            altered = deepcopy(data)
            altered["changes"][0]["newActivityType"] = addition
            with self.subTest(addition=addition), self.assertRaises(ValidationError):
                self.load(altered)
        del data["changes"][0]["newTitle"]
        with self.assertRaises(ValidationError):
            self.load(data)

    def test_unknown_or_noninteger_schema_versions_are_rejected(self):
        for version in (None, True, False, 1, 4, "3", 2.0, 3.0):
            with self.subTest(version=version), self.assertRaises(MappingError):
                self.load({**self.data, "schemaVersion": version})

    def test_type_keys_are_canonical_changed_nonnull_strings(self):
        for value in (None, "", " ", "unknown", "Unknown", "running", "Running", "trail-running",
                      "trail running", "trail_running ", "_running", "3running", "rúnning",
                      "trail_running\n", 6, True, [], {}):
            data = deepcopy(self.data)
            data["changes"][0]["newActivityType"] = value
            with self.subTest(value=value), self.assertRaises(ValidationError):
                self.load(data)
        for original in ("Trail Running", " trail-running ", "TRAIL__RUNNING"):
            data = deepcopy(self.data)
            data["changes"][0]["activityType"] = original
            with self.subTest(original=original), self.assertRaises(ValidationError):
                self.load(data)

    def test_omitted_unchanged_fields_and_at_least_one_effective_change(self):
        for title in (None, "", " ", "Morning run", " New title", "New title ", 123, True):
            data = deepcopy(self.data)
            data["changes"][0]["newTitle"] = title
            with self.subTest(title=title), self.assertRaises(ValidationError):
                self.load(data)
        del self.data["changes"][0]["newActivityType"]
        with self.assertRaises(ValidationError):
            self.load(self.data)

    def test_v3_retains_required_identity_and_duplicate_target_checks(self):
        for key in ("sourceFile", "garminActivityId", "recordedStartTime", "activityType", "originalTitle"):
            for missing in (True, False):
                data = deepcopy(self.data)
                if missing:
                    del data["changes"][0][key]
                else:
                    data["changes"][0][key] = None
                with self.subTest(key=key, missing=missing), self.assertRaises(ValidationError):
                    self.load(data)
        for values in (
            {"typeId": 6}, {"garminActivityId": "43"}, {"sourceFile": "../garmin-42.gpx"},
            {"recordedStartTime": "2025-01-02T00:00:00Z"}, {"activityType": "Unknown"},
        ):
            data = deepcopy(self.data)
            data["changes"][0].update(values)
            with self.subTest(values=values), self.assertRaises(ValidationError):
                self.load(data)
        self.data["changes"].append({**self.data["changes"][0], "sourceFile": "nested/garmin-42.gpx"})
        with self.assertRaises(ValidationError):
            self.load(self.data)

    def test_v3_rejects_duplicate_json_fields(self):
        self.path.write_text(json.dumps(self.data).replace('"newActivityType":', '"newActivityType": "running", "newActivityType":'))
        with self.assertRaises(MappingError):
            load_mapping(self.path)
