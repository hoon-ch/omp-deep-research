# 적응형 scout 할당 실험

유지보수자가 scout 정책 변경의 효과와 검증 범위를 판단하기 위한 기록입니다. 2026-10-15, OMP 18.11.0에서 실제 연구 미션을 실행했습니다. 고정된 10개 질문을 두 번씩 실행한 스위트에서 토큰 사용량이 감소했고, 최종 코드를 그대로 재실행해 같은 방향을 확인했습니다. **큰 조사 전반의 최적 할당이나 추가 scout의 양의 효용을 입증한 결과는 아닙니다.**

## 결과

각 열은 동일한 20개 미션입니다. 실패한 미션을 제거하는 필터는 없습니다. 기준선은 원래 제품 `83dd6c9`로 실행한 미션의 실제 제공자 기록을 완전한 계측기로 재집계한 값입니다. 최종 두 열은 수정된 계측기로 새로 실행한 별개의 live 스위트입니다.

| 지표 | 기준선 | 최종 첫 실행 | 최종 동일 코드 재실행 |
|---|---:|---:|---:|
| `total_suite_tokens` | 18,442,673 | 7,554,738 | 6,984,468 |
| 기준선 대비 토큰 감소 | — | 59.04% | 62.13% |
| 메인 및 메인 도구 내부 모델 토큰 | 12,506,001 | 7,534,684 | 6,964,588 |
| 모든 자식 및 자식 도구 내부 모델 토큰 | 5,936,672 | 20,054 | 19,880 |
| `total_model_calls` | 758 | 323 | 295 |
| `total_tool_calls` | 919 | 422 | 423 |
| `total_scout_spawns` | 38 | 0 | 0 |
| `mean_scouts_per_mission` | 1.9 | 0 | 0 |
| `total_research_cost_usd` — 기록된 가격 필드 합계, 부분 비용 | 4.8443 | 3.5376 | 3.3321 |
| `median_time_to_verdict_ms` | 196,350 | 142,091 | 121,111 |
| `p95_time_to_verdict_ms` | 575,013 | 216,008 | 204,395 |
| `research_completion_rate` | 1.0 | 1.0 | 1.0 |
| `evidence_coverage_score` — 고정 출처 그룹 충족률 | 1.0 | 1.0 | 1.0 |
| `answer_quality_score` — 고정 사실 패턴 충족률 | 1.0 | 1.0 | 1.0 |
| 통과 미션 / 케이스 | 20 / 10 | 20 / 10 | 20 / 10 |
| 예산·출처·critic·자식 원장 대조 위반 | 0 | 0 | 0 |
| 기반시설 오류 | 0 | 0 | 0 |
| 양의 토큰이지만 가격이 0이거나 없는 모델 호출 | 289 | 6 | 5 |

자식 토큰이 0이 아닌 이유는 J의 독립 critic입니다. 최종 두 실행 모두 J의 두 미션에서 critic이 실제로 실행되고 현재 snapshot에 연결된 검토가 등록됐습니다. scout를 전역 차단하거나 `--max-children`을 낮춘 결과가 아닙니다.

비용 필드 합계는 재실행에서 31.22% 낮았지만 **실제 총 연구 비용 또는 청구액의 감소율로 해석하면 안 됩니다.** Qwen과 일부 도구 내부 호출에는 유효한 가격이 없거나 0으로 기록됩니다. verdict 시간은 원래 미션의 생성 시각부터 verdict 시각까지이며, p50/p95는 nearest-rank 방식입니다. 원시 기록 재집계에 걸린 약 0.4초를 연구 실행 시간으로 사용하지 않았습니다.

## 변경한 전략

변경은 기존 OMP 연구 에이전트의 행동 지침에 적용했습니다. 별도 planner 모델 호출이나 새 공개 도구·설정·원장 필드를 추가하지 않았습니다.

- `src/policy.ts`: 질문 개수가 아니라 미해결 출처 탐색 작업에 0명·1명·여러 scout를 배정합니다. 겹치는 출처를 조사하는 질문은 묶고, 이미 검증된 답은 다시 탐색하지 않습니다. 정보 획득 기대와 자식 문맥·검색·응답·인계·부모 원문 재검증의 합을 비교합니다. 남은 시간·토큰·비용·도구·자식 예산을 확인하고, 필요한 critic 검토용 슬롯을 남기도록 안내합니다. 근거 공백이 남으면 확대합니다.
- `skills/deep-research/SKILL.md`: 같은 정책을 work loop에 반영했습니다.
- `src/briefs.ts`: 3–6개 lead 할당량을 제거했습니다. 검증에 충분한 강한 원출처를 찾으면 중단하되, 발견한 모순과 미해결 공백은 보고합니다.
- `index.ts`: start/spec/resume에 남아 있던 “독립 질문 두 개 이상이면 직접 검색 전에 fan-out” 지침을 제거하고 적응형 정책과 맞췄습니다. 이 충돌은 첫 정책 실험 후 코드 검토에서 발견했습니다.

