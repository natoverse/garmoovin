import argparse
import json
import sys
from collections import Counter
from pathlib import Path

from pydantic import ValidationError

from . import auth
from .garmin import GarminAdapter, GarminError
from .mapping import MappingError, load_mapping
from .models import Batch, normalize_type
from .storage import Journal, JournalError, StorageError, journal_directory, storage_lock, token_directory
from .writer import Writer, WriterError


def display(batch: Batch) -> None:
    data = batch.model_dump()
    for row, item in zip(data["items"], batch.items):
        row["changedSinceExport"] = item.currentTitle is not None and item.currentTitle != item.proposal.originalTitle
        row["typeChangedSinceExport"] = item.currentActivityType is not None and item.currentActivityType != normalize_type(item.proposal.activityType)
    print(json.dumps(data, indent=2, ensure_ascii=True))
    print("Outcomes:", ", ".join(f"{count} {name}" for name, count in sorted(Counter(item.status for item in batch.items).items())))
    blocked = [item for item in batch.items if item.status == "blocked"]
    if blocked:
        print(f"\nBlocked activities ({len(blocked)}):")
        for item in blocked:
            title = item.currentTitle if item.currentTitle is not None else item.proposal.originalTitle
            print(f"- {json.dumps(title)} (Garmin ID: {json.dumps(item.activityId) if item.activityId else 'unavailable'}; source: {json.dumps(item.proposal.sourceFile)})")
            print(f"  Reason: {json.dumps(item.reason or 'No explanation was provided.')}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Review and apply a Groomin schema-v2/v3 JSON export. No website connection or ZIP is needed.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("login", help="Authenticate in this terminal and save a private session; no activity writes")
    for name in ("review", "apply"):
        command = commands.add_parser(name, help="Read and review only" if name == "review" else "Review and execute eligible changes immediately, without prompting")
        command.add_argument("mapping", type=Path, help="Downloaded schemaVersion 2 (titles) or 3 (titles/types) JSON")
    reconcile = commands.add_parser("reconcile", help="Read the previous journal and Garmin without replaying writes")
    reconcile.add_argument("--apply", action="store_true", help="After reconciliation, execute remaining eligible changes without prompting")
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
            print("Read-only review. changedSinceExport and typeChangedSinceExport flag differences from the original GPX title and type.")
            display(batch)
            if args.command == "review" or (args.command == "reconcile" and not args.apply):
                return 0 if all(item.status in ("eligible", "already_applied") for item in batch.items) else 1
            eligible = sum(item.status == "eligible" for item in batch.items)
            if eligible == 0:
                print("No eligible changes. No writes sent.")
                return 0 if all(item.status == "already_applied" for item in batch.items) else 1
            print(f"Applying {eligible} eligible activity changes for account {json.dumps(batch.account.id)}.", flush=True)
            result = writer.apply(batch.id)
            print("Operation results:")
            display(result)
            if result.needs_recovery:
                print("Reconcile before retrying: python -m garmin_writer reconcile", file=sys.stderr)
            return 0 if not result.needs_recovery and all(item.status in ("confirmed", "already_applied") for item in result.items) else 1
    except ValidationError:
        print("Invalid schema-v2/v3 mapping fields or journal structure. Required identity must be complete, consistent, and unique; unknown fields are rejected.", file=sys.stderr)
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
