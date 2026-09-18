import json
import re
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator, model_validator

from .models import Model, Proposal, ReviewRequest, normalize_type, utc_time, validate_type_key
from .writer import candidate


class MappingError(ValueError):
    pass


class MappingIdentity(Model):
    sourceFile: str
    garminActivityId: str = Field(pattern=r"^[1-9][0-9]*$")
    recordedStartTime: str
    activityType: str
    originalTitle: str

    @field_validator("recordedStartTime")
    @classmethod
    def recorded_time(cls, value: str) -> str:
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", value):
            raise ValueError("A UTC ISO timestamp with milliseconds is required.")
        utc_time(value)
        return value

    @model_validator(mode="after")
    def identity(self):
        if candidate(self.sourceFile) != self.garminActivityId:
            raise ValueError("The candidate activity ID must match the source filename.")
        if not self.activityType.strip() or self.activityType.strip().casefold() == "unknown":
            raise ValueError("A known activity type is required.")
        return self


class MappingChange(MappingIdentity):
    newTitle: str

    @model_validator(mode="after")
    def changed_title(self):
        if not self.newTitle.strip() or self.newTitle != self.newTitle.strip() or self.newTitle == self.originalTitle:
            raise ValueError("A trimmed, changed, nonempty title is required.")
        return self


class MappingChangeV3(MappingIdentity):
    newTitle: str | None = None
    newActivityType: str | None = None

    @model_validator(mode="before")
    @classmethod
    def omitted_not_null(cls, value):
        if isinstance(value, dict) and any(key in value and value[key] is None for key in ("newTitle", "newActivityType")):
            raise ValueError("Unchanged fields must be omitted, not null.")
        return value

    @model_validator(mode="after")
    def effective_changes(self):
        if self.newTitle is None and self.newActivityType is None:
            raise ValueError("At least one effective change is required.")
        if self.newTitle is not None:
            MappingChange.changed_title(self)
        if self.newActivityType is not None:
            validate_type_key(self.newActivityType)
            if self.newActivityType == normalize_type(self.activityType):
                raise ValueError("The proposed activity type must differ from the original.")
        return self


class Mapping(Model):
    schemaVersion: Literal[2]
    archiveFingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    changes: list[MappingChange] = Field(min_length=1)

    @model_validator(mode="after")
    def distinct_targets(self):
        for name in ("sourceFile", "garminActivityId"):
            if len({getattr(change, name) for change in self.changes}) != len(self.changes):
                raise ValueError("Duplicate source paths or target activity IDs are not supported.")
        return self

    def proposals(self) -> ReviewRequest:
        return ReviewRequest(archiveFingerprint=self.archiveFingerprint, changes=[
            Proposal(sourceId=change.sourceFile, sourceFile=change.sourceFile,
                     originalTitle=change.originalTitle, newTitle=change.newTitle,
                     newActivityType=getattr(change, "newActivityType", None),
                     date=change.recordedStartTime, activityType=change.activityType)
            for change in self.changes
        ])


class MappingV3(Mapping):
    schemaVersion: Literal[3]
    changes: list[MappingChangeV3] = Field(min_length=1)


def unique_fields(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise MappingError("Duplicate JSON fields are not supported.")
        result[key] = value
    return result


def load_mapping(path: Path) -> Mapping:
    try:
        with path.open("rb") as handle:
            raw = handle.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise MappingError("The mapping exceeds the 1 MiB limit. Export fewer proposals.")
        data = json.loads(raw, object_pairs_hook=unique_fields)
        if not isinstance(data, dict) or type(data.get("schemaVersion")) is not int or data["schemaVersion"] not in (2, 3):
            raise MappingError("Only schemaVersion 2 or 3 is supported. Re-export from the website; version 1 lacks identity evidence.")
        return (Mapping if data["schemaVersion"] == 2 else MappingV3).model_validate(data)
    except OSError as error:
        raise MappingError("The JSON mapping could not be read. Check the supplied file and permissions.") from error
    except (UnicodeError, json.JSONDecodeError) as error:
        raise MappingError("The mapping must be valid UTF-8 JSON.") from error
