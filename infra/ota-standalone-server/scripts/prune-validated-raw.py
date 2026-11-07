#!/usr/bin/env python3
"""Delete only expired raw evidence with database proof; retain unknowns/holds.

The database transaction locks manifests and errors through unlink + audit.
The shared backup flock prevents copying a partially cleaned source tree.
"""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess

ROOT = Path('/var/lib/sifangguan-ota/analytics-retention')
PATTERN = re.compile(r'raw/[0-9]{4}-[0-9]{2}-[0-9]{2}/([a-f0-9]{64})\.json\.enc')


def checked_path(root, row):
    relative = row['evidence_path']
    match = PATTERN.fullmatch(relative)
    if not match or match[1] != row['evidence_id']:
        raise ValueError('Unsafe evidence manifest path')
    path = root / relative
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError('Evidence symlink blocks cleanup')
    if not path.exists():
        return path, 0
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > 20*1024*1024:
        raise ValueError('Unsafe evidence file')
    envelope = json.loads(path.read_text(encoding='utf-8'))
    for field, column in [('evidenceId','evidence_id'),('tenantId','tenant_id'),
                          ('hotelId','hotel_id'),('sourceId','source_id'),
                          ('sourceSystem','source_system'),('contentHash','evidence_content_hash')]:
        if envelope.get(field) != row[column]:
            raise ValueError('Evidence differs from imported manifest')
    def date(value):
        return dt.datetime.fromisoformat(value.replace('Z','+00:00'))
    if date(envelope['observedAt']) != date(row['observed_at']):
        raise ValueError('Evidence collection time mismatch')
    return path, metadata.st_size


def run(apply=False):
    if ROOT.is_symlink() or not ROOT.is_dir():
        raise ValueError('Unsafe analytics root')
    if apply:
        activation=Path('/etc/sifangguan-ota/raw-retention-cleanup.enabled')
        if not activation.exists():
            print(json.dumps({'status':'AWAITING_VERIFIED_ACTIVATION'}))
            return
        mode=activation.lstat()
        if activation.is_symlink() or not stat.S_ISREG(mode.st_mode) or mode.st_uid!=0 or stat.S_IMODE(mode.st_mode)!=0o600 or activation.read_text().strip()!='7':
            raise ValueError('Unsafe raw cleanup activation marker')
    with open('/run/lock/hotel-ai-os-backup.lock','a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({'status':'SKIPPED_BACKUP_RUNNING'}))
            return
        database = subprocess.Popen(['sudo','-u','postgres','psql','-XAtq','-v',
            'ON_ERROR_STOP=1','-d','hotel_ai_os'], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, text=True)
        def send(sql):
            database.stdin.write(sql+'\n')
            database.stdin.flush()
        try:
            send("BEGIN; SET LOCAL lock_timeout='10s'; LOCK TABLE ota_analytics.raw_evidence_manifest, ota_analytics.ingest_error IN SHARE ROW EXCLUSIVE MODE;")
            send("SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM ota_analytics.raw_evidence_cleanup_candidates c;")
            rows = json.loads(database.stdout.readline())
            # Validate every candidate before any destructive action.
            checked = [(row, *checked_path(ROOT,row)) for row in rows]
            result = {'status':'APPLIED' if apply else 'DRY_RUN','rawEvidenceDays':7,
                      'candidates':len(rows),'files':sum(size>0 for _,_,size in checked),
                      'bytes':sum(size for _,_,size in checked),
                      'completedAt':dt.datetime.now(dt.timezone.utc).isoformat()}
            if apply:
                for row,path,size in checked:
                    path.unlink(missing_ok=True)
                for directory in {path.parent for _,path,size in checked if size}:
                    descriptor=os.open(directory,os.O_RDONLY|os.O_DIRECTORY)
                    try:
                        os.fsync(descriptor)
                    finally:
                        os.close(descriptor)
                # IDs were constrained by checked_path, never interpolate input paths.
                if rows:
                    identifiers=','.join("'"+row['evidence_id']+"'" for row in rows)
                    send('UPDATE ota_analytics.raw_evidence_manifest SET deleted_at=now() WHERE evidence_id IN ('+identifiers+');')
            send("COMMIT; SELECT 'RETENTION_COMMITTED';")
            if database.stdout.readline().strip() != 'RETENTION_COMMITTED':
                raise RuntimeError('Cleanup audit transaction failed')
            database.stdin.close()
            if database.wait(timeout=20):
                raise RuntimeError('Cleanup database failure')
            if apply:
                target=ROOT/'raw-retention-status.json'
                temporary=target.with_suffix('.tmp')
                temporary.write_text(json.dumps(result)+'\n',encoding='utf-8')
                os.chmod(temporary,0o600)
                os.replace(temporary,target)
            print(json.dumps(result))
        finally:
            if database.poll() is None:
                database.terminate()
                database.wait(timeout=20)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true')
    run(parser.parse_args().apply)
