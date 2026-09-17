import json
import fcntl
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path

from .models import Batch


ROOT = Path(__file__).resolve().parents[1]


class JournalError(Exception):
    pass


class StorageError(ValueError):
    pass


@contextmanager
def storage_lock(directory: Path):
    descriptor = os.open(directory / ".writer.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise JournalError("Another writer or login is using this private storage. Wait for it to finish.") from error
        yield
    finally:
        os.close(descriptor)


def private_directory(path: Path) -> Path:
    path = path.expanduser().absolute()
    if path in (Path.home(), Path("/")) or path == ROOT or ROOT in path.parents:
        raise StorageError("Private Garmin storage must be outside the repository in a dedicated directory.")
    if any(parent.is_symlink() for parent in (path, *path.parents)):
        raise StorageError("Private Garmin storage must not use symlinked paths.")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.stat().st_uid != os.getuid():
        raise StorageError("Private Garmin storage must belong to the current user.")
    path.chmod(0o700)
    return path


def token_directory() -> Path:
    value = os.getenv("GARMINTOKENS", str(Path.home() / ".garmin-view" / "tokens"))
    if value.lstrip().startswith("{") or (value.startswith("~") and not value.startswith("~/")) or value.endswith(".json"):
        raise StorageError("GARMINTOKENS must be a dedicated directory path, not token JSON or a token filename.")
    return private_directory(Path(value))


class Journal:
    def __init__(self, directory: Path):
        self.directory = private_directory(directory)

    def write(self, batch: Batch) -> None:
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.directory, prefix=".pending-", delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(batch.model_dump_json(indent=2))
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary, self.directory / f"{batch.id}.json")
            descriptor = os.open(self.directory, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        except OSError as error:
            raise JournalError("The operation journal could not be saved. No further writes will be sent; reconcile before retrying.") from error
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()

    def latest(self) -> Batch | None:
        try:
            batches = []
            for path in self.directory.glob("*.json"):
                if path.is_symlink() or path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
                    raise ValueError("Unsafe journal permissions.")
                batch = Batch.model_validate(json.loads(path.read_text(encoding="utf-8")))
                if path.stem != batch.id:
                    raise ValueError("Journal identity mismatch.")
                batches.append(batch)
            unresolved = [batch for batch in batches if batch.needs_recovery]
            if len(unresolved) > 1:
                raise ValueError("Multiple unresolved journals require inspection.")
            return unresolved[0] if unresolved else max(batches, key=lambda batch: batch.createdAt, default=None)
        except (OSError, ValueError) as error:
            raise JournalError("An operation journal is unreadable or unsafe. Restore the journal before enabling Garmin writes.") from error
