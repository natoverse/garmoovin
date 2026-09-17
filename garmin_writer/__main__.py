import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from pydantic import ValidationError

from . import auth
from .garmin import GarminAdapter, GarminError
from .mapping import MappingError, load_mapping
from .models import Batch
from .storage import Journal, JournalError, StorageError, journal_directory, storage_lock, token_directory
from .writer import Writer, WriterError


def display(batch: Batch) -> None:
    data = batch.model_dump()
    for row, item in zip(data["items"], batch.items):
        row["changedSinceExport"] = item.currentTitle is not None and item.currentTitle != item.proposal.originalTitle
    print(json.dumps(data, indent=2, ensure_ascii=True))
    print("Outcomes:", ", ".join(f"{count} {name}" for name, count in sorted(Counter(item.status for item in batch.items).items())))


def confirmed(batch: Batch) -> bool:
    eligible = sum(item.status == "eligible" for item in batch.items)
    if eligible == 0:
        print("No eligible renames. No writes sent.")
        return False
    if not sys.stdin.isatty():
        print("Applying requires an interactive terminal. No writes sent.", file=sys.stderr)
        return False
    print(f"Review above: {eligible} eligible renames for account {json.dumps(batch.account.id)}.")
    return input("Type APPLY to authorize only these reviewed renames: ") == "APPLY"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Review and apply a Groomin schema-v2 JSON export. No website connection or ZIP is needed.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("login", help="Authenticate in this terminal and save a private session; no activity writes")
    for name in ("review", "apply"):
        command = commands.add_parser(name, help="Read and review only" if name == "review" else "Fresh review followed by explicit interactive confirmation")
        command.add_argument("mapping", type=Path, help="Downloaded schemaVersion 2 JSON")
    reconcile = commands.add_parser("reconcile", help="Read the previous journal and Garmin without replaying writes")
    reconcile.add_argument("--apply", action="store_true", help="After reconciliation, offer interactive confirmation for remaining renames")
    args = parser.parse_args(argv)
    try:
        if args.command == "login":
            if not sys.stdin.isatty():
                print("Login requires an interactive terminal.", file=sys.stderr)
                return 2
            return auth.main()
        mapping = load_mapping(args.mapping) if args.command in ("review", "apply") else None
        directory = token_directory()
        journal = Journal(journal_directory())
        with storage_lock(directory), storage_lock(journal.directory):
            writer = Writer(GarminAdapter(directory), journal)
            writer.connect()
            batch = writer.prepare(mapping.proposals()) if mapping else writer.reconcile()
            print("Read-only review. changedSinceExport flags differences from the original GPX title.")
            display(batch)
            if args.command == "review" or (args.command == "reconcile" and not args.apply):
                return 0 if all(item.status in ("eligible", "already_applied") for item in batch.items) else 1
            if not confirmed(batch):
                print("No writes authorized.")
                return 0 if all(item.status == "already_applied" for item in batch.items) else 1
            result = writer.apply(batch.id)
            print("Operation results:")
            display(result)
            if result.needs_recovery:
                print("Reconcile before retrying: python -m garmin_writer reconcile", file=sys.stderr)
            return 0 if not result.needs_recovery and all(item.status in ("confirmed", "already_applied") for item in result.items) else 1
    except ValidationError:
        print("Invalid schema-v2 mapping fields or journal structure. Required identity must be complete, consistent, and unique; unknown fields are rejected.", file=sys.stderr)
        return 2
    except (GarminError, JournalError, WriterError, MappingError, StorageError) as error:
        print(str(error), file=sys.stderr)
        return 2
    except (KeyboardInterrupt, EOFError):
        print("Interrupted. A write may be uncertain; reconcile the journal before retrying.", file=sys.stderr)
        return 130
    except Exception:
        print("The writer could not complete the operation. Details withheld to protect credentials. Check private storage/connectivity and reconcile before retrying.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
