import getpass
import logging
import os

from garminconnect import Garmin

from .storage import storage_lock, token_directory


def main() -> int:
    logging.getLogger("garminconnect").setLevel(logging.CRITICAL)
    try:
        directory = token_directory()
        username = input("Garmin email: ").strip()
        password = getpass.getpass("Garmin password: ")
        if not username or not password:
            print("Email and password are required. No session was saved.")
            return 1
        api = Garmin(email=username, password=password, prompt_mfa=lambda: getpass.getpass("Garmin MFA code: "), retry_attempts=0)
        # The helper intentionally performs a fresh credential login. Otherwise a
        # valid token directory could silently select a different saved account.
        with storage_lock(directory):
            previous = os.environ.pop("GARMINTOKENS", None)
            try:
                api.login()
            finally:
                if previous is not None:
                    os.environ["GARMINTOKENS"] = previous
            api.client.dump(str(directory))
            (directory / "garmin_tokens.json").chmod(0o600)
        print("Garmin session saved privately. Run python -m garmin_writer review <JSON> to review your export. No activities were changed.")
        return 0
    except Exception:
        print("Garmin authentication or private token storage failed. Check credentials, MFA, connectivity, and directory permissions, then try again. No activities were changed.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