0명·1명·여러 명의 선택, 충분성 판단과 critic 슬롯 예약은 **모델 지침**입니다. 코드 수준의 최적화 보장이나 강제 예약이 아닙니다. 기존 task 허용 조건, 항목별 `maxChildren` 계수와 실패 시 반환, 부모·자식 assistant 사용량 원장, 출처 검증, branch replay, 사용자 실행 동의와 critic attestation은 변경하지 않았습니다.

## 고정 스위트

`bench/cases.ts`의 질문·기대 결론, `bench/fixtures/`의 로컬 입력, evaluator와 모델 역할 설정을 제품 실험 중 바꾸지 않았습니다. 각 사례를 두 번 실행하고 최대 5개 미션을 동시에 실행합니다.

| 사례 | 고정 조사 내용 및 기대 결론 |
|---|---|
| A 단일 출처 | SQLite `SQLITE_MAX_ATTACHED` 기본값 10 |
| B 독립 비교 | PostgreSQL 17 `max_connections` 통상 100, MySQL 8.4는 151 |
| C 여러 프로젝트 | Redis 7.4: RSALv2 또는 SSPLv1; Valkey 8.0 및 KeyDB: BSD-3-Clause; 각 서버 기본 TCP 포트 6379 |
| D 모순 | relay 코드 기본 timeout 60초와 README 30초의 불일치 |
| E 여러 컴포넌트 | api: `redis://localhost:6379/0`; cli: `redis://127.0.0.1:6379/1`; worker: 기본값 없이 필수 환경 변수 오류 |
| F 중복 질문 | TypeScript 5.8 최소 Node.js 14.17.0, `engines.node >=14.17`, 그 선언상 tsc 실행 범위 |
| G 독립 탐색 기회 | Deno·Bun·Node.js·Cloudflare Workers의 환경 변수 API와 각각의 공식 문서 |
| H 같은 출처 | PostgreSQL 17 `shared_buffers` 통상 128MB, `work_mem` 4MB, `maintenance_work_mem` 64MB |
| I 적은 scout 예산 | `maxChildren=1`; Python 3.12.0/3.13.0 출시일 2023-10-02/2024-10-07, 계열 EOL 예정 2028년 10월/2029년 10월 |
| J 독립 critic | PBKDF2-HMAC-SHA256, 신규 비밀번호 해싱 600,000회; 지정 모델의 별도 검토 필수 |

메인은 `openai-codex/gpt-6.1-sol:high`, scout는 `alibaba-token-plan/qwen3.8-flash:medium`, critic은 `anthropic/claude-sonnet-5-5:medium`, 검색 역할은 `google-antigravity/gemini-3.8-flash`로 고정했습니다. fallback과 memory를 껐습니다. 기본 cap은 미션당 acquisition 30회, 자식 8개, 원장 기준 3,000,000토큰·보고 비용 USD 5·12분입니다. 독립 드라이버는 16분 후 중단합니다. 원래 제품의 예산은 다음 경계에서 검사하므로 진행 중인 모델 요청을 소급 중단하는 hard billing cap은 아닙니다.

OMP의 `find`는 별도의 unversioned judge backend를 사용합니다. 도구 내부 모델의 제공자 revision까지 고정했다는 주장은 하지 않습니다. 웹 페이지도 버전 명시 URL과 고정 질문을 쓰지만 내용 전체를 로컬 동결하지는 않았습니다. 실제 반환 내용과 사용량은 로컬 세션에 보존했습니다.

## 계측 보정과 실험 이력

주 지표는 캐시 읽기를 포함한 제공자 보고 `totalTokens`입니다. 메인·모든 자식 세션의 assistant 메시지, `model_usage`와 `web_search` 결과의 `details.response.usage`를 합산합니다. 출력·비캐시 토큰은 별도 보조 지표이며, provider total에 포함되지만 세부 필드로 분리되지 않은 토큰을 임의로 input/output에 배분하지 않습니다. 실패 응답·실패 미션·critic 사용량도 제거하지 않습니다. 모델이 사용량을 제공하지 않은 호출의 실제 과금 토큰은 알 수 없습니다.

초기 계측은 grounded search의 보고 토큰을 놓쳤습니다. 평가기 세그먼트 3을 만들고 기존 원시 제공자 기록을 **정확히 재집계**해 기준선을 다시 세웠습니다. 이는 deterministic replay에 의한 토큰 추정이 아닙니다. 메인과 자식이 원래 실행에서 실제 보고한 숫자를 다시 더한 것입니다. 자식 원장 대조는 `message_end` 기반 assistant 합계만 비교하며, 도구 내부 모델은 실험 총량에 별도로 포함합니다.

