#!/usr/bin/env python3
"""
beta_admin.py — Beta metering layer, Task 4 (+ beta gate follow-up, Task 1):
Mac-side admin CLI for invite_codes/redemptions/beta_submission_events (see
backend/server.js's "Beta metering layer" + "Beta gate follow-up" sections
for the schema + gate/allowance/breaker/pre-linked-identity logic this data
feeds). No web admin UI -- this script is the only way to mint codes.

Reuses the project-local venv + DATABASE_URL-from-backend/.env pattern
established by generate_preview.py/worker.py/spec_scorer.py/
backfill_source_url.py -- no research-repo imports.

Usage:
  ./_venv/bin/python3 beta_admin.py mint --label "friends round 1" [--max-redemptions 3] [--code CUSTOM]
  ./_venv/bin/python3 beta_admin.py mint --label "Name" --handle theirhandle   # pre-linked (TikTok)
  ./_venv/bin/python3 beta_admin.py list
  ./_venv/bin/python3 beta_admin.py usage <user_id>
"""
import argparse
import os
import pathlib
import secrets
import string
import sys
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

import sync_study_history

BETA_ALLOWANCE = int(os.environ.get("BETA_ALLOWANCE", "15"))

# Excludes visually-ambiguous characters (0/O, 1/I/L) -- these codes get
# typed by hand on a phone keyboard.
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def get_env(key):
    env_path = pathlib.Path.home() / "PreviewPanel" / "backend" / ".env"
    for line in env_path.read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1]
    return None


def db_connect():
    url = get_env("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not found in backend/.env")
    conn = psycopg2.connect(url.replace("-pooler", ""))
    conn.autocommit = True
    return conn


def gen_code(length=8):
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(length))


def normalize_handle(raw):
    if not raw:
        return None
    h = raw.strip().lstrip("@").strip().lower()
    return h or None


def cmd_mint(conn, args):
    # Invite code UX -- codes are case-insensitive end to end; canonical
    # storage is uppercase (gen_code()'s own alphabet is already
    # uppercase-only, so this only matters for an operator-supplied
    # --code). server.js's redeem endpoint uppercases+trims the input
    # before comparing, so a code minted any-case still matches.
    code = (args.code or gen_code()).strip().upper()
    tiktok = normalize_handle(args.handle)
    instagram = normalize_handle(args.instagram)
    youtube = normalize_handle(args.youtube)
    cur = conn.cursor()
    cur.execute(
        """INSERT INTO invite_codes
             (code, label, max_redemptions, known_tiktok_handle, known_instagram_handle, known_youtube_handle, is_internal)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (code, args.label, args.max_redemptions, tiktok, instagram, youtube, args.internal),
    )
    cur.close()
    pre_linked = f" pre-linked=@{tiktok}" if tiktok else (f" pre-linked=(ig:{instagram} yt:{youtube})" if (instagram or youtube) else "")
    internal_note = " internal=true" if args.internal else ""
    print(f"[beta_admin] minted code={code} label={args.label!r} max_redemptions={args.max_redemptions}{pre_linked}{internal_note}")

    # Track Record, Task 3b -- a TikTok handle that's also an enrolled
    # research creator gets their study history staged automatically, so
    # their Track Record tab opens populated the moment they redeem rather
    # than waiting on prospect ingest or their own future posts. No-op
    # (prints plainly, mint still succeeds) for a non-study handle or one
    # with no OOF-covered/outcome-resolved aged videos -- sync_study_history
    # itself reports that case; --no-sync skips this entirely.
    if tiktok and not args.no_sync:
        synced = sync_study_history.run(tiktok)
        if synced:
            print(f"[beta_admin] synthesized {synced} study-history row(s) for @{tiktok}")


def cmd_list(conn, args):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            ic.code, ic.label, ic.max_redemptions, ic.created_at, ic.is_internal,
            ic.known_tiktok_handle, ic.known_instagram_handle, ic.known_youtube_handle,
            COUNT(DISTINCT r.user_id) AS redemptions,
            COUNT(e.id) AS total_submissions,
            BOOL_OR(r.identity_choice = 'claimed') AS claim_fired,
            BOOL_OR(r.identity_choice = 'declined') AS any_declined
        FROM invite_codes ic
        LEFT JOIN redemptions r ON r.code = ic.code
        LEFT JOIN beta_submission_events e ON e.user_id = r.user_id
        GROUP BY ic.code, ic.label, ic.max_redemptions, ic.created_at, ic.is_internal,
                 ic.known_tiktok_handle, ic.known_instagram_handle, ic.known_youtube_handle
        ORDER BY ic.created_at DESC
    """)
    rows = cur.fetchall()
    cur.close()
    if not rows:
        print("[beta_admin] no invite codes yet")
        return
    print(f"{'code':10} {'label':24} {'handle':18} {'redemptions':13} {'submissions':12} {'claim':9} {'internal':9} created_at")
    for r in rows:
        handle = r["known_tiktok_handle"] or r["known_instagram_handle"] or r["known_youtube_handle"] or "—"
        if r["known_tiktok_handle"] is None and r["known_instagram_handle"] is None and r["known_youtube_handle"] is None:
            claim = "—"
        elif r["claim_fired"]:
            claim = "yes"
        elif r["any_declined"]:
            claim = "declined"
        else:
            claim = "pending"
        print(
            f"{r['code']:10} {(r['label'] or ''):24.24} {handle:18.18} "
            f"{r['redemptions']}/{r['max_redemptions']:<11} "
            f"{r['total_submissions']:<12} {claim:9} {('yes' if r['is_internal'] else '—'):9} {r['created_at']}"
        )


