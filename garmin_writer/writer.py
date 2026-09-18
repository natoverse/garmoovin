import re
import threading
import uuid
from collections import Counter

from .garmin import GarminAdapter, GarminError
from .models import Account, ActivityType, Batch, Item, ReviewRequest, normalize_type, now, utc_time
from .storage import Journal, JournalError


class WriterError(Exception):
    pass


def candidate(path: str) -> str | None:
    if "\\" in path or any(part in ("", ".", "..") for part in path.split("/")):
        return None
    match = re.fullmatch(r"garmin-([1-9][0-9]*)\.gpx", path.split("/")[-1], re.IGNORECASE | re.ASCII)
    return match[1] if match else None


def activity_state(record: dict, item: Item) -> tuple[str, str]:
    if str(record.get("activityId")) != item.activityId:
        raise ValueError("The returned Garmin activity ID does not match the source.")
    summary = record.get("summaryDTO") or record
    type_info = record.get("activityTypeDTO") or record.get("activityType") or {}
    if not isinstance(summary, dict) or not isinstance(type_info, dict):
        raise ValueError("Garmin activity identity metadata is unavailable.")
    remote_date = summary.get("startTimeGMT")
    remote_type = type_info.get("typeKey")
    if not isinstance(remote_date, str) or not isinstance(remote_type, str) or item.proposal.date is None:
        raise ValueError("A recorded start time and activity type are required to verify identity.")
    remote_type = normalize_type(remote_type)
    allowed_types = {normalize_type(item.proposal.activityType)}
    if item.proposal.newActivityType is not None:
        allowed_types.add(item.proposal.newActivityType)
    if remote_type not in allowed_types or remote_type in ("", "unknown"):
        raise ValueError("The activity type differs from the imported GPX.")
    try:
        difference = abs((utc_time(remote_date, remote=True) - utc_time(item.proposal.date)).total_seconds())
    except ValueError as error:
        raise ValueError("The recorded start time is invalid.") from error
    if difference > 60:
        raise ValueError("The recorded start time differs by more than 60 seconds.")
    title = record.get("activityName")
    if not isinstance(title, str):
        raise ValueError("The current Garmin title is unavailable.")
    return title, remote_type


FIELDS = (
    ("title", "newTitle", "currentTitle", "observedTitle", "titleStatus"),
    ("activity type", "newActivityType", "currentActivityType", "observedActivityType", "activityTypeStatus"),
)
COMPLETED = ("confirmed", "already_applied")


def requested_fields(item: Item):
    return [field for field in FIELDS if getattr(item.proposal, field[1]) is not None]


def all_applied(item: Item) -> bool:
    return all(getattr(item, field[4]) in COMPLETED for field in requested_fields(item))


def observe(item: Item, state: tuple[str, str]) -> None:
    item.observedTitle, item.observedActivityType = state


def check_fields(item: Item) -> str:
    for name, proposed, current, observed, status in requested_fields(item):
        value, target = getattr(item, observed), getattr(item.proposal, proposed)
        if value == target:
            if getattr(item, status) not in COMPLETED:
                setattr(item, status, "already_applied")
        elif getattr(item, status) in COMPLETED:
            return f"The previously completed Garmin {name} changed. Request a new review; it will not be replayed."
        elif value != getattr(item, current):
            return f"The Garmin {name} changed after review. Request a new review."
    return ""


def resolve_type(catalog: list[dict], key: str) -> ActivityType:
    matches = [entry for entry in catalog if entry.get("typeKey") == key]
    if len(matches) != 1:
        raise ValueError("The proposed activity type is absent or ambiguous in Garmin's catalog.")
    entry = matches[0]
    try:
        resolved = ActivityType.model_validate({name: entry.get(name) for name in ("typeId", "typeKey", "parentTypeId")})
    except ValueError as error:
        raise ValueError("The proposed activity type has invalid Garmin catalog IDs.") from error
    if sum(entry.get("typeId") == resolved.typeId for entry in catalog) != 1:
        raise ValueError("The proposed activity type has an ambiguous Garmin catalog ID.")
    return resolved


