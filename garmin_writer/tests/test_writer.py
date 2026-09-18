import os
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from garmin_writer.garmin import GarminError
from garmin_writer.models import Account
from garmin_writer.writer import Writer, WriterError
from garmin_writer.storage import Journal, JournalError, private_directory, storage_lock
from garmin_writer.tests.helpers import FakeGarmin, private_test_directory, proposal, request


class WriterTests(unittest.TestCase):
    def setUp(self):
        self.temp = self.enterContext(private_test_directory())
        self.journal = Journal(Path(self.temp.name).resolve() / "journal")
        self.fake = FakeGarmin()
        self.service = Writer(self.fake, self.journal)
        self.service.connect()

    def tearDown(self):
        self.temp.cleanup()

    def apply(self, review):
        return self.service.apply(review.id)

    def test_review_reads_only_and_confirmation_uses_immutable_snapshot(self):
        review = self.service.prepare(request())
        self.assertEqual(self.fake.writes, [])
        self.assertEqual(review.items[0].status, "eligible")
        review.items[0].proposal.newTitle = "Tampered returned object"
        batch = self.apply(review)
        self.assertEqual(self.fake.writes, [("1", "Renamed 1")])
        self.assertEqual(batch.items[0].status, "confirmed")
        self.assertEqual(self.journal.latest().items[0].status, "confirmed")
        with self.assertRaises(WriterError):
            self.service.apply(review.id)

    def test_wrong_review_and_changed_account_cannot_confirm(self):
        review = self.service.prepare(request())
        with self.assertRaises(WriterError):
            self.service.apply("b" * 32)
        self.fake.identity = Account(id="account-b", name="Other account")
        with self.assertRaises(WriterError):
            self.service.apply(review.id)
        self.assertEqual(self.fake.writes, [])
        self.assertIsNone(self.service.account)

    def test_identity_checks_block_missing_conflicting_or_ambiguous_evidence(self):
        cases = [
            proposal(sourceFile="activity.gpx"), proposal(sourceFile="../garmin-1.gpx"),
            proposal(date=None), proposal(activityType="Unknown"), proposal(activityType="Running"),
            proposal(date="2025-01-01T10:01:01Z"), proposal(date="2025-01-01T10:00:00"),
            proposal(99),
        ]
        for item in cases:
            with self.subTest(item=item.sourceId):
                result = self.service.prepare(request(item))
                self.assertEqual(result.items[0].status, "blocked")
        result = self.service.prepare(request(proposal(), proposal(2, sourceFile="nested/garmin-1.gpx")))
        self.assertTrue(all(item.status == "blocked" for item in result.items))
        duplicate = request(proposal())
        duplicate.duplicateSourceFiles = ["garmin-1.gpx"]
        self.assertEqual(self.service.prepare(duplicate).items[0].status, "blocked")
        self.assertEqual(self.fake.writes, [])

    def test_sixty_second_tolerance_and_root_metadata_shape(self):
        self.fake.records["1"] = {
            "activityId": 1, "activityName": "Remote title",
            "startTimeGMT": "2025-01-01T10:00:00", "activityType": {"typeKey": "hiking"},
        }
        result = self.service.prepare(request(proposal(date="2025-01-01T10:01:00Z")))
        self.assertEqual(result.items[0].status, "eligible")
        self.assertEqual(result.items[0].currentTitle, "Remote title")
        self.fake.records["1"]["activityId"] = 2
        self.assertEqual(self.service.prepare(request()).items[0].status, "blocked")

    def test_prewrite_conflict_and_already_applied_do_not_write(self):
        review = self.service.prepare(request(proposal(), proposal(2)))
        self.fake.records["1"]["activityName"] = "Edited elsewhere"
        self.fake.records["2"]["activityName"] = "Renamed 2"
        batch = self.apply(review)
        self.assertEqual([item.status for item in batch.items], ["conflict", "already_applied"])
        self.assertEqual(self.fake.writes, [])

    def test_journal_failure_before_batch_or_write_sends_no_mutation(self):
        for fail_at in (1, 2):
            review = self.service.prepare(request())
            original = self.journal.write
            calls = 0

            def fail(batch):
                nonlocal calls
                calls += 1
                if calls == fail_at:
                    raise JournalError("Synthetic journal failure.")
                original(batch)

            with patch.object(self.journal, "write", side_effect=fail):
                if fail_at == 1:
                    with self.assertRaises(JournalError):
                        self.service.apply(review.id)
                else:
                    self.apply(review)
            self.assertEqual(self.fake.writes, [])

    def test_uncertain_write_reconciles_without_replaying_and_requires_confirmation(self):
        def lost_reply(activity_id, title):
            self.fake.records[activity_id]["activityName"] = title
            raise GarminError("unavailable")
        self.fake.on_write = lost_reply
        batch = self.apply(self.service.prepare(request(proposal(), proposal(2))))
        self.assertEqual([item.status for item in batch.items], ["uncertain", "not_attempted"])
        with self.assertRaises(WriterError):
            self.service.prepare(request())
        restored = Writer(self.fake, self.journal)
        restored.connect()
        review = restored.reconcile()
        self.assertEqual([item.status for item in review.items], ["already_applied", "eligible"])
        self.assertEqual(len(self.fake.writes), 1)
        self.fake.on_write = None
        restored.apply(review.id)
        self.assertEqual(self.fake.writes, [("1", "Renamed 1"), ("2", "Renamed 2")])
        self.assertFalse(restored.latest.needs_recovery)

    def test_failed_readback_remains_uncertain_even_after_not_found(self):
        def fail_read(activity_id, _date):
            if self.fake.writes:
                raise GarminError("not_found")
        self.fake.on_read = fail_read
        result = self.apply(self.service.prepare(request()))
        self.assertEqual(result.items[0].status, "uncertain")
        with self.assertRaises(WriterError):
            self.service.reconcile()
        self.assertTrue(self.service.latest.needs_recovery)

    def test_rate_limit_and_auth_pause_remaining_changes(self):
        for kind in ("rate_limit", "auth"):
            with self.subTest(kind=kind):
                temp = Journal(Path(self.temp.name).resolve() / kind)
                fake = FakeGarmin()
                service = Writer(fake, temp)
                service.connect()
                def reject(_id, _title):
                    raise GarminError(kind)
                fake.on_write = reject
                review = service.prepare(request(proposal(), proposal(2)))
                service.apply(review.id)
                self.assertEqual(len(fake.writes), 1)
                self.assertEqual(service.latest.items[1].status, "not_attempted")
                self.assertEqual(service.latest.items[0].status, "uncertain")
                if kind == "auth":
                    self.assertIsNone(service.account)

    def test_definite_rejection_after_prior_success_does_not_become_uncertain(self):
        def rename(activity_id, title):
            if activity_id == "2":
                raise GarminError("rejected")
            self.fake.records[activity_id]["activityName"] = title
        self.fake.on_write = rename
        batch = self.apply(self.service.prepare(request(proposal(), proposal(2), proposal(3))))
        self.assertEqual([item.status for item in batch.items], ["confirmed", "failed", "confirmed"])

    def test_overlapping_operations_are_rejected(self):
        entered, release = threading.Event(), threading.Event()
        def wait(_id, _title):
            entered.set()
            release.wait(3)
        self.fake.on_write = wait
        review = self.service.prepare(request())
        worker = threading.Thread(target=self.service.apply, args=(review.id,))
        worker.start()
        self.assertTrue(entered.wait(2))
        try:
            with self.assertRaises(WriterError):
                self.service.apply(review.id)
            with self.assertRaises(WriterError):
                self.service.connect()
            with self.assertRaises(WriterError):
                self.service.prepare(request())
        finally:
            release.set()
            worker.join(3)
            self.assertFalse(worker.is_alive())

    def test_journal_permissions_and_corruption_are_explicit(self):
        self.apply(self.service.prepare(request()))
        path = next(self.journal.directory.glob("*.json"))
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.journal.directory.stat().st_mode & 0o777, 0o700)
        path.write_text("not JSON")
        with self.assertRaises(JournalError):
            Writer(self.fake, self.journal)
        link = Path(self.temp.name).resolve() / "link"
        link.symlink_to(self.journal.directory, target_is_directory=True)
        with self.assertRaises(ValueError):
            private_directory(link)

    def test_storage_lock_blocks_a_second_writer(self):
        with storage_lock(self.journal.directory):
            with self.assertRaises(JournalError):
                with storage_lock(self.journal.directory):
                    self.fail("The same private storage was acquired twice")

    def test_journal_failure_after_remote_write_keeps_durable_uncertainty(self):
        review = self.service.prepare(request())
        write = self.journal.write
        calls = 0
        def fail_after_write(batch):
            nonlocal calls
            calls += 1
            if calls == 3:
                raise JournalError("Synthetic journal failure after read-back.")
            write(batch)
        with patch.object(self.journal, "write", side_effect=fail_after_write):
            self.service.apply(review.id)
        self.assertEqual(self.journal.latest().items[0].status, "uncertain")
        restored = Writer(self.fake, self.journal)
        restored.connect()
        result = restored.reconcile()
        self.assertEqual(result.items[0].status, "already_applied")
        self.assertEqual(self.fake.writes, [("1", "Renamed 1")])
