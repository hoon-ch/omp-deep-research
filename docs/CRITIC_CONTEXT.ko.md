# Mission C: Critic Context Optimization

## 채택한 변경

`view:"critic".snapshot`을 `deep-research.critic-packet.v2` / `stable-json.v1`로 버전화했습니다. 모든 근거를 유지하고 evidence의 **등록 시각 `at`와 중복 제거 키 `fingerprint`만** critic에게 보내지 않습니다. 두 필드는 원장과 `evidenceDigest`에 남습니다. 근거의 원래 `receiptId`, claim·summary·locator·source·stance·ID·title, 모든 요구사항, 전체 run/segment 보고서와 notes는 보존합니다.

기존 100개 ID parser 제한도 분리했습니다. 100/101/500개 응답이 실제 critic 등록과 conclusive verdict까지 통과하며, ID 누락·중복·대체·추가·재배열은 거절합니다. `concerns <= 100`은 그대로입니다.

변경을 publish하거나 GitHub issue를 닫지 않았습니다. Fixture 동결 커밋은 로컬 `6fcb98b`, 원본 production 기준점은 `e61a27d`입니다.

## 실제 critic 입력: 고정 22회 평가

실제 provider usage 기준 `METRIC critic_input_tokens=373773`입니다. 원문이 보존된 baseline 반복과 비교하면 **526,075 → 373,773 tokens, 28.95% 감소**입니다. Cached input도 포함하며 실패·재전송을 제외하지 않습니다. 동일 모델 `openai-codex/gpt-6.1-sol`, thinking `high`, 동시성 6으로 측정했습니다. 직접 `omp -p` 호출에 critic agent body와 실제 assignment를 전달한 수치이며, production `task` 전체 scaffold의 절약량으로 일반화하지 않습니다.

| 실측 workload | 원본 input/review | 최종 input/review | 감소 |
|---|---:|---:|---:|
| 근거 5개, 각 2회 | 3,108 | 2,840 | 8.62% |
| 근거 25개, 각 2회 | 6,569 | 5,126 | 21.97% |
| 근거 100개, 각 2회 | 19,584 | 13,719 | 29.95% |
| 근거 500개, 각 2회 | 88,997 | 59,601 | 33.03% |
| 긴 claim/summary, 근거 25개 | 11,978 | 10,543 | 11.98% |
| 세그먼트 3개, runs 91개 | 14,830 | 14,501 | 2.22% |

| Secondary metric | 원본 반복 22회 | 최종 22회 |
|---|---:|---:|
| `critic_input_tokens_per_review`, 반올림 평균 | 23,913 | 16,990 |
| `critic_latency_ms`, 평균 | 27,764 | 26,679 |
| 전체 판정 일치 | 20/22 | 22/22 |
| `critic_pass_accuracy` | 11/11 | 11/11 |
| `critic_revise_accuracy` | 9/11 | 11/11 |
| `critic_false_pass_count` | 2 | 0 |
| `critic_false_revise_count` | 0 | 0 |
| `unsupported_claim_detection_rate` | 8/8 | 8/8 |
| `contradiction_detection_rate` | 3/4 | 4/4 |
| `invalid_run_detection_rate` | 2/4 | 4/4 |
| 필수 산출물 누락 탐지 | 1/1 | 1/1 |
| `evidence_coverage_rate` | 1 | 1 |
| `attestation_failure_count` | 8 | 0 |
| `snapshot_integrity_failure_count` | 6 | 0 |
| 실제 critic 응답의 등록 거절 | 4 | 0 |

탐지율은 **오류를 실제로 설명하고 `revise`로 판정한 경우**만 인정합니다. 독립 reviewer가 모든 응답을 판독했습니다. 원본 반복은 E25의 모순과 H의 crash/flag를 설명하고도 `pass`했으므로 effective detection은 14/17입니다. 최종은 17/17입니다. G/H에는 결과 파일 기반 experiment evidence를 부당하게 의심한 부수 concern도 남아 있습니다. 모든 concern이 정확하다는 뜻은 아닙니다.

