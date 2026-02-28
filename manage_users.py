#!/usr/bin/env python3
"""CLI utility for managing ECA Command Center user accounts.

Usage:
    python3 manage_users.py add <username> <password> [--role admin|user]
    python3 manage_users.py list
    python3 manage_users.py remove <username>
"""
import sys
import os

# Add project root to path so we can import config_backend
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config_backend as backend


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    cmd = sys.argv[1].lower()

    if cmd == "add":
        if len(sys.argv) < 4:
            print("Usage: manage_users.py add <username> <password> [--role admin|user]")
            sys.exit(1)
        username = sys.argv[2]
        password = sys.argv[3]
        role = "user"
        if "--role" in sys.argv:
            idx = sys.argv.index("--role")
            if idx + 1 < len(sys.argv):
                role = sys.argv[idx + 1]
        backend.add_user(username, password, role)
        print(f"User '{username}' added/updated with role '{role}'")

    elif cmd == "list":
        users = backend.list_users()
        if not users:
            print("No users found.")
            return
        print(f"{'Username':<20} {'Role':<10}")
        print("-" * 30)
        for name, info in users.items():
            print(f"{name:<20} {info.get('role', 'user'):<10}")

    elif cmd == "remove":
        if len(sys.argv) < 3:
            print("Usage: manage_users.py remove <username>")
            sys.exit(1)
        username = sys.argv[2]
        if username == "admin":
            confirm = input("Remove the admin account? This may lock you out. Type 'yes' to confirm: ")
            if confirm.lower() != "yes":
                print("Cancelled.")
                return
        if backend.remove_user(username):
            print(f"User '{username}' removed")
        else:
            print(f"User '{username}' not found")

    else:
        print(f"Unknown command: {cmd}")
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