| 가설 / 결정 | 완전 계측 토큰 | scout 수 | 근거 |
|---|---:|---:|---|
| 기준선 | 18,442,673 | 38 | 원래 제품의 live 20개 미션 기록을 새 계측기로 재집계; native #8 |
| E1 유지: 미해결 출처 탐색 단위 할당 | 16,396,337 | 28 | all 20 pass; 원래 live #6 재집계, native #9 |
| E2 유지: 충분한 lead에서 중단 | 13,092,753 | 26 | all 20 pass; 원래 live #7 재집계, native #10 |
| E3 유지: 시작 지침의 강제 fan-out 충돌 제거 | 7,554,738 | 0 | 새 live 실행 all 20 pass; native #11 |
| 최종 동일 코드 재검증 | 6,984,468 | 0 | 새 live 실행 all 20 pass; native #12 |

제품 가설을 성능 퇴행 때문에 discard한 사례는 없습니다. 다음 측정은 유효한 최선값 계산에서 제외했습니다.

- Sonnet 사전 측정: 20개 미션에서 scout 0회였습니다. scout 할당 개선을 평가할 기준선으로 적합하지 않아 사용하지 않았습니다.
- 준비 단계의 잘못된 critic 모델 설정과 도구 내부 사용량을 assistant 원장에 대조한 계측 오류: 제품 최적화 전 수정했습니다. 이전 수치와 섞지 않았습니다.
- native #1: 독립 critic 두 실행이 제공자 HTTP 429로 실패했습니다. 20개 미션을 모두 집계했고 완료율 90%였으므로 기준선으로 채택하지 않았습니다. 프로세스 exit 2와 native `crash` 기록이 남아 있습니다.
- native #2/#4: 컨트롤 세션 중단으로 유효한 측정 출력이 없었습니다. 원장 스키마에 기록된 0은 missing-data sentinel이지 0토큰 실행이 아닙니다. flagged 상태로 최선값 계산에서 제외했습니다.
- native #5: 실행 중 외부 편집 시점이 확실하지 않아 provenance-uncertain으로 flagged 처리했습니다. 여기서 나온 15,142,190을 절감 근거로 사용하지 않았습니다. 커밋된 후보를 이후 별도로 측정했습니다.
- 계측 세그먼트 2의 부분 토큰 값은 위 표의 완전 계측 값으로 대체했습니다. native 세그먼트 번호는 2, evaluator 세그먼트 번호는 3입니다.

native `init_experiment`, `run_experiment`, `log_experiment`, `update_notes`를 사용했습니다. native 기록은 `~/.omp/autoresearch/--Users-hoon-ch-repos-omp-deep-research--.db`와 같은 이름의 디렉터리 `runs/`에 있습니다. `/autoresearch`가 생성한 로컬 branch에서 작업했고 push·이슈 닫기·릴리스는 하지 않았습니다.

## 재현과 원시 기록

전체 체크아웃, Node.js 22.6 이상, OMP, 해당 모델의 인증, 이 체크아웃을 가리키는 `omp-deep-research` plugin link가 필요합니다. 다른 설치본을 로드하면 이 체크아웃의 제품 비교가 아닙니다.

```sh
omp plugin link "$PWD"
bash autoresearch.sh
```

출력은 `METRIC name=value` 줄이며, 하나라도 미션의 품질·계측·출처·예산·critic gate가 실패하면 exit 2입니다. `BENCH_CASES`와 `BENCH_REPS`는 디버깅용이며 정식 비교에서는 설정하지 않습니다. `BENCH_MAIN` 변경은 새 평가 설정이므로 새 기준선이 필요합니다.

저장된 실제 제공자 기록을 재집계하려면 다음을 사용합니다. 새 모델 호출이나 토큰 추정은 발생하지 않습니다. 원래 케이스·반복 수·메인 모델이 일치해야 하며, 실패한 기록은 실패 상태로 남깁니다.

```sh
BENCH_ARCHIVE=bench/results/2026-10-15T08-14-37-094Z bash autoresearch.sh
node --experimental-strip-types --no-warnings bench/selftest.ts \
  bench/results/2026-10-15T09-50-25-997Z
npm run verify
```

`bench/results/`는 Git에서 제외됩니다. 원시 세션에는 웹 응답·로컬 경로·조사 내용이 있으므로 공유 전에 검토해야 합니다.

