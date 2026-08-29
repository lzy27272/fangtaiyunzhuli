import os
import re
import stat

from websockify.auth_plugins import BasicHTTPAuth


EXPECTED_PATH = '/run/sifangguan-bieyanghong/websockify.auth'
SOURCE_PATTERN = re.compile(r'viewer:[A-Za-z0-9_-]{40,128}')


class FileBasicHTTPAuth(BasicHTTPAuth):
    def __init__(self, src=None):
        if src != EXPECTED_PATH:
            raise ValueError('BIEYANGHONG_WEBSOCKIFY_AUTH_PATH_INVALID')
        metadata = os.lstat(src)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or stat.S_ISLNK(metadata.st_mode)
            or metadata.st_uid != os.getuid()
            or metadata.st_mode & 0o077
            or metadata.st_size < 47
            or metadata.st_size > 160
        ):
            raise ValueError('BIEYANGHONG_WEBSOCKIFY_AUTH_FILE_UNSAFE')
        with open(src, 'r', encoding='ascii') as source:
            credentials = source.read().strip()
        if SOURCE_PATTERN.fullmatch(credentials) is None:
            raise ValueError('BIEYANGHONG_WEBSOCKIFY_AUTH_INVALID')
        super().__init__(credentials)