첫 22회 baseline은 입력 **526,028**, 판정 **22/22**, false pass/revise **0/0**, 평균 latency **26,415 ms**였습니다. Native `checks_failed` rollback이 untracked 원문을 제거하여 전체 stdout은 남았지만 응답 원문은 복구하지 못했습니다. 이를 숨기지 않고 별도 22회 baseline을 실행했으며, 추가 비용도 research usage에 포함했습니다. 보존된 반복의 입력 차이는 47 tokens입니다. 판정 변동은 관측 사실이며 정확도 개선의 인과·통계적 증거가 아닙니다. Latency도 첫 baseline보다 최종이 느려 일관된 속도 개선을 주장하지 않습니다.

Baseline의 구조 실패 수에는 100-ID cap으로 인한 정상 review 거절과, 잘못된 이유로 먼저 거절되어 실제 negative gate를 검증하지 못한 경우가 포함됩니다. **8건의 위조 수락이나 6건의 hash 우회**라는 뜻이 아닙니다. 최종 22회에는 누락 invocation·usage·모델 identity 실패가 없었습니다.

### Native 실행과 accounting

실제 OMP `init_experiment` → `run_experiment` → `log_experiment` 영수증을 보존했습니다. Headless `/autoresearch`에서 native 도구가 등록됐지만 활성화되지 않아 benchmark-only extension이 공개 `setActiveTools()` API로 기존 도구를 활성화했습니다. 대체 `run_experiment`를 구현하지 않았습니다.

Fixture와 직접 baseline은 production 수정 전에 동결했지만, **native 원본-source baseline은 첫 수정 후 격리 checkout에서 실행했습니다.** Native-first 순서를 완전히 지킨 실험이라고 보고하지 않습니다. 최종 exact-packet QA는 보존된 동일 22개 실제 응답을 강화한 engine으로 재검증한 실행입니다. 새 critic 22회로 중복 계상하지 않습니다. 재현 중 fixture clone의 serial 충돌로 실패한 QA도 보존했으며 수정 후 native keep를 확인했습니다.

`total_research_tokens`는 **2026-10-15 08:57:53 UTC 관측 prefix 기준 최소 75,391,421 tokens**입니다. Main·독립 reviewer·실패한 native 준비·실제 critic·추가 baseline·smoke·plumbing 호출의 관측 usage를 합산하고 cached input을 포함합니다. 알려진 critic review 142회 중 141회의 usage가 있으며, 이들의 입력은 합계 2,682,568 tokens입니다. 초기 실제 task critic 1회는 usage가 없어 포함할 수 없었고, 위 시점 이후 본문 작성·최종 전달 비용도 이 하한 밖입니다. 완전한 mission 총량이나 청구 금액으로 제시하지 않습니다. 출처별 내역은 [`research-usage.json`](../bench/critic/results/research-usage.json), 전체 metric과 원문 checksum은 [`metrics.json`](../bench/critic/results/metrics.json), 독립 판독은 [`independent-review.json`](../bench/critic/results/independent-review.json)에 있습니다.

## Tokenizer proxy: 최종 packet의 크기

**아래는 `tiktoken 0.14.0` / `o200k_base` proxy입니다. API 실측 절약량이 아닙니다.** Agent body와 실제 지시문·compact snapshot assignment를 계산합니다. 실제 `task`가 추가하는 전체 system/tool scaffold는 포함하지 않습니다.

| Workload | 원본 tokens/review | 최종 tokens/review | 감소 |
|---|---:|---:|---:|
| 근거 5개 | 1,648 | 1,380 | 16.26% |
| 근거 25개 | 5,109 | 3,666 | 28.24% |
| 근거 100개 | 18,124 | 12,259 | 32.36% |
| 근거 500개 | 87,537 | 58,141 | 33.58% |
| 긴 claim/summary, 근거 25개 | 10,518 | 9,083 | 13.64% |
| 세그먼트 3개, runs 91개 | 13,370 | 13,041 | 2.46% |
| 고정 재전송 포함 22회 합계 | 493,908 | 341,653 | 30.83% |

