# SPDX-License-Identifier: Apache-2.0
from . import DEFAULT_REQUEST_TIMEOUT


class Producer:
    def __init__(self, bootstrap, request_timeout=DEFAULT_REQUEST_TIMEOUT, retries=5):
        self.bootstrap = bootstrap
        self.request_timeout = request_timeout
        self.retries = retries
