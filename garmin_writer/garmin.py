import logging
import os
from datetime import timedelta
from pathlib import Path

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectTooManyRequestsError,
)
from garminconnect.client import token_file_path

from .models import Account, ActivityType, utc_time


class GarminError(Exception):
    def __init__(self, kind: str):
        self.kind = kind
        super().__init__({
            "auth": "Garmin authentication is required. Run python -m garmin_writer login, then review again.",
            "rate_limit": "Garmin rate-limited this request. Wait before reconnecting or reviewing the remaining changes.",
            "not_found": "This activity is not accessible in the connected Garmin account.",
            "rejected": "Garmin rejected the request. Review the activity and proposed changes before trying again.",
            "unavailable": "Garmin could not be reached or returned an unexpected response.",
        }[kind])


def translate(error: Exception) -> GarminError:
    status = getattr(getattr(error, "response", None), "status_code", None)
    if isinstance(error, GarminConnectAuthenticationError) or status in (401, 403):
        return GarminError("auth")
    if isinstance(error, GarminConnectTooManyRequestsError) or status == 429:
        return GarminError("rate_limit")
    if status == 404:
        return GarminError("not_found")
    if isinstance(status, int) and 400 <= status < 500:
        return GarminError("rejected")
    return GarminError("unavailable")


class GarminAdapter:
    def __init__(self, directory: Path):
        self.directory = directory
        self.api: Garmin | None = None
        self.owned: dict[str, set[str]] = {}
        logging.getLogger("garminconnect").setLevel(logging.CRITICAL)

    def call(self, action):
        try:
            return action()
        except Exception as error:
            raise translate(error) from error

    def connect(self) -> Account:
        path = token_file_path(str(self.directory))
        if not path.is_file() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
            raise GarminError("auth")
        self.api = Garmin(retry_attempts=0)
        try:
            self.call(lambda: self.api.login(str(self.directory)))
            account = self.account()
            self.api.client.dump(str(self.directory))
        except Exception:
            self.api = None
            raise
        return account

    def account(self) -> Account:
        if self.api is None:
            raise GarminError("auth")
        profile = self.call(lambda: self.api.client.connectapi("/userprofile-service/socialProfile"))
        if not isinstance(profile, dict) or not isinstance(profile.get("displayName"), str) or not profile["displayName"]:
            raise GarminError("auth")
        if profile.get("fullName") is not None and not isinstance(profile["fullName"], str):
            raise GarminError("unavailable")
        return Account(id=profile["displayName"], name=profile.get("fullName") or profile["displayName"])

    def begin(self) -> None:
        self.owned.clear()

    def read(self, activity_id: str, date: str) -> dict:
        if self.api is None:
            raise GarminError("auth")
        timestamp = utc_time(date)
        day = timestamp.date().isoformat()
        if day not in self.owned:
            # Garmin's list uses local dates. A three-day window covers UTC offsets;
            # only exact ID membership is used, never nearest-date matching.
            records = self.call(lambda: self.api.get_activities_by_date(
                (timestamp.date() - timedelta(days=1)).isoformat(),
                (timestamp.date() + timedelta(days=1)).isoformat(),
            ))
            if not isinstance(records, list) or any(not isinstance(record, dict) for record in records):
                raise GarminError("unavailable")
            self.owned[day] = {str(record.get("activityId")) for record in records}
        if activity_id not in self.owned[day]:
            raise GarminError("not_found")
        result = self.call(lambda: self.api.get_activity(activity_id))
        if not isinstance(result, dict):
            raise GarminError("unavailable")
        return result

    def rename(self, activity_id: str, title: str) -> None:
        if self.api is None:
            raise GarminError("auth")
        self.call(lambda: self.api.set_activity_name(activity_id, title))

    def activity_types(self) -> list[dict]:
        if self.api is None:
            raise GarminError("auth")
        result = self.call(lambda: self.api.get_activity_types())
        if not isinstance(result, list) or any(not isinstance(entry, dict) for entry in result):
            raise GarminError("unavailable")
        return result

    def set_type(self, activity_id: str, activity_type: ActivityType) -> None:
        if self.api is None:
            raise GarminError("auth")
        self.call(lambda: self.api.set_activity_type(
            activity_id, activity_type.typeId, activity_type.typeKey, activity_type.parentTypeId,
        ))
