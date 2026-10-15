# Research stopping 벤치마크

같은 질문·출처·채점 규칙으로 근거 충분성 정책의 acquisition과 완료 품질을 비교하는 고정 평가입니다. [실험 보고서](REPORT.ko.md)와 [native OMP 판정 집계](results/experiments.json)는 연구 브랜치의 기록이며, 현재 main에 결합된 다른 최적화까지 포함해 전체 스위트를 다시 측정했다는 뜻은 아닙니다.

## 고정 입력과 보존 범위

- `cases.json`: 필수 질문, 기대 disposition, 사실별 regex와 허용 근거 파일 group을 정의한 10개 case.
- `corpus/`: 가상 프로젝트 Kestrel의 23개 문서·소스 fixture. 버전 차이, 모순, 누락된 측정값과 오해하기 쉬운 timeout을 포함합니다.
- `score.ts`: 제품 코드와 독립적인 고정 scorer. finding의 주장과 인용 evidence의 locator를 검사합니다.
- `FROZEN.sha256`: case·scorer·corpus checksum. `bench/stopping/`으로 경로만 옮겼으며 입력 내용은 원래 연구의 freeze와 동일합니다. 채점을 바꾸려면 별도 평가 버전과 새 baseline을 만드세요.
- `results/<label>/summary.json`: 원래 연구의 집계만 보존한 기록. 전체 개별 실행 파일은 로컬 연구 commit `c75d736`에 남아 있으며 main에는 복사하지 않았습니다.
- `results/scorer-false-negative.json`: C07 오탐을 설명하는 최종 재측정 원문 1건. 대량 RPC 로그·개별 실행 로그는 제외했습니다.

각 미션에는 corpus만 새 workspace로 복사합니다. 정답과 scorer는 workspace에 복사하지 않습니다. runner는 시작 시 현재 확장 코드도 snapshot으로 복사하므로 실행 중 checkout 수정이 뒤따르는 미션에 섞이지 않습니다. 기존 루트 `autoresearch.sh`, 다른 벤치마크와 현재 native autoresearch 목표는 변경하지 않습니다.

## 실행

Node.js 22.6 이상, `npm ci`로 설치한 의존성, `omp` CLI와 두 모델의 유효한 인증이 필요합니다. 저장된 원래 실험 환경은 OMP 18.11.0 / Node.js 24.17.0입니다. 저장소 루트에서 실행하세요.

```sh
shasum -a 256 -c bench/stopping/FROZEN.sha256
BENCH_LABEL=my-unique-stopping-run bash bench/stopping/autoresearch.sh
```

하네스는 type-check와 기존 테스트를 수행하고 전체 10개 case를 기본 2회씩 실행합니다. 선택적인 smoke:

```sh
node --no-warnings --experimental-strip-types bench/stopping/run.ts --label my-unique-stopping-smoke --cases C01,C09,C10 --reps 1 --concurrency 3
```

기본 연구 모델은 `openai-codex/gpt-6.1-sol` / thinking `high`입니다. `BENCH_MODEL` 또는 `--model`로 바꿀 수 있지만 비교 중에는 고정해야 합니다. 이 디렉터리의 `omp-overlay.yml`은 long-term memory와 model fallback을 끄고 critic role `review_worker`를 `alibaba-token-plan/qwen3.8-flash:medium`으로 고정합니다. 모델·역할이 달라지면 새 baseline이 필요합니다. 인증 오류로 acquisition이 0이 된 실행을 개선으로 취급하지 마세요.

label은 새 경로 안전 이름이어야 합니다. 이전 결과와 세션은 덮어쓰지 않습니다. 새 실행은 Git에서 제외한 `bench/stopping/results/live/<label>/`에 기록하며 기존 집계를 덮어쓰지 않습니다. 생성된 개별 JSON의 `sessionDir`가 가리키는 OS 임시 transcript가 남아 있을 때 재채점할 수 있습니다.

```sh
node --experimental-strip-types bench/stopping/rescore.ts my-unique-stopping-run
```

원래 연구는 native `init_experiment` → `run_experiment` → `log_experiment`로 수행했습니다. 사전 유지 기준은 현재 유지한 변형 대비 acquisition 최소 10% 감소와 품질 유지였습니다. 이 독립 하네스를 추가했다고 기존 루트 native benchmark entrypoint를 바꾸거나 다른 실험 목표를 재설정하지는 않습니다.

## 계측 정의

| 지표 | 계산 |
|---|---|
| `total_acquisition_calls` | 전체 case의 main + 모든 하위 transcript acquisition 합계를 반복 횟수로 나눈 값 |
| Acquisition 종류 | `read`, `grep`, `glob`, `find`, `ast_grep`, `web_search`, `fetch`, `github`, `recall`, `reflect`, `browser`, `lsp`, `bash`, `eval`, `search`. 발행된 호출을 세므로 실패·차단된 호출도 포함 |
| 제외하는 제어 호출 | `deep_research`, `task`, `todo`, `ask`, `wait` 등. `task` wrapper로 child의 실제 검색·읽기를 대체 계산하지 않음 |
| `tokens_per_mission` | 모든 main/child assistant `usage.totalTokens` 합계의 미션별 평균. cache-read 포함 |
| `time_to_verdict_ms` | `mission_created`부터 마지막 `verdict_issued`까지 시간의 미션 중앙값 |
| `research_completion_rate` | structured verdict를 저장한 비율. 올바른 inconclusive도 완료 |
| `correctly_conclusive_rate` / `correctly_inconclusive_rate` | 각각 그 disposition이 정답인 case에서 고정 scorer를 통과한 비율 |
| `premature_stop_count` | 잘못된 conclusive + conclusive가 정답인데 inconclusive로 끝난 건수, 스위트당 반복 평균 |
| `missing_required_evidence_count` | 정답 conclusive의 필수 fact 중 인용 근거 group이 빠진 수, 스위트당 반복 평균 |
| `unresolved_contradiction_count` | conflict case를 conclusive로 끝내거나 기록된 반박을 무시한 수, 스위트당 반복 평균 |
| `verified_claim_coverage` | 정답 conclusive의 필수 fact 중 finding regex와 인용 파일 group이 모두 맞는 비율 |
| `source_diversity` | 미션 evidence에 등장한 서로 다른 파일 수 평균. 출판사·조직 다양성 지표가 아님 |

제품의 기존 부모 `--max-tools` 예산은 변경하지 않습니다. 벤치마크만 모든 child transcript의 acquisition을 따로 합산합니다.

## 한계

고정 입력이어도 LLM 실행은 결정적이지 않습니다. 이 suite는 local-data 평가이며 최신성은 고정 release chronology로 검사합니다. 실제 웹 변화나 조직 간 독립성, 모든 주제의 정확성을 증명하지 않습니다.

scorer는 자연어 entailment를 완전히 판정하지 못합니다. C07은 올바른 `30.0-second` 표현이나 단위를 앞에 쓴 `request_timeout in seconds ... 30.0`을 finding regex가 놓치는 오탐이 있습니다. 원래 freeze 이후 채점을 수정하거나 모델에 정답 표현을 강제하지 않았습니다. 집계와 native `checks_failed` 판정도 그대로 보존합니다. main 반영은 이 오탐을 해결했다는 주장이 아닙니다.