뷰 응답과 task arguments를 합친 **review transport proxy**는 1,130,095 → 810,141 tokens입니다. 전체 research token 총량이 아닙니다. 초기 탐색 로그의 `total_research_tokens`는 이 좁은 transport proxy를 잘못 이름 붙였으며, measurement segment 2부터 `review_transport_tokens_proxy`로 교정했습니다.

## 고정 평가와 독립 판독

- A–I는 semantic case 18개입니다. Clean case 7개, revise case 11개, 심은 defect 17개입니다.
- 5·25·100·500개 evidence를 포함합니다. C는 긴 문장, D/G/H는 corpus/metric 경계와 실험 상태, I는 필수 산출물 누락을 다룹니다.
- J–L은 같은 원장 상태의 별도 구조 시나리오입니다. Stale digest/packet, 잘못된 role/model/fallback/evaluator, JSON 재배열 및 material 변경을 검증합니다.
- `fixtures.ts`와 `fixtures.lock.json`을 최적화 전에 동결했습니다. 예상 판정이나 plant를 모델 응답에 맞춰 바꾸지 않았습니다.
- `D-experiments-20` / `D-experiments-120`의 실제 runs는 **21/91**입니다. 이름은 lock을 유지하기 위해 남겼으며, 120-run 측정으로 해석하지 않습니다.
- C의 부수 서술은 인용한 manifest 범위를 넘는 내용도 포함합니다. 고정 pass reference는 **declared-license 결론**에 한정합니다. 이 사례를 모든 부수 주장의 provenance가 완전한 clean control로 해석하면 안 됩니다.

초기 자동 scorer는 revise 응답의 ID 언급을 plant 탐지로 인정했습니다. 독립 reviewer가 이 결함을 발견했으며, 원문 concern을 직접 판독했습니다. Baseline/H1/H3에서 실제 17개 defect를 모두 설명한 것을 확인했습니다. Segment 2는 ID 언급을 semantic detection 점수로 쓰지 않습니다.

Accounting도 별도 segment로 교정했습니다. 초기 실제 모델 평가는 case당 1회인 18 calls였지만 proxy는 네 clean size의 재전송까지 22 calls를 계산했습니다. 새로운 segment는 **실제로 22 calls**를 실행하며 실패/누락/모든 usage를 비용과 분모에 유지합니다. System prompt·assignment·model·thinking·fixture lock을 실행 해시에 포함하고, 실제 provider/model의 누락·불일치를 성공으로 인정하지 않습니다. Fixture/reference 자체는 바뀌지 않았습니다.

## 탐색 실험: 동일한 18-call 실제 모델 비교

아래 실측은 `openai-codex/gpt-6.1-sol`, thinking `high`, 동시성 6의 `omp -p` 직접 호출입니다. Plugin critic body와 실제 assignment를 전달하고 provider usage를 합산했습니다. 실제 task subagent의 전체 overhead 비교가 아닙니다. H1 prototype에는 최종 `serialization` 식별자가 아직 없었으므로 최종 packet 실측과 구분합니다.

| 후보 | 직접 critic 입력 실측 | 별도 22-call proxy | 판정 일치 | False pass | False revise | 결정 |
|---|---:|---:|---:|---:|---:|---|
| R0 원본 snapshot | 409,120 | 493,908 | 18/18 | 0 | 0 | 기준선 |
| R1 H1: evidence bookkeeping 생략 | 293,711 | 341,499 | 18/18 | 0 | 0 | 채택 기반 |
| R2 H2: receipt ID를 packet-local alias로 치환 | 256,262 | 294,709 | 17/18 | 0 | 1 | `checks_failed`, 폐기 |
| R3 H3: segment contract 상속과 run metadata 생략 | 286,811 | 335,877 | 17/18 | 0 | 1 | `checks_failed`, 폐기 |

