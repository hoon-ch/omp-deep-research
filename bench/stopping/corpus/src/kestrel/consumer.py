# SPDX-License-Identifier: Apache-2.0
from . import DEFAULT_REQUEST_TIMEOUT


class Consumer:
    def __init__(self, bootstrap, group, request_timeout=DEFAULT_REQUEST_TIMEOUT):
        self.bootstrap = bootstrap
        self.group = group
        self.request_timeout = request_timeout
