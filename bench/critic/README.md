# Critic context benchmark

Mission C의 고정 fixture, 측정 코드, 실제 응답과 native OMP 영수증입니다. 결과와 한계는 [실험 보고서](../../docs/CRITIC_CONTEXT.ko.md)에 있습니다.

## 고정한 평가 범위

`fixtures.ts`와 `fixtures.lock.json`은 로컬 커밋 `6fcb98b`에서 동결했습니다. Reference 판정을 모델 응답에 맞춰 바꾸지 않습니다.

| 요구 | 사례 |
|---|---|
| A/B | 5·25·100·500개 근거의 declared-license audit |
| C | 긴 claim/summary, 25개 근거 |
| D | 세 세그먼트의 실험: 실제 21/91 runs |
| E/F | 네 크기 모두 license 모순, claim/summary 불일치, listing의 내용 주장 |
| G/H | 잘못 보고한 수치, 다른 corpus 비교, crash/flagged run의 잘못된 best 주장 |
| I | bundled native-library license 산출물 누락 |
| J | `stale_digest`, `stale_packet` 구조 검증 |
| K | 다른 role 모델, fallback, evaluator 대체 구조 검증 |
| L | JSON key/공백 재배열은 수락, evidence 배열 재배열·생략·내용/실험 변경은 거절 |

`D-experiments-20`과 `D-experiments-120`은 초기 fixture 이름입니다. Lock을 유지하기 위해 이름은 그대로 두었지만 **실제 runs는 21/91**이며, 120-run 측정으로 해석하면 안 됩니다.

C의 부수 서술에는 manifest 이외 파일의 내용도 있습니다. 고정 pass reference는 manifest의 **declared license**에 한정합니다. 이 사례를 provenance 오류가 전혀 없는 전체-package license 증명으로 해석하지 마세요.

## 실행 환경

Node.js 24.17.0, OMP 18.11.0, `openai-codex/gpt-6.1-sol` / thinking `high`로 측정했습니다. 다른 모델의 정확도·context 적합성을 보장하지 않습니다.

```sh
npm ci
uv venv /tmp/critic-bench-venv
uv pip install --python /tmp/critic-bench-venv/bin/python tiktoken==0.14.0
bash bench/critic/autoresearch.sh
```

다른 Python 경로는 `CRITIC_BENCH_PYTHON`으로 지정합니다. `tokens.py`의 `o200k_base`는 공개 tokenizer 기반 **proxy**입니다. 대상 Codex 모델의 제공자 token count와 같다고 가정하지 않습니다. API 절약량은 `llm.ts`의 실제 usage와 분리합니다.

## 실제 critic 호출

```sh
CRITIC_BENCH_LLM_LABEL=replica-001 bash bench/critic/autoresearch.sh
node --experimental-strip-types --no-warnings bench/critic/llm.ts --label replica-001 --score
```

18개 semantic case를 모두 실행하고 clean 5/25/100/500 사례는 한 번씩 재전송하므로 **22개 고정 invocation**입니다. 각 호출은 `omp -p`에 plugin agent body와 실제 critic assignment를 전달합니다. 도구 없는 직접 model 호출이며, 실제 `task` subagent의 전체 host system/tool scaffold 비용을 측정한 것이 아닙니다. `recordCritic()`는 그 응답을 실제 receipt parser와 critic engine에 통과시켜 별도로 검증합니다.

새 실험에는 새 label을 쓰세요. 같은 label은 중단된 동일 실험을 재개하기 위한 것입니다. 실패한 호출도 지우지 않습니다. 결과는 `results/<label>.jsonl`에 남습니다. System prompt·assignment·모델·thinking·fixture lock을 해시하며, 모든 assistant usage와 모든 attempt 비용을 합산합니다. 누락된 case는 정확도 분모에서 빼지 않습니다. Usage가 없는 실패는 명시적인 `llm_usage_missing_count`로 드러냅니다.