H2는 정상 21-run 사례를 revise로 오판했고, 100-item 응답의 digest에도 한 글자 오류가 있었습니다. H3는 정상 91-run 사례를 revise로 오판했습니다. 두 false revise는 제품이 허용하는 **직접 읽은 결과 파일 기반 `source:"experiment"`**를 거부한 문제였습니다. Reference를 바꾸거나 재시도로 회귀를 지우지 않았습니다. 압축이 원인이라는 인과관계까지 분리한 결과는 아니지만, 관측한 정확도 회귀만으로 폐기했습니다.

Baseline의 500-item 응답은 의미 판정이 맞아도 parser의 100-ID cap 때문에 기록할 수 없었습니다. 이는 새 packet의 보안 회귀가 아니라 기존 가용성 결함입니다. 최종 변경에서는 concerns 제한과 evidence coverage를 분리하고, 현재 ID 배열과 순서까지 정확히 비교합니다.

추가 방향은 실험하지 않았습니다. Notes에는 material caveat가 있을 수 있어 제거하지 않았고, columnar/grouped 표현은 읽기 계약과 순서를 더 바꾸므로 보류했습니다. 관측한 assignment에는 지시문/mission이 이미 한 번씩 들어 있었습니다. 파일 참조로 packet을 옮기면 critic의 추가 read 왕복이 필요하고, cached history 재사용은 과금 단가를 바꿀 수 있어도 총 input token 수를 줄였다는 증거가 되지는 않습니다.

## 실제 context 비용 분석

최적화 전 compact JSON에서 해당 component를 하나씩 제거한 token delta입니다. Serialization 경계 효과가 있으므로 열의 수치를 모두 더해 총량으로 해석하지 않습니다.

| Component | 근거 500개 | Runs 91개 |
|---|---:|---:|
| 지시문 + assignment wrapper | 411 | 411 |
| Evidence claim + summary | 26,795 | 432 |
| Evidence title + locator | 12,532 | 125 |
| Evidence source + stance + ID | 6,500 | 78 |
| Evidence fingerprint | 20,415 | 240 |
| Evidence 등록 시각 | 9,000 | 108 |
| Evidence receipt ID | 10,986 | 137 |
| 전체 run records | 3 | 11,130 |
| Run at/segment/receiptId | 0 | 4,108 |
| Run primaryMetric/direction | 0 | 1,001 |
| Mission metadata | 111 | 134 |
| Notes | 85 | 113 |

Agent 정의 본문은 69 proxy tokens입니다. 500개 evidence에서는 fingerprint·등록 시각이 큰 비중을 차지하지만, runs가 많은 미션에서는 해당 두 evidence 필드가 작은 비중입니다. 따라서 run-heavy 미션의 절감률을 evidence-heavy 결과로 대체하지 않습니다. Duplicate task context와 재전송은 별도로 확인했으며, JSON pretty-printing을 없앤 가상의 큰 기준선을 사용하지 않았습니다. 실제 관측한 compact assignment를 보수적인 기준선으로 사용했습니다.

## Field별 필요성과 attestation 계약