def cmd_usage(conn, args):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "SELECT user_id, code, redeemed_at, identity_choice FROM redemptions WHERE user_id = %s",
        (args.user_id,),
    )
    redemption = cur.fetchone()
    if not redemption:
        print(f"[beta_admin] user_id={args.user_id} has not redeemed an invite code")
        cur.close()
        return
    cur.execute(
        "SELECT COUNT(*) AS n FROM beta_submission_events WHERE user_id = %s AND created_at > now() - interval '30 days'",
        (args.user_id,),
    )
    used = cur.fetchone()["n"]
    cur.execute(
        "SELECT COUNT(*) AS n FROM beta_submission_events WHERE user_id = %s",
        (args.user_id,),
    )
    lifetime = cur.fetchone()["n"]
    cur.close()
    remaining = max(0, BETA_ALLOWANCE - used)
    print(f"[beta_admin] user_id={redemption['user_id']}")
    print(f"  code:            {redemption['code']}")
    print(f"  redeemed_at:     {redemption['redeemed_at']}")
    print(f"  identity_choice: {redemption['identity_choice'] or '— (ordinary code, nothing to confirm)'}")
    print(f"  used (30d):      {used} of {BETA_ALLOWANCE} (remaining: {remaining})")
    print(f"  lifetime uses:   {lifetime}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_mint = sub.add_parser("mint", help="mint a new invite code")
    p_mint.add_argument("--label", required=True, help="who/what this code is for")
    p_mint.add_argument("--max-redemptions", type=int, default=3)
    p_mint.add_argument("--code", default=None, help="use a specific code instead of generating one")
    p_mint.add_argument("--handle", default=None, help="pre-link a known TikTok handle (e.g. thecolorfulpantry)")
    p_mint.add_argument("--instagram", default=None, help="pre-link a known Instagram handle")
    p_mint.add_argument("--youtube", default=None, help="pre-link a known YouTube handle")
    p_mint.add_argument("--no-sync", action="store_true", help="skip auto study-history sync even if --handle matches a research creator")
    p_mint.add_argument("--internal", action="store_true", help="founder/team access -- redeemer's submissions never enter comparison pools, excluded from activity stats")
    p_mint.set_defaults(func=cmd_mint)

    p_list = sub.add_parser("list", help="list codes with redemption + usage counts")
    p_list.set_defaults(func=cmd_list)

    p_usage = sub.add_parser("usage", help="per-user usage summary")
    p_usage.add_argument("user_id")
    p_usage.set_defaults(func=cmd_usage)

    args = ap.parse_args()
    conn = db_connect()
    try:
        args.func(conn, args)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
