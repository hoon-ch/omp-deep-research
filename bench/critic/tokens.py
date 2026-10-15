"""Token-count proxy: reads a JSON array of strings on stdin, prints a JSON array of o200k_base token counts.

o200k_base is the public tokenizer of OpenAI's GPT-4o/o-series family; the configured critic role resolves to an
OpenAI Codex model, whose own tokenizer is not published. Counts are a labelled proxy, never measured API usage.
"""
import json
import sys

import tiktoken

enc = tiktoken.get_encoding("o200k_base")
texts = json.load(sys.stdin)
json.dump([len(enc.encode(t, disallowed_special=())) for t in texts], sys.stdout)