| 기록 | 로컬 경로 |
|---|---|
| 원래 기준선 live 기록 | `bench/results/2026-10-15T08-14-37-094Z/` |
| 완전 계측 기준선 재집계 | `bench/results/2026-10-15T09-34-47-475Z/` |
| 유효한 E1 live 기록 | `bench/results/2026-10-15T08-52-01-127Z/` |
| E2 live 기록 | `bench/results/2026-10-15T09-17-42-433Z/` |
| 최종 첫 live 실행 | `bench/results/2026-10-15T09-37-37-515Z/` |
| 최종 동일 코드 live 재실행 | `bench/results/2026-10-15T09-50-25-997Z/` |

기준선 재집계와 최종 두 실행의 동결 입력 digest는 `05e41b367bb1455254fe93a94716902df42174886155c5fb942b477996901841`입니다. digest는 케이스·평가기·드라이버·모델 overlay·fixtures를 포함하며, 제품 revision이나 OMP executable 전체를 보증하지는 않습니다.

## 검증과 남은 한계

- `npm run verify`: TypeScript 검사와 기존 테스트 116개 통과. 영수증·줄 범위·모순·branch replay·동의·critic attestation·child budget 회귀 검사는 변경하지 않았습니다.
- 최종 두 live 스위트: 총 40개 미션 모두 pass. 지정 critic 4개 미션 모두 통과했고 모순·출처·자식 원장 대조 gate 위반이 없었습니다.
- 독립 코드 검토: 시작 지침의 충돌을 수정한 뒤 보고할 결함 없음. 위임 허용 및 critic 절차가 유지됨을 확인했습니다.
- baseline/E1의 40개와 최종 첫 실행의 20개 verdict를 질문별로 수동 대조했습니다. C의 프로젝트별 license, D의 코드·문서 모순, E의 package별 default/오류, G의 runtime별 API를 포함해 명명 요구사항의 누락이나 잘못된 연결을 발견하지 못했습니다. 모든 웹 주장의 외부 재검증을 한 것은 아닙니다.
- self-test의 10개 검사 통과: 원본 critic, grounded-search 토큰, critic 우회, scout 보고서의 근거 승격, 질문 누락, 잘못된 결론, 모순 처리 오류, child budget 초과, 미계측 자식, verdict 누락. 최종 기록에 CLI 근거가 여러 개 있어 첫 항목만 지우는 mutation이 질문 누락을 만들지 못한 문제가 드러났습니다. 측정 종료 후 mutation이 해당 질문의 모든 근거를 제거하도록 고쳤고 최종 두 기록에서 다시 확인했습니다. 고정 evaluator나 비교 수치는 변경하지 않았습니다.

**품질 점수의 의미:** `evidence_coverage_score`는 출처 그룹의 충족률, `answer_quality_score`는 정규식 사실 패턴의 충족률입니다. 부정·인용 문맥이나 대상과 값의 잘못된 연결을 모두 검출하는 지표가 아닙니다. 1.0을 보정된 100% 정답률로 해석하지 않습니다.

**어떤 작업에 유리했는가:** 중복 질문 F, 같은 문서에서 찾는 H, 작은 repository D/E처럼 직접 조회가 쉬운 작업에서 위임·재검증의 중복을 줄였습니다. C/G처럼 출처가 여러 개인 비교도 출처를 직접 찾기 쉬우면 scout 추가가 필요하지 않았습니다. 단순 A는 처음부터 scout 0명이어서 토큰 개선을 일관되게 보장하지 않습니다.

**추가 scout가 유리한 작업은 아직 미입증입니다.** G는 독립 탐색 기회를 포함하지만, 요청된 “병렬 탐색이 실제로 더 유리한 양성 사례”라는 검증 요건은 이 스위트에서 충족하지 못했습니다. 최종 코드가 모든 케이스에서 0명을 선택한 사실을 숨기지 않습니다. [INFERENCE] 출처 위치가 불명확하고 독립적인 다단계 탐색이 큰 작업에서는 scout 하나 또는 여러 개가 의미 있는 공백을 더 빨리 줄일 수 있습니다. 정책은 이를 허용하지만, 이 추론을 이번 측정으로 검증된 이득으로 주장하지 않습니다. 큰 조사·다른 모델·더 많은 반복으로 일반화할 수 있는지는 별도 근거가 필요합니다.

현재 결과는 이 고정 스위트에서 반복 관측한 개선입니다. 전역 최적 할당, 통계적 유의성, 완전한 청구 비용, 혹은 모든 도구 내부 모델 사용량의 완전성을 증명하지 않습니다. 제품 예산 원장은 여전히 assistant 응답 기준이고 도구 내부 side-call 사용량은 빠질 수 있습니다. 실험 collector는 이번 OMP에서 관측한 별도 사용량까지 합산하지만, 제품의 기존 예산 계약 자체를 변경하지 않았습니다.