Segment 1의 `baseline/h1/h2/h3.jsonl`은 case당 1회인 18-call 탐색 측정입니다. 당시 proxy는 22-call 값이었습니다. 동일 workload처럼 비교하지 마세요. Segment 2의 `final-s2.jsonl`과 `baseline-replicate-s2.jsonl`은 각각 실제 22 calls입니다. 첫 baseline의 원문은 native discard가 제거하여 `baseline-s2.log`만 남았습니다. 별도 반복을 숨기지 않고 보존했습니다. Fixture/reference는 바뀌지 않았고 accounting/coverage를 교정했습니다.

## Native autoresearch

Native 실행은 본 checkout의 branch를 바꾸지 않도록 격리된 checkout에서 수행했습니다. `native.py`는 RPC transport일 뿐, `run_experiment`를 재구현하지 않습니다. `/autoresearch` 이후 headless 세션에 이미 등록된 native 도구를 `native-tools.ts`의 `setActiveTools()`로 활성화합니다. OMP 18.11.0에서 등록과 활성 목록이 달라 도구가 보이지 않는 경우를 해결하며, 실제 native 함수만 호출합니다. 등록 자체가 없거나 실행·기록 영수증이 없으면 실패합니다.

격리된 checkout에는 root `autoresearch.sh`가 있어야 합니다.

```sh
#!/usr/bin/env bash
set -euo pipefail
export CRITIC_BENCH_LLM_LABEL=replica-001
exec bash bench/critic/autoresearch.sh
```

```sh
python3 bench/critic/native.py --cwd /absolute/path/to/disposable-checkout --out /tmp/native-replica.jsonl
```

Native `init_experiment`는 harness setup을 commit하고 branch를 바꿀 수 있으므로 사용자 작업 checkout에서 실행하지 마세요. `native-*.jsonl`은 실제 tool arguments/results와 usage를 보존하며 비공개 reasoning은 저장하지 않습니다. 실패한 native setup 시도도 보존합니다.

`native.py`는 `CRITIC_BENCH_RESULTS_DIR`를 `--out` 옆의 `<stem>.critic-results`로 지정합니다. Native discard가 checkout의 untracked 결과를 지우더라도 실제 응답을 보존하기 위해서입니다. 성공 여부와 무관하게 이 디렉터리와 RPC 영수증을 함께 보관하세요.

고정 fixture와 직접 baseline은 수정 전에 동결했지만 최초 native baseline은 수정 후 원본 source의 격리 checkout에서 실행했습니다. Native-first 순서의 이 차이를 보고서에 명시했습니다. Segment 3은 새 packet의 최상위 notes까지 hash에 묶는 강화된 구조 계약입니다. Semantic reference는 그대로이며 최종 native QA는 동일 실제 응답을 replay하므로 추가 API 호출로 세지 않습니다.

## 실제 task smoke

`@review_worker`가 `openai-codex/gpt-6.1-sol`로 resolve되는 OMP 설정과 `google-antigravity/gemini-3.8-flash` 접근 권한이 필요합니다.

```sh
python3 bench/critic/live.py --out /tmp/critic-packet-live.jsonl
```

격리 workspace에서 실제 extension과 shipped agent를 실행합니다. 저장된 child session의 model/fallback/usage와 host ledger의 `snapshotHash`, critic, conclusive verdict를 확인하세요. 고정 direct-call suite와 task scaffold 비용을 섞지 마세요.


## 정확성 검증

- `bench.ts`: 90개 구조 시나리오. Negative case는 단순 rejection뿐 아니라 **기대했던 거절 원인**을 확인합니다.
- `coverage.ts`: evidence/run/segment ID에 연결된 필드, metric/ASI, receipt 관계를 비교합니다. 전체 문자열 집합만 비교하지 않습니다.
- `tests/critic-packet.test.ts`: 100/101/500-item conclusive 경로, 잘못된 ID 집합, packet version/content/순서 변조, claim/metric 재귀속과 flag/receipt 누락을 검증합니다.
- Semantic plant detection은 ID 언급만으로 점수화하지 않습니다. 독립 검토자가 원문 concern이 고정 defect를 실제로 설명하는지 판독합니다. 원문/독립 판독 결과는 보고서에서 구분합니다.
- `analyze.ts`: component ablation. Token delta는 serialization 경계 효과가 있으므로 단순 합계로 해석하지 않습니다.
