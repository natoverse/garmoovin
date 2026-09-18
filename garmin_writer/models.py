from datetime import datetime, timezone
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Account(Model):
    id: str
    name: str


def normalize_type(value: str) -> str:
    return re.sub(r"[\s_-]+", "_", value.strip().casefold())


def validate_type_key(value: str) -> str:
    if not re.fullmatch(r"[a-z][a-z0-9_]*", value) or value == "unknown":
        raise ValueError("A known canonical Garmin activity type key is required.")
    return value


class ActivityType(Model):
    typeId: int = Field(strict=True, gt=0)
    typeKey: str
    parentTypeId: int = Field(strict=True, ge=0)

    @field_validator("typeKey")
    @classmethod
    def valid_key(cls, value: str) -> str:
        return validate_type_key(value)


class Proposal(Model):
    sourceId: str
    sourceFile: str
    originalTitle: str
    newTitle: str | None = None
    newActivityType: str | None = None
    date: str | None
    activityType: str

    @field_validator("newTitle")
    @classmethod
    def valid_title(cls, value: str | None) -> str | None:
        if value is not None and (not value.strip() or value != value.strip()):
            raise ValueError("A trimmed, nonempty title is required.")
        return value

    @model_validator(mode="after")
    def requested_fields(self):
        if self.newTitle is None and self.newActivityType is None:
            raise ValueError("At least one proposed change is required.")
        if self.newActivityType is not None:
            validate_type_key(self.newActivityType)
            if self.newActivityType == normalize_type(self.activityType):
                raise ValueError("The proposed activity type must differ from the original.")
        return self


class ReviewRequest(Model):
    archiveFingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    changes: list[Proposal] = Field(min_length=1)
    duplicateSourceFiles: list[str] = Field(default_factory=list)

    @field_validator("changes")
    @classmethod
    def distinct_sources(cls, values: list[Proposal]) -> list[Proposal]:
        if len({item.sourceId for item in values}) != len(values):
            raise ValueError("Source IDs must be distinct.")
        return values


Status = Literal[
    "eligible", "blocked", "conflict", "not_attempted", "uncertain",
    "confirmed", "already_applied", "failed",
]
MutationStatus = Literal["not_attempted", "uncertain", "confirmed", "already_applied", "failed"]


class Item(Model):
    proposal: Proposal
    activityId: str | None = None
    currentTitle: str | None = None
    observedTitle: str | None = None
    currentActivityType: str | None = None
    observedActivityType: str | None = None
    resolvedActivityType: ActivityType | None = None
    titleStatus: MutationStatus | None = None
    activityTypeStatus: MutationStatus | None = None
    status: Status = "not_attempted"
    reason: str = ""


class Batch(Model):
    id: str = Field(pattern=r"^[a-f0-9]{32}$")
    createdAt: str
    archiveFingerprint: str
    account: Account
    items: list[Item]
    phase: Literal["review", "running", "complete", "recovery"] = "review"
    notice: str = ""

    @property
    def needs_recovery(self) -> bool:
        return self.phase in ("running", "recovery") or any(
            "uncertain" in (item.status, item.titleStatus, item.activityTypeStatus)
            for item in self.items
        )


def utc_time(value: str, *, remote: bool = False) -> datetime:
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        if not remote:
            raise ValueError("Source timestamp must include a timezone.")
        result = result.replace(tzinfo=timezone.utc)
    return result.astimezone(timezone.utc)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()
