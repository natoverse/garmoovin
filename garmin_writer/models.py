from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Account(Model):
    id: str
    name: str


class Proposal(Model):
    sourceId: str
    sourceFile: str
    originalTitle: str
    newTitle: str
    date: str | None
    activityType: str

    @field_validator("newTitle")
    @classmethod
    def valid_title(cls, value: str) -> str:
        if not value.strip() or value != value.strip():
            raise ValueError("A trimmed, nonempty title is required.")
        return value


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


class Item(Model):
    proposal: Proposal
    activityId: str | None = None
    currentTitle: str | None = None
    observedTitle: str | None = None
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
        return self.phase in ("running", "recovery") or any(item.status == "uncertain" for item in self.items)


def utc_time(value: str, *, remote: bool = False) -> datetime:
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        if not remote:
            raise ValueError("Source timestamp must include a timezone.")
        result = result.replace(tzinfo=timezone.utc)
    return result.astimezone(timezone.utc)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()