| 목적 | 필요한 정보와 최종 처리 |
|---|---|
| 독립 의미 검토 | `objective`, `mode`, 모든 `constraints`/`deliverables`, evidence `title`/`claim`/`summary`/`source`/`locator` 유지. 실제 원문 전문은 원래 snapshot에도 없었으며, summary의 진실성까지 자동 증명하지 않음 |
| Coverage | 모든 evidence ID를 원래 순서로 유지. Host는 현재 배열의 길이·각 ID를 정확히 비교. Benchmark는 ID에 연결된 각 필드와 receipt 관계도 검사 |
| 모순 탐지 | 모든 evidence와 `stance`, 주장·요약·출처 연결 유지. 반대 근거를 제거하거나 별도 요약으로 대체하지 않음 |
| 실험 검토 | `segmentReports()` 전체 유지: segment 경계·이유·metric/direction, 모든 run의 metrics·ASI·hypothesis·notes·checksPassed·outcome·flagReason 및 baseline/best/counts/effectToNoise. 원래 receipt ID를 유지하여 evidence–run 연결 보존 |
| Reviewer/model attestation | Snapshot 밖의 host task receipt가 agent ID, item index, requested/role/resolved model, fallback, 응답의 agent URI/동기 결과를 연결. 이 검증 경로를 축약하지 않음 |
| 원본 상태 binding | 기존 `evidenceDigest()`는 **전체** evidence/runs/segments를 key-sorted stable JSON으로 SHA-256. 생략한 fingerprint/at까지 digest에 남음 |
| 전달 packet binding | Host가 현재 원장에서 packet을 다시 만들고 task assignment의 `snapshotHash()`와 비교. Schema·serialization·모든 값과 배열 순서·최상위 notes까지 포함하며 key 순서와 공백만 무시. 등록 시 host-derived hash를 critic record에 저장하고 verdict 때 현재 packet과 다시 비교 |
| 지시문과 응답 | `CRITIC_INSTRUCTIONS`, `CRITIC_OUTPUT_SCHEMA` 그대로 유지. 완전한 지시문 존재 확인, critic 자체의 digest echo, 구조화 결과 parsing 및 spawn receipt/agent 연결 모두 유지 |
| 생략한 등록 시각 | Evidence 등록 시각은 원문 발행일이나 실험 측정 시각의 증거가 아님. 등록 시각 자체는 critic에게 보여주지 않으며 검토했다고 주장하지 않음 |
| 생략한 fingerprint | Source 서명이나 진실성 증명이 아니라 엔진의 중복 판정 키. Semantic/provenance 필드로부터 파생하며 원장에서 계속 검증·보존 |
| Notes 경계 | 최상위 notes와 run 내부 notes를 모두 전달하고 versioned packet hash에 포함. Source digest는 기존 범위를 유지하지만, notes/mode 변경도 새 critic의 stored packet hash를 무효화 |

Hash 일치는 **주어진 packet의 동일성**을 보여줄 뿐, 의미적으로 빠짐없이 검토했다는 증명이 아닙니다. Semantic completeness는 원장→packet의 필드/연결 보존 검사, negative tests, 고정 defect의 실제 탐지 판독으로 따로 검증합니다.

## 무결성 및 실제 실행 검증

- `npm run check`, `npm test`: **126/126 통과**. 기존 provenance tests를 유지했고 R4는 ledger 전체 object가 아니라 실제 packet의 stance만 변경하도록 고쳤습니다. 이전에는 생략된 bookkeeping 필드 차이 때문에 stance 검사가 잘못된 이유로 통과할 수 있었습니다.
- 최종 deterministic benchmark: **90 structural scenarios**, `evidence_coverage_rate=1`, `attestation_failure_count=0`, `snapshot_integrity_failure_count=0`.
- Claim 교환, metric의 run 귀속 변경, receipt/flag/contract 필드 누락은 coverage 실패로 드러납니다. Negative 시나리오는 단순 rejection뿐 아니라 기대했던 거절 원인을 확인합니다.
- Version/serialization 삭제·변조, 근거 누락·순서·stance·claim·locator·receipt/요구사항 변경, 잘못된 모델/evaluator/fallback, stale snapshot/response를 거부합니다. 공백·객체 key 순서 차이는 허용합니다.
- Pass 등록 전후의 최상위/run notes·flag·mode 변경은 새 critic을 무효화합니다. Stale critic은 inconclusive verdict에도 연결하지 않습니다. JSON 응답이나 op 입력의 위조 `snapshotHash`는 host 값으로 채택하지 않습니다. Historical hash 없는 기록은 원래 digest-only 보장으로 재생되는 별도 호환성 경로입니다.
- 독립 security reviewer는 최종 production 변경에서 새로운 attestation 약화 경로를 발견하지 못했습니다. 실제 제공자가 실행한 모델을 암호학적으로 증명했다는 뜻은 아닙니다.

