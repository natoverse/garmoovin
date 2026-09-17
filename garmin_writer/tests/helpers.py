from copy import deepcopy

from garmin_writer.garmin import GarminError
from garmin_writer.models import Account, Proposal, ReviewRequest


class FakeGarmin:
    def __init__(self):
        self.identity = Account(id="account-a", name="Synthetic Account")
        self.records = {
            str(i): {
                "activityId": i, "activityName": f"Original {i}",
                "summaryDTO": {"startTimeGMT": "2025-01-01T10:00:00"},
                "activityTypeDTO": {"typeKey": "hiking"},
            } for i in range(1, 5)
        }
        self.writes = []
        self.reads = []
        self.on_read = None
        self.on_write = None
        self.connects = 0

    def connect(self):
        self.connects += 1
        return self.identity.model_copy()

    def account(self):
        return self.identity.model_copy()

    def begin(self):
        pass

    def read(self, activity_id, date):
        self.reads.append(activity_id)
        if self.on_read:
            self.on_read(activity_id, date)
        if activity_id not in self.records:
            raise GarminError("not_found")
        return deepcopy(self.records[activity_id])

    def rename(self, activity_id, title):
        self.writes.append((activity_id, title))
        if self.on_write:
            self.on_write(activity_id, title)
        else:
            self.records[activity_id]["activityName"] = title


def proposal(number=1, **overrides):
    values = {
        "sourceId": str(number), "sourceFile": f"garmin-{number}.gpx",
        "originalTitle": f"Original {number}", "newTitle": f"Renamed {number}",
        "date": "2025-01-01T10:00:00Z", "activityType": "Hiking",
    }
    return Proposal(**{**values, **overrides})


def request(*items):
    return ReviewRequest(archiveFingerprint="a" * 64, changes=list(items or [proposal()]))