class Writer:
    def __init__(self, adapter: GarminAdapter, journal: Journal):
        self.adapter = adapter
        self.journal = journal
        self.account: Account | None = None
        self.latest = journal.latest()
        self.review: Batch | None = None
        self.mutex = threading.Lock()
        self.state_lock = threading.Lock()
        self.notice = ""
        if self.latest and self.latest.needs_recovery:
            self.latest.phase = "recovery"
            self.notice = "An interrupted or uncertain operation needs reconciliation before any more writes."

    def _acquire(self) -> None:
        if not self.mutex.acquire(blocking=False):
            raise WriterError("A Garmin operation is already in progress.")

    def _account(self, expected: Account | None = None) -> Account:
        if self.account is None:
            raise GarminError("auth")
        actual = self.adapter.account()
        if actual.id != (expected or self.account).id:
            self.account = None
            self.review = None
            raise WriterError("The connected account changed. Reconnect and review again.")
        return actual

    def connect(self) -> Account:
        self._acquire()
        try:
            self.account = None
            self.review = None
            self.account = self.adapter.connect()
            self.notice = "Connected. No changes have been applied by connecting."
        finally:
            self.mutex.release()
        return self.account

    def _read(self, item: Item) -> tuple[str, str]:
        if not item.activityId or not item.proposal.date:
            raise ValueError("The activity cannot be identified without an ID and recorded start time.")
        try:
            utc_time(item.proposal.date)
        except ValueError as error:
            raise ValueError("The source timestamp must be a valid timezone-qualified date.") from error
        return activity_state(self.adapter.read(item.activityId, item.proposal.date), item)

    def _prepare(self, request: ReviewRequest, account: Account) -> Batch:
        ids = Counter(candidate(change.sourceFile) for change in request.changes)
        paths = Counter(change.sourceFile for change in request.changes)
        items = []
        paused = False
        catalog = None
        catalog_error = None
        for proposal in request.changes:
            item = Item(proposal=proposal, activityId=candidate(proposal.sourceFile))
            items.append(item)
            if proposal.sourceFile in request.duplicateSourceFiles or paths[proposal.sourceFile] > 1:
                item.status, item.reason = "blocked", "The source GPX path is duplicated."
            elif item.activityId is None:
                item.status, item.reason = "blocked", "The source filename is not a verifiable garmin-<id>.gpx path."
            elif ids[item.activityId] > 1:
                item.status, item.reason = "blocked", "More than one proposal targets the same Garmin activity."
            elif proposal.date is None or proposal.activityType.strip().casefold() in ("", "unknown"):
                item.status, item.reason = "blocked", "Recorded date and activity type are required."
            elif paused:
                item.reason = "Review paused. Reconnect or wait, then request a fresh review."
            else:
                try:
                    item.currentTitle, item.currentActivityType = self._read(item)
                    observe(item, (item.currentTitle, item.currentActivityType))
                    for _, proposed, current, _, status in requested_fields(item):
                        setattr(item, status, "already_applied" if getattr(item, current) == getattr(proposal, proposed) else "not_attempted")
                    if proposal.newActivityType is not None:
                        if catalog_error is not None:
                            raise catalog_error
                        if catalog is None:
                            try:
                                catalog = self.adapter.activity_types()
                            except GarminError as error:
                                catalog_error = error
                                raise
                        item.resolvedActivityType = resolve_type(catalog, proposal.newActivityType)
                    item.status = "already_applied" if all_applied(item) else "eligible"
                except ValueError as error:
                    item.status, item.reason = "blocked", str(error)
                except GarminError as error:
                    item.status, item.reason = "blocked", str(error)
                    if error.kind in ("auth", "rate_limit"):
                        paused = True
                        if error.kind == "auth":
                            self.account = None
        return Batch(id=uuid.uuid4().hex, createdAt=now(), archiveFingerprint=request.archiveFingerprint, account=account, items=items)

    def prepare(self, request: ReviewRequest) -> Batch:
        self._acquire()
        try:
            if self.latest and self.latest.needs_recovery:
                raise WriterError("Reconcile the uncertain journal before reviewing new changes.")
            account = self._account()
            self.adapter.begin()
            batch = self._prepare(request, account)
            self.review = batch.model_copy(deep=True)
            return batch
        finally:
            self.mutex.release()

    def _publish(self, batch: Batch) -> None:
        self.journal.write(batch)
        with self.state_lock:
            self.latest = batch.model_copy(deep=True)

    def apply(self, review_id: str) -> Batch:
        self._acquire()
        try:
            if not self.review or self.review.id != review_id:
                raise WriterError("This review is no longer valid for this writer invocation.")
            self._account(self.review.account)
            batch = self.review.model_copy(deep=True)
            if not any(item.status == "eligible" for item in batch.items):
                raise WriterError("There are no eligible changes to confirm.")
            self.review = None
            batch.phase = "running"
            for item in batch.items:
                if item.status == "eligible":
                    item.status = "not_attempted"
            self._publish(batch)
        except BaseException:
            self.mutex.release()
            raise
        self._apply(batch)
        return batch.model_copy(deep=True)

    def _write_field(self, batch: Batch, item: Item, field: tuple) -> None:
        name, proposed, _, observed, status = field
        target = getattr(item.proposal, proposed)
        # Each field is a separate non-atomic HTTP mutation. Persist its uncertainty
        # before sending, including the confirmed status of any preceding field.
        setattr(item, status, "uncertain")
        item.status, item.reason = "uncertain", f"The {name} write may be in flight; read-back has not completed."
        self._publish(batch)
        try:
            if proposed == "newTitle":
                self.adapter.rename(item.activityId, target)
            else:
                self.adapter.set_type(item.activityId, item.resolvedActivityType)
        except GarminError as error:
            if error.kind in ("not_found", "rejected"):
                setattr(item, status, "failed")
                item.status = "failed"
            raise
        observe(item, self._read(item))
        if getattr(item, observed) != target:
            item.reason = f"Read-back did not confirm the proposed {name}. Reconcile before retrying."
            return
        setattr(item, status, "confirmed")
        conflict = check_fields(item)
        if conflict:
            item.reason = f"Read-back found a conflict in another requested field. {conflict}"
            return
        item.status, item.reason = ("confirmed" if all_applied(item) else "not_attempted"), ""

    def _apply_item(self, batch: Batch, item: Item) -> None:
        if item.proposal.newActivityType is not None and item.resolvedActivityType is None:
            item.status, item.reason = "blocked", "The proposed activity type was not resolved during review."
            return
        for field in requested_fields(item):
            self._account(batch.account)
            observe(item, self._read(item))
            conflict = check_fields(item)
            if conflict:
                item.status, item.reason = "conflict", conflict
                return
            if getattr(item, field[4]) in COMPLETED:
                continue
            self._write_field(batch, item, field)
            self._publish(batch)
            if item.status in ("uncertain", "failed"):
                return
        item.status = "confirmed" if any(getattr(item, field[4]) == "confirmed" for field in requested_fields(item)) else "already_applied"
        item.reason = ""

    def _apply(self, batch: Batch) -> None:
        try:
            self.adapter.begin()
            for item in batch.items:
                if item.status != "not_attempted" or item.currentTitle is None:
                    continue
                try:
                    self._apply_item(batch, item)
                except ValueError as error:
                    if item.status != "uncertain":
                        item.status = "blocked"
                    item.reason = str(error)
                except GarminError as error:
                    if item.status != "uncertain":
                        item.status = "failed"
                    item.reason = str(error)
                    if error.kind in ("auth", "rate_limit"):
                        if error.kind == "auth":
                            self.account = None
                        batch.notice = str(error)
                        self._publish(batch)
                        break
                self._publish(batch)
                if item.status == "uncertain":
                    batch.notice = "An outcome is uncertain. Remaining writes are paused until reconciliation."
                    break
            batch.phase = "complete"
            self._publish(batch)
        except Exception as error:
            batch.phase = "recovery"
            batch.notice = str(error) if isinstance(error, (JournalError, WriterError)) else "Unexpected operation failure. No further writes were sent; reconcile before retrying."
            with self.state_lock:
                self.latest = batch.model_copy(deep=True)
                self.notice = batch.notice
        finally:
            self.mutex.release()

    def reconcile(self) -> Batch:
        self._acquire()
        try:
            if not self.latest:
                raise WriterError("There is no journal to reconcile.")
            account = self._account(self.latest.account)
            previous = self.latest.model_copy(deep=True)
            self.adapter.begin()
            request = ReviewRequest(
                archiveFingerprint=previous.archiveFingerprint,
                changes=[item.proposal for item in previous.items],
                duplicateSourceFiles=[item.proposal.sourceFile for item in previous.items if item.reason == "The source GPX path is duplicated."],
            )
            review = self._prepare(request, account)
            unresolved = False
            for old, refreshed in zip(previous.items, review.items):
                if refreshed.currentTitle is not None:
                    observe(old, (refreshed.currentTitle, refreshed.currentActivityType))
                    completed_conflict = False
                    for name, proposed, _, observed, status in requested_fields(old):
                        was_completed = getattr(old, status) in COMPLETED
                        # Legacy journals had only one item-level title outcome.
                        if proposed == "newTitle" and old.titleStatus is None and old.status in COMPLETED:
                            was_completed = True
                        if was_completed and getattr(old, observed) != getattr(old.proposal, proposed):
                            refreshed.status = "conflict"
                            refreshed.reason = f"The previously completed Garmin {name} changed. It will not be replayed."
                            completed_conflict = True
                            completion = getattr(old, status) or "confirmed"
                            setattr(old, status, completion)
                            setattr(refreshed, status, completion)
                        else:
                            setattr(old, status, getattr(refreshed, status))
                    old.status = "conflict" if completed_conflict else ("already_applied" if all_applied(old) else "not_attempted")
                    old.reason = "Reconciled by reading Garmin. Any remaining change requires a new confirmation."
                elif "uncertain" in (old.status, old.titleStatus, old.activityTypeStatus):
                    unresolved = True
                    refreshed.reason = "The prior write is still uncertain. Reconciliation must succeed before confirming."
                    refreshed.status = "blocked"
            previous.phase = "recovery" if unresolved else "complete"
            previous.notice = "Reconciliation performed no writes."
            self._publish(previous)
            if unresolved:
                raise WriterError("Some prior writes could not be reconciled. No new confirmation is available.")
            self.review = review.model_copy(deep=True)
            return review
        finally:
            self.mutex.release()