실제 OMP 18.11.0에서도 checkout extension을 명시적으로 불러 data 미션을 실행했습니다. 최종 smoke는 `LICENSE:1-21` → E1 → 실제 `deep-research-critic` → `C1: pass` → `V1: conclusive`/`criticId: C1`까지 수집기 정상 종료로 확인했습니다. Host-derived exact packet hash는 `d9be9bca244683ebae3015716c895cb894836c523d3aa953c9dffbfff820864c`입니다. 저장된 child session에서 실제 `openai-codex/gpt-6.1-sol`, fallback 없음과 input **4,355**/output **452**를 확인했습니다. 이 단일 실제 task는 고정 suite의 전후 비용 비교와 별도입니다. 앞선 prototype smoke도 critic/verdict는 성공했지만 잘못된 verdict 요청 1회와 최종 history frame 수집 실패가 있었으며 원래 영수증을 남겼습니다.

보존한 실제 live ledger를 현재 `restore()` → `exportReport()`로 재생하여 `report.md`, `mission.json`, `ledger.jsonl`을 생성했습니다. Conclusive의 `criticId: C1`과 위 full packet hash의 report 출력을 확인했습니다. 영수증은 [`report-smoke.json`](../bench/critic/results/report-smoke.json)에 있습니다.

## 호환성과 대형 미션 영향

- `op:"critic" {evaluator, receiptId, spawnReceiptId}`와 critic answer schema는 유지합니다. Critic record에 optional `snapshotHash`만 추가하고 report에 검토한 packet hash를 표시합니다. 원장과 export에는 원래 evidence metadata가 남습니다.
- 기존 hash 없는 critic 기록은 원래 digest-only 계약으로 재생됩니다. 과거 기록을 소급하여 exact-packet 검증했다고 주장하지 않습니다. 업데이트 전 생성했지만 미등록인 full-snapshot task는 다시 실행해야 합니다. 새 packet을 받아낸 기록은 반드시 host hash를 저장합니다.
- 원본 receipt ID와 전체 실험을 유지하므로 alias나 run-default 문법을 배우는 migration은 없습니다.
- Evidence가 많을수록 bookkeeping 비중이 커져 절감 효과가 큽니다. 긴 summary 또는 runs가 지배하는 미션은 효과가 작습니다. 실제 `task` scaffold와 output ID 나열 비용도 남습니다.
- 500-item 성공은 측정한 모델의 적합성을 보여줄 뿐 모든 설정 모델의 context window·출력 한도에 맞는다는 보장이 아닙니다.

## 남은 신뢰성 위험

1. 단일 모델·합성 fixture 중심이며 표본이 작습니다. 동일 모델의 비결정성, 실제 조사 분포, source summary 자체의 허위, C control의 모호성을 모두 제거한 평가는 아닙니다.
2. 비동기 task가 최종 `resolvedModel`을 보고하지 않으면 기존 role/pin 경로를 신뢰합니다. 실행 중 숨은 fallback이나 제공자의 실제 모델 치환을 완전히 증명하지 못합니다. 알려진 다른 모델/fallback은 계속 거절합니다.
3. 기존 검증은 온전한 packet과 지시문의 **존재**를 확인합니다. 정상 packet과 다른 packet을 함께 전달하거나 주위에 지시를 덧붙이는 공격을 완전히 차단하지 않습니다.
4. Notes/mode 변경도 새로운 review를 요구하므로 재검토 비용이 생깁니다. Historical hash 없는 기록에는 새 보장이 소급되지 않습니다. 새 packet의 hash가 맞더라도 evidence summary의 진실성이나 critic의 실제 이해를 증명하지는 못합니다.
5. Critic은 현재 근거로 conclusive가 방어 가능한지 검토합니다. 이후 작성할 최종 verdict 문장 자체는 이 snapshot에 없으므로, 임의의 사후 결론까지 검토했다고 주장할 수 없습니다.
6. 직접 model invocation 비용은 실제 task subagent의 전체 context/왕복 비용이 아닙니다. Proxy savings를 production API 비용 절감으로 제시하지 않습니다.

재현 절차, fixture mapping, accounting 구분과 원문 산출물은 [benchmark 안내](../bench/critic/README.md)에 있습니다. 모든 실험은 로컬에 남겼으며 원격 설치·release·push·issue closure는 수행하지 않았습니다.
