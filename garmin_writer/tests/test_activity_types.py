import json
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch

from garmin_writer.garmin import GarminError
from garmin_writer.models import Account
from garmin_writer.storage import Journal, JournalError
from garmin_writer.tests.helpers import FakeGarmin, private_test_directory, proposal, request
from garmin_writer.writer import Writer, WriterError


def type_proposal(number=1, **overrides):
    return proposal(number, **{"newTitle": None, "newActivityType": "trail_running", **overrides})


class ActivityTypeTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(private_test_directory())
        self.journal = Journal(Path(directory.name) / "journal")
        self.fake = FakeGarmin()
        self.writer = Writer(self.fake, self.journal)
        self.writer.connect()

    def apply(self, *changes):
        review = self.writer.prepare(request(*(changes or [type_proposal()])))
        return self.writer.apply(review.id)

    def restart(self):
        writer = Writer(self.fake, self.journal)
        writer.connect()
        return writer

    def test_type_only_preserves_external_title_and_binds_reviewed_catalog_ids(self):
        self.fake.records["1"]["activityName"] = "Changed before review"
        review = self.writer.prepare(request(type_proposal()))
        item = review.items[0]
        self.assertEqual((item.currentTitle, item.currentActivityType), ("Changed before review", "hiking"))
        self.assertEqual(item.resolvedActivityType.model_dump(), self.fake.catalog[2])
        self.assertEqual(self.fake.type_writes, [])
        self.fake.records["1"]["activityName"] = "Changed after review"
        review.items[0].resolvedActivityType.typeId = 999
        self.fake.catalog[2]["typeId"] = 888
        result = self.writer.apply(review.id)
        self.assertEqual(result.items[0].status, "confirmed")
        self.assertEqual(result.items[0].observedTitle, "Changed after review")
        self.assertEqual(self.fake.writes, [])
        self.assertEqual(self.fake.type_writes[0][1]["typeId"], 6)
        self.assertEqual(self.fake.catalog_reads, 1)
        persisted = self.journal.latest().items[0]
        self.assertEqual(persisted.activityTypeStatus, "confirmed")
        self.assertIsNone(persisted.titleStatus)
        self.assertEqual(persisted.resolvedActivityType.typeId, 6)

    def test_combined_changes_are_separately_journaled_and_read_back(self):
        snapshots = []
        write = self.journal.write

        def capture(batch):
            snapshots.append(batch.model_copy(deep=True))
            write(batch)

        with patch.object(self.journal, "write", side_effect=capture):
            result = self.apply(type_proposal(newTitle="Trail outing"))
        self.assertEqual(self.fake.writes, [("1", "Trail outing")])
        self.assertEqual(len(self.fake.type_writes), 1)
        self.assertEqual(result.items[0].status, "confirmed")
        self.assertEqual((result.items[0].observedTitle, result.items[0].observedActivityType), ("Trail outing", "trail_running"))
        self.assertTrue(any(batch.items[0].titleStatus == "uncertain" and batch.items[0].activityTypeStatus == "not_attempted" for batch in snapshots))
        self.assertTrue(any(batch.items[0].titleStatus == "confirmed" and batch.items[0].activityTypeStatus == "uncertain" for batch in snapshots))
        self.assertGreaterEqual(len(self.fake.reads), 5)

    def test_already_applied_fields_are_not_replayed(self):
        self.fake.records["1"]["activityTypeDTO"]["typeKey"] = "trail_running"
        review = self.writer.prepare(request(type_proposal()))
        self.assertEqual(review.items[0].status, "already_applied")
        with self.assertRaises(WriterError):
            self.writer.apply(review.id)
        result = self.apply(type_proposal(newTitle="New title"))
        self.assertEqual(result.items[0].status, "confirmed")
        self.assertEqual(result.items[0].activityTypeStatus, "already_applied")
        self.assertEqual(self.fake.type_writes, [])
        self.fake.records["2"]["activityName"] = "Renamed 2"
        result = self.apply(type_proposal(2, newTitle="Renamed 2"))
        self.assertEqual(result.items[0].titleStatus, "already_applied")
        self.assertEqual(self.fake.writes, [("1", "New title")])
        self.assertEqual(len(self.fake.type_writes), 1)

    def test_successful_json_can_be_reviewed_again_idempotently(self):
        self.apply(type_proposal(newTitle="Trail outing"))
        review = self.writer.prepare(request(type_proposal(newTitle="Trail outing")))
        self.assertEqual(review.items[0].status, "already_applied")
        self.assertEqual((len(self.fake.writes), len(self.fake.type_writes)), (1, 1))

    def test_title_only_still_requires_original_type_and_skips_catalog(self):
        self.fake.records["1"]["activityTypeDTO"]["typeKey"] = "trail_running"
        review = self.writer.prepare(request(proposal()))
        self.assertEqual(review.items[0].status, "blocked")
        self.assertEqual(self.fake.catalog_reads, 0)
        self.assertEqual(self.fake.writes, [])

    def test_type_edit_retains_id_start_and_unrelated_type_identity_guards(self):
        for mutation in (
            lambda record: record.update(activityId=99),
            lambda record: record["summaryDTO"].update(startTimeGMT="2025-01-02T10:00:00"),
            lambda record: record["activityTypeDTO"].update(typeKey="cycling"),
        ):
            original = deepcopy(self.fake.records["1"])
            mutation(self.fake.records["1"])
            self.assertEqual(self.writer.prepare(request(type_proposal())).items[0].status, "blocked")
            self.fake.records["1"] = original
        self.assertEqual(self.fake.type_writes, [])

    def test_missing_ambiguous_and_malformed_catalog_entries_block_review(self):
        valid = deepcopy(self.fake.catalog[2])
        cases = [
            [], [valid, valid],
            [valid, {**valid, "typeKey": "another_type"}],
            [{**valid, "typeId": "6"}], [{**valid, "typeId": True}], [{**valid, "typeId": 0}],
            [{**valid, "parentTypeId": None}], [{**valid, "parentTypeId": -1}],
            [{**valid, "parentTypeId": 1.0}], [{**valid, "typeKey": "TRAIL_RUNNING"}],
        ]
        for catalog in cases:
            with self.subTest(catalog=catalog):
                self.fake.catalog = catalog
                review = self.writer.prepare(request(type_proposal()))
                self.assertEqual(review.items[0].status, "blocked")
                self.assertIsNone(review.items[0].resolvedActivityType)
        self.assertEqual(self.fake.type_writes, [])

    def test_catalog_fetched_once_per_review_and_errors_pause_safely(self):
        review = self.writer.prepare(request(type_proposal(), type_proposal(2)))
        self.assertTrue(all(item.status == "eligible" for item in review.items))
        self.assertEqual(self.fake.catalog_reads, 1)
        for kind in ("unavailable", "rate_limit", "auth"):
            self.writer.connect()
            with patch.object(self.fake, "activity_types", side_effect=GarminError(kind)) as catalog:
                review = self.writer.prepare(request(type_proposal(), type_proposal(2), proposal(3)))
            self.assertNotEqual(review.items[0].status, "eligible")
            self.assertNotEqual(review.items[1].status, "eligible")
            self.assertEqual(catalog.call_count, 1)
            if kind == "unavailable":
                self.assertEqual(review.items[2].status, "eligible")
            else:
                self.assertNotEqual(review.items[2].status, "eligible")

    def test_prewrite_unrelated_type_or_requested_title_changes_block_mutations(self):
        for key in ("title", "type"):
            review = self.writer.prepare(request(type_proposal(newTitle="New title")))
            if key == "title":
                self.fake.records["1"]["activityName"] = "External edit"
            else:
                self.fake.records["1"]["activityTypeDTO"]["typeKey"] = "cycling"
            result = self.writer.apply(review.id)
            self.assertIn(result.items[0].status, ("conflict", "blocked"))
            self.fake.records["1"]["activityName"] = "Original 1"
        self.assertEqual(self.fake.writes, [])
        self.assertEqual(self.fake.type_writes, [])

    def test_prewrite_proposed_type_is_idempotent_but_reverted_completed_type_conflicts(self):
        review = self.writer.prepare(request(type_proposal()))
        self.fake.records["1"]["activityTypeDTO"]["typeKey"] = "trail_running"
        self.assertEqual(self.writer.apply(review.id).items[0].status, "already_applied")
        review = self.writer.prepare(request(type_proposal(newTitle="New title")))
        self.fake.records["1"]["activityTypeDTO"]["typeKey"] = "hiking"
        result = self.writer.apply(review.id)
        self.assertEqual(result.items[0].status, "conflict")
        self.assertEqual(self.fake.writes, [])
        self.assertEqual(self.fake.type_writes, [])

    def test_second_mutation_rechecks_both_requested_fields_and_account(self):
        for change in ("title", "type", "account"):
            fake = FakeGarmin()
            writer = Writer(fake, Journal(self.journal.directory / change))
            writer.connect()

            def external_change(_id, _date):
                if len(fake.reads) == 4:
                    if change == "title":
                        fake.records["1"]["activityName"] = "Changed between writes"
                    elif change == "type":
                        fake.records["1"]["activityTypeDTO"]["typeKey"] = "cycling"

            fake.on_read = external_change
            review = writer.prepare(request(type_proposal(newTitle="New title")))
            if change == "account":
                def switch_account(activity_id, title):
                    fake.records[activity_id]["activityName"] = title
                    fake.identity = Account(id="account-b", name="Other account")
                fake.on_write = switch_account
            result = writer.apply(review.id)
            self.assertEqual(fake.writes, [("1", "New title")])
            self.assertEqual(fake.type_writes, [])
            self.assertEqual(result.items[0].titleStatus, "confirmed")
            self.assertNotEqual(result.items[0].status, "confirmed")

    def test_type_readback_mismatch_pauses_remaining_and_needs_confirmation(self):
        self.fake.on_type_write = lambda _id, _type: None
        result = self.apply(type_proposal(), type_proposal(2))
        self.assertEqual([item.status for item in result.items], ["uncertain", "not_attempted"])
        self.assertEqual(result.items[0].activityTypeStatus, "uncertain")
        self.assertTrue(result.needs_recovery)
        self.fake.on_type_write = None
        restored = self.restart()
        review = restored.reconcile()
        self.assertEqual([item.status for item in review.items], ["eligible", "eligible"])
        self.assertEqual(len(self.fake.type_writes), 1)
        restored.apply(review.id)
        self.assertEqual(len(self.fake.type_writes), 3)

    def test_combined_readback_checks_previously_confirmed_title(self):
        def wrong_title(activity_id, activity_type):
            self.fake.records[activity_id]["activityTypeDTO"] = activity_type.model_dump()
            self.fake.records[activity_id]["activityName"] = "Externally edited title"

        self.fake.on_type_write = wrong_title
        result = self.apply(type_proposal(newTitle="New title"))
        self.assertEqual(result.items[0].status, "uncertain")
        self.assertEqual(result.items[0].activityTypeStatus, "confirmed")
        review = self.restart().reconcile()
        self.assertEqual(review.items[0].status, "conflict")
        self.assertEqual(self.fake.writes, [("1", "New title")])

    def test_lost_type_response_reconciles_success_without_replaying_either_field(self):
        def lose_response(activity_id, activity_type):
            self.fake.records[activity_id]["activityTypeDTO"] = activity_type.model_dump()
            raise GarminError("unavailable")

        self.fake.on_type_write = lose_response
        result = self.apply(type_proposal(newTitle="New title"), type_proposal(2))
        self.assertEqual([item.status for item in result.items], ["uncertain", "not_attempted"])
        self.assertEqual(result.items[0].titleStatus, "confirmed")
        restored = self.restart()
        review = restored.reconcile()
        self.assertEqual([item.status for item in review.items], ["already_applied", "eligible"])
        self.assertEqual((len(self.fake.writes), len(self.fake.type_writes)), (1, 1))
        self.fake.on_type_write = None
        restored.apply(review.id)
        self.assertEqual(self.fake.writes, [("1", "New title")])
        self.assertEqual([activity_id for activity_id, _ in self.fake.type_writes], ["1", "2"])

    def test_partial_recovery_only_sends_remaining_type_after_confirmation(self):
        def reject(_id, _type):
            raise GarminError("rejected")

        self.fake.on_type_write = reject
        result = self.apply(type_proposal(newTitle="New title"))
        self.assertEqual(result.items[0].status, "failed")
        self.assertEqual(result.items[0].titleStatus, "confirmed")
        self.assertEqual(result.items[0].activityTypeStatus, "failed")
        restored = self.restart()
        review = restored.reconcile()
        self.assertEqual(review.items[0].status, "eligible")
        self.assertEqual(review.items[0].titleStatus, "already_applied")
        self.assertEqual(len(self.fake.type_writes), 1)
        self.fake.on_type_write = None
        result = restored.apply(review.id)
        self.assertEqual(result.items[0].status, "confirmed")
        self.assertEqual(self.fake.writes, [("1", "New title")])
        self.assertEqual(len(self.fake.type_writes), 2)

    def test_partial_recovery_never_replays_completed_field_changed_externally(self):
        self.fake.on_type_write = lambda _id, _type: None
        self.apply(type_proposal(newTitle="New title"))
        self.fake.records["1"]["activityName"] = "Later external edit"
        restored = self.restart()
        for _ in range(2):
            review = restored.reconcile()
            self.assertEqual(review.items[0].status, "conflict")
            with self.assertRaises(WriterError):
                restored.apply(review.id)
        self.assertEqual(self.fake.writes, [("1", "New title")])
        self.assertEqual(len(self.fake.type_writes), 1)

    def test_type_readback_error_remains_uncertain_until_identity_read_succeeds(self):
        def missing(_id, _date):
            if self.fake.type_writes:
                raise GarminError("not_found")

        self.fake.on_read = missing
        result = self.apply()
        self.assertEqual(result.items[0].status, "uncertain")
        restored = self.restart()
        with self.assertRaises(WriterError):
            restored.reconcile()
        self.fake.on_read = None
        self.assertEqual(restored.reconcile().items[0].status, "already_applied")
        self.assertEqual(len(self.fake.type_writes), 1)

    def test_partial_type_authentication_and_rate_limit_pause_remaining(self):
        for kind in ("auth", "rate_limit"):
            fake = FakeGarmin()
            writer = Writer(fake, Journal(self.journal.directory / kind))
            writer.connect()

            def fail(_id, _type):
                raise GarminError(kind)

            fake.on_type_write = fail
            review = writer.prepare(request(type_proposal(newTitle="New title"), type_proposal(2)))
            result = writer.apply(review.id)
            self.assertEqual([item.status for item in result.items], ["uncertain", "not_attempted"])
            self.assertEqual(result.items[0].titleStatus, "confirmed")
            self.assertEqual(len(fake.type_writes), 1)
            if kind == "auth":
                self.assertIsNone(writer.account)

    def test_interrupted_first_mutation_preserves_durable_uncertainty_and_partial_recovery(self):
        def interrupt(activity_id, title):
            self.fake.records[activity_id]["activityName"] = title
            raise KeyboardInterrupt

        self.fake.on_write = interrupt
        with self.assertRaises(KeyboardInterrupt):
            self.apply(type_proposal(newTitle="New title"))
        durable = self.journal.latest()
        self.assertEqual(durable.items[0].titleStatus, "uncertain")
        self.assertEqual(durable.items[0].activityTypeStatus, "not_attempted")
        restored = self.restart()
        review = restored.reconcile()
        self.assertEqual(review.items[0].status, "eligible")
        self.assertEqual(self.fake.type_writes, [])
        self.fake.on_write = None
        restored.apply(review.id)
        self.assertEqual(self.fake.writes, [("1", "New title")])
        self.assertEqual(len(self.fake.type_writes), 1)

    def test_interrupted_type_mutation_is_not_replayed_after_success(self):
        def interrupt(activity_id, activity_type):
            self.fake.records[activity_id]["activityTypeDTO"] = activity_type.model_dump()
            raise KeyboardInterrupt

        self.fake.on_type_write = interrupt
        with self.assertRaises(KeyboardInterrupt):
            self.apply(type_proposal(newTitle="New title"))
        self.assertEqual(self.journal.latest().items[0].activityTypeStatus, "uncertain")
        self.assertEqual(self.restart().reconcile().items[0].status, "already_applied")
        self.assertEqual((len(self.fake.writes), len(self.fake.type_writes)), (1, 1))

    def test_journal_failure_before_second_write_blocks_it_and_preserves_first_completion(self):
        save = self.journal.write

        def fail(batch):
            if batch.items[0].activityTypeStatus == "uncertain":
                raise JournalError("Cannot persist the second mutation.")
            save(batch)

        with patch.object(self.journal, "write", side_effect=fail):
            result = self.apply(type_proposal(newTitle="New title"))
        self.assertTrue(result.needs_recovery)
        self.assertEqual(self.fake.writes, [("1", "New title")])
        self.assertEqual(self.fake.type_writes, [])
        self.assertEqual(self.journal.latest().items[0].titleStatus, "confirmed")
        restored = self.restart()
        restored.apply(restored.reconcile().id)
        self.assertEqual(self.fake.writes, [("1", "New title")])
        self.assertEqual(len(self.fake.type_writes), 1)

    def test_legacy_title_only_journals_reconcile_without_new_fields(self):
        review = self.writer.prepare(request(proposal(), proposal(2)))
        review.phase = "running"
        review.items[0].status = "uncertain"
        review.items[1].status = "not_attempted"
        self.fake.records["1"]["activityName"] = "Renamed 1"
        data = review.model_dump()
        for item in data["items"]:
            for key in ("currentActivityType", "observedActivityType", "resolvedActivityType", "titleStatus", "activityTypeStatus"):
                del item[key]
            del item["proposal"]["newActivityType"]
        path = self.journal.directory / f"{review.id}.json"
        path.write_text(json.dumps(data))
        path.chmod(0o600)
        restored = self.restart()
        review = restored.reconcile()
        self.assertEqual([item.status for item in review.items], ["already_applied", "eligible"])
        restored.apply(review.id)
        self.assertEqual(self.fake.writes, [("2", "Renamed 2")])
        self.assertEqual(self.fake.catalog_reads, 0)
        self.assertEqual(self.fake.type_writes, [])

    def test_legacy_completed_title_remains_protected_across_repeated_reconciliation(self):
        review = self.writer.prepare(request(proposal()))
        review.phase = "complete"
        review.items[0].status = "confirmed"
        data = review.model_dump()
        item = data["items"][0]
        for key in ("currentActivityType", "observedActivityType", "resolvedActivityType", "titleStatus", "activityTypeStatus"):
            del item[key]
        del item["proposal"]["newActivityType"]
        path = self.journal.directory / f"{review.id}.json"
        path.write_text(json.dumps(data))
        path.chmod(0o600)
        self.fake.records["1"]["activityName"] = "Externally changed after completion"
        for _ in range(2):
            restored = self.restart()
            refreshed = restored.reconcile()
            self.assertEqual(refreshed.items[0].status, "conflict")
            with self.assertRaises(WriterError):
                restored.apply(refreshed.id)
        self.assertEqual(self.fake.writes, [])

    def test_reconciliation_can_read_outcome_when_catalog_is_unavailable_but_cannot_write(self):
        def lost_reply(activity_id, activity_type):
            self.fake.records[activity_id]["activityTypeDTO"] = activity_type.model_dump()
            raise GarminError("unavailable")

        self.fake.on_type_write = lost_reply
        self.apply()
        restored = self.restart()
        with patch.object(self.fake, "activity_types", side_effect=GarminError("unavailable")):
            review = restored.reconcile()
        self.assertEqual(review.items[0].status, "blocked")
        self.assertFalse(restored.latest.needs_recovery)
        with self.assertRaises(WriterError):
            restored.apply(review.id)
        self.assertEqual(len(self.fake.type_writes), 1)

    def test_successful_type_write_followed_by_journal_failure_recovers_without_replay(self):
        save = self.journal.write

        def fail(batch):
            if batch.items[0].activityTypeStatus == "confirmed":
                raise JournalError("Cannot persist confirmed outcome.")
            save(batch)

        with patch.object(self.journal, "write", side_effect=fail):
            result = self.apply(type_proposal(newTitle="New title"))
        self.assertTrue(result.needs_recovery)
        self.assertEqual(self.journal.latest().items[0].activityTypeStatus, "uncertain")
        self.assertEqual(self.restart().reconcile().items[0].status, "already_applied")
        self.assertEqual((len(self.fake.writes), len(self.fake.type_writes)), (1, 1))
